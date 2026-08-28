# Security Review 14 — Equipment Check & Shift Completion

**Prefix:** `EC` · **Iteration:** 14 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-28 (pass 2) · **PR:** [#1842](https://github.com/thegspiro/the-logbook/pull/1842)
(pass 1)

**Backend:** `api/v1/endpoints/equipment_check.py` (47 routes),
`api/v1/endpoints/shift_completion.py` (21 routes),
`services/equipment_check_service.py` (~3,200 L),
`services/shift_completion_service.py`
**Frontend:** in-app (no dedicated module directory)
**Migrations:** none this iteration (no schema change)

---

## Pass 2 (2026-08-28) — zero diff since pass 1's merge; re-verified, no new findings

**Diff scope.** Pass 1 merged as `2a7e47ee` (PR #1842). `git diff --stat
2a7e47ee..origin/main` for all six declared backend files (`equipment_check.py`,
`shift_completion.py`, `equipment_check_service.py`,
`shift_completion_service.py`, `equipment_check_pdf.py`, `models/apparatus.py`)
returned **no output — byte-identical**. No migration since pass 1 touches an
equipment-check/shift-completion/deployed-lot table (`git log
2a7e47ee..origin/main -- backend/alembic/versions/` lists 19 new migration
files; none references `equipment_check`, `shift_completion`,
`check_template`, or `deployed_lot`). A broad `grep` across `frontend/src` for
every file mentioning `equipment-check`/`equipment_check`/`shift-completion`/
`shift_completion` found 41 hits; diffing those specific files since `2a7e47ee`
turned up ten with changes, all incidental substring matches from unrelated
rotation features landing in the same window — `NotificationCard.tsx` (a
generic CTA-label addition + an unrelated mark-read-await fix),
`SideNavigation.tsx`/`TopNavigation.tsx` (nav-only diffs not touching the
`equipment_check.*` permission strings they reference), `training.ts`/
`testingRegistry.ts` (a new `grants_qualification` field and a new testing
module, feature 19's territory), `eventServices.ts` (inventory type additions,
feature 11's territory), `mobile-route-inventory.ts` (route-list entries,
unchanged paths), and `apiCache.ts`/`apiCache.test.ts` (three new
`UNCACHEABLE_PREFIXES` entries for other features' endpoints — the
`/equipment-checks` entry EC-14 added in pass 1 is present, unmodified, at its
original line). `modules/scheduling/services/api.ts` changed (an unrelated
`getMyAttendance` 404-handling fix, FE2-34-8 from the frontend-shared pass),
but touches scheduling's shift-attendance polling, not this feature's
equipment-check/shift-completion surface. **Net: nothing in this feature's
actual code changed.**

**Given zero diff, re-verified every pass-1 fix by reading the current code
directly** (not by re-citing the doc), plus a fresh AST-based route/permission
enumeration, rather than treating "unchanged" as "still correct by
assumption":

- **Route/permission enumeration.** A Python AST walk of both endpoint files'
  `@router.<verb>` decorators (walking `Depends(...)` in each function
  signature, plus router-level `dependencies=` lists) reproduced **47/47** and
  **21/21** routes with the exact permission strings pass 1's route inventory
  table lists — no drift, no new route, no route that lost its dependency.
- **EC-1** (`_update_apparatus_deficiency`, `app/services/
equipment_check_service.py:1072`) — still filters
  `Apparatus.id == apparatus_id, Apparatus.organization_id ==
organization_id`; read the function body directly.
- **EC-2 / EC2-4** (`item_names` lookup, `equipment_check_service.py:2265`) —
  still filters `InventoryItem.organization_id == organization_id`, with the
  original EC2-4 explanatory comment intact.
- **EC-6** (`create_report`'s `shift_id`-absent branch,
  `shift_completion_service.py:294`) — still validates `trainee_id` is a user
  in the caller's org before creating the report.
- **EC-9** (`get_report`, `shift_completion_service.py:1145`) — still takes an
  optional `organization_id` and filters on it; all four call sites
  (`get_shift_report` endpoint at `shift_completion.py:513`,
  `acknowledge_report`/`update_report`/`review_report` in the service) still
  pass the caller's org. Traced `acknowledge_report`
  (`shift_completion_service.py:1439`) and `review_report`
  (`:1483`, reached from both the single and batch-review endpoints) end to
  end — both resolve their target exclusively through the org-scoped
  `get_report`, so `POST /shift-completion/batch-review`'s client-supplied
  `report_ids` list cannot touch a foreign-org report.
- **EC-10** (`complete_incomplete_check`,
  `equipment_check_service.py:1742`) — still re-applies the auto-fail rule
  before computing aggregate counts.
- **EC-12** (`report_item_used`,
  `equipment_check_service.py:2662`) — still locks the item
  (`for_update=True`) and takes a locking read on the item's
  `CheckItemDeployedLot` rows before the consume, in the same lock order
  `swap_item_lot` uses.
- **EC-13** (`update_deployed_lot`,
  `equipment_check_service.py:2839`) — still raises `PermissionError` when a
  submit-only caller (`allow_metadata_change=False`) requests a quantity
  above the lot's stored value; `swap_item_lot`'s `enforce_submitter_limits`
  (`:3203`–`3242`) still reads that now-protected `quantity` as its cap.
- **EC-14** (`apiCache.ts`'s `/equipment-checks` prefix) — present, unmodified.
- **EC-11** (compliance metrics) — still hardcoded
  (`equipment_check_service.py:4213,4280`); confirmed still an unbuilt
  feature, not a regression.
- **`get_item_deployments` vs. its sibling's permission gate** — still
  documented as the carried-forward, deliberately-unadjudicated discrepancy
  in `tests/test_permission_gate_composition.py:79-80` and
  `docs/KNOWN_LIMITATIONS.md`. Unchanged; not re-flagged as new.

**Additional checks this pass** (not previously written up as explicit
verified-good items):

- **LIKE escaping** — the module's one `.ilike()` call
  (`equipment_check_service.py:4330`, the failed-item-search filter) still
  passes `like_pattern(item_name)` with `escape=LIKE_ESCAPE_CHAR`. No raw SQL
  (`text(...)`) anywhere in either service file.
- **CSV export** — `export_csv` (`equipment_check.py:1286-1291`) uses
  `SafeCsvWriter`, not a bare `csv.writer`.
- **`SET NULL` nullability** — every `ondelete="SET NULL"` FK in
  `models/apparatus.py` is paired with `nullable=True` (spot-checked
  directly; also covered by the whole-app `test_set_null_fks_are_nullable`
  guard test).
- **JSON columns** (`crew_positions`, `custom_field_values`,
  `assigned_positions`, `item_ids`, `changes`) — no shallow-copy-then-reassign
  mutation pattern found; every write is either a fresh assignment or a
  read-only access, not an in-place nested mutation of a value already
  attached to a tracked instance.
- **Frontend equipment-check pages** (`EquipmentCheckForm.tsx`,
  `EquipmentCheckTemplateBuilder.tsx`, `MyChecklistsPage.tsx`,
  `CheckLogPage.tsx`, `ShiftCheckInPage.tsx`, `ShiftDetailPanel.tsx`,
  `ApparatusInventoryPage.tsx`, `FleetBoardPage.tsx`,
  `ApparatusDetailPage.tsx`, `EquipmentChecksTab.tsx` — ~12,400 L combined):
  grepped rather than read line-by-line (partial-scope, noted rather than
  silently assumed) for `window.confirm`/`alert`/`prompt`
  (CLAUDE.md Pitfall #16), `dangerouslySetInnerHTML`, banned
  `.toLocale*` date methods, and direct `fetch()` bypassing the API client —
  **zero hits for all four**. `EquipmentCheckForm.tsx`'s offline draft
  (`localStorage` key `equipment-check-draft-{shiftId}-{templateId}`, saving
  in-progress check results/notes/seals) is swept by
  `shiftReportDrafts.ts::clearAllDrafts()`'s `EQUIPMENT_CHECK_DRAFT_KEY_PREFIX`
  match on logout, which `purgeLocalMemberData()` runs from `authStore.ts` —
  this is the pre-existing FE-6/FE-7 mechanism (feature 34's pass 2), traced
  directly here rather than assumed, and it correctly covers this feature's
  draft key. Not a new fix; recorded because it was never previously verified
  as covering this specific key prefix.
- **Batch endpoints re-checked for tenant isolation on client-supplied ids**
  (`batch_create_shift_reports`'s `crew_member_ids`,
  `batch_review_reports`'s `report_ids`): the review-batch path resolves
  exclusively through the org-scoped `get_report` (above). The create-batch
  path's `shift_id`-present branch never validates `trainee_id` directly, but
  requires a pre-existing `ShiftAssignment`/`ShiftAttendance` row linking
  `trainee_id` to the already org-validated `shift_id` — those link rows are
  created only through the (separately-reviewed, feature 15's) scheduling
  module's own org-scoped assignment flow, so a foreign `trainee_id` cannot
  satisfy the check. This is the same reasoning EC-6's fix already recorded
  for this exact branch ("the `shift_id`-present path already tied the
  trainee via attendance/assignment") — re-verified by reading the branch
  directly rather than re-citing it, not a new finding.

**No findings.** No code changes this pass.

## Revision note

First drafted as "no defect found, no code changes" after a full read of the
nine new supply/swap endpoints. **A Codex review of that draft PR caught
three real issues** the draft missed — a capacity-check race, a submitter
permission bypass reachable through a second entry point, and a caching gap
against newly-added PII-carrying endpoints — plus confirmed one already-known,
deliberately-unadjudicated item (the `get_item_deployments` permission-gate
discrepancy) needed to be written down rather than silently re-verified as
fine. All three real findings verified and fixed below. Same shape as
FAC-12's draft-vs-final split: an initial "clean" pass that under-scrutinized
a genuinely large new surface, corrected by review before merge.

## Scope

This is the most heavily audited module by finding-count in the whole
rotation: module-audit iteration 7 found and fixed 11 issues including a
HIGH-severity cross-tenant apparatus write (EC-1), then 4 app-review Tier B
passes closed a MED read-leak (EC2-4) app-review itself found on
re-verification. Two items remain open, both non-security by design: EC-11
(compliance-cadence metrics hardcoded to 0 — an unbuilt feature) and the EC-7
residual (whether submit endpoints should require `equipment_check.submit`
— an owner permission-design call already answered once, not a defect).

Re-verified all 11 fixes from the module audit plus EC2-4/EC2-3/EC2-5 from
app-review — all intact.

**Growth since the last full read:** `equipment_check.py` grew from 34 to 47
routes (+13); `shift_completion.py` is unchanged at 21. The growth is a
whole feature area — supply-officer stock consumption/swap/recount against
deployed lots (`report_item_used`, `get_item_deployed_lots`,
`update_deployed_lot`, `set_item_quantity`, `clear_item_restock`,
`get_item_deployments`, `swap_item_lot`, plus the read-only
`get_supply_expiring_items`/`get_apparatus_inventory`) — added across
several commits that each carried their own Codex review round during
development. Read all nine new endpoints and their service methods in full
rather than sampling, since this is exactly the shape of surface
(client-supplied ids reaching inventory-quantity writes) this module's own
history (EC-1/EC-2/EC-4) shows is where its defects have lived. The draft
read every method for org-scoping and permission gating on the happy path
and found none of that broken (correct, see Verified good below); it did not
model concurrent callers against `report_item_used`, did not trace how
`update_deployed_lot`'s quantity field feeds `swap_item_lot`'s submitter cap,
and did not check the new endpoints against the frontend's response cache —
which is where all three real findings were.

## Route inventory

Auth coverage reconciled exactly: `equipment_check.py` is 47/47 authenticated
— 6 bare-`get_current_user` routes (`get_my_checklists`,
`get_my_checklist_history` self-scoped; `get_check_log` self-scoped for
non-privileged callers, broadened for `equipment_check.view` holders per its
own docstring; `upload_check_item_photos` crew-work, org-scoped in the
service; `get_template_changelog` — gated via a router-level
`dependencies=[Depends(require_permission("equipment_check.manage"))]`
rather than inline on `current_user`, which is why a naive grep for the
inline pattern undercounts by exactly this route; `download_csv_sample` — a
static sample file, auth-only, no data). `shift_completion.py` is 21/21 — 4
bare routes (`my-reports`/`my-stats` self-scoped; `get_shift_report` is
org-scoped via `get_report(id, organization_id)` — the EC-9 fix, confirmed
still in place — and additionally requires the caller be the trainee, the
filing officer, or hold `training.manage`; `acknowledge_report` is
self-scoped to `trainee_id=current_user.id`).

### New supply/swap surface — read in full

- **`report_item_used`, `set_item_quantity`, `clear_item_restock`,
  `get_item_deployed_lots`, `update_deployed_lot`** all resolve
  `template_item_id` through `_get_item_with_template`, a shared helper that
  joins `CheckTemplateItem → CheckTemplateCompartment → EquipmentCheckTemplate`
  and filters `EquipmentCheckTemplate.organization_id == organization_id` —
  a foreign id resolves to nothing, matching the fix pattern EC-2 already
  established for this exact join. `update_deployed_lot` additionally
  distinguishes "submitter changed only the count" from "submitter tried to
  rewrite the lot number/date," raising `PermissionError` only for the
  latter — read the logic and confirmed it checks against the row's stored
  values, not merely which keys were sent, so a quantity-only save by a
  submit-only crew member isn't wrongly blocked. **`report_item_used` had a
  read-modify-write race — see EC-12.** **A submit-only caller could use
  `update_deployed_lot`'s quantity field to bypass `swap_item_lot`'s
  submitter cap — see EC-13.**
- **`swap_item_lot`** (the highest-risk of the nine — decrements
  `InventoryLot.quantity`) locks `_get_item_with_template(...,
for_update=True)`, then separately locks the position's
  `CheckItemDeployedLot` rows, then locks the target `InventoryLot` row — in
  that specific order, with a code comment explaining why the order is fixed
  (both this swap's own read-modify-write on deployed lots and a second
  concurrent swap's would otherwise race, and a consistent lock order across
  callers avoids a deadlock between two swaps drawing on each other's lots).
  This is the Pitfall #27 shape applied correctly to three separate rows,
  not just the count. `enforce_submitter_limits` caps how much a
  submit-only caller may draw (only enough to cover an actual shortfall or
  replace actually-expired stock), computed from the row's live state, not
  client-supplied — but the figure it trusts as that cap was itself
  attacker-influenceable through a second endpoint (EC-13).
  `allow_first_link=False` for submit-only callers blocks the one operation
  that's a standing configuration decision (binding a checklist position to
  a catalog item for the first time) rather than a stock movement.
- **`get_supply_expiring_items`/`get_apparatus_inventory`** (read-only) both
  pass `organization_id` straight through to their service methods; spot-read
  both service bodies — org-scoped throughout, no client-supplied ids beyond
  the org-implicit apparatus id (`get_apparatus_inventory` 404s cleanly on a
  foreign/missing apparatus id rather than resolving it unscoped). Both
  responses carry reporter names, free-text notes and deployed-lot detail —
  see EC-14 (the frontend cache exclusion, not a backend defect).
- **`get_item_deployments`** — reverse lookup (inventory item → checklists
  carrying it) — org-scoped on the `inventory_item_id` input. Gated on
  `inventory.view`, while its sibling `update_deployed_lot`-adjacent surface
  gates on `inventory.manage` for the equivalent write. This is a **carried-
  forward, deliberately-unadjudicated** discrepancy, not a new finding —
  `tests/test_permission_gate_composition.py`'s `ALLOWED` dict already
  documents it as "unadjudicated: inventory.view here vs inventory.manage on
  its sibling," reasoning that tightening a permission gate is a behavior
  change and a product call, not a test's (or a security review's) to make
  unilaterally. Left as-is; mirrored into `docs/KNOWN_LIMITATIONS.md` so the
  next reviewer does not need to rediscover it either.

## Verified good ✅

- **Auth coverage 47/47 + 21/21**, enumerated and reconciled above (one
  route's gate lives in the decorator's `dependencies=` list rather than
  inline — accounted for, not a gap).
- **EC-1 (HIGH) still fixed** — `_update_apparatus_deficiency` still
  org-scoped; `submit_standalone_check`'s `apparatus_id` still validated
  in-org before use.
- **EC-2/EC2-3/EC2-4 (MED, the template-item/inventory-item read-leak +
  write-back class) still fixed** — `_load_template_items_map` and the
  `item_names` lookup both still filter on the organization-scoped join;
  `_validate_item_fks` still present at the write paths.
- **EC-3 (submit-permission gate on the lot swap) still intact**, and the
  new `swap_item_lot`/`update_deployed_lot` extend the same
  narrowed-not-excluded pattern rather than reopening it.
- **EC-4 (clone_template apparatus XC-3) still fixed.**
- **EC-9 (`get_report` org-scoping) still fixed**, confirmed at both
  remaining direct callers.
- **EC-10 (auto-fail rule applied consistently between initial submit and
  completion) still fixed.**
- **Org-scoping and permission gates on all nine new endpoints' happy
  paths** — the draft's read of this was correct; the gaps were in
  concurrency and in a cap computed from a value another endpoint could
  inflate, not in the gates themselves.
- **No SQL injection**, no PK-bypass patterns in either file.

## Findings

### EC-12 — MED (correctness/availability) — `report_item_used` was an unlocked read-modify-write on deployed-lot quantities — ✅ FIXED

**What:** `report_item_used` reads each deployed lot's `quantity`, decrements
it by the amount used, and writes it back — with no lock held across the
read and the write. Two crews reporting use of the same item at the same
time (a common shape: a Return-to-Service and a routine daily check both
touching the same rig) both read the same starting quantity and both
decrement it independently.
**Where:** `app/services/equipment_check_service.py:2662`
(`report_item_used`).
**Failure scenario:** an item has 4 units deployed. Two `POST
.../report-used` calls each reporting `quantity_used=1` arrive close
together. Both read `quantity=4`, both compute `4-1=3`, both write `3`. The
truck now shows 3 on hand and `restock_needed` set once, when two units were
actually used and the true count is 2 — an availability gap: the
next crew trusts a stock figure that overstates what is actually aboard.
**Impact:** correctness/availability, not data disclosure — same class as
CLAUDE.md Pitfall #27, applied here to a decrement instead of a capacity
cap.
**Fix:** lock the item row (`_get_item_with_template(...,
for_update=True)`, mirroring the parameter `swap_item_lot` already used) and
additionally take a locking read on the item's `CheckItemDeployedLot` rows
before the read-modify-write, in the same lock order `swap_item_lot`
already establishes for this item (position row, then its deployed lots) so
the two operations cannot deadlock against each other. Guard tests:
`test_equipment_check_lot_replacement.py::TestReportItemUsedIsLocked`
(source-inspection: both locks present, and the deployed-lots lock precedes
the consume call).

### EC-13 — MED (authorization bypass) — a submit-only caller could inflate a deployed lot's recorded quantity to raise `swap_item_lot`'s replacement cap — ✅ FIXED

**What:** `swap_item_lot`'s `enforce_submitter_limits` trusts the _target_
deployed lot's stored `quantity` as the ceiling on how much a submit-only
caller may draw when replacing it — by design, so a submitter can replace
exactly what has expired and no more. `update_deployed_lot`, called with
`allow_metadata_change=False` for a submit-only caller, blocked that caller
from rewriting the lot number or expiration date on a nonzero-quantity save,
but placed **no equivalent restriction on raising the quantity itself** — a
submitter could `PATCH` the deployed lot's `quantity` upward first, then
call `swap_item_lot` against the now-inflated figure.
**Where:** `app/services/equipment_check_service.py:2788`
(`update_deployed_lot`), consumed with `allow_metadata_change=False` by
`api/v1/endpoints/equipment_check.py`'s submit-only permission branch;
exploited via `swap_item_lot`'s `enforce_submitter_limits` at line ~3229.
**Failure scenario:** a deployed lot legitimately holds 1 expired unit. A
submit-only crew member calls `update_deployed_lot(quantity=6)` — no
metadata changed, so the existing check passed it — then calls
`swap_item_lot` naming that lot as the replacement target. The submitter cap
now reads 6 instead of 1, letting a submit-only caller draw five units of
fresh stock they were never entitled to authorize, self-escalating a
capacity a `.manage` holder was supposed to set.
**Impact:** authorization bypass — a submit-only permission effectively
grants the manage-level authority to set the submitter's own draw limit.
No data disclosure.
**Fix:** `update_deployed_lot` now raises `PermissionError` when
`allow_metadata_change=False` and the requested `quantity` exceeds the lot's
current stored quantity — a decrease (the ordinary "we used one" or "we
found fewer than the record said" correction) and zero-quantity removal
remain unrestricted, since neither can inflate a future cap. Manage-level
callers (`allow_metadata_change=True`) are unaffected. Guard tests:
`test_equipment_check_expiration_sync.py::TestUpdateDeployedLot::test_submitter_cannot_inflate_a_deployed_lots_quantity`,
`::test_submitter_can_still_decrease_a_deployed_lots_quantity`,
`::test_manager_can_still_increase_a_deployed_lots_quantity`.

### EC-14 — LOW (data exposure) — the new supply endpoints were never added to the frontend's cache exclusion list — ✅ FIXED

**What:** `frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES` predates
this iteration's nine new endpoints. `report_item_used`'s restock note is
free text a crew member writes (PII-adjacent by content, not by field name);
`get_item_deployed_lots`/`get_apparatus_inventory`/`get_supply_expiring_items`
all return reporter names alongside deployed-lot detail. None of
`/equipment-checks/*` was covered by any existing prefix, so a response was
eligible for the same 30s-fresh/90s-stale in-memory cache as any ordinary
GET.
**Where:** `frontend/src/utils/apiCache.ts` (`UNCACHEABLE_PREFIXES`).
**Failure scenario:** matches the rationale already documented for every
other entry in this list — a caller whose `equipment_check`/`inventory`
permission is revoked mid-session (a role change, an account lockout) keeps
reading a cached reporter name or restock note out of the in-memory cache
for up to 90 seconds after the revocation, rather than the request being
re-authorized against current permissions.
**Impact:** data exposure, bounded to the existing 90s stale window and to a
caller who already held a valid session — same class and severity as the
`/facilities/occupants` and `/admin-hours/` entries already in this list.
**Fix:** added `/equipment-checks` to `UNCACHEABLE_PREFIXES`. Guard test:
`apiCache.test.ts` — `'returns false for equipment-check reporter/restock
PII (EC-14)'`, asserting `isCacheable()` is `false` for the inventory,
log, deployed-lots, and expiring-items sub-paths.

## Schema & migration notes

No schema changes this iteration. No `SET NULL` nullability issues found in
either file's models.

**Unrelated CI incident, not this PR's defect:** `main` forked into two
Alembic heads mid-review (PR #1840 and PR #1841 each merged independently
from the same prior head). Fixed by merging `origin/main` and adding a no-op
merge migration (`b272a5d5535c`) resolving the two heads — see the PR
comment and `PROGRESS.md`'s log for detail; not part of this module's
findings.

## Guard tests added

- `test_equipment_check_lot_replacement.py::TestReportItemUsedIsLocked` (2
  tests) — EC-12.
- `test_equipment_check_expiration_sync.py::TestUpdateDeployedLot` (3 new
  tests) — EC-13.
- `apiCache.test.ts` (1 new test, 4 assertions) — EC-14.

## Completion gate (pass 1)

| Check                                                                                                | Result                                                          |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)                                                        | ✅ 0 violations                                                 |
| `black --check app/ tests/ alembic/` (changed files)                                                 | ✅ clean                                                        |
| `isort --check-only app/ tests/ alembic/` (changed files)                                            | ✅ clean                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                    | ✅ single head                                                  |
| `pytest tests/test_equipment_check_lot_replacement.py tests/test_equipment_check_expiration_sync.py` | ✅ 121 passed                                                   |
| `pytest tests/` (full backend suite)                                                                 | ✅ 8542 passed, 22 skipped (pre-existing Docker/no-MySQL skips) |
| `tsc --noEmit`                                                                                       | ✅ clean                                                        |
| `eslint .`                                                                                           | ✅ 0 errors, 5 pre-existing warnings (unrelated)                |
| `vitest run src/utils/apiCache.test.ts`                                                              | ✅ 81 passed                                                    |

## Completion gate (pass 2)

No code changes this pass, so the full gate was still run against current
`main` to confirm nothing regressed underneath this feature since pass 1.

| Check                                                                                | Result                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                        | ✅ 0 violations                                                                                             |
| `black --check app/ tests/ alembic/`                                                 | ✅ 1323 files unchanged                                                                                     |
| `isort --check-only app/ tests/ alembic/` (isort 8.0.1, CI's pin, already installed) | ✅ clean                                                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                    | ✅ 389 revisions, single head `e5f6a7b8c9d0`                                                                |
| `pytest tests/ -q -k "equipment_check or shift_completion"`                          | ✅ 296 passed, 1 skipped (pre-existing, `pywebpush` not installed)                                          |
| `pytest tests/` (full backend suite)                                                 | ✅ 9179 passed, 22 skipped (pre-existing Docker/no-MySQL skips), 0 failed                                   |
| `npx tsc --noEmit`                                                                   | ✅ 0 errors                                                                                                 |
| `npx eslint .`                                                                       | ✅ 0 errors, 10 pre-existing warnings (same set as SEC-00 pass 2 / AP-13 pass 2, unrelated to this feature) |
