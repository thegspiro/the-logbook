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

| Action                                                                         | Gate                                                  | Scope without `finance.manage`                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| List / read purchase and check requests                                        | `finance.request`, `finance.view` or `finance.manage` | own only, unless the caller holds `finance.view`                                                            |
| List / read expense reports                                                    | `finance.request`, `finance.view` or `finance.manage` | own only — including for `finance.view` (FIN-5)                                                             |
| Create, edit (draft / submitted), submit; add an expense line                  | `finance.request` or `finance.manage`                 | own only; `finance.view` alone cannot write                                                                 |
| Cancel a purchase request                                                      | `finance.request` or `finance.manage`                 | own **draft** only — a submitted request has approval steps and possibly an encumbrance; the office cancels |
| Mark ordered / received / paid, mark an expense paid, issue / void             | `finance.manage`                                      | —                                                                                                           |
| `GET /finance/budgets/options?fiscal_year_id=` — id, label, amount left        | `finance.request`, `finance.view` or `finance.manage` | org-scoped; the label is the category, plus the station when set, numbered if two still read the same       |
| `GET /finance/fiscal-years/options` — active and draft years: id, name, status | `finance.request`, `finance.view` or `finance.manage` | org-scoped                                                                                                  |
| Budgets, budget summary, fiscal-year list, dashboard, dues                     | unchanged (`finance.view` and up)                     | —                                                                                                           |

Approval chains, separation of duties and the named-approver enforcement are
unchanged: a member's request goes through the same chain as anyone else's, and
nobody approves or pays their own. `tests/test_finance_member_requests.py` pins
all of the above over HTTP.

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
- `POST /finance/fiscal-years/{id}/activate`
- `POST /finance/fiscal-years/{id}/lock`
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

- **`purchase_requests`** — id, organization_id, request_number (auto: "PR-YYYY-0001"), fiscal_year_id, budget_id (FK), requested_by (FK users), title, description, vendor, estimated_amount `Numeric(12,2)`, actual_amount `Numeric(12,2)` (nullable), status (enum), priority, approved_by (FK users, nullable), approved_at, ordered_at, received_at, paid_at, denial_reason, notes, receipt_url, created_at, updated_at

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
- **`expense_line_items`** — id, expense_report_id (FK), budget_id (FK, nullable), description, amount `Numeric(12,2)`, date_incurred, category, receipt_url, merchant
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
- `POST /finance/export/transactions` — generate CSV/IIF export file for date range
- `GET /finance/export/logs` — export history

Export format:

- **CSV — QuickBooks Online journal-entry import** _(2026-10-08)_. Columns `Journal No, Journal Date, Memo, Account Name, Debits, Credits, Description`, the names the QuickBooks Online **Journal Entries** importer maps by. Every transaction is a balanced entry: a debit to its budget category's account and an equal credit to the offset account it was paid from, both under the transaction's request number (`PR-…`, `CR-…`, `ER-…`, unique across types). An expense report is one entry with a pair of lines per line item, each charged to its own budget line. Paid purchase requests, issued check requests and paid expense reports are exported; dues are not (see `docs/KNOWN_LIMITATIONS.md`).
  - **Accounts.** The debit account is the category's `qb_account_name`, or else the account on the export mapping whose `internal_category` matches the category name (trimmed, case-insensitive). The credit account is that mapping's `qb_offset_account_name`. Subaccounts are written `Parent:Child`, the way QuickBooks expects them.
  - **Refusal.** If any transaction in the range has no budget line, or its category has no account, no offset account, or more than one matching mapping, the export is refused with a 400 naming the problems. Nothing is logged and no file is produced. A partial file would leave the books silently short, which is worse than no file.
  - **Date** is the department's calendar day: `paid_at` / `check_date` are converted through `resolve_scheduling_timezone` (the organization's timezone, `America/New_York` when unset) before formatting, so an evening payment no longer books on the next UTC day. The lookup runs inside the export's `try`, so a failure is recorded on the export log like any other interruption
- **IIF** (future): QuickBooks Desktop interchange format
- Design the export service with a strategy pattern so adding QBO API later is straightforward

### Frontend

Pages:

- `FinanceDashboardPage` (enhance from Phase 1) — budget gauges, approval queue, dues health, recent activity
- `FinanceReportsPage` — `/finance/reports` — report selector with filters and export buttons
- `ExportSettingsPage` — `/finance/export` — QB mapping configuration + export wizard (protected: `finance.manage`)

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
