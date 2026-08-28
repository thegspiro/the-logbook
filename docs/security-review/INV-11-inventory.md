# Security Review 11 — Inventory

**Prefix:** `INV` · **Iteration:** 11 · **Reviewed:** 2026-08-28 (pass 2) · **PR:** [#1835](https://github.com/thegspiro/the-logbook/pull/1835) (pass 1)

**Backend:** `api/v1/endpoints/inventory.py`, `services/inventory_service.py`,
`api/v1/endpoints/labels.py`, `services/label_service.py`,
`services/label_printer_service.py`
**Frontend:** `modules/inventory/*` (pages, routes, service), shared
`components/InventoryScanModal.tsx`
**Migrations:** `8fb3757b80ec` (equipment-request duration),
`a8f3c1d7e902` (reorder receiving workflow), `f4a9c2d81e70` (physical return
receipt) — all landed since pass 1

---

## Scope

Second pass over this module: re-verify pass 1's fixes/flags still hold, then
review everything that changed since pass 1's merge (`acfc34c3`, PR #1835).
That range is substantial — six commits' worth of real feature work, not a
quiet interval:

- `distribute-items` replaces `batch-checkout` with an explicit
  per-scan operation (`permanent_assignment` / `temporary_loan`) instead of
  inferring intent from item status, and reports a structured
  `InventoryHoldingConflict` when the item is already held.
- `POST /transfer` — an explicit chain-of-custody transfer between two
  members, closing the old holding record and opening its successor
  atomically.
- Equipment requests: `requested_duration` (member intent) is now stored
  separately from `fulfillment_type` (what the quartermaster actually did),
  with a `substitution_override_reason` required when fulfilling outside the
  requested item/category.
- Reorder requests: a versioned, row-locked status-transition workflow
  (`/transition`, `/correct-status`) plus an idempotent, lot-creating
  receiving endpoint (`/receipts`) backed by a new `reorder_receipts` table.
- Return requests: three-stage lifecycle (`requested` → `received` →
  `inspected`) replacing the old `pending`/`approved`, with independent
  physical-receipt verification (barcode/asset match for serialized items,
  quantity match for pool items) before a member's claimed return closes
  their holding.
- Write-off review: an optimistic-concurrency snapshot check
  (`expected_item_status`/`expected_holder_signature`) plus a mandatory
  acknowledgement for held/high-value items before approval.
- `labels.py`: audit logging added for two PII-adjacent modules
  (`prospective_members`, `membership`) on both generate and print.

All of `inventory.py`'s and `labels.py`'s diffs against pass 1 were read in
full (245 and 41 changed lines respectively); the corresponding
`inventory_service.py` methods were read in full rather than sampled —
`distribute_items`, `transfer_item_holding`, `_active_holding_conflict`,
`review_return_request`, `review_write_off` (renamed from the prior pass's
method name), `transition_reorder_request`, `correct_reorder_status`,
`receive_reorder`, `update_lot`, `get_reorder_request`, and
`_assert_reorder_fks_in_org`. The `reorder_receipts` model and its migration
were read in full. Schema changes (199 lines) were read in full for the
new/changed request and response models. Frontend inventory pages changed
substantially (`InventoryAdminHub`, `EquipmentRequestsPage`,
`InventoryMaintenancePage`, `ReorderRequestsPage`, `WriteOffsPage`,
`MyEquipmentPage`, `InventoryScanModal`) but were not read in full this
pass — client-side code cannot itself create an authorization or
tenant-isolation gap given the backend enforcement verified below, and no
new client-side-only trust decision (e.g. a new CSV export, a new
`window.confirm`) showed up in `git diff --stat`. Noted as a scope
boundary, not a finding.

## Route inventory (new/changed only — see PR #1835's file for the full 132+26 baseline, unchanged)

| Method | Path                                        | Auth dependency      | Permission         | Org-scoped | Notes                                                                      |
| ------ | ------------------------------------------- | -------------------- | ------------------ | ---------- | -------------------------------------------------------------------------- |
| POST   | `/distribute-items` (was `/batch-checkout`) | `require_permission` | `inventory.manage` | ✅         | replaces removed route, same gate                                          |
| POST   | `/transfer`                                 | `require_permission` | `inventory.manage` | ✅         | new                                                                        |
| POST   | `/reorder-requests/{id}/transition`         | `require_permission` | `inventory.manage` | ✅         | new, row-locked + versioned                                                |
| POST   | `/reorder-requests/{id}/correct-status`     | `require_permission` | `inventory.manage` | ✅         | new, row-locked + versioned                                                |
| POST   | `/reorder-requests/{id}/receipts`           | `require_permission` | `inventory.manage` | ✅         | new, row-locked + idempotent                                               |
| PATCH  | `/lots/{lot_id}`                            | `require_permission` | `inventory.manage` | ✅         | unchanged gate; now catches `ValueError` → 400 instead of an unhandled 500 |

No new route relaxed a permission, added a bare `get_current_user` route, or
introduced an unauthenticated path. `/batch-checkout` was removed outright
(not deprecated-and-left), so there is no stale duplicate route carrying the
old, less-precise semantics.

## Verified good ✅

- **Every new mutation is `inventory.manage`-gated**, matching every sibling
  route in the module (checked against the full permission table in pass 1's
  file, still accurate for the unchanged 132/26 baseline).
- **New by-id/by-FK access is org-scoped and locked where it mutates shared
  state**: `transfer_item_holding` resolves the item via `_get_item_locked`
  (org-filtered `SELECT ... FOR UPDATE`) and the specific holding record via
  a compound filter on id + org + item + **current holder** + active flag —
  a stale or mismatched `current_record_id`/`current_holder_id` fails closed
  ("Holding changed; rescan the item") rather than transferring the wrong
  record. `new_holder_id` is validated in-org via `is_in_org` (XC-1).
  `transition_reorder_request`/`correct_reorder_status`/`receive_reorder`
  all fetch the `ReorderRequest` row with `.where(id ==, organization_id ==)
.with_for_update()` before mutating (XC-3 + Pitfall #27's row-lock half).
- **The reorder receiving path is genuinely idempotent**: `receive_reorder`
  checks for a prior `ReorderReceipt` row keyed on
  `(reorder_request_id, idempotency_key)` — enforced at the DB level by
  `uq_reorder_receipt_key`, not just the pre-check — before creating the lot
  and incrementing `quantity_received`, so a retried request (double-tap,
  client retry after a dropped response) cannot double-credit stock. The
  optimistic `version` check on the same three endpoints closes the
  read-then-write race a plain locking read alone would not (two staff
  transitioning/correcting/receiving against the same stale `expected_version`
  get one success and one explicit conflict, not a silently overwritten
  status).
- **`reorder_receipts`, `reorder_requests`, and `inventory_lots` are all
  migration-created tables** (`20260306_0501_...`, `20260724_0001_...`),
  confirmed by grepping every `alembic/versions/*.py` for their
  `create_table` calls — so `a8f3c1d7e902`'s unguarded `op.add_column` /
  `ALTER TABLE ... MODIFY status ENUM(...)` calls against them are safe on
  the empty database CI migrates from scratch (Pitfall #26 does not apply
  here). `f4a9c2d81e70`, altering `return_requests` — a `create_all`-only
  table per its own comment, confirmed by the same grep returning nothing —
  correctly guards the entire body on `_has_table` first. `reorder_receipts`
  gets its own `organization_id`-led index (`ix_reorder_receipts_org`)
  specifically because every read of it is org-scoped first and the
  request-id index can't serve that filter — the same reasoning this
  rotation has flagged missing elsewhere is applied proactively here.
- **`received_by` on `ReorderReceipt`** is `ondelete="SET NULL"` and
  correctly `nullable=True` (Pitfall #2); `organization_id` and
  `reorder_request_id` are `CASCADE` and `nullable=False`, appropriate since
  a receipt cannot outlive its org or its parent request.
- **Physical-receipt verification is real, not cosmetic**:
  `review_return_request` requires an independent `observed_condition` for
  every receipt, and for `TrackingType.INDIVIDUAL` items requires the
  reviewer's scanned `verified_identifier` to match the item's own
  barcode/asset-tag/serial before the request can move to `received` — a
  member's claim to have returned gear cannot close the holding on its own.
  Each of the three holding types resolved on receipt
  (`ItemAssignment`/`CheckOutRecord`/`ItemIssuance`) is re-fetched org- and
  requester-scoped with `.with_for_update()` immediately before mutation.
- **No new injection surface**: `git diff` across the changed backend files
  for this pass contains no new `.ilike(`/`.like(` or `csv.writer` usage.
- **No new client-side-only trust decision**: `git diff --stat` for every
  inventory-touching frontend file shows page/UI churn (new
  duration/fulfillment-type pickers, the transfer flow, receipt entry) with
  no new export, no new `window.confirm`/`alert`/`prompt`, matching
  `CLAUDE.md` pitfalls 15/16.
- **Lint:** `flake8`/`black --check`/`isort --check-only` clean on the full
  `app/`/`tests/`/`alembic/` tree (see gate below — unchanged from main,
  since this pass makes no code changes).
- **Tests:** 701 passed, 1 pre-existing skip (`inventory`/`label`-scoped
  suite), confirming the new workflows' own test coverage (added alongside
  the feature commits, outside this rotation) is green on current `main`.

## Findings

None. Every new endpoint is permission- and org-scoped consistently with the
module's existing pattern; the two new concurrency-sensitive workflows
(reorder receiving, custody transfer) both lock the contended row and, where
a plain lock would not suffice (reorder status), add optimistic versioning —
the exact combination Pitfall #27 calls for. INV-7 and LBL-1 (fixed in pass

1. are unchanged and still fixed, confirmed by reading the current code at
   both locations. INV-8 and INV-9 (flagged in pass 1 as owner decisions) are
   unchanged and remain open in `KNOWN_LIMITATIONS.md`; nothing in this
   pass's diff bears on either.

## Schema & migration notes

Three migrations landed since pass 1, all correctly structured:
`8fb3757b80ec` (adds `equipment_requests.requested_duration`, guarded on the
column already existing per the fast-path-init race, table itself always
present via `20260222_0450_...`), `a8f3c1d7e902` (reorder-receiving schema:
`reorder_requests.version`, `inventory_lots.storage_location`/`unit_cost`,
the new `reorder_receipts` table, and `organizations.reorder_vendor_required`
/`reorder_po_required` — all against migration-created tables, no guard
needed), `f4a9c2d81e70` (return-request lifecycle columns and enum values,
correctly guarded on `_has_table("return_requests")` since that table is
`create_all`-only). `validate_migrations.py --strict` confirms a single head
(see gate below). No JSON columns touched. No seeded-grant changes.

## Guard tests added

None this pass — no fix was needed. Existing guard tests from pass 1
(`test_inventory_member_visibility.py`, `test_labels_endpoint.py`) still
pass unmodified against current `main` (see completion gate).

## Completion gate

No code was changed this iteration, so the gate below verifies current
`main` rather than a diff. Re-run in full at pass 3 or whenever this
module's code next changes.

| Check                                             | Result                                  |
| ------------------------------------------------- | --------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                         |
| `black --check app/ tests/ alembic/`              | ✅ clean                                |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head                          |
| `pytest tests/ -k "inventory or label"`           | ✅ 701 passed, 1 skipped (pre-existing) |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change this iteration |
