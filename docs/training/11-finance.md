# Finance

The Finance module manages department budgets, purchase approvals, expense reimbursements, check requests, approval chains, and dues collection. It provides a complete internal financial workflow system designed for fire departments.

---

## Table of Contents

1. [Finance Overview](#finance-overview)
2. [Finance Dashboard](#finance-dashboard)
3. [Fiscal Years](#fiscal-years)
4. [Budget Categories](#budget-categories)
5. [Creating and Managing Budgets](#creating-and-managing-budgets)
6. [Approval Chains](#approval-chains)
7. [Purchase Requests](#purchase-requests)
8. [Expense Reports](#expense-reports)
9. [Check Requests](#check-requests)
10. [Dues & Assessments](#dues--assessments)
11. [QuickBooks Export](#quickbooks-export)
12. [Realistic Example: Annual Budget Cycle](#realistic-example-annual-budget-cycle)
13. [Troubleshooting](#troubleshooting)

---

## Finance Overview

Navigate to **Finance** in the sidebar. The Finance module requires the `MODULE_FINANCE_ENABLED` feature flag.

| URL | Page | Permission |
|-----|------|------------|
| `/finance` | Dashboard | `finance.view` |
| `/finance/budgets` | Budgets List | `finance.view` |
| `/finance/budgets/:id` | Budget Detail | `finance.view` |
| `/finance/settings` | Fiscal Years & Categories | `finance.manage` |
| `/finance/settings/approval-chains` | Approval Chain Builder | `finance.configure_approvals` |
| `/finance/purchase-requests` | Purchase Requests | `finance.view` |
| `/finance/purchase-requests/new` | Create Purchase Request | `finance.view` |
| `/finance/purchase-requests/:id` | PR Detail | `finance.view` |
| `/finance/expenses` | Expense Reports | `finance.view` |
| `/finance/expenses/new` | Create Expense Report | `finance.view` |
| `/finance/expenses/:id` | Expense Detail | `finance.view` |
| `/finance/check-requests` | Check Requests | `finance.view` |
| `/finance/check-requests/new` | Create Check Request | `finance.view` |
| `/finance/check-requests/:id` | Check Detail | `finance.view` |
| `/finance/dues` | Dues Management | `finance.view` |

### Permissions

| Permission | Description | Typical Role |
|------------|-------------|--------------|
| `finance.view` | View budgets, requests, reports | All members |
| `finance.manage` | Create/edit budgets, mark payments, manage dues | Treasurer |
| `finance.approve` | Approve purchase requests, expenses, check requests | Officers, Board |
| `finance.configure_approvals` | Set up approval chains and steps | Finance admin |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Finance sidebar navigation showing Dashboard, Budgets, Purchase Requests, Expenses, Check Requests, Dues, and Settings menu items._

---

## Finance Dashboard

The dashboard at `/finance` shows a high-level overview of department finances:

- **Budget Health** — Total budgeted vs spent vs encumbered for the active fiscal year, with percent-used gauge
- **Category Breakdown** — Per-category budget utilization bars
- **Pending Approvals** — "You have X items awaiting your approval" with quick links
- **Dues Collection** — Total expected, collected, outstanding, and collection rate percentage
- **Quick Links** — Create purchase request, create expense report, view requests

> **[SCREENSHOT NEEDED]:** _Screenshot of the Finance Dashboard showing budget health gauge (65% used), category breakdown bars, pending approvals widget (3 items), and dues collection rate (82%)._

---

## Fiscal Years

**Required Permission:** `finance.manage`

A fiscal year defines the accounting period for budgets and financial tracking.

### Creating a Fiscal Year

1. Navigate to **Finance > Settings**
2. Click **Create Fiscal Year**
3. Enter:
   - **Name** — e.g., "FY 2026"
   - **Start Date** — e.g., January 1, 2026
   - **End Date** — e.g., December 31, 2026
4. Save — the fiscal year is created in **Draft** status

### Fiscal Year Statuses

| Status | Description |
|--------|-------------|
| **Draft** | Initial state; budgets can be configured |
| **Active** | Current operating fiscal year (only one active at a time) |
| **Closed** | Period ended; no new transactions |

### Locking a Fiscal Year

Locked fiscal years cannot be modified — no budget changes, no new transactions. Use this to freeze a completed year for audit purposes.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Fiscal Years settings page showing two fiscal years (FY 2025 - Closed, FY 2026 - Active) with Activate, Lock, and Edit buttons._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Activating a new FY | Automatically deactivates the current active FY |
| Overlapping date ranges | Prevented — fiscal years cannot overlap |
| Locked FY with pending approvals | Pending items are frozen; must be resolved before locking |
| Delete FY with budgets | Cascades — all budgets in that FY are deleted |

---

## Budget Categories

**Required Permission:** `finance.manage`

Budget categories organize spending into groups (APPARATUS, TRAINING, PPE, etc.). Categories support hierarchy — a parent category like "OPERATIONS" can contain sub-categories like "Fuel" and "Utilities."

### Default Categories

APPARATUS, TRAINING, FACILITIES, PERSONNEL, OPERATIONS, COMMUNICATIONS, PPE, MEDICAL_SUPPLIES, FUEL, UTILITIES, INSURANCE, ADMINISTRATIVE, OTHER

### Creating a Category

1. Navigate to **Finance > Settings > Categories**
2. Click **Add Category**
3. Enter name, description, and optional parent category
4. Optionally set a **QuickBooks account name** for export mapping
5. Save

> **[SCREENSHOT NEEDED]:** _Screenshot of the Budget Categories list showing a hierarchical tree (OPERATIONS expanded to show Fuel, Utilities sub-categories) with edit and delete buttons._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Delete category with active budgets | Blocked — must remove budgets first |
| Inactive category | Cannot be selected for new budgets; existing entries preserved |
| Circular hierarchy | Prevented — parent cannot be a child of its own descendant |

---

## Creating and Managing Budgets

**Required Permission:** `finance.manage` (create/edit), `finance.view` (view)

### Creating a Budget

1. Navigate to **Finance > Budgets**
2. Click **Create Budget**
3. Select:
   - **Fiscal Year** — which accounting period
   - **Category** — which spending category
   - **Amount Budgeted** — the allocated amount (up to $9,999,999.99)
   - **Station** (optional) — for per-station budgets
4. Save

### Budget Fields

| Field | Description |
|-------|-------------|
| `amount_budgeted` | Total allocated for this category and fiscal year |
| `amount_spent` | Auto-calculated from paid transactions |
| `amount_encumbered` | Reserved by approved but unpaid purchase requests |
| `amount_remaining` | `budgeted - spent - encumbered` |
| `percent_used` | `(spent + encumbered) / budgeted × 100` |

### Budget Detail View

Click a budget to see:
- Utilization chart (budgeted vs spent vs encumbered vs remaining)
- Transaction history (all purchase requests, expenses, and check requests against this budget)
- Trend over time

> **[SCREENSHOT NEEDED]:** _Screenshot of the Budget Detail page showing a budget for "APPARATUS — FY 2026" with $50,000 budgeted, a donut chart (60% spent, 10% encumbered, 30% remaining), and a transactions table below._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Overspending | Allowed but tracked — budget shows negative remaining |
| Duplicate budget (same FY + category + station) | Prevented — unique constraint |
| Locked fiscal year | Budget cannot be modified |

---

## Approval Chains

**Required Permission:** `finance.configure_approvals`

Approval chains define **who approves what, in what order**. They are reusable templates that automatically route purchase requests, expense reports, and check requests through the right approvers.

### How Chains Work

1. A chain applies to a **request type** (Purchase Request, Expense Report, or Check Request)
2. Chains can be restricted by **amount range** and/or **budget category**
3. Each chain has ordered **steps** — either APPROVAL (requires human action) or NOTIFICATION (auto-sends and advances)
4. When a request is submitted, the system finds the best-matching chain and creates step records

### Creating an Approval Chain

1. Navigate to **Finance > Settings > Approval Chains**
2. Click **Create Chain**
3. Configure:
   - **Name** — e.g., "Large Purchase Approval"
   - **Applies To** — Purchase Request, Expense Report, or Check Request
   - **Min/Max Amount** — amount threshold range (e.g., $5,000–$50,000)
   - **Budget Category** — optionally restrict to a category
   - **Is Default** — fallback chain when no other matches
4. Add steps (see below)
5. Save

### Adding Steps

Click **Add Step** and configure:

| Field | Description |
|-------|-------------|
| **Step Order** | Sequence (1, 2, 3...) — drag to reorder |
| **Step Type** | **APPROVAL** (blocks until approved) or **NOTIFICATION** (sends email, auto-advances) |
| **Approver Type** | How the approver is identified (see table below) |
| **Allow Self-Approval** | Whether the requester can also approve this step (default: no) |
| **Auto-Approve Under** | Auto-approve if request amount is below this threshold |

### Approver Types

| Type | Description | Example |
|------|-------------|---------|
| **POSITION** | Anyone with this position slug | `training_officer`, `treasurer` |
| **PERMISSION** | Anyone with this permission | `finance.approve` |
| **SPECIFIC_USER** | One named user | Selected from member dropdown |
| **EMAIL** | External approver (gets token link) | `accountant@firm.com` |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Approval Chain builder showing a chain named "Medium Purchase" with three steps: Step 1 (APPROVAL by Position: Officer), Step 2 (APPROVAL by Position: Treasurer), Step 3 (NOTIFICATION to Email: board@dept.org). Show drag handles for reordering._

### Chain Resolution (Which Chain Gets Used)

When a request is submitted, the system selects the best chain by specificity:

1. **Category + Amount match** — most specific, wins
2. **Category only match** — next priority
3. **Amount only match** — next
4. **Default chain** — fallback
5. **No chain at all** — single APPROVAL step by anyone with `finance.approve`

### External Email Approvals

When a step uses `approver_type = EMAIL`:
- A secure token link is generated (valid for 7 days)
- Email sent with "Approve" and "Deny" buttons
- External approver clicks the link — no login required
- The step records their decision with timestamp

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token expired | Must re-send the approval email |
| Self-approval blocked | Requester cannot approve their own request (unless explicitly allowed) |
| Multiple chains match | Most specific wins (category + amount > category only > amount only) |
| No chains configured | Fallback: single approval step by anyone with `finance.approve` |

---

## Purchase Requests

A purchase request (PR) is a formal request to buy something. It flows through an approval chain before the purchase is authorized.

### Creating a Purchase Request

1. Navigate to **Finance > Purchase Requests** and click **New Request**
2. Fill in:
   - **Title** — what you're buying (e.g., "Replacement SCBA Bottles")
   - **Description** — details about the purchase
   - **Vendor** — supplier name
   - **Estimated Amount** — projected cost
   - **Priority** — Low, Medium, High, or Urgent
   - **Budget** — which budget category this falls under
   - **Apparatus/Facility** (optional) — cross-module link
3. Click **Save as Draft** or **Submit**

### PR Workflow

```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → ORDERED → RECEIVED → PAID
                                      ↘ DENIED (request ends)
```

| Status | Description | Budget Impact |
|--------|-------------|---------------|
| **Draft** | Editable, not yet submitted | None |
| **Submitted** | Submitted, chain resolving | None |
| **Pending Approval** | Awaiting approver action | None |
| **Approved** | All steps approved | `encumbered += estimated_amount` |
| **Ordered** | Purchase order placed | No change |
| **Received** | Items received | No change |
| **Paid** | Payment completed | `encumbered -= estimated_amount`; `spent += actual_amount` |
| **Denied** | Request rejected | `encumbered -= estimated_amount` (if was approved) |

### Request Numbers

Auto-generated: `PR-YYYY-0001`, `PR-YYYY-0002`, etc. (unique per organization).

> **[SCREENSHOT NEEDED]:** _Screenshot of the Purchase Request form showing title, description, vendor, estimated amount, priority dropdown, budget category selector, and Save Draft / Submit buttons._

> **[SCREENSHOT NEEDED]:** _Screenshot of the PR Detail page showing the approval timeline (Step 1: Officer Approved ✓, Step 2: Treasurer Pending...), request details, and action buttons (Mark Ordered, Mark Received, Mark Paid)._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Edit after submission | Not allowed — must cancel and resubmit |
| Actual amount differs from estimate | Entered at payment; budget tracks actual amount spent |
| Cancel an approved PR | Encumbrance released; budget restored |
| Amount is $0 | Cannot submit — minimum amount required |

---

## Expense Reports

An expense report (ER) is a reimbursement request for out-of-pocket expenses. It supports multiple line items with different expense types.

### Creating an Expense Report

1. Navigate to **Finance > Expenses** and click **New Report**
2. Enter a **title** and **description**
3. Add **line items** — each with:
   - **Description** — what was purchased
   - **Amount** — cost
   - **Date Incurred** — when the expense occurred
   - **Expense Type** — category (see table below)
   - **Merchant** — where you purchased
   - **Receipt URL** — link to uploaded receipt (optional)
   - **Budget** (optional) — which budget category
4. Save as Draft or Submit

### Expense Types

| Type | Description |
|------|-------------|
| General | Miscellaneous expenses |
| Uniform Reimbursement | Clothing allowance claims |
| PPE Replacement | Protective equipment purchases |
| Boot Allowance | Boot purchase reimbursement |
| Training Reimbursement | Course or certification costs paid by member |
| Certification Fee | Certification exam or renewal fees |
| Conference | Conference or symposium attendance |
| Travel | Hotel, flights, transportation |
| Meals | Per diem during travel or training |
| Mileage | Reimbursement for miles driven |
| Equipment Purchase | Equipment bought by member |
| Other | Anything not covered above |

### ER Workflow

```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → PAID
```

Report numbers: `ER-YYYY-0001`, `ER-YYYY-0002`, etc.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Expense Report form showing the title, two line items (each with description, amount, date, expense type dropdown, and merchant fields), and Add Line Item / Submit buttons._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No line items | Cannot submit — at least one item required |
| Edit after submission | Not allowed |
| Total amount | Auto-calculated from line item sum |
| Receipt missing | Optional but recommended for approval |

---

## Check Requests

A check request asks the department to cut a check for a payee — bills, contracts, vendor payments.

### Creating a Check Request

1. Navigate to **Finance > Check Requests** and click **New Request**
2. Fill in:
   - **Payee Name** — who the check is made out to
   - **Payee Address** — mailing address
   - **Amount** — check amount
   - **Memo/Purpose** — reason for the payment
   - **Budget** — which budget category
3. Save as Draft or Submit

### Check Request Workflow

```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → ISSUED
                                                  ↓
                                               VOIDED (if needed)
```

| Status | Description | Budget Impact |
|--------|-------------|---------------|
| **Approved** | Ready to issue | `encumbered += amount` |
| **Issued** | Check cut and mailed | `encumbered -= amount`; `spent += amount` |
| **Voided** | Check cancelled | `spent -= amount` (reversal) |

Request numbers: `CK-YYYY-0001`, etc. Check numbers assigned when issued (unique per fiscal year).

> **[SCREENSHOT NEEDED]:** _Screenshot of the Check Request Detail showing payee info, amount, approval status, and the Issue Check button with check number and date fields._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Void issued check | Reverses budget impact; check number preserved for audit |
| Duplicate check number | Prevented — unique per fiscal year |
| Issue without approval | Blocked — must be approved first |

---

## Dues & Assessments

The dues system tracks and collects membership dues or special assessments.

### Creating a Dues Schedule

**Required Permission:** `finance.manage`

1. Navigate to **Finance > Dues**
2. Click **Create Schedule**
3. Configure:
   - **Name** — e.g., "2026 Annual Dues"
   - **Amount** — per-member amount (e.g., $100.00)
   - **Frequency** — Annual, Semi-Annual, Quarterly, or Monthly
   - **Due Date** — when payment is due
   - **Grace Period** — days after due date before marking overdue (default: 30)
   - **Late Fee** (optional) — additional charge after grace period
   - **Applies To** — which membership types (Active, Probationary, etc.)
4. Save

### Generating Member Dues

After creating a schedule, click **Generate Member Dues** to create individual dues records for all eligible members. This is a bulk action — one record per eligible member.

### Recording Payments

1. Open the Dues page
2. Find the member in the grid
3. Click **Record Payment**
4. Enter: amount paid, date, payment method (cash, check, direct deposit), and reference number
5. Save — member's status updates automatically

### Dues Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Due, not yet paid |
| **Paid** | Full amount received |
| **Partial** | Some amount paid; balance outstanding |
| **Overdue** | Past due date + grace period; not paid |
| **Waived** | Excused by admin (e.g., medical leave) — requires reason |
| **Exempt** | Not applicable to this member |

### Collection Summary

The dues page shows:
- Total expected vs collected vs outstanding
- Collection rate percentage
- Members by status (pending, paid, partial, overdue, waived, exempt)

> **[SCREENSHOT NEEDED]:** _Screenshot of the Dues management page showing a schedule ("2026 Annual Dues — $100"), collection summary cards (Expected: $4,200, Collected: $3,500, Outstanding: $700, Rate: 83%), and the member payment grid with status badges._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Same schedule applied twice to same member | Prevented — unique constraint |
| Late fee auto-applied | Applied after due_date + grace_period_days |
| Partial payment | Status stays PARTIAL until fully paid |
| Waived dues in totals | Counted in "total expected" but separated in summary |
| Member drops after dues generated | Dues record persists; can be waived |

---

## QuickBooks Export

**Required Permission:** `finance.manage`

Export financial data for import into QuickBooks or other accounting software.

### Setting Up Account Mappings

1. Navigate to **Finance > Settings > QB Mappings**
2. For each budget category, map to a QuickBooks account:
   - **Internal Category** — e.g., "APPARATUS"
   - **QB Account Name** — e.g., "1200 - Equipment"
   - **QB Account Number** — e.g., "1200"
   - **Mapping Type** — Expense, Income, or Asset
3. Save

### Generating an Export

1. Navigate to **Finance > Export**
2. Select the date range
3. Choose format (CSV or IIF)
4. Click **Generate**
5. Download the file and import into QuickBooks

### Export Format (CSV)

```
Date,Type,Num,Name,Memo,Account,Debit,Credit
2026-03-15,PR,PR-2026-0001,Safety Equipment Co,Protective Equipment,1200 - Equipment,500.00,
```

> **[SCREENSHOT NEEDED]:** _Screenshot of the QB Export page showing date range selectors, format dropdown (CSV/IIF), Generate button, and a recent exports table._

---

## Realistic Example: Annual Budget Cycle

### Background

**Oakville Fire Department** Treasurer **Lt. Walsh** sets up the 2026 fiscal year.

### Part 1: Setup (January 2)

1. Lt. Walsh creates **Fiscal Year "FY 2026"** (Jan 1 – Dec 31)
2. Activates FY 2026 → FY 2025 auto-deactivates
3. Creates budget lines:

| Category | Amount |
|----------|--------|
| Apparatus | $50,000 |
| Training | $15,000 |
| PPE | $25,000 |
| Facilities | $20,000 |
| Operations | $30,000 |

4. Creates approval chains:
   - **Small Purchase** ($0–$500): 1 step → any Officer (APPROVAL)
   - **Medium Purchase** ($500–$5,000): 2 steps → Officer → Treasurer
   - **Large Purchase** ($5,000+): 3 steps → Officer → Treasurer → Board email notification

### Part 2: Purchase Request (February 15)

FF Carter needs new SCBA bottles ($3,200):

1. Creates PR: "SCBA Bottle Replacement" — Vendor: MSA Safety — $3,200 — Category: Apparatus — Priority: High
2. Submits → chain resolves to "Medium Purchase" → Step 1: Officer approval
3. Lt. Davis approves → Step 2: Treasurer approval
4. Lt. Walsh approves → PR status: **Approved**
5. Budget: Apparatus encumbered = $3,200 (remaining: $46,800)
6. Lt. Walsh marks **Ordered** → **Received** → **Paid** ($3,150 actual)
7. Budget: Apparatus spent = $3,150, encumbered = $0, remaining = $46,850

### Part 3: Expense Report (March 1)

FF Nguyen attended a Hazmat certification course and paid $450 out of pocket:

1. Creates ER with two line items:
   - Course fee: $350 (type: Certification Fee)
   - Travel: $100 (type: Travel)
2. Submits → approval chain → Training Officer approves → Treasurer approves
3. Lt. Walsh marks as Paid → Budget: Training spent += $450

### Part 4: Dues Collection (April)

1. Lt. Walsh creates schedule: "2026 Annual Dues — $100 — Due April 30"
2. Generates dues → 42 member records created
3. Over the next month, records payments as members pay
4. By May 30: 38 paid, 2 partial, 1 waived (medical leave), 1 overdue
5. Collection rate: 93%

### Part 5: Year-End (December)

1. Lt. Walsh generates QB CSV export for FY 2026
2. Imports into QuickBooks for annual audit
3. Closes FY 2026
4. Creates FY 2027

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot create budget | Verify the fiscal year exists and is not locked. Check `finance.manage` permission. |
| Purchase request stuck in Pending Approval | Check which approval step is pending. Verify the approver is active and has `finance.approve`. |
| Approval chain not matching | Check chain amount thresholds and category restrictions. Verify a default chain exists as fallback. |
| External approver didn't receive email | Check the email address. Verify email service is configured. Re-send the approval email. |
| Token expired for external approval | Token valid for 7 days. Re-send the approval or approve manually in-app. |
| Budget shows negative remaining | Overspending is allowed by design. Review transactions to find the overage. |
| Cannot edit submitted PR | Requests cannot be edited after submission. Cancel and create a new one. |
| Dues showing wrong count | Check "Applies To" membership types on the schedule. Members added after generation need manual addition. |
| QB export missing transactions | Verify the date range covers the transactions. Check that budget categories have QB mappings. |
| Fiscal year won't lock | Resolve any pending approvals first. Pending items must be approved, denied, or cancelled. |

---

**Previous:** [Mobile & PWA Usage](./10-mobile-pwa.md) | **Next:** [Grants & Fundraising](./12-grants-fundraising.md)
