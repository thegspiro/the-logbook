# Finance Module

> **Status**: Phase 1 (Foundation & Budget Tracking), Phase 1B (Approval Chains), Phase 2 (Purchase Requests), Phase 3 (Expense Reports & Check Requests), and Phase 4 (Dues & Assessments) are **implemented** as of 2026-03-12. Phase 5 (Dashboard, Reports & QuickBooks Export) is planned.
>
> **Availability**: Controlled per organization at runtime via the organization's settings (`enabled_modules`), configured in Organization/Admin Settings. The API routers register unconditionally.
>
> **Permissions**: `finance.request`, `finance.view`, `finance.manage`, `finance.approve`, `finance.configure_approvals`

## Who may do what with a request _(2026-10-07)_

`finance.request` is seeded to **every member** through the `member` position, which every
member holds (migration `7db20aa49329` carries it to departments onboarded
earlier). It is deliberately not a rank default: a rank's grants resolve at
runtime and cannot be withdrawn, while a department that does not want members
raising requests can remove it from the Member position. It is the requester's side of purchase
requests, expense reports and check requests, and it is confined to the
caller's own records: the endpoints scope reads to `requested_by` /
`submitted_by` and refuse another member's record with **404**, exactly as for
an id that does not exist.

| Action                                                                                                       | Gate                                                  | Scope without `finance.manage`                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List / read purchase and check requests                                                                      | `finance.request`, `finance.view` or `finance.manage` | own only, unless the caller holds `finance.view`                                                                                                                                           |
| List / read expense reports                                                                                  | `finance.request`, `finance.view` or `finance.manage` | own only — including for `finance.view` (FIN-5)                                                                                                                                            |
| Create, edit (draft / submitted), submit; add an expense line                                                | `finance.request` or `finance.manage`                 | own only; `finance.view` alone cannot write                                                                                                                                                |
| Cancel a purchase request                                                                                    | `finance.request` or `finance.manage`                 | own **draft** only — a submitted request has approval steps and possibly an encumbrance; the office cancels                                                                                |
| Mark ordered / received / paid, mark an expense paid, issue / void                                           | `finance.manage`                                      | —                                                                                                                                                                                          |
| Attach a receipt — `POST /purchase-requests/{id}/receipt`, `POST /expense-reports/{id}/items/{item}/receipt` | `finance.request` or `finance.manage`                 | own only; a purchase request until paid, an expense line while the report is a draft or submitted. `finance.manage`: until denied or cancelled. Replacing a receipt keeps the earlier file |
| Open a receipt — `GET` on the same paths                                                                     | `finance.request`, `finance.view` or `finance.manage` | whoever may read the record. The file is a document under **Finance > Receipts**, a folder only finance rights open                                                                        |
| `GET /finance/budgets/options?fiscal_year_id=` — id, label, amount left                                      | `finance.request`, `finance.view` or `finance.manage` | org-scoped; the label is the category, plus the station when set, numbered if two still read the same                                                                                      |
| `GET /finance/fiscal-years/options` — active and draft years: id, name, status                               | `finance.request`, `finance.view` or `finance.manage` | org-scoped                                                                                                                                                                                 |
| Budgets, budget summary, fiscal-year list, dashboard, dues                                                   | unchanged (`finance.view` and up)                     | —                                                                                                                                                                                          |

Approval chains, separation of duties and the named-approver enforcement are
unchanged: a member's request goes through the same chain as anyone else's, and
nobody approves or pays their own. `tests/test_finance_member_requests.py` pins
all of the above over HTTP.

## Budget-line owners, stations, and the Create/Edit Budget screen _(2026-10-08)_

**Ownership is by position.** A budget line (`budgets.owner_position_id`) and
a budget category (`budget_categories.owner_position_id`) may each name a
position; both are nullable, `ON DELETE SET NULL`, and added by migration
`1be4fbbc235d`. The rule, defined once in
`backend/app/services/finance_budget_ownership.py`:

| Line's own owner | Category's owner | Effective owner   | `ownerInherited` |
| ---------------- | ---------------- | ----------------- | ---------------- |
| set              | any              | the line's        | `false`          |
| none             | set              | the category's    | `true`           |
| none             | none             | none ("No owner") | `false`          |

A member owns a line when they hold its effective owner position — org-scoped
at every join, active members only, and **in every fiscal year**, closed ones
included (`owned_budgets_query`, `owned_budget_ids`, `user_owns_budget`). Owning
a line grants no write: only `finance.manage` sets amounts, owners and stations.
What an owner may _see_ of their lines is described under
[My Budgets](#my-budgets-the-owners-view-and-the-transaction-list-2026-10-08).

**API** (camelCase both ways; request schemas use `_REQUEST_CONFIG`):

- `POST /finance/budgets` (`finance.manage`) — `fiscalYearId`, `categoryId`,
  `amountBudgeted`, optional `notes`, `stationId`, `ownerPositionId`. A
  **closed** fiscal year is refused with 400 "This fiscal year is closed…";
  draft and active years take lines.
- `PUT /finance/budgets/{id}` (`finance.manage`) — `amountBudgeted`, `notes`,
  `stationId`, `ownerPositionId`. Omitted leaves a field alone and `null`
  clears it; a cleared owner falls back to the category's. An update does not
  move a line to another fiscal year or category. Lowering the amount below
  spent + encumbered is 409 _Insufficient available budget_.
- `GET /finance/budgets[?station_id=]` (`finance.view`) and
  `GET /finance/budgets/{id}` (`finance.view` or the line's owner) — each row adds `stationId`, `stationName`,
  `ownerPositionId`, `ownerPositionName`, `effectiveOwnerPositionId`,
  `effectiveOwnerPositionName` and `ownerInherited`, from one org-scoped join
  rather than a query per row.
- `POST`/`PUT /finance/budget-categories` (`finance.manage`) — optional
  `ownerPositionId` with the same omit / null semantics; responses add
  `ownerPositionId` and `ownerPositionName`.
- `GET /finance/position-options` (`finance.manage`) — the org's positions as
  `{id, name}`. Not `/roles`, whose grants a Treasurer may not hold.
- `GET /finance/station-options` (`finance.manage`) — the org's unarchived
  facilities as `{id, name}`. The name is the one
  `GET /finance/budgets/options` puts in a line's label.

A station or owner position from another department is refused with 400
(`assert_in_org`, CLAUDE.md pitfall #14c). Nothing enforces one line per fiscal
year, category and station: two lines for the same pair are permitted, as the
training guide says, and the options endpoint numbers them apart.

**Screens.** _Finance › Budgets_ gains **Add budget line** (manage only), a
**Station** filter, and **Station** and **Owner** columns ("Training Officer
(from category)" when inherited). The budget detail page shows station and
owner and offers **Edit** to a manager; both open `BudgetFormDialog`.
_Finance › Settings_ gives each category an owner-position picker on create and
a new edit dialog.

## Budget amendments _(2026-10-08)_

When leadership approves extra money for a budget line, the Treasurer records it
as an **amendment** rather than editing the amount: each one is a logged
increase carrying the amount added (> 0), a reason, who approved it (free text,
e.g. "Board vote 10/7"), the approval date (not in the future, on the
department's calendar via `resolve_org_today`), who entered it and when. Table
`budget_amendments`, migration `ca564ba5a9ad`, model `BudgetAmendment`.

**Original vs current.** `budgets.amount_budgeted` stays the live ceiling the
spend checks enforce, so they did not change. Adding an amendment, in one
transaction, locks the line (`SELECT … FOR UPDATE`, the same locking read
`update_budget` uses — CLAUDE.md pitfall #27), checks the year is not locked,
inserts the amendment and raises `amount_budgeted` by its amount. The
**original** budget is computed, never stored: `amount_budgeted` minus the sum
of the line's amendments (`FinanceService._budget_row`). A direct edit of the
amount therefore moves the original by the same amount.

**Fiscal years.** Allowed in draft, active and closed years; refused in a
**locked** one (400 "This fiscal year is locked…"). Locking also freezes a plain
`PUT /finance/budgets/{id}` that _changes_ `amountBudgeted` (same 400). Sending
the unchanged amount, or `notes`, `stationId` and `ownerPositionId`, still
saves: those describe the line and move no money, so they stay editable. The
lock flag is read under a share lock, so neither path slips in beside a
`lock_fiscal_year` that is landing.

A request refused earlier for lack of funds is **not** reprocessed and no email
goes out; the member resubmits (owner decision). Amendments cannot be edited or
deleted — they are the record of what was approved. A mistaken one is corrected
by a reversing entry (below).

**API** (camelCase both ways):

- `POST /finance/budgets/{id}/amendments` (`finance.manage`) — `amount`
  (2 dp, at most the column's 9,999,999,999.99), `reason` (≤ 2000), `approvedBy`
  (≤ 200), `approvedOn` (date). Blank text and a non-positive amount are 422; a
  future date, a locked year, or a total past the column's limit are 400; a
  line in another department is 404. Returns `{amendment, budget}` (201).
  Audited as `finance.budget_amended`.
- `GET /finance/budgets/{id}/amendments` (`finance.view` or the line's owner,
  the line's own gate) — newest first, each with `enteredByName`. Another department's line is 404.
- Every budget response, list and detail, adds `originalAmount`,
  `amendmentsTotal` and `amendmentCount`, from one grouped subquery joined into
  the existing query rather than a query per row.

**Screens.** The budget detail page shows **Original budget**, **Current
budget** and **Amendments: +$X (n)** once a line has been amended, lists the
amendments (approval date, amount, approved by, reason, who entered it and
when), and offers **Add amendment** to a manager unless the year is locked
(`AmendmentDialog`). The Budgets list marks an amended line "(amended)". In a
locked year the Edit dialog shows the amount read-only with "This fiscal year
is locked." and leaves it out of the save.

### Reversing a mistaken amendment _(2026-10-09)_

A mistaken amendment is corrected by a **reversing entry**, never by editing or
deleting it (owner decision, 2026-10-09). The reversal is another
`budget_amendments` row: its `amount` is the original's, negated, and
`reverses_amendment_id` names the original (nullable FK to
`budget_amendments.id`, `ON DELETE SET NULL`, with a UNIQUE key — migration
`c62a98b47406`). It carries its own reason, approver, approval date and
entering member; the original row is untouched.

**Arithmetic.** Recording one lowers `amount_budgeted` by the amount. The
original budget stays `amount_budgeted − Σ amount` over every row, reversals
included, so it does not move. `amendmentsTotal` is the net sum (never negative:
each positive amendment is reversed at most once, for exactly its amount), and
`amendmentCount` counts both rows — an amended-then-reversed line still shows
the Original / Current tiles, and the list explains the zero.

**Rules** (`FinanceService.reverse_budget_amendment`):

- whole-amendment only — no partial reversal; the body carries no amount;
- an amendment is reversed **once** — a second attempt is **409** "This
  amendment has already been reversed.";
- a reversal is never reversed — **400**; to restore the money, record a new
  amendment. A negative row whose link a downgrade dropped still counts as a
  reversal;
- the amendment must be on that line, in the caller's department — otherwise
  **404** ("Amendment not found" / "Budget not found");
- refused in a **locked** year (400, the amendments' message); allowed in draft,
  active and closed years;
- refused with **409** "Insufficient available budget" when the lower budget
  would fall below spent + committed;
- the approval date may not be in the future on the department's calendar (400);
  blank reason or approver is 422.

One transaction, locks in `add_budget_amendment`'s order: the line
(`SELECT … FOR UPDATE`, pitfall #27), then the amendment, then a **locking**
read for an existing reversal — a plain read would answer from the snapshot
taken before the line's lock was granted. The UNIQUE key stands behind that
check (mapped to the same 409).

**API** (camelCase both ways):

- `POST /finance/budgets/{id}/amendments/{amendmentId}/reverse`
  (`finance.manage`) — `reason` (≤ 2000), `approvedBy` (≤ 200), `approvedOn`.
  Returns `{amendment, budget}` (201), `amendment` being the reversal. Audited
  as `finance.budget_amendment_reversed` with `budget_id`, `amendment_id` (the
  reversal), `reversed_amendment_id`, `amount` (negative), `approved_by` and
  `approved_on`.
- `GET /finance/budgets/{id}/amendments` rows gain `isReversal`,
  `reversesAmendmentId`, and — on a reversed amendment —
  `reversedByAmendmentId`, `reversedAt` (when the reversal was entered) and
  `reversedByName` (who entered it), from one more in-org self-join. Existing
  fields are unchanged.

**Screen.** In the Amendments list a manager gets **Reverse** on a confirmed
amendment that is neither a reversal nor already reversed, unless the year is
locked; an
owner sees the list but no button. `ReverseAmendmentDialog` says "This lowers
the current budget by $X. The original amendment stays on record." (prefixed
"Once a second officer confirms it," since 2026-10-09, below), takes Reason,
Approved by and Approval date (today by default), and confirms with **Record
reversal**, after which the page re-reads
the line and the list. A reversal reads "−$X · Reverses the {date} amendment of
+$Y"; a reversed amendment's amount is struck through, with "Reversed {date} by
{name}".

### Second-officer confirmation _(2026-10-09)_

Owner decision, 2026-10-09: an amendment, or a reversal, is entered **pending**
and moves no money until a second officer confirms it. The confirmer holds
`finance.budget_review` or `finance.manage` and is **not** whoever entered it
(`assert_different_person`, the same separation-of-duties check the approval
steps use — 400). Migration `0a55dae43a0a` adds to `budget_amendments`:
`status` (`pending` / `confirmed` / `rejected`, `BudgetAmendmentStatus`;
server default `confirmed`, so every row that existed before the upgrade, which
had already moved the budget, stays confirmed), `decided_by` (FK users,
`ON DELETE SET NULL`), `decided_at` and `decision_note`.

**What changed from the sections above.** Entering an amendment or a reversal
no longer touches `amount_budgeted`; confirming it does, under the same locks
(the line `FOR UPDATE`, then the amendment). `originalAmount`,
`amendmentsTotal` and `amendmentCount` count **confirmed** rows only, and every
budget response adds `pendingAmendmentCount`. Only a confirmed amendment is
reversed; a pending reversal holds its target (a second reversal is 409) until
it is rejected, which clears its `reverses_amendment_id` so the target can be
reversed again — the audit event `finance.budget_amendment_rejected` keeps
`reversed_amendment_id`.

**Confirming** (`FinanceService.confirm_budget_amendment`) re-checks what entry
checked, because the year and the line may have moved since: a locked year is
400, a total past the column's limit is 400, and a negative amount that would
leave spent + committed uncovered is 409 "Insufficient available budget". An
amendment already decided is **409** ("That amendment has already been
confirmed or rejected. Refresh to see where it stands."). **Rejecting** requires a note (≤ 2000, not blank —
422); whoever entered it may reject (withdraw) their own.

**The amount freezes once the budget goes before the board.** A direct
`PUT /finance/budgets/{id}` that changes `amountBudgeted` is 400 ("Once a
budget goes before the board, a line's amount changes only through an
amendment, which another officer confirms.") when the year is active or
closing, or a draft at `board_review` or `adopted`; a draft taking requests or
in leadership review still takes it. Every budget response reports this as
`amountEditable`. A new line in such a year is created at zero only (400
otherwise); its amount then comes by amendment. Owner, station and notes stay
editable throughout. This closes the gap where the Treasurer's line edit could
change an adopted draft.

**Year-end.** A pending amendment holds the year open: `GET
/fiscal-years/{id}/open-items` lists it as kind `budget_amendment` (its
`entityId` is the **line**, "Amendment to {category}"), and the lock is refused
until each one is confirmed or rejected.

**API** (camelCase both ways; another department's line or amendment is 404):

- `POST /finance/budgets/{id}/amendments/{amendmentId}/confirm`
  (`finance.budget_review` or `finance.manage`) — no body. Returns
  `{amendment, budget}` (200). Audited as `finance.budget_amendment_confirmed`.
- `POST /finance/budgets/{id}/amendments/{amendmentId}/reject` (same gate) —
  `{note}`. Returns `{amendment, budget}` (200). Audited as
  `finance.budget_amendment_rejected`.
- Amendment rows add `status`, `decidedBy`, `decidedByName`, `decidedAt`,
  `decisionNote`, and on a reversed amendment `reversalStatus`.

**Screens.** The line's page marks a pending amendment **Pending
confirmation**, says above the figures how many are awaiting confirmation and
that the figures exclude them, and offers **Confirm** (through the app's
confirmation dialog, stating what it raises or lowers) and **Reject** (a
reason, `PromptDialog`) to a reviewer or manager while the year is unlocked —
Confirm is hidden on the viewer's own entry, where Reject reads **Withdraw**. A
confirmed row reads "Confirmed {date} by {name}"; a rejected one is struck
through with "Rejected {date} by {name}: {reason}"; an amendment whose reversal
is pending reads "Reversal entered {date} by {name}, awaiting confirmation" and
is not struck through. The Edit dialog shows the amount read-only when
`amountEditable` is false, and the lock dialog links a pending amendment to its
line.

## My Budgets: the owner's view, and the transaction list _(2026-10-08)_

**Who reads a line.** `GET /finance/budgets/{id}`, `…/amendments` and
`…/transactions` admit `finance.view` **or** the line's owner — the member who
holds its effective owner position (`user_owns_budget`; the rule is
`finance_budget_ownership.py` and nothing re-derives it). One body helper,
`_authorize_budget_view` in `endpoints/finance.py`, applies it to all three, and
`scripts/check_endpoint_permissions.py` knows it as a body authorizer (as with
the scheduling module's shift-officer check), so the docstrings' "finance.view"
is checked against it. Anyone else — a member who owns nothing, the category's
owner on a line whose own owner overrides it, a member whose account is no
longer active, and every other department — gets **404**, the same answer #2991
gives for another member's request, so a line id is no existence oracle.
Ownership opens **reads only**: `PUT /finance/budgets/{id}`,
`POST …/amendments` and `POST …/amendments/{id}/reverse` stay `finance.manage`
(403 to an owner), and the org-wide
`GET /finance/budgets` list stays `finance.view`. Access only widened, for
owners; nothing existing callers could do changed, so there is no
`UPGRADING.md` entry.

**API** (camelCase):

- `GET /finance/my-budgets[?fiscal_year_id=]` (any signed-in member) — the
  caller's lines in every fiscal year, newest year first
  (`owned_budgets_query`), empty — not 403 — for a member who owns nothing.
  Each row is the budget detail row plus `amountRemaining` (budget − spent −
  encumbered) and `percentUsed` (spent + encumbered over the current budget, one
  decimal). Budget rows everywhere now also carry `categoryName`,
  `fiscalYearName` and `fiscalYearStatus`, so a reader without the category and
  fiscal-year lists can label a line.
- `GET /finance/my-budgets/summary` (any signed-in member) — `{ownsAny}`, one
  `LIMIT 1` probe (`user_owns_any_budget`). The navigation asks it once per
  signed-in member (`useOwnsBudgets`) rather than on every page, and adding a
  field to the auth payload instead would have put a finance query into every
  sign-in and refresh. An owner assigned mid-session sees the entry after a
  reload, or at once on opening `/finance/my-budgets`.
- `GET /finance/budgets/{id}/transactions?limit=&offset=` (`finance.view` or the
  owner; `limit` 1–100, default 25) — `{items, total, limit, offset}`, newest
  first. Each item: `kind` (`purchase_request` / `check_request` /
  `expense_report`), `entityId`, `number` (PR-/CR-/ER-), `description`,
  `counterparty` (vendor, payee or merchant), `requesterName`, `status`,
  `amount`, `effect` and `occurredAt`. No payee address, check number or
  payment method.

**What the transaction list counts.** Exactly what `_mutate_budget` counted
against the line, from the same `budget_id` its callers pass, so the listed
`spent` rows add up to `amountSpent` and the `encumbered` rows to
`amountEncumbered`:

| Record                       | Status listed                 | Effect                                         | Date        |
| ---------------------------- | ----------------------------- | ---------------------------------------------- | ----------- |
| Purchase request             | approved / ordered / received | `encumbered`, the estimate                     | approved at |
| Purchase request             | paid                          | `spent`, the actual amount (else the estimate) | paid at     |
| Check request                | issued                        | `spent`                                        | check date  |
| Check request                | voided                        | `none` — reversed by `void_check`, shown so    | check date  |
| Expense report **line item** | report paid                   | `spent`, the item's amount, on the item's line | paid at     |

Excluded because they never moved the totals: drafts, submitted, pending,
denied and cancelled records (a request cancelled after approval had its
encumbrance released). The only way the sum can differ from the stored totals
is `_mutate_budget`'s floor at zero clipping a release larger than the balance.

**Screens.** _Finance › My Budgets_ (`/finance/my-budgets`, any signed-in
member, Finance module on) groups the caller's lines by fiscal year — the
current year, then drafts, then closed years — each card naming the category
and station, the owner ("… (from category)" when inherited), the current
budget (and the original once amended), **Spent**, **Committed** (the
encumbered amount), **Remaining** and a progress bar, linking to the line. With
no lines it explains that a line appears once the Treasurer makes the member's
position its owner. The Finance navigation offers **My Budgets** to anyone who
owns a line — a Treasurer included — and to nobody who would find it empty.
`/finance/budgets/:id` now needs only a session (the API decides) and loads the
line by id instead of finding it in the budget list, which an owner cannot
fetch; for an owner it is read-only (no Edit, no Add amendment, no Reverse) and links back
to My Budgets. Its **Transaction History** is the paginated list above; a row
links to its request only for a viewer who may open it (`finance.view` for
purchase and check requests, `finance.manage` for expense reports). The detail
page now labels encumbered money **Committed**.

## Next-year planning: start from last year, the request deadline, and budget requests _(2026-10-08)_

Next year's budget is built in a **draft** fiscal year. The Treasurer
(`finance.manage`) seeds it from this year, sets a deadline, and each line's
owner — the member holding its owner position, the line's own else its
category's (`finance_budget_ownership.py`, the one definition, pitfall #29) —
proposes an amount. The Treasurer approves it as asked, adjusts it with a note,
or declines it (owner decisions, 2026-10-08). Owners already see previous years
on My Budgets. Step 3a was the API and the Treasurer's two settings controls;
step 3b added the owners' request screen, the Treasurer's review screen and the
emails (see [Screens (3b)](#screens-3b) and
[Budget request emails](#budget-request-emails) below). The code is
`app/services/finance_budget_request_service.py` and
`app/services/finance_budget_request_notifications.py`; the schema change is
revision `9effb8790488` (`fiscal_years.request_deadline`, `budget_requests`).
Step 3b needed no schema change.

**Start from last year** — `POST /finance/fiscal-years/{draftId}/start-from/{sourceId}`
(`finance.manage`) → `{created, skipped}`. Only into a draft year that is not
locked; the source is any other year of the department (normally the active
one); another department's year is 404 either way. Each source line becomes a
draft line with the same category, station, notes and **own** owner position —
a category's owner is not copied onto the line, it keeps arriving through the
category — and `amountBudgeted` equal to the source line's **current** budget
(amendments included) as a starting point the Treasurer edits. Spent and
committed start at zero; amendments are not copied. A category + station that
already has a line in the draft is skipped, so a second run creates nothing.
The draft year's row is locked for the run, so two runs cannot both copy.
Audited as `finance.fiscal_year_started_from`.

**The request deadline** — `fiscal_years.request_deadline` (a date, nullable),
set or cleared (`null`) through the existing `PUT /finance/fiscal-years/{id}`
as `requestDeadline`, and only while the year is a draft (400 otherwise; an
unchanged value sent with another edit is not a change). It is a calendar day
on the department's calendar: requests stay open **through the end of that day
in the organization's timezone** (`resolve_org_today`). Every fiscal-year
response — the list, the detail, create/update/activate/lock and
`/fiscal-years/options` — carries `requestDeadline` and a computed
`requestsOpen`: the year is a draft, not locked, and either has no deadline or
today ≤ deadline. That one function (`requests_open`) is what the API enforces
with, so the flag and the refusal cannot disagree. Audited as
`finance.fiscal_year_request_deadline_set`.

**Budget requests** — table `budget_requests`. A request is for an existing
draft-year line (`budgetId`), or proposes a line that does not exist yet
(`categoryId`, optional `stationId`, and the `ownerPositionId` that will own it).
Amounts are `Numeric(12, 2)`, ≥ 0; `justification` is required.

| Status      | Who moves it there                          | From                    |
| ----------- | ------------------------------------------- | ----------------------- |
| `draft`     | create; **withdraw** (owner or Treasurer)   | — / `submitted`         |
| `submitted` | **submit** (owner or Treasurer)             | `draft`                 |
| `approved`  | **decide** `approve` — approved = requested | `submitted`, or decided |
| `adjusted`  | **decide** `adjust` — an amount and a note  | `submitted`, or decided |
| `declined`  | **decide** `decline` — a note, no amount    | `submitted`, or decided |

- **Who may make, edit, submit, withdraw or delete one.** For a line: a member
  who owns it (`user_owns_budget`). For a proposal: a member who holds the named
  position, in the department and active (`user_holds_position`). Anyone else
  is 403; `finance.manage` may act on anyone's behalf. Owners may change a
  request only while it is `draft` or `submitted` and while `requestsOpen`;
  after the deadline they get 400 _"The request deadline for {year} has
  passed."_ — the Treasurer is not held to the deadline. Delete is for drafts
  only (withdraw a submitted one first); a decided request stays as the record.
- **One live request per line.** A second request for the same line (or the
  same proposed category + station) that is not declined is 409; so is a
  proposal for a category + station that already has a draft-year line —
  request against that line instead. The check is a locking read behind the
  fiscal year's row lock (pitfall #27).
- **Deciding** (`finance.manage` only). `approve` and `adjust` write the
  approved amount into the draft-year line under the same locking read
  `update_budget` uses, refused (409) below what the line has already spent or
  committed; for a proposal the line is created first — its category, station
  and the proposal's position as the line's own owner — and linked
  (`budgetId`). A decision may be changed while the year is still a draft (the
  amount is written again); once the year is active or locked, no decision is
  made or changed. A draft request is not decided — it must be submitted
  (the Treasurer can submit it on the owner's behalf).
- **Who sees which.** `finance.manage` sees every request. Anyone else sees
  requests for lines they own, proposals for positions they hold, and requests
  they submitted; any other request, and every other department's, is 404.
- **Audit.** `finance.budget_request_created`, `…_submitted`, `…_decided`.

**API** (camelCase bodies and responses):

| Method & path                                             | Who                                                     | Notes                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /finance/budget-requests?fiscal_year_id=&status=`    | any signed-in member, scoped as above                   | newest first; bad `status` is 400                                                   |
| `GET /finance/budget-requests/my-lines?fiscal_year_id=`   | any signed-in member                                    | `{fiscalYear, lines: [{budget, request, lastYear…}]}` — the owner screen's one call |
| `GET /finance/budget-requests/{id}`                       | as the list                                             | 404 when not visible                                                                |
| `POST /finance/budget-requests`                           | the line's owner / position holder, or `finance.manage` | creates a `draft`                                                                   |
| `PUT /finance/budget-requests/{id}`                       | owner while open, or `finance.manage`                   | `requestedAmount`, `justification`                                                  |
| `POST /finance/budget-requests/{id}/submit` · `/withdraw` | owner while open, or `finance.manage`                   |                                                                                     |
| `DELETE /finance/budget-requests/{id}`                    | owner while open, or `finance.manage`                   | drafts only                                                                         |
| `POST /finance/budget-requests/{id}/decide`               | `finance.manage`                                        | `{decision: approve\|adjust\|decline, approvedAmount?, decisionNote?}`              |

Each request row carries `lineLabel` ("Category · Station"), `isProposedLine`,
the owner position's id and name (the line's effective owner for a line
request), `requestedAmount`, `approvedAmount`, `status`, `justification`,
`decisionNote`, `submittedByName`/`submittedAt`, `decidedByName`/`decidedAt`,
and the comparison **`lastYearBudgeted` / `lastYearSpent`** (with
`lastYearFiscalYearName`): the **active** year's figures for the same category
and station — "this year", seen from the draft being planned — summed if the
active year has more than one such line, and null when it has none.
`my-lines` returns the draft-year lines the caller owns (`list_my_budgets`'s
rows), each with its live request (else its most recent declined one, else
null) and the same comparison, plus the year's `requestDeadline` and
`requestsOpen`.

**Design decisions taken for this step** (the owner may overrule any):

1. Start from last year copies only a line's **own** owner; inheritance from the
   category carries on through the category.
2. The carried-forward amount is the source line's **current** budget
   (amendments included), not its original.
3. Once a draft year is **activated or locked, decisions are final** — first
   decisions included; money in an active year changes through amendments.
4. **Declining an approved request leaves the line's amount as it is.** The
   Treasurer edits the draft line directly; the decision does not try to
   reconstruct what the line held before.
5. A proposal duplicating a category + station that already has a line is
   refused rather than merged into that line.
6. The Treasurer is not bound by the deadline, may create requests on an
   owner's behalf, and may make a proposal without naming a position (the new
   line then inherits its category's owner).
7. The deadline day is inclusive, and "today" is the department's.

**Screens (3a).** _Finance › Settings_: a draft year's row shows _"Requests close
{date}"_ (or _"No request deadline"_) and a **Requests open / Requests closed**
badge, and below it **Start from last year** (choose the year, defaulting to
the active one, then **Copy lines**; a confirmation names both years; the toast
reads _"{n} lines copied, {m} already there"_) and **Request deadline** (a date,
**Save deadline**, **Clear deadline**, which sends `null`). Types and
`budgetRequestService` for the request API are in the finance module for 3b.
No new route.

**Upgrading.** A new nullable column and a new table; nothing existing changes
behaviour, so there is no `UPGRADING.md` entry. On an installation whose
finance tables were built by `create_all`, the migration adds both; on an empty
database it skips both and `create_all` builds them from the models.

### Screens (3b)

**Next year's budget** — `/finance/budget-requests`, any signed-in member,
Finance module on (the route needs only a session, like My Budgets: what is
the member's is the API's answer). One call, `my-lines`, plus the request list
for proposals. Picked over `/finance/my-budgets/next-year` because the screen
is about requests, it sits beside the API it drives, and the review screen
nests under it.

- A year picker when more than one draft year exists (otherwise the one).
- The deadline, prominently: _"Requests close {date}"_, _"No deadline set"_,
  or _"Requests are closed"_ with _"The deadline for {year} was {date}.
  Requests can be read but no longer changed."_ — from `requestsOpen` and
  `requestDeadline`, formatted with `formatCalendarDate`.
- A card per owned draft-year line: category · station, the owner position,
  **Budgeted {this year}** and **Spent {this year}** (the active year's
  figures, "No line" when it has none), **Requested**, **Approved** (or
  "Declined"), the status badge and the Treasurer's note. While requests are
  open: **Request an amount** (no request, or the last one was declined —
  **Request again**), **Submit** / **Edit** / **Delete draft** on a draft,
  **Edit** / **Withdraw** on a submitted one. Withdraw and Delete confirm
  first (`useConfirm`). Nothing is offered once requests close or the request
  is decided.
- **Propose a new line** (while open, and only for a member who holds a
  position): category, station (optional, "Department-wide"), and **For your
  position** — only the positions the member holds, from
  `GET /finance/budget-requests/proposal-options`. Proposals are listed under
  **New lines you proposed** with the same actions.
- Dialogs are `Modal` (no outside-click close), `form-*` controls. A create
  leaves a blank station out (`|| undefined`); an edit sends both fields it
  owns. Every action re-fetches the screen (pitfall #11); the API's refusal is
  the toast.
- The navigation's **Next year's budget** entry is offered to a member who owns
  a line in a draft year or has a request for one — `plansNextYear` on
  `GET /finance/my-budgets/summary` (two `LIMIT 1` probes, asked once per
  session alongside `ownsAny`).

**Budget requests (review)** — `/finance/budget-requests/review`,
`finance.manage` (the decide endpoint's gate). Linked from the Finance
navigation for managers and from a draft year's row in Finance Settings
(**Review requests**).

- Year picker (draft years), the deadline and **Owners can still change
  requests** / **Closed to owners**, a status filter (default **Submitted**)
  whose options carry counts, and a count per status.
- A table (`rwd-table`, cards on a phone): budget line ("New line" for a
  proposal), owner position, submitted by and when, this year budgeted and
  spent, requested, approved, status. A totals row adds up what is shown:
  requested, this year budgeted, approved (summed in cents).
- **Review** (submitted) or **Change** (decided) opens the decision dialog: who
  asked for what and when, this year's figures, the justification, and
  **Approve as requested** / **Approve a different amount** (amount and note
  required) / **Decline** (note required). The API's refusal is shown in its
  own words; the list is fetched again after a decision. Drafts are listed but
  not decided (the API refuses).

**`GET /finance/budget-requests/proposal-options`** — authenticated, no
permission: `{positions, categories, stations}`, ids and names. Positions are
only those the caller holds (`held_positions_query`); categories are the
department's active ones and stations its unarchived facilities; all three are
empty for a caller holding no position, who could not propose anything.

### Budget request emails

All four are **email only** (pitfall #18: administrative notices, not in
`SmsAlert`; no bell entry, as nothing in Finance has one). Recipients are
resolved inside the department through the ownership resolver (pitfall #29),
active members only. A send that fails is logged and dropped — it never fails
the action. Two new optional email kinds, on by default, govern them
(`email_policy.py`): **Next year's budget requests** (`budget_requests`,
members) and **Treasurer duties** (`finance_duties`, officers).

| Trigger                                                   | Recipients                                                                                                 | Subject                                                                         | Kind              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| A request is submitted                                    | Active `finance.manage` holders (wildcards count), not the submitter                                       | `Budget request to review: {line} ({amount})`                                   | `finance_duties`  |
| A request is approved / adjusted / declined               | The submitter and the active holders of the owning position (line's own, else category's), not the decider | `Budget request approved: {line}` · `… adjusted: {line}` · `… declined: {line}` | `budget_requests` |
| A deadline is set on a draft year while requests are open | Active holders of every position owning a line in that year, once each                                     | `Budget requests for {year} are open until {date}`                              | `budget_requests` |
| The deadline is changed (still open)                      | As above                                                                                                   | `Budget request deadline for {year} changed to {date}`                          | `budget_requests` |
| Scheduled: 7 days and 1 day before the deadline           | Those owners with at least one line in the year no request was submitted for                               | `Reminder: budget requests for {year} close {date}`                             | `budget_requests` |

Clearing a deadline, saving the same date again, or setting one already past
sends nothing. The decision email carries the approved amount and the note;
the submitted email carries this year's figures and the justification; all
link to the owner's or the review screen. User text is escaped.

**The reminder** is the `budget_request_reminders` scheduled task (daily, in
the in-process scheduler, so no operator action is needed; cron `10 8 * * *`
where an external scheduler is used), iterating departments through
`_for_each_org` so one department's failure is logged and the next still runs.
For each draft, unlocked year whose deadline is today or later it picks the
most urgent reminder whose window has begun — the 7-day one from seven days
before, the 1-day one from the day before — so a run missed while the server
was down still goes out on the next one. **Idempotency** is a sent-log: each
reminder and each requests-open email is recorded as an email-channel
`NotificationLog` row (categories `budget_request_reminder` /
`budget_request_window`, metadata naming the year, the deadline and the
offset). A member already recorded for that year, deadline and offset is not
sent it again, and a member sent the requests-open email inside a reminder's
window is not sent that reminder. Moving the deadline starts a fresh set. The
offsets are constants (see
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md#finance--budget-request-reminders-go-out-7-days-and-1-day-before-for-every-department-2026-10-08)).

## Adopting the budget: planning stages, leadership review and the board _(2026-10-09)_

A draft year's budget now moves through stages before it is spent, matching the
department's process: line owners request, the Treasurer decides and closes the
draft for senior leadership's review, it goes before the board, and the board's
adoption — recorded — is what activates it. Migration `5c8be05f2f0f`.

| Stage (`fiscal_years.planning_stage`) | Owners may request | Treasurer decides | Leadership changes amounts |
| ------------------------------------- | ------------------ | ----------------- | -------------------------- |
| `requests` (NULL on a draft reads so) | until the deadline | yes               | no                         |
| `leadership_review`                   | no                 | no                | yes                        |
| `board_review`                        | no                 | no                | no                         |

- **Moves** — `POST /finance/fiscal-years/{id}/planning-stage` `{stage}`
  (`finance.manage`), one stage forward or back, draft and unlocked years only;
  audited `finance.fiscal_year_stage_changed`. `requests_open` is false outside
  `requests`, so the owner screen, the Treasurer's own edits and the deadline
  reminders all stop with it. Moving back to `requests` reopens it.
- **Leadership review** — `POST /finance/budget-requests/{id}/review`
  `{amount, note}` (new permission **`finance.budget_review`**, seeded to no
  position; a department grants it to e.g. the President and Chief). Only in
  `leadership_review`, only on an `approved`/`adjusted` request, never by the
  holder of the line's owner position or the request's submitter (403). The
  amount is written to the line under the decision's locking read (409 below
  spent + committed) and kept in `budget_requests.review_amount`, `review_note`,
  `reviewed_by`, `reviewed_at` beside the Treasurer's `approved_amount`;
  audited `finance.budget_request_reviewed`. A new Treasurer decision (after
  moving back to `requests`) clears it. `finance.budget_review` also reads every
  request (list and detail), as `finance.manage` does.
- **Adoption** — `POST /finance/fiscal-years/{id}/adopt` on a draft in
  `board_review`, body `{adoptedOn, adoptionReference, adoptionNotes?}`; the
  date may not be after the department's today. Stored on the year
  (`adopted_on`, `adoption_reference`, `adoption_notes`,
  `adoption_recorded_by`, `adoption_recorded_at`), the stage set to
  `adopted`, audited `finance.budget_adopted`. An adopted year's stage no
  longer moves. Starting the year is a separate step — see the next section.
- **Lock** refuses a draft year (400).

**Screens.** _Finance › Settings_: a draft row shows its stage badge and the
buttons to move it (each confirmed), with **Record adoption** in board review
opening `BudgetAdoptionDialog` and **Start the year** once adopted; the start-from and deadline controls show only
while taking requests; an adopted year shows _"Adopted by the board {date} ·
{reference}"_. _Finance › Budget requests_ (`/finance/budget-requests/review`)
now admits `finance.budget_review`: a **Leadership** column, and **Change
amount** (`BudgetRequestLeadershipDialog`) on approved/adjusted rows for
leadership in leadership review; the Treasurer's decision buttons show only
while taking requests. The owner's screen names the stage when it is closed
and shows a leadership change with its note.

## Starting, closing and locking a year _(2026-10-09)_

Adoption, the start of the year and its close are separate steps the Treasurer
takes (`finance.manage`), each audited. Migration `af92f1496c43`.

| Step                 | Endpoint                                 | Allowed from                                                 | Effect                                                                            |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Record adoption      | `POST /fiscal-years/{id}/adopt`          | draft in `board_review`                                      | stage `adopted`; `finance.budget_adopted`                                         |
| Start the year       | `POST /fiscal-years/{id}/activate`       | draft in `adopted`, on/after its start date; no other active | `active`; owners emailed (`notify_budget_adopted`); `finance.fiscal_year_started` |
| Begin year-end close | `POST /fiscal-years/{id}/begin-close`    | `active`                                                     | `closed`, `closing_started_at` set; `finance.fiscal_year_close_begun`             |
| Reopen               | `POST /fiscal-years/{id}/activate`       | `closed`, not locked; no other active                        | `active` again; `finance.fiscal_year_reopened`                                    |
| Lock (sign-off)      | `POST /fiscal-years/{id}/lock` `{notes}` | `closed`, not locked, **no open items**                      | `is_locked`, `locked_by`, `locked_at`, `lock_notes`; `finance.fiscal_year_locked` |

- **No automatic close.** Starting a year never closes the current one; it is
  refused (400, naming the active year) until that year's close is begun. The
  start date is compared with the department's today (`resolve_org_today`).
- **What each status admits** (`FinanceService._require_year_accepts`, read
  under a share lock on the year's row so it waits out a lock that is
  landing). _New_ — create, edit, add a line item to, or submit a purchase
  request, expense report or check request — needs a draft or active year.
  _Finish_ — mark ordered/received/paid, cancel, pay an expense report, issue
  or void a check — needs only a year that is not locked, so a closing year
  settles its last bills. Approvals are not gated: a locked year has nothing
  left to approve, which the lock's open-items rule guarantees. Budget
  amendments keep their own rule (refused only when locked).
- **Open items** (`GET /fiscal-years/{id}/open-items`): purchase requests
  `submitted`, `pending_approval`, `approved`, `ordered` or `received`;
  expense reports and check requests `submitted`, `pending_approval` or
  `approved`. Drafts are not open items — they moved no money and can no
  longer be submitted. The lock re-reads the list under the year's row lock
  and refuses while it is non-empty, naming the count and the first five
  numbers.
- **`closeDue`** on the year response: active, not locked, and the
  department's today is after its end date. _Finance › Settings_ shows a
  banner for it.

**Screens.** _Finance › Settings_ labels a closed, unlocked year **Closing**
and a locked one **Closed**. The active year offers **Begin year-end close**; a
closing year offers **Reopen** and **Lock**, which opens
`FiscalYearLockDialog`: the open items (each linked to its request), and the
required reconciliation notes, with the lock disabled while anything is open.
A locked year shows _"Locked {date} · {notes}"_.

## Expense receipts are required _(2026-10-09)_

Builds on the uploaded receipts above (a document under **Finance >
Receipts**, linked by `receipt_document_id`, migration `c0bf0b155719`).

- **The requirement.** `submit_expense_report` refuses (400) a report with any
  line lacking `receipt_document_id`, naming up to three lines. Reports
  submitted before this are unaffected; the typed `receipt_url` does not
  count.
- **Who reads a report and its receipts**
  (`GET /finance/expense-reports/{id}` and
  `GET …/items/{item_id}/receipt`, both through `_readable_expense_report`):
  its submitter, `finance.manage`, and its approvers
  (`FinanceService.reviews_entity`) — anyone its chain's steps name
  (`user_matches_step`, the rule approve/deny enforce), anyone who has acted
  on one of its steps, an approvals administrator, and, for a submitted report
  no chain applies to, any `finance.approve` holder (they approve it by hand).
  A draft has no approvers. Everyone else gets 404. Before this, the approvals
  queue linked an approver without `finance.manage` to a report that answered 404.
- **The year's close.** Attaching a receipt also passes
  `require_year_accepts`: a member's (`new`) is refused in a closing or locked
  year; a finance manager's (`finish`) only in a locked one, so the office can
  file evidence for what it is settling.
- **Screen.** _Expense report_ disables **Submit for Approval** while any line
  has no receipt, with the count of lines still missing one beside it.

## Context

Fire departments need internal financial workflows (budgets, purchase approvals, dues, expense reimbursements) but most use external accounting software like QuickBooks for actual bookkeeping. This module fills the gap: it provides the **internal operational finance workflows** that QuickBooks doesn't handle, with export capabilities to feed data into external accounting tools.

This is a **standalone module** (`/finance`) separate from the existing `grants-fundraising` module, but cross-referencing its data for dashboards and reports.

**Explicitly excluded:** General ledger, AP/AR, payroll, bank reconciliation, invoice generation, tax prep, chart-of-accounts management.

---

## Phase 1: Foundation & Budget Tracking

### Backend

**New model file:** `backend/app/models/finance.py`

Tables:

- **`fiscal_years`** — id, organization_id, name (e.g., "FY2026"), start_date, end_date, is_active, is_locked, created_by, created_at, updated_at
- **`budget_categories`** — id, organization_id, name, description, parent_category_id (self-referential for hierarchy), sort_order, is_active, qb_account_name (optional QuickBooks mapping), created_at, updated_at
- **`budgets`** — id, organization_id, fiscal_year_id (FK), category_id (FK), amount_budgeted `Numeric(12,2)`, amount_spent `Numeric(12,2)` (denormalized for performance), amount_encumbered `Numeric(12,2)` (pending POs), notes, station_id (FK, nullable — for per-station budgets), created_by, created_at, updated_at

Enums:

- `FiscalYearStatus`: DRAFT, ACTIVE, CLOSED
- `BudgetCategory` defaults: APPARATUS, TRAINING, FACILITIES, PERSONNEL, OPERATIONS, COMMUNICATIONS, PPE, MEDICAL_SUPPLIES, FUEL, UTILITIES, INSURANCE, ADMINISTRATIVE, OTHER

**New schema file:** `backend/app/schemas/finance.py`

- FiscalYearCreate/Update/Response
- BudgetCategoryCreate/Update/Response
- BudgetCreate/Update/Response, BudgetSummaryResponse (with % used, remaining)

**New service file:** `backend/app/services/finance_service.py`

- FiscalYear CRUD (with constraint: only one active per org)
- BudgetCategory CRUD (hierarchical)
- Budget CRUD with auto-recalculation of amount_spent from linked transactions
- Budget health check (% consumed, projected overspend)

**New endpoint file:** `backend/app/api/v1/endpoints/finance.py`

- `GET/POST /finance/fiscal-years`
- `GET/PUT /finance/fiscal-years/{id}`
- `POST /finance/fiscal-years/{id}/adopt`, `/activate`, `/begin-close`, `/lock`
  and `GET /finance/fiscal-years/{id}/open-items` — see "Starting, closing and
  locking a year"
- `GET/POST /finance/budget-categories`
- `PUT/DELETE /finance/budget-categories/{id}`
- `GET/POST /finance/budgets`
- `GET/PUT /finance/budgets/{id}`
- `GET /finance/budgets/summary` (aggregated budget-vs-actual)

**Register in:** `backend/app/api/v1/api.py` — `api_router.include_router(finance.router, prefix="/finance", tags=["finance"])`

**Availability:** Module visibility is controlled per organization via the organization's `enabled_modules` setting (Organization/Admin Settings), not a deployment env var. The router registers unconditionally.

**Permissions** (add to `backend/app/core/permissions.py`):

- New category: `FINANCE = "finance"`
- `finance.request` — Create, submit and track your own purchase requests, expense reports and check requests (every member; see **Who may do what with a request** above)
- `finance.view` — View financial data, budgets
- `finance.manage` — Manage budgets, fiscal years, categories
- `finance.approve` — Approve purchase requests, expenses, check requests (used as a fallback approver type when no chain is configured)
- `finance.configure_approvals` — Manage approval chains and steps (typically Treasurer or admin only)

### Frontend

**New module:** `frontend/src/modules/finance/`

- `index.ts` — barrel export
- `routes.tsx` — `getFinanceRoutes()`
- `types/index.ts` — TypeScript interfaces and enums
- `services/api.ts` — module axios instance (with auth interceptors per CLAUDE.md)
- `store/financeStore.ts` — Zustand store

Pages (Phase 1):

- `FinanceDashboardPage` — `/finance` — overview with budget health cards
- `BudgetsPage` — `/finance/budgets` — budget list with category breakdown
- `BudgetDetailPage` — `/finance/budgets/:id` — line items, actuals, chart
- `FiscalYearSettingsPage` — `/finance/settings` — fiscal year + category management (protected: `finance.manage`)

**Register in:** `frontend/src/App.tsx` — add `{getFinanceRoutes()}` inside protected route block

### Migration

**New file:** `backend/alembic/versions/YYYYMMDD_XXXX_create_finance_tables.py`

- Create fiscal_years, budget_categories, budgets tables
- Seed default budget categories

---

## Phase 1B: Configurable Approval Chains

Modeled after the existing `MembershipPipeline` / `MembershipPipelineStep` / `ProspectStepProgress` pattern in the codebase, but tailored for financial approvals.

### Concept

An **Approval Chain** is a reusable template that defines _who_ must approve a financial request and _in what order_. Each organization configures chains for different scenarios. When a request is submitted, the system determines which chain applies and creates step-by-step approval records.

### Backend

**Additional tables in `finance.py`:**

- **`approval_chains`** — id, organization_id, name (e.g., "Training Purchase Approval", "Large Equipment Purchase"), description, applies_to (enum: PURCHASE_REQUEST, EXPENSE_REPORT, CHECK_REQUEST, ALL), min_amount `Numeric(12,2)` (nullable — threshold floor), max_amount `Numeric(12,2)` (nullable — threshold ceiling), budget_category_id (FK, nullable — restrict to specific category), is_default (bool — fallback chain when no threshold/category match), is_active, created_by, created_at, updated_at

- **`approval_chain_steps`** — id, chain_id (FK approval_chains, ondelete CASCADE), step_order (Integer — 1, 2, 3...), name (e.g., "Training Officer Review", "Board of Trustees Approval"), step_type (enum: APPROVAL, NOTIFICATION — see below), approver_type (enum: POSITION, PERMISSION, SPECIFIC_USER, EMAIL; nullable for NOTIFICATION steps that only use `notification_emails`), approver_value (String — position slug like "training_officer", permission like "finance.approve", user_id, or email address), notification_emails (JSON array, nullable — additional email addresses to notify when this step is reached or completed), email_template_id (FK, nullable — custom email template; uses default approval request/notification template if null), allow_self_approval (bool, default false), auto_approve_under `Numeric(12,2)` (nullable — auto-approve if amount below this), required (bool, default true — skippable steps), created_at

- **`approval_step_records`** — id, chain_id (FK), step_id (FK approval_chain_steps), entity_type (enum: PURCHASE_REQUEST, EXPENSE_REPORT, CHECK_REQUEST), entity_id (String — FK to the actual request), status (enum: PENDING, APPROVED, DENIED, SKIPPED, AUTO_APPROVED), assigned_to (FK users, nullable — reserved and never written: who may act on a step is decided from the step's approver_type/approver_value at the moment someone acts, see **Who may act on a step** below), acted_by (FK users, nullable), acted_at (DateTime, nullable), notes (Text, nullable), created_at

Enums:

- `ApprovalEntityType`: PURCHASE_REQUEST, EXPENSE_REPORT, CHECK_REQUEST
- `ApprovalStepType`: APPROVAL, NOTIFICATION
- `ApproverType`: POSITION, PERMISSION, SPECIFIC_USER, EMAIL
- `ApprovalStepStatus`: PENDING, APPROVED, DENIED, SKIPPED, AUTO_APPROVED, SENT

**Step types explained:**

- **APPROVAL** — Requires a human to approve or deny. The chain pauses here until someone acts. This is the default.
- **NOTIFICATION** — Sends an email (and/or in-app notification) and auto-advances to the next step. Does not block the chain. Status goes straight to SENT. Use this for "FYI" steps (e.g., notify the Chief after Trustees approve) or as a final step to email a confirmation/summary.

**EMAIL approver type:** When `approver_type = EMAIL`, the `approver_value` is a single email address (a comma-separated list is refused when the step is saved). This supports:

- External approvers who aren't system users (e.g., a Township Trustee who doesn't have a login)
- Notification-only steps to external parties (e.g., "email the accountant when approved")
- For APPROVAL steps with EMAIL type, the system generates a secure token link (like the existing `TrainingApproval.approval_token` pattern) so the external party can approve/deny via a one-click email link without logging in
- **A token follows the step's current approver** _(2026-10-04)_: approving or denying by token is refused — answered like an unknown token, 404 — once the step is no longer an EMAIL approval step, so a link mailed before an admin reassigned the step to a position or a member stops working
- **Approval tokens are single-use and consumed atomically** _(2026-08-16)_: the token row is locked (`SELECT … FOR UPDATE`) while the action runs and the token is cleared on approve/deny, so a forwarded or double-clicked link cannot action a step twice — the second attempt sees the step as already actioned

### How It Works

**Chain resolution (on submit):**

1. Look up chains matching `applies_to` + `budget_category_id` + amount within `min_amount`/`max_amount` range
2. If multiple match, use the most specific (category + amount > category only > amount only > default)
3. If no chain matches, use the org's `is_default` chain
4. If no default chain exists (or the chain has no steps), the request waits in `pending_approval` with no approval steps, and anyone with `finance.approve` other than the requester approves or denies it directly from the request's detail page (`/finance/approvals/manual/...`)

**Step progression:**

```
Member submits PR for $3,000 in Training budget
  → System resolves chain: "Training Purchases > $1,000"
  → Step 1: Training Officer (APPROVAL, position: "training_officer") → PENDING
  → Step 2: Board of Trustees (APPROVAL, position: "trustee") → waiting
  → Step 3: Email Confirmation (NOTIFICATION, email: "treasurer@dept.org") → waiting

Training Officer approves Step 1 → Step 2 becomes PENDING
  → In-app notification sent to all users with "trustee" position

Any Trustee approves Step 2 → Step 3 fires automatically
  → Email sent to treasurer@dept.org with approval summary → status: SENT
  → All steps complete → PR status → APPROVED
  → Budget encumbrance applied
```

**Example chain configurations:**

| Chain Name        | Applies To       | Amount Range            | Steps                                                                                                                     |
| ----------------- | ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Small Purchase    | PURCHASE_REQUEST | $0 - $500               | 1. Any officer (APPROVAL, permission: `finance.approve`)                                                                  |
| Medium Purchase   | PURCHASE_REQUEST | $500 - $5,000           | 1. Dept officer (APPROVAL) → 2. Treasurer (APPROVAL) → 3. Email accountant (NOTIFICATION)                                 |
| Large Purchase    | PURCHASE_REQUEST | $5,000+                 | 1. Dept officer → 2. Treasurer → 3. Board of Trustees → 4. Email accountant (NOTIFICATION)                                |
| Training Expense  | EXPENSE_REPORT   | any, category: Training | 1. Training Officer → 2. Treasurer                                                                                        |
| Uniform Reimb.    | EXPENSE_REPORT   | any, category: PPE      | 1. Quartermaster → 2. Treasurer                                                                                           |
| General Expense   | EXPENSE_REPORT   | (default)               | 1. Any officer (permission: `finance.approve`)                                                                            |
| Check Request     | CHECK_REQUEST    | (default)               | 1. Treasurer → 2. President → 3. Email confirmation (NOTIFICATION, email: treasurer + external accountant)                |
| External Approval | PURCHASE_REQUEST | $10,000+                | 1. Chief → 2. Township Trustee (APPROVAL, EMAIL: trustee@township.gov — token link) → 3. Notify department (NOTIFICATION) |

**Special behaviors:**

- `auto_approve_under`: If a step has this set and the request amount is below it, the step is automatically marked APPROVED (e.g., Training Officer auto-approves training expenses under $100)
- `allow_self_approval`: By default false — prevents the requester from also being the approver at any step. Set true for positions like Treasurer submitting their own expense reports (they still need the next step's approval)
- `required: false`: Optional review steps that can be skipped (e.g., "FYI to Chief" — if Chief doesn't act within X days, it auto-advances)
- **NOTIFICATION steps**: Auto-advance immediately after sending. Emails use the built-in SMTP/provider service + Jinja2 templates (same infra as existing notification emails). The default template includes: request type, amount, requester name, approval chain summary, and a link to view the request. Custom templates can be assigned via `email_template_id`
- **EMAIL approver for APPROVAL steps**: Generates a time-limited secure token (reuses the `TrainingApproval` token pattern). The email contains "Approve" and "Deny" buttons that link to a public endpoint (`/api/public/finance/approvals/{token}/approve` and `/deny`). Token expiry configurable per chain (default 7 days). If expired, the step must be re-sent or manually handled by an admin
- **`notification_emails` on any step**: Even APPROVAL steps can have `notification_emails` — these addresses get a "heads up" email when the step is reached (not actionable, just informational). Useful for keeping stakeholders in the loop without giving them approval authority

### Who may act on a step _(2026-10-04)_

Approve and deny check the caller against the step's named approver, in addition to `finance.approve` on the endpoint. The rule lives in one place, `app/services/finance_approver_matching.py`, and the pending list, the request detail pages and the coverage report all read it from there:

| `approver_type` | Who matches                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none)_        | any active `finance.approve` holder — the behaviour before enforcement                                                                                                         |
| `position`      | an active member holding a position in the same organization whose slug equals `approver_value` (case-insensitive)                                                             |
| `permission`    | an active member granted `approver_value` by the normal permission check, so `*`, module wildcards, rank defaults and legacy permission names count as they do everywhere else |
| `specific_user` | the member whose id is `approver_value`                                                                                                                                        |
| `email`         | the active member whose account email is `approver_value` (case-insensitive); an outside approver uses the emailed link instead                                                |

- **Override.** A `finance.configure_approvals` holder who does not match may still approve or deny by giving `overrideReason` (up to 2000 characters). Without one the call is refused with 403, naming who the step is assigned to. Anyone else who does not match gets 403 "This step is waiting on …".
- **Separation of duties is unaffected.** The requester can never approve their own request, override or not; a requester may still deny (withdraw) their own.
- **Audit.** `finance.approval_step_approved` / `finance.approval_step_denied` record `override`, `approver_type`, `approver_value`, and `override_reason` when overriding; an override is logged at `warning`.
- **Steps are validated when saved.** Setting an approver on an approval step requires a value that resolves: a position slug that exists in the organization, an active member of the organization, a known permission name (or `*`; a module wildcard such as `finance.*` is refused), or one valid email address. A step saved before this rule keeps working and can still be renamed; changing its approver re-validates it. Notification steps are not checked.
- **Detail pages.** Each entry in a request's `approvalSteps` carries `assigneeLabel`, and, for the viewer, `canAct` / `requiresOverride` on the step the request is waiting on, so a page does not re-derive the rule.
- **Finding steps nobody can act on.** `GET /finance/approval-chains/approver-coverage` lists every approval step with the number of active members who match it, a `problem` (`no_value`, `not_found`, `no_active_members`, `invalid_email`) and how many requests are waiting on it now.
- Requests with no approval chain are unchanged: any `finance.approve` holder other than the requester decides them manually. The dashboard's pending-approvals count is also unchanged and still counts every request waiting on a step.

### Endpoints

- `GET/POST /finance/approval-chains`
- `GET/PUT/DELETE /finance/approval-chains/{id}`
- `GET/POST/PUT/DELETE /finance/approval-chains/{id}/steps` (manage steps within a chain)
- `GET /finance/approval-chains/preview?entity_type=purchase_request&amount=3000&category_id=X` (preview which chain would be selected — useful for the UI)
- `GET /finance/approval-chains/approver-coverage` (every approval step and who can act on it; `finance.configure_approvals`)
- `GET /finance/approvals/pending` (the step each request is currently waiting on, one row per request, across all entity types, limited to the steps the caller is the named approver of; an approvals admin also sees the rest, flagged `requiresOverride`. Each row carries `approverType`, `approverValue`, `assigneeLabel`, `canAct`, `requiresOverride`; powers the Approvals page)
- `POST /finance/approvals/{step_record_id}/approve` and `.../deny` (body `{notes?, overrideReason?}`; 403 when the caller is not the step's named approver — see above)
- `GET /finance/approvals/unrouted` (requests in `pending_approval` that have no approval steps because no chain applied)
- `POST /finance/approvals/manual/{entity_type}/{entity_id}/approve` (body `{notes?}`; notes go to the audit log) and `.../deny` (body `{reason}`, required) — only for a request with no approval steps; a request with steps returns 409

### Frontend

Pages:

- **ApprovalChainsSettingsPage** — `/finance/settings/approval-chains` — create and delete chains; edit a chain's name, description and active flag; add, edit, delete and reorder (move up/down) its steps. Protected: `finance.configure_approvals`. As built, the step form offers what the backend reads: step type, approver type and value (positions, permissions and members from their lists when the viewer can load them), auto-approve threshold, and self-approval for Email approvers only. It does not offer `notification_emails`, `email_template_id` or `required`, because nothing reads them yet (CLAUDE.md pitfall #19); a notification step is marked SENT without sending email. Only a step's named approver can act on it (see **Who may act on a step**), and a step's approver is checked when it is saved; a refused value shows the API's "Approver value …" message. The page also loads `GET /finance/approval-chains/approver-coverage` (and re-loads it after every chain or step change): a step nobody can act on carries a warning chip — "No position chosen" (or member / permission / email), "That position / member / permission no longer exists", "No active member can act on this step", "Not a valid email address" — with "N requests waiting" when any are, its chain's header says how many of its steps need an approver, and a page banner counts them all. The step form's help text says only the named approver (or, with None, any `finance.approve` holder) can act, that an approvals admin can override with a reason, and that the Email type also sends a link. Deleting a step cascades to every request's record of it, and nothing re-evaluates in-flight requests afterwards — the page's confirmation says so
- **ApprovalsPage** — `/finance/approvals` — "Requests waiting on you.": the requests waiting on an approval step the viewer is the named approver of, with a **Waiting on** column (`assigneeLabel`) and Approve (optional notes) / Deny (reason required) for that step. Protected: `finance.approve`. Linked from the dashboard's Pending Approvals KPI and an Approvals quick link, both shown only to `finance.approve` holders. An approvals admin also sees the steps assigned to others (`requiresOverride`), badged "Not assigned to you" with secondary-styled "Approve as admin" / "Deny as admin" actions whose dialog requires an override reason (up to 2000 characters, recorded in the audit log); the header tells them so. Empty state: "Nothing is waiting on you." The page reads `canAct` / `requiresOverride` and does not re-derive the matching rule

Components:

- **ApprovalTimeline** — shown on PurchaseRequestDetailPage, ExpenseReportDetailPage, CheckRequestDetailPage. Displays each step's status, timestamps and notes
- **ApprovalStepActions** — above the timeline on the same three pages. When the request is pending approval, shows "Waiting on <assigneeLabel>." for the step it is waiting on, to anyone who can see the request. Buttons come from that step's `canAct` / `requiresOverride`, which the detail endpoint sets for the viewer (false on notification steps and without `finance.approve`): Approve / Deny for the named approver, "Approve / Deny as approvals admin" with a required override reason for an approvals admin who is not. A requester who is also the named approver still sees Approve; the API refuses it (separation of duties) and the dialog shows why. Re-fetches the request after a decision. Shares **ApprovalDecisionDialog** with the Approvals page
- **ManualApprovalPanel** _(2026-09-30)_ — on the same three pages, for a request in `pending_approval` with **no** approval steps (no chain matched, or the chain had none). Shown only to `finance.approve` holders; offers Approve (optional note, audit log only) and Deny (reason required, shown to the requester) through `/finance/approvals/manual/...`. The requester sees Deny only — the backend refuses their approval too. These requests are not on the Approvals page, which lists step records; `GET /finance/approvals/unrouted` lists them but no screen reads it yet
- **ApprovalChainPreview** — _planned, not built._ `GET /finance/approval-chains/preview` and `approvalChainService.preview()` exist, but no component calls them; request forms show no chain preview and the settings page has no preview tool

**Request bodies accept camelCase and snake_case** _(2026-09-30)_. Every request schema in `app/schemas/finance.py` uses `_REQUEST_CONFIG` (`alias_generator=to_camel`, `populate_by_name=True`, `loc_by_alias=False`). Before this the pages sent camelCase and no schema carried an alias: creates were refused with a 422 for "missing" required fields (`POST /finance/fiscal-years` with `startDate`), and updates silently dropped every multi-word key, so clearing a purchase request's `budgetId` returned 200 and changed nothing. Dumps stay by field name, `exclude_unset` keeps "omitted = leave alone, null = clear", and 422 field names stay snake_case. `tests/test_finance_request_camelcase.py` fails if a new request schema lacks the config.

### Impact on Phases 2-3

The `purchase_requests`, `expense_reports`, and `check_requests` tables keep their `status` enum but the `approved_by`/`approved_at` fields become **denormalized summaries** (set when the final step is approved). The source of truth for approval state is `approval_step_records`.

Updated status flow:

```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED/DENIED → (downstream states)
```

Where `PENDING_APPROVAL` means "at least one approval step is pending." The service checks all step records to determine when to transition to APPROVED.

---

## Phase 2: Purchase Requests

### Backend

**Additional tables in `finance.py`:**

- **`purchase_requests`** — id, organization_id, request_number (auto: "PR-YYYY-0001"), fiscal_year_id, budget_id (FK), requested_by (FK users), title, description, vendor, estimated_amount `Numeric(12,2)`, actual_amount `Numeric(12,2)` (nullable), status (enum), priority, approved_by (FK users, nullable), approved_at, ordered_at, received_at, paid_at, denial_reason, notes, receipt_url (typed link, HTTP(S) only), receipt_document_id (FK documents, SET NULL — the uploaded receipt), created_at, updated_at

Enums:

- `PurchaseRequestStatus`: DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, DENIED, ORDERED, RECEIVED, PAID, CANCELLED

**Endpoints:**

- `GET/POST /finance/purchase-requests`
- `GET/PUT /finance/purchase-requests/{id}`
- `POST /finance/purchase-requests/{id}/submit`
- `POST /finance/purchase-requests/{id}/approve`
- `POST /finance/purchase-requests/{id}/deny`
- `POST /finance/purchase-requests/{id}/mark-ordered`
- `POST /finance/purchase-requests/{id}/mark-received`
- `POST /finance/purchase-requests/{id}/mark-paid`

Business logic:

- On approval: encumber budget (add to amount_encumbered)
- On paid: move from encumbered to spent
- On denial/cancel: release encumbrance
- Auto-number generation per fiscal year

### Frontend

Pages:

- `PurchaseRequestsPage` — `/finance/purchase-requests` — filterable list
- `PurchaseRequestDetailPage` — `/finance/purchase-requests/:id` — status timeline, approval actions
- `PurchaseRequestFormPage` — `/finance/purchase-requests/new` and `/finance/purchase-requests/:id/edit`

---

## Phase 3: Expense Reports & Check Requests

### Backend

**Additional tables in `finance.py`:**

- **`expense_reports`** — id, organization_id, report_number (auto: "ER-YYYY-0001"), submitted_by (FK users), fiscal_year_id, title, description, total_amount `Numeric(12,2)`, status (enum), approved_by (FK users, nullable), approved_at, paid_at, payment_method, notes, created_at, updated_at
- **`expense_line_items`** — id, expense_report_id (FK), budget_id (FK, nullable), description, amount `Numeric(12,2)`, date_incurred, category, receipt_url (typed link, HTTP(S) only), receipt_document_id (FK documents, SET NULL), merchant
- **`check_requests`** — id, organization_id, request_number (auto: "CK-YYYY-0001"), requested_by (FK users), fiscal_year_id, budget_id (FK), payee_name, payee_address, amount `Numeric(12,2)`, memo, purpose, status (enum), approved_by, approved_at, check_number (nullable — filled after cut), check_date, notes, created_at, updated_at

Enums:

- `ExpenseReportStatus`: DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, DENIED, PAID, CANCELLED
- `CheckRequestStatus`: DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, DENIED, ISSUED, VOIDED, CANCELLED

**Endpoints:**

- `GET/POST /finance/expense-reports`
- `GET/PUT /finance/expense-reports/{id}`
- `POST /finance/expense-reports/{id}/submit`
- `POST /finance/expense-reports/{id}/approve`
- `POST /finance/expense-reports/{id}/deny`
- `POST /finance/expense-reports/{id}/mark-paid`
- `GET/POST/PUT/DELETE /finance/expense-reports/{id}/items` (line items)
- `GET/POST /finance/check-requests`
- `GET/PUT /finance/check-requests/{id}`
- `POST /finance/check-requests/{id}/submit`
- `POST /finance/check-requests/{id}/approve`
- `POST /finance/check-requests/{id}/deny`
- `POST /finance/check-requests/{id}/issue`

### Frontend

Pages:

- `ExpenseReportsPage` — `/finance/expenses` — list with status filters
- `ExpenseReportDetailPage` — `/finance/expenses/:id` — line items, receipts, approval
- `ExpenseReportFormPage` — `/finance/expenses/new` and `/finance/expenses/:id/edit`
- `CheckRequestsPage` — `/finance/check-requests` — list
- `CheckRequestFormPage` — `/finance/check-requests/new`

---

## Phase 4: Dues & Assessments

### Backend

**Additional tables in `finance.py`:**

- **`dues_schedules`** — id, organization_id, name (e.g., "2026 Annual Dues"), amount `Numeric(12,2)`, frequency (ANNUAL, SEMI_ANNUAL, QUARTERLY, MONTHLY), due_date, grace_period_days, late_fee_amount `Numeric(12,2)` (nullable), fiscal_year_id, applies_to_membership_types (JSON array — e.g., ["active", "probationary"]), is_active, notes, created_by, created_at, updated_at
- **`member_dues`** — id, organization_id, dues_schedule_id (FK), user_id (FK users), amount_due `Numeric(12,2)`, amount_paid `Numeric(12,2)`, status (enum), due_date, paid_date, payment_method, transaction_reference, late_fee_applied `Numeric(12,2)`, waived_by (FK users, nullable), waived_at, waive_reason, notes, created_at, updated_at
- **`dues_payments`** _(2026-08-02)_ — id, organization_id, member_dues_id (FK, CASCADE), amount `Numeric(12,2)`, payment_method, transaction_reference, notes, received_at, recorded_by (FK users, `SET NULL`, nullable — a ledger row must outlive the member who recorded it), created_at, updated_at. Unique on `(member_dues_id, transaction_reference)`.

> **`member_dues` payment columns are derived, not authoritative.** `amount_paid`
> is the **sum of the ledger**, recomputed by `_apply_payment_totals` on every
> write rather than accumulated; `paid_date`, `payment_method`,
> `transaction_reference` and `notes` project the newest `dues_payments` row.
> Write to the ledger and let those follow — assigning them directly will be
> overwritten on the next payment, and was the cause of FIN-6.
>
> The uniqueness constraint is the idempotency key: a resubmitted
> `transaction_reference` cannot create a second row, so a retried or
> double-clicked payment cannot double-credit. MySQL permits repeated NULLs in a
> unique index, so cash taken at a meeting with no reference is unconstrained —
> two identical cash amounts are two payments, and collapsing them would lose
> money.

Enums:

- `DuesStatus`: PENDING, PAID, PARTIAL, OVERDUE, WAIVED, EXEMPT
  - `EXEMPT` is currently unreachable — nothing in the codebase sets it. It is
    guarded alongside `WAIVED` on the payment path, but has no reversal route.

**Endpoints:**

- `GET/POST /finance/dues-schedules`
- `GET/PUT /finance/dues-schedules/{id}`
- `POST /finance/dues-schedules/{id}/generate` (bulk-create member_dues for all eligible members)
- `GET /finance/dues` (list with member/status filters)
- `PUT /finance/dues/{id}` (record payment — appends to the ledger; idempotent on `transaction_reference`; refuses `WAIVED`/`EXEMPT`)
- `GET /finance/dues/{id}/payments` _(2026-08-02)_ — the payment ledger, oldest first. `finance.view` or `finance.manage`; a `finance.view` holder sees only their own, because the handler narrows to the caller for anyone without `finance.manage`. The only place earlier payments can be read back, since the dues record itself carries only the derived total and the newest payment's detail
- `POST /finance/dues/{id}/waive`
- `POST /finance/dues/{id}/unwaive` _(2026-08-02; reason handling reversed 2026-08-13)_ — reverse a waiver. `finance.manage`, reason required. Restores whatever the ledger says (PENDING / PARTIAL / PAID) and writes a `finance.dues_waiver_reversed` audit event. **Free-text reasons are kept out of the immutable audit log**: the original waive reason is erased from the record and _not_ copied into the event (it may carry personal information that must remain eligible for privacy scrubbing) — the event records only the dues id and restored status
- `GET /finance/dues/summary` (collection rates, outstanding totals)
- `POST /finance/dues/send-reminders` (trigger email notifications for overdue)

> **No frontend calls any of the dues write endpoints yet.**
> `DuesManagementPage` is read-only, and `financeStore` exposes only
> `fetchDuesSchedules` / `fetchMemberDues` / `fetchDuesSummary`;
> `modules/finance/services/api.ts` has no `unwaive` or payment-history method.
> Schedule creation, dues generation, payment recording, waive, unwaive and the
> ledger are API-only until that page is built out. Tracked in
> `KNOWN_LIMITATIONS.md`.

> **Why `unwaive` exists.** Payments against waived dues are refused, and
> `PUT /finance/dues/{id}` _is_ the payment route, so without a reversal there
> is no way out of `WAIVED`: a department that waived by mistake and then
> received the money had no in-app remedy. Before the payment guard the gap was
> hidden, because recording a payment happened to clear the status as a side
> effect of the bug.

### Frontend

Pages:

- `DuesManagementPage` — `/finance/dues` — schedule setup + member payment grid
- `DuesDetailPage` — `/finance/dues/:scheduleId` — per-member payment status, bulk actions

---

## Phase 5: Dashboard, Reports & QuickBooks Export

### Backend

**Dashboard endpoint:** `GET /finance/dashboard`

- Budget health: total budgeted vs spent vs encumbered (current fiscal year)
- Pending approvals count (purchase requests, expenses, check requests)
- Dues collection rate (current schedule)
- Recent transactions (last 10 across all types)
- Grant funds summary (cross-query to grants-fundraising module)

**Report endpoints:**

- `GET /finance/reports/budget-vs-actual` — by category, with optional date range
- `GET /finance/reports/expense-summary` — by member, category, date range
- `GET /finance/reports/dues-collection` — by schedule, with delinquency list
- `GET /finance/reports/purchase-orders` — by status, vendor, date range
- `GET /finance/reports/transaction-log` — unified view of all financial transactions

**QuickBooks Export:**

- **`export_mappings`** table — id, organization_id, internal_category (budget_category name), qb_account_name, qb_account_number, qb_offset_account_name _(2026-10-08)_, mapping_type (EXPENSE, INCOME, ASSET), created_at, updated_at
- **`export_logs`** table — id, organization_id, export_type, date_range_start, date_range_end, record_count, file_format (CSV, IIF), exported_by, exported_at

**Endpoints:**

- `GET/POST/PUT /finance/export/mappings` — manage QB account mappings
- `DELETE /finance/export/mappings/{id}` _(2026-10-09)_ — remove a mapping (org-scoped; `finance.manage`). Needed to clear a duplicate, which blocks the export
- `GET /finance/export/readiness` _(2026-10-09)_ — per budget category: status (`ready`, `no_account`, `no_offset`, `duplicate_mappings`), the account and its source (`category` or `mapping`), the offset account and the matching mapping ids; plus `unmatchedMappingIds`. Built on the export's own classifier (`finance.manage`)
- `POST /finance/export/transactions` — generate CSV/IIF export file for date range
- `GET /finance/export/logs` — export history

Export format:

- **CSV — QuickBooks Online journal-entry import** _(2026-10-08)_. Columns `Journal No, Journal Date, Memo, Account Name, Debits, Credits, Description`, the names the QuickBooks Online **Journal Entries** importer maps by. Every transaction is a balanced entry: a debit to its budget category's account and an equal credit to the offset account it was paid from, both under the transaction's request number (`PR-…`, `CR-…`, `ER-…`, unique across types). An expense report is one entry with a pair of lines per line item, each charged to its own budget line. Paid purchase requests, issued check requests and paid expense reports are exported; dues are not (see `docs/KNOWN_LIMITATIONS.md`).
  - **Accounts.** The debit account is the category's `qb_account_name`, or else the account on the export mapping whose `internal_category` matches the category name (trimmed, case-insensitive). The credit account is that mapping's `qb_offset_account_name`. Subaccounts are written `Parent:Child`, the way QuickBooks expects them.
  - **Refusal.** If any transaction in the range has no budget line, or its category has no account, no offset account, more than one matching mapping, or an account the import cannot post to (below), the export is refused with a 400 naming the problems. Nothing is logged and no file is produced. A partial file would leave the books silently short, which is worse than no file.
  - **Intuit's import rules** _(checked against Intuit's "Import journal entries" help, 2026-10-09)_:
    - **Fewer than 1,000 rows per file**, header included. Each transaction or expense line is two rows, so `generate_export` refuses (400) a period that would reach `QB_IMPORT_MAX_ROWS` (999) and asks for a shorter one. It does not split: a split could separate an expense report's lines into two files, and each file must balance per Journal No.
    - **Accounts Payable and Accounts Receivable need a Name** (a vendor or customer) on every line, which the export has no column for. `_refuse_name_required` refuses them as a category's `qb_account_name` or a mapping's account or offset (400), and `_classify_category_accounts` reports a stored one as `payable_receivable`, so readiness shows it and the export refuses it. It recognizes QuickBooks' standard account names by prefix (`Accounts Payable…`, `Accounts Receivable…`, including their subaccounts); a renamed one is not caught, which the settings page's checklist covers.
    - **Accounts must exist; subaccounts are `Parent:Child`; account numbers should be off during import; the duplicate-journal-number warning must be off** (every entry carries its request number). These are QuickBooks settings, listed on the settings page and in the training guide.
    - Journal numbers are request numbers (`PR-2026-0001`, 12 characters), well within the 21 characters connector documentation gives as QuickBooks' limit.
  - **Date** is the department's calendar day: `paid_at` / `check_date` are converted through `resolve_scheduling_timezone` (the organization's timezone, `America/New_York` when unset) before formatting, so an evening payment no longer books on the next UTC day. The lookup runs inside the export's `try`, so a failure is recorded on the export log like any other interruption
- **IIF** (future): QuickBooks Desktop interchange format
- Design the export service with a strategy pattern so adding QBO API later is straightforward

### Frontend

Pages:

- `FinanceDashboardPage` (enhance from Phase 1) — budget gauges, approval queue, dues health, recent activity
- `FinanceReportsPage` — `/finance/reports` — report selector with filters and export buttons
- `QuickBooksExportSettingsPage` — `/finance/settings/quickbooks` _(built 2026-10-09)_ — QB mapping configuration (protected: `finance.manage`). Two tables:
  - **Budget categories** — every category with the account it posts to (and whether the category or its mapping supplies it), the account it is paid from, and a status: Ready, No account, No paid-from account, or More than one mapping. This is `GET /finance/export/readiness`, computed by `_classify_category_accounts` — the same function the export runs — so a category shown Ready is one the export accepts; the page decides nothing itself. Each row offers Add mapping or Edit mapping.
  - **Mappings** — every mapping, with edit and delete (confirmed first). A mapping whose `internal_category` names no budget category is flagged from the readiness report's `unmatchedMappingIds`, since the export never uses it.
  - The mapping dialog picks the category from the department's categories rather than taking typed text (the export matches by name, so a misspelling matches nothing) and requires the paid-from account, which the export cannot do without even though the API accepts a mapping lacking one.
  - The budget category dialog on Finance Settings carries the category's own **QuickBooks account** (`qbAccountName`), which takes precedence over its mapping's account.
  - A checklist of QuickBooks' own import requirements closes the page _(2026-10-09)_, and a category posting to Accounts Payable or Receivable is shown as **Payable/receivable account**.
- Export wizard (run an export for a date range, export history) — not built; see `docs/KNOWN_LIMITATIONS.md`

---

## Cross-Module Integrations

### Inventory / Uniforms / PPE (`backend/app/models/inventory.py`)

The inventory module already tracks financial data we should connect to:

- **`InventoryItem`** has `purchase_price`, `current_value`, `replacement_cost` fields (Numeric(10,2))
- **`ItemIssuance`** has `unit_cost_at_issuance`, `charge_status` (NONE/PENDING/CHARGED), `charge_amount` — tracks cost recovery when members lose/damage equipment
- **`ItemMaintenance`** has `cost`, `parts_cost`, `labor_hours` fields
- **`DepartureClearance`** has `total_value`, `value_outstanding` — tracks unreturned equipment liability
- **`ReorderRequest`** has `estimated_unit_cost`, `actual_unit_cost` — procurement costs
- **`ItemType`** enum includes UNIFORM and PPE categories; models track `size`, `boot_size`, `boot_width`
- **`EquipmentKit`** groups related items (e.g., "Firefighter Protective Ensemble") with `base_price`, `base_replacement_cost`

**Finance module integrations:**

1. **Expense reports for uniform/PPE reimbursements:** Add `expense_type` enum to `expense_line_items` with values like UNIFORM_REIMBURSEMENT, PPE_REPLACEMENT, BOOT_ALLOWANCE, EQUIPMENT_PURCHASE. The expense form should allow selecting an inventory item type to auto-populate the budget category
2. **Purchase requests linked to reorder requests:** Add optional `reorder_request_id` FK on `purchase_requests` → `ReorderRequest`. When inventory triggers a reorder, it can pre-populate a purchase request
3. **Member equipment cost reports:** Finance reports should query `ItemIssuance` charges and `DepartureClearance` liabilities to show per-member equipment investment and outstanding obligations
4. **Budget impact from inventory:** When `ItemIssuance.charge_status` changes to CHARGED, optionally create a finance transaction record. When reorder requests are fulfilled, the `actual_unit_cost` feeds into budget actuals

**Optional model additions to `inventory.py`:**

- Add `purchase_request_id` (FK, nullable) to `ReorderRequest` — links procurement to finance approval workflow
- Add `budget_category_id` (FK, nullable) to `InventoryItem` — maps items to finance budget lines for cost tracking

### Training (`backend/app/models/training.py`)

The training module tracks hours but has **no cost fields** — this is the main gap. Existing data:

- `TrainingCourse.duration_hours`, `credit_hours` (Float)
- `TrainingRecord.hours_completed`, `credit_hours` (Float)
- `TrainingSession.credit_hours` (number)
- `ExternalTrainingProvider` integrates with Vector Solutions, Target Solutions, Lexipol — but no cost data imported

**Finance module integrations:**

1. **Training expense reimbursements:** Members pay for external certifications, conferences, or courses out of pocket. The expense report form should include a TRAINING_REIMBURSEMENT expense type and allow linking to a `TrainingRecord` or `TrainingCourse`
2. **Purchase requests for training:** Departments pre-pay for courses, conference registrations, or external training subscriptions. POs should allow linking to training context (course, session, or program)
3. **Per-member training investment reports:** Finance reports query `expense_line_items` where `expense_type = TRAINING_REIMBURSEMENT` plus training-linked POs to show total training investment per member

**Optional model additions to `training.py`:**

- Add `estimated_cost` (Numeric(10,2), nullable) to `TrainingCourse` — allows budgeting for training
- Add `actual_cost` (Numeric(10,2), nullable) to `TrainingRecord` — tracks what was actually spent

**Optional model additions to `finance.py`:**

- Add `training_course_id` (FK, nullable) and `training_record_id` (FK, nullable) to `expense_line_items` — links expenses to specific training

### Apparatus (`backend/app/models/apparatus.py`)

Already tracks extensive financial data:

- `purchase_price` (Numeric(12,2)), `monthly_payment`, `original_value`, `current_value`, `salvage_value`, `sold_price`
- Fuel: `price_per_gallon`, `total_cost`
- Maintenance: `estimated_cost`, `actual_cost` (Numeric(10,2))

**Finance module integrations:**

1. **Purchase requests reference apparatus:** Add optional `apparatus_id` FK on `purchase_requests` — for parts, maintenance, fuel purchases
2. **Budget actuals from apparatus costs:** Apparatus maintenance `actual_cost` and fuel `total_cost` feed into budget-vs-actual for the APPARATUS budget category
3. **Capital asset tracking in reports:** Finance dashboard shows fleet asset values from apparatus `current_value` aggregates

### Facilities (`backend/app/models/facilities.py`)

Already tracks:

- Maintenance: `cost` (Numeric(10,2))
- Utilities: `amount` (Numeric(10,2)) — monthly bills
- Capital projects: `estimated_cost`, `actual_cost` (Numeric(12,2))
- Insurance: `coverage_amount`, `deductible`, `annual_premium`

**Finance module integrations:**

1. **Purchase requests reference facilities:** Add optional `facility_id` FK on `purchase_requests`
2. **Budget actuals from facility costs:** Utility bills, maintenance costs, and capital project actuals feed into FACILITIES budget category
3. **Per-station budget views:** Budgets scoped by `station_id` show facility costs alongside other station spending

### Grants-Fundraising (`backend/app/models/grant.py`)

- Dashboard pulls grant fund balances (`amount_awarded - amount_spent`)
- Grant expenditures can optionally link to budget categories via shared `BudgetItemCategory`
- Grant budget items already track `amount_budgeted`, `amount_spent`, `federal_share`, `local_match`

### Other Modules

| Module            | Integration                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Members/Users** | Dues linked to user_id; expense reports submitted by users; approval workflows reference approvers; member financial summary page |
| **Notifications** | Approval request notifications, dues reminders, budget threshold alerts, reimbursement status updates                             |
| **Audit**         | All financial state changes logged via `log_audit_event()`                                                                        |

---

## Data Model: Cross-Module Link Fields

These optional FK columns on `purchase_requests` and `expense_line_items` enable the integrations above:

**On `purchase_requests`:**

- `apparatus_id` (FK apparatus, nullable) — for vehicle parts/maintenance/fuel
- `facility_id` (FK facilities, nullable) — for station repairs/supplies
- `reorder_request_id` (FK reorder_requests, nullable) — for inventory procurement

**On `expense_line_items`:**

- `expense_type` enum: GENERAL, UNIFORM_REIMBURSEMENT, PPE_REPLACEMENT, BOOT_ALLOWANCE, TRAINING_REIMBURSEMENT, CERTIFICATION_FEE, CONFERENCE, TRAVEL, MEALS, MILEAGE, EQUIPMENT_PURCHASE, OTHER
- `training_course_id` (FK training_courses, nullable) — links to specific training
- `training_record_id` (FK training_records, nullable) — links to member's training record
- `inventory_item_id` (FK inventory_items, nullable) — links to specific equipment item

---

## Key Files to Create/Modify

### New Files

| File                                                         | Purpose                           |
| ------------------------------------------------------------ | --------------------------------- |
| `backend/app/models/finance.py`                              | All finance SQLAlchemy models     |
| `backend/app/schemas/finance.py`                             | Pydantic request/response schemas |
| `backend/app/services/finance_service.py`                    | Core finance business logic       |
| `backend/app/api/v1/endpoints/finance.py`                    | FastAPI endpoints                 |
| `backend/alembic/versions/YYYYMMDD_create_finance_tables.py` | Database migration                |
| `frontend/src/modules/finance/index.ts`                      | Module barrel export              |
| `frontend/src/modules/finance/routes.tsx`                    | Route definitions                 |
| `frontend/src/modules/finance/types/index.ts`                | TypeScript types & enums          |
| `frontend/src/modules/finance/services/api.ts`               | Axios instance with auth          |
| `frontend/src/modules/finance/store/financeStore.ts`         | Zustand store                     |
| `frontend/src/modules/finance/pages/*.tsx`                   | ~12 page components               |

### Modified Files

| File                              | Change                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `backend/app/core/permissions.py` | Add `FINANCE` category + `finance.view`, `finance.manage`, `finance.approve`     |
| `backend/app/api/v1/api.py`       | Register finance router                                                          |
| `backend/app/models/__init__.py`  | Import finance models                                                            |
| `backend/app/models/inventory.py` | Add optional `purchase_request_id` and `budget_category_id` FKs                  |
| `backend/app/models/training.py`  | Add optional `estimated_cost` to TrainingCourse, `actual_cost` to TrainingRecord |
| `frontend/src/App.tsx`            | Add `{getFinanceRoutes()}`                                                       |
| `frontend/src/constants/enums.ts` | Add finance-related enum constants (ExpenseType, etc.)                           |

### Reuse from Existing Code

| What                                    | Where                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PaymentMethod` / `PaymentStatus` enums | `backend/app/models/grant.py` — import or extract to shared location                                          |
| Module route pattern                    | `frontend/src/modules/grants-fundraising/routes.tsx` — follow same `lazyWithRetry` + `ProtectedRoute` pattern |
| Module axios setup                      | `frontend/src/modules/grants-fundraising/services/api.ts` — copy auth interceptor pattern                     |
| `generate_uuid`                         | `backend/app/core/utils.py` — reuse for all PK defaults                                                       |
| `log_audit_event`                       | `backend/app/core/audit.py` — call for all financial state changes                                            |
| `safe_error_detail`                     | `backend/app/core/utils.py` — use in all endpoint error handling                                              |

---

## Verification Plan

After each phase:

1. **Backend tests:** `cd backend && pytest tests/test_finance.py -v` — CRUD operations, approval state machine transitions, budget calculations, auto-numbering
2. **Flake8:** `cd backend && flake8 app/models/finance.py app/schemas/finance.py app/services/finance_service.py app/api/v1/endpoints/finance.py`
3. **Frontend lint:** `cd frontend && npx eslint src/modules/finance/`
4. **Frontend type check:** `cd frontend && npx tsc --noEmit`
5. **Frontend tests:** `cd frontend && npx vitest run src/modules/finance/`
6. **Migration test:** `cd backend && alembic upgrade head` (verify tables created cleanly)
7. **Manual E2E:** Create fiscal year → set budget categories → create budgets → submit purchase request → approve → mark paid → verify budget amounts update → export CSV
