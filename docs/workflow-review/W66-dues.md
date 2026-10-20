# Workflow Review — W66 Dues: Set Them, Record a Payment, Who Is Behind

**Driven:** 2026-10-14 · **As:** `treasurer`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-14 plus this run's changes · **Database:** continued from W65

---

## What was driven

1. As `treasurer`, Finance → Dues → New schedule:
   - "Create schedule" with nothing filled;
   - "2026 Annual Dues", $120, due 2026-03-01, with Create double-clicked;
   - Generate dues, through its confirmation.
2. "Overdue", to see who is behind.
3. After the fix: "2026 Apparatus Fund levy", $25, due 2026-06-30, generated
   from the screen; then the Overdue filter for each schedule.
4. Jordan Avery's annual dues:
   - a $50 payment, double-clicked;
   - $75 against the remaining $70;
   - the payment history.
5. Waivers:
   - Waive with no reason;
   - the treasurer waiving their own dues;
   - Alex Brooks's dues waived with a reason, double-clicked.
6. As `member`, with `wr.api`: `/finance/dues`, `/finance/dues/summary`. Then
   looked for any screen of their own dues.
7. At 390×844: the dues page, a row's actions, and the payment dialog.

## Held up ✅

- **Schedules:**
  - every field is labelled;
  - an empty Create says "Give the schedule a name…", "Enter an amount greater
    than zero." and "Enter the date dues are due.";
  - a double-clicked Create made one schedule.
- **Generating:**
  - the confirmation states the amount, the schedule, the due date and that a
    re-run skips members already billed;
  - it billed all 20 active members, and the totals read $2,400 expected.
- **Payments:**
  - the dialog prefills the balance and says payments cannot be edited
    afterwards;
  - a double-clicked $50 recorded once ("Partial");
  - the history lists each payment.
- **Waivers:**
  - a reason is required ("Reason is required.");
  - the treasurer waiving their own dues is refused, with the reason ("You
    cannot waive your own dues. Separation of duties requires a second
    person…");
  - Alex's waiver recorded once, and the row offers "Reverse the waiver for
    Alex Brooks".
- **Who sees it:** a member gets 403 on the dues list and the summary.
- **Phone:** no sideways overflow; the schedule and status pills are 44px.

## Findings

### W66-1 — MED — Dues generated after their due date read "Pending", so nobody showed as behind — ✅ FIXED

**Did:** created "2026 Annual Dues", due 1 March, in October, and generated
them.
**Saw:**

- All 20 members read "Pending", and the Overdue filter was empty.
- Read from code, only the daily `run_mark_overdue_dues` moves a record to
  "overdue", so for up to a day the screen's answer to "who is behind" was
  "nobody".

**Where:** `services/finance_service.py`, `generate_member_dues`.
**Fix:** a schedule whose due date has passed generates its dues as overdue.
A naive stored date is read as UTC, as the daily task's comparison does.
**Re-driven:** the levy, due 30 June, generated all 20 as "Overdue", and the
Overdue filter listed them. The annual dues generated before the fix stay
"Pending" until the daily task, which is how existing records were always
moved.

### W66-2 — MED — On a phone, no payment could be recorded and no dues waived — ✅ FIXED

**Did:** opened Dues at 390×844.
**Saw:**

- Each member's card showed name, amounts, date and status, but no "Record
  payment", "Waive" or history button.
- The dues table reflows into cards under 768px, and the reflow hides any
  cell with no `data-label`. The actions cell had none.
- A treasurer taking dues at a meeting, phone in hand, could not record them.

**Where:** `DuesManagementPage.tsx`, the actions cell.
**Fix:** `data-label=""`, as the inventory pages already do.
**Re-driven:** "Record a payment for Tariq Nolan" is visible at 44px, and its
dialog fits the screen with both buttons reachable.

### W66-3 — MED — An overpayment is taken without a word, and counts as collected — 🚩 FLAGGED

**Did:** with $70 left on Jordan's $120, recorded $75.
**Saw:**

- Accepted with "Payment recorded".
- The history reads "$125.00 paid of $120.00", and "Collected" includes the
  extra $5.
- `record_dues_payment` has no check against the balance.

**Why flagged:** money. Refusing an amount the member actually handed over
is wrong too. Whether to refuse, warn, or carry a credit to the next
schedule is the Treasurer's call. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W66-4 — MED — A member cannot see what they owe — 🚩 FLAGGED

**Saw:**

- No screen shows a member their own dues. `/finance/dues` is the treasurer's
  page (`finance.view`).
- `GET /finance/dues` confines a non-manager to their own records, but still
  requires `finance.view`, which a plain member does not hold, so it
  returned 403.
- Read from code, nothing tells a member their dues are due or overdue (no
  notice, email or bell entry).

**Why flagged:** a member-facing dues view, and dues reminders, are features,
and who may see them is a permissions decision. Mirrored to
`docs/KNOWN_LIMITATIONS.md`.

## Checklist

| Section                 | Result                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held: set, generate, pay, waive. Fixed W66-1 (who is behind) and W66-2 (phone). Flagged W66-3. |
| 2. The right people     | Held for the treasurer; separation of duties refuses waiving one's own dues. Flagged W66-4.    |
| 3. Wrong input, failure | Held: required fields; waive needs a reason; double submits record once. Flagged W66-3.        |
| 4. Browser signals      | Only the deliberate refusal (400). No console errors.                                          |
| 5. Coming back to it    | Held: schedules, payments and waivers survive a reload.                                        |
| 6. On a phone           | Fixed W66-2. No overflow.                                                                      |
| 7. Everyone can use it  | Held: labelled dialogs; row buttons named per member ("Record a payment for …").               |
| 8. What happens around  | Flagged W66-4 (no notice to members).                                                          |

## Completion gate

| Check                    | Result                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                                                                   |
| npm run lint             | clean                                                                                                                                                                                   |
| flake8 / black / isort   | clean on `services/finance_service.py` and `tests/test_dues_generation_status.py`                                                                                                       |
| frontend tests (touched) | `src/modules/finance` and `touchTargetIntegrity`: 565 passed. New: the phone-actions case in `duesAdministration.test.tsx` (fails on old code)                                          |
| backend tests            | the dues suites (`test_dues_*`, `test_finance_dues_fk_validation`, `test_finance_quickbooks_dues`): 45 passed. New: `test_dues_generation_status.py` (3, unit, all failing on old code) |
