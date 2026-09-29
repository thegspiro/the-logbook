# Workflow Review — W40 Pool Items, Checkouts, Kits and Variant Groups

**Driven:** 2026-09-29 · **As:** `quartermaster`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `f986a6b9a` (the W39 branch) plus this run's changes · **Database:** continued from W39

---

## What was driven

1. As `quartermaster`, `/inventory/admin/pool`:
   - Nitrile Gloves → Issue to Alex Brooks with a quantity of 25 against 19 on hand;
   - the card's Issuances list, then Return, double-clicked;
   - Bulk Issue of 2 each to Blair Carter and Cameron Diaz, with Issue to All double-clicked.
2. `/inventory/checkouts`, with a loan made through `POST /inventory/distribute-items`:
   - Extend to Sep 1 (in the past), then to Oct 5;
   - Check In (Fair), double-clicked.
3. `/inventory/admin/kits`:
   - "New Recruit Kit" (the coat plus 2 gloves), with Create Kit double-clicked;
   - Issue to a member.
4. `/inventory/admin/variant-groups`:
   - "Station Boots", first with a base price of −5, then 89.99, with Create Group double-clicked;
   - then View.
5. As `member`:
   - `POST /items/{id}/issue`, `POST /kits`, `POST /kits/{id}/issue/{user}`, `POST /variant-groups` and `GET /checkout/active`;
   - all four pages.
6. At 390×844: the pool page, its Issue dialog and the loans page.

## Held up ✅

- **Stock moved correctly:**
  - Issuing, returning and bulk issuing moved on-hand and issued counts exactly.
  - The pool return, bulk issue, loan check-in, kit create and group create each acted **once** when double-clicked.
- **Loans:**
  - The page lists the member, loan date, due date and status.
  - A past extension date was refused: "expected_return_at must be in the future".
  - Check In returned the coat as available, in Fair condition.
- **Kits:**
  - A kit issued each line as the right kind: the coat as an assignment, the gloves as a pool issuance of 2.
  - Each kit card's actions are named after the kit.
- **Variant groups:** every field in the group form is named, and a negative price is refused by the browser.
- **Refusals:** `member` got 403 on every write and on the loans list, and Access Denied on all four pages.
- **Layout:** the pool and loans pages fit 390px, and the Issue dialog fits the screen.

## Findings

### W40-1 — MED — A quantity above what was on hand was silently lowered to the maximum, then issued — ✅ FIXED

**Did:** `quartermaster`, Nitrile Gloves → Issue → Alex Brooks, typed 25 with 19 on hand, pressed Issue.
**Saw:**

- The field silently became 19, and Issue handed Alex **all 19**, leaving the shelf at 0.
- Nothing said the number had changed. A mistyped quantity became "issue everything".
- The Return dialog clamped the same way.

**Where:** `frontend/src/modules/inventory/pages/PoolItemsPage.tsx:478`.
**Fix:**

- The typed number stays in the field.
- Above what is on hand, the field says "Only 13 on hand." and Issue is disabled.
- Below 1, it asks for at least 1.
- The Return dialog does the same against the quantity issued.

Covered by new cases in `PoolItemsPage.test.tsx`, failing against the old page.
Re-driven: 25 against 13 on hand showed the message, with Issue disabled.

### W40-2 — LOW — "Allowance: 0/-1 used (none). -1 remaining." — ✅ FIXED

**Did:** as above. EMS Supplies has no issuance allowance.
**Saw:** the dialog printed the backend's "no allowance" placeholder, −1, as figures.
**Where:** `PoolItemsPage.tsx:721`.
**Fix:** "No issuance allowance is set for this category." Covered by a new case.

### W40-3 — LOW — The issuance list named nobody — ✅ FIXED

**Did:** `quartermaster`, Nitrile Gloves → Issuances.
**Saw:**

- Each holder was the first eight characters of their user id.
- The quantity ran into the date: "4e6fcf03...qty 199/29/2026".
- The Return dialog didn't say whose issuance it was returning.
- A quartermaster could not tell who held what.

**Where:** `PoolItemsPage.tsx:193`.
**Fix:**

- Each row names the holder from the member list the page already loads. A holder who has since left reads "Former member".
- The row reads "Devon Ellis 2 · issued 9/29/2026".
- Return is named "Return 2 from Devon Ellis", and the dialog says who the return is from.

Covered by a new case.

### W40-4 — LOW — Controls across the pool page and the kit form had no names — ✅ FIXED

**Did:** `quartermaster`, each dialog above.
**Saw:**

- **Pool page:**
  - The category filter had no name.
  - Every card's "Issue" and "Issuances" read the same.
  - The Issue dialog's quantity and reason were labels tied to nothing.
  - The button that clears a chosen member was a bare "button".
  - In Return to Pool, the quantity, condition and notes were unnamed.
  - In Bulk Issue, each recipient row's member select, quantity and remove button were unnamed.
- **Kit form:** each line item's Item, Category and Qty were unnamed.

**Where:**

- `PoolItemsPage.tsx:570`, `:914` and the dialogs;
- `frontend/src/modules/inventory/pages/EquipmentKitsPage.tsx:470`.

**Fix:** each field is tied to its label or named ("Filter by category",
"Issue Nitrile Gloves", "Recipient 2", "Choose a different member" …).
Covered by new cases in `PoolItemsPage.test.tsx` and `EquipmentKitsPage.test.tsx`.

### W40-5 — LOW — An extended loan came back due a day early — ✅ FIXED

**Did:** `quartermaster`, Temporary Loans → Extend → Oct 5.
**Saw:**

- The loan was listed as due **Oct 4**.
- The picked date was sent as `new Date('2026-10-05')`, which is UTC midnight: 7 PM on Oct 4 in Central.
- A member's own Extend on My Issued Gear did the same.

**Where:**

- `frontend/src/pages/InventoryCheckoutsPage.tsx:115`;
- `frontend/src/modules/inventory/pages/MyEquipmentPage.tsx:224`.

**Fix:** a picked date means the end of that day in the department's zone
(`localToUTC(date + 'T23:59', tz)`), so a loan due Oct 5 is overdue only once Oct
5 is over. Covered by the new `InventoryCheckoutsPage.test.tsx` and a new case in
`MyEquipmentPage.test.tsx`, both failing against the old code. Re-driven: Oct 5
reads "Oct 5, 2026", stored as 11:59 PM Central.

### W40-6 — LOW — One tap on a member's name issued a whole kit — ✅ FIXED

**Did:** `quartermaster`, New Recruit Kit → Issue to a member → Devon Ellis.
**Saw:** the kit was issued the moment the name was pressed: the coat assigned
and 2 gloves issued. In a list of 27 members, a slip onto the neighbouring row
hands every item to the wrong person, with nothing to stop it. The Distribute
dialog, by contrast, asks before it acts.
**Where:** `EquipmentKitsPage.tsx:252`.
**Fix:** it asks first:

- Title: "Issue New Recruit Kit?".
- Message: "Issue 2 items from "New Recruit Kit" to Finley Grant."
- Buttons: "Don't issue" and "Issue to Finley Grant".

Covered by a new case, and the existing issue test now confirms. Re-driven:
"Don't issue" left Finley with nothing.

### W40-7 — MED — A variant group made on this page can never hold anything — FLAGGED

**Did:** `quartermaster`, created "Station Boots", then View.
**Saw:**

- The group said "No variants in this group yet. Add inventory items and assign them to this group."
- **Read from code:** no screen can do that.
  - The item form has no variant group field, although the API accepts `variant_group_id` on create and update.
  - The only way to make variants, Items → Add Item → Generate size variants, creates a new group of its own.
- So every group made on this page stays empty.

**Where:**

- `frontend/src/modules/inventory/components/ItemFormModal.tsx` (no group field);
- `frontend/src/modules/inventory/pages/VariantGroupsPage.tsx:664`.

**Fixed here:** the empty state says what is true: items can't be added to an
existing group from the app yet, and generating size variants makes its own
group. Covered by a new case in `VariantGroupsPage.test.tsx`.
**Flagged because:** whether to add a group picker to the item form, or have
Generate variants fill an existing group, is a design choice. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### W40-8 — NIT — A refused extension shows the raw field name — OPEN

"expected_return_at: expected_return_at must be in the future. (Error code:
LB-VAL-001)". The date field already has a minimum, so only a typed date reaches
this. Left: the wording comes from the shared 422 formatting.

### W40-9 — NIT — The kit member picker calls pool issuances "items assigned" — OPEN

Blair Carter's row read "2 items assigned" for 2 pool-issued boxes of gloves.
Left: the picker is shared, and its count is a total of everything held.

## Checklist

| Section                 | Result                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ issue, return, bulk issue, loan, extend, check in, kit, group; ⚠ W40-7    |
| 2. The right people     | ✅ member 403 on every write and the loans list; Access Denied on four pages |
| 3. Wrong input, failure | ✅ five double-clicks acted once; past extension refused; fixed W40-1, W40-6 |
| 4. Browser signals      | ✅ only the 422 driven on purpose                                            |
| 5. Coming back to it    | ✅ counts and loans survive reload; fixed W40-5 (due date a day early)       |
| 6. On a phone           | ✅ pool page, Issue dialog and loans page at 390×844                         |
| 7. Everyone can use it  | Fixed W40-3, W40-4                                                           |
| 8. What happens around  | Fixed W40-2; flagged W40-7; W40-8, W40-9 open                                |

## Completion gate

| Check                    | Result                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck        | clean                                                                                                                                      |
| npm run lint             | clean                                                                                                                                      |
| flake8 (changed files)   | no Python changed                                                                                                                          |
| black --check            | no Python changed                                                                                                                          |
| frontend tests (touched) | `modules/inventory`, `InventoryCheckoutsPage`, `ReturnItemsModal`, `InventoryScanModal` — 101 files, 1512 passed, run with no local server |
| backend tests (touched)  | none touched                                                                                                                               |
