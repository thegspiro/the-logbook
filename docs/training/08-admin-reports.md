# Administration, Reports & Settings

This guide covers department administration tasks including organization settings, role management, the setup checklist, reports, analytics, and system monitoring. These features are primarily used by officers and the IT Manager.

---

## Table of Contents

1. [Department Setup Checklist](#department-setup-checklist)
2. [Organization Settings](#organization-settings)
3. [Module Management](#module-management)
4. [Role and Permission Management](#role-and-permission-management)
5. [Reports](#reports)
6. [Analytics Dashboard](#analytics-dashboard)
7. [Public Portal Configuration](#public-portal-configuration)
8. [Error Monitoring](#error-monitoring)
9. [Scheduled Tasks](#scheduled-tasks)
10. [Security and Compliance](#security-and-compliance)
11. [Realistic Example: Generating the Annual Training Summary Report](#realistic-example-generating-the-annual-training-summary-report)
12. [Realistic Example: First-Time Department Setup](#realistic-example-first-time-department-setup)
13. [Troubleshooting](#troubleshooting)

---

## Department Setup Checklist

**Required Permission:** `settings.manage`

Navigate to **Administration > Department Setup** to access the guided setup checklist.

When your department first sets up The Logbook, this checklist guides you through essential configuration steps:

- Department information (name, address, phone, logo)
- Department type (Fire Department, EMS, Fire/EMS Combined)
- Department identifiers (FDID, State ID)
- Initial member accounts
- Role configuration
- Module selection
- Notification setup

Each step shows its completion status. You can return to any step to update the configuration.

> **Screenshot placeholder:**
> _[Screenshot of the Department Setup Checklist page showing a vertical checklist of steps with green checkmarks for completed steps, a blue circle for the current step, and gray circles for incomplete steps. Show step titles like "Department Profile", "Member Import", "Configure Roles", "Enable Modules"]_

> **Hint:** The setup checklist is always accessible even after initial setup. Use it as a reference to verify your department's configuration is complete.

---

## Organization Settings

**Required Permission:** `settings.manage`

Navigate to **Administration > Organization Settings > Organization** to manage department-wide settings.

> **Note:** Organization Settings are separate from user account settings. Organization Settings require the `settings.manage` permission and are only visible to administrators. Individual users manage their own profile, password, and preferences at **My Account** (`/account`).

### General Settings

- **Department Name** and **Slug** (URL identifier)
- **Department Type** and **Identifiers** (FDID, State ID)
- **Timezone** setting
- **Contact Information** (phone, fax, email, website)
- **Mailing and Physical Addresses**
- **Logo** upload

> **Screenshot placeholder:**
> _[Screenshot of the Organization Settings page showing the department name, type selector, timezone dropdown, and the contact information section with phone, email, and address fields]_

### Contact Info Visibility

Control which contact information fields are visible to members:

- Toggle visibility of email, phone, mobile, and address fields
- Members will only see the fields you enable
- Officers always see all fields regardless of this setting

### Membership ID Settings

Configure how membership IDs are assigned:

- Enable/disable automatic membership ID generation
- Set the ID format (prefix, numeric pattern)
- View and manage the next available ID number

---

## Module Management

**Required Permission:** `settings.manage`

Navigate to **Settings > Organization** and scroll to the **Modules** section.

Modules are organized into three categories:

### Core Modules (Always Enabled)
These cannot be disabled:
- Dashboard
- Membership Management
- Scheduling
- Personal Settings
- System Settings
- Documents & Files
- Custom Forms

### Recommended Modules (Enabled by Default)
These can be disabled if not needed:
- Apparatus Management
- Inventory Management
- Communications

### Optional Modules (Disabled by Default)
Enable these as needed:
- Training & Certification
- Incidents & Reports
- HR & Payroll
- Grants & Fundraising
- Facilities Management
- Prospective Members Pipeline
- Public Information
- Medical Screening *(added 2026-03-13)*
- Finance *(added 2026-03-12)*

> **Screenshot placeholder:**
> _[Screenshot of the Module Management section showing the three categories of modules, each with enable/disable toggles. Show some optional modules enabled (green toggle) and some disabled (gray toggle)]_

> **Hint:** Disabling a module hides it from the navigation but does not delete any data. Re-enabling a module restores access to all previously entered data.

---

## Role and Permission Management

**Required Permission:** `positions.manage_permissions`

Navigate to **Settings > Role Management** to manage positions and their permissions.

### Understanding Roles

The Logbook uses a **position-based** permission system:

- Each member can hold **multiple positions** (e.g., "Treasurer" + "Safety Officer")
- Each position grants a set of **permissions**
- The **IT Manager** position has full wildcard access
- The **Member** position is assigned to everyone by default

### Default Positions

| Position | Description |
|----------|-------------|
| **IT Manager** | System owner with all permissions |
| **President** | Department president |
| **Vice President** | Department vice president |
| **Secretary** | Meeting minutes, correspondence |
| **Treasurer** | Financial operations |
| **Chief** | Department chief |
| **Safety Officer** | Safety and compliance |
| **Training Officer** | Training management |
| **Member** | Basic member access (default for all) |

### Managing Permissions

1. Click on a position to view its permissions.
2. Toggle individual permissions on or off.
3. Save changes.

Permission categories include:
- `members.*` - Member management
- `training.*` - Training management
- `scheduling.*` - Scheduling management
- `events.*` - Event management
- `elections.*` - Election management
- `inventory.*` - Inventory management
- `apparatus.*` - Apparatus management
- `facilities.*` - Facilities management
- `documents.*` - Document management
- `forms.*` - Form management
- `reports.*` - Report access
- `settings.*` - System settings
- `analytics.*` - Analytics access

> **Screenshot placeholder:**
> _[Screenshot of the Role Management page showing a list of positions on the left, and when one is selected, a permissions grid on the right with checkboxes grouped by category]_

### Assigning Positions to Members

1. Navigate to a member's profile.
2. View the **Roles & Permissions** section.
3. Click **Edit Roles**.
4. Add or remove positions.
5. Save.

---

## Reports

Navigate to **Reports** in the Administration section to generate department reports.

### Available Report Types

| Report | Description |
|--------|-------------|
| **Member Roster** | Full member listing with contact info and status |
| **Training Summary** | Training hours and completions by member |
| **Event Attendance** | Attendance records across events |
| **Training Progress** | Member progress toward requirements |
| **Annual Training** | Year-end training compliance summary |

### Generating a Report

1. Select a **report category**: All, Member, Training, Event, Compliance, or **Pipeline** *(added 2026-03-15)*.
2. Choose a **date range** using presets (This Year, Last Year, Last 90 Days) or a custom range.
3. Click **Generate**.
4. View the report on screen.
5. Click **Export CSV** to download for spreadsheets or external analysis.

### Pipeline Overview Report (2026-03-15)

The **Pipeline Overview** report shows prospect counts per pipeline stage with configurable stage grouping. This report helps leadership see how many applicants are at each point in the membership process.

**Configuring Stage Groups:**

1. Navigate to **Prospective Members > Settings** (`/prospective-members/settings`)
2. Scroll to the **Report Stage Groups** section
3. Click **Add Group** to create a grouping (e.g., "Early Stages")
4. Select which pipeline stages belong to this group (e.g., Application + Interview)
5. Save

> **Screenshot needed:**
> _[Screenshot of the ReportStageGroupsEditor showing two configured groups: "Early Stages" containing "Application" and "Interview" stages, and "Final Steps" containing "Background Check" and "Vote" stages. Each group shows the stage count and has edit/delete buttons]_

Stage groups with zero prospects are still shown in the report for completeness. Ungrouped stages appear individually.

> **Screenshot placeholder:**
> _[Screenshot of the Reports page showing the category filter buttons at the top, date range presets and a custom date picker, a list of available reports, and a generated report preview with an Export CSV button]_

> **Hint:** Reports can be saved as bookmarks for quick access. Common reports like the annual training summary should be generated at the end of each year for compliance records.

---

## Analytics Dashboard

**Required Permission:** `analytics.view`

Navigate to **Settings > Analytics** to access the department analytics dashboard.

The dashboard provides:

- **Member Metrics** - Active/inactive counts, membership type distribution
- **Training Metrics** - Completion rates, hours logged, compliance percentages
- **Event Metrics** - Event counts, attendance rates, RSVP patterns
- **Activity Trends** - Charts showing activity over time

> **Screenshot placeholder:**
> _[Screenshot of the Analytics Dashboard showing metric cards at the top (total members, training compliance %, events this month), and charts below showing trends over time (line chart of monthly training hours, bar chart of event attendance)]_

---

## Public Portal Configuration

**Required Permission:** `settings.manage`

Navigate to **Settings > Public Portal** to configure your department's public-facing content.

The public portal allows external access to:
- Public event calendar
- Public forms (applications, feedback)
- Department information

### Configuration Options

- **Enable/Disable** the public portal
- **Custom domain** or subdomain
- **Branding** (logo, colors)
- **API keys** for external integrations
- **Access logging** for security

> **Screenshot placeholder:**
> _[Screenshot of the Public Portal configuration page showing the enable toggle, domain settings, branding options, and a list of public API keys with creation dates and last-used timestamps]_

---

## Error Monitoring

**Required Permission:** `settings.manage`

Navigate to **Settings > Error Monitor** to view system errors and issues.

This page shows:
- Recent error logs with timestamps
- Error severity levels (Info, Warning, Error, Critical)
- Error details and stack traces
- Trends and patterns

> **Screenshot placeholder:**
> _[Screenshot of the Error Monitor page showing a table of recent errors with columns for timestamp, severity (color-coded badges), message, and a count of occurrences]_

> **Hint:** Regular errors about failed login attempts are normal (they indicate the rate limiting is working). Focus on Critical and Error severity items for actual system issues.

> **Screenshot placeholder:**
> _[Screenshot of the Error Monitor page showing a table of recent errors with columns for timestamp, severity (color-coded badges), message, and a count of occurrences]_

---

## Scheduled Tasks

Navigate to **Administration > Scheduled Tasks** to view and manage automated tasks.

Scheduled tasks run automatically on a schedule:

| Task | Description |
|------|-------------|
| **Process Certification Alerts** | Send expiring certification notifications |
| **Advance Membership Tiers** | Auto-promote eligible members |
| **Process Property Return Reminders** | Send overdue return emails |
| **Detect Struggling Members** | Flag members behind on training |
| **Mark Overdue Checkouts** | Flag inventory checkouts past their expected return date |
| **Send Event Reminders** | Deliver scheduled event reminders to RSVP'd members |
| **Clean Up Sessions** | Remove expired login sessions |
| **Process Scheduled Emails** | Send pending pipeline automated emails (polls every 60 seconds) *(added 2026-03-13)* |
| **Generate Compliance Reports** | Auto-generate scheduled compliance reports *(added 2026-03-13)* |

For each task you can see:
- Last run time
- Next scheduled run
- Frequency
- Enabled/disabled status

> **Screenshot placeholder:**
> _[Screenshot of the Scheduled Tasks page showing a list of tasks with name, frequency, last run time, next run time, and enabled toggle switches]_

---

## Security and Compliance

### Session Management

The system enforces session timeouts in alignment with HIPAA session management requirements:
- Sessions expire after a configurable period of inactivity
- Members are automatically logged out when their session expires
- Active sessions can be reviewed from the admin panel

### Password Policies

- Minimum password length (configurable)
- Password history tracking (prevents reuse of recent passwords)
- Account lockout after failed attempts
- Mandatory password change on first login

### Audit Logging

All significant actions are logged for compliance:
- Member changes (creation, status changes, role assignments)
- Training record changes
- Document access
- Settings modifications
- Login/logout events

### Rate Limiting

The system applies rate limiting to sensitive endpoints:
- Login: 5 attempts per minute per IP
- Password reset: 5 requests per minute per IP
- Registration: 5 requests per minute per IP

> **Hint:** If a member reports being locked out, check if they exceeded the login attempt limit. The lockout period is configurable in the system settings.

### Security Hardening (2026-03-07)

The following security measures are enforced:

- **JWT algorithm restriction**: Only HS256 accepted — `none` and RS256 tokens are rejected
- **Session invalidation on password change**: All existing sessions for a user are invalidated when their password changes
- **File upload validation**: Magic byte validation ensures uploaded files match their declared MIME type (JPEG, PNG, GIF, WebP, PDF, CSV, DOCX, XLSX). Path traversal is blocked with `secure_filename()` and UUID prefixing
- **Jinja2 sandboxing**: Email and report templates use `SandboxedEnvironment` with auto-escaping to prevent template injection
- **CORS strict matching**: Origin validation uses exact match — no subdomain wildcards
- **Parameterized LIKE queries**: Search inputs are escaped to prevent LIKE injection (`%`, `_` characters)
- **Rate limiter thread safety**: Redis-backed rate limiting uses `asyncio.Lock` for concurrent access
- **Database/Redis TLS**: DB connections use SSL context when `DB_SSL=True`. Redis connections use `rediss://` scheme when `REDIS_SSL=True`
- **Health endpoint minimized**: `/health` returns only `status` + `ready` (no environment, version, or debug info)
- **Security headers**: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Permitted-Cross-Domain-Policies: none`

> **Screenshot needed:**
> _[Screenshot of the security status in the Error Monitor or a dedicated Security Dashboard showing the list of security features with green checkmarks (JWT restriction, file validation, CORS strict, TLS enabled) and any warnings in yellow]_

> **Edge case:** If your deployment uses a reverse proxy (nginx, Caddy), the `DB_SSL` and `REDIS_SSL` settings refer to the connection between the backend container and the database/Redis container — not the browser-to-server connection. Browser-to-server TLS is handled by the reverse proxy.

---

## Realistic Example: Generating the Annual Training Summary Report

This walkthrough demonstrates generating the year-end training compliance report that many departments submit to their governing body, insurance carrier, or state fire marshal's office.

### Background

**Chief Barbara Owens** of **Pinecrest Volunteer Fire Company** needs to generate the annual training report for the year 2025 to present at the January board meeting and submit to the county fire coordinator.

She needs: total training hours per member, compliance percentages against state-mandated minimums, certification statuses, and an exportable format for the county submission.

---

### Step 1: Generating the Report

Chief Owens navigates to **Administration > Reports**.

1. **Report Category:** Training
2. **Report Type:** Annual Training Summary
3. **Date Range Preset:** Last Year (January 1 – December 31, 2025)
4. Clicks **Generate**

The report loads on screen, showing a department summary and per-member breakdown.

---

### Step 2: Understanding the Report Output

**Department Summary (top of report):**

| Metric | Value |
|--------|-------|
| **Total Active Members** | 32 |
| **Total Training Hours Logged** | 1,847 |
| **Average Hours per Member** | 57.7 |
| **Members Meeting All Requirements** | 28 (87.5%) |
| **Members with Expiring Certifications** | 4 |
| **Members on Leave (excluded)** | 2 |

**Per-Member Detail Table:**

| Member | Rank | Hours | Req. Hours | Compliance | Certs Active | Certs Expiring | Notes |
|--------|------|-------|-----------|------------|-------------|----------------|-------|
| Adams, John | Captain | 78.5 | 36 | 100% | 5 | 0 | |
| Brooks, Sarah | Lieutenant | 64.0 | 36 | 100% | 4 | 1 | CPR expires Mar 2026 |
| Carter, David | Firefighter | 42.0 | 36 | 100% | 3 | 0 | |
| Diaz, Maria | Firefighter | 55.5 | 36 | 100% | 3 | 0 | |
| Evans, Tom | Probationary | 88.0 | 72 | 100% | 2 | 0 | Probationary (2x req.) |
| Foster, Amy | Firefighter | 28.0 | 36 | 78% | 3 | 1 | **Below minimum** |
| Garcia, Luis | Firefighter | 18.0 | 24 | 75% | 3 | 0 | LOA: 4 months (req. adjusted) |
| Harris, Ken | Firefighter | 31.0 | 36 | 86% | 2 | 1 | **Below minimum** |
| ... | ... | ... | ... | ... | ... | ... | |

**Key details in this table:**
- **Evans** (Probationary) has a higher requirement (72 hours) reflecting the department's probationary training standard
- **Garcia** was on a 4-month Leave of Absence, so his requirement was adjusted from 36 to 24 hours (36 x 8/12). He completed 18 of 24 hours — still below minimum.
- **Foster** and **Harris** are below the 36-hour minimum and flagged for follow-up
- **Brooks** has a CPR certification expiring in March — she should renew before it lapses

---

### Step 3: Exporting for the County

Chief Owens clicks **Export CSV**. The download contains:

```
CSV File: pinecrest_training_summary_2025.csv

member_name, rank, status, total_hours, required_hours, compliance_pct,
    certs_active, certs_expiring, leave_months, notes
"Adams, John", Captain, Active, 78.5, 36, 100, 5, 0, 0, ""
"Brooks, Sarah", Lieutenant, Active, 64.0, 36, 100, 4, 1, 0, "CPR expires Mar 2026"
"Carter, David", Firefighter, Active, 42.0, 36, 100, 3, 0, 0, ""
"Diaz, Maria", Firefighter, Active, 55.5, 36, 100, 3, 0, 0, ""
"Evans, Tom", Probationary, Active, 88.0, 72, 100, 2, 0, 0, "Probationary requirement"
"Foster, Amy", Firefighter, Active, 28.0, 36, 78, 3, 1, 0, "Below minimum"
"Garcia, Luis", Firefighter, Active, 18.0, 24, 75, 3, 0, 4, "LOA adjusted"
"Harris, Ken", Firefighter, Active, 31.0, 36, 86, 2, 1, 0, "Below minimum"
...
```

This CSV can be opened in Excel, attached to the county submission form, or imported into the county's reporting portal.

---

### Step 4: Following Up on Non-Compliant Members

Based on the report, Chief Owens takes action:

1. **Foster and Harris** — Sends a department message (via **Notifications > Messages**) reminding them of the minimum training requirement and asking them to schedule makeup training in Q1 2026.
2. **Garcia** — Reviews his LOA to confirm the adjusted requirement is correct. His 18/24 hours means he still has a gap — she notes this for his return-to-duty plan.
3. **Brooks** — Adds a note to follow up in February about CPR renewal.

> **Hint:** Generate this report quarterly (not just annually) to catch compliance gaps early. Members who are behind at the 6-month mark have time to catch up before year-end.

---

## Realistic Example: First-Time Department Setup

This walkthrough covers the initial setup of The Logbook for a department that just signed up — walking through the setup checklist from empty system to ready-to-use.

### Background

**IT Manager Steve Park** has been tasked with setting up The Logbook for **Valley Creek Fire Protection District**. The district has 45 members, 2 stations, 5 apparatus, and runs a combination career/volunteer model.

---

### Step 1: Department Profile

Steve logs in with the initial admin account and lands on the **Department Setup Checklist**. He starts with Step 1: Department Profile.

| Field | Value |
|-------|-------|
| **Department Name** | Valley Creek Fire Protection District |
| **Department Type** | Fire/EMS Combined |
| **FDID** | 29-4521 |
| **State ID** | MO-VCFPD |
| **Timezone** | America/Chicago |
| **Phone** | (555) 867-5309 |
| **Email** | admin@valleycreekfire.org |
| **Physical Address** | 100 Fire Station Road, Valley Creek, MO 63001 |

He uploads the department logo (PNG, 512x512). The checklist marks Step 1 as complete.

---

### Step 2: Configure Roles

Steve reviews the default positions and adjusts permissions:

- **Chief** — Adds `settings.manage` permission (Chief wants direct access to settings)
- **Training Officer** — Confirms `training.manage` is enabled
- **Quartermaster** — Creates a new custom position with `inventory.manage` and `apparatus.manage`
- **Secretary** — Confirms `events.manage` and `elections.manage` are enabled
- **Member** — Confirms base permissions (view events, view documents, submit training, view own profile)

He assigns himself the **IT Manager** position (full access).

---

### Step 3: Import Members

Rather than adding 45 members one by one, Steve uses CSV import:

1. Downloads the CSV template
2. Fills it in with member data from the district's existing spreadsheet:

```csv
first_name,last_name,email,username,phone,rank,station,membership_number,hire_date
John,Adams,jadams@email.com,jadams,(555)111-0001,Captain,Station 1,VCF-001,2008-06-15
Sarah,Brooks,sbrooks@email.com,sbrooks,(555)111-0002,Lieutenant,Station 1,VCF-002,2012-03-20
David,Carter,dcarter@email.com,dcarter,(555)111-0003,Firefighter,Station 1,VCF-003,2018-09-01
...
```

3. Uploads the CSV
4. Reviews the preview — 44 rows pass validation, 1 row has an invalid email (corrects it)
5. Confirms the import
6. Checks **Send Welcome Email** — all 45 members receive login credentials

---

### Step 4: Enable Modules

Steve navigates to **Settings > Organization > Modules** and enables the modules the district needs:

| Module | Action |
|--------|--------|
| Training & Certification | **Enable** (state requires training tracking) |
| Facilities Management | **Enable** (2 stations to manage) |
| Prospective Members Pipeline | **Enable** (active recruitment program) |
| Incidents & Reports | Leave disabled (using separate CAD/RMS system) |
| HR & Payroll | Leave disabled (handled by county HR) |
| Grants & Fundraising | Leave disabled (for now) |

The newly enabled modules appear in the sidebar immediately.

---

### Step 5: Add Stations and Apparatus

**Stations:**
Steve navigates to **Facilities** and adds both stations:

| Station | Address | Bays | Type |
|---------|---------|------|------|
| Station 1 (HQ) | 100 Fire Station Road | 4 | Fire Station |
| Station 2 | 2850 Valley Pike | 2 | Fire Station |

**Apparatus:**
He navigates to **Apparatus** and adds the fleet:

| Unit | Type | Year | Make/Model | Station |
|------|------|------|-----------|---------|
| Engine 1 | Engine | 2020 | Pierce Enforcer | Station 1 |
| Engine 2 | Engine | 2015 | Pierce Saber | Station 2 |
| Ladder 1 | Ladder | 2018 | Pierce Ascendant | Station 1 |
| Rescue 1 | Rescue | 2021 | Horton 623 | Station 1 |
| Chief 1 | Command | 2023 | Ford Explorer | Station 1 |

---

### Step 6: Set Up Training Requirements

Steve works with the Training Officer to configure the state-mandated training requirements:

| Requirement | Type | Frequency | Required Value | Due Date Type |
|-------------|------|-----------|---------------|---------------|
| Annual Training Minimum | Hours | Annual | 36 hours | Calendar Period |
| Probationary Training | Hours | Annual | 72 hours | Calendar Period |
| SCBA Fit Test | Certification | Annual | 1 | Fixed Date |
| CPR/AED Certification | Certification | Biannual | 1 | Certification Period |
| Hazmat Awareness Refresher | Course Completion | Annual | 1 | Calendar Period |

---

### Step 7: Verify and Go Live

Steve walks through the remaining checklist items:
- **Notification Setup** — Enables email notifications for event reminders, training expiry, and new member alerts
- **Scheduling Settings** — Configures shift templates for the 24/48 rotation
- **Document Folders** — Verifies the default folder structure and adds "Mutual Aid Agreements" and "Budget" folders

The setup checklist shows all steps complete. The system is ready for use.

**Total time from first login to operational:** Steve completed the setup in a single afternoon, with the CSV import handling the bulk of the member data entry.

> **Hint:** The Department Setup Checklist remains accessible after initial setup. Return to it any time to verify configuration or adjust settings as the department's needs change.

---

## Medical Screening Module (2026-03-13)

**Required Permission:** `medical_screening.view` (view) / `medical_screening.manage` (manage)

The Medical Screening module tracks health screenings, physicals, drug tests, and fitness assessments for members and prospective members. Enable it in **Settings > Organization > Modules**.

### Screening Types

| Type | Description |
|------|-------------|
| Physical Exam | Annual or periodic physical examination |
| Medical Clearance | Clearance for return to duty or specific activities |
| Drug Screening | Random or scheduled substance screening |
| Vision/Hearing | Vision and hearing tests |
| Fitness Assessment | Physical fitness evaluation |
| Psychological | Psychological evaluation or fitness-for-duty assessment |

### Setting Up Requirements

1. Navigate to **Medical Screening** in the sidebar
2. Click the **Requirements** tab
3. Click **Add Requirement**
4. Configure:
   - **Name** — descriptive name (e.g., "Annual Physical Exam")
   - **Type** — select from the screening types above
   - **Frequency** — how often the screening is required (in months). Leave empty for one-time screenings
   - **Applies to Roles** — which roles this requirement applies to (e.g., all firefighters, officers only)
   - **Grace Period** — days after expiration before marking non-compliant (default: 30)
5. Click **Save**

> **Screenshot needed:**
> _[Screenshot of the Medical Screening page showing the Requirements tab with a list of configured requirements (Annual Physical, Drug Screening, Fitness Test) with columns for type, frequency, applicable roles, and active toggle]_

### Recording Screenings

1. Click the **Records** tab
2. Click **Add Record**
3. Select the **member** (or prospect) and the **requirement**
4. Enter the scheduled date, provider name, and any notes
5. After the screening is completed, update the record with:
   - **Status**: Passed, Failed, Pending Review, or Waived
   - **Completed date** and **expiration date**
   - **Result summary** and detailed result data

> **Screenshot needed:**
> _[Screenshot of the ScreeningRecordForm showing fields for member selection, requirement dropdown, scheduled date, provider name, status dropdown, and result summary text area]_

### Compliance Dashboard

The compliance dashboard shows:
- Overall compliance rate by screening type
- Members with expiring screenings (configurable: 30/60/90 days)
- Overdue screenings requiring immediate attention
- Drill-down to individual member compliance details

> **Screenshot needed:**
> _[Screenshot of the ComplianceDashboard showing compliance rate cards for each screening type, a list of expiring screenings with member names and dates, and an overdue screenings alert section]_

### Edge Cases

| Scenario | What Happens |
|----------|-------------|
| One-time screening (no frequency) | Does not recur; no automatic expiration tracking |
| Prospect converted to member | Screening records are preserved and can be re-linked to the new user account |
| Requirement deactivated | Existing records preserved; requirement excluded from future compliance checks |
| Grace period exceeded | Member marked non-compliant in compliance dashboard and reports |

---

## Compliance Requirements Configuration (2026-03-13)

**Required Permission:** `settings.manage`

Navigate to the compliance officer dashboard and click **Configure Requirements** to access the compliance configuration page.

### Configuring Thresholds

1. Choose a **threshold type**:
   - **Percentage** — Members are compliant if they meet X% of requirements
   - **All Required** — Members must meet 100% of requirements to be compliant
2. Set the **compliant threshold** (default: 100%) and **at-risk threshold** (default: 75%)
3. Set the **grace period** (days after deadline before marking non-compliant)
4. Click **Save**

### Creating Compliance Profiles

Profiles allow different compliance standards for different groups:

1. Click **Add Profile**
2. Set:
   - **Name** — e.g., "Line Officers", "Probationary Members"
   - **Membership types** — which membership types this profile applies to
   - **Roles** — which roles this profile targets
   - **Required requirements** — training requirements that must be met
   - **Optional requirements** — tracked but not required for compliance
   - **Threshold overrides** — optionally set different thresholds for this group
3. Set **priority** — when a member matches multiple profiles, the highest-priority profile applies

> **Screenshot needed:**
> _[Screenshot of the ComplianceRequirementsConfigPage showing the threshold configuration section at the top, a list of compliance profiles with name, targeted groups, and threshold values, and an "Add Profile" button]_

### Automated Reporting

1. Set the **report frequency**: Monthly, Quarterly, or Yearly
2. Configure **email recipients** — who receives the reports
3. Set the **day of month** for report generation
4. Optionally enable **non-compliant member notifications** with configurable lead times (e.g., notify 30, 14, and 7 days before deadline)

### Generating Reports On-Demand

1. Click **Generate Report** from the compliance config page
2. Select the report type (monthly or yearly)
3. Optionally check **Send via email**
4. The report shows overall compliance rates, per-member status, and trends

> **Screenshot needed:**
> _[Screenshot of the report generation dialog showing report type selector, send via email checkbox, additional recipients field, and a preview of a generated compliance report with member status table]_

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot access admin settings | Verify you have the `settings.manage` permission. Only IT Manager and certain officer positions have this by default. |
| Module toggle not saving | Refresh the page and try again. Check for any error messages in the notification area. |
| Report showing no data | Verify the date range includes the period you are interested in. Some reports require specific data to exist (e.g., training records, event attendance). |
| Cannot assign a position to a member | Verify you have `positions.manage_permissions` permission. The IT Manager position can always assign roles. |
| Scheduled task not running | Check that the task is enabled. If the system was recently restarted, tasks may take one cycle to resume. |
| Public portal not accessible | Verify the public portal is enabled and the domain/URL is configured correctly. Check that API keys are active. |
| Error monitor showing many errors | Some errors are expected (failed login attempts, rate limiting). Focus on Critical and Error severity items. |
| Email templates page not visible | Navigate to **Administration > Email Templates**. Requires `settings.manage` permission. |
| "Data truncated" error on email template | Run `alembic upgrade head` to sync the MySQL ENUM with the new template types. |
| Email template preview shows placeholder data | As of 2026-03-02, template preview loads live organization data. Clear browser cache to get the updated preview. |
| Cannot send test email to specific member | Use the member dropdown in the preview panel to select a recipient for test emails. |
| Email scheduling not available | Email scheduling was added 2026-03-02. Ensure you are on the latest version. |
| Standard modules missing after fresh install | Standard modules now default to enabled. If missing, check **Settings > Modules** and enable them. The Settings UI has been redesigned with module cards. |
| OrganizationSettings page crashes | Update to the latest version. A crash in the `redacted()` method and an auth secret leak have been fixed. |
| Physical Address not visible in Organization Settings | As of 2026-03-04, Organization Settings > General includes a Physical Address section with a "Same as mailing address" toggle. Physical address data entered during onboarding is now displayed here. |
| Admin hours summary categories showing "undefined" | Fixed in March 2026 — type mismatch between snake_case frontend types and camelCase API response. Pull latest and rebuild. |
| Email templates return 500 error | Fixed in March 2026 — missing `duplicate_application` enum value in database. Run `alembic upgrade head` and restart. |
| Email templates missing CC/BCC fields | As of 2026-03-04, each template supports default CC/BCC. BCC also available for scheduled emails. Run latest migration. |
| Onboarding redirects to /login after Step 7 | Fixed in March 2026 — system owner creation now sets httpOnly auth cookies. Pull latest backend code and restart. |
| Events Settings page layout changed | As of 2026-03-04, the Events Settings page uses a sidebar + content panel layout matching Organization Settings, replacing the previous collapsible sections. |
| Reports page only shows basic views | As of 2026-03-04, the Reports module has been expanded into a dedicated feature module with 12 report types. Pull latest to access the full reports experience. |
| Medical Screening module not visible | Enable `MODULE_MEDICAL_SCREENING_ENABLED` in **Settings > Modules** or via environment variable. *(added 2026-03-13)* |
| Compliance shows 0% with requirements defined | Verify screening records exist for the member and that the requirement is active. Check that the member's role matches the requirement's `applies_to_roles` configuration. |
| Compliance report generation fails | Check the error message in the report list. Common causes: no compliance config defined (use **Initialize** first), or SMTP not configured for email delivery. |
| Scheduled emails not sending | Verify SMTP is configured in Settings > Email. Check that the background email scheduler is running (polls every 60 seconds). For Gmail, use STARTTLS on port 587 with an app password. *(fixed 2026-03-13)* |
| Compliance config "already exists" error | Use the update endpoint (PUT) instead of initialize (POST) after first-time setup. The initialization endpoint is for first-time configuration only. |
| Date/time displays show UTC instead of local time | Fixed 2026-03-14 — a SQLAlchemy `load` event listener now stamps all naive datetimes with UTC tzinfo. ESLint rules enforce use of `dateFormatting.ts` utilities. Pull latest and restart. |
| Pipeline overview report missing | Added 2026-03-15 — new `PipelineOverviewRenderer` in Reports module. Configure stage grouping in Pipeline Settings > Report Stage Groups. |
| Pipeline report stage groups | Configure in Pipeline Settings. Groups combine multiple stages into labeled groups (e.g., "Early Stages" = Application + Interview) for the pipeline overview report. |
| Modal cannot be closed by clicking backdrop | Fixed 2026-03-14 — all modals across the app now have correct backdrop click-to-dismiss and z-index stacking. Pull latest frontend code. |
| Dark mode backgrounds bleeding through | Fixed 2026-03-18 — overlays, dropdowns, drawer panels, and sticky elements now use opaque backgrounds in dark mode. Pull latest frontend. |
| High-contrast mode missing styles | Fixed 2026-03-18 — high-contrast variants added across 25+ files. Pull latest frontend. |
| API datetime fields missing timezone | Fixed 2026-03-16 — all API response schemas now inherit from `UTCResponseBase` which stamps naive datetimes with `+00:00`. Pull latest backend. |
| Equipment check reports not showing | Navigate to `/scheduling/equipment-check-reports`. Requires `equipment_check.manage` permission. At least one check must be submitted. *(added 2026-03-19)* |
| Operational ranks eligible positions not saving | Ensure you are on the latest migration. The `eligible_positions` JSON column was added 2026-03-19. Run `alembic upgrade head`. |
| Scheduling admin pages return 404 | Admin tabs were extracted into dedicated routes (`/scheduling/templates`, `/scheduling/patterns`, etc.) in 2026-03-19. Pull latest frontend. |

---

## Dark Mode & Accessibility (2026-03-18)

Dark mode and high-contrast mode have been hardened across the application:

- **Opaque backgrounds**: All overlays, dropdowns, drawer panels, and sticky elements now use opaque backgrounds instead of transparent/semi-transparent that caused content bleed-through in dark mode
- **Comprehensive dark variants**: Added `dark:` Tailwind variants across 25+ files for icon badges, stat cards, settings UI, form inputs, and table rows
- **High-contrast support**: Additional high-contrast CSS variants for accessibility compliance

> **Screenshot needed:**
> _[Screenshot comparing the same page in light mode and dark mode side-by-side, showing a dropdown or overlay with the opaque background correctly rendering in dark mode without content bleeding through]_

## UTC Timezone Consistency (2026-03-16)

All API response schemas now inherit from `UTCResponseBase`, which automatically stamps naive `datetime` fields with UTC timezone info (`+00:00` suffix). This ensures JavaScript correctly interprets times as UTC and applies local timezone conversion.

**What changed:**
- Previously, some API datetime fields were returned without timezone info, causing JavaScript's `new Date()` to treat them as local time
- Now, all datetime fields include `+00:00` (equivalent to `Z`), so UTC-to-local conversion works correctly
- Combined with the existing SQLAlchemy `load` event listener (which stamps datetimes at ORM level), timezone consistency is enforced at both the database and API layers

> **Edge case:** Response schemas with `Optional[datetime]` skip stamping when the value is `None`. The validator runs as `model_validator(mode="before")` so it processes raw dict data before Pydantic validation.

---

## Notification Enhancements (2026-03-22)

### Dashboard Notification Management

Dashboard notification cards now include **clear** and **dismiss** buttons directly on each card:

- **Dismiss**: Hides the notification from the user's dashboard (personal action)
- **Clear**: Marks the notification as read

> **Screenshot needed:**
> _[Screenshot of the Dashboard notifications area showing notification cards with dismiss (X) and clear (checkmark) buttons visible on each card]_

### Persistent Department Messages

Administrators can create department-wide persistent messages:

1. Navigate to **Notifications** (admin view)
2. Click **Create Department Message**
3. Enter the message content and mark as **Persistent**
4. All department members see the message until an admin clears it

> **Screenshot needed:**
> _[Screenshot of a persistent department message banner on the Dashboard with the admin-only "Clear for All" button visible]_

> **Edge case:** Non-admin users cannot dismiss persistent messages. The dismiss button is hidden for regular members; only admins see the "Clear for All" action.

### Notification Channel Filter

The Notifications page now includes a **channel filter** to view notifications by delivery method:

| Filter | Shows |
|--------|-------|
| All | All notifications regardless of delivery channel |
| Email | Only email-delivered notifications |
| In-App | Only in-app notifications (bell icon) |
| SMS | Only SMS-delivered notifications (when Twilio enabled) |

> **Screenshot needed:**
> _[Screenshot of the Notifications page showing channel filter tabs (All, Email, In-App, SMS) at the top with the In-App filter active]_

## Email Deliverability (2026-03-22)

Email delivery has been improved for compatibility with Gmail, Microsoft, and other major providers:

- **Message-ID header**: Satisfies DKIM/SPF authentication requirements
- **Batch rate limiting**: Prevents bulk-send throttle triggers
- **Inline CSS**: Gmail strips `<style>` tags; styles are now inlined on elements
- **SMTP connection reuse**: Better performance for large recipient batches
- **Logo hosting**: Hosted URLs instead of base64 data URIs prevent Gmail message clipping

For DNS and SMTP configuration, see the [Email Deliverability Guide](../EMAIL_DELIVERABILITY.md).

## Equipment Check Template Builder UX (2026-03-22)

The equipment check template builder received UX improvements:

- **Redesigned layout**: Better visual hierarchy and workflow organization
- **Preview mode**: See how the check form will appear to members before saving
- **Save redirect**: Correctly redirects to template list after saving
- **Input stability**: Fixed inputs losing focus after each keystroke

> **Screenshot needed:**
> _[Screenshot of the equipment check template builder showing the redesigned layout with a preview panel on the right showing how the check form will appear to members on mobile]_

## Time Picker Redesign (2026-03-22)

The `TimeQuarterHour` component has been redesigned with three separate dropdown selects:

| Dropdown | Options |
|----------|---------|
| **Hour** | 1 through 12 |
| **Minute** | 00, 15, 30, 45 |
| **AM/PM** | AM, PM |

This replaces the previous single text input that was harder to use on mobile and didn't enforce quarter-hour increments visually.

> **Screenshot needed:**
> _[Screenshot of the redesigned TimeQuarterHour component showing three separate dropdown selectors (Hour: "2", Minute: "30", AM/PM: "PM") in a compact horizontal layout]_

---

**Previous:** [Documents & Forms](./07-documents-forms.md) | **Next:** [Skills Testing & Psychomotor Evaluations](./09-skills-testing.md)
