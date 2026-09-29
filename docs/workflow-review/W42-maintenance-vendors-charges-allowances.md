# Workflow Review — W42 Maintenance Records, Vendors, Charges and Issuance Allowances

**Driven:** 2026-09-29 · **As:** `quartermaster`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `457f686fe` (the W39–W41 branch) plus this run's changes · **Database:** continued from W41

---

## What was driven

1. As `quartermaster`:
   - `/inventory/admin/maintenance`: the due list and history tab;
   - from Structural Coat → Inspections → "+ Add Record": Record inspection, pass, with Save double-clicked.
2. `/inventory/admin/vendors`:
   - New Vendor "Galls", first with an invalid email, then valid, with Add Vendor double-clicked;
   - Edit, clear the phone, save.
3. `/inventory/admin/charges`: a charge raised by a damaged pool return with the "Charge review" follow-up, applied at −5, then at 0.
4. `/inventory/admin/allowances`:
   - New Allowance: EMS Supplies, all members, 2 per year, with Create double-clicked;
   - then Issue 3 gloves to Harper Hayes from the pool page.
5. As `member` at 390×844:
   - `POST /inventory/maintenance`, `POST /vendors`, `POST /allowances`, `GET /charges` and `PUT /issuances/{id}/charge`;
   - all four pages.

## Held up ✅

- **Maintenance:**
  - A double-clicked Save made **one** inspection record.
  - The coat's last inspection became 9/29/2026, and its next one 9/29/2027, from the category's 365-day interval.
  - The coat stayed assigned.
- **Vendors:**
  - The form is fully labelled.
  - An invalid email was refused.
  - A double-clicked Add made **one** vendor.
  - Clearing the phone saved as a clear, not the old value (pitfall 1).
- **Allowances:**
  - A double-clicked Create made **one** allowance.
  - The pool Issue dialog read "0 of 2 used (annual). 2 remaining", and warned that 3 would exceed it.
  - The server refused the over-allowance issue with a clear message.
- **Refusals:**
  - `member` got 403 on every write and on the charges list, and Access Denied on all four pages.
  - The vendor directory is readable by members by design; account numbers and spend are withheld below `inventory.manage` (read from code).

## Findings

### W42-1 — LOW — An inspection logged after 7 PM Central was dated tomorrow — ✅ FIXED

**Did:** read from code while driving Record inspection, then confirmed under test.
**Saw:**

- The completion date defaults to `new Date().toISOString().slice(0, 10)`, which is the UTC date.
- From 7 PM Central that is already tomorrow, so evening work was dated a day late unless the officer noticed.
- This was the only remaining use of that pattern in the frontend.

**Where:** `frontend/src/modules/inventory/pages/InventoryMaintenancePage.tsx:569`.
**Fix:** `getTodayLocalDate(tz)`, today in the department's zone. Covered by
a new case in `InventoryMaintenancePage.test.tsx` that fakes 9 PM Central and
fails against the old page. Re-driven: the date read 9/29 at 5:50 PM Central.

### W42-2 — LOW — The maintenance form's note misdescribed a passed inspection — ✅ FIXED

**Did:** `quartermaster`, Record inspection on the assigned coat.
**Saw:** the note under the form read:

- before a result was chosen: "This will schedule work without changing the item status";
- after choosing pass: "The item will remain out of service until you deliberately return it to service".

The coat was never out of service and stayed assigned. The pass wording had
been shared with Complete work.
**Where:** `InventoryMaintenancePage.tsx:735`.
**Fix:**

- Before a result: "Choose pass or fail. A failed inspection marks the item out of service."
- After a pass: "This records the inspection without changing the item's status."
- Complete work keeps its own wording.

Covered by a new case, which fails against the old page. Re-driven.

### W42-3 — LOW — The maintenance form's action choice and fields had no state or names — ✅ FIXED

**Did:** as above.
**Saw:**

- **Action buttons:** "Schedule maintenance", "Open repair", "Record inspection" and "Complete work" showed which was chosen by colour only.
- **Unnamed fields:** Maintenance Type, Completion Date, Technician / Vendor, Condition After Work, Cost and Next Due Date.
- **Task Description:** named only by its placeholder.

**Where:** `InventoryMaintenancePage.tsx:560` and the fields below it.
**Fix:** `aria-pressed` on each action, and every field tied to its label.
Covered by the same new case.

### W42-4 — LOW — A charge could be applied at $0 or blank, and the dialog had no name — ✅ FIXED

**Did:** `quartermaster`, Charges → Charge on Jordan's damaged glove box: −5, then 0.
**Saw:**

- −5 was refused (422).
- 0 was applied: "Charge applied", recorded as **charged $0.00**.
- Once charged, a row loses its Charge and Waive actions, so the record cannot be corrected.
- A blank amount is sent as none at all.
- Waive is the action meant for billing nothing.
- The dialog was announced as a bare "dialog".

**Where:** `frontend/src/components/ChargeManagementPanel.tsx:73`, `:278`.
**Fix:**

- Apply Charge needs an amount above $0, and says "Enter an amount above $0. To bill nothing, waive the charge instead."
- The dialog is named by its heading.

Covered by the new `ChargeManagementPanel.test.tsx` (fails against the old
panel). Not re-driven in the browser: the only pending charge had been
applied at $0 while driving, and a direct pool return does not raise a new one.

### W42-5 — LOW — Issue stayed live for an over-allowance quantity it knew would be refused — ✅ FIXED

**Did:** `quartermaster`, Issue 3 gloves to Harper Hayes against an allowance of 2, without Override.
**Saw:** the dialog said "Issuing 3 would exceed it — check Override allowance",
yet Issue was enabled. Pressing it sent the request, and the server refused it
(400).
**Where:** `frontend/src/modules/inventory/pages/PoolItemsPage.tsx:798`.
**Fix:** Issue waits for Override when the quantity exceeds the allowance.
Covered by a new case in `PoolItemsPage.test.tsx`.

### W42-6 — NIT — An item never inspected is never "due" — OPEN

The maintenance page lists items by next due date. An item whose category
requires maintenance, but which has no inspection yet, has none, so it never
appears. Its history is reachable only from a due item. The coat was reached
from its own Inspections tab. Left: whether a never-inspected item counts as
due now is a scheduling choice.

### W42-7 — NIT — 422 messages show the raw field name — OPEN

"charge_amount: Value is out of the allowed range." Same shared formatting as W40-8.

## Checklist

| Section                 | Result                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ inspection, vendor, allowance and a charge each recorded                        |
| 2. The right people     | ✅ member 403 on every write and the charges list; Access Denied on four pages     |
| 3. Wrong input, failure | ✅ four double-clicks acted once; invalid email and −5 refused; fixed W42-4, W42-5 |
| 4. Browser signals      | ✅ the 422 and 400 driven on purpose                                               |
| 5. Coming back to it    | ✅ inspection dates and the cleared phone survive reload; fixed W42-1              |
| 6. On a phone           | ✅ refusals at 390×844                                                             |
| 7. Everyone can use it  | Fixed W42-3, W42-4                                                                 |
| 8. What happens around  | Fixed W42-2; W42-6, W42-7 open                                                     |

## Completion gate

| Check                    | Result                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                     |
| npm run lint             | clean                                                                                                     |
| flake8 (changed files)   | no Python changed                                                                                         |
| black --check            | no Python changed                                                                                         |
| frontend tests (touched) | `modules/inventory` and the touched shared components and pages — 103 files, 1525 passed, no local server |
| backend tests (touched)  | none touched                                                                                              |
