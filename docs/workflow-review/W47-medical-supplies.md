# Workflow Review — W47 Medical Supplies

**Driven:** 2026-09-30 · **As:** `quartermaster`, with `member` read-only · **Viewports:** 1280×900, 390×844
**Commit:** `a69519fce` (the W46 branch) plus this run's changes · **Database:** continued from W46

---

## What was driven

1. As `quartermaster`, `/medical-supplies` with no medical categories: Add supply.
2. `/medical-supplies/categories` → New category:
   - blank name, then threshold −2;
   - then "Trauma" at 5, with Create category double-clicked.
3. Add supply "W47 Tourniquet" (Trauma, on hand 0, reorder at 4), with Add supply double-clicked.
4. Receive delivery, two lines:
   - TQ-A: 3 units, expiring 10/10/2026;
   - TQ-B: 2 units, expired 9/1/2026;
   - Record delivery double-clicked.
5. Then:
   - the Expiring stock and All supplies tabs;
   - the item's Stock Lots tab on its inventory page;
   - the summary and dashboard widgets.
6. Edit the supply: storage location set, Reorder at cleared.
7. Retire the supply, with Retire double-clicked; then the page and the summary.
8. As `member` at 390×844:
   - both pages;
   - `POST` items, categories and deliveries;
   - retire.

## Held up ✅

- **Validation:** a blank category name and a negative threshold were refused.
- **Double-clicks:** Create category made **one** category, Add supply **one** item, and Record delivery **two** lots (one per line).
- **The lots:**
  - The expired lot read "Expired 28d ago" and the other "11d left".
  - On hand read 3: the expired lot is left out, as the backend's issue and swap paths leave it.
- **Editing:**
  - Clearing Reorder at saved as a clear (CLAUDE.md pitfall 1).
  - The edit form explains that on hand now comes from the lots.
- **Retiring:** a confirmation came first ("This cannot be undone"), and the item left the list.
- **`member`:**
  - read the page and the categories with no write controls, and no horizontal scroll at 390×844;
  - got 403 on every write.

## Findings

### W47-1 — LOW — The item page's stock panel called expired units ready — ✅ FIXED

**Did:** `quartermaster`, W47 Tourniquet → Stock Lots.
**Saw:**

- "5 ready units across 2 lots", counting the 2 expired units.
- Medical Supplies said 3 on hand for the same item.
- The server's issue and swap paths skip expired lots, which are "not stock anyone can use".

**Where:** `frontend/src/modules/inventory/components/StockLotsPanel.tsx:178`.
**Fix:** ready units count in-date lots only, and expired units are shown
separately ("3 ready units across 2 lots · 2 expired"). Covered by the new
`StockLotsPanel.test.tsx`. Re-driven.

### W47-2 — LOW — Every lot's controls had the same names — ✅ FIXED

**Did:** as above.
**Saw:** each lot carried "Decrease quantity", "Increase quantity" and "Delete lot", with nothing saying which lot.
**Where:** `StockLotsPanel.tsx`, the lot row.
**Fix:** "Decrease lot TQ-B", "Increase lot TQ-B" and "Delete lot TQ-B" ("unnumbered lot" when a lot has no number). Covered by the same new test. Re-driven.

### W47-3 — LOW — A delivery's lines repeated the same field names — ✅ FIXED

**Did:** Receive delivery → Add line.
**Saw:** every line's fields read "Item", "Qty", "Lot #" and "Expires"; only the remove button said which line.
**Where:** `frontend/src/modules/medical-supplies/components/ReceiveDeliveryModal.tsx:121`.
**Fix:** each line is a group named "Line 1", "Line 2" and so on. Covered by a new case in `ReceiveDeliveryModal.test.tsx`.

### W47-4 — LOW — A retired supply's lots stayed on the Expiring stock tab and in the counts — ✅ FIXED

**Did:** retired W47 Tourniquet, which still had two lots.
**Saw:**

- "0 Supply items", yet Expiring stock listed both lots.
- The summary counted 1 expiring and 1 expired.
- Nothing on the page could act on them.
- `InventoryService.get_expiring_lots` did not filter retired items, although the dashboard's expiring count does.
- Read from code: the same query feeds the scheduled supply-expiry alert, which would keep reporting them.

**Where:** `backend/app/services/inventory_service.py:8251`.
**Fix:** retired items' lots are left out. Covered by the new
`test_expiring_lots_retired_items.py` (integration), which fails against the
old query. Re-driven after a backend restart: expiring 0, expired 0.

### W47-5 — LOW — The Add supply dialog named the categories page without linking to it — ✅ FIXED

**Did:** Add supply with no medical categories.
**Saw:** "Add one on the Medical Supply Categories page first". The page is
otherwise reached only by a tag icon with no visible label.
**Where:** `frontend/src/modules/medical-supplies/components/MedicalItemFormModal.tsx:159`.
**Fix:** the page name is a link. Covered by an added assertion in `MedicalSuppliesPage.test.tsx`.

### W47-6 — MED — The dashboard's Low stock counts a lot-stocked medical category as empty — 🚩 FLAGGED

**Did:** `quartermaster`, with Trauma's threshold at 5 and the tourniquet's lots holding 3 in date. Read `/dashboard/asset-widgets` and the query behind it.
**Saw:**

- The dashboard's "Low stock" read 2.
- One of the two was Trauma at a stock of **0**: `get_low_stock_items` sums `InventoryItem.quantity`, which a lot-stocked item leaves at 0.
- The widget links to `/inventory?stock=low`, which leaves medical categories out, so the list it opens shows 1.
- Medical Supplies counts low stock from item reorder points only, so the medical category's "Low stock at 5 or below" is read by this report alone (and an MCP tool).

**Where:** `backend/app/api/v1/endpoints/dashboard.py:158` and `InventoryService.get_low_stock_items`.
**Flagged:** what "low" means for a lot-stocked category, and whether the
dashboard counts medical categories, is a reporting definition shared by three
screens (CLAUDE.md pitfall 29). Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W47-7 — NIT — A delivery accepts a lot that has already expired — OPEN

TQ-B, expired 9/1, was received without comment. Recording stock that is
already on the shelf may be the intent, so this is left.

### W47-8 — NIT — Expired lots can be disposed of only from the inventory item page — OPEN

The Expiring stock tab lists an expired lot but offers no action. The lot's
controls are on the item's Stock Lots tab under Inventory, which nothing on the
medical page links to. The edit form says to adjust "the item's lots" without
saying where.

## Checklist

| Section                 | Result                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ category, supply, delivery, edit, retire; fixed W47-4                                 |
| 2. The right people     | ✅ member reads, every write 403, no write controls shown                                |
| 3. Wrong input, failure | ✅ blank name and negative threshold refused; three double-clicks acted once; W47-7 open |
| 4. Browser signals      | ✅ clean                                                                                 |
| 5. Coming back to it    | ✅ lots, the cleared reorder point and the retirement read back                          |
| 6. On a phone           | ✅ member at 390×844, no horizontal scroll                                               |
| 7. Everyone can use it  | Fixed W47-2, W47-3, W47-5                                                                |
| 8. What happens around  | Fixed W47-1; W47-6 flagged; W47-8 open                                                   |

## Completion gate

| Check                    | Result                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                           |
| npm run lint             | clean                                                                                                           |
| flake8 (changed files)   | clean                                                                                                           |
| black --check / isort    | clean                                                                                                           |
| frontend tests (touched) | `modules/inventory`, `modules/medical-supplies` — 102 files, 1593 passed, no local server                       |
| backend tests (touched)  | `test_expiring_lots_retired_items`, `test_supply_expiration_alerts`, `test_medical_supplies_domain` — 44 passed |
