# Security Review 14 — Equipment Check & Shift Completion

**Prefix:** `EC` · **Iteration:** 14 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-28 (pass 2), 2026-09-03 (pass 3) · **PR:** [#1842](https://github.com/thegspiro/the-logbook/pull/1842)
(pass 1)

**Backend:** `api/v1/endpoints/equipment_check.py` (47 routes),
`api/v1/endpoints/shift_completion.py` (21 routes),
`services/equipment_check_service.py` (~3,200 L),
`services/shift_completion_service.py`
**Frontend:** in-app (no dedicated module directory)
**Migrations:** none this iteration (no schema change)

---

## Pass 3 (2026-09-03) — module moved to Inventory, 65 new routes across five commits; re-audited, no new findings

**Baseline note.** Pass 2 merged as `d1f43285` (PR #1963), but that commit is
no longer reachable in this worktree's shallow history (`git cat-file -t
d1f43285` fails) — five more months of `main` sit between it and this pass,
including the 2026-08-31 move documented at the top of
`docs/module-audit/equipment-check.md`: equipment checklists are now owned by
the **Inventory** module, not Scheduling. The router's module gate is
`inventory`, every permission string that used to read `equipment_check.*`
now reads `inventory.check_view` / `.check_manage` / `.check_submit`, and the
frontend moved to `frontend/src/modules/inventory/`. The API paths
(`/equipment-checks/...`) and file names (`equipment_check.py`,
`equipment_check_service.py`) did not move. Because a clean diff against the
pass-2 baseline isn't available, this pass re-derives the route inventory
from current code (AST-equivalent read of every `@router.` decorator) and
reads every new service method in full, rather than trusting the "zero diff"
shortcut pass 2 used.

**Growth since pass 1's table:** `equipment_check.py` grew from 47 to **57**
routes (+10 new: `suggest_inventory_matches`, `link_inventory_items`,
`replace_compartments`, `clone_compartment`, `reorder_compartments`,
`add_items_bulk`, `delete_items_bulk`, `reorder_items`,
`get_last_check_seals`, plus the permission rename touching every existing
one); `shift_completion.py` is unchanged at 21 routes (same line count, 707,
as pass 1/2). `equipment_check_service.py` grew from ~3,200 L to 5,368 L;
`shift_completion_service.py` grew from ~1,477 L to 1,751 L (method list
unchanged from pass 2's — the growth is inside existing methods, principally
`_update_requirement_progress` and the call/hours auto-population helpers,
already covered by feature 15's `ShiftCall.responding_members` XC-1 fix
pass 2 reviewed from this feature's reader side).

### Route/permission enumeration (both files, full)

`equipment_check.py` — 57/57 authenticated. Every write route
(`create_template`, `update_template`, `delete_template`, `clone_template`,
`suggest_inventory_matches`, `link_inventory_items`, `add_compartment`,
`update_compartment`, `delete_compartment`, `replace_compartments`,
`clone_compartment`, `reorder_compartments`, `add_item`, `add_items_bulk`,
`update_item`, `delete_item`, `delete_items_bulk`, `reorder_items`) gates on
`inventory.check_manage` alone. `get_shift_checklists`, `get_shift_checks`,
`get_check`, `get_item_history`, `get_last_check_results`,
`get_last_check_seals` gate on `inventory.check_view OR
inventory.check_submit` (EC-7's fix, carried through the rename unchanged).
`submit_check`, `submit_standalone_check`, `complete_incomplete_check` gate
on `inventory.check_submit OR inventory.check_manage` (EC-7 residual,
unchanged — still the owner's intra-org call, not reopened). `get_fleet_
readiness`, `get_compliance_report`, `get_failure_log`, `get_item_trends`,
`export_csv`, `export_pdf` gate on `inventory.check_view` alone (officer-only
reporting surface). `get_template_changelog` gates via a router-level
`dependencies=[Depends(require_permission("inventory.check_manage"))]`
(unchanged from pass 1's noted exception to the inline-`Depends` scan
pattern). `get_my_checklists`, `get_my_checklist_history`, `get_check_log`,
`upload_check_item_photos`, `download_csv_sample` are bare
`get_current_user` (self-scoped or, for `get_check_log`, broadened in-service
for `inventory.check_view` holders — unchanged from pass 1). The nine
supply/swap endpoints (`get_supply_expiring_items` through `swap_item_lot`)
keep their pass-1 gates exactly, permission strings renamed only:
`inventory.check_view OR inventory.manage` (`get_supply_expiring_items`);
`inventory.check_view OR inventory.check_submit OR inventory.view`
(`get_apparatus_inventory`, `get_item_deployed_lots`); `inventory.check_
submit OR inventory.check_manage OR inventory.manage` (`report_item_used`,
`update_deployed_lot`, `set_item_quantity`, `swap_item_lot`); `inventory.
check_manage OR inventory.manage` (`clear_item_restock`); `inventory.check_
view OR inventory.view` (`get_item_deployments` — the deliberately-
unadjudicated discrepancy against `update_deployed_lot`'s tighter gate,
carried forward, see below).

`shift_completion.py` — 21/21 authenticated, unchanged from pass 1/2's
enumeration: `training.manage` on every officer-facing endpoint, bare
`get_current_user` on the four self-scoped ones (`my-reports`, `my-stats`,
`get_shift_report` — additionally scoped in-service to trainee/officer/
`training.manage` — and `acknowledge_report`, self-scoped to
`trainee_id=current_user.id`).

### New surface read in full (not previously audited)

- **Catalog linking** (`suggest_inventory_matches`, `link_inventory_items`,
  `get_link_coverage`, `_linkable_items`, `_get_template_row`,
  `equipment_check_service.py:4101-4308`) — both sides of the read (template)
  and write (link) path resolve through `_get_template_row`/`_linkable_items`,
  which join `CheckTemplateItem → CheckTemplateCompartment →
EquipmentCheckTemplate` filtered on `organization_id`; `link_inventory_
items` additionally validates every client-supplied `inventory_item_id` in
  the links payload against `InventoryItem.organization_id == organization_id`
  before writing (the XC-1 shape EC2-3/EC2-4 established, applied to a new
  write path). `suggest_inventory_matches` is read-only (fuzzy-matches
  against the caller's own `InventoryItem` rows, writes nothing).
- **Sealed-container support** (`_create_check_seals`, `_sealed_compartment_
ids`, `get_last_check_seals`, lines 1557-1629, 2690-2749) — `template_id`
  reaches `_sealed_compartment_ids` (which itself takes no
  `organization_id`) only after being validated against the caller's org at
  each of its three call sites: `submit_check` resolves it through
  `_resolve_templates`/`selected_template` before ever reaching the seal
  helpers (traced directly, `equipment_check_service.py:1915-1934`),
  `submit_standalone_check` and `complete_incomplete_check` resolve their
  template the same way earlier in each method. `get_last_check_seals`
  (the read endpoint) takes `organization_id` directly and passes it through.
  Migration `20260823_1100_d5b207e4f139` adds `is_sealed` (`NOT NULL`,
  server default `0`) to `check_template_compartments` and creates
  `shift_equipment_check_seals` with `template_compartment_id` as
  `ondelete="SET NULL"` **and** `nullable=True` — Pitfall #2 checked and
  clean.
- **Bulk item add/delete with idempotency** (`add_items_bulk`,
  `_replay_bulk_request`, `delete_items_bulk`, lines 999-1303) — both
  resolve `compartment_id` through the org-scoped `_get_compartment` before
  doing anything else; `add_items_bulk` runs `_validate_item_fks` (in-org
  `inventory_item_id`/`equipment_id`) on every item in the batch before the
  first write; both take a locking read on the parent compartment
  (`with_for_update()`) to serialize append-position allocation / retry
  detection against a concurrent batch on the same compartment, matching
  Pitfall #27's shape (the parent is locked, and the read that decides the
  outcome — the ledger lookup, the max-sort-order read — is itself a
  locking read, not a plain `SELECT` against a stale REPEATABLE READ
  snapshot). The idempotency ledgers (`EquipmentCheckBulkRequest`/
  `EquipmentCheckBulkDeleteRequest`) are keyed
  `(organization_id, compartment_id, idempotency_key)` unique, with a
  payload-hash check on replay so a reused key against a different payload
  is rejected rather than silently returning the wrong batch. Both new
  tables' migrations (`20260821_8a4f2d1c9b30`,
  `20260829_1200_d4e8f1a2b3c4`) match their models exactly:
  `organization_id`/`compartment_id` both `ondelete="CASCADE"` and
  `nullable=False` — no Pitfall #2 exposure (cascade, not SET NULL).
- **`replace_compartments`, `clone_compartment`, `reorder_compartments`,
  `reorder_items`** (lines 762-949, 1283-1303) — `replace_compartments`
  validates every nested item's FKs before deleting the existing tree (fail
  before destroy, not after) and locks the doomed rows
  (`with_for_update()`) before deleting them; rejects a replacement entry
  that names a parent (the endpoint always sends a flat list, so this also
  closes off a route to the cross-template dangling-parent shape AP-14/AP-16
  guard against on the create/delete paths). `clone_compartment` resolves
  its source through the org-scoped `_get_compartment` and reuses the
  source's own `template_id`/`parent_compartment_id` — it cannot manufacture
  a cross-org or cross-template link because every field it writes is copied
  from an already-org-validated row, not client-supplied. `reorder_
compartments`/`reorder_items` mutate only entries found in the org-scoped
  parent's already-loaded in-memory collection (`template.compartments` /
  `compartment.items`); an id in `ordered_ids` that doesn't belong to the
  parent is silently skipped rather than rejected — a correctness quirk
  (a bogus id in the list has no effect and the response gives no error),
  not a tenant-isolation gap, since nothing outside the org-scoped
  collection can be reached or written through this path.

### Re-verified: every pass-1/2 fix intact at its current location

Read each fix directly rather than re-citing the doc, since line numbers
moved with the file's growth:

- **EC-1** (`_update_apparatus_deficiency`, `equipment_check_service.py:
1631-1660`) — still filters `Apparatus.id == apparatus_id,
Apparatus.organization_id == organization_id`.
- **EC-2/EC2-3/EC2-4** (`_validate_item_fks`, line 955; `item_names` lookup
  inside `get_my_checklists`) — `_validate_item_fks` still checked via
  `is_in_org` and is now also called from `add_items_bulk` and
  `replace_compartments`'s nested items (new call sites since pass 1, both
  confirmed present above).
- **EC-4** (`clone_template`'s apparatus XC-3, line 448) — still org-scopes
  the target apparatus lookup and raises `ValueError` on a foreign id.
- **EC-6** (`create_report`'s `shift_id`-absent branch,
  `shift_completion_service.py:294-310`) — still validates `trainee_id` is a
  user in the caller's org before creating the report.
- **EC-9** (`get_report`, `shift_completion_service.py:1145`) — still takes
  an optional `organization_id` and filters on it; `review_report`/
  `acknowledge_report`/`update_report` all still resolve through it.
- **EC-10** (`complete_incomplete_check` auto-fail rule) — still present.
- **EC-12** (`report_item_used` locking, line 3302-3320) — `_get_item_with_
template(..., for_update=True)` still present, still followed by a locking
  read on the item's deployed lots before the consume.
- **EC-13** (`update_deployed_lot`'s submitter-quantity-inflation guard,
  lines 3428-3479) — `if not allow_metadata_change and quantity >
target.quantity: raise PermissionError(...)` still present verbatim;
  `swap_item_lot`'s `enforce_submitter_limits` still reads that
  now-protected value as its cap.
- **EC-14** (`apiCache.ts`'s `/equipment-checks` prefix) — present,
  unmodified, at line 103.
- **EC-11** (compliance metrics) — still hardcoded to 0 in
  `get_compliance_report`; confirmed still an unbuilt feature (an
  expected-check-cadence model does not exist in the schema), not a
  regression.
- **`get_item_deployments` vs. `update_deployed_lot` permission-gate
  discrepancy** — still present exactly as `docs/KNOWN_LIMITATIONS.md`
  records it (`inventory.check_view OR inventory.view` vs. the metadata-
  change guard inside the tighter-gated sibling); still deliberately
  unadjudicated, not re-flagged as new.

### Additional checks this pass

- **LIKE escaping** — the module's one `.ilike()` call
  (`equipment_check_service.py:5069`, the failed-item-search filter) still
  passes `like_pattern(item_name)` with `escape=LIKE_ESCAPE_CHAR`.
- **CSV export** — `export_csv` (`equipment_check.py:1432-1437`) still uses
  `SafeCsvWriter`.
- **SMS allowlist (Pitfall #18)** — `grep` for `SMSService`/`SmsAlert`/
  `resolve_sms_recipients` in both service files returns 0 hits; the only
  notification paths are in-app `NotificationLog` rows and optional email
  (`_send_check_failure_notification`, `_send_notification`), both
  email-first per the module's existing design, no new SMS surface added.
- **`_send_check_failure_notification`'s recipient-email lookup**
  (`equipment_check_service.py:4788-4794`) — `select(User.email).where(
User.id.in_(recipient_ids), ...)` carries no explicit `organization_id`
  filter, but `recipient_ids` is built exclusively from two already-org-
  scoped sources earlier in the same method: the shift's own
  `shift_officer_id` (the shift was already fetched org-scoped by the
  caller) and a `user_positions` join explicitly filtered
  `Role.organization_id == organization_id`. Not exploitable — the same
  read-after-validate shape EC-8 already established as harmless elsewhere
  in this file — noted rather than silently passed over, not raised as a
  new finding.
- **Frontend module location and auth wiring** — the feature's frontend now
  lives under `frontend/src/modules/inventory/` (12 files: `pages/
EquipmentCheck*.tsx`, `pages/MyEquipmentPage.tsx`, `pages/Equipment
RequestsPage.tsx`, `pages/EquipmentKitsPage.tsx`, `components/
EquipmentCheckTemplateList.tsx`, `services/equipmentCheckApi.ts`, plus
  three `.ts` helper files). `services/equipmentCheckApi.ts` uses the shared
  `createApiClient` factory (`withCredentials: true`, CSRF header
  interceptor confirmed present in the factory itself) rather than a
  hand-rolled axios instance — Pitfall #7 satisfied by construction.
  Grepped (not read line-by-line — partial scope, noted rather than
  assumed) all 12 files for `window.confirm`/`alert`/`prompt`,
  `dangerouslySetInnerHTML`, the banned `.toLocale*` date methods, and raw
  `fetch(` — zero hits across all four in every file except one comment in
  `EquipmentCheckTemplateList.tsx` referencing a past `window.prompt` fix
  (not a live call).
- **`EquipmentCheckTemplateBuilder.tsx` is out of this pass's depth,
  deliberately.** This file is the same one `AP-13-apparatus-nfc.md` has
  been auditing across ten Codex-reviewed passes (autosave/subtree-delete
  concurrency, not tenant isolation or auth) — re-auditing it here would
  duplicate that rotation entry's own in-progress work rather than add
  coverage. As of this pass, PR #2200 (AP-13 pass 9, merged `05372cb9`)
  left **three unresolved Codex review threads** on this exact file — one
  P1 (`moveItemToCompartment` bypasses the new `registerInFlightSave`
  invariant), one P2 (a `handleSave` reentrancy gap), one P1 (a test mock
  not reset per Pitfall #28) — recorded in `PROGRESS.md`'s 2026-09-03 log
  entry for feature 13. None of the three are tenant-isolation, auth, or
  permission defects (this feature's lens); all three are carried forward
  under AP-13, not duplicated here.

**No new findings.** No code changes this pass — every fix from pass 1/2
verified intact, every new route/service method since pass 2 correctly
gated and org-scoped, three new tables' migrations correct.

## Completion gate (pass 3)

| Check                                                             | Result                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                     | ✅ 0 violations                                                                         |
| `black --check app/ tests/ alembic/`                              | ✅ 1449 files unchanged                                                                 |
| `isort --check-only app/ tests/ alembic/` (isort 9.0.1, CI's pin) | ✅ clean                                                                                |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 414 revisions, single head `e3a9c1d5b7f2`                                            |
| `pytest tests/ -q -k "equipment_check or shift_completion"`       | ✅ 386 passed, 1 skipped (pre-existing, `pywebpush` not installed)                      |
| `pytest tests/` (full backend suite)                              | ✅ 10439 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep skips), 0 failed |
| `npx tsc --noEmit`                                                | ✅ 0 errors                                                                             |
| `npx eslint .`                                                    | ✅ 0 errors                                                                             |

---

## Pass 2 (2026-08-28) — zero diff across the six declared files; two adjacent files reviewed on Codex follow-up, both clean

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
equipment-check/shift-completion surface. **Net: nothing in the six declared
files changed.**

**Scope correction (Codex review of this PR).** The zero-diff claim above
covered only the six files pass 1 declared; it did not check adjacent files
outside that list that also implement pieces of this feature.
[Codex flagged](https://github.com/thegspiro/the-logbook/pull/1963#discussion_r3880196422)
two: `app/services/scheduled_tasks.py` (end-of-shift equipment-check reminder
task) and `app/services/scheduling_service.py` (`ShiftCall.responding_members`,
which `ShiftCompletionService` reads for trainee call attribution). Both had
in fact changed since `2a7e47ee` — confirmed with `git log
2a7e47ee..origin/main -- backend/app/services/scheduled_tasks.py
backend/app/services/scheduling_service.py`, commits including `c19ecc0f`,
`f439cf07`, `27c78fcf`, `b10a8ca7`, and the message-delivery-idempotency
chain. Both are reviewed below. **Verdict: clean, no findings, no code
change required.**

### Adjacent files reviewed on follow-up

**`scheduled_tasks.py` — `run_end_of_shift_checklist_reminders`
(:2218-2410).** This is the end-of-shift equipment-check reminder task named
in the Codex comment. Read the full function plus its three changed hunks
since `2a7e47ee` (all from `c19ecc0f`, PR #1915 — a different rotation
feature's fix, CRON2-31):

- The `Shift` query at :2257 filters `Shift.organization_id == str(org.id)`,
  and the function itself only runs per-org via `_for_each_org` (:509),
  which itself filters `Organization.active.isnot(False)`. `shift_ids` (:2268)
  is built exclusively from that org-scoped result, so the two batched
  follow-up queries (`ShiftEquipmentCheck`/`ShiftAssignment` `.where(...
.in_(shift_ids))`, :2272 and :2280) cannot pull another org's rows — a
  foreign id could not appear in `shift_ids` to begin with. `NotificationLog`
  rows are created with `organization_id=str(org.id)` (:2381) and
  `recipient_id` drawn only from `assigned_map`, itself keyed from the same
  org-scoped `shift_ids` join. No cross-org read or notify path.
- The three-hunk change adds `.join(User, ...).where(User.is_active.is_(True))`
  to the assignment lookup (:2282-2290) and stops stamping the
  `eos_checklist_reminder_sent` dedup flag on three early-`continue` branches
  (no apparatus yet, no templates yet, every assignee filtered out) that
  previously stamped it. Both are correctness/availability fixes (a
  deactivated member no longer gets a reminder; a shift assigned or given an
  apparatus later in the window still gets its reminder instead of being
  silently and permanently skipped) — neither touches auth, tenant scoping,
  or what data reaches whom beyond narrowing the recipient set to active
  users, which is a tightening, not a loosening.
- `resolve_check_templates` (:548), which this function calls, is unchanged
  since `2a7e47ee` and out of this diff's scope; it filters
  `EquipmentCheckTemplate.organization_id == str(organization_id)`
  correctly. Its apparatus-type fallback (:577) resolves `Apparatus.id ==
str(apparatus_id)` without an org filter, but `apparatus_id` here is never
  client-supplied — it comes from `shift.apparatus_id` on an already
  org-scoped `Shift` row — so this is not reachable cross-tenant through this
  path. Pre-existing, unchanged, noted rather than silently passed over.
- `run_post_shift_validation` (:1359-1420ish) also references equipment
  checklists (folds "outstanding end-of-shift checklists" into its message)
  and gained a `Shift.status != ShiftStatus.CANCELLED` filter in the same
  window (CRON2-31-3) — a correctness fix for a different bug (a cancelled
  shift generating a bogus validation prompt forever), not a tenant or auth
  change. Same org-scoping shape as above (`Shift.organization_id ==
str(org.id)`, unchanged).

No finding. Checked against CHECKLIST.md's seven dimensions for what
changed: tenant isolation (§3) and abuse resistance (§6, the dedup-flag
fixes prevent both notification-storm and permanently-silenced-reminder
failure modes) are the only dimensions this diff touches, and both check out.

**`scheduling_service.py` — `ShiftCall.responding_members` validation
(:1183-1202, :2073-2087, :2137-2141).** This is a real, already-applied XC-1
fix, from `f439cf07` ("re-verify SCH-1..8, fix 1 XC-1 gap in shift calls"),
feature 15's own pass — reviewed here for the first time from EC-14's angle
since `ShiftCompletionService` (this feature's territory) is a reader.

- `_all_users_in_org` (:1183) is a batched `SELECT User.id WHERE id IN (...)
AND organization_id = :org` check; `create_shift_call` (:2057) and
  `update_shift_call` (:2128) both call it against `responding_members`
  before persisting, rejecting the write with `"One or more members are not
in your organization"` if any id doesn't resolve in-org. This closes
  exactly the XC-1 gap CLAUDE.md Pitfall #14c describes: a client-supplied FK
  id array stored into JSON with no prior existence/tenancy check.
- Both mutating methods re-verify the shift itself is in-org
  (`get_shift_by_id`/`get_shift_call_by_id`, both filtering
  `organization_id`) independent of the endpoint-level check.
- The endpoints (`api/v1/endpoints/scheduling.py:1418-1511`) gate
  create/update/delete behind `scheduling.manage` **or** being the shift's
  named officer, resolved through `_authorize_shift_management` (:180),
  which itself fetches the shift org-scoped first (404 if not in-org) before
  checking permission — XC-3 and the permission-sensitivity match (§2) both
  hold: this is officer-level write access to per-incident attribution data,
  not a member-self-service surface.
- **Traced the `ShiftCompletionService` consumer specifically** (the
  concern the Codex comment raised): `_get_trainee_call_data_from_shift`
  (`shift_completion_service.py:112`) searches `ShiftCall.responding_members`
  for `trainee_id` to auto-populate a report's call count. Its one caller,
  `create_report` (:238), only reaches it after `shift_id` is validated
  `Shift.organization_id == str(organization_id)` (:241) **and** `trainee_id`
  is confirmed to have a `ShiftAttendance` or `ShiftAssignment` row on that
  specific shift (:253-274) — so a caller cannot use this path to attribute
  a call to a trainee who was never tied to the shift in the first place;
  `responding_members` only ever narrows an already-validated trainee's
  count, it cannot manufacture one. The reverse reader,
  `compute_member_call_counts` (:677, unchanged, out of this diff), is only
  called from two sites that both resolve `shift_id` through an org-scoped
  `Shift` fetch first (`scheduling.py:590`, `scheduling_service.py:6416`
  inside `finalize_shift`) — checked because the code comment on the new
  validation cites it as a reader, not because it changed.
- The remaining two hunks in this file's diff (:6129, :6155 —
  `compliance_value` graded from raw stored minutes instead of the rounded
  hours figure) are a compliance-requirement grading fix, unrelated to
  `responding_members`/call attribution and outside what the Codex comment
  raised; not reviewed as part of this pass (scheduling's own requirements
  surface is feature 15's territory).

No finding. Checked against CHECKLIST.md: tenant isolation (§3, XC-1 — the
fix is sound and complete) and authorization (§2, permission matches
sensitivity) are the dimensions this diff touches; both check out.

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
