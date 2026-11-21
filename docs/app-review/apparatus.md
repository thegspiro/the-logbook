# Application Review — Apparatus (Tier B)

**Prefix:** `AP2` · **Iteration:** B2 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-05 (pass 5), 2026-11-20 (pass 6)

---

## Pass 6 (2026-11-20) — the sub-resources and the frontend, read for the first time

**Backend:** `endpoints/apparatus.py` (3,827 L, **94** endpoints — was 3,308 L /
88), `services/apparatus_service.py` (2,992 L), `evoc_level_service.py` (532 L)
**Frontend:** all of `modules/apparatus/` (pages, components, store, services,
types) — the first pass to read it
**Docs:** `docs/APPARATUS_MODULE.md`, `wiki/Module-Apparatus.md`

### Scope

Pass 5 left two deferrals: the sub-resources (fuel logs, equipment,
photos/documents, custom fields) had no depth read, and no pass had read the
frontend at all — the correction under pass 5 records what that cost. Pass 6
read both, plus operators and NFPA items, and the delta since pass 5 (the four
upload/download routes, the in-use delete guard, former-member operators, the
AP2-4 resolution, the forms rollout).

Read in full: every photo, document, fuel-log, equipment, custom-field,
operator and NFPA endpoint and service method; every frontend page, tab, modal,
the store and the service module. Skimmed only: `ApparatusLabelPrintPage`,
`iconMap`, `StatusBadge`, `ApparatusTypeBadge`, `useApparatusNfpaSettings`. The
backend sub-resources and the frontend were each read by a delegated reader
and every finding below was re-checked against the code before it was
recorded; LOW items marked _reported_ were not re-traced line by line.

### Verified good ✅

- **All 94 endpoints carry an auth dependency**, enumerated mechanically. 93
  carry a permission gate; the one authentication-only route is still
  `GET /driver-exceptions/approvers`, deliberate and verified in pass 5. The six
  new routes since pass 5 are the photo/document upload and file endpoints.
- **Uploads go through `FileStorageService`**: magic-byte detection, a read-
  limited size cap (20 MB for images), a generated storage name, the stored file
  discarded if the link row fails. Downloads take the path from the database row
  only, confined by `file_storage.resolve`, and only image types are served
  inline. `file_url` withholds `javascript:` links.
- **Fuel money is `Decimal` / `Numeric`**, never float; fuel logs are create-only
  in both layers, and their list is paginated (max 1,000).
- **Operator create refuses a former member** (`User.is_active`, which covers
  probationary and deleted) — the commit since pass 5 is real.
- **Frontend, pitfall #1 both ways:** every edit form (apparatus, equipment,
  operator, NFPA item, maintenance) sends every field it owns with blanks as
  `null` and holds back NOT NULL columns; every create drops blanks. No `??` on a
  form value anywhere in the module.
- **Frontend contract:** a scripted field-by-field comparison of every backend
  schema against its TypeScript interface (camelCase applied) found no field the
  frontend reads that the backend does not send. Enum values match and are
  lowercase. The module axios client carries credentials and the CSRF header.
- **Frontend dates and dialogs:** no banned locale call, every formatter gets
  `tz` from `useTimezone`, deletes confirm through `ConfirmDialog`, every dialog
  is the shared `Modal`, the list and fuel-log tables carry tiers, labels and
  table-fit specs.
- **The EVOC gate's algebra holds against real SQL** (AP2-12) — and exercising
  it found something the mocked tests could not: a member has one operator row
  per vehicle, so holding two levels means rows on two vehicles, and the gate
  reads every current row the member has.

### AP2-7 — HIGH — Deleting a vehicle's photo or document destroyed a library document it only referenced — ✅ FIXED

**What:** `POST /{id}/photos` and `POST /{id}/documents` accept
`document:<id>` to link a document already in the library, and the link needs
only **read** access to a filed document (`_referenced_document_id`). Deleting
the photo or document record then called `module_documents.delete_document` on
whatever it linked — `DocumentsService.delete_document`, which deletes the
document, its file, and every other row pointing at it (link rows cascade).

**Where:** `endpoints/apparatus.py` `delete_apparatus_photo` and
`delete_apparatus_document` (pre-fix lines 1919–1921 and 2170–2171).

**Impact:** a member with `apparatus.edit` links a policy PDF from a folder they
can only read; any `apparatus.manage` holder deleting that vehicle record then
destroys the library document — something the library's own
`DELETE /documents/{id}` refuses without `documents.manage` and a write on the
folder. A History document reached the same path and answered 500
(`ValueError` uncaught), as did a facility reference the caller may not clear
(`PermissionError`). Facilities, the precedent, removes only its reference row.

**Fix:** `_deletes_backing_document` decides. The document goes with its record
only when the vehicle uploaded it (`source_type` `apparatus_photo` /
`apparatus_document` and `source_id` this vehicle) **and** no other photo or
document record still links it; otherwise only the link row is removed. The
delete's `ValueError` / `PermissionError` now answer 400 / 403. Three tests in
`tests/test_apparatus_files.py` (referenced photo, referenced document record,
an upload another vehicle also links) went red on the unfixed code with the
document gone, and pass now; the existing test that a vehicle's own upload is
deleted with its file still passes. Both docstrings say what is kept.

### AP2-8 — MED — Equipment, custom-field and operator updates answered 500 for a null on a NOT NULL column — ✅ FIXED

**What:** `update_equipment`, `update_custom_field` and `update_operator`
applied `model_dump(exclude_unset=True)` with a bare `setattr` loop. The Update
schemas accept `null` for every field, so `{"name": null}` reached MySQL and
failed at flush — an `IntegrityError` the endpoints do not catch.

**Where:** `apparatus_service.py` (pre-fix 1106–1108, 1785–1787, 1909–1911).

**Impact:** a 500 where a 400 belongs, on equipment `name`/`quantity`/
`is_present`, custom-field `name`/`field_key`/`field_type`/flags, and operator
`is_certified`/`license_verified`/`is_active`. `{"fieldKey": null}` also slipped
past the duplicate-key check's truthiness test. Clearing a nullable field
already worked and still does.

**Fix:** all three use `apply_updates` with the identity and tenancy columns in
`skip`, as the maintenance and NFPA updates already did. New
`tests/test_apparatus_update_nulls_integration.py` (6 tests, `integration`):
the three refusal cases went red on the unfixed code with `IntegrityError` and
now raise `"'<field>' cannot be cleared"`; the three clearing cases pass both
ways, guarding the half that was right.

### AP2-9 — MED — The edit and detail pages showed the previously opened vehicle when a fetch failed — ✅ FIXED

**What:** the store keeps the last apparatus opened, and `fetchApparatus` never
cleared it. The edit page filled its form from `currentApparatus` without
checking its id, and rendered an editable form whenever loading finished.

**Where:** `store/apparatusStore.ts` `fetchApparatus`;
`pages/ApparatusFormPage.tsx` populate effect and render guard;
`pages/ApparatusDetailPage.tsx` loading and not-found guards.

**Impact:** open vehicle A, then `/apparatus/B/edit` where B's fetch fails
(deleted, 403, network): the form showed A's values with no error, and Save
PATCHed B with A's full record. Had nothing been held, the form rendered empty
and Save sent blanks as nulls, clearing B. The detail page showed A's header
and overview while its tabs and buttons acted on B.

**Fix:** the store drops a different apparatus at the start of a fetch (a
re-fetch of the same one keeps it, so a refresh after saving does not flash);
the form fills only from a record whose id matches the URL and shows "Apparatus
Not Found" instead of a form when none loaded; the detail page waits for a
matching record and shows not-found otherwise. Store and form tests went red on
the unfixed code; 153 module tests pass.

### AP2-10 — LOW — Tabs offered add, edit and delete the backend refuses — ✅ FIXED

**What:** Maintenance (add, edit, delete), Fuel Logs (add), Equipment (add,
edit, delete) and the photo/document deletes showed to anyone who could open
the apparatus. The backend gates are maintenance/edit/manage for maintenance
and fuel, edit/manage for equipment, and manage alone for every delete.

**Impact:** a view-only member filled a form and was refused at the end; an
editor was offered deletes only a manager may do. The Operators and NFPA tabs
already gated, so this is the module catching up with itself.

**Fix:** each tab reads `checkPermission` against the backend's strings, as
`NfpaComplianceTab` does; the empty-state "Select Add …" hint shows only to
someone who can. `components/apparatusTabGates.test.tsx` (4 tests) and a
`DocumentsTab` case went red against the unfixed components.

### AP2-11 — LOW — `docs/APPARATUS_MODULE.md` still described AP2-4 as open — ✅ FIXED

The reference said an unresolvable vehicle returns **eligible**, listed AP2-4
under Known Gaps as an open decision, and described `DELETE /{id}` as an
unconditional hard delete with dangling shifts. The owner decided AP2-4 on
2026-10-31 (fail closed, both vehicle tables checked) and the delete has
refused an in-use vehicle since `b7e52361a7`. The edge-case rows, the warning,
the troubleshooting row and Known Gaps now say what the code does.
`docs/KNOWN_LIMITATIONS.md`'s AP2-4 entry was already right.

### AP2-12 — LOW — The EVOC gate's real-database test, written — ✅ FIXED

Pass 5's future-development item 5. New `tests/test_evoc_gate_integration.py`
(9 tests, `integration`): no requirement, exact level, cumulative coverage and
its non-cumulative refusal, every held level considered, a card good through its
expiry day and not the day after, uncertified and inactive records, a basic
vehicle, a vehicle in neither table (AP2-4), and another department's vehicle.
Mutation-tested: removing the expiry filter fails only the expiry test, and
removing the organization filter fails only the other-department test; the
service was restored and is unchanged.

### Flagged for the owner

- **AP2-13 — MED — The odometer and engine hours can move backwards.** A fuel
  log (`apparatus_service.py:1592`), a status change (`:885`) and an apparatus
  edit (`:820`) overwrite `current_mileage` / `current_hours` with whatever was
  entered, and stamp `*_updated_at` with now even for a backdated fill. Entering
  last month's receipt at 48,000 on a truck reading 52,000 sets it to 48,000.
  Only raising the reading, or refusing a lower one, is a behaviour change with
  a real exception (an odometer replaced or corrected). In KNOWN_LIMITATIONS.
- **AP2-14 — MED — Re-activating a former member's operator row skips the
  current-member check.** `create_operator` refuses a former member;
  `update_operator` accepts `{"isActive": true, "isCertified": true}` on a row
  left from before they departed. The create comment keeps such rows editable
  on purpose; whether re-activation is a new certification is the owner's call.
  In KNOWN_LIMITATIONS.
- **AP2-15 — LOW — Custom-field definitions are stored and never read.** No
  frontend screen manages them (the four service methods have no caller), and
  nothing on the backend enforces `is_required`, `options`, the min/max bounds
  or `regex_pattern` against `custom_field_values`; renaming a `field_key`
  orphans every stored value. Pitfall #19's shape. Build the reader and the UI,
  or retire the definitions. In KNOWN_LIMITATIONS.

### Open (LOW, not fixed this pass)

_Reported_ by the depth read; recorded so the next pass starts from them:

- NFPA item list (`list_nfpa_items`) has no limit; per apparatus, so bounded in
  practice.
- NFPA update stamps `last_checked_by` on any edit, a notes-only one included,
  without touching `last_checked_date`.
- Two concurrent uploads with `is_primary` can both end up primary (no lock);
  deleting the primary photo promotes none.
- A concurrent duplicate operator create hits the unique index as a 500.
- `?tab=` is cast unchecked on the detail page, so an unknown value renders no
  tab; back/forward changes the URL but not the tab.
- `FuelLogModal` recomputes the total from a stale closure and overwrites a
  typed total; price per gallon is a hard-coded `$…toFixed(3)` beside a
  `formatCurrency` column.
- `EquipmentModal` turns a typed quantity of 0 into 1 on create.
- A completed maintenance record with no completed date reads "Completed N/A".
- The NFPA required-tests table is a base `rwd-table` with no measurement or
  table-fit spec (pitfall #39).

### Dead code

Not deleted this pass: frontend service methods with no caller —
`getType`, `getArchivedApparatus`, `deleteApparatus`, `getMaintenanceRecord`,
`createPhoto`, `createDocument`, `getLevel`, `checkEligibility`, the four
custom-field methods (tied to AP2-15) — the unused `export default` aggregate in
`services/api.ts`, and the store's `maintenanceDue` / `fetchMaintenanceDue` /
`setCurrentApparatus`. Removing them changes nothing at runtime; it is a
self-contained clean-up for the next pass, kept out of a pass that already
changes behaviour in four places.

### Completion gate (pass 6)

| Check                          | Result                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`            | ✅ 0 errors                                                                                                                                                                                                                       |
| `npm run lint`                 | ✅ 0                                                                                                                                                                                                                              |
| `flake8 app/ tests/`           | ✅ 0 (three PT011 in the new test fixed with `match=`)                                                                                                                                                                            |
| `black --check app/ tests/`    | ✅ 2,518 files unchanged                                                                                                                                                                                                          |
| `isort --check-only`           | ✅ changed files clean                                                                                                                                                                                                            |
| endpoint docstring permissions | ✅ 0 errors, 0 warnings (`check_endpoint_permissions.py --strict`)                                                                                                                                                                |
| docs link check                | ✅ 520 Markdown files, 0 broken links                                                                                                                                                                                             |
| backend tests                  | ✅ **228 passed** — apparatus files (21, +3) · update nulls (6, new) · EVOC gate integration (9, new) · EVOC service · apparatus service · FK scoping · operators · delete-in-use · NFPA · maintenance update · shift eligibility |
| frontend tests                 | ✅ **apparatus module 158 passed** (153 with the store and form cases, then +4 tab gates, +1 documents)                                                                                                                           |
| marker routing (pitfall #30b)  | ✅ both new integration files collect 0 tests under the unit job's filter                                                                                                                                                         |

---

## Pass 5 (2026-10-05) — the deferred depth read, and the test three passes could not run

**Backend:** `endpoints/apparatus.py` (3,308 L, **88** endpoints — was 2,980 L /
83), `services/apparatus_service.py` (2,667 L — was 2,395),
`evoc_level_service.py` (475 L — was 329), `schemas/apparatus.py` (1,967 L),
`driver_exception_service.py`
**Frontend:** none changed this pass
**Docs:** at review time, `wiki/Module-Apparatus.md` (feature narrative + change
history) and `wiki/API-Reference.md`'s nav table — but no structured reference
under `docs/`. Closed 2026-10-08 by `docs/APPARATUS_MODULE.md`

### Scope

Passes 1–4 reviewed this module at the **invariant** level (auth, tenancy, FK
scoping) and each one recorded the same two deferrals: a real-database
integration test, and "a future depth read of the maintenance-scheduling and
EVOC business logic, as its own focused iteration". Pass 5 is that iteration,
and it closes the test.

Read in full: the maintenance lifecycle (`create_` / `update_maintenance_record`,
`get_maintenance_due`), `get_apparatus_stats`, the EVOC eligibility gate
(`check_driver_evoc_eligibility`) and its two callers, `list_approvers`, and the
delta since pass 4 (five commits — the org-timezone dating of apparatus work,
the EVOC certificate date move, security-review pass 5, and `preferred_name`).
**Not** read line-by-line: the fuel-log, equipment, photo/document and custom-field
sub-resources, whose invariants passes 1–4 verified and which this pass did not
re-derive.

**Correction (2026-10-11, found during app-review B4 pass 5).** This pass read
the maintenance lifecycle "in full" on the **backend** and did not read the
frontend form that drives it, and a MED defect was sitting there:

`modules/apparatus/components/MaintenanceRecordModal.tsx` builds one payload out
of sixteen conditional spreads — `...(f.vendor ? { vendor: f.vendor } : {})` —
and sends it to `updateMaintenanceRecord` when editing and
`createMaintenanceRecord` otherwise. On edit every cleared field is **omitted**,
and the backend dumps update payloads with `exclude_unset`, so the omission means
"leave this alone": the user empties the vendor, the cost or the notes, the toast
says "Maintenance record updated", and the old value is still there. That is
CLAUDE.md pitfall #1's update rule, which this document's own pass-2 and pass-3
sections cite for the backend mirror-image of the same bug. All the affected
columns (`vendor`, `cost`, `notes`, `performed_by`, `findings`, `work_performed`,
`mileage_at_service`, `hours_at_service`, the three `next_due_*`) are nullable,
so an explicit null is what the schema wants.

A second defect sits behind it: `apparatus_service.update_maintenance_record`
applied updates with a raw `for field, value in update_data.items(): setattr(...)`
loop rather than the shared `apply_updates`. The raw loop does write a null
through, so a frontend-only fix would function — but it loses `apply_updates`'
guarantee for NOT NULL columns: a null against one becomes an `IntegrityError` →
500 instead of a clean 400. (An earlier version of this paragraph also said an
unknown field would be "set silently". That is not reachable: every key
`ApparatusMaintenanceUpdate` can produce is a real model column.)

Recorded as **FAC2-6** in `docs/app-review/facilities.md` with the full
mechanism. **Both halves are now closed** — the frontend by `f4e16fa0` on
2026-10-09, the service by the change that wrote this sentence (2026-10-12) —
and the entry above in `facilities.md` explains why an earlier version of it
wrongly reported the frontend as still open on 2026-10-11.

The lesson for this file is the one B4 pass 5 acted on: a pass that records
`tsc --noEmit` as "no frontend change" has not reviewed the frontend, and should
not describe its scope as having read a workflow "in full".

### Verified good ✅

- **All 88 endpoints carry an auth dependency** — enumerated mechanically
  (parse each `@router.*`, walk to its `def`, scan the whole signature block),
  not spot-checked. 87 carry a permission gate; the distribution is
  `apparatus.view|manage` ×32, `apparatus.manage` ×32, `apparatus.edit|manage`
  ×12, `apparatus.maintenance|edit|manage` ×5, and seven singletons.
- **The one authentication-only route is deliberate and its claim is true.**
  `GET /driver-exceptions/approvers` is readable by any member — a member
  refused the driver seat needs to know who to ask. Its docstring promises
  "only names and ranks, not contact details"; verified against
  `DriverExceptionApprover` (`user_id`, `user_name`, `rank` — nothing else) and
  against `list_approvers`, which is org-scoped, excludes deleted and inactive
  members, and resolves names through `display_name` — the right choice for a
  "who to call" surface per `utils/member_names.py`.
- **The org-timezone sweep is complete, not partial.** `date.today()` appears
  **nowhere** in `apparatus_service.py`, `evoc_level_service.py` or
  `endpoints/apparatus.py`. Every calendar-day decision (disposal date, overdue
  comparison, completion date, the 30-day expiry windows, the 12-month service
  cutoff, EVOC `as_of`) routes through `resolve_org_today`; every _timestamp_
  stays `datetime.now(timezone.utc)`. That is the correct split and there is no
  surface left on the viewer's clock — the partial-sweep failure this pass went
  looking for is not present.
- **`is_overdue` staleness is already closed, and the closing task is really
  wired.** The flag is stored at write time and `get_maintenance_due` reports
  the stored value, so a record entered with a future due date would read
  "not overdue" after the date passed — understating the dashboard's overdue
  count. `run_mark_overdue_maintenance` (`scheduled_tasks.py:5835`) fixes this
  daily, per-organization, in that org's own timezone. Its docstring claims it
  "runs daily"; verified rather than inherited — metadata at `:433`, runner in
  the dispatch map at `:6421`, `86400` interval at `:6474`, plus its own
  `tests/test_mark_overdue_maintenance.py` and an org-local-today test. Not
  re-reported as a finding.
- **Injection-free.** No `text()`, f-string or `.format()` query building. Every
  `ilike` builds its pattern with `like_pattern()` and passes
  `escape=LIKE_ESCAPE_CHAR` — on the continuation line, which a line-based grep
  reports as a false positive; `tests/test_like_escaping.py` (3 passed) is the
  authority and it is green.
- **E712-free** — 0 `# noqa: E712` in `apparatus_service.py`, as pass 3 left it.

### AP2-4 — MED — The EVOC gate fails open when the apparatus cannot be resolved — ✅ FIXED (2026-10-31)

**What:** `check_driver_evoc_eligibility` returns `eligible: True` both when the
apparatus has no EVOC requirement **and** when the apparatus cannot be found at
all — one condition covered both:
`if not apparatus or not apparatus.required_evoc_level_id`.

**Where:** `backend/app/services/evoc_level_service.py:311` (pre-fix line).

**Impact:** reachable without an attacker, through ordinary data loss.
`Shift.apparatus_id` is `Column(String(36))  # Link to apparatus (future)` —
**no foreign key** (`models/training.py:2954`) — and `delete_apparatus` is a
hard delete (`apparatus_service.py:870`, docstring: "hard delete - use archive
for soft delete"). So retiring an engine leaves every shift that referenced it
pointing at a row that no longer exists. `shift_eligibility_service.py:1292`
passes that id straight in, gets `eligible: True`, and seats any member in the
driver's seat with **no warning** — the EVOC requirement silently stops being
enforced on exactly the shifts of a decommissioned truck. CLAUDE.md pitfall #14
names this shape directly: "fail closed in access-control helpers — if a
referenced folder/parent can't be resolved, deny, don't grant."

**Fix:** the verdict is **not** changed here, and that is deliberate. Flipping an
unresolvable apparatus to ineligible is a behavior change in a safety gate:
depending on the org's enforcement setting it would start warning — or blocking —
on every shift carrying a dangling reference, and a department with that data
would feel it immediately. That is an owner call, mirrored into
`KNOWN_LIMITATIONS.md`.

What _was_ changed is the silence, which needed no decision: the two cases are
now separate code paths and the unresolvable one logs a warning naming the
apparatus, the org and the member. The gate's answer is identical; the failure is
now diagnosable instead of invisible.
`tests/test_evoc_level_service.py::test_unresolvable_apparatus_is_logged` pins
that, and says in its own docstring that the verdict it asserts is the flagged
one — so whoever decides AP2-4 has to update the test deliberately rather than
discovering it.

Two options for the decision:

1. **Fail closed** — return `eligible: False` with a warning that the apparatus
   could not be found. Correct per pitfall #14; surfaces broken data loudly.
2. **Fix the data path instead** — give `shifts.apparatus_id` a real FK with
   `ondelete="SET NULL"` (pitfall #2: then `nullable=True`), so a deleted
   apparatus clears the reference and the shift legitimately has no EVOC
   requirement. Needs a migration and a decision about the other polymorphic
   `apparatus_id` columns that deliberately match it.

**Resolved (2026-10-31), owner decision: option 1, with both vehicle tables
checked.** A real FK (option 2) turned out not to be possible — `shifts.
apparatus_id` names a row in either `apparatus` or `basic_apparatus`, so a key
to one table would reject the other. `check_driver_evoc_eligibility` now
checks `basic_apparatus` (no requirement, as before) before concluding an id
is unresolvable; an id in neither table is **ineligible**, with a message to
re-pick the shift's vehicle, instead of `eligible: True`. Enforcement-off and
chief-exception behavior are unchanged downstream of this verdict. See
`docs/KNOWN_LIMITATIONS.md`'s AP2-4 entry and
`backend/app/services/evoc_level_service.py:check_driver_evoc_eligibility`.
`test_unresolvable_apparatus_is_logged` now asserts the resolved (ineligible)
verdict rather than the old flagged one.

### AP2-5 — LOW — Four no-op attachment "conversion" blocks — ✅ FIXED

**What:** four copies of a block whose two branches are identical:

```python
dump["attachments"] = [a if isinstance(a, dict) else a for a in dump["attachments"]]
```

`a if isinstance(a, dict) else a` is `a`. The comment above each — "Convert
attachment models to dicts for JSON storage" — describes work the block does not
do: `model_dump()` has already recursed into the nested `FileAttachment` /
`NoteAttachment` models and produced dicts. Verified rather than assumed, by
dumping a real `ApparatusMaintenanceCreate` carrying one attachment and checking
the element types (`['dict']`).

**Where:** `apparatus_service.py` lines 1205, 1339, 2494, 2542 (pre-fix) —
`create_`/`update_maintenance_record` and `create_`/`update_component_note`.

**Impact:** none at runtime; this is dead code that misdescribes itself, which is
the maintenance liability CLAUDE.md's comment policy is about — the next reader
either trusts the comment and believes a conversion happens, or works out that it
doesn't and wonders what broke.

**Fix:** all four removed; the two create paths keep one honest comment saying
`model_dump()` has already done it. Behavior-identical — the only difference is
list identity, and the value goes straight into a JSON column. flake8 0, black
clean, 13 existing `test_apparatus_service.py` tests unchanged and passing.

### AP2-6 — LOW — The deferred real-database FK test, written — ✅ FIXED

**What:** passes 2, 3 and 4 each recorded "no apparatus-service integration test
against a real DB" as open, attributing it to the sandbox. That attribution was
stale: `.claude/hooks/session-start.sh` starts MariaDB and builds the schema, so
`db_session` tests run in a web session. The checklist's own "Known sandbox
limitations" said they could not, which is what kept the item deferred — that
entry is corrected (see Documentation gaps).

**Where:** new `backend/tests/test_apparatus_service_fk_scoping_integration.py`
(7 tests, `pytest.mark.integration`).

**Impact:** the FK org-scoping that three passes signed off rested on mocked
sessions, and **a mocked session cannot distinguish a working
`WHERE organization_id = :org` from a missing one** — it returns whatever the stub
was handed. The count of `assert_in_org` call sites was being used as the
evidence instead, and that count has now been wrong in the docs twice (17 → 16 →
actually 19). A test is the right evidence.

**Fix:** cross-org and same-org cases on each FK — `required_evoc_level_id` on
create and update, `component_id` and `service_provider_id` on maintenance
create — plus an XC-3 by-id read check. Each cross-org case asserts the guard's
own message (`match="Invalid EVOC level"`, `"Invalid component"`,
`"Invalid service provider"`) so a different `ValueError` cannot satisfy it, and
each is paired with a positive case, because a guard that rejected _everything_
would otherwise pass the file.

Mutation-tested: removing the `assert_in_org` call from `create_apparatus` fails
`test_foreign_evoc_level_is_refused` and **only** that test; restored with the
same mechanism that applied it. Marker routing verified by collection, per
pitfall #30b — 0 tests collected under the unit job's
`-m "not integration and not slow and not docker"`, 7 under `-m integration`.

Two constraints the mocked tests had never exercised turned up while writing it,
which is the argument for real SQL in one line: `create_apparatus` stamps
`status_changed_by`, which carries a foreign key to `users.id` (a bare uuid fails
at flush), and `ApparatusMaintenanceType.code` is `NOT NULL`.

### Duplication

- **`is_overdue` is maintained twice, by design.** `ApparatusMaintenance` and
  `FacilityMaintenance` each stamp it on their own create/update paths, and
  `run_mark_overdue_maintenance` refreshes **both** in one loop. That is the
  right shape — one owner for the time-passing case — and worth recording as
  checked rather than flagged, because two services writing the same derived
  flag looks like drift until you find the shared task.
- No duplication introduced or found within the maintenance/EVOC code this pass.

### Dead code

- The four no-op attachment blocks — deleted (AP2-5).
- `grep -rn "check_driver_evoc_eligibility"` confirms two live callers
  (`shift_eligibility_service.py:1292`, `endpoints/apparatus.py:2896`); not dead.

### Documentation gaps

Four corrected this pass, all of them claims that had rotted:

1. **`docs/app-review/CHECKLIST.md` told reviewers to update `CHANGELOG.md`** —
   which CLAUDE.md closed to new entries on 2026-09-08. Following the checklist
   would have violated the rule, and the pre-commit checklist item that catches
   it. Replaced with PROGRESS.md, and the `docs/UPGRADING.md` carve-out noted.
2. **The same file's "DB-backed pytest cannot run here"** — the claim that
   deferred AP2-6 across three passes. Corrected to "check before assuming",
   naming the session-start hook, and keeping the genuine no-DB signature for
   environments that lack one.
3. **Pass 4's `assert_in_org` count (16)** — actually 19; the module grew. Noted
   in place, with the observation that the number is what keeps rotting, which
   is why pass 5 put a test behind the coverage instead of restating a count.
4. **`docs/module-audit/apparatus.md` AP-1 contradicted itself** — heading
   `✅ FIXED`, body "Status: flagged … Not auto-fixed". The heading was updated
   when the fix landed and the body never was. Body rewritten to record both the
   fix and the original reasoning, which is what produced `assert_in_org`.

Still missing at the time of this pass: no structured reference under `docs/`.
88 endpoints, two permission strings of its own plus six it shares, the EVOC
ladder, the maintenance lifecycle and the driver-exception workflow had no
single place stating their shapes and gates. Writing it is a pass of its own,
not a side-effect of this one.

> **Correction (2026-10-08).** This paragraph originally said the module was
> "documented only in docstrings and `wiki/API-Reference.md`'s nav table". That
> was wrong: **[wiki/Module-Apparatus.md](../../wiki/Module-Apparatus.md)** —
> 465 lines of feature narrative and dated change history — existed throughout,
> and this pass did not look for it. The gap was narrower than stated: no
> _structured reference_ (data models, endpoint-and-permission tables, flows,
> edge cases), which is what
> [docs/APPARATUS_MODULE.md](../APPARATUS_MODULE.md) now provides, cross-linked
> with the wiki page. Several modules in this repository carry both, by design —
> `docs/SCHEDULING_MODULE.md` and `wiki/Module-Scheduling.md` are the
> precedent.

### Future development

1. ~~**AP2-4's decision**~~ **Resolved 2026-10-31** — fail closed, checking
   both `apparatus` and `basic_apparatus` (above).
2. ~~**No feature doc exists.**~~ **Closed 2026-10-08** by
   [docs/APPARATUS_MODULE.md](../APPARATUS_MODULE.md) — note the house convention
   is `<NAME>_MODULE.md`, which this pass named wrongly as `docs/APPARATUS.md`.
   The largest module in the repo by
   endpoint count has no feature doc.
3. **The maintenance interval fields are declared but unscheduled.**
   `ApparatusMaintenanceType` carries `default_interval_value`,
   `default_interval_unit`, `default_interval_miles`,
   `default_interval_hours` — nothing in `apparatus_service.py` reads them to
   generate the next record when one is completed. Completing an annual pump
   test does not schedule next year's. That is CLAUDE.md pitfall #19's shape
   (stored configuration with no reader), and it is a feature decision rather
   than a defect: a department may be scheduling manually on purpose.
   Not fixed, not flagged as a bug — recorded here because the columns imply a
   promise the code does not keep.
4. **The sub-resources still have no depth read** — fuel logs, equipment,
   photos/documents, custom fields. Their invariants are verified; their business
   logic is not.
5. **No integration test for the EVOC gate itself.** AP2-6 covers FK scoping
   against real SQL; `check_driver_evoc_eligibility`'s cumulative-level algebra
   is covered only by mocked tests. Its correctness decides who may drive, which
   makes it the next best candidate for a real-database test.

### Completion gate (pass 5)

| Check                | Result                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`  | ✅ 0 errors (run repo-wide; no frontend file changed this pass)                                                                                      |
| `flake8 app/ tests/` | ✅ 0                                                                                                                                                 |
| `black --check`      | ✅ 1,370 files unchanged (the new test file was reformatted once, then re-run)                                                                       |
| `isort --check-only` | ✅ clean                                                                                                                                             |
| `npm run lint`       | ✅ 0 (full run, `--max-warnings 10`)                                                                                                                 |
| docs link check      | ✅ 433 Markdown files, 0 broken links                                                                                                                |
| route permissions    | ✅ 245 routes, 0 errors, 0 warnings (`check_route_permissions.py --strict`)                                                                          |
| backend tests        | ✅ **57 passed** — apparatus FK integration (7, new) · apparatus service (13) · EVOC (32, +1 new) · LIKE escaping (3) · mark-overdue-maintenance (2) |

---

## Pass 4 (2026-08-09) — invariants re-verified; no code change

Pass 3 closed every open code item on this module (AP2-2 FK validation on both
paths, the full E712 sweep, the latent-500 lens). Pass 4 re-verified the landed
state holds and found nothing to change:

- **FK validation intact** — `assert_in_org` is wired at **16** sites across
  `apparatus_service.py` (create + update for apparatus type/status/station, EVOC
  level, maintenance component/service-provider, component-note provider) —
  corrected from "17" by security-review AP-13 pass 2 (2026-08-28), which
  recounted via `grep -c` on the file; the coverage claim was always
  correct, only the count was off. The
  create-path (AP-1) and update-path (AP2-1/AP2-2) FK classes remain closed.
  _(Pass 5, 2026-10-05: now **19** — the module has grown since. The number is
  the thing that keeps rotting here, which is why pass 5 stopped restating it
  and put the coverage under a test instead; see AP2-5.)_
- **E712-free** — 0 `# noqa: E712` in `apparatus_service.py`.
- **Latent-500 lens clean** — `fuel_type` is `Optional[FuelTypeEnum]` on both
  `ApparatusCreate`/`Update` and enum-typed on the response; the component-note
  enums are enum-typed. No free-string→ENUM write path.

The only open items remain the ones flagged since pass 2 — a MySQL-backed
apparatus-service integration test (blocked by the no-DB sandbox) and a future
depth read of the maintenance-scheduling / EVOC business logic as its own focused
iteration. Neither is a defect.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — closed the open AP2-2 item; E712 sweep; latent-500 lens

Re-verified the landed fixes hold: **AP-1** create-path FK validation intact;
**AP2-1** update-path FK re-validation intact on all three eager-loaded paths
(`update_apparatus` type/status/station, `update_operator` evoc, and
`update_maintenance_record` maintenance-type). All 83 endpoints still carry an auth
dependency; the service report resolves `service_provider_id` names **org-scoped**
(`ApparatusServiceProvider.organization_id == organization_id`), confirming pass-2's
call that the AP2-2 FKs are integrity-only, not read-leaks.

### AP2-2 — LOW — Dangling (non-projected) FKs unvalidated on create/update — ✅ FIXED

Pass 2 left this open and recommended "a follow-up sweep validating them via the
shared `assert_in_org` on both paths." Done. The four integrity-only FKs — none
projected into any response, so they could only dangle — are now validated in-org
on **both** the create and update paths, reusing `assert_in_org(..., allow_none=True)`:

| FK                                   | Target model (org-scoped)  | Paths hardened                                           |
| ------------------------------------ | -------------------------- | -------------------------------------------------------- |
| `apparatus.required_evoc_level_id`   | `EvocLevel`                | `create_apparatus`, `update_apparatus`                   |
| `maintenance.component_id`           | `ApparatusComponent`       | `create_maintenance_record`, `update_maintenance_record` |
| `maintenance.service_provider_id`    | `ApparatusServiceProvider` | `create_maintenance_record`, `update_maintenance_record` |
| `component_note.service_provider_id` | `ApparatusServiceProvider` | `create_component_note`, `update_component_note`         |

All six endpoints already convert `ValueError → 400` via `safe_error_detail`, so the
rejections surface cleanly. `ApparatusComponentNoteUpdate` omits `component_id`, so a
note can't be re-pointed to a foreign component via update (no gap there). No
behavior change for valid callers (the frontend selects these ids from org-scoped
dropdowns); a foreign/garbage id that previously stored a dangling reference is now
refused. **4 tests added** (`TestUpdateMaintenanceFKValidation` component/provider,
`TestUpdateApparatusEvocFKValidation`, `TestUpdateComponentNoteFKValidation`);
`test_apparatus_service.py` now 10 (was 6). **AP2-2 is closed on both paths** — the
XC-1 create/update FK class is now fully resolved for this module.

### AP2-3 — NIT — `== True`/`== False` E712 suppressions swept — ✅ FIXED

The remaining 11 `col == True/False  # noqa: E712` comparisons in
`apparatus_service.py` (boolean-column WHERE clauses in `get_maintenance_due`, the
archive queries, `generate_service_report`, etc.) were converted to `.is_(True)` /
`.is_(False)` per Pitfall #10, removing every `# noqa: E712` from the file
(behavior-neutral for boolean columns). flake8 stays clean.

### Latent-500 lens (the B1 finding) — checked, clean here

The B1 class (a request field typed as free `str` mapping to a strict `Enum`
column) does **not** recur: the only enum column across the apparatus/maintenance
models is `Apparatus.fuel_type`, and `ApparatusCreate.fuel_type` is typed
`Optional[FuelTypeEnum]` (validated); the component-note enums
(`note_type`/`severity`/`status`) are likewise enum-typed in the schema. No
free-string→ENUM write path.

### Flagged / future (unchanged)

- **No apparatus-service integration test against a real DB** — the FK-scoping now
  rests on `assert_in_org`'s own unit tests plus these mocked-session tests; a
  MySQL-backed integration test would lock the wiring once CI has a DB.
- **83 endpoints / ~5.7k lines reviewed at the invariant level across three passes**
  — a future depth read of the maintenance-scheduling and EVOC business logic
  (beyond tenant isolation) is the next increment, as its own focused iteration.

**Completion gate (pass 3):** `flake8 app/ tests/` 0 · `black --check` clean ·
`tsc --noEmit` 0 (no frontend change) · eslint unaffected (no frontend change) ·
`test_apparatus_service.py` **10 passed** (6 + 4 new; all DB-free). DB-backed
pytest remains the known no-MySQL sandbox limitation.

---

## Pass 2 (2026-08-06)

Re-verified pass 1: AP-1 create-path FK validation intact (`create_operator`,
`create_photo`, `create_document`, `create_maintenance_record` all validate
in-org); AP-2 `.is_(True)` intact. Then applied the B1 lesson — **can update
paths change FKs the create path validates, bypassing the guard?** — across every
FK-accepting update method. They can, and several are cross-tenant read leaks.

### AP2-1 — MED — Update paths didn't re-validate client FKs that are eager-loaded into responses — ✅ FIXED

**What:** the create/change paths validate their client-supplied FKs in-org, but
the corresponding **update** methods did a blind `model_dump(exclude_unset=True)`

- `setattr` loop with no validation. Each of these FKs is **eager-loaded into a
  response relationship**, so a foreign id stored via update is not a dangling
  reference — it is projected back into the caller's response, leaking the other
  org's row (the exact vector `create_operator`'s comment describes and guards):

| Update method               | Unvalidated FK(s)                                      | Eager-loaded into                                    | create/change counterpart validates?                                                                        |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `update_apparatus`          | `apparatus_type_id`, `status_id`, `primary_station_id` | `apparatus_type`, `status_record`, `primary_station` | type/status yes (`create_apparatus`, `change_apparatus_status`); **station no — unvalidated on create too** |
| `update_operator`           | `evoc_level_id`                                        | `evoc_level`                                         | yes (`create_operator`)                                                                                     |
| `update_maintenance_record` | `maintenance_type_id`                                  | `maintenance_type`                                   | yes (`create_maintenance_record`)                                                                           |

`update_apparatus` additionally copied an unvalidated `status_id` into
`ApparatusStatusHistory`, so the forgery persisted into the status audit trail.
The operator case is the sharpest: `ApparatusOperatorUpdate` blocks `user_id`/
`apparatus_id` (so no member-PII leak), but `evoc_level_id` was updatable and the
operator response eager-loads `evoc_level`.

**Fix:** each update method now validates the supplied FK in-org before writing,
reusing the **same validator the create path already uses** — `get_apparatus_type`
/ `get_apparatus_status` for apparatus, `get_maintenance_type` for maintenance,
`assert_in_org(EvocLevel, …, allow_none=True)` for the operator EVOC level — and
only when the id was actually supplied (`exclude_unset` semantics preserved). The
**station** FK was the one eager-loaded apparatus FK unvalidated on _both_ paths,
so `create_apparatus` and `update_apparatus` both gained
`assert_in_org(Location, primary_station_id, …, allow_none=True)` (`Location` is
org-scoped, confirmed in the A8 review). All three update endpoints already
convert `ValueError → 400` via `safe_error_detail`, so the rejections surface
cleanly. 6 unit tests added (`test_apparatus_service.py`): foreign type/status/
station/evoc/maintenance-type each rejected, plus a no-change path that makes no
extra query.

### AP2-2 — LOW — Dangling (non-projected) FKs still unvalidated — ✅ FIXED (security-review AP-13, pass 3, 2026-09-03)

The FKs that are **not** eager-loaded into any response — so they could only dangle,
not leak — were left unvalidated on create _and_ update: `apparatus.required_evoc_level_id`
(SET NULL, not projected), `maintenance.component_id` / `maintenance.service_provider_id`,
and `component_note.service_provider_id`. These are the same integrity-only XC-1
shape pass 1 hardened in other modules (MSG-2, GF-6) as defense-in-depth.
Left open at the time this doc was originally written, to keep that
iteration's change scoped to the confirmed read-leak set. **Since fixed** —
`apparatus_service.py` now validates all four via `assert_in_org` on both the
create and update path for each (see the `# AP2-2` comments at the call
sites); confirmed by reading the current code rather than assumed from this
doc, which had drifted (see `docs/security-review/AP-13-apparatus-nfc.md`).

### MS2-4 class checked — not present here

The B1 defect (a response schema declaring flat name fields the service never
populates) does **not** recur in the paths reviewed: the apparatus/operator/
maintenance responses surface related-entity names through **eager-loaded
relationships** (`apparatus_type`, `status_record`, `evoc_level`,
`maintenance_type`), which are populated, not blank scalar fields.

---

## Pass 1 (2026-08-06)

**Prefix:** `AP2` · **Iteration:** B2 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/apparatus.py` (2,980 L, 83 endpoints),
`app/services/apparatus_service.py` (2,395 L), `evoc_level_service.py`
**Frontend:** `modules/apparatus`
**Prior audit:** `docs/module-audit/apparatus.md` (iteration 2) — one open
finding, AP-1 (create paths don't validate the referenced parent is in-org).

---

## Scope

Tier B: started from AP-1 and the CROSS-CUTTING note that the _operator_ create
path was later fixed in the zero-trust pass, and checked whether the rest of
AP-1 was closed. The security pass had already established auth coverage (83/83),
tenant isolation on every by-id query, and no SQL injection — re-verified, not
re-derived. This 5.4k-line module was reviewed at the create-path and
invariant level, not line-by-line.

## Findings

### AP-1 — LOW→MED — Create paths don't validate `apparatus_id` is in-org — ✅ FIXED

**What the prior audit flagged:** `create_photo`, `create_document`, and the
maintenance creates stored a client-supplied `apparatus_id` without checking it
belonged to the caller's org.

**Current state, verified path by path:**

- `create_maintenance_record` — **already validated** (org-scoped
  `get_apparatus(apparatus_id, org)` at line 1069, and the maintenance-type id
  too). Not a gap.
- `create_maintenance_type` — **n/a**: it's an org-level config row with no
  apparatus FK.
- `create_operator` — **already fixed** in the zero-trust pass (validates
  apparatus_id / user_id / evoc_level_id via `assert_in_org`; the note there
  explains a foreign `user_id` would leak that user's PII through
  `list_operators`' eager-loaded relationship).
- `create_photo` / `create_document` — **still open.** Both took the
  `apparatus_id` from the `/{apparatus_id}/photos|documents` path and stored the
  row with no check, so a `POST` to `/{a_foreign_apparatus_id}/photos` created a
  photo/document row org-stamped to the caller but pointing at another org's
  apparatus.

**Impact:** consistent with the AP-1 rating — not a cross-tenant _disclosure_
(the child is org-scoped and `list_*` filters on both `apparatus_id` and org, so
the foreign-pointed row is an orphan), but a data-integrity gap: a photo or
document attached to an apparatus id that isn't the org's. LOW→MED because
apparatus documents can be inspection/compliance records.

**Fix:** `create_photo` and `create_document` now call
`assert_in_org(db, Apparatus, apparatus_id, org)` — the same helper and pattern
`create_operator` uses — and their endpoints gained the `ValueError → 400`
conversion they were missing (via `safe_error_detail`). With operator and
maintenance already covered, **AP-1 is now closed across every create path.**
Behavior is verified through `test_org_scoping.py`, which covers
`assert_in_org`'s fail-closed-on-foreign-row contract (7 tests).

### AP-2 — NIT — `== True` with a `# noqa: E712` — ✅ FIXED

The prior audit's one nit: `create_photo`'s primary-photo query used
`is_primary == True  # noqa: E712`. Swapped to `.is_(True)`, removing the noqa.
No behavior change.

## Verified good ✅ (re-confirmed from the security pass)

- **Auth:** all 83 endpoints carry an auth dependency.
- **Tenant isolation:** by-id getters filter `organization_id`; sub-resources
  (photos, documents, maintenance, EVOC, operators) each carry their own
  `organization_id` and are queried with `apparatus_id AND organization_id`, so
  a child-resource id can't be used for IDOR.
- **No SQL injection**; no PK-bypass (`db.get`/`filter_by(id=)`) patterns.
- The XC-1 create-FK gap is now closed for this module — one of the two that
  seeded the CROSS-CUTTING pattern (with medical-screening) is fully resolved.

## Duplication

None material. The four create paths now all reach for the same `assert_in_org`
helper rather than each re-implementing an org check — which is exactly the
consolidation the cross-cutting note called for.

## Dead code

None. No TODO/FIXME markers. The prior audit's note that vulture flags apparatus
route functions as "unused" remains a false positive (they're decorator-referenced
routes).

## Documentation

`docs/module-audit/apparatus.md` AP-1 is now resolved; recorded there and here.
Service docstrings remain terse ("Create photo") but accurate — not worth
churn.

## Future development

1. **No apparatus-service integration tests.** There is no `test_apparatus*.py`;
   the create-path org-scoping now rests on `assert_in_org`'s own unit tests plus
   manual reading. An integration test exercising `create_photo` against a
   foreign apparatus id would lock the wiring once MySQL is in CI.
2. **83 endpoints, ~5.4k lines, reviewed at the invariant level** across two
   passes — a future deep read of the maintenance-scheduling and EVOC-level
   business logic (not just its tenant isolation) would be the next depth
   increment, likely as its own focused iteration rather than a rotation tick.

## Completion gate

| Check                | Result                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                                                            |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                             |
| `black --check`      | ✅ 503 files unchanged                                                                                                                                                      |
| `eslint`             | ✅ clean                                                                                                                                                                    |
| backend tests        | ✅ **2517 passed, 0 failed**; `test_org_scoping.py` (the coverage backing this fix) 7/7. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |

</content>
