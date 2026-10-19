# Workflow Review — W61 Budgets

**Driven:** 2026-10-14 · **As:** `treasurer`, `admin`, `training_officer`, plus an access probe of `chief`, `secretary` and `member` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-14 plus this run's changes · **Database:** continued from W59

---

## What was driven

1. As `treasurer`, the setup the screen needs, because this install had none.
   In Finance Settings, created:
   - fiscal year FY2026 (2026-01-01 to 2026-12-31);
   - categories "Apparatus Maintenance" and "Training", the latter owned by
     the Training Officer.
2. As `treasurer`, Finance → Dashboard → Budgets:
   - "Add budget line" with an amount of −5;
   - Apparatus Maintenance at $10,000 with notes, Save double-clicked;
   - Training at $2,500, with no owner of its own.
3. Apparatus Maintenance's detail page:
   - Edit: amount to $12,000 and the notes cleared, then a reload;
   - "Add amendment": +$1,500 with a reason, approver and date, "Record
     amendment" double-clicked.
4. As `admin`, the second finance manager: confirmed the amendment, then
   reloaded.
5. As `training_officer`, who owns Training through its category:
   - that line;
   - the Apparatus Maintenance line, by its URL;
   - the Budgets list.
6. With `wr.api`, list and create as `chief`, `admin`, `secretary`,
   `training_officer` and `member`.
7. At 390×844: the list, and the add dialog.

## Held up ✅

- **Adding a line:**
  - a double-clicked Save made one line;
  - −5 was stopped by the field's own minimum ("Value must be greater than or
    equal to 0.");
  - Training showed "Uses the category's owner: Training Officer" in the
    form, and "Training Officer (from category)" in the table;
  - the table and the totals matched the two lines.
- **Editing:** after a reload the amount read $12,000. The cleared notes were
  null in the API and gone from the page (pitfall 1).
- **Amendments:**
  - a double-clicked "Record amendment" made one, shown as "Pending
    confirmation" with the budget unchanged;
  - its author was offered only "Withdraw";
  - `admin` was offered "Confirm", named "Confirm the 10/8/2026 amendment of
    +$1,500.00", behind a dialog that states the amount and the approver;
  - once confirmed, the line read $13,500, "Original budget" and
    "+$1,500.00 (1)", with "Confirmed 10/13/2026 by Riley Owner", and
    "Reverse" in place of Confirm.
- **Who sees what:**
  - only `treasurer` and `admin` could list lines, and only they could
    create (`admin`'s probe got 400 for its dummy ids, not 403);
  - `chief`, `secretary`, `training_officer` and `member` got 403;
  - the Training Officer opened their own line without an Edit button;
  - another line read "Budget not found" for them (404);
  - the list said "Access Denied" with a way back.
- **Browser signals:** no console errors. The only failed requests were those
  expected 404s.
- **Phone:**
  - no page overflow; the nine-column table scrolls inside its card;
  - the add dialog fits the screen with both buttons reachable.

## Findings

### W61-1 — MED — An overspent line read "Near limit" in the list and "Over budget" on its own page — ✅ FIXED

**Read from code, then reproduced in a component test.** Spending is posted
by approved requests (other activities), so no line here could be overspent
in the browser.
**Saw:**

- The list's bar caps each segment so the bar never overflows, and then sums
  those capped widths for its label.
- So the figure stops at 100%, and "Over budget" (shown above 100%) can never
  appear.
- A $1,000 line with $1,200 spent and $100 committed read "100% used · Near
  limit".
- The detail page computes from the amounts and reads "130.0% used · Over
  budget" for the same line (pitfall 29).

**Where:** `BudgetsPage.tsx`, `BudgetProgress`.
**Fix:** the label uses the uncapped figure, as the detail page does. Only
the bar's widths stay capped.

### W61-2 — LOW — The row's chevron link had no name, and both links into a line were 16px tall on a phone — ✅ FIXED

**Saw:**

- A screen reader reached each row's chevron as a link with no name.
- At 390×844, the chevron and the category link were 16px tall.

**Fix:**

- The chevron is named "Open {category}".
- Both links are 44px on a phone or touch screen.

**Re-driven:** at 390×844, no control in the page body is under 44px.

### W61-3 — LOW — The totals row showed an overdrawn Remaining in green — ✅ FIXED

**Read from code.** Each row's Remaining turns red below zero, but the
totals row was fixed green.
**Fix:** the totals row follows the same rule.

## Checklist

| Section                 | Result                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held: add, edit, amend and confirm, each checked after a reload and from the other officer's session. Fixed W61-1.           |
| 2. The right people     | Held: list, create and edit are finance-only; an owner reads only their own line.                                            |
| 3. Wrong input, failure | Held: negative amount refused; double submits made one record. Clearing notes saved.                                         |
| 4. Browser signals      | Held: only the expected 404s.                                                                                                |
| 5. Coming back to it    | Held: the detail page reloads in place; the line's URL opens for an owner and refuses others.                                |
| 6. On a phone           | No overflow; the table scrolls in its card; the dialog fits. Fixed W61-2.                                                    |
| 7. Everyone can use it  | Fixed W61-2 (unnamed link). Every dialog field is labelled; amendment buttons name the amendment.                            |
| 8. What happens around  | Held: the amendment records who entered and who confirmed it. Spending is posted by the request activities, not driven here. |

## Completion gate

| Check                    | Result                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                               |
| npm run lint             | clean, once an unnecessary type assertion in this run's new test was removed                                        |
| frontend tests (touched) | `src/modules/finance` and `touchTargetIntegrity`: 500 passed; `budgetsList.test.tsx` is new, all 3 fail on old code |
| backend                  | no backend change                                                                                                   |
