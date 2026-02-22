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
11. [Troubleshooting](#troubleshooting)

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

**Previous:** [Documents & Forms](./07-documents-forms.md)
