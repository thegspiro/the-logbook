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

1. Select a **report category**: All, Member, Training, Event, or Compliance.
2. Choose a **date range** using presets (This Year, Last Year, Last 90 Days) or a custom range.
3. Click **Generate**.
4. View the report on screen.
5. Click **Export CSV** to download for spreadsheets or external analysis.

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

The system enforces session timeouts for HIPAA compliance:
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

---

**Previous:** [Documents & Forms](./07-documents-forms.md) | **Next:** [Skills Testing & Psychomotor Evaluations](./09-skills-testing.md)
