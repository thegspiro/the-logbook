# Grants & Fundraising

The Grants & Fundraising module manages the complete lifecycle of fire department grants — from opportunity research through application, award, expenditure tracking, and compliance reporting — alongside fundraising campaigns, donor management, and donation tracking.

---

## Table of Contents

1. [Grants & Fundraising Overview](#grants--fundraising-overview)
2. [Grants Dashboard](#grants-dashboard)
3. [Grant Opportunities Library](#grant-opportunities-library)
4. [Grant Applications](#grant-applications)
5. [Grant Application Pipeline](#grant-application-pipeline)
6. [Budget Items & Expenditure Tracking](#budget-items--expenditure-tracking)
7. [Compliance Tasks](#compliance-tasks)
8. [Application Notes & Activity](#application-notes--activity)
9. [Fundraising Campaigns](#fundraising-campaigns)
10. [Donor Management](#donor-management)
11. [Recording Donations](#recording-donations)
12. [Pledges](#pledges)
13. [Fundraising Events](#fundraising-events)
14. [Reports & Analytics](#reports--analytics)
15. [Realistic Example: Applying for an AFG Grant](#realistic-example-applying-for-an-afg-grant)
16. [Troubleshooting](#troubleshooting)

---

## Grants & Fundraising Overview

Navigate to **Grants & Fundraising** in the sidebar. The module requires the `MODULE_GRANTS_ENABLED` feature flag.

| URL | Page | Permission |
|-----|------|------------|
| `/grants` | Dashboard | `fundraising.view` |
| `/grants/opportunities` | Grant Opportunities Library | `fundraising.view` |
| `/grants/applications` | Application List (Pipeline/Table) | `fundraising.view` |
| `/grants/applications/new` | Create Application | `fundraising.manage` |
| `/grants/applications/:id` | Application Detail (5 tabs) | `fundraising.view` |
| `/grants/applications/:id/edit` | Edit Application | `fundraising.manage` |
| `/grants/campaigns` | Fundraising Campaigns | `fundraising.view` |
| `/grants/donors` | Donor Directory/CRM | `fundraising.view` |
| `/grants/donations` | All Donations | `fundraising.view` |
| `/grants/reports` | Financial Reports | `fundraising.view` |

### Permissions

| Permission | Description |
|------------|-------------|
| `fundraising.view` | View dashboard, opportunities, applications, campaigns, donors, donations, reports |
| `fundraising.manage` | Create/update/delete applications, budget items, expenditures, tasks, campaigns, donors, donations |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Grants & Fundraising sidebar navigation showing Dashboard, Opportunities, Applications, Campaigns, Donors, Donations, and Reports._

---

## Grants Dashboard

The main dashboard at `/grants` shows key performance indicators:

- **Total Funds Raised** (YTD and 12-month)
- **Active Campaigns** with progress bars toward goals
- **Upcoming Grant Deadlines** (next 90 days, urgency-coded)
- **Pending Applications** count
- **Active Grants** being managed
- **Recent Donations** activity
- **Outstanding Pledges**
- **Compliance Tasks Due**
- **Pipeline by Status** (applications across all stages)

> **[SCREENSHOT NEEDED]:** _Screenshot of the Grants Dashboard showing KPI cards (Total Raised: $125,000, Active Campaigns: 3, Pending Applications: 2, Active Grants: 1), upcoming deadlines widget, and recent donations list._

---

## Grant Opportunities Library

The opportunities library is a catalog of available grant programs. Pre-loaded with common fire service grants:

| Program | Agency | Description |
|---------|--------|-------------|
| **AFG** | FEMA | Assistance to Firefighters Grant — equipment, PPE, training |
| **SAFER** | FEMA | Staffing for Adequate Fire & Emergency Response — hiring |
| **FP&S** | FEMA | Fire Prevention & Safety — prevention, research |
| State grants | Various | State-specific emergency services funding |

### Browsing Opportunities

1. Navigate to **Grants > Opportunities**
2. Filter by category: Equipment, Staffing, Training, Prevention, Facilities, Vehicles, Wellness, Community, Other
3. Search by name or agency
4. **Deadline urgency** color-coded: Red (< 14 days), Yellow (< 30 days), Green (> 30 days)

### Adding an Opportunity

**Required Permission:** `fundraising.manage`

1. Click **Add Opportunity**
2. Fill in: name, agency, description, eligibility criteria, application URL
3. Set deadline type: Fixed, Recurring, or Rolling
4. Enter typical award range (min/max) and match requirements
5. Add required documents list and federal program code
6. Save

> **[SCREENSHOT NEEDED]:** _Screenshot of the Opportunities Library showing a grid of grant program cards with agency logos, award ranges, deadline badges (red/yellow/green), and category tags._

---

## Grant Applications

### Creating an Application

**Required Permission:** `fundraising.manage`

1. Navigate to **Grants > Applications** and click **New Application**
2. Fill in:
   - **Grant Program Name** — or select from the opportunities library
   - **Grant Agency** — funding organization
   - **Amount Requested** — what you're asking for
   - **Match Amount** / **Match Source** — local match requirements
   - **Application Deadline** — when to submit
   - **Project Description** — what the grant will fund
   - **Priority** — Low, Medium, High, or Critical
   - **Assigned To** — team member managing the application
3. Save — application starts in **Researching** status

> **[SCREENSHOT NEEDED]:** _Screenshot of the Create Application form showing program name, agency, amount requested, match fields, deadline, project description, priority dropdown, and assignee selector._

---

## Grant Application Pipeline

Applications progress through 10 stages:

| Status | Description | Next Steps |
|--------|-------------|------------|
| **Researching** | Evaluating fit, gathering requirements | Move to Preparing when ready |
| **Preparing** | Writing application, assembling documents | Submit for Internal Review |
| **Internal Review** | Department leadership review | Submit to grantor |
| **Submitted** | Application filed with funding agency | Wait for response |
| **Under Review** | Grantor is evaluating | Wait for decision |
| **Awarded** | Grant approved! | Begin spending and reporting |
| **Denied** | Application not selected | Note lessons learned |
| **Active** | Grant period in progress, funds being spent | Track expenditures |
| **Reporting** | Performance reports due | File required reports |
| **Closed** | Grant period complete | Final closeout |

### Pipeline View vs Table View

Applications can be viewed in two ways:
- **Pipeline (Kanban)** — Visual columns with drag-and-drop between stages
- **Table** — Sortable, filterable list with status badges

> **[SCREENSHOT NEEDED]:** _Screenshot of the Applications page in Pipeline (kanban) view showing columns for each status with application cards that can be dragged between columns. Show at least 3 columns with cards._

---

## Budget Items & Expenditure Tracking

Each grant application has a **budget** broken down into line items and tracked expenditures.

### Budget Items

Navigate to the **Budget** tab on an application detail page.

| Field | Description |
|-------|-------------|
| Category | Equipment, Personnel, Training, Contractual, Supplies, Travel, Construction, Indirect, Other |
| Description | What the money is for |
| Amount Budgeted | Planned spending for this line |
| Amount Spent | Auto-calculated from expenditures |
| Amount Remaining | Budgeted minus spent |
| Federal Share | How much is covered by the grant |
| Local Match | Department's cost-share obligation |

### Expenditures

Navigate to the **Expenditures** tab to record spending against the budget:

1. Click **Record Expenditure**
2. Enter: description, amount, date, vendor, invoice number
3. Optionally link to a budget item
4. Add receipt URL and approval info
5. Save

> **[SCREENSHOT NEEDED]:** _Screenshot of the Budget tab showing a table of budget items (Equipment: $40,000 budgeted / $15,000 spent / $25,000 remaining; Training: $10,000 budgeted / $2,000 spent / $8,000 remaining) with a "Record Expenditure" button._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Expenditure exceeds budget item | Allowed but flagged; over-budget highlighted |
| Budget item deleted | Cascades to linked expenditures |
| Expenditure without budget item | Standalone expenditure; still tracked |

---

## Compliance Tasks

Awarded grants come with reporting and compliance obligations. The system tracks these as tasks.

### Task Types

| Type | Description |
|------|-------------|
| Performance Report | Periodic progress report to grantor |
| Financial Report | Spending report with receipts/documentation |
| Progress Update | Informal status update |
| Site Visit | On-site inspection by grantor |
| Audit | Financial or program audit |
| Equipment Inventory | Physical inventory of grant-purchased items |
| NFIRS Submission | National Fire Incident Reporting submission |
| Closeout Report | Final report at end of grant period |
| Other | Custom compliance task |

### Task Statuses

| Status | Description |
|--------|-------------|
| Pending | Not yet started |
| In Progress | Work underway |
| Completed | Task finished and documented |
| Overdue | Past due date, not completed |
| Waived | Excused (with documentation) |

### Managing Tasks

1. Navigate to the **Compliance** tab on an application
2. Tasks may be auto-generated when the application status changes to "Awarded" (based on grant type and reporting frequency)
3. Assign tasks to team members
4. Set reminder days (e.g., remind 14 days before due date)
5. Mark tasks complete when done

> **[SCREENSHOT NEEDED]:** _Screenshot of the Compliance Tasks tab showing tasks with due dates, status badges (green=completed, red=overdue, yellow=pending), assignee names, and a "Add Task" button._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Task overdue | Status auto-changes to Overdue; notification sent |
| Waived task | Requires documentation reason |
| Auto-generated tasks | Created based on grant type and reporting_frequency setting |
| Reminder not sending | Check that reminder_days_before is set and email is configured |

---

## Application Notes & Activity

The **Activity** tab on each application provides a chronological log of all actions:

- Status changes
- Budget modifications
- Expenditure recordings
- Document uploads
- Notes added
- Task completions

### Note Types

| Type | Description |
|------|-------------|
| General | Free-form notes |
| Status Change | Automatic log of status transitions |
| Document Added | File upload notification |
| Contact Made | Record of communication with grantor |
| Milestone | Key project milestone |
| Financial | Financial event or update |
| Compliance | Compliance-related note |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Activity tab showing a timeline of events: "Status changed to Submitted" (March 1), "Note added: Contacted program officer" (March 5), "Budget item added: Training Equipment $10,000" (March 10)._

---

## Fundraising Campaigns

Campaigns organize fundraising efforts around a specific goal.

### Creating a Campaign

**Required Permission:** `fundraising.manage`

1. Navigate to **Grants > Campaigns** and click **Create Campaign**
2. Fill in:
   - **Name** — e.g., "2026 Annual Fund Drive"
   - **Description** — campaign purpose and story
   - **Campaign Type** — General, Equipment, Training, Community, Memorial, Event, Other
   - **Goal Amount** — target fundraising amount
   - **Start/End Dates** — campaign period
   - **Status** — Draft, Active, Paused, Completed, Cancelled
3. Save

### Campaign Features

- **Progress tracking** — Real-time progress bar toward goal
- **Suggested donation amounts** — Pre-set tiers (e.g., $25, $50, $100, $250)
- **Minimum donation** — Floor amount
- **Anonymous donations** — Toggle allowing anonymous giving
- **Match Campaign linking** — Link to a grant application for cost-share campaigns

> **[SCREENSHOT NEEDED]:** _Screenshot of a campaign detail page showing "2026 Equipment Fund" with progress bar ($45,000 / $75,000 — 60%), recent donation list, and donation stats._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Campaign past end date | Status can be manually changed to Completed |
| Campaign linked to grant match | Donations count toward grant cost-share |
| Soft-delete campaign | Marked inactive; historical data preserved |

---

## Donor Management

The donor CRM tracks all individuals, businesses, and organizations that support the department.

### Creating a Donor Record

1. Navigate to **Grants > Donors** and click **Add Donor**
2. Fill in: name, email, phone, address, donor type (Individual, Business, Foundation, Government, Other)
3. For business donors: company name
4. Add tags and communication preferences
5. Save

### Donor Profile

Each donor profile shows:
- Contact information
- **Giving history** — total donated, donation count, first/last donation dates
- **Donation records** — chronological list of all gifts
- **Tags** — for categorization and segmentation
- **Communication preferences** — how and when to contact

> **[SCREENSHOT NEEDED]:** _Screenshot of a donor profile showing contact details, giving summary (Total: $2,500 across 8 donations), donation history table, and tags ("Annual Donor", "Business")._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Donor linked to a member | `user_id` field connects to the member profile |
| Anonymous donor | `is_anonymous = true`; name not shown in public views |
| Donor deactivated | Soft-delete; historical records preserved |

---

## Recording Donations

### Creating a Donation Record

1. Navigate to **Grants > Donations** and click **Record Donation**
2. Fill in:
   - **Donor** — select from directory or enter details for one-time gift
   - **Campaign** — which campaign (optional)
   - **Amount** — donation amount
   - **Payment Method** — Cash, Check, Credit Card, Bank Transfer, PayPal, Venmo, Other
   - **Donation Date** — when received
   - **Is Recurring** — toggle for recurring gifts (with frequency: weekly, monthly, quarterly, annually)
   - **Is Anonymous** — whether to display donor name
   - **Dedication** — In Honor Of or In Memory Of (with dedication name)
   - **Tax Deductible** — flag for tax receipt purposes
3. Save

### Payment Statuses

| Status | Description |
|--------|-------------|
| Pending | Payment initiated, not yet confirmed |
| Completed | Payment received and confirmed |
| Failed | Payment attempt failed |
| Refunded | Payment returned to donor |
| Cancelled | Payment cancelled before processing |

### Donation Acknowledgments

Track whether receipts and thank-you letters have been sent:
- `receipt_sent` / `receipt_sent_at` — tax receipt
- `thank_you_sent` / `thank_you_sent_at` — thank-you letter

> **[SCREENSHOT NEEDED]:** _Screenshot of the Record Donation form showing donor selector, campaign dropdown, amount field, payment method dropdown, date picker, recurring toggle, anonymous toggle, and dedication fields._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Recurring donation | Records each occurrence separately; tracks frequency |
| Anonymous donation with dedication | Dedication shown; donor name hidden |
| Donation to inactive campaign | Allowed but logged; counted toward campaign total |
| Check donation | `check_number` field available for reference |

---

## Pledges

Pledges track donation commitments that haven't been fulfilled yet.

### Creating a Pledge

1. Navigate to **Grants > Donations** (pledges tab)
2. Click **Create Pledge**
3. Fill in: donor, campaign, pledged amount, pledge date, due date
4. Optionally set a payment schedule and enable reminders
5. Save

### Pledge Statuses

| Status | Description |
|--------|-------------|
| Pending | Pledged, no payments yet |
| Partial | Some payments received |
| Fulfilled | Full amount received |
| Cancelled | Pledge withdrawn |
| Overdue | Past due date, not fully paid |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Pledges list showing several pledges with donor name, pledged amount, fulfilled amount, status badge, and due date._

---

## Fundraising Events

Event-based fundraising (dinners, galas, auctions, raffles, etc.) links campaigns to specific events.

### Creating a Fundraising Event

1. Navigate to **Grants > Campaigns** and open a campaign
2. Click **Add Fundraising Event**
3. Fill in: name, event type, date, location, ticket price, max attendees
4. Set revenue goal and registration URL
5. Add sponsors (JSON list)
6. Save

### Event Types

Dinner, Gala, Auction, Raffle, Golf Outing, Walkathon, Other

### Tracking Results

After the event, update:
- **Actual Revenue** — total raised
- **Expenses** — event costs
- **Current Attendees** — actual attendance count

> **[SCREENSHOT NEEDED]:** _Screenshot of a fundraising event detail showing "Annual Dinner Gala" with ticket sales progress, revenue goal bar, sponsor logos, and expense tracking._

---

## Reports & Analytics

Navigate to **Grants > Reports** for two report types:

### Grant Report

- Grant applications by status
- Total requested vs awarded amounts
- Success rate (awarded/total applications)
- Active grant burn rate (spending vs timeline)

### Fundraising Report

- Donation totals by period (monthly, quarterly, annual)
- Donor acquisition and retention rates
- Campaign performance comparison
- Payment method breakdown
- Average donation size

> **[SCREENSHOT NEEDED]:** _Screenshot of the Fundraising Report showing donation trends chart (monthly bars), top campaigns table, payment method pie chart, and summary metrics._

---

## Realistic Example: Applying for an AFG Grant

### Background

**Oakville Fire Department** needs to replace aging SCBA equipment. Chief **Morrison** assigns Lt. Walsh to apply for an Assistance to Firefighters Grant (AFG).

### Part 1: Research (January)

Lt. Walsh opens the **Opportunities Library** and finds the AFG program:
- **Agency:** FEMA
- **Deadline:** Rolling (applications accepted Jan–Mar)
- **Typical Award:** $50,000–$500,000
- **Match Required:** Yes — 15% local cost-share
- **Required Documents:** Application narrative, cost analysis, department profile

He creates a new application:
- **Title:** "SCBA Replacement — AFG 2026"
- **Amount Requested:** $180,000
- **Match Amount:** $31,765 (15% of total project cost $211,765)
- **Priority:** Critical
- **Status:** Researching

### Part 2: Application Preparation (February)

Lt. Walsh moves the application to **Preparing** and:

1. Adds budget items:
   - Equipment (SCBA units): $165,000 — Federal: $140,250, Local: $24,750
   - Training (SCBA certification): $15,000 — Federal: $12,750, Local: $2,250
   - Indirect costs: $11,765 — Federal: $10,000, Local: $1,765

2. Writes the project narrative describing the need
3. Uploads supporting documents (department profile, cost quotes, needs assessment)
4. Adds a note: "Contacted regional FEMA office for guidance on narrative format"

### Part 3: Submission (March 1)

Chief Morrison reviews and approves → Lt. Walsh submits:
- Status: **Submitted**
- Application deadline met with 2 weeks to spare

### Part 4: Award (June 15)

FEMA notifies the department: **Awarded!**

Lt. Walsh updates the application:
- Status: **Awarded**
- Amount Awarded: $180,000
- Grant Start Date: July 1, 2026
- Grant End Date: June 30, 2027
- Reporting Frequency: Quarterly

The system auto-generates compliance tasks:
- Q1 Performance Report (due Oct 15)
- Q1 Financial Report (due Oct 15)
- Q2 Performance Report (due Jan 15)
- Q2 Financial Report (due Jan 15)
- Q3 Performance Report (due Apr 15)
- Q4 Performance Report + Closeout (due Jul 15)
- Equipment Inventory (due Jul 30)

### Part 5: Grant Period (July–December)

As SCBA units arrive and are deployed, Lt. Walsh records expenditures:
- Jul 15: MSA Safety invoice — $82,500 (30 SCBA units, first shipment)
- Aug 20: Training vendor — $7,500 (SCBA certification course)
- Oct 1: MSA Safety invoice — $82,500 (30 SCBA units, second shipment)

Budget utilization: $172,500 / $180,000 = 95.8%

He completes the Q1 reports on time and marks the tasks as Complete.

### Part 6: Closeout (July 2027)

Lt. Walsh files the final closeout report:
- Total spent: $175,200
- Equipment inventory verified: all 60 SCBA units accounted for
- Remaining $4,800 returned to FEMA
- Status: **Closed**

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Grant opportunity not showing deadline | Check that deadline_type and deadline_date are set. Rolling deadlines have no fixed date. |
| Cannot create application | Verify `fundraising.manage` permission. Check that the module is enabled. |
| Budget items not matching expenditures | Expenditures must be linked to budget items for automatic tracking. Unlinked expenditures count toward totals but not line items. |
| Compliance task not auto-created | Auto-creation depends on reporting_frequency being set on the application. Set it after the application is awarded. |
| Campaign progress not updating | Donations must be linked to the campaign via campaign_id. Unlinked donations don't count. |
| Donor duplicate | System does not auto-detect donor duplicates. Search before creating. Merge not yet available. |
| Pledge shows overdue incorrectly | Check the due_date. Partial payments keep the pledge in Partial status until fully paid. |
| Report shows $0 for a period | Verify the date range includes transactions. Some reports filter by fiscal_year_id. |
| Cannot delete application | Applications with expenditures or compliance tasks must have those removed first. |

---

**Previous:** [Finance](./11-finance.md) | **Next:** [Medical Screening](./13-medical-screening.md)
