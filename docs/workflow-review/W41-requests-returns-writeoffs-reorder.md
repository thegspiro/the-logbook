# Workflow Review — W41 A Member's Request, Return, Write-Off and Reorder, and the Approvals

**Driven:** 2026-09-29 · **As:** `member` → `quartermaster`, with `member` refused · **Viewports:** 390×844, 1280×900
**Commit:** `93fc8978f` (the W39–W40 branch) plus this run's changes · **Database:** continued from W40

---

## What was driven

1. As `member` at 390×844, My Issued Gear → Request Equipment:
   - Nitrile Gloves with a quantity of 0, then 3 with a reason, Submit double-clicked;
   - then "Wildland gloves, size L" as a request for something not listed.
2. As `quartermaster`, `/inventory/admin/requests`:
   - Review the gloves → Approve & fulfill now, first with the method as offered, then as an issuance, double-clicked;
   - Review the wildland gloves → Decline with a note, double-clicked.
3. As `member`, My Requests; then a return notice for 2 of the 3 gloves.
4. As `quartermaster`, `/inventory/admin/returns`:
   - Receive the gloves on the offered count, then with 2, double-clicked;
   - Receive W39's stale coat notice, then Deny it with a note;
   - a damaged one-box return received with the "Write-off review" follow-up.
5. `/inventory/admin/write-offs`: the resulting request, reviewed and then denied.
6. `/inventory/admin/reorder`:
   - New Request from the low-stock quick fill, Create double-clicked;
   - Approve → Mark ordered (PO-1001) → Receive stock.
7. As `member`:
   - request review, return review, write-off list and create, and reorder create;
   - `GET /inventory/requests`;
   - all four pages.

## Held up ✅

- **The member's requests:**
  - A quantity of 0 was refused with "Enter a quantity between 1 and 99".
  - A double-clicked Submit made **one** request.
  - A request for an unlisted item goes to the same queue.
- **Decisions reach the member:** declined and issued both appear in My Requests with the quartermaster's note.
- **Fulfilment and returns:**
  - Fulfilling as an issuance moved stock from 13 to 10 **once**.
  - Receiving the 2 gloves closed the notice and restocked 2.
  - A stale notice cannot take back an item now held by someone else: "Active assignment not found".
  - Denying it records the note.
- **Write-offs:**
  - A write-off review states what approval will do, and demands a note and an acknowledgement.
  - A damaged box returned for write-off is not put back on the shelf.
- **Refusals:**
  - `member` got 403 on every write and on the write-off list, and Access Denied on all four pages.
  - `GET /inventory/requests` returns only the member's own requests (read from code: scoped without `inventory.manage`).

## Findings

### W41-1 — MED — Fulfilling a request for pool stock offered a method the server always refuses — ✅ FIXED

**Did:** `quartermaster`, Nitrile Gloves → Approve & fulfill now → Fulfill Request.
**Saw:**

- The method opened on "Checkout — returnable individual item", taken from the member's "temporary".
- The dialog's own text says "Pool-tracked stock must use issuance".
- Fulfill was refused: "Pool-tracked stock must be fulfilled through an issuance" (400).
- The switch to issuance happened only when the backend suggested the item, never when the member had named it or the quartermaster picked it.

**Where:** `frontend/src/modules/inventory/pages/EquipmentRequestsPage.tsx:302`, `:764`.
**Fix:** a request for a pool item opens on issuance, and picking a pool item
moves the method to issuance. Covered by two new cases in
`EquipmentRequestsPage.test.tsx`, failing against the old page. Re-driven: a
new pool request opened on Issuance and was issued at the first attempt.

### W41-2 — LOW — Receiving a multi-unit return on the offered count was always refused — ✅ FIXED

**Did:** `quartermaster`, Receive on Jordan's return of 2 boxes, observed "good", quantity left as offered.
**Saw:**

- The received quantity was pre-filled with 1.
- The server accepts only the quantity being returned, and replied "Received quantity must match the quantity being returned" (400).
- So every multi-unit return failed on the default.
- The pre-filled number also invited a receipt nobody had counted.

**Where:** `frontend/src/components/ReturnRequestsPanel.tsx:45`.
**Fix:**

- The count starts empty.
- It says "Count what came back. It must match the 2 the member reported."
- Receive stays disabled until it does.

Covered by the new `ReturnRequestsPanel.test.tsx` (fails against the old panel).
Re-driven: disabled until 2 was entered, then received at the first attempt.

### W41-3 — LOW — The return review dialog had no name, and its rows' actions read the same — ✅ FIXED

**Did:** `quartermaster`, the returns queue and Receive.
**Saw:**

- The review dialog was announced as a bare "dialog".
- Each row's icon buttons read "Receive item" and "Deny return" on every row.
- One observed condition read "out of_service", and the rest were lowercase.

**Where:** `ReturnRequestsPanel.tsx:237`, `:24`.
**Fix:**

- The dialog is named by its heading ("Receive Item" or "Deny Request").
- The buttons read "Receive Nitrile Gloves from Jordan Avery" and "Deny return of …".
- Conditions read "Out of service", "Good" and so on.

Covered by the same new test file.

### W41-4 — LOW — The reorder form and its steps had unnamed fields and unmarked requirements — ✅ FIXED

**Did:** `quartermaster`, New Request → Approve → Mark ordered → Receive stock.
**Saw:**

- **New Request:** Item Name, Category, Quantity, Est. Unit Cost, Expected Delivery, Urgency and Notes were labels tied to nothing.
- **Mark ordered:** Vendor and Purchase-order reference were unnamed.
- **Receive stock:**
  - Storage location and Unit cost are required, but neither label said so.
  - Pressing Receive stock only raised the browser's own "Please fill out this field" bubble.
- **Approve:** the step showed "Back / Approve" with nothing saying what was being approved.
- **The page:** the refresh button and both filters were unnamed.
- **Wording:** each step's toast read "… completed" ("Mark ordered completed").

**Where:** `frontend/src/modules/inventory/pages/ReorderRequestsPage.tsx:259` and the workflow dialog.
**Fix:**

- Every field is tied to its label.
- The receive fields are marked "*".
- Approve says "Approve ordering 8 × Nitrile Gloves?".
- The toasts read "Request approved", "Marked as ordered", "Stock received" and "Request cancelled".
- The refresh buttons on Gear Requests, Write-Offs and Reorder are named, and so are the reorder filters.
- Each Gear Request's Review names the item and member.

Covered by new cases in `ReorderRequestsPage.test.tsx`,
`EquipmentRequestsPage.test.tsx` and `WriteOffsPage.test.tsx`.

### W41-5 — MED — A reorder made in the app can never be received — ✅ LABELLED, FLAGGED

**Did:** `quartermaster`, the quick-filled Nitrile Gloves reorder, Approved and Ordered, then Receive stock (5 of 8).
**Saw:**

- "Link an inventory item before receiving stock" (400).
- **Read from code:**
  - The form keeps an `item_id`, but nothing on screen sets it.
  - The low-stock quick fill copies an item's name only, since the low-stock data has no ids.
  - Neither create nor edit has an item picker.
  - Edit is gone once the request is ordered.
- So every reorder created here is unreceivable, and ends cancelled.

**Where:** `ReorderRequestsPage.tsx:549` (form state) and the create/edit form.
**Fixed here:**

- The Receive stock dialog says so before any field is filled: "This request isn't linked to an inventory item, so its stock can't be received here. Receive it against the item itself, then cancel this request."
- Its button is disabled.

Covered by a new case, which fails against the old dialog.
**Flagged because:** how an order gets linked is a design choice:

- an item picker at create;
- linking at receipt;
- or the low-stock data carrying item ids.

Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W41-6 — MED — A write-off raised for one returned box would retire the whole pool item — FLAGGED

**Did:**

- `member` returned 1 box of Nitrile Gloves as damaged.
- `quartermaster` received it with the follow-up "Write-off review".
- Then the write-off queue.

**Saw:**

- The request was for the **item**, Nitrile Gloves, not the box.
- Its review said: "Approval will mark this item retired. It will close 0 active assignment(s), 0 checkout(s), and 4 issuance(s)."
- **Read from code:** approving would retire all 12 boxes on the shelf and end the issuances of Blair Carter, Cameron Diaz, Devon Ellis and Jordan Avery (`review_write_off` retires the item and calls `_release_item_holders`).
- The review screen says so, but offers no way to write off only the returned box.
- Its description read "Return request #9bf6dc77 —", with nothing after the dash.

Denied here with a note. Nothing was retired.
**Where:** `backend/app/services/inventory_service.py:6267` and the return follow-up that raises the request.
**Not fixed because:** writing off part of a pool is a data decision:

- a quantity on the write-off;
- reduce stock without retiring;
- or not offer write-off for a pool issuance at all.

It may need a migration. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W41-7 — NIT — Request Equipment says "1 sizes" — OPEN

Structural Coat's catalog row read "None on hand — you can still ask · 1 sizes".

## Checklist

| Section                 | Result                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ request, decline, fulfil, notify, receive, deny; ⚠ W41-5 reorder cannot be received, W41-6 flagged |
| 2. The right people     | ✅ member 403 on every write and the write-off list, own requests only; Access Denied on four pages   |
| 3. Wrong input, failure | ✅ quantity 0 refused; six double-clicks acted once; fixed W41-1, W41-2                               |
| 4. Browser signals      | Fixed W41-1 (400), W41-2 (400); W41-5 (400) labelled                                                  |
| 5. Coming back to it    | ✅ decisions and notes reach the member's list after reload                                           |
| 6. On a phone           | ✅ Request Equipment and the return notice at 390×844                                                 |
| 7. Everyone can use it  | Fixed W41-3, W41-4                                                                                    |
| 8. What happens around  | Flagged W41-5, W41-6; W41-7 open                                                                      |

## Completion gate

| Check                    | Result                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                                             |
| npm run lint             | clean                                                                                                                                                             |
| flake8 (changed files)   | no Python changed                                                                                                                                                 |
| black --check            | no Python changed                                                                                                                                                 |
| frontend tests (touched) | `modules/inventory`, `ReturnRequestsPanel`, `ReturnItemsModal`, `InventoryScanModal`, `InventoryCheckoutsPage` — 102 files, 1521 passed, run with no local server |
| backend tests (touched)  | none touched                                                                                                                                                      |
