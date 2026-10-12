# Application Review — Facilities (Tier B)

**Prefix:** `FAC2` · **Iteration:** B4 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-11 (pass 5)

**Correction (security-review 12, 2026-08-26):** FAC-4 ("search wired but
not exposed"), flagged as still-open in every pass below, is closed as of
this correction: `GET /facilities` and `GET /facilities/page` both accept
and forward a `search` query parameter, and `FacilitiesDashboard.tsx` calls
it. See `docs/security-review/FAC-12-facilities.md`.

---

## Pass 5 (2026-10-11) — the frontend, reviewed for the first time: 2 fixed, 2 flagged

### Scope, stated plainly

Passes 1–4 all recorded `tsc --noEmit` as "n/a — no frontend change", and none
of them read `modules/facilities`. That is **10,108 lines across 43 files**, or
roughly half the module, and it had never been reviewed by this rotation. Pass 5
went there deliberately.

The backend was **not** re-derived, and that is a considered choice rather than
a gap: `docs/security-review/FAC-12-facilities.md` is a seven-pass review of
these same files whose most recent pass (7, 2026-10-06) found 0 new findings and
re-confirmed FAC-13 and FAC-30 as the two standing owner decisions. Re-running
that lens would have spent the iteration re-reading what a fresher, deeper pass
had just cleared. What pass 5 did do on the backend is **re-verify the claims
this file makes**, because they were two months old and the module had grown
underneath them (95 → 98 routes, service 2,766 → 3,453 L):

| Pass-4 claim                              | Re-checked 2026-10-11                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "95/95 endpoints permission-gated"        | **98/98**, enumerated mechanically by parsing every `@router` decorator and its signature — 0 ungated           |
| LIKE escaping is "the correct pattern"    | **Now genuinely correct, but not for the reason the audit gave** — see the doc correction below                 |
| `_assert_facility_in_org` wired on update | intact; `assert_in_org` still wired at the sub-entity update paths                                              |
| FK validation on create (FAC-3)           | intact — `update_maintenance_record` re-validates the lookup via the getter and `system_id` via `assert_in_org` |

The first count is the one worth noting: a route parser that looked right
returned **48 of 98** because its block-collection loop consumed routes it had
already passed. The corrected parser found 98. A spot-check would not have
caught that; neither would trusting the first number.

### FAC2-3 — MED correctness — the maintenance and inspection edit forms silently discard a cleared field — ✅ FIXED

`useMaintenanceForm.formToPayload` and `useInspectionForm.formToPayload` each
built **one** payload with `if (formData.x) payload.x = …` and handed it to both
`create…` and `update…`. On update that is pitfall #1's documented bug, verbatim:
the backend dumps update payloads with `exclude_unset=True` (confirmed in
`facilities_service.py`'s `update_maintenance_record` and `update_inspection`,
both of which then call `apply_updates`), so an **omitted key means "leave this
alone"**.

The user empties the box, the key never leaves the browser, the old value
survives, and the toast says "Record updated".

Sixteen fields were affected across the two forms — on maintenance:
`scheduled_date`, `due_date`, `performed_by`, `cost`, `vendor`,
`work_order_number`, `notes`; on inspections: `description`,
`next_inspection_date`, `inspector_name`, `inspector_organization`, `findings`,
`corrective_actions`, `corrective_action_deadline`, `notes`. A cost typed in
error could not be removed, and a vendor who did not do the work stayed
attributed to it.

**The backend was already correct** — `apply_updates` clears on an explicit
null — so this was frontend-only.

**Fix:** both hooks now use `formCoercions(isEdit)` from `utils/formValues`, the
house helper written for exactly this shape after the inventory item form hit it
("two fields fixed and sixteen still dropping the user's clear"). Create keeps
omitting blanks; edit sends an explicit null.

**The nullability was checked per column, not assumed.** `maintenance_type_id`
is `NOT NULL`, so a blank one is still _omitted_ rather than nulled — nulling it
would be a 400 from `apply_updates`, not a clear. The payload interfaces encode
that distinction in the type system: nullable-backed fields are
`?: T | null | undefined`, while `maintenance_type_id`, `is_completed`,
`is_historic` and the inspection NOT NULLs stay narrow, so a future edit cannot
null an un-clearable column without a type error. Two of my own regex-derived
nullability readings were **wrong** (`performed_by` read as NOT NULL,
`attachments` likewise) and were corrected against live SQLAlchemy introspection
before any code changed.

**Tests:** `useMaintenanceForm.test.ts` and `useInspectionForm.test.ts` (new,
7 tests) assert the explicit nulls on edit, the omission on create, and that the
NOT NULL columns keep values. Both mutation-tested: forcing `isEdit` false fails
the null assertion in each file and leaves the create and NOT NULL tests green —
the correct discriminating behaviour.

### FAC2-4 — MED correctness — the overdue dashboard card deep-linked to a list that systematically hid overdue work — ✅ FIXED

The dashboard's "Overdue maintenance" card is a true org-wide SQL count and
navigates to `/facilities/maintenance?status=overdue`. That page called
`getMaintenanceRecords({ facility_id })` with **no status filter** and then
filtered `isOverdue` in the browser.

`list_maintenance_records` is `order_by(desc(created_at))` with `limit=100`. So
the page received the 100 **most recently created** records — and an overdue
record is by nature an old one. The truncation therefore did not merely lose rows
at random, it preferentially discarded exactly the set the filter was looking
for.

**Failure scenario:** an organization with 250 maintenance records, 12 of them
overdue and all created months ago. The card reads "12 — Action required"; the
page it links to loads the 100 newest records, none of which are overdue, and
renders "No maintenance records found". This is the FAC-P2 class, which was
closed for the facility grid and dashboard previews and left open on the two
cross-facility list pages.

**Fix needed no API change** — `is_overdue` and `is_completed` already exist as
query parameters on `GET /facilities/maintenance` and were simply not being
forwarded. The hook now asks the server for the filtered set (pitfall #29: a
screen reports what the backend decided). The client-side pass is deliberately
kept so a filter change shows no stale rows while the fetch is in flight, and
`statusFilter` is in the `useCallback` deps — a primitive, so it cannot
re-trigger the fetch loop the module's own comment warns about.

**Remaining, stated rather than papered over:** the 100-row cap still applies to
the filtered set, so an organization with more than 100 overdue records still
sees a truncated list; and text search stays client-side because the endpoint
has no search parameter, so it matches within the returned page. Both are
recorded in the flag below.

**Tests:** 4 cases assert the server-side parameter for each tab; mutation-tested
(removing the forwarding fails 3 of 4, `all` correctly still passing).

### FAC2-5 — LOW/MED — the inspections list cannot express "awaiting result" server-side — 🚩 FLAGGED

`InspectionsListPage`'s four tabs are all / passed / failed / pending, filtered
client-side over a `limit=100` page. `GET /facilities/inspections` accepts
`passed: bool | None`, where `None` means **no filter** — so "passed" and
"failed" could be forwarded, but **"pending" (`passed IS NULL`) cannot be
expressed at all**. Fixing two tabs server-side and leaving the third on a
loaded page would make the page's correctness vary by tab, which is harder to
reason about than the current uniform behaviour.

Unlike FAC2-4 this is **not** actively hiding its target: inspections are
ordered `desc(inspection_date)`, and an inspection awaiting a result is
typically a recent one, so the truncation is far less likely to empty the
filtered set. That is why it is flagged rather than fixed, and rated below
FAC2-4.

**The fix is an API change and therefore the owner's call:** either a tri-state
`result` enum parameter (`passed` / `failed` / `pending`), or a documented
sentinel for "is null". The same change should add `search` and real pagination
to both cross-facility list endpoints, which would also close FAC2-4's two
residuals. Recorded in `KNOWN_LIMITATIONS.md`.

### FAC2-6 — MED, cross-module — apparatus has the identical payload bug, and pass B2-5 missed it — ✅ CLOSED (2026-10-12)

**Status, corrected.** This entry was written as 🚩 FLAGGED / open, and the
description below is what was true on 2026-10-08 when the defect was found. It
was **not** still true when this pass was committed:

- **The frontend half was fixed on 2026-10-09** by a separate session
  (`f4e16fa0`, with tests for all three apparatus edit modals) — after this
  pass found it, and two days before this pass was rebuilt and pushed.
- **My claim on 2026-10-11 that it was "still present" was wrong.** The check
  that backed it was `grep -c "f.vendor ? { vendor: f.vendor }"` returning `1`.
  That string still exists in the modal — in the **create** branch, where
  omitting a blank is correct. The grep could not tell the create branch from
  the edit branch, and I read a count of one as "bug live". It went into a
  merged PR as an open finding and into the hand-off as a bug to fix. A
  verification that cannot fail in the direction being tested is not a
  verification; the re-check that should have been run was reading the edit
  branch's payload, which the 2026-10-09 commit had already moved to
  `blankToNull` / `numberOrNull`.
- **The backend half was real and is fixed in the change that corrects this
  entry.** `ApparatusService.update_maintenance_record` now uses
  `apply_updates` in place of the bare `setattr` loop. Reproduced against real
  SQL first: an explicit `null` for `is_completed` (or `maintenance_type_id`)
  reached the commit and died as `IntegrityError: Column 'is_completed' cannot be
null` — a 500 — and both now raise `ValueError` → 400.
  `tests/test_apparatus_maintenance_update_integration.py` (4 tests, `integration`
  marker) pairs the two NOT NULL cases with two nullable cases (a null clears;
  an omitted field is untouched), so a guard that rejected every null would not
  pass.
- **Overstated here:** the original text below says the raw loop would also set
  "an unknown field silently". That is not reachable — every key
  `ApparatusMaintenanceUpdate` can produce is a real column on the model — so
  the only live consequence of the raw loop was the NOT NULL 500, and only for a
  direct API client; the form always sends a maintenance type and a boolean.

Original text, as written on 2026-10-08:

Chasing FAC2-3 across the other maintenance surfaces found the same defect in
**apparatus**, which this rotation reviewed three iterations ago and passed:

`modules/apparatus/components/MaintenanceRecordModal.tsx` builds one payload with
conditional spreads — `...(f.vendor ? { vendor: f.vendor } : {})`, sixteen of
them — and sends it to `updateMaintenanceRecord` on edit and
`createMaintenanceRecord` otherwise. Every cleared field is omitted, so the clear
is lost behind "Maintenance record updated". The columns involved (`vendor`,
`cost`, `notes`, `performed_by`, `findings`, `work_performed`,
`mileage_at_service`, `hours_at_service`, the three `next_due_*`) are all
nullable, so nulls are what the schema wants.

**A second, separate defect sits behind it:**
`apparatus_service.update_maintenance_record` applies its updates with a raw
`for field, value in update_data.items(): setattr(...)` loop rather than
`apply_updates`. A raw loop does write an explicit null through, so the frontend
fix alone would work — but it has none of `apply_updates`' protections: a null
against a NOT NULL column fails at flush as an `IntegrityError` → 500 instead of
a clean 400, and an unknown field is set silently. Any fix should do both halves.

**Not fixed in the facilities PR, deliberately:** it is another module and
another iteration of this rotation, and the skill's rule is one feature per run.
Fixing it blind would also widen a facilities PR into apparatus.
`docs/app-review/apparatus.md` records that pass 5 missed it.

**Checked and clean, so not re-reported:** inventory's own
`MaintenanceRecordCreate` payload (`InventoryMaintenancePage.tsx`) has the same
conditional-omission shape but is only ever passed to `createMaintenanceRecord` —
there is no update path through it, so omission is correct there.
`inventoryService.updateMaintenanceRecord` has no UI caller at all (only its own
service test). My B3 inventory claim of "no new code defects" therefore stands.

### Verified good ✅ (frontend, first look)

Checked specifically for the invariants that have **no machine check** behind
them, since the ones that do are already green:

- **Pitfall #1 discipline is otherwise excellent.** All 18 update call sites in
  the module were examined. The six `ExtendedFacilitySections` resource sections
  pair `|| undefined` on create with `blankToNull` on update correctly, and the
  one apparent exception — `updateCapitalProject` sending
  `project_status: v.status || undefined` — is **correct and self-documenting**:
  the column is a NOT NULL enum, and the code says so in a comment. Only the two
  hooks were wrong.
- **No re-derivation (pitfall #29).** `isOverdue` is a backend-computed field the
  frontend reads rather than recomputes; the dashboard consumes server counts and
  server-ordered preview rows. No client-side threshold, percentage or expiry
  math was found — the one place the frontend did act on its own was FAC2-4's
  filter, now fixed.
- **No banned date API** (`toLocaleDateString`/`toLocaleTimeString`/
  `toLocaleString`/`date-fns`): 0 occurrences; `useTimezone()` + the
  `dateFormatting` wrappers throughout.
- **No `window.confirm`/`alert`/`prompt`:** 0. Deletes go through `useConfirm()`
  with named decision buttons and a consequence sentence.
- **FAC-P10 is closed** — the module-audit still listed "photos and documents are
  API-only" as an active gap, but `FilesSection.tsx` is a registered detail
  section that lists photos and documents, uploads, renames via `blankToNull`
  and deletes. Corrected in the audit file.

### Doc corrections

1. **`module-audit/facilities.md` FAC-3** — the heading said
   "✅ FIXED (app-review B4, 2026-08-06)" while its own body still ended
   "**Status:** flagged (XC-1)". Verified fixed in code; body corrected. (Same
   defect shape as AP-1, corrected in pass B2-5.)
2. **`module-audit/facilities.md` had two different findings both numbered
   FAC-P11** — a HIGH access-boundary item (fixed 2026-08-26) and a MEDIUM
   product-depth item. The second is renumbered FAC-P13.
3. **`module-audit/facilities.md`'s LIKE-escaping claim was stale and
   actively misleading.** It praised `list_facilities` for escaping `\`, `%` and
   `_` "before building the `ilike` term — this is the correct pattern". Pitfall
   #25 (2026-08-25, after that audit) establishes that manual escaping _without_
   the `escape=` kwarg is **inert** under MySQL's `NO_BACKSLASH_ESCAPES` and
   "looks entirely correct in review". The code has since been fixed properly —
   `like_pattern()` + `escape=LIKE_ESCAPE_CHAR` on all three columns — so the
   claim's conclusion is now true for a reason it does not give, which is worse
   than being wrong: a reader would copy the described pattern into a new module.
4. **`module-audit/facilities.md` FAC-P10** — marked closed, with the file that
   closes it.
5. **`app-review/apparatus.md`** — pass 5's claim corrected to record the
   `MaintenanceRecordModal` payload bug it missed (FAC2-6).

### Completion gate (pass 5)

| Check                          | Result                                                  |
| ------------------------------ | ------------------------------------------------------- |
| `npm run typecheck`            | ✅ 0 errors, repo-wide                                  |
| `npm run lint`                 | ✅ clean                                                |
| `flake8 app/ tests/`           | ✅ 0 violations                                         |
| `black --check app/ tests/`    | ✅ clean                                                |
| facilities frontend suite      | ✅ **124 passed** (18 files), including the 7 new tests |
| consumers of the widened types | ✅ `ItemDetailPage`, `ranksService` — 26 passed         |
| backend suite                  | n/a — no Python changed this pass                       |

The first typecheck run **failed** on `exactOptionalPropertyTypes`: assigning
`undefined` to `maintenance_type_id?: string` is illegal unless the type says
`| undefined`. Fixed by widening the target type, per CLAUDE.md's instruction on
that gotcha, rather than casting.

---

## Pass 4 (2026-08-09) — invariants re-verified; no code change

Pass 3 closed the FK-validation class (create + all update paths), swept the last
E712, and cleared the latent-500 lens. Pass 4 re-verified the landed state:

- **FK validation intact** — `_assert_facility_in_org` is wired at **10** sites
  in `facilities_service.py` (all 9 `facility_id` sub-entity update paths plus
  `update_compliance_item`'s `checklist_id`), each guarding "only when supplied."
  The create-path (FAC-3) validation is unchanged; 95/95 endpoints
  permission-gated.
- **E712-free** — 0 `# noqa: E712` in `facilities_service.py`.
- **Latent-500 lens clean** — the 16 facilities enum columns are all enum-typed in
  their `*Create`/`*Update` schemas; no free-string→ENUM write path.

The one open item stays **FAC-4** (the `list_facilities` `search` arg is wired in
the service but `GET /facilities` forwards no `search` param) — an owner call on
an unrequested API-surface change, not a bug.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — one residual E712; FK class re-verified closed; latent-500 clean

The FK-validation class is fully closed across create **and** update; pass 3
re-verified it and swept the last remaining E712.

**Re-verified:** `_assert_facility_in_org` (FAC2-1) is wired into all **9**
`facility_id` update paths (utility-account, access-key, room, emergency-contact,
shutoff-location, capital-project, insurance-policy, occupant, compliance-checklist)
and `update_compliance_item` validates its `checklist_id` — each guarding "only when
the field is supplied" (None leaves the parent unchanged). FAC-3 create-path
validation intact; 95/95 endpoints permission-gated.

### FAC2-2 — NIT — Last `== True  # noqa: E712` swept — ✅ FIXED

Pass 1's FAC-2b swept the E712 in **`create_photo`**; a second, distinct occurrence
survived in **`update_photo`**'s set-as-primary path
(`FacilityPhoto.is_primary == True`, unsetting other primaries). Converted to
`.is_(True)` — behavior-neutral for a boolean column — leaving the module free of
every `# noqa: E712`.

### Latent-500 lens (the B1 finding) — checked, clean

The B1 class (a request field typed as free `str` mapping to a strict `Enum` column)
does **not** recur. Facilities has 16 enum columns
(`utility_type`/`key_type`/`room_type`/`project_status`/`policy_type`/… ), and an
automated sweep of every `*Create`/`*Update` schema field mapping to one found **0**
typed as free `str` — all properly enum-typed, so an out-of-range value is rejected
at the schema (422), never reaching MySQL.

### FAC-4 — LOW — `list_facilities` search wired but not exposed — 🚩 FLAGGED (unchanged)

Still the one open item and still an owner call: the service's `list_facilities`
accepts a correctly-LIKE-escaped `search` arg, but `GET /facilities` forwards no
`search` query param. Wiring it is a one-line API addition, but it's an unrequested
API-surface change (pagination interaction? which fields are searchable?) that the
owner should sign off on rather than a review auto-applying it. Correct
dead-reachability, not a bug.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected (no frontend change) ·
`test_facilities_service.py` **9 passed** (all DB-free). DB-backed pytest remains the
known no-MySQL sandbox limitation.

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (FAC-3 create-path + the three update methods it did touch,
FAC-2b `.is_(True)`, FAC-4 flag — all intact). Then applied the B2 update-bypass
lens to **every** FK-bearing update method, not just the three in FAC-3's list —
and it corrects a pass-1 overclaim.

### FAC2-1 — LOW→MED — Sub-entity updates re-parent to a foreign FK with no validation — ✅ FIXED (10 methods)

**What:** pass 1 said FAC-3 was "closed in full," but its enumerated scope was the
create-path FK cluster plus three specific updates (`update_facility`,
`update_maintenance_record`, `update_access_key`'s member id). The **other ~10
sub-entity update methods** — utility-account, access-key (`facility_id`), room,
emergency-contact, shutoff-location, occupant, capital-project, insurance-policy,
compliance-checklist (`facility_id`), and compliance-item (`checklist_id`) — reassign
their **parent FK** through the shared blind-`setattr` helper `_apply_updates`
(or a hand-rolled setattr loop) with **no in-org check**, even though every one of
their **create** paths validates that parent via an org-scoped getter. The B2
asymmetry, systemic across the module.

`update_room` was the sharpest: on a foreign `facility_id` its post-setattr
`get_facility(room.facility_id, org)` returns `None`, so it **silently skipped the
linked-Location sync** while still storing the bad id — an INV-3-style silent
inconsistency, not just a dangling FK.

**Impact:** integrity / mis-parenting only — **verified not a disclosure**: no
sub-entity response projects the parent's name (the `_name` fields on these
schemas are caller-supplied stored columns, and the service never eager-loads
`.facility` for a sub-entity), so a foreign parent id dangles but never reads back
cross-tenant. That is why it is LOW→MED rather than the MED read-leaks of AP2-1 /
INV2-1.

**Fix:** added the shared `_assert_facility_in_org(facility_id, org)` helper (the
`_validate_facility_lookups` DRY that pass 1 recorded as future-dev #2) — mirroring
each create's `get_facility` check, only when the field is supplied — and wired it
into all 9 `facility_id` update paths; `update_compliance_item` validates its
`checklist_id` via `get_compliance_checklist` inline (mirroring
`create_compliance_item`). All 11 endpoints already convert `ValueError → 400`
(verified each call site). 9 unit tests added (`test_facilities_service.py`, the
module's first service test file).

**One over-reach caught by the tests:** an initial guard on `update_utility_reading`
referenced `utility_account_id`, but `FacilityUtilityReadingUpdate` exposes no such
field (a reading can't be re-parented), so the guard would have raised
`AttributeError` at runtime — the test failed, and the guard was removed. Good
argument for writing the test against the real schema, not the grep.

### FAC-4 — still flagged (unchanged)

`list_facilities` search remains wired-but-unexposed; an unrequested API-surface
addition, still the owner's call.

---

## Pass 1 (2026-08-06)

**Prefix:** `FAC2` · **Iteration:** B4 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/facilities.py` (3,553 L, 95 endpoints),
`app/services/facilities_service.py` (2,766 L)
**Frontend:** `modules/facilities`
**Prior audit:** `docs/module-audit/facilities.md` (iteration 4) — FAC-1/FAC-2
fixed; FAC-3 (XC-1 cluster) and FAC-4 (search unexposed) left open.

---

## Scope

Tier B: worked the two open findings. The security pass had done a full
line-by-line tenant-isolation read and confirmed 95/95 permission-gated
endpoints — re-verified, not re-derived.

## Findings

### FAC-3 — LOW — Create/update paths don't validate FK ids in-org (XC-1) — ✅ FIXED (all 7 methods)

A focused, well-enumerated cluster — unlike inventory's INV-4 — so I closed it
in full rather than flagging. The important subtlety was that **not every FK
takes the same validation**:

- **Org-owned entities** (`facility_id`, `system_id`, `assigned_to_user_id`)
  → `assert_in_org` (requires an org match). Applied to `create_photo`,
  `create_document` (facility_id), `create_maintenance_record` +
  `update_maintenance_record` (system_id), `create_access_key` +
  `update_access_key` (assigned_to_user_id).
- **Lookup tables that legitimately hold system rows with `organization_id IS
NULL`** (`facility_type_id`, `status_id`, `maintenance_type_id`) → the
  module's own `get_facility_type` / `get_facility_status` /
  `get_maintenance_type` getters, which allow the NULL-org system rows.
  **Using `assert_in_org` here would have been a bug** — it would reject every
  default system type/status, breaking legitimate facility creation. `update_facility`
  and `update_maintenance_record` now re-validate these on update, mirroring
  `create_facility`.

**Impact (confirms the audit's rating):** all mis-attribution, not disclosure —
I verified the highest-risk sub-case (`access_key.assigned_to_user_id`) and the
`assigned_to_name` shown in the response is a **caller-supplied stored column**,
not a join from the `User` table, so a foreign `user_id` doesn't leak PII.

**Verification:** every affected endpoint already wraps its service call in
`try/except ValueError → 400` (checked `create_photo` and `update_access_key`
directly; the other five raised `ValueError` before), so the new validation
surfaces as a clean 400 rather than a 500. Coverage rests on
`test_org_scoping.py` (7/7) for `assert_in_org`, and the lookup-getter path is
the same one `create_facility` has always used.

With FAC-3 closed, this is the **third module** to have its create-path XC-1 gap
fully resolved (after apparatus and medical-screening).

### FAC-2b — NIT — `is_primary == True # noqa` — ✅ FIXED

`create_photo`'s primary-photo query used `== True` with an E712 noqa; swapped
to `.is_(True)`, same as the apparatus AP-2 cleanup. No behavior change.

### FAC-4 — LOW — `list_facilities` search wired but not exposed — 🚩 FLAGGED (unchanged)

The service's `list_facilities` accepts a `search` arg (with correct LIKE
escaping), but `GET /facilities` never forwards a `search` query param, so the
branch is unreachable from the API. **Left flagged, deliberately:** wiring it is
a one-line API addition, but it is still an unrequested API-surface change, and
adding a feature nobody asked for during an unattended review is scope creep the
owner should sign off on (does it interact with pagination? should every field
be searchable?). It is _correct_ dead-reachability, not a bug — recorded for the
owner, same disposition the prior audit chose.

## Verified good ✅ (re-confirmed)

- 95/95 endpoints permission-gated, no bare `get_current_user`.
- Tenant isolation solid on every by-id op; lookup tables correctly allow
  system rows; `delete_room`'s linked-Location delete is doubly scoped.
- The one search (`list_facilities`) escapes LIKE correctly (the pattern INV-5
  was missing).
- FAC-1 (dead no-op blocks) and FAC-2 (`maintenance_type_id` NOT-NULL guard)
  remain fixed.

## Duplication

The lookup-FK re-validation now appears in both `create_facility` and
`update_facility` (and the maintenance equivalents). That is intentional
symmetry, not accidental duplication — create and update must each validate —
but a shared `_validate_facility_lookups(data, org)` helper would DRY the four
sites if this module is revisited. Noted, not actioned.

## Dead code

None (the FAC-1 no-op blocks were removed in iteration 4). No TODO/FIXME. FAC-4
is unreachable-but-correct code, not dead code to delete.

## Documentation

`docs/module-audit/facilities.md`: FAC-3 now resolved across all listed methods;
FAC-4 stands.

## Future development

1. **Expose `list_facilities` search** (FAC-4) — a small API addition once the
   owner confirms the semantics.
2. **`_validate_facility_lookups` helper** — small DRY cleanup for the
   create/update symmetry.
3. **No facilities-service unit tests for the create/update FK guards** — they
   rest on `test_org_scoping.py` and the module's getter tests; a targeted test
   would lock them once MySQL is in CI.

## Completion gate

| Check                | Result                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                 |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                  |
| `black --check`      | ✅ 503 files unchanged                                                                                           |
| `eslint`             | ✅ clean                                                                                                         |
| backend tests        | ✅ **2517 passed, 0 failed**. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |

</content>
