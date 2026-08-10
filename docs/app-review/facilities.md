# Application Review — Facilities (Tier B)

**Prefix:** `FAC2` · **Iteration:** B4 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

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
be searchable?). It is *correct* dead-reachability, not a bug — recorded for the
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

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
