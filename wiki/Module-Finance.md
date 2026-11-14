# Finance Module

> The full engineering reference is [docs/FINANCE_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/FINANCE_MODULE.md).

The department's internal money workflows: the budget and who owns each line,
purchase requests, expense reports and check requests with configurable
approval chains, member dues, next year's budget from request to board
adoption, board reports, and a QuickBooks Online journal export.

It is **not** an accounting system. There is no general ledger, accounts
payable or receivable, payroll, bank reconciliation or invoicing — the books
stay in QuickBooks, and this module feeds them.

**Off by default.**

## Enabling it

**Organization Settings → Modules → Additional Modules → Finance** (needs
`settings.manage`). Turning it off hides the pages and closes the API; no data
is deleted.

Once on, a **Finance** group appears in the navigation. Its entries follow what
the viewer may open, so a member with no finance role sees only **My Purchase
Requests**, **My Expense Reports** and **My Check Requests**. The Treasurer's
pages (Budgets, Reports, Dues, Settings, Approval Chains, QuickBooks Export) are
reached from the **Quick Links** on the Finance dashboard (`/finance`).

## Permissions

| Permission                    | Grants                                                                                              | Seeded to         |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| `finance.request`             | Raise, submit and track **your own** purchase requests, expense reports and check requests          | Member (everyone) |
| `finance.view`                | Dashboard, budgets, reports, dues; every purchase and check request (expense reports stay own-only) | Treasurer         |
| `finance.manage`              | Fiscal years, categories, budget lines, amendments, paying and issuing, dues, the QuickBooks export | Treasurer         |
| `finance.approve`             | Act on approval steps; decide requests no chain applies to                                          | Treasurer         |
| `finance.configure_approvals` | Build approval chains; override a step assigned to someone else, with a recorded reason             | Treasurer         |
| `finance.budget_review`       | Leadership review of next year's budget; confirm or reject a budget amendment                       | Nobody — grant it |

The IT Manager holds `*` and so has all of them. `finance.request` lives on the
**Member** position rather than on the ranks, so a department that does not want
members raising requests removes it from that one position. `finance.budget_review`
is meant for senior leadership (typically the President and Chief); grant it on
the positions screen. See [Role System](Role-System).

**Ownership is not a permission.** A budget line or category can name an
**owner position**; whoever holds it sees that line on **My Budgets**, including
its transactions, without `finance.view`. Ownership opens reads only.

**Nobody approves their own request.** Whoever holds `finance.approve`, the
requester can never approve or issue their own purchase, check or report — they
may still deny (withdraw) it.

## Pages

| Page                     | Route                               | Who                                                   |
| ------------------------ | ----------------------------------- | ----------------------------------------------------- |
| Finance dashboard        | `/finance`                          | `finance.view`                                        |
| Budgets                  | `/finance/budgets`                  | `finance.view`                                        |
| A budget line            | `/finance/budgets/:id`              | `finance.view`, or the line's owner                   |
| My Budgets               | `/finance/my-budgets`               | any member (lists the lines they own)                 |
| Next year's budget       | `/finance/budget-requests`          | any member (lines they own in a draft year)           |
| Budget requests (review) | `/finance/budget-requests/review`   | `finance.manage` or `finance.budget_review`           |
| Purchase requests        | `/finance/purchase-requests`        | `finance.request`, `finance.view` or `finance.manage` |
| Expense reports          | `/finance/expenses`                 | `finance.request`, `finance.view` or `finance.manage` |
| Check requests           | `/finance/check-requests`           | `finance.request`, `finance.view` or `finance.manage` |
| Approvals                | `/finance/approvals`                | `finance.approve`                                     |
| Reports                  | `/finance/reports`                  | `finance.view`                                        |
| My Dues                  | `/finance/my-dues`                  | any member (their own dues)                           |
| Dues                     | `/finance/dues`                     | `finance.view` (writes need `finance.manage`)         |
| Finance Settings         | `/finance/settings`                 | `finance.manage`                                      |
| Approval Chains          | `/finance/settings/approval-chains` | `finance.configure_approvals`                         |
| QuickBooks Export        | `/finance/settings/quickbooks`      | `finance.manage`                                      |

Request numbers are per fiscal year: `PR-2026-0001` (purchase), `ER-2026-0001`
(expense report), `CK-2026-0001` (check).

## Setting up the year

1. **Finance Settings → New Fiscal Year.** A year is a **draft**, **active** or
   **closed**; only one may be active at a time.
2. **Finance Settings → New Category.** Categories are the department's own
   (none are seeded) and may be nested. Each can name an owner position, a
   QuickBooks account, a functional class (below) and who may charge it.
3. **Budgets → Add budget line** — a category, an amount, and optionally a
   **station** and an **owner position**. A line with no owner inherits its
   category's ("Training Officer (from category)").

### Changing a line's amount: amendments

Once a budget is in force, extra money is recorded as an **amendment** on the
line's page (**Add amendment**: amount, reason, who approved it, approval date),
not by editing the figure. An amendment is entered **pending** and moves no
money until a **second officer** — `finance.budget_review` or `finance.manage`,
and not whoever entered it — confirms it. The page then shows **Original
budget**, **Current budget** and the amendments.

- Amendments cannot be edited or deleted. A mistaken one is undone with
  **Reverse**, which records an offsetting entry (also confirmed by a second
  officer). The entry can take back the whole amendment or only part of it —
  $2,500 entered for $250 is corrected by reversing $2,250 — and an amendment
  is reversed once. A rejected reversal still names the amendment it would
  have reversed.
- Whoever may confirm an amendment — `finance.budget_review` or
  `finance.manage`, other than the officer who entered it — is **emailed**
  when one is entered (the optional _Finance duties_ email), and **Finance ›
  Budget amendments** lists every amendment waiting, across all lines, with
  **Confirm** and **Reject** on each.
- Once a year goes before the board — and throughout an active or closing year —
  a line's amount changes **only** through an amendment. Owner, station and
  notes stay editable.

## Raising and approving a request

A member opens **Purchase Requests**, **Expense Reports** or **Check
Requests → New …**, picks a budget line (the picker shows how much is left), and
submits. The form's **Who will approve this** panel shows the route the request
will actually take before it is sent.

- **Purchase request** — approved → ordered → received → paid. Approval
  **encumbers** the estimate against the line ("Committed"). **Mark Paid**
  asks what was actually paid: the line spends that amount, and the request
  shows any difference from the approved amount ("$30.00 over"). It stays
  disabled until a **receipt or invoice is uploaded** to the request. The
  office marks each step.
- **Expense report** — a member's out-of-pocket claim, one line per expense.
  The member picks each expense's **budget line**; approving the report
  **commits** those amounts to the lines, and paying it moves them to spent.
  **Every line needs an uploaded receipt** before **Submit for Approval** is
  enabled; one upload can be used on several lines of the same report, and a
  **Mileage** line can record its trips instead (priced at the department's
  mileage rate, set under **Settings → Approval chains**). Lines can be edited
  or removed only while the report is a draft.
- **Check request** — a payment by check; **Issue Check** records the check
  number and date, and waits until the **receipt or invoice is uploaded** to
  the request (not for a cash advance or a reimbursement check, whose
  receipts are on the expense report). An issued check is **voided**, not
  cancelled.

Uploaded receipts are filed as documents in a **Finance → Receipts** folder that
only finance rights open.

### Approval chains

**Approval Chains** (`finance.configure_approvals`) defines who approves what, in
order. A chain applies to one type — purchase requests, expense reports or check
requests — and routes only that type: a purchase chain never routes an expense
report or a check request. It can be limited to an amount range or a budget
category; the most specific match wins, then the department's default chain for
that type. Each step is either:

- **Approval** — waits for a person. The approver is a **position**, a
  **permission**, a **specific member**, or an **email address** (for an outside
  approver such as a township trustee, who gets a one-click link valid for 7
  days, single use).
- **Notification** — marked sent and skipped past. **No email is actually sent**
  for a notification step.

Only the step's named approver can act on it, from **Approvals** or the
request's own page. Being named is enough: a Chief named on a step approves or
denies that step without `finance.approve` (on that step only), working from
the request's page that the approval email links to. A step that names nobody
takes any `finance.approve` holder. A `finance.configure_approvals` holder who
also holds `finance.approve` can act on someone else's step by giving an
override reason, which is audit-logged.

**Emails.** When a request reaches an approval step, the members the step names
are emailed (**Finance duties**); when it is approved or denied, the requester
is (**Your purchase, expense and check requests**, with the reason for a
denial). Both are optional and on by default; neither is sent twice. An
email-address step's approval link is its only email. The page flags any step nobody can act
on ("No active member can act on this step") — fix those before relying on the
chain.

A request **no chain matches** — including an expense report or check request
when the department has chains only for purchase requests — waits for approval
with no steps; any
`finance.approve` holder other than the requester decides it from the request's
own page. Approvals lists these below the step rows.

### Rules set by a settings administrator

Three cards at the top of **Approval Chains** are written through the
organization settings, so only `settings.manage` can change them — the finance
officers they bind cannot lift them:

| Card                               | What it does                                                                                                                                                    | Default |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Second approver for large requests | At or above a dollar threshold, a request is approved only once **two different people** have approved it                                                       | Off     |
| Deadline for claiming expenses     | IRS accountable-plan deadline (at most 60 days). `warn` makes the approver confirm the late lines before approving; `block` refuses submission with a late line | Off     |
| Overspending a restricted fund     | `warn` flags a payment its restricted fund cannot cover; `block` refuses the approval; `off` does not check                                                     | Warn    |

The second-approver card also sets, since 2026-11-06:

- **By request type** — purchase requests, check requests and expense reports
  can each have their own threshold, or be turned off. A type left on _Same as
  above_ uses the card's main threshold, which is how every department starts.
- **Who gives the second approval** — name a position (the Treasurer, say).
  A large request then completes only once one of its two approvers holds that
  position; until it does, the request waits for that office and other
  approvers are told so. _Any finance approver_ keeps the old rule.

When a request is held for its second approval, the members who could give it
are emailed once (the optional **Finance duties** email). Someone who approved
by an emailed link counts as the member with that email address, so they
cannot give the second approval as well.

## Cash advances and reimbursing a purchase

- **Cash advance** — on a new check request, tick **This is a cash advance to
  me**. It charges no budget line. The member accounts for it with an expense
  report (**Accounts for a cash advance**) and the office records any unspent
  cash with **Record returned cash**. An advance still outstanding past its
  deadline is overdue, and the member cannot take another until it is
  settled. **Reports → Cash advances** lists what is owed.
- **Advance deadline** _(2026-11-06)_ — the department chooses the IRS method
  on **Approval Chains → Cash advance deadline**: **Fixed date** (120 days
  after the check, the default) or **Quarterly statements** (the member is
  emailed a statement at each calendar-quarter end, and has 120 days from the
  first). An advance keeps the method in force when its check was issued.
- **On a member's behalf** _(2026-11-06)_ — the finance office can raise an
  advance for a member (**Advance for**). The member holds it and is the payee;
  the officer who raised it cannot approve it or issue its check.
- **At year-end close** _(2026-11-06)_ — the lock dialog lists the year's
  outstanding advances apart; they do not stop the lock.
- **Paying back a purchase** — a member who paid for an approved purchase with
  their own money chooses **Request Reimbursement** on it. That creates a draft
  expense report with the purchase copied in. Once the report is approved, the
  office chooses **Pay by Check** (which raises a check request through the
  check approval chain) or **Mark Paid**. Issuing the check marks the report paid
  and the purchase **Reimbursed**; the money is counted once.

## Restricted funds

A fundraising campaign marked **restricted** in
[Grants & Fundraising](Module-Grants-Fundraising) becomes a fund a purchase,
check or expense line can be charged to. Its balance is computed from the
records (received − spent − committed), shown on the request forms and in
**Reports → Restricted funds**.

## Next year's budget

Next year is built in a **draft** fiscal year, which moves through stages on
**Finance Settings**:

1. **Taking requests.** The Treasurer copies this year's lines with **Start from
   last year** (current amounts, owners and stations; amendments and spending are
   not copied) and sets a **Request deadline** (inclusive, on the department's
   calendar). Each line's owner opens **Next year's budget**, chooses **Request
   an amount** with a justification, and submits. A position holder can also
   **Propose a new line**. The Treasurer reviews them on **Budget requests**:
   **Approve as requested**, **Approve a different amount** or **Decline** (a
   note is required for the last two).
2. **Start leadership review.** Owners can no longer change requests;
   `finance.budget_review` holders may **Change amount** on a decided request,
   with a note. Nobody can change a request they submitted or whose line they own.
   The line's owners and the member who submitted it are emailed the old and
   new amount and the note.
3. **Send to the board.** Nothing can change while it is before the board.
4. **Record adoption** — the date and the board's reference (e.g. a vote).
5. **Start the year**, on or after its start date. Line owners are emailed. A
   year cannot start while another is active.

Any stage before adoption can be moved back one step. Emails go out when a
deadline is set or changed, when a request is submitted (to the Treasurer) and
decided (to the owner), and before the deadline to owners who have not asked —
7 days and 1 day before unless the department sets its own days under **Budget
request reminders** on **Finance › Settings** (`finance.manage`), which can
also add a notification-bell entry to each reminder. Otherwise they are
**email only**, under two optional email kinds that are on by default: _Next
year's budget requests_ and _Treasurer duties_. Finance managers are also
emailed, once, when an adopted year reaches its start date and when the
active year passes its end date (`fiscal_year_due_reminders`); neither starts
or closes anything.

## Closing the year

1. **Begin year-end close** on the active year. It reads **Closing**: no new
   requests, but the last bills can still be paid and checks issued. **Reopen**
   returns it to active.
2. **Lock** opens a dialog listing every **open item** — requests submitted,
   pending, approved, ordered or received, and pending amendments — each linked.
   The lock stays disabled until there are none, and needs reconciliation notes.
3. A locked year reads **Closed** and nothing in it changes.

## Dues

**Finance → Dues** (`finance.manage` for every write): **New schedule** (name,
amount, frequency, due date, grace period, late fee, fiscal year, the
membership types it applies to), **Generate dues** for the members it applies
to, **Record payment** (partial payments add up), **Waive**, **Reverse waiver**
and **Payment history**, which names who recorded each payment. A payment with
a transaction reference cannot be recorded twice.

- **Late fees** _(2026-11-06)_ are added once, by a daily task, to dues still
  owing after the due date plus the grace period.
- **Schedules from before 2026-11-06** keep billing every active member with no
  late fee until saved; the form warns first.
- **Finance → My Dues** shows every member their own dues, and members are
  emailed a week before their dues fall due and once when overdue (the optional
  _Your dues_ email kind).

## Reports

**Reports** (`finance.view`) has ten tabs, each with a CSV download and a
**Print** view (use the browser's _Save as PDF_ for a PDF):

| Report                       | Answers                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Budget vs actual             | Where each line stood at the end of a chosen day; "Committed" is shown only for today       |
| Amendment log                | Every amendment of the year, who entered, approved and confirmed it                         |
| Payments register            | Every payment in a period (up to 366 days); voided checks as a negative row on the void day |
| Functional expenses          | Payments by program / management & general / fundraising (IRS Form 990 Part IX)             |
| Restricted funds             | Each restricted fund's received, spent, committed and available                             |
| Cash advances                | Advances not yet fully accounted for, and the overdue part                                  |
| Outside the accountable plan | Expense lines claimed after the deadline, for payroll                                       |
| Expenses by member           | What each member was reimbursed in a period (the payments register, by member)              |
| Dues delinquency             | Dues due in a period: collection totals, and each member overdue today                      |
| Purchases by vendor          | A year's approved and paid purchase requests, by vendor                                     |

The functional class is set on a budget category and inherited by its
subcategories; the office can override it on a single payment.

## QuickBooks export

**QuickBooks Export** (`finance.manage`) produces a QuickBooks Online
**Journal Entries** import file. Paid purchase requests, issued checks, paid
expense reports, and — once their accounts are set — dues payments, cash
advances and returned advance cash are exported as balanced entries numbered by
request number.

1. Give every budget category a QuickBooks account and a **paid-from** account,
   on the category or with **Add mapping**. Subcategories inherit what they lack.
   The **Budget categories** table shows each one **Ready** or what is missing.
2. Optionally upload QuickBooks' **Account List** report (.xlsx or .csv); every
   account is then checked against it by exact name.
3. Under **Run an export**, pick the first and last day and choose **Download
   QuickBooks file**. After importing it into QuickBooks, confirm it under
   **Export history**.

Rules worth knowing:

- **All or nothing.** If any payment in the period has no budget line or no
  usable account, the export is refused with a list of the problems and no file
  is produced. A file must be under 1,000 rows; choose a shorter period if not.
- **Accounts Payable and Accounts Receivable** cannot be used — QuickBooks needs a
  vendor or customer name on those lines, which the file has no column for.
- **Each payment is sent once.** Resending a period needs **Include payments
  already sent to QuickBooks**, and resending payments from a file you confirmed
  as imported is refused (error `LB-FIN-001`) until you confirm the earlier
  entries were deleted in QuickBooks. See [Error Codes](Error-Codes).
- A check voided after it was exported gets a reversing entry (`CK-…-V`) in the
  export covering the void date.
- One export runs at a time per department.
- In QuickBooks itself, turn off account numbers and the duplicate journal
  number warning before importing; the page lists QuickBooks' requirements.

### QuickBooks Online connection (2026-11-06)

Instead of importing files, a department can connect its QuickBooks Online
company: **Connect to QuickBooks** at the top of **QuickBooks Export**
(`finance.manage`). It appears once the server has an Intuit app configured
(`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` —
see [Upgrading](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md));
until then the card says it is not configured and the export works as above.

- Paid purchase requests, issued checks and paid expense reports made on or
  after the connection date post every five minutes (or with **Post now**) as
  QuickBooks expenses to their vendors, using the same account mappings. A
  missing vendor is created.
- Each is posted once, and shows **Accepted by QuickBooks** with QuickBooks'
  record number on the card and on its detail page. A posted payment never
  goes in a file.
- The paid-from account must be a QuickBooks **Bank** account. A payment
  QuickBooks refuses shows the reason and **Send again**; it may instead go in
  the next file.
- Cash advances, dues, advance returns and voided checks still go in the file.
  Void a posted check in QuickBooks too.
- **Disconnect** revokes the connection; payments still waiting go back to
  the file.

## Edge cases

| Scenario                                          | Behavior                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A member opens another member's request by its id | **404**, the same answer as an id that does not exist                                           |
| Approver also raised the request                  | Refused, whatever their permissions; they may still deny it                                     |
| A step's position has no active holder            | The request waits; the chain page flags the step. An approvals admin can override with a reason |
| Two lines for the same category and station       | Allowed; the line picker numbers them apart                                                     |
| A refused request after the budget is amended     | Not reprocessed; the member resubmits                                                           |
| Module turned off with data in it                 | Pages and API close; nothing is deleted                                                         |

## For developers

- **API:** `/api/v1/finance/*` (`backend/app/api/v1/endpoints/finance.py`), gated
  on the `finance` module. Request bodies accept camelCase or snake_case;
  responses are camelCase. Emailed approval links use
  `/api/public/v1/finance/approvals/{token}` (`GET`, `…/approve`, `…/deny`).
- **Models:** `backend/app/models/finance.py`. The original tables are built by
  `create_all()`, not by a migration; later columns arrive through migrations
  guarded for that.
- **Services:** `finance_service.py` (core), `finance_approver_matching.py`
  (who may act on a step), `finance_budget_ownership.py`,
  `finance_budget_access.py`, `finance_budget_request_service.py`,
  `finance_report_service.py`, `finance_reimbursement.py`, `cash_advances.py`,
  `restricted_funds.py`, `functional_expenses.py`; settings are read by
  `app/utils/finance_settings.py`.
- **Frontend:** `frontend/src/modules/finance/`; navigation in
  `components/layout/financeNavigation.ts`.
- **Scheduled task:** `budget_request_reminders`, daily.
- **Notable migrations:** `7db20aa49329` (`finance.request` to members),
  `1be4fbbc235d` (owners and stations), `ca564ba5a9ad` / `c62a98b47406` /
  `0a55dae43a0a` / `0961ffc2cdf1` (amendments, reversals, second-officer
  confirmation, a rejected reversal's display link),
  `9effb8790488` / `5c8be05f2f0f` / `af92f1496c43` (budget requests, planning
  stages and adoption, close and lock), `3c9c5025a380` / `ee9ff4596ce7` (dual
  approval, and its second-approval notice),
  `3f3bd6f3c7e4` / `0d32069fea4d` / `a33ffa561e4f` (QuickBooks tracking, dues
  export, chart of accounts), `390fa30d0200` (functional classes),
  `3decd3ff6ce5` (restricted funds), `252c7517d80a` (charge access),
  `a39a1999776f` (cash advances), `4250eb8b8378` (purchase reimbursement).

## Related

- [Grants & Fundraising](Module-Grants-Fundraising)
- [Role System](Role-System)
- [Module configuration](Configuration-Modules)
- [Error Codes](Error-Codes)
- [Engineering reference: docs/FINANCE_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/FINANCE_MODULE.md)
