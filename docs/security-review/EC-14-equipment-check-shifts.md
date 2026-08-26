# Security Review 14 — Equipment Check & Shift Completion

**Prefix:** `EC` · **Iteration:** 14 · **Reviewed:** 2026-08-26 · **PR:** [#1842](https://github.com/thegspiro/the-logbook/pull/1842)

**Backend:** `api/v1/endpoints/equipment_check.py` (47 routes),
`api/v1/endpoints/shift_completion.py` (21 routes),
`services/equipment_check_service.py` (~3,200 L),
`services/shift_completion_service.py`
**Frontend:** in-app (no dedicated module directory)
**Migrations:** none this iteration (no schema change)

---

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
development (commit messages reference "Address Codex review findings on
#1731" and "Address the second Codex review on #1736"). Read all nine new
endpoints and their service methods in full rather than sampling, since
this is exactly the shape of surface (client-supplied ids reaching
inventory-quantity writes) this module's own history (EC-1/EC-2/EC-4) shows
is where its defects have lived.

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
  submit-only crew member isn't wrongly blocked.
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
  client-supplied. `allow_first_link=False` for submit-only callers blocks
  the one operation that's a standing configuration decision (binding a
  checklist position to a catalog item for the first time) rather than a
  stock movement.
- **`get_supply_expiring_items`/`get_apparatus_inventory`** (read-only) both
  pass `organization_id` straight through to their service methods; spot-read
  both service bodies — org-scoped throughout, no client-supplied ids beyond
  the org-implicit apparatus id (`get_apparatus_inventory` 404s cleanly on a
  foreign/missing apparatus id rather than resolving it unscoped).
- **`get_item_deployments`** — reverse lookup (inventory item → checklists
  carrying it) — org-scoped on the `inventory_item_id` input.

No defect found in any of the nine.

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
- **No SQL injection**, no PK-bypass patterns in either file.
- **Lint:** flake8 clean.

## Findings

None. This iteration's own scrutiny (full read of all nine new
supply/swap endpoints and their service methods, not sampled) found the new
surface already correctly org-scoped, permission-gated, and — for the one
genuinely concurrency-sensitive operation — correctly locked across all
three rows it touches, in a deliberately fixed order. EC-11 and the EC-7
residual remain open, unchanged, both non-security.

## Schema & migration notes

No schema changes. No `SET NULL` nullability issues found in either file's
models.

## Guard tests added

None — no code changed this iteration. Existing coverage
(`test_equipment_check_service.py`, `TestItemFkValidation`,
`TestCompartmentParentValidation`, and the module's org-scoping tests)
already covers every invariant re-verified above.

## Completion gate

| Check                                                    | Result                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                            | ✅ 0 violations (no files changed)                               |
| `black --check app/ tests/ alembic/`                     | ✅ clean (no files changed)                                      |
| `isort --check-only app/ tests/ alembic/`                | ✅ clean (no files changed)                                      |
| `python3 scripts/validate_migrations.py --strict`        | ✅ single head, no schema change                                 |
| `pytest tests/ -k "equipment_check or shift_completion"` | ✅ 291 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)                     | ✅ 8500 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                              | n/a — no frontend change                                         |
