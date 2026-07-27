# Module Audit — Inventory

**Files:** `app/api/v1/endpoints/inventory.py` (5,605 L, 116 endpoints incl. 1
WebSocket), `app/services/inventory_service.py` (5,678 L),
`app/api/v1/endpoints/labels.py` (154 L), `app/services/label_service.py`
(299 L). Inventory has no dedicated frontend module (rendered in-app).
**Audited:** iteration 3 (large module — invariant-focused: security/tenant
isolation/correctness, with a full line-by-line tenant-isolation read of the
service layer).

## Verified good ✅
- **Auth coverage:** all 116 endpoints authenticated. 115 carry a
  `require_permission` / `require_all_permissions` / `get_current_user`
  dependency; the `/ws` WebSocket authenticates manually (decodes the JWT,
  re-checks the user is active, non-deleted, and org-matched before joining an
  org-scoped `ws_manager`). Endpoints using bare `get_current_user` all do their
  own self-scope authorization (`extend_checkout`, `get_user_inventory`,
  `list/create_return_request`, `list/create_equipment_request`, etc.).
- **Tenant isolation (service layer) is solid.** Every by-id
  `select`/`update`/`delete` in `inventory_service.py` either filters
  `organization_id` directly or derives the id from a row already fetched
  org-scoped. All checked: `get_*_by_id`, `_get_item_locked`, `update_item`,
  `retire_item`, `assign/unassign`, `issue/return_to_pool`, `checkout/checkin`,
  `update_maintenance_record` (id + item_id + org), `review_return_request`,
  `review_write_off`, `fulfill_equipment_request`, lots/kits/variant-group/
  reorder getters, allowance helpers. No IDOR path found.
- **Label service:** every cross-module builder filters
  `organization_id == org AND id.in_(ids)`, so client-supplied cross-org ids
  return no rows. Presets are position-scoped and the position is org-verified.
- **No raw SQL:** no `text()`, f-string, or `.format()` query building anywhere.
  `get_items` / `search_by_code` / `get_members_inventory_summary` escape LIKE
  wildcards.
- **Lint:** flake8 clean across all four files. No TODO/FIXME/HACK markers.

## Findings

### INV-1 — correctness bug — `get_item_history` AttributeError — ✅ FIXED
`get_item_history` built the issuance timeline using `i.quantity` and
`i.reason`, but the `ItemIssuance` model defines those columns as
`quantity_issued` and `issue_reason` (there is no `quantity`/`reason`
attribute). `GET /items/{item_id}/history` raised `AttributeError` for any item
that had pool issuances in its history. Everywhere else in the service already
uses the correct names.
**Fix:** `i.quantity → i.quantity_issued`, `i.reason → i.issue_reason` (5
references across the issuance + issuance-return branches). Verified against the
model; compiles + flake8 clean.

### INV-2 — MEDIUM — `create_equipment_request` cross-tenant item read — ✅ FIXED
`POST /requests` (any authenticated member) looked up the referenced item with
`select(...).where(InventoryItem.id == item_id)` and **no org filter**. A member
could pass an `item_id` from another org: the rank/position restriction logic
then ran against that foreign item, and the resulting `EquipmentRequest` stored
the foreign `item_id`. Cross-tenant read of restriction metadata + dangling FK.
**Fix:** added `InventoryItem.organization_id == current_user.organization_id`
to the lookup and a 404 when a provided `item_id` doesn't resolve in-org (a
legitimate request always references an item the member can see; `item_id` is
optional — name-only purchase requests are unaffected). Compiles + flake8 clean.

### INV-3 — LOW — `create_maintenance_record` doesn't validate item is in-org (+ silent no-op)
`create_maintenance_record` accepts a client-supplied `item_id`, writes the
record with the caller's `organization_id`, but never checks the item belongs to
the org. Worse, when `is_completed=True`, `_get_item_locked` silently returns
`None` for a foreign/missing item and the item-side update is skipped **with no
error surfaced** — a "completed" maintenance record that updated nothing.
**Status:** flagged (XC-1 class). Recommend org-validating `item_id` on create
and raising when the item isn't in-org, mirroring the INV-2 fix.

### INV-4 — LOW — Broad create/update FK-validation gaps (XC-1 class)
Multiple create/update methods persist client-supplied FK ids without verifying
the referenced row is in-org (see `CROSS-CUTTING.md` XC-1 for the full list):
`assign_item_to_user`/`checkout_item`/`issue_from_pool`/`issue_kit_to_member`
(`user_id`); `create_return_request` (`assignment_id`/`issuance_id`/
`checkout_id`); `create_write_off_request` (`clearance_id`/`clearance_item_id`);
`create_size_variants`/`create_variant_group`/`create_equipment_kit`/
`create_reorder_request` (`category_id`/`location_id`/`storage_area_id`);
endpoints `create_exposure_record` (`user_id`), `create_allowance`
(`category_id`/`role_id`), `create/update_storage_area`
(`parent_id`/`location_id`). Approval/execution paths re-run mutations through
org-scoped methods, so a bad stored FK fails to resolve at execution — the gap
is data-integrity/mis-attribution, not a live cross-tenant write.
**Status:** flagged — best closed by the shared `assert_in_org` helper (XC-1).

### INV-5 — LOW — `list_reorder_requests` LIKE without wildcard escaping
`list_reorder_requests` uses `ReorderRequest.item_name.ilike(f"%{search}%")`
without escaping `%`/`_`, unlike the other search methods. Still a bound
parameter (no SQL injection) — just inconsistent wildcard behavior (a `%` in the
search box matches everything).
**Status:** flagged (cosmetic/consistency). Recommend the same `_escape_like`
helper the other search paths use.

### INV-6 — LOW — Equipment-kit `optional` flag read but never persisted
`issue_kit_to_member` branches on `kit_item.optional`, but `create_equipment_kit`
never persists an `optional` value from the incoming line-item data (it sets
`item_id`, `category_id`, `item_name`, `quantity`, `size_selectable`,
`sort_order` only). If the column exists and defaults to `False`, every kit item
is treated as required regardless of caller intent; if it doesn't exist, the
issue path would error.
**Status:** flagged — confirm the model column and wire it through on create.

## Notes
- `retire_item` and `get_nfpa_retirement_due_items` have by-id sub-queries that
  omit the org filter, but the id is provably in-org already (parent row fetched
  org-scoped). Not exploitable; noted for completeness.
- Vulture found no dead code in the service/label-service files.
