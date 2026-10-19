# Workflow Review — W64 An Expense Report, From Receipt to Reimbursement

**Driven:** 2026-10-14 · **As:** `member`, `treasurer`, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-14 plus this run's changes · **Database:** continued from W63

---

## What was driven

1. As `member`, My Expense Reports → New Expense Report:
   - Create with nothing filled;
   - "State fire school, October", FY2026, with two lines: "Lunch during
     class", $45.20 (merchant "Diner on Route 7"), and "Mileage to the
     academy", $120 (Travel);
   - Create double-clicked.
2. On the draft:
   - pressed Submit with no receipts;
   - attached a PDF to each line;
   - Submit double-clicked.
3. As `treasurer`, Approvals: approved the "Treasurer review" step. Then
   overrode the "Board sign-off" email step with a reason, since email is off
   here (W62-6).
4. As `treasurer`, the approved report: looked for a way to record the
   reimbursement. After the fix, "Mark Paid" was cancelled once from its
   confirmation, then confirmed with a double-click, then the page reloaded.
5. As `member`: the paid report. With `wr.api`, mark-paid.
6. As `member2`: `member`'s report, the list, and a receipt, by URL and
   `wr.api`.
7. At 390×844: the list, the form with a line added, and the detail page as
   `member` and as `treasurer`.

## Held up ✅

- **The form:**
  - an empty Create says "Title is required" and "Fiscal year is required";
  - the running total read $165.20;
  - a double-clicked Create made one report.
- **Receipts are required:**
  - Submit is disabled with "Attach a receipt to 2 lines before submitting",
    then "… to the remaining line";
  - each file control is named for its line ("Attach receipt for Lunch during
    class");
  - once both were attached, Submit went through once from a double-click.
- **The W63-1 fix shows here:** straight after submitting, the timeline
  showed all three steps and "Waiting on Treasurer position".
- **Uploads fail closed without a malware scanner** (`LB-UPLD-005`). The
  message reached the member: "Files cannot be checked for malware right
  now, so this one was not accepted. Please try again in a few minutes."
  That is the intended behaviour. The harness change below exists only
  because the review install has no scanner.
- **Who sees it:**
  - `member2` got 404 on the report and on its receipt, and an empty list;
  - `member` cannot mark paid (403), and is offered no button.
- **Phone:** no sideways overflow on the list, the form or the detail page.

## Findings

### W64-1 — HIGH — An approved expense report could not be recorded as reimbursed — ✅ FIXED

**Did:** as `treasurer`, opened the approved report.
**Saw:**

- No action at all: only the two receipt downloads.
- `POST /expense-reports/{id}/mark-paid` exists and does the work. It is
  `finance.manage` only, refuses the submitter, takes a locked read against
  double payment, and posts each line's spending.
  `expenseReportService.markPaid` wraps it.
- But nothing in the frontend called either (`grep` of `src/`). So the
  activity this row is named for, "from receipt to reimbursement", could not
  reach its last step, and every approved report stayed "Approved" for good.

**Where:** `ExpenseReportDetailPage.tsx`.
**Fix:**

- A "Mark Paid" button for a finance manager on an approved report.
- It asks first: "Record ER-2026-0001 ($165.20) as reimbursed to the
  member", with "Not yet" and "Mark as paid".
- It then reloads the report. A refusal (for example the submitter marking
  their own report) shows the server's reason.

**Re-driven:**

- "Not yet" left it approved;
- a double-clicked "Mark as paid" recorded once, and the report read "Paid"
  with its time;
- the button was gone after a reload;
- the member saw "Paid".

### W64-2 — LOW — The expense report form's fields had no labels, apart from each line's Date — ✅ FIXED

Title, Description and Fiscal Year, and each line's Description, Amount,
Type and Merchant, were unnamed to a screen reader. Each now carries its
label, with per-line ids.

### W64-3 — LOW — Back links, buttons, filters and "Remove item" were 16–38px on a phone — ✅ FIXED

**Fix:** the expense screens' back links, Create, Cancel, Add Item, Submit,
"New Expense Report", the status filters and "Remove item" are 44px on a
phone or touch screen. These are the same controls W63-4 sized on the
purchase request screens.
**Re-driven:** no control under 44px on any of the four screens.

### W64-4 — HIGH — An expense report is routed by a chain set up for purchase requests — 🚩 FLAGGED

**Did:** submitted the report. The only chains are W62's "Purchases" and
W63's "Large purchases", both "Applies To: Purchase Requests".
**Saw:**

- The report took "Purchases": Treasurer review, then the board chair's
  emailed sign-off, then the notification.
- `resolve_approval_chain` (`finance_service.py`) selects chains whose
  `applies_to` is the request's type **or `PURCHASE_REQUEST`**, and scores
  them without regard to which. So:
  - every purchase-request chain also routes expense reports and check
    requests;
  - an expense chain can lose to a purchase chain that names an amount range
    or category.
- `FINANCE_MODULE.md`'s own example has a "Large Purchase" ($5,000+) chain
  beside a default "General Expense" chain. A $6,000 expense report would
  take Large Purchase and go to the Board of Trustees.
- The chain screen says "Purchase Requests" either way.
- The behaviour dates from the module's first commit (2026-03-12). The schema
  doc mentions an `ALL` value that the enum does not have, which suggests
  `PURCHASE_REQUEST` stood in for "all".

**Why flagged:** matching only the request's own type is the obvious fix, but
it would re-route live requests. An installation whose expense reports and
check requests now ride on purchase chains would see them fall to manual
approval instead. Whether to fix it outright, add an explicit "All requests"
option, or migrate existing chains is the owner's decision, and it needs an
`UPGRADING.md` note. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W64-5 — MED — An expense line cannot be charged to a budget, so reimbursements never reach the budgets — 🚩 FLAGGED

**Saw:**

- The form offers no budget for a line. The lines saved with `budget_id`
  null.
- `mark_expense_paid` adds each line's amount to its budget's spent only
  "if item.budget_id". After this report was paid, both budget lines were
  unchanged (Apparatus Maintenance spent $1,500, committed $240, as before).
- So $165.20 left the department with no budget line showing it.
  `ExpenseLineItemCreate` accepts `budget_id`; nothing sends it.

**Why flagged:** money. Who chooses the line (the member at entry, or the
Treasurer on approval), and whether approval should commit it the way a
purchase request does, is a process decision. Mirrored to
`docs/KNOWN_LIMITATIONS.md`.

## Harness change

`scripts/workflow-review/start.sh` now runs the review backend with
`CLAMAV_ENABLED=false`, overridable with `WR_CLAMAV_ENABLED=true`. The
review install has no ClamAV, so every upload was refused and no receipt,
photo or document could be attached in any activity. Documented in
`docs/workflow-review/README.md`. Production defaults are untouched.

## Checklist

| Section                 | Result                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Fixed W64-1: the report could not be reimbursed. Flagged W64-4 (routing) and W64-5 (no budget).                        |
| 2. The right people     | Held: another member gets 404; only a finance manager marks paid, and the API refuses a member.                        |
| 3. Wrong input, failure | Held: required fields; receipts required before submit; double submits record once; uploads fail closed with a reason. |
| 4. Browser signals      | The 503s are the scanner refusing uploads (by design here). No console errors.                                         |
| 5. Coming back to it    | Held: draft, receipts, approval and payment survive a reload.                                                          |
| 6. On a phone           | No overflow. Fixed W64-3.                                                                                              |
| 7. Everyone can use it  | Fixed W64-2. Receipt controls and the remove buttons are named per line.                                               |
| 8. What happens around  | Flagged W64-5 (reimbursement reaches no budget). No notices (W63-6).                                                   |

## Completion gate

| Check                    | Result                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                                                                                             |
| npm run lint             | clean                                                                                                                                                                                                             |
| frontend tests (touched) | `src/modules/finance` and `touchTargetIntegrity`: 558 passed. New: `expenseMarkPaid.test.tsx` (5; the 3 that need the button fail on old code), and a label case in `memberRequests.test.tsx` (fails on old code) |
| backend                  | no backend change                                                                                                                                                                                                 |
| harness                  | `sh -n scripts/workflow-review/start.sh` clean; the harness restarted and served the run                                                                                                                          |
