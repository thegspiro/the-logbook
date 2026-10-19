# Workflow Review — W63 A Purchase Request Through Its Approval Chain

**Driven:** 2026-10-14 · **As:** `member`, `treasurer`, `chief`, `admin` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-14 plus this run's changes · **Database:** continued from W62

---

## What was driven

1. As `member`, My Purchase Requests → New:
   - Create with nothing filled, then with an amount of −20;
   - "Thermal imaging camera", $1,500, High, FY2026, against Apparatus
     Maintenance, with Create double-clicked;
   - "Submit for Approval" double-clicked, then the timeline read straight
     away.
2. As `treasurer`, a "Large purchases" chain for purchase requests from
   $1,000 up: "Treasurer check" (Treasurer position), then "Chief approval"
   (Chief position). W62's default "Purchases" chain stayed in place.
3. As `treasurer`, Approvals: approved step 1 with a note.
4. As `chief`:
   - the Finance menu;
   - the Approvals queue;
   - the request by its URL;
   - their notifications.
5. As `treasurer`, the approver-coverage report and the chain's screen.
6. As `admin`, "Approve … as approvals admin": first with no reason, then
   with one, double-clicked.
7. As `member`: the result and their notifications.
8. As `treasurer`: Mark Ordered, Mark Received, Mark Paid, with the budget
   line's figures read after each.
9. The deny path:
   - `member` raised "Station recliners" ($300, default chain);
   - `treasurer` denied it, first with no reason, then with one;
   - `member` read the result.
10. At 390×844: the list, the form, the detail page, and the Approvals
    queue.

## Held up ✅

- **The form:** an empty Create says "Title is required" and "Fiscal year is
  required"; −20 is refused ("Amount must be greater than zero"); a
  double-clicked Create made one request.
- **Routing:** the $1,500 request took the more specific "Large purchases"
  chain, and a $300 one the default chain.
- **Single actions:** a double-clicked Submit, Approve or override recorded
  once.
- **The override needs a reason:** with none, "Override reason is required."
  The step it overrides is named in the dialog.
- **Deny:**
  - a reason is required ("Reason is required.");
  - the member sees it under "Denial Reason" and on the timeline;
  - the later steps read "Skipped".
- **The budget line:**
  - approval committed $1,500 (encumbered $240 → $1,740, the $240 being
    W62's request);
  - Ordered and Received changed nothing;
  - Paid moved $1,500 to spent, leaving $240 committed.
- **Phone:** no sideways overflow on any screen.
- **Browser signals:** no console errors. The only failed requests were the
  Chief's 403 and 404 below.

## Findings

### W63-1 — MED — Straight after submitting, the request said it had no approval steps — ✅ FIXED

**Did:** submitted a request as `member` and read its Approval Timeline.
**Saw:**

- "This request has no approval steps", on a request whose status read
  "Pending Approval".
- After a reload, the steps were there ("Waiting on Treasurer position").
- The submit endpoints returned the bare document, whose `approval_steps`
  the schema leaves empty, and the store put that response in place of the
  request. The detail endpoints attach the steps with `_with_approval_steps`.
- Read from code, expense reports and check requests were the same.

**Where:** `api/v1/endpoints/finance.py`: `submit_purchase_request`,
`submit_expense_report` and `submit_check_request`.
**Fix:** all three return the request with its steps, as the detail endpoints
do. Additive: the field was always in the response, just empty.
**Re-driven:** a new submit shows "Waiting on Treasurer position" with both
steps at once.

### W63-2 — MED — The coverage report said a step was covered that nobody could approve — ✅ FIXED

**Did:** after the Treasurer approved step 1, signed in as `chief`, the person
the "Chief approval" step names.
**Saw:**

- No Approvals entry in the Finance menu.
- `GET /finance/approvals/pending` → 403. The request by URL → 404
  ("Purchase request not found").
- The Chief holds no `finance.approve`, which approve, deny and the queue all
  require.
- Yet the coverage report gave the step `eligibleActiveCount: 1` and no
  problem, and Approval Chains showed no warning. It counted members who fill
  the step and ignored the grant. Its own docstring promises it "cannot
  disagree with the enforcement it describes" (pitfall 29).

**Where:** `services/finance_service.py`, `get_approver_coverage` and
`_coverage_problem`.
**Fix:**

- A member counts only if they fill the step and hold `finance.approve`. An
  email step is unchanged, since that approver acts from the link.
- A step filled only by members without the grant reports the new problem
  `no_approve_permission`. The screen reads: "Nobody on this step has the
  finance approval permission, so they cannot approve or deny".
- `FINANCE_MODULE.md` and the wiki API reference list the new code.

**Re-driven:** the screen shows "1 approval step has no one who can act on
it", and on the step, the new wording with "1 request waiting".

### W63-3 — LOW — The New Purchase Request form's seven fields had no labels — ✅ FIXED

Title, Description, Vendor, Estimated Amount, Priority, Fiscal Year and
Budget were unnamed to a screen reader. Each now carries its label.

### W63-4 — LOW — Many controls were 20–38px tall on a phone — ✅ FIXED

**Saw at 390×844:**

| Control                                                                  | Height      |
| ------------------------------------------------------------------------ | ----------- |
| "Back to Purchase Requests"                                              | 20px        |
| The form's Cancel and Create Request                                     | 38px / 36px |
| "New Purchase Request"                                                   | 36px        |
| The ten status filters                                                   | 32px        |
| The detail page's actions (Submit, Mark Ordered, Received, Paid, Cancel) | 34px        |
| The Approvals queue's request link                                       | 20px        |

**Fix:** each is 44px on a phone or touch screen.
**Re-driven:** no control under 44px on the list, form, detail page or
queue.

### W63-5 — MED — The approver a step names may be unable to approve it — 🚩 FLAGGED

**Saw:** in W63-2, a chain the Treasurer set up named the Chief. The Chief
could neither see nor act on the request. Only an approvals admin's override
moved it.
**Why flagged:** W63-2 now makes this visible on the chain screen, but which
rule is right is the owner's call. Either naming a position in a chain lets
its holders approve that step, or a chain may name only people who hold
`finance.approve` (refused when the step is saved). That is a permissions
change. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W63-6 — MED — Nobody is told a request is waiting on them, or that it was decided — 🚩 FLAGGED

**Saw:**

- After submitting, the Treasurer's notification log was empty. After the
  Treasurer's approval, the Chief's was too.
- After approval and after denial, the member's notifications held nothing
  about the request.
- Read from code, `finance_service.py` sends nothing to an approver or a
  requester. Only an email approver gets the link (W62-6).
- `KNOWN_LIMITATIONS.md` already records this for the second approval of
  dual approval and for amendments, but not for an ordinary step or the
  decision.

**Why flagged:** a new notification (email first, pitfall 18) is a feature,
and which events notify is the owner's choice. Mirrored to
`docs/KNOWN_LIMITATIONS.md`.

### W63-7 — MED — "Mark Paid" always records the estimate as the amount paid — 🚩 FLAGGED

**Saw:**

- "Mark Paid" asks nothing. The $1,500 estimate became $1,500 spent.
- The API takes an `actual_amount`, and the service records it, but
  `PurchaseRequestDetailPage` calls `markPaid(id)` without one.
- So an invoice that differs from the quote leaves the budget line wrong,
  with no way to correct it from the screen.

**Why flagged:** money. Whether to prompt for the amount, and what happens to
the difference against the commitment, is the Treasurer's process to decide.
Mirrored to `docs/KNOWN_LIMITATIONS.md`.

## Checklist

| Section                 | Result                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held end to end, once an admin overrode the Chief's step. Fixed W63-1. Flagged W63-5, W63-6, W63-7.                     |
| 2. The right people     | Held: a member sees only their own requests. W63-2 (fixed) and W63-5 (flagged) cover the named approver who cannot act. |
| 3. Wrong input, failure | Held: required fields and a positive amount; override and deny need a reason; double submits record once.               |
| 4. Browser signals      | The Chief's 403 and 404 (W63-2). No console errors.                                                                     |
| 5. Coming back to it    | Fixed W63-1. Otherwise the timeline, decision and denial reason survive a reload.                                       |
| 6. On a phone           | No overflow. Fixed W63-4.                                                                                               |
| 7. Everyone can use it  | Fixed W63-3. The approval buttons name the request.                                                                     |
| 8. What happens around  | The budget line follows the request correctly. Flagged W63-6 (no notices) and W63-7 (paid amount).                      |

## Completion gate

| Check                    | Result                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                                                                                                             |
| npm run lint             | clean                                                                                                                                                                                                                             |
| flake8 / black / isort   | clean on `endpoints/finance.py`, `services/finance_service.py`, `test_finance_submit_returns_steps.py` and `test_finance_approver_enforcement.py`                                                                                 |
| frontend tests (touched) | `src/modules/finance`, `FinanceApprovalPage` and `touchTargetIntegrity`: 560 passed. New: 2 cases in `memberRequests.test.tsx` and 1 in `ApprovalChainsSettingsPage.test.tsx`; the first two fail on old code                     |
| backend tests            | `test_finance*.py` and `test_treasurer_finance_approval_grants.py`: 970 passed. New: `test_finance_submit_returns_steps.py` (3, integration, all failing on old code); a `captain` case in the coverage test, failing on old code |
