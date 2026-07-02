# Finance

The Finance module manages budgets, purchase requests, expense reports, check requests, dues collection, and approval workflows for your department. It provides a complete financial management system from budget planning through expenditure tracking, with configurable multi-step approval chains and QuickBooks export for integration with your accounting software.

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

The Finance module is an optional module that must be enabled by your department administrator in **Settings > Organization > Modules**. Once enabled, the **Finance** section appears in the main navigation.

### Who Uses What

| Role | What They Do |
|------|-------------|
| **All members** | Submit purchase requests, expense reports, and check requests; view their own dues status |
| **Officers with `finance.view`** | View budgets, financial dashboards, and dues management |
| **Officers with `finance.manage`** | Create and edit budgets, fiscal years, and budget categories; mark payments; manage dues schedules; run exports |
| **Officers with `finance.approve`** | Approve or deny purchase requests, expense reports, and check requests |
| **Officers with `finance.configure_approvals`** | Set up and manage approval chains and their steps |

### Permissions

| Permission | Description |
|------------|-------------|
| `finance.view` | View financial data including budgets, reports, and dues; create and submit your own requests |
| `finance.manage` | Create and edit budgets, fiscal years, categories; mark payments on requests; manage dues schedules; run QuickBooks exports |
| `finance.approve` | Approve or deny submitted requests in the approval workflow |
| `finance.configure_approvals` | Create, edit, and delete approval chains and configure approval steps |

### Key Concepts

- **Fiscal Year** -- The accounting period your department uses for budgeting. All budgets, requests, and reports are tied to a fiscal year.
- **Budget Category** -- A classification for budget line items (e.g., "Apparatus Maintenance", "Training", "Uniforms"). Categories can have parent-child hierarchies and map to QuickBooks accounts.
- **Budget** -- A line item within a fiscal year and category with a budgeted amount. Tracks spent, encumbered, and remaining amounts.
- **Approval Chain** -- A configurable sequence of approval and notification steps that requests must pass through before they are approved. Different chains can apply to different request types and dollar thresholds.
- **Encumbrance** -- When a purchase request is approved, the estimated amount is "encumbered" (reserved) against the budget. This reduces the available balance without counting as spent until the request is marked paid.

### Navigation

| Route | Description |
|-------|-------------|
| `/finance` | Finance Dashboard |
| `/finance/budgets` | Budget list |
| `/finance/budgets/:id` | Budget detail |
| `/finance/settings` | Fiscal years and budget categories |
| `/finance/settings/approval-chains` | Approval chain builder |
| `/finance/purchase-requests` | Purchase request list |
| `/finance/purchase-requests/new` | Create a purchase request |
| `/finance/purchase-requests/:id` | Purchase request detail |
| `/finance/purchase-requests/:id/edit` | Edit a draft purchase request |
| `/finance/expenses` | Expense report list |
| `/finance/expenses/new` | Create an expense report |
| `/finance/expenses/:id` | Expense report detail |
| `/finance/check-requests` | Check request list |
| `/finance/check-requests/new` | Create a check request |
| `/finance/check-requests/:id` | Check request detail |
| `/finance/dues` | Dues management |

---

## Finance Dashboard

Navigate to **Finance** to view the department-wide financial dashboard.

The dashboard provides a high-level summary of your department's financial health:

- **Budget Health** -- Total budgeted, total spent, total encumbered, total remaining, and percent used across all budgets in the active fiscal year
- **Pending Approvals Count** -- How many requests are waiting for your action
- **Pending Purchase Requests** -- Count of purchase requests awaiting approval
- **Pending Expense Reports** -- Count of expense reports awaiting approval
- **Pending Check Requests** -- Count of check requests awaiting approval
- **Dues Collection Rate** -- Percentage of expected dues that have been collected
- **Recent Transactions** -- A feed of recent financial activity across the department

> **[SCREENSHOT NEEDED]:** _The Finance Dashboard showing budget health summary cards at the top (total budgeted, spent, encumbered, remaining with a percent-used gauge), pending approval counts in the middle row, and the recent transactions feed below._

> **Hint:** The dashboard automatically scopes to the active fiscal year. If no fiscal year is active, the budget health section displays zeroes. Set up your fiscal year first (see [Fiscal Years](#fiscal-years)).

---

## Fiscal Years

**Required Permission:** `finance.manage`

Navigate to **Finance > Settings** to manage fiscal years.

A fiscal year defines the accounting period for your department. All budgets, purchase requests, expense reports, and check requests are tied to a fiscal year. Most fire departments use either a calendar year (January--December) or a government fiscal year (July--June or October--September).

### Fiscal Year Statuses

| Status | Meaning |
|--------|---------|
| **Draft** | The fiscal year is being set up. Budgets can be created and edited freely. No requests can be submitted against it yet. |
| **Active** | The fiscal year is open for business. Requests can be submitted, budgets track spending, and approval workflows run. Only one fiscal year can be active at a time. |
| **Closed** | The fiscal year is complete. No new requests can be submitted. Existing data is read-only for reporting purposes. |

### Creating a Fiscal Year

1. Navigate to **Finance > Settings**.
2. Click **Create Fiscal Year**.
3. Enter a **name** (e.g., "FY 2026-2027").
4. Set the **start date** and **end date**.
5. Click **Save**.

The new fiscal year is created in **Draft** status.

> **[SCREENSHOT NEEDED]:** _The Fiscal Year Settings page showing a list of fiscal years with status badges (Draft, Active, Closed), start/end dates, and action buttons (Activate, Lock)._

### Activating a Fiscal Year

1. From the fiscal year list, find the draft fiscal year you want to activate.
2. Click **Activate**.
3. Confirm the activation.

Activating a fiscal year makes it the current period for all financial operations. Only one fiscal year can be active at a time -- activating a new one automatically closes the previously active one.

### Locking a Fiscal Year

When a fiscal year is complete:

1. Click **Lock** on the active fiscal year.
2. Confirm the lock.

Locking transitions the fiscal year to **Closed** status and sets the `isLocked` flag. All budgets and transactions within it become read-only. A locked fiscal year cannot be modified or re-opened. This is typically done after year-end reconciliation.

> **Hint:** Create and set up your new fiscal year (including budgets) in Draft status before the current one ends. When the new period begins, activate it. This ensures a seamless transition with no gap in financial tracking.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Activating a fiscal year when another is already active | The previously active fiscal year is automatically set to Closed status |
| Submitting a request with no active fiscal year | The request form will not allow submission -- the fiscal year dropdown will be empty |
| Editing a locked fiscal year | Not permitted -- the system rejects modifications with "Fiscal year is locked and cannot be modified" |
| Deleting a fiscal year with existing budgets | Not permitted -- budgets cascade with the fiscal year, but the application blocks deletion of fiscal years that have associated requests |

---

## Budget Categories

**Required Permission:** `finance.manage`

Navigate to **Finance > Settings** to manage budget categories.

Budget categories organize your department's spending into logical groups. Categories support a parent-child hierarchy for detailed tracking (e.g., "Operations" as a parent with "Fuel", "Maintenance", and "Supplies" as children).

### Creating a Category

1. On the **Finance > Settings** page, find the **Budget Categories** section.
2. Click **Add Category**.
3. Enter a **name** (e.g., "Training").
4. Optionally enter a **description**.
5. Optionally select a **parent category** to nest this category under.
6. Set the **sort order** to control display position in lists (default: 0).
7. Optionally enter a **QuickBooks account name** to pre-configure the export mapping (see [QuickBooks Export](#quickbooks-export)).
8. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Budget Categories section on the Settings page showing a hierarchical list of categories with parent-child indentation, sort order numbers, QB account name column, active/inactive toggle, and Add/Edit/Delete action buttons._

### Category Hierarchy

Categories can be nested one level deep. A parent category serves as a logical grouping for its child categories. For example:

```
Operations (parent)
  ├── Fuel
  ├── Vehicle Maintenance
  └── Station Supplies
Training (parent)
  ├── Course Fees
  ├── Travel
  └── Materials
```

> **Hint:** Keep your category structure aligned with your chart of accounts in QuickBooks or your accounting system. This simplifies the export mapping later and ensures your financial reports match across systems.

### Deactivating a Category

Rather than deleting a category, you can deactivate it by setting `isActive` to false. Deactivated categories are hidden from new budget and request creation forms but remain associated with existing data for historical reporting.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Deleting a category with existing budgets | Not permitted -- reassign or delete the budgets first |
| Deactivating a category | The category is hidden from new budget creation but existing budgets retain their category assignment |
| Category with no QB account name | The category can still be used for budgets; export mapping can be configured separately in the QuickBooks Export settings |
| Self-referential parent | The parent category cannot reference itself -- the `parent_category_id` FK points to `budget_categories.id` with SET NULL on delete |

---

## Creating and Managing Budgets

**Required Permission:** `finance.manage`

Navigate to **Finance > Budgets** to view and manage department budgets.

A budget is a line item that allocates a specific dollar amount to a category within a fiscal year. Each budget tracks four key financial figures:

| Field | Description |
|-------|-------------|
| **Amount Budgeted** | The total amount allocated to this budget line item |
| **Amount Spent** | The total that has been paid out (from requests marked as Paid or checks marked as Issued) |
| **Amount Encumbered** | The total reserved by approved but not-yet-paid purchase requests |
| **Amount Remaining** | `Amount Budgeted - Amount Spent - Amount Encumbered` -- the amount still available for new requests |

All monetary fields use `Numeric(12, 2)` precision (12 digits total, 2 decimal places) and arithmetic uses Python's `Decimal` type internally to avoid floating-point rounding errors.

### Creating a Budget

1. Navigate to **Finance > Budgets**.
2. Click **Create Budget**.
3. Select the **fiscal year** (only Draft or Active fiscal years are available).
4. Select a **budget category**.
5. Enter the **amount budgeted** (must be zero or greater).
6. Optionally select a **station** to scope the budget to a specific fire station.
7. Optionally add **notes** describing the budget purpose.
8. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Create Budget form showing the fiscal year dropdown, category dropdown, amount budgeted input field, station selector, notes textarea, and the Save button._

### Viewing Budget Details

Click on any budget in the list to view its detail page at `/finance/budgets/:id`. The detail page shows:

- Budget amount and category
- Visual breakdown of spent, encumbered, and remaining amounts (progress bar)
- List of all purchase requests, expense reports, and check requests charged against this budget
- Budget utilization percentage

> **[SCREENSHOT NEEDED]:** _A Budget Detail page showing the budget category and amount at the top, a stacked progress bar (green for spent, yellow for encumbered, gray for remaining), and a table of linked transactions below._

### Budget Summary

The budget summary provides an aggregate view across all budgets in a fiscal year:

- **Total Budgeted** -- Sum of all budget line items
- **Total Spent** -- Sum of all paid amounts across all budgets
- **Total Encumbered** -- Sum of all approved-but-unpaid amounts
- **Total Remaining** -- `Total Budgeted - Total Spent - Total Encumbered`
- **Percent Used** -- `(Total Spent + Total Encumbered) / Total Budgeted * 100`, rounded to two decimal places. Displays 0% if total budgeted is zero (division-by-zero guard).

> **Hint:** Monitor the **Amount Remaining** column closely. When a budget line item approaches zero remaining, any new purchase requests against that category will still be submittable, but approvers will see the over-budget condition and can make informed decisions.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Creating a budget in a closed fiscal year | Not permitted -- fiscal year must be in Draft or Active status |
| Two budgets for the same category and fiscal year | Permitted -- useful when different stations have separate budgets for the same category. Requests are linked to a specific budget, not just a category |
| Budget remaining goes negative | The system allows it (does not block approvals) but displays the negative remaining amount as a visual warning. Budget release operations are floored at zero to prevent negative encumbrance |
| Deleting a budget with linked requests | Not permitted -- the linked requests must be cancelled or reassigned first |
| Budget summary with no budgets | Returns all zeroes and 0% utilization |

---

## Approval Chains

**Required Permission:** `finance.configure_approvals`

Navigate to **Finance > Settings > Approval Chains** to configure approval workflows.

Approval chains define the sequence of approvals and notifications that purchase requests, expense reports, and check requests must pass through. Each chain is a series of ordered steps that are executed sequentially when a request is submitted.

### How Approval Chains Work

When a member submits a request (purchase request, expense report, or check request), the system:

1. **Matches a chain** -- Finds the most specific approval chain for the request based on entity type, dollar amount, and budget category (see [Chain Resolution](#chain-resolution-specificity) below).
2. **Creates step records** -- Creates a pending record for each step in the matched chain. Steps below the auto-approve threshold are immediately marked as Auto-Approved.
3. **Processes steps in order** -- Each step must complete before the next one activates. Notification steps auto-advance after sending.
4. **Completes the chain** -- When all steps are complete, the request moves to Approved status and the appropriate budget action occurs (e.g., encumbrance for purchase requests).

### Chain Resolution (Specificity)

When multiple chains could apply to a request, the system selects the most specific match using a point-based scoring system:

| Criterion | Points | Description |
|-----------|--------|-------------|
| **Category match** | +4 | The chain is scoped to a specific budget category that matches the request's budget category. If the chain has a category set but it does not match, the chain is skipped entirely. |
| **Amount range match** | +2 | The chain has min/max amount thresholds and the request amount falls within the range. Chains where the amount falls outside the range are skipped. |
| **Default chain** | +1 | The chain is marked as `isDefault` for the entity type. |

The chain with the highest score wins. If no chain matches at all, the request transitions directly to `PENDING_APPROVAL` status without any approval step records (requiring manual approval).

### Chain Fields

| Field | Description |
|-------|-------------|
| **Name** | A descriptive name for the chain (e.g., "Standard Purchase Approval") |
| **Description** | Optional notes about when this chain applies |
| **Applies To** | Which request type this chain governs: `purchase_request`, `expense_report`, or `check_request` |
| **Min Amount** | The minimum dollar amount for this chain to apply (leave blank for no minimum) |
| **Max Amount** | The maximum dollar amount for this chain to apply (leave blank for no maximum) |
| **Budget Category** | Optionally restrict this chain to requests in a specific budget category |
| **Is Default** | Whether this chain is the default fallback for its entity type |
| **Is Active** | Whether the chain is currently in use (inactive chains are ignored during resolution) |

### Creating an Approval Chain

1. Navigate to **Finance > Settings > Approval Chains**.
2. Click **Create Approval Chain**.
3. Enter the chain **name** and optional **description**.
4. Select what the chain **applies to** (Purchase Request, Expense Report, or Check Request).
5. Optionally set **min amount** and **max amount** thresholds.
6. Optionally select a **budget category** to restrict matching.
7. Check **Is Default** if this should be the fallback chain for this entity type.
8. Optionally add **steps** inline during creation.
9. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Create Approval Chain form showing the name field, applies-to dropdown (Purchase Request selected), min/max amount fields, budget category dropdown, is-default checkbox, and the steps builder below with an "Add Step" button._

### Adding Steps to a Chain

After creating the chain (or during creation), add steps to define the approval workflow:

1. Click **Add Step** on the chain detail view.
2. Enter a **step name** (e.g., "Captain Review", "Chief Approval", "Treasurer Notification").
3. Set the **step order** (starting from 1) to control the sequence.
4. Select the **step type**:

| Step Type | Behavior |
|-----------|----------|
| **Approval** | The step blocks the workflow until the assigned approver explicitly approves or denies. A denial stops the entire chain and marks the request as Denied. |
| **Notification** | The step sends a notification to the specified recipient(s) and auto-advances to the next step (status changes to Sent). It does not block the workflow. |

5. Select the **approver type** (determines who receives the approval request or notification):

| Approver Type | Assigns To |
|---------------|-----------|
| **Position** | Any member holding a specific position (e.g., "Captain", "Chief"). Enter the position title in the **Approver Value** field. |
| **Permission** | Any member with a specific permission. Enter the permission string (e.g., `finance.approve`) in the **Approver Value** field. |
| **Specific User** | A specific named member. Enter the user ID in the **Approver Value** field. |
| **Email** | An external email address (e.g., an outside accountant or board member). Enter the email address in the **Approver Value** field. The system generates a secure approval token (valid for 7 days) and sends an email with approve/deny links. |

6. Optionally configure:
   - **Notification Emails** -- Additional email addresses to CC when this step activates.
   - **Email Template** -- An email template to use for the notification.
   - **Allow Self-Approval** -- Whether the person who submitted the request can also approve at this step (default: false).
   - **Auto-Approve Under** -- A dollar amount below which this step is automatically approved (status: Auto-Approved). Useful for low-dollar purchases that do not need chief-level review.
   - **Required** -- Whether this step is mandatory or can be skipped (default: true).
7. Click **Save Step**.

> **[SCREENSHOT NEEDED]:** _The Add Step form showing step name, step order input, step type toggle (Approval/Notification), approver type dropdown (Position selected), approver value field showing "Captain", self-approval checkbox, auto-approve-under amount field, required checkbox, and Save button._

### Previewing Chain Resolution

Before submitting a request, you can preview which approval chain will apply:

1. On the **Approval Chains** settings page, use the **Preview** tool.
2. Select an **entity type** (purchase_request, expense_report, or check_request), enter an **amount**, and optionally select a **category**.
3. The system shows which chain would match and which steps would be created.

This helps verify that your chain configuration produces the expected workflow before members start submitting requests.

> **Hint:** Set up at least one default chain for each entity type (Purchase Request, Expense Report, Check Request) before members begin submitting requests. Without a matching chain, requests enter Pending Approval status without step records, requiring manual processing.

### Example Chain Configuration

A typical fire department might configure these chains:

**Purchase Requests:**
- "Small Purchases" (under $500): 1 step -- Captain Approval
- "Standard Purchases" ($500--$5,000): 2 steps -- Captain Approval, then Chief Approval
- "Large Purchases" (over $5,000): 3 steps -- Captain Approval, Chief Approval, then Board Notification
- "Training Purchases" (category: Training, any amount): 2 steps -- Training Officer Approval, then Chief Approval

**Expense Reports:**
- Default chain: 2 steps -- Supervisor Approval, then Treasurer Notification

**Check Requests:**
- Default chain: 2 steps -- Treasurer Approval, then Chief Approval

### Approval Step Statuses

As a request moves through its approval chain, each step has a status:

| Status | Meaning |
|--------|---------|
| **Pending** | The step is active and awaiting action from the assigned approver |
| **Approved** | The approver has approved the request at this step |
| **Denied** | The approver has denied the request at this step (stops the entire chain) |
| **Skipped** | The step was skipped (not required or conditions not met) |
| **Auto-Approved** | The request amount was below the step's `autoApproveUnder` threshold |
| **Sent** | For notification steps, the notification has been sent and the step auto-advanced |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No approval chain matches a submitted request | The request moves to Pending Approval status without step records, requiring manual processing |
| Approver denies at step 2 of 3 | The entire chain stops. The request is marked Denied with the denial reason. Remaining steps are not processed |
| Self-approval when `allowSelfApproval` is false | The step appears in pending approvals but the submitter cannot act on their own request -- another approver with the matching role/permission must act |
| Multiple members hold the "Captain" position | Any one of them can approve the step -- it is a first-come approval |
| Auto-approve threshold set to $200 on a $150 request | The step is automatically created with status Auto-Approved and the chain advances to the next step |
| Editing a chain after requests have been submitted | Existing in-flight requests continue using the step records that were created at submission time. The edited chain applies only to newly submitted requests |
| External email approver (Email type) | The approver receives an email with a secure approval token (valid for 7 days). No Logbook account is required. Expired tokens are rejected |
| Denial does not release encumbrance | By design -- denial happens during the approval flow (before the request reaches Approved status), so no encumbrance exists to release |

---

## Purchase Requests

Navigate to **Finance > Purchase Requests** to view and manage purchase requests.

Purchase requests are used when a member needs to buy something for the department. The request goes through the configured approval chain before the purchase is authorized.

### Purchase Request Workflow

```
DRAFT --> SUBMITTED --> PENDING_APPROVAL --> APPROVED --> ORDERED --> RECEIVED --> PAID
                             |
                           DENIED
              |
          CANCELLED
```

| Status | Description | Budget Impact |
|--------|-------------|---------------|
| **Draft** | Request is being prepared by the member. Not yet visible to approvers. | None |
| **Submitted** | Request has been submitted and is entering the approval chain. | None |
| **Pending Approval** | Request is waiting for one or more approvers to act. | None |
| **Approved** | All approval steps are complete. The purchase is authorized. | **Estimated amount is encumbered** (reserved against the budget) |
| **Ordered** | The item has been ordered from the vendor. | Encumbrance remains |
| **Received** | The item has been received by the department. | Encumbrance remains |
| **Paid** | Payment has been made to the vendor. | **Encumbrance is released; actual amount (or estimated if no actual specified) moves to spent** |
| **Denied** | An approver has denied the request. | None (denial occurs before encumbrance) |
| **Cancelled** | The requester or an officer has cancelled the request. | **Encumbrance is released** if the request had been approved, ordered, or received |

### Request Numbers

Purchase request numbers are auto-generated in the format **PR-YYYY-0001**, where YYYY is derived from the fiscal year's start date and the sequence number increments for each new request within that year (e.g., PR-2026-0001, PR-2026-0002).

### Creating a Purchase Request

**Required Permission:** `finance.view`

1. Navigate to **Finance > Purchase Requests**.
2. Click **New Purchase Request** (or go directly to `/finance/purchase-requests/new`).
3. Fill in the request details:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | Yes | Brief description of what is being purchased (max 300 characters) |
| **Fiscal Year** | Yes | The fiscal year to charge this purchase against |
| **Budget** | No | The specific budget line item (helps approvers see remaining balance) |
| **Estimated Amount** | Yes | The expected total cost (must be greater than zero) |
| **Vendor** | No | The vendor or supplier name |
| **Priority** | Yes | Low, Medium (default), High, or Urgent |
| **Description** | No | Detailed justification for the purchase |
| **Apparatus** | No | If the purchase is for a specific vehicle |
| **Facility** | No | If the purchase is for a specific fire station or facility |
| **Notes** | No | Additional notes for approvers |

4. Click **Save as Draft** to save without submitting, or click **Submit** to send it into the approval workflow.

> **[SCREENSHOT NEEDED]:** _The Create Purchase Request form showing all fields: title, fiscal year dropdown, budget dropdown, estimated amount, vendor, priority selector (Low/Medium/High/Urgent), description textarea, apparatus and facility dropdowns, notes, and the Save Draft / Submit buttons at the bottom._

### Submitting a Purchase Request

If you saved as a draft:

1. Navigate to **Finance > Purchase Requests** and find your draft.
2. Open the request detail page.
3. Review the details and click **Submit**.

Once submitted, the system resolves the budget category from the linked budget, matches an approval chain (see [Approval Chains](#approval-chains)), and creates the approval step records. The request status changes to **Pending Approval**.

### Tracking a Purchase Request

Open a purchase request to see its detail page at `/finance/purchase-requests/:id`. The detail page shows:

- Request number, title, and all submitted details
- Current status badge
- Approval chain progress -- each step with its status, assigned approver, action timestamp, and any notes
- Budget impact (estimated amount vs. budget remaining)

> **[SCREENSHOT NEEDED]:** _A Purchase Request Detail page showing the request header (PR-2026-0042, "Thermal Imaging Camera"), status badge (Approved), the approval chain timeline with two completed steps (Captain -- Approved, Chief -- Approved), and the estimated amount alongside the linked budget's remaining balance._

### Progressing a Purchase Request After Approval

**Required Permission:** `finance.manage`

Once approved, officers can progress the request through the fulfillment stages:

1. Click **Mark as Ordered** when the item has been ordered from the vendor. The `orderedAt` timestamp is recorded.
2. Click **Mark as Received** when the item arrives at the department. The `receivedAt` timestamp is recorded.
3. Click **Mark as Paid** when payment has been made. At this point, you can optionally enter the **actual amount** paid (if it differs from the estimate). The actual amount is what gets recorded as spent against the budget.

> **Hint:** If the actual amount differs from the estimated amount, the budget adjusts automatically. For example, if $500 was encumbered but the actual payment was $475, only $475 moves to "spent" and the full $500 encumbrance is released (the $25 difference returns to the available balance). Payment can also be recorded directly from the Approved or Ordered status -- the Received step is optional.

### Editing and Cancelling

- **Editing:** A purchase request can only be edited while in **Draft** or **Submitted** status. Once it reaches Pending Approval, it cannot be modified.
- **Cancelling:** A request can be cancelled from any status except **Paid**. If an approved, ordered, or received request is cancelled, the encumbrance is released back to the budget.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Submitting without a budget selected | The request enters the approval workflow but no encumbrance is tracked. Approvers should verify the funding source manually |
| Actual amount exceeds estimated amount | The budget spent amount reflects the actual amount, which may push the budget into a negative remaining balance |
| Cancelling an approved request | The encumbered amount is released back to the budget's available balance. The encumbrance release is floored at zero to prevent negative encumbrance values |
| Marking as paid from Approved status (skipping Ordered and Received) | Permitted -- the system allows direct transition from Approved to Paid |
| Request with no matching approval chain | The request moves to Pending Approval but has no approval step records. It requires manual intervention |
| Editing a submitted request | Permitted while in Submitted status (before approval flow begins). Not permitted once in Pending Approval or later |
| Purchase request linked to an apparatus or facility | The linkage is informational -- it helps officers categorize spending by asset but does not affect the approval or budget logic |

---

## Expense Reports

Navigate to **Finance > Expenses** to view and manage expense reports.

Expense reports are used when a member has already incurred out-of-pocket expenses and needs reimbursement. Unlike purchase requests (which authorize future purchases), expense reports document past spending with itemized line items.

### Expense Report Workflow

```
DRAFT --> SUBMITTED --> PENDING_APPROVAL --> APPROVED --> PAID
                             |
                           DENIED
              |
          CANCELLED
```

| Status | Description |
|--------|-------------|
| **Draft** | Report is being prepared. Line items can be added and edited. |
| **Submitted** | Report has been submitted into the approval chain. |
| **Pending Approval** | Report is waiting for approver action. |
| **Approved** | All approval steps are complete. The reimbursement is authorized. |
| **Paid** | The member has been reimbursed. Payment method is recorded. |
| **Denied** | An approver has denied the report. |
| **Cancelled** | The submitter has cancelled the report. |

### Report Numbers

Expense report numbers are auto-generated in the format **ER-YYYY-0001**, where YYYY is derived from the fiscal year's start date and the sequence number increments for each new report.

### Creating an Expense Report

**Required Permission:** `finance.view`

1. Navigate to **Finance > Expenses**.
2. Click **New Expense Report** (or go directly to `/finance/expenses/new`).
3. Fill in the header:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | Yes | Brief description of the expenses (e.g., "March Training Conference") (max 300 characters) |
| **Fiscal Year** | Yes | The fiscal year these expenses fall within |
| **Description** | No | Detailed explanation of the expenses |
| **Notes** | No | Additional notes for approvers |

4. Add **line items** for each expense (can be added during creation or separately while in Draft status):

| Field | Required | Description |
|-------|----------|-------------|
| **Description** | Yes | What the expense was for (max 500 characters) |
| **Amount** | Yes | Dollar amount of the expense (must be greater than zero) |
| **Date Incurred** | Yes | When the expense occurred |
| **Expense Type** | Yes | Category of expense (default: General; see table below) |
| **Budget** | No | Which budget to charge this line item against |
| **Merchant** | No | Where the purchase was made |
| **Receipt URL** | No | Link to or upload of the receipt |

5. Click **Save as Draft** or **Submit**. The total amount is automatically calculated as the sum of all line items.

> **[SCREENSHOT NEEDED]:** _The Create Expense Report form showing the header fields at the top (title, fiscal year, description) and a line items section below with an "Add Line Item" button. Show one completed line item row with description, amount, date, expense type dropdown, merchant, and receipt fields._

### Expense Types

Each line item on an expense report has an expense type that classifies the spending:

| Expense Type | Description |
|-------------|-------------|
| **General** | General department expenses not covered by other categories |
| **Uniform Reimbursement** | Member uniform purchases or replacements |
| **PPE Replacement** | Personal protective equipment replacement |
| **Boot Allowance** | Boot purchase reimbursement |
| **Training Reimbursement** | Training course fees, materials, or registration |
| **Certification Fee** | Professional certification or license renewal fees |
| **Conference** | Conference registration, materials, or related costs |
| **Travel** | Travel expenses (fuel, tolls, parking, airfare) |
| **Meals** | Meal expenses during department business or training |
| **Mileage** | Personal vehicle mileage reimbursement |
| **Equipment Purchase** | Equipment purchased by the member for department use |
| **Other** | Expenses that do not fit other categories |

### Submitting an Expense Report

Only **Draft** reports can be submitted. The system validates that the `totalAmount` is greater than zero (i.e., at least one line item must exist with a positive amount). The approval chain is resolved based on the `expense_report` entity type, total amount, and budget category (derived from line items).

### Tracking and Payment

Open an expense report to see its detail page at `/finance/expenses/:id`. The detail page shows:

- Report number, title, and total amount (sum of all line items)
- Current status with approval chain progress
- All line items with their individual details
- Payment status and method (once paid)

> **[SCREENSHOT NEEDED]:** _An Expense Report Detail page showing the report header (ER-2026-0008, "FDIC Conference Expenses", total $979.00), status badge (Approved), the approval chain timeline, and the line items table with columns for description, amount, date, type, and merchant._

**Marking as Paid:**

**Required Permission:** `finance.manage`

Once an expense report is approved:

1. Open the report detail page.
2. Click **Mark as Paid**.
3. Optionally enter the **payment method** (e.g., "check #1234", "direct deposit", "petty cash").
4. Confirm the payment.

The paid amount is recorded against the associated budgets for each line item that has a `budgetId` set.

> **Hint:** Encourage members to attach receipts to each line item via the receipt URL field. This speeds up the approval process and provides an audit trail for your department's financial records.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Expense report with no line items | Cannot be submitted -- `totalAmount` must be greater than zero |
| Line items spanning multiple budget categories | Each line item can reference a different budget. The total is the sum of all line items |
| Adding line items after submission | Not permitted -- the report must be in Draft status to add line items |
| Editing the report after submission | Only permitted in Draft or Submitted status |
| Receipt not attached to a line item | The report can still be submitted, but approvers may request receipts before approving |
| Expense type mismatch with budget category | No validation -- the expense type is informational classification. The budget is determined by the `budgetId` field on the line item |
| Multiple line items against the same budget | All amounts are summed and added to that budget's `amountSpent` when the report is paid |

---

## Check Requests

Navigate to **Finance > Check Requests** to view and manage check requests.

Check requests are used when the department needs to issue a check to a payee -- for example, paying a vendor invoice, reimbursing a contractor, or making a recurring payment. Unlike purchase requests (which track the full procurement lifecycle) and expense reports (which reimburse members), check requests focus specifically on issuing a department check.

### Check Request Workflow

```
DRAFT --> SUBMITTED --> PENDING_APPROVAL --> APPROVED --> ISSUED
                             |                             |
                           DENIED                        VOIDED
              |
          CANCELLED
```

| Status | Description | Budget Impact |
|--------|-------------|---------------|
| **Draft** | Request is being prepared. | None |
| **Submitted** | Request has entered the approval chain. | None |
| **Pending Approval** | Request is waiting for approver action. | None |
| **Approved** | All approval steps are complete. The check can be issued. | None |
| **Issued** | The check has been written and issued. Check number and date are recorded. | **Amount is added to budget spent** |
| **Denied** | An approver has denied the request. | None |
| **Voided** | An issued check has been voided (e.g., lost check, cancelled payment). | **Spent amount is reversed** (subtracted, floored at zero) |
| **Cancelled** | The requester has cancelled the request before issuance. | None |

### Request Numbers

Check request numbers are auto-generated in the format **CK-YYYY-0001**, where YYYY is derived from the fiscal year's start date and the sequence number increments.

### Creating a Check Request

**Required Permission:** `finance.view`

1. Navigate to **Finance > Check Requests**.
2. Click **New Check Request** (or go directly to `/finance/check-requests/new`).
3. Fill in the request details:

| Field | Required | Description |
|-------|----------|-------------|
| **Payee Name** | Yes | Who the check should be made out to (max 300 characters) |
| **Amount** | Yes | The check amount (must be greater than zero) |
| **Fiscal Year** | Yes | The fiscal year to charge against |
| **Budget** | No | The specific budget line item |
| **Payee Address** | No | Mailing address for the payee |
| **Memo** | No | Memo line for the check (max 500 characters) |
| **Purpose** | No | Internal description of why the check is needed |
| **Notes** | No | Additional notes for approvers |

4. Click **Save as Draft** or **Submit**.

> **[SCREENSHOT NEEDED]:** _The Create Check Request form showing payee name, amount, fiscal year dropdown, budget dropdown, payee address textarea, memo, purpose, notes, and Save Draft / Submit buttons._

### Issuing a Check

**Required Permission:** `finance.manage`

After a check request is approved:

1. Open the check request detail page at `/finance/check-requests/:id`.
2. Click **Issue Check**.
3. Enter the **check number** from your physical check stock.
4. Confirm issuance.

The system records the check number and the issuance date. The check amount is added to the linked budget's spent total.

> **[SCREENSHOT NEEDED]:** _A Check Request Detail page showing the request header (CK-2026-0015, payee "ABC Fire Equipment", $2,340.00), the Approved status badge, the approval chain timeline with completed steps, and the "Issue Check" button with the check number input field._

### Voiding an Issued Check

If a check needs to be voided after issuance (e.g., lost in the mail, payment cancelled):

1. Open the issued check request.
2. Click **Void Check**.
3. Confirm the void action.

The check status changes to **Voided**. The amount is subtracted from the budget's spent total (floored at zero to prevent negative spent values).

> **Hint:** Voiding a check does not delete the record. The voided check remains in the system for audit trail purposes. If a replacement check is needed, create a new check request.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Issuing a check without entering a check number | Not permitted -- the `checkNumber` parameter is required for the issue endpoint |
| Voiding a check | The budget spent amount is reduced by the check amount, floored at zero |
| Duplicate check numbers | The system does not enforce unique check numbers -- it is the treasurer's responsibility to track physical check stock |
| Re-issuing a voided check | Create a new check request. The voided request remains as a historical record |
| Check request with no budget selected | The check can be issued, but no budget tracking occurs for the amount |
| Editing a check request after submission | Only permitted in Draft or Submitted status |

---

## Dues & Assessments

**Required Permission:** `finance.view` (to view), `finance.manage` (to create schedules and manage payments)

Navigate to **Finance > Dues** to manage member dues and assessments.

Dues management handles the collection of recurring fees from members -- annual dues, quarterly assessments, equipment fees, or any other recurring financial obligation.

### Dues Schedules

A dues schedule defines the terms of a recurring fee:

| Field | Description |
|-------|-------------|
| **Name** | Description of the dues (e.g., "Annual Membership Dues", "Q1 Assessment") (max 200 characters) |
| **Amount** | The amount each member owes per period (must be greater than zero) |
| **Frequency** | How often dues are collected (see table below) |
| **Due Date** | When the current period's payment is due |
| **Grace Period Days** | Number of days after the due date before the payment is considered overdue (default: 30) |
| **Late Fee Amount** | Optional fee assessed when payment is overdue (after the grace period) |
| **Fiscal Year** | Optionally tie the schedule to a specific fiscal year |
| **Applies to Membership Types** | Optionally restrict dues to specific membership tiers (stored as a JSON array, e.g., only Active members, not Life members) |
| **Is Active** | Whether the schedule is currently collecting dues |
| **Notes** | Optional notes about the schedule |

### Frequencies

| Frequency | Period |
|-----------|--------|
| **Annual** | Once per year |
| **Semi-Annual** | Twice per year (every 6 months) |
| **Quarterly** | Four times per year (every 3 months) |
| **Monthly** | Every month |

### Creating a Dues Schedule

**Required Permission:** `finance.manage`

1. Navigate to **Finance > Dues**.
2. Click **Create Dues Schedule**.
3. Fill in the schedule details (name, amount, frequency, due date, etc.).
4. Optionally set a **grace period** (default: 30 days) and **late fee amount**.
5. Optionally restrict the schedule to specific **membership types** using the multi-select.
6. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Create Dues Schedule form showing name, amount, frequency dropdown (Annual/Semi-Annual/Quarterly/Monthly), due date picker, grace period days input, late fee amount input, membership types multi-select, fiscal year dropdown, notes textarea, and Save button._

### Generating Member Dues

After creating a schedule, you need to generate individual dues records for each member:

1. On the **Finance > Dues** page, find the dues schedule.
2. Click **Generate Dues**.
3. The system queries all active users in your organization, checks whether each member already has a dues record for this schedule (idempotency guard), and creates a new record for each member who does not already have one.
4. Each generated record has a **Pending** status with the full `amountDue` from the schedule and the `dueDate` from the schedule.
5. The system returns the count of newly generated records.

> **Hint:** Run the **Generate Dues** action at the beginning of each dues period. For annual dues, generate at the start of the fiscal year. For quarterly dues, generate at the start of each quarter. The system is idempotent -- running it again will not create duplicates.

### Member Dues Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Payment is expected but not yet received |
| **Paid** | Full payment has been received (`amountPaid >= amountDue`) |
| **Partial** | A partial payment has been received (`amountPaid > 0` but less than `amountDue`). The remaining balance is tracked |
| **Overdue** | The due date plus grace period has passed without full payment |
| **Waived** | The dues have been waived by an officer (e.g., financial hardship, service credit) |
| **Exempt** | The member is exempt from this dues schedule (e.g., Life members exempt from annual dues) |

### Recording Payments

**Required Permission:** `finance.manage`

1. On the **Finance > Dues** page, find the member's dues record.
2. Click on the record to update it.
3. Enter the **amount paid** (must be greater than zero), **payment method**, and optionally a **transaction reference** (check number, receipt number, etc.) and **notes**.
4. Click **Save**.

Payments are cumulative -- each payment adds to the existing `amountPaid`. If the total amount paid reaches or exceeds the amount due, the status automatically changes to **Paid**. If it is between zero and the amount due, the status changes to **Partial**. The `paidDate` is recorded.

### Waiving Dues

**Required Permission:** `finance.manage`

To waive a member's dues:

1. Find the member's dues record.
2. Click **Waive**.
3. Enter a **reason** for the waiver (required).
4. Confirm.

The record is marked as **Waived** with the officer's ID, timestamp, and reason recorded for audit purposes.

### Dues Summary

The dues summary provides an overview of collection status across all members:

| Metric | Description |
|--------|-------------|
| **Total Expected** | Sum of all `amountDue` values across all member dues records |
| **Total Collected** | Sum of all `amountPaid` values |
| **Total Outstanding** | `Total Expected - Total Collected - Total Waived` |
| **Total Waived** | Sum of `amountDue` for records with Waived status |
| **Collection Rate** | `(Total Collected / Total Expected) * 100`, rounded to two decimal places |
| **Members Paid** | Count of members with Paid status |
| **Members Overdue** | Count of members with Overdue status |
| **Members Waived** | Count of members with Waived status |

The summary can be filtered by a specific dues schedule using the optional `scheduleId` parameter.

> **[SCREENSHOT NEEDED]:** _The Dues Management page showing the summary cards at the top (total expected, collected, outstanding, collection rate), a filter bar (by schedule, status), and a member dues table below with columns for member name, amount due, amount paid, status badge, due date, and action buttons (Record Payment, Waive)._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Generating dues when records already exist | The system checks for existing records per member per schedule (idempotency guard). Only members without existing records get new ones |
| Member joins mid-period | Their dues are not automatically generated. Run Generate Dues again -- the system will only create records for members who do not already have one |
| Partial payment followed by additional payment | Payments are cumulative. The second payment is added to the first. If the total reaches the amount due, status changes to Paid |
| Partial payment followed by waiver | The waiver sets the status to Waived. The amount already paid is not refunded -- this is an administrative decision |
| Dues schedule with no membership type filter | Dues are generated for all active users in the organization |
| Changing the dues amount on a schedule | Only affects newly generated records. Existing member dues records retain the original `amountDue` |
| Member status changes to inactive | Existing dues records are not automatically waived or cancelled. An officer should manually waive them if appropriate |
| Late fee application | The `lateFeeApplied` field on the member dues record tracks the late fee amount. Late fee logic is managed by the officer updating the record |
| Dues summary with no records | Returns zeroes for all metrics and 0% collection rate |

---

## QuickBooks Export

**Required Permission:** `finance.manage`

The QuickBooks export feature generates CSV files compatible with QuickBooks and other accounting software, allowing you to transfer financial data from The Logbook into your accounting system.

### Account Mappings

Before exporting, set up mappings between your Logbook budget categories and your QuickBooks chart of accounts:

1. Navigate to the export settings (accessible from the Finance module).
2. For each internal category, configure:
   - **Internal Category** -- The budget category name from The Logbook
   - **QB Account Name** -- The corresponding QuickBooks account name
   - **QB Account Number** -- Optional QuickBooks account number for additional precision
   - **Mapping Type** -- The account type: Expense, Income, or Asset

3. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The QuickBooks Export Mapping page showing a table with columns for Internal Category (from Logbook), QB Account Name, QB Account Number, Mapping Type (Expense/Income/Asset), and action buttons. Show several categories mapped (e.g., "Apparatus Maintenance" mapped to "6100 - Vehicle Maintenance")._

> **Hint:** You can also set the QuickBooks account name directly on each budget category (the `qbAccountName` field in Budget Category settings). The export mapping page provides a separate, more granular mapping layer.

### Generating an Export

1. Navigate to the export section.
2. Select the **date range start** and **date range end** for the transactions to include.
3. Select the **file format** (CSV is the default; IIF is also supported as a format type).
4. Click **Generate Export**.
5. A CSV file named `finance_export.csv` is downloaded to your computer.

The CSV includes these columns:

| Column | Description |
|--------|-------------|
| **Date** | Transaction date in MM/DD/YYYY format |
| **Type** | Transaction type: `Bill Pmt` (purchase request), `Check` (check request), or `Expense` (expense report line item) |
| **Num** | Reference number (request number, check number, or report number) |
| **Name** | Vendor, payee, or merchant name |
| **Memo** | Transaction description (title, memo, or line item description) |
| **Account** | Reserved for account mapping (currently empty in export) |
| **Debit** | Transaction amount |
| **Credit** | Reserved (currently empty in export) |

The export includes:
- **Purchase Requests** with Paid status, filtered by `paidAt` date
- **Check Requests** with Issued status, filtered by `checkDate`
- **Expense Reports** with Paid status (one row per line item), filtered by `paidAt` date

### Export Logs

Every export is logged with:

| Field | Description |
|-------|-------------|
| **Export Type** | The type of data exported |
| **Date Range** | Start and end dates of the exported period |
| **Record Count** | Number of transactions included |
| **File Format** | The output format (CSV or IIF) |
| **Exported By** | The officer who generated the export |
| **Exported At** | Timestamp of the export |

> **[SCREENSHOT NEEDED]:** _The Export Logs page showing a table of past exports with columns for export type, date range, record count, file format, exported by, and timestamp._

> **Hint:** Export frequently (monthly or quarterly) rather than waiting for year-end. This makes reconciliation with QuickBooks easier and catches mapping issues early. Each export creates a log entry so you can track what has been exported and when.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No transactions in the selected date range | An empty CSV file is generated (headers only, no data rows). An export log is still created with record count 0 |
| Date range spanning multiple fiscal years | All matching transactions are included regardless of fiscal year boundaries |
| Expense report with multiple line items | Each line item becomes a separate row in the CSV, all sharing the same report number |
| Purchase request with actual amount different from estimated | The export uses the actual amount if set, otherwise falls back to the estimated amount |
| Check request without a check number | The export uses the request number (CK-YYYY-NNNN) as the Num column value |

---

## Realistic Example: Annual Budget Cycle

This walkthrough follows a fictional fire department through a complete annual budget cycle, from setup through year-end reconciliation.

### Phase 1: Setting Up the New Fiscal Year (June)

The Falls Church Fire Department operates on a July 1 -- June 30 fiscal year. In June, the Treasurer sets up the next fiscal year:

1. **Create the fiscal year:** Navigate to **Finance > Settings** and create "FY 2027" with start date July 1, 2026 and end date June 30, 2027. It starts in **Draft** status.

2. **Review budget categories:** Ensure the category list matches the department's chart of accounts. Navigate to **Finance > Settings** and check the Budget Categories section:
   - Operations > Fuel
   - Operations > Vehicle Maintenance
   - Operations > Station Supplies
   - Training > Course Fees
   - Training > Travel
   - Equipment > PPE
   - Equipment > Tools
   - Administrative > Office Supplies

3. **Create budgets:** Navigate to **Finance > Budgets** and create a budget for each category with the approved amounts from the annual budget meeting:
   - Fuel: $45,000
   - Vehicle Maintenance: $30,000
   - Training Course Fees: $15,000
   - PPE: $25,000
   - (and so on for each category)

4. **Configure approval chains:** Navigate to **Finance > Settings > Approval Chains** and set up:
   - "Small Purchases" (Purchase Requests under $500): 1 step -- Captain Approval
   - "Standard Purchases" (Purchase Requests $500--$2,500): 2 steps -- Captain Approval, then Chief Approval
   - "Large Purchases" (Purchase Requests over $2,500): 3 steps -- Captain Approval, Chief Approval, then Board Treasurer Notification
   - "Training Expenses" (Expense Reports, category: Training): 2 steps -- Training Officer Approval, then Chief Approval
   - "Standard Expense Reimbursement" (Expense Reports, default): 2 steps -- Captain Approval, then Treasurer Notification
   - "Check Issuance" (Check Requests, default): 2 steps -- Treasurer Approval, then Chief Approval

5. **Set up dues:** Create an "FY 2027 Annual Membership Dues" schedule -- $150/member, annual frequency, due August 1, with a 30-day grace period and $25 late fee.

6. **Set up QuickBooks mappings:** Navigate to the export mappings and map each category to the corresponding QuickBooks account (e.g., "Fuel" to "6200 - Vehicle Fuel").

### Phase 2: Activating the New Year (July 1)

On July 1, the Treasurer:

1. **Activates the new fiscal year:** Navigate to **Finance > Settings** and click **Activate** on FY 2027. The previously active FY 2026 is automatically closed.
2. **Generates member dues:** Navigate to **Finance > Dues**, find the annual dues schedule, and click **Generate Dues**. Every active member receives a Pending dues record for $150 due August 1.
3. **Checks the dashboard:** Navigate to **Finance** and verify the dashboard shows the new fiscal year's budgets with $0 spent and $0 encumbered.

### Phase 3: Day-to-Day Operations (July--June)

**A captain needs a new set of hose couplings ($350):**

1. The captain navigates to **Finance > Purchase Requests > New**.
2. Fills in: Title "Hose Coupling Replacements", Budget "Equipment > Tools", Estimated Amount $350, Vendor "Fire Supply Co.", Priority "Medium".
3. Clicks **Submit**.
4. The $350 request matches the "Small Purchases" chain (under $500) -- only Captain approval is needed.
5. Since `allowSelfApproval` is false on the step, the other captain on duty receives the approval notification.
6. The other captain navigates to their pending approvals and approves. The request moves to **Approved** and $350 is **encumbered** against the Tools budget.
7. The captain orders the couplings and clicks **Mark as Ordered**.
8. When the couplings arrive, they click **Mark as Received**.
9. The Treasurer pays the invoice and clicks **Mark as Paid** with actual amount $342.50.
10. The $350 encumbrance is released. $342.50 moves to **spent** in the Tools budget. The $7.50 difference returns to the available balance.

**A firefighter attended a conference and needs reimbursement ($979):**

1. The firefighter navigates to **Finance > Expenses > New**.
2. Creates report titled "FDIC Conference Expenses" and adds four line items:
   - Registration fee: $275 (type: Conference, budget: Training > Course Fees)
   - Hotel 3 nights: $450 (type: Travel, budget: Training > Travel)
   - Meals: $120 (type: Meals, budget: Training > Travel)
   - Mileage 200 miles at $0.67: $134 (type: Mileage, budget: Training > Travel)
3. Submits the report (total: $979).
4. The report matches the "Training Expenses" chain -- Training Officer approves, then Chief approves.
5. The Treasurer clicks **Mark as Paid** with payment method "Check #4521". Each line item's amount is added to its linked budget's spent total.

**The department needs to pay a vendor invoice ($2,340):**

1. The Treasurer navigates to **Finance > Check Requests > New**.
2. Creates a check request: Payee "ABC Uniform Co.", Amount $2,340, Purpose "New dress uniforms order", Budget "Equipment > PPE".
3. Submits the request. It matches the "Check Issuance" chain -- Treasurer approval, then Chief approval.
4. After both approve, the Treasurer clicks **Issue Check**, enters check number "4522".
5. The $2,340 is recorded as spent against the PPE budget.

**Collecting annual dues (August):**

1. The Treasurer monitors the dues collection on **Finance > Dues**, filtering by the annual dues schedule.
2. As members pay, the Treasurer records each payment with the amount, payment method (cash, check, online), and transaction reference.
3. After the September 1 grace period, the Treasurer identifies overdue members and sends reminders.
4. For a member experiencing financial hardship, the Treasurer clicks **Waive** and enters "Financial hardship - board approved" as the reason.

### Phase 4: Monitoring (Throughout the Year)

The Treasurer regularly:

1. Checks the **Finance Dashboard** for budget health -- watching for categories approaching their limits.
2. Reviews **pending approvals** and processes them promptly.
3. Monitors **dues collection** -- following up with members who are overdue after the grace period.
4. Runs **QuickBooks exports** monthly -- selecting the previous month's date range, generating the CSV, and importing it into QuickBooks for reconciliation.

### Phase 5: Year-End Reconciliation (June)

Before closing the fiscal year:

1. Ensure all pending purchase requests are either completed (paid) or cancelled.
2. Ensure all expense reports are processed and paid.
3. Ensure all check requests are issued or cancelled.
4. Run a final QuickBooks export for the last month.
5. Review the budget summary on the dashboard for any discrepancies between The Logbook and QuickBooks.
6. Lock FY 2027: navigate to **Finance > Settings** and click **Lock**. All FY 2027 data becomes read-only.
7. Activate FY 2028 (already set up in Draft during the previous month).

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot see the Finance module" | Finance is an optional module. Your department administrator must enable it in **Settings > Organization > Modules**. |
| "No fiscal years available when creating a request" | An active fiscal year must exist. Ask an officer with `finance.manage` permission to create and activate a fiscal year in **Finance > Settings**. |
| "My purchase request was auto-approved with no review" | No approval chain matched your request (based on entity type, amount, and category). An officer with `finance.configure_approvals` permission should set up approval chains in **Finance > Settings > Approval Chains**. Use the Preview tool to verify chain matching. |
| "I submitted a request but no one received the approval notification" | Verify that the approval chain step has a valid approver. For Position-type steps, at least one member must hold that position. For Permission-type steps, at least one member must have the `finance.approve` permission. |
| "Budget shows negative remaining amount" | This means approved and paid requests exceed the budgeted amount. The system allows over-budget approvals. Adjust the budget amount or cancel/deny excess requests. |
| "Cannot edit my purchase request" | Purchase requests can only be edited in **Draft** or **Submitted** status. Once in Pending Approval or later, they cannot be modified. Cancel and re-create if changes are needed. |
| "Dues show as Overdue immediately" | Check the **due date** and **grace period** on the dues schedule. If the due date plus grace period has already passed, newly generated records may appear overdue. Adjust the schedule settings or due date if needed. |
| "QuickBooks export is missing some transactions" | The export only includes Purchase Requests with Paid status, Check Requests with Issued status, and Expense Reports with Paid status within the selected date range. Verify the transactions have reached the correct terminal status. Also check that account mappings are configured for all categories. |
| "Approval chain not matching the expected chain" | Use the **Preview** tool on the Approval Chains settings page to see which chain matches for a given entity type, amount, and category. The most specific match wins -- see [Chain Resolution](#chain-resolution-specificity) for the scoring rules. |
| "Cannot void an issued check" | Voiding is only permitted for checks with **Issued** status. If the check has already been voided, it cannot be voided again. |
| "Member dues not generated for a new member" | The **Generate Dues** action only creates records for members who do not already have a record for that schedule. If a member joined after the initial generation, run Generate Dues again -- it will create a record only for that member. |
| "Cannot delete a budget category" | Categories with existing budgets cannot be deleted. Reassign or delete the associated budgets first, then delete the category. |
| "Cannot delete an approval chain" | Verify there are no active requests using step records from that chain. Wait for all associated requests to reach a terminal status (Paid, Denied, Cancelled, Voided, Issued) before deleting. |
| "Encumbered amount not released after denial" | This is expected behavior. Denial happens during the approval flow, before the request reaches Approved status, so no encumbrance was ever created. The budget was never affected. |
| "Late fee not applied" | Late fees must be manually applied by updating the member dues record. The `lateFeeAmount` on the schedule defines the fee amount, and the `lateFeeApplied` field on the individual record tracks whether it has been applied. |
| "I need to change the amount on an approved purchase request" | The estimated amount cannot be changed after the request leaves Draft/Submitted status. However, when marking the request as **Paid**, you can enter the **actual amount**, which is what gets recorded against the budget. The difference between estimated (encumbered) and actual (spent) is reconciled automatically. |
| "External email approver link expired" | External approval tokens are valid for 7 days. If the link has expired, the request must be handled through the system by an internal approver, or the approval chain can be modified to add a new step. |
| "Payment recorded but status still shows Partial" | Payments are cumulative. The status changes to Paid only when `amountPaid >= amountDue`. Record another payment for the remaining balance to reach the full amount. |
| "How do I see what I need to approve?" | Navigate to the Finance Dashboard -- your pending approval count is displayed prominently. Click through to see the individual requests awaiting your action. You need the `finance.approve` permission to see and act on pending approvals. |

---

**Previous:** [Mobile & PWA Usage](./10-mobile-pwa.md) | **Next:** [Grants & Fundraising](./12-grants-fundraising.md)
