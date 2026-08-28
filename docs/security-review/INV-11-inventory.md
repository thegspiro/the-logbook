# Security Review 11 — Inventory

**Prefix:** `INV` · **Iteration:** 11 · **Reviewed:** 2026-08-28 (pass 2) · **PR:** [#1957](https://github.com/thegspiro/the-logbook/pull/1957)

**Backend:** `api/v1/endpoints/inventory.py`, `services/inventory_service.py`,
`api/v1/endpoints/labels.py`, `services/label_service.py`,
`services/label_printer_service.py`
**Frontend:** `modules/inventory/*` (pages, routes, service), shared
`components/InventoryScanModal.tsx`, `components/ReturnRequestsPanel.tsx`
**Migrations:** `8fb3757b80ec` (equipment-request duration),
`a8f3c1d7e902` (reorder receiving workflow), `f4a9c2d81e70` (physical return
receipt) — all landed since pass 1

---

## Correction

The version of this pass first pushed to PR #1957 concluded "no findings."
That was wrong, and the reason is recorded here rather than quietly
overwritten: the backend diff was read in full and reviewed carefully, but
the frontend diff was waved through on the reasoning that "client-side code
cannot itself create an authorization or tenant-isolation gap" — true for
the seven checklist dimensions this rotation exists to check, but the
inventory feature work landed real functional and data-integrity defects
that reasoning has no way to catch, including one (INV-13, stale follow-up
state) that lives entirely in a frontend component
(`ReturnRequestsPanel.tsx`) this pass never opened. An automated review
(Codex) on PR #1957 caught seven of them; each was independently verified
against the actual code before being fixed or flagged below — bot findings
are bug reports, not findings on their own word. `git diff --stat` is not a
substitute for reading a changed file, even a frontend one, when the module
under review ships real business logic in its components.

## Scope

Second pass over this module: re-verify pass 1's fixes/flags still hold,
then review everything that changed since pass 1's merge (`acfc34c3`, PR
#1835). That range is substantial — six commits' worth of real feature work,
not a quiet interval:

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

`inventory.py`'s and `labels.py`'s diffs against pass 1 were read in full
(245 and 41 changed lines respectively); the corresponding
`inventory_service.py` methods were read in full — `distribute_items`,
`transfer_item_holding`, `_active_holding_conflict`, `review_return_request`,
`review_write_off`, `transition_reorder_request`, `correct_reorder_status`,
`receive_reorder`, `update_lot`, `update_item`, `_validate_item_state`,
`create_maintenance_record`, `get_reorder_request`, and
`_assert_reorder_fks_in_org`. The `reorder_receipts` model and its migration
were read in full. Schema changes (199 lines) were read in full. On
correction, every inventory-touching frontend file the diff-stat listed was
read in full: `InventoryScanModal.tsx`, `ReturnRequestsPanel.tsx`,
`InventoryMaintenancePage.tsx`, `InventoryAdminHub.tsx`,
`EquipmentRequestsPage.tsx`, `ReorderRequestsPage.tsx`, `WriteOffsPage.tsx`,
`MyEquipmentPage.tsx`.

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
- **New by-id/by-FK access is org-scoped**: `transfer_item_holding` resolves
  the item via `_get_item_locked` (org-filtered `SELECT ... FOR UPDATE`) and
  the specific holding record via a compound filter on id + org + item +
  **current holder** + active flag — a stale or mismatched
  `current_record_id`/`current_holder_id` fails closed ("Holding changed;
  rescan the item") rather than transferring the wrong record.
  `new_holder_id` is validated in-org via `is_in_org` (XC-1).
  `transition_reorder_request`/`correct_reorder_status`/`receive_reorder`
  all fetch the `ReorderRequest` row with `.where(id ==, organization_id ==)
.with_for_update()` before mutating (XC-3 + Pitfall #27's row-lock half).
- **The reorder receiving path is idempotent**: `receive_reorder` checks for
  a prior `ReorderReceipt` row keyed on `(reorder_request_id,
idempotency_key)` — enforced at the DB level by `uq_reorder_receipt_key`,
  not just the pre-check — before creating the lot, so a retried request
  (double-tap, client retry after a dropped response) cannot double-record
  a receipt. See INV-11 below for what it did **not** do correctly on first
  read.
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
  request-id index can't serve that filter.
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
- **No new injection surface**: no new `.ilike(`/`.like(` or `csv.writer`
  usage anywhere in the diff.
- **No new `window.confirm`/`alert`/`prompt`, no new CSV export** anywhere
  in the frontend diff (Pitfalls 15/16).

## Findings

### INV-10 — HIGH — Concurrent deny/receive on a return request can overwrite each other — ✅ FIXED

**What:** `review_return_request` read the `ReturnRequest` row with a plain
`SELECT`, no `.with_for_update()`, before checking `req.status !=
REQUESTED`.
**Where:** `backend/app/services/inventory_service.py` (the `ReturnRequest`
lookup at the top of `review_return_request`).
**Failure scenario:** two quartermasters act on the same REQUESTED return at
nearly the same time — one denies it, one physically receives it. Both read
`status == REQUESTED` before either commits, so both proceed: the deny path
commits a `DENIED` status while the receive path, unaware, closes the
member's holding and later commits `RECEIVED`/`INSPECTED` over it (or vice
versa, depending on commit order). The request ends up in one state with a
holding closed or reopened inconsistently with it.
**Impact:** a denied return can still close out the member's holding as
though it were received, or a received return's item-condition/follow-up
work is lost under a denial that lands after it — a chain-of-custody record
and a physical-safety decision (was this gear inspected?) can silently
disagree with what the database says happened.
**Fix:** added `.with_for_update()` to the initial lookup. The second
reviewer's transaction now blocks until the first commits, then re-reads
the row's now-current status via the locking read and returns "Request is
already denied/received" instead of proceeding — the same pattern
`transfer_item_holding` and the reorder workflow already use. Guard test
added (source-inspection, see below) so a future refactor that drops the
lock fails immediately rather than needing a real concurrency reproduction.

### INV-11 — HIGH — Received reorder stock was never credited to the item's on-hand quantity — ✅ FIXED

**What:** `receive_reorder` created an `InventoryLot` and a `ReorderReceipt`,
and incremented `ReorderRequest.quantity_received`, but never touched
`InventoryItem.quantity` — the column `issue_from_pool` (and everything that
calls it: distribution, equipment-request fulfillment) actually checks
before allowing an issuance.
**Where:** `backend/app/services/inventory_service.py:receive_reorder`.
**Failure scenario:** a quartermaster orders 10 units of a pool-tracked
item, receives 4 through the new receiving workflow, and the UI correctly
shows the reorder as partially received with a lot on file — but
`issue_from_pool` still sees the pre-receiving `item.quantity` and refuses
to issue units that, as far as the receiving screen is concerned, already
arrived.
**Impact:** the entire feature this iteration's diff centers on — reorder
receiving — did not do the one thing receiving stock is for. Not a
tenant-isolation or auth defect, but a correctness defect severe enough to
make the shipped feature non-functional for its stated purpose.
**Fix:** lock the linked `InventoryItem` row (`_get_item_locked`, matching
Pitfall #27) immediately before crediting it, then `item.quantity =
(item.quantity or 0) + data["quantity"]` alongside the existing
`quantity_received` increment, inside the same already-locked-request
transaction. Guard tests added (new file, real-database-backed): receiving
credits the item's on-hand quantity, and a second receipt that completes
the order brings the item to the expected final total.

### INV-12 — HIGH — An item completed with an unsafe condition could still return to service — ✅ FIXED

**What:** `_VALID_STATE_COMBOS` constrained only `RETIRED` to require
`ItemCondition.RETIRED`; `AVAILABLE` accepted any condition. The new
maintenance-completion flow writes `item.condition` from the technician's
`condition_after` field (`create_maintenance_record`, already existing
behavior, confirmed unchanged), and the new "Return to service" action
(`InventoryMaintenancePage.tsx`) sends only `{status: 'available'}` with no
regard for that condition.
**Where:** `backend/app/services/inventory_service.py` (`_VALID_STATE_COMBOS`);
`frontend/src/modules/inventory/pages/InventoryMaintenancePage.tsx`
(`returnToService`).
**Failure scenario:** a technician completes maintenance on an item and
records `condition_after: damaged` (or `poor`/`out_of_service`) — the
completion modal's own copy says the item "remains out of service until you
deliberately return it to service." Clicking "Return to service" then sent
`status: available` with no condition change, and the backend accepted it:
the item became `AVAILABLE` while still `damaged`. Assignment, checkout,
and pool issuance all gate purely on `status == AVAILABLE`, so the unsafe
item was immediately distributable to a member.
**Impact:** for a fire department, an "available" self-contained breathing
apparatus, harness, or radio that is actually damaged or out of service is
a life-safety issue, not just a data-quality one.
**Fix:** added `ItemStatus.AVAILABLE: {EXCELLENT, GOOD, FAIR}` to
`_VALID_STATE_COMBOS`, mirroring the unsafe-condition check
`review_return_request` already applies on its own (separate) path when
receiving a physical return. `update_item` now rejects the transition with
a 400 rather than silently accepting it. Two existing tests
(`test_retire_item`, `test_non_retired_statuses_accept_standard_conditions`)
encoded the old, incorrect invariant as expected behavior and were
corrected rather than deleted — the retire test's setup no longer needs an
`available`+`poor` item (changed to `in_maintenance`+`poor`, which is
unaffected), and the matrix test was split into "non-RETIRED-non-AVAILABLE
statuses accept anything" plus a new `test_available_requires_safe_condition`
asserting the corrected rule for every `ItemCondition` value.

### INV-13 — MED — Stale follow-up/quantity selection could leak between return reviews — ✅ FIXED

**What:** `ReturnRequestsPanel.tsx`'s `followUp` and `receivedQuantity`
state persisted across modal openings; only `observedCondition`,
`verifiedIdentifier`, and `reviewNotes` were reset when opening the review
modal for a new request. `handleReview` sent `follow_up: followUp`
whenever `reviewAction === 'received'`, regardless of whether the
follow-up selector was actually shown (it is hidden unless the _current_
review's observed condition is unsafe).
**Where:** `frontend/src/components/ReturnRequestsPanel.tsx`.
**Failure scenario:** a quartermaster reviews a damaged return, selects
follow-up "Write-off review," submits. They open the next request — a
different item returned in good condition, so the follow-up selector is
hidden — and receive it. `followUp` is still `"write_off"` in component
state, and it is sent anyway, creating a write-off review against an item
nobody flagged as unsafe. The same staleness applies to
`receivedQuantity` for a pool item.
**Impact:** silently misfiled write-off/maintenance/charge-review requests
against the wrong item, discovered only when someone notices the
mismatched paperwork.
**Fix:** reset `followUp` to `'auto'` and `receivedQuantity` to `1` at both
places the modal opens (receive and deny) and after a successful submit;
changed `handleReview` to send `follow_up` only when the observed condition
is actually unsafe (`UNSAFE_CONDITIONS.includes(observedCondition)`, the
same set already used to decide whether to show the selector — previously
duplicated as an inline literal, now one constant).

### INV-14 — LOW — Custody-transfer audit event had no acting user — ✅ FIXED

**What:** `transfer_item_holding`'s `log_audit_event` call omitted
`user_id`, even though `performed_by` was already available in scope.
**Where:** `backend/app/services/inventory_service.py:transfer_item_holding`.
**Failure scenario:** investigating who transferred an item's custody from
the audit log alone comes up empty for `inventory_item_transferred` events
— the org and the old/new holders are recorded, but not who performed the
transfer.
**Fix:** pass `user_id=str(performed_by)` to `log_audit_event`, matching
every other audit call in this file.

### INV-15 — LOW — "Transfer is immediate" checkbox had no effect — ✅ FIXED

**What:** `InventoryScanModal.tsx`'s transfer-confirmation dialog offered a
"Transfer is immediate" checkbox wired to an `immediate` field on
`InventoryTransferRequest`. `transfer_item_holding` accepts that field only
to embed it in the audit log payload; the transfer itself is always
performed immediately (old holding closed, new one opened, same
transaction) regardless of its value.
**Where:** `frontend/src/components/InventoryScanModal.tsx`.
**Failure scenario:** unchecking the box implies a deferred/pending
transfer is possible — no such state exists. Custody moves immediately
either way, so the control could lead a quartermaster to believe a
transfer had not yet taken effect when it had.
**Fix:** removed the checkbox and the `transferImmediate` state; the
request now always sends `immediate: true`, matching actual behavior.
Building genuine deferred-transfer semantics (a pending state held open
until a physical handoff is separately confirmed) would be a real feature,
not a bug fix, and is not implemented here.

## Flagged (owner decision)

### INV-16 — MED — Ordinary reorder edits bypass the versioned workflow — FLAGGED

`PATCH /reorder-requests/{id}` (`update_reorder_request`) neither locks the
row nor increments `version`, unlike `/transition`, `/correct-status`, and
`/receipts`. A manager editing `quantity_requested` or vendor details
through the plain PATCH endpoint while another manager is mid
transition/receipt is not serialized against them, and — since
`quantity_received` is guarded but `quantity_requested` is not — lowering
the requested quantity after partial receipt can leave `quantity_received`
greater than the (now smaller) `quantity_requested`, a state
`receive_reorder`'s own outstanding-quantity check does not anticipate.
Not fixed here because closing it means picking one of two designs with
real API-contract consequences: require every PATCH caller to start
sending `expected_version` (a breaking change for the existing frontend
edit form), or restrict which fields PATCH may touch once receiving has
started (a product decision about what "editing an order in flight" should
even mean). Mirrored to `KNOWN_LIMITATIONS.md`.

### INV-17 — MED — "Complete work" always creates a new maintenance record rather than closing the open one — FLAGGED

`InventoryMaintenancePage.tsx`'s completion flow always calls
`createMaintenanceRecord` with `is_completed: true`, even when the item
already has an open (scheduled or in-progress) record for the same work.
The original record is never marked closed, so it remains permanently
"due" in `getMaintenanceDueItems` while a second, completed record exists
alongside it — maintenance history and outstanding-work/compliance
reporting disagree even after the item is genuinely back in service. Not
fixed here because a correct fix needs to identify _which_ open record (if
more than one exists for an item, which is itself not currently
prevented) the completion is closing, which needs new data-fetching in the
modal (the "Due items" tab does not currently load an item's record list)
and a decision about the multiple-open-records case. Mirrored to
`KNOWN_LIMITATIONS.md`.

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
(see gate below). No JSON columns touched. No seeded-grant changes. No
migration needed for this pass's own fixes (all logic-only).

## Guard tests added

- `tests/test_inventory_return_receipt.py::test_review_return_request_locks_the_request_row`
  — source-inspection assertion that the `ReturnRequest` lookup in
  `review_return_request` uses `.with_for_update()` before the status
  check. Fails on reintroduction of INV-10.
- `tests/test_inventory_reorder_receiving_db.py` (new file, real-database
  backed) — `test_receiving_stock_increases_the_item_on_hand_quantity` and
  `test_a_second_full_receipt_makes_the_item_fully_available` assert
  `InventoryItem.quantity` actually increases on receipt and reaches the
  expected total across two partial receipts. Fails on reintroduction of
  INV-11.
- `tests/test_inventory_service.py::TestStatusTransitionMatrix::test_available_requires_safe_condition`
  — asserts `AVAILABLE` accepts only `EXCELLENT`/`GOOD`/`FAIR` across every
  `ItemCondition` value. Fails on reintroduction of INV-12.

## Completion gate

| Check                                                                 | Result                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                         | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                                  | ✅ clean                                                            |
| `isort --check-only app/ tests/ alembic/`                             | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`                     | ✅ single head                                                      |
| `pytest tests/ -k "inventory or label"`                               | ✅ 702 passed (704 after guard-test additions), 1 pre-existing skip |
| `pytest tests/` (full backend suite)                                  | ✅ 9173 passed, 22 pre-existing skips                               |
| `tsc --noEmit`                                                        | ✅ clean                                                            |
| `eslint .`                                                            | ✅ 0 errors, 10 pre-existing warnings (none in touched files)       |
| Frontend component tests (`InventoryScanModal`, `ReturnRequestsPage`) | ✅ 4 passed                                                         |
