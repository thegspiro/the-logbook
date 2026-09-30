# Workflow Review — W43 Storage Areas, Barcode Labels and CSV Import

**Driven:** 2026-09-29 · **As:** `quartermaster`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `536799475` (the W39–W42 branch) plus this run's changes · **Database:** continued from W42

---

## What was driven

1. As `quartermaster`, `/inventory/storage-areas`:
   - Add Storage Area "Shelf 1" (Shelf) inside Turnout Rack A, with Create double-clicked;
   - Delete on Turnout Rack A, which holds 2 items and the new shelf, cancelled at the confirmation;
   - Delete on a throwaway "Temp Bin" holding one item, confirmed, then that item's detail page.
2. `/inventory/storage-areas/print-labels` opened directly.
3. `/inventory/import`: a CSV of five rows:
   - a valid Turnout Gear item;
   - a name beginning with `=HYPERLINK(`;
   - an unknown category;
   - a row with no name;
   - a quantity of −3.

   Import Items was double-clicked. Then `GET /inventory/items`, and `/inventory/items/export`.

4. As `member` at 390×844:
   - `POST /storage-areas`, `DELETE /storage-areas/{id}` and `POST /items/import`;
   - both pages.

## Held up ✅

- **Storage areas:**
  - A double-clicked Create made **one** area, nested and given its own barcode (SA-000002).
  - The storage form is fully labelled.
  - Each row's print, edit and delete are named after the area.
- **Label printing:** opened with nothing selected, it says so and links back rather than printing blanks.
- **The import:**
  - It reported each row that failed and why.
  - The unknown category was imported without a category and warned about.
  - The item export writes the `=HYPERLINK(` name as `'=HYPERLINK(…`, so a spreadsheet will not run it (CLAUDE.md pitfall 15).
- **Refusals:** `member` got 403 on all three writes and Access Denied on both pages.

## Findings

### W43-1 — HIGH — A negative quantity in a CSV import broke the Items page for the whole department — ✅ FIXED

**Did:** `quartermaster`, imported a CSV whose last row had quantity −3.
**Saw:**

- The row was saved.
- From then on, `GET /inventory/items`, the list behind the Items page and item search, returned **500** for every request whose results included it: "Unhandled ValidationError … InventoryItemResponse, quantity".
- `InventoryItemResponse` requires a quantity of 0 or more, and the import wrote the row without that check. A negative purchase price would do the same.

One bad cell in a spreadsheet took the item list down for everyone.
**Where:** `backend/app/api/v1/endpoints/inventory.py:1413`, `_coerce_csv_row` (the quantity and purchase-price branches).
**Fix:** a negative quantity or purchase price is a row error that skips the
row ("Quantity cannot be negative: '-3'"), like an invalid status. Other rows
still import. Covered by the new `test_inventory_csv_row_bounds.py` (unit): the
two negative cases fail against the old parser, and three cases pin the
unchanged valid paths. The one row this run created was set to quantity 0 in
the review database, and the item list returned 200 again. Re-driven: the same
CSV now reports "Row 6: Quantity cannot be negative: '-3'", and the list stays 200.
**Flagged:** an installation that already imported such a row has a broken
Items page now. Repairing stored negative values is a data migration, so it is
left to the owner. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W43-2 — MED — Deleting a storage area that still held items hid where those items are — ✅ FIXED

**Did:** `quartermaster`, Delete on "Temp Bin", which held one item. The dialog read "This area holds 1 item. Move them to another storage area." I pressed Delete.
**Saw:**

- The area was deleted. Read from code: it is only deactivated.
- The item kept its link to it, and its detail page now reads **Storage Area: --**. Nothing in the app shows where it is.
- The dialog's "move them" was advice the button did not wait for.
- The warning about nested areas never appeared, even for Turnout Rack A with Shelf 1 inside it. It read `children` from a flat record that never has any.

**Where:** `frontend/src/modules/inventory/pages/StorageAreasPage.tsx:765`, the delete dialog.
**Fix:**

- Delete is disabled while the area holds items or has active areas nested in it.
- The dialog says "Move them to another storage area first" and "Move or delete those first".
- Nested areas are counted from the page's list.

Covered by a new case in `StorageAreasPage.test.tsx` (fails against the old
page). Re-driven on Turnout Rack A: both reasons shown, Delete disabled.

### W43-3 — MED — The CSV import could not be started without a mouse — ✅ FIXED

**Did:** `quartermaster`, `/inventory/import`, from the keyboard.
**Saw:**

- The file input was `display: none`.
- The dashed zone that opens it was a plain `div` with a click handler.
- No key reached anything that chooses a file, so the page's only job could not be started, and a screen reader heard "Choose a CSV file" as a paragraph.

**Where:** `frontend/src/pages/ImportInventory.tsx:207`.
**Fix:**

- The input is visually hidden but focusable, and named "Choose a CSV file".
- It precedes the zone, which shows a focus ring when it has focus.

Covered by a new case in `ImportInventory.test.tsx`. Re-driven: Tab reached
"Choose a CSV file".

### W43-4 — LOW — The storage tree's expand toggles were unnamed or said only "Expand" — ✅ FIXED

**Did:** `quartermaster`, the storage area list at 1280×900.
**Saw:**

- An area with nothing nested in it carried a disabled button with no name.
- One with children carried "Expand", with no word of which area.

**Where:** `StorageAreasPage.tsx:276`, the tree row.
**Fix:**

- The toggle reads "Expand Turnout Rack A" or "Collapse …", with `aria-expanded`.
- A leaf gets a decorative placeholder instead of a button.

Covered by a new case, and the existing tests now find the toggles by the new
names.

### W43-5 — NIT — The import preview shows rows it will reject as if they were fine — OPEN

The preview listed the nameless row, the unknown category and the −3 quantity
without comment. The problems appear only after Import. Left: the server's
report is complete, so this is earlier feedback, not missing feedback.

### W43-6 — NIT — Room pickers list the station itself as a room — OPEN

Both storage-area room pickers offer "Review Valley Fire Department" alongside
"Training Room A — …", the same doubling as W38-4.

## Checklist

| Section                 | Result                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ nested area created, import reports per row; fixed W43-2                      |
| 2. The right people     | ✅ member 403 on every write, Access Denied on both pages                        |
| 3. Wrong input, failure | ✅ double-clicks acted once; nameless and bad-category rows handled; fixed W43-1 |
| 4. Browser signals      | Fixed W43-1 (500 on the item list)                                               |
| 5. Coming back to it    | ✅ areas and imports survive reload; fixed W43-2 (location lost after delete)    |
| 6. On a phone           | ✅ refusals at 390×844                                                           |
| 7. Everyone can use it  | Fixed W43-3 (import unusable without a mouse), W43-4                             |
| 8. What happens around  | ✅ export neutralises formula cells; W43-5, W43-6 open                           |

## Completion gate

| Check                    | Result                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                       |
| npm run lint             | clean                                                                                                       |
| flake8 (changed files)   | clean                                                                                                       |
| black --check            | clean (after formatting the new test)                                                                       |
| frontend tests (touched) | `modules/inventory`, `ImportInventory` and the touched shared components and pages — 104 files, 1536 passed |
| backend tests (touched)  | `test_inventory_csv_row_bounds`, `test_inventory_import`, `test_inventory_vendors_db` — 40 passed           |
