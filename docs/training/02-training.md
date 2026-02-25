# Training & Certification

The Training module tracks courses, certifications, training requirements, program enrollments, external training integrations, and compliance reporting. It is designed for both members submitting their training records and officers managing department-wide training requirements.

---

## Table of Contents

1. [My Training Dashboard](#my-training-dashboard)
2. [Submitting Training Records](#submitting-training-records)
3. [Course Library](#course-library)
4. [Training Programs](#training-programs)
5. [Training Requirements](#training-requirements)
6. [Officer Dashboard](#officer-dashboard)
7. [Reviewing Submissions](#reviewing-submissions)
8. [Compliance Matrix](#compliance-matrix)
9. [Expiring Certifications](#expiring-certifications)
10. [Shift Completion Reports](#shift-completion-reports)
11. [External Training Integrations](#external-training-integrations)
12. [Historical Import](#historical-import)
13. [Troubleshooting](#troubleshooting)

---

## My Training Dashboard

Navigate to **Training > My Training** to view your personal training dashboard.

This page shows:

- **Summary Stats** - Total hours, courses completed, active enrollments, certifications
- **Active Program Enrollments** - Programs you are enrolled in with progress bars
- **Requirement Progress** - Your progress toward department training requirements
- **Recent Training Records** - Your latest completed training entries

> **Screenshot placeholder:**
> _[Screenshot of the My Training page showing stat cards at the top (total hours, courses completed, etc.), an active enrollment card with a progress bar, and a list of recent training records below]_

> **Hint:** The visibility of sections on this page is controlled by your department's Training Module Configuration. Your officers may choose to show or hide certain sections for regular members.

---

## Submitting Training Records

Navigate to **Training > Submit Training** to log a completed training activity.

1. Select the **course** from the dropdown (or type to search).
2. Enter the **date completed**.
3. Enter the **hours** spent.
4. Optionally add **notes** or upload a **certificate file**.
5. Click **Submit**.

> **Screenshot placeholder:**
> _[Screenshot of the Submit Training form showing the course dropdown with search functionality, date picker, hours input field, notes textarea, file upload area, and the Submit button]_

**After Submission:**
- Your record enters a **Pending Review** state.
- An officer with `training.manage` permission will review and approve or reject it.
- You will receive a notification when the decision is made.
- Approved records are added to your training history and count toward requirements.

> **Hint:** If you are submitting for a certification, make sure to upload the certificate document. This helps officers verify and approve your record faster.

---

## Course Library

Navigate to **Training > Course Library** to browse available training courses.

The library shows all courses created by your department, organized by category. Each course listing includes:

- Course name and description
- Category
- Required hours
- Whether it is a certification course

> **Screenshot placeholder:**
> _[Screenshot of the Course Library page showing course cards organized by category, with each card displaying the course name, category badge, hours, and a brief description]_

**Officers** can create new courses from the **Training Admin > Officer Dashboard** or directly from the course management area.

---

## Training Programs

Navigate to **Training > Programs** to view available training programs.

Training programs are structured multi-phase curricula (e.g., "Probationary Firefighter Program", "Officer Development"). Each program includes:

- **Phases** - Ordered stages of the program
- **Requirements** - Training requirements linked to each phase
- **Milestones** - Key checkpoints in the program

### Viewing Your Enrollment

If you are enrolled in a program, click on it to see:

- Your overall progress percentage
- Phase-by-phase progress
- Individual requirement completion status
- Skill evaluations and check-offs
- Time tracking (hours logged vs. required)

> **Screenshot placeholder:**
> _[Screenshot of a training program detail page showing the program name and description at the top, a progress bar, phases listed as an accordion with requirements inside each phase showing completion status (checkmarks, progress indicators)]_

> **Hint:** Some requirements auto-progress based on shift completion reports. If you work a qualifying shift, your hours or shift count may be automatically credited toward program requirements.

---

## Training Requirements

**Required Permission:** `training.manage`

Navigate to **Training Admin > Requirements** to manage department-wide training requirements.

### Requirement Types

| Type | Description |
|------|-------------|
| **Hours** | Accumulate a number of training hours |
| **Shifts** | Complete a number of qualifying shifts |
| **Calls** | Respond to a number of qualifying calls |
| **Certification** | Obtain or maintain a specific certification |
| **Course Completion** | Complete a specific course |

### Frequency and Due Dates

| Frequency | Description |
|-----------|-------------|
| **Annual** | Resets each year |
| **Biannual** | Resets every two years |
| **Quarterly** | Resets every quarter |
| **Monthly** | Resets each month |
| **One-Time** | Must be completed once |

| Due Date Type | Description |
|---------------|-------------|
| **Calendar Period** | Based on the calendar year/quarter/month |
| **Rolling** | Sliding window of N months from today |
| **Certification Period** | Based on certification expiry dates |
| **Fixed Date** | Specific due date |

> **Screenshot placeholder:**
> _[Screenshot of the Requirements management page showing a table of requirements with columns for name, type, frequency, required value, due date type, and status (active/inactive)]_

### Rolling Period Requirements and Leave of Absence

When a requirement uses **Rolling** due date type with a rolling period (e.g., 12 months), the system calculates compliance over that sliding window. If a member has an active **Leave of Absence** during part of that window, the months on leave are excluded and the requirement is pro-rated.

**Example:** A requirement of 12 hours over 12 rolling months, for a member with 3 months of leave, becomes 9 hours required (12 x 9/12).

See [Membership > Leave of Absence](./01-membership.md#leave-of-absence) for details on managing leaves.

---

## Officer Dashboard

**Required Permission:** `training.manage`

Navigate to **Training Admin > Officer Dashboard** for a department-wide overview including:

- Training completion rates
- Members behind schedule
- Upcoming deadlines
- Recent submissions awaiting review

> **Screenshot placeholder:**
> _[Screenshot of the Training Officer Dashboard showing summary cards (completion rate, pending reviews, upcoming expirations), a chart of monthly training hours, and a list of members needing attention]_

---

## Reviewing Submissions

**Required Permission:** `training.manage`

Navigate to **Training Admin > Review Submissions** to see training records pending officer review.

1. Click on a submission to expand its details.
2. Review the training information, hours, and any uploaded certificates.
3. Click **Approve** to accept or **Reject** to deny.
4. If rejecting, provide a reason so the member understands what needs to be corrected.

> **Screenshot placeholder:**
> _[Screenshot of the Review Submissions page showing a list of pending submissions with member name, course, date, and hours. Show one expanded submission with the approve/reject buttons and the attached certificate preview]_

> **Hint:** Training sessions created from Events may go through a separate approval workflow where the session is finalized after the event and an approval token is emailed to the designated approver.

---

## Compliance Matrix

**Required Permission:** `training.manage`

Navigate to **Training Admin > Compliance Matrix** to see a grid view of all members vs. all active requirements.

The matrix displays:
- **Green** cells for compliant members
- **Yellow** cells for members in progress
- **Red** cells for non-compliant members
- Percentage completion in each cell

> **Screenshot placeholder:**
> _[Screenshot of the Compliance Matrix showing a grid with member names on rows, requirement names on columns, and colored cells indicating compliance status. Include a legend showing what each color means]_

> **Hint:** Use this view for annual reporting and to identify which members need attention before compliance deadlines.

### Leave of Absence Adjustments

When a member has an active **Leave of Absence** (created via **Administration > Member Lifecycle**), the Compliance Matrix, Competency Matrix, Training Reports, and all other compliance views automatically adjust proportional requirements (hours, shifts, calls) so the member is not penalized for time they were inactive.

The adjustment formula is:

```
adjusted_required = base_required × (active_months / total_months)
```

For example, if a member takes a 3-month leave during a 12-month annual requirement of 24 hours, the adjusted requirement becomes `24 × (9/12) = 18 hours`.

A calendar month is only waived if the leave covers **15 or more days** of that month. Courses and certifications are not adjusted (they are binary completions).

Members see a blue info banner on their My Training page showing the adjustment. Officers see the adjusted values reflected in the compliance and competency matrices, training reports, and requirement progress views.

> For the full guide on creating and managing Leaves of Absence, see the [Training Waivers & Leaves of Absence](../../backend/app/docs/TRAINING_WAIVERS.md) documentation.

---

## Expiring Certifications

**Required Permission:** `training.manage`

Navigate to **Training Admin > Expiring Certs** to see certifications expiring within a configurable window (default 90 days).

The list shows:
- Member name
- Certification name
- Expiration date
- Days until expiry

You can trigger notification emails to members with expiring certifications by clicking **Process Alerts**.

> **Screenshot placeholder:**
> _[Screenshot of the Expiring Certifications page showing a table of upcoming expirations sorted by date, with color coding (yellow for 30-90 days, red for under 30 days) and a "Process Alerts" button]_

### Automated Certification Alerts

The system automatically sends tiered notifications as certifications approach expiration:

| Days Before Expiration | Recipients | Channels |
|------------------------|-----------|----------|
| 90 days | Member only | In-app + email |
| 60 days | Member only | In-app + email |
| 30 days | Member + training officer | In-app + email (CC) |
| 7 days | Member + training + compliance officers | In-app + email (CC) |
| Expired | Member + all escalation officers | In-app + email (CC) |

Each tier is sent only once per certification. Expired certifications trigger escalation to training, compliance, and chief officers with both primary and personal email addresses.

---

## Waiver Management

**Required Permission:** `members.manage`

Navigate to **Members > Admin > Waivers** to manage all waivers across the department.

This unified page covers:
- **Training waivers** — adjust training requirements for members on leave
- **Meeting waivers** — exclude meetings during leave periods from attendance calculations
- **Shift waivers** — exclude members from scheduling during leave

### Creating a Waiver

1. Click the **Create Waiver** tab.
2. Select the member and leave type. Available leave types include standard types plus **New Member** for long-service members exempt from certain requirements.
3. Set the date range, or check **Permanent (no end date)** for waivers that should never expire. Permanent waivers display a purple "Permanent" badge in status columns.
4. Choose the **Applies To** scope (multi-select checkboxes — pick any combination):
   - **Training** — Adjusts training requirements for the member
   - **Meetings** — Excludes meetings during leave periods from attendance calculations
   - **Shifts** — Excludes members from scheduling during leave
   - Selecting **Training + Meetings/Shifts** creates both a Leave of Absence and an auto-linked training waiver.
   - Selecting **Training only** creates a standalone training waiver without affecting meetings or scheduling.
   - Selecting **Meetings and/or Shifts only** creates a Leave of Absence with `exempt_from_training_waiver` enabled.
5. Click **Create Waiver**.

### Training Waivers Tab (Officer View)

Training officers also have a dedicated **Training Waivers** tab within the **Training Admin > Dashboard**. This view shows:
- Summary cards (Active / Future / Expired / Total counts)
- Filterable table with status badges (Active, Future, Expired, Deactivated)
- Source tracking: **Auto (LOA)** for waivers auto-created from leaves, **Manual** for standalone waivers
- Links to the full Waiver Management page

---

## Compliance Summary

Each member's profile page displays a **compliance summary card** showing their current training status at a glance:

| Indicator | Meaning |
|-----------|---------|
| **Green (Compliant)** | All requirements met, no certification issues |
| **Yellow (At Risk)** | Some requirements incomplete or certifications expiring within 90 days |
| **Red (Non-Compliant)** | Expired certifications or fewer than 50% of requirements met |

The card also shows:
- Requirements met / total
- Training hours completed this year
- Active certifications count
- Certifications expiring soon

> For the full technical details of how compliance is calculated, see [Training Compliance Calculations](../../docs/training-compliance-calculations.md).

---

## Shift Completion Reports

**Required Permission:** `training.manage`

Navigate to **Training Admin > Shift Reports** to view and manage shift officer reports.

Shift completion reports are filed by shift officers after each shift. They record:
- Trainee name
- Hours on shift
- Calls responded
- Call types
- Officer observations

These reports **automatically update training program progress** for enrolled members. When a report is filed, the system credits hours, shift count, and call count toward matching requirements.

> **Screenshot placeholder:**
> _[Screenshot of the Shift Reports tab showing a list of filed reports with columns for date, officer, trainee, hours, calls, and a status indicator showing which requirements were auto-progressed]_

---

## External Training Integrations

**Required Permission:** `training.manage`

Navigate to **Training Admin > Integrations** to connect external training providers.

Supported integrations:
- External training provider configuration
- Category mapping (map external categories to internal ones)
- User mapping (link external user accounts to Logbook members)
- Sync logs and import history

> **Screenshot placeholder:**
> _[Screenshot of the External Training Integrations page showing a connected provider with sync status, last sync date, and a list of recent imports]_

---

## Historical Import

**Required Permission:** `training.manage`

Navigate to **Training Admin > Import History** to import historical training records from a CSV file.

1. Upload your CSV file with historical training data.
2. The system **parses and previews** the data.
3. Review the preview for any validation errors.
4. Confirm the import.

> **Screenshot placeholder:**
> _[Screenshot of the historical import page showing the file upload area, a parsed data preview table, and a confirmation button]_

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "My training submission was rejected" | Check the rejection reason in your notification. Correct the issue and resubmit. |
| Hours not counting toward a requirement | Verify the training record's course is linked to the correct requirement. The record must be in "Approved" status. |
| Program progress not updating after a shift | Shift completion reports must be filed by the shift officer. Auto-progression only works for enrolled members with matching requirement types. |
| Compliance matrix shows incorrect data | Check the requirement's frequency and due date type settings. Rolling periods use today's date as the reference point. |
| Member on leave still shows as non-compliant | Verify the Leave of Absence is active in Member Lifecycle. The leave must cover ≥15 days of a month for that month to be waived. Only hours, shifts, and calls requirements are adjusted. |
| LOA created but training not adjusted | Check that `exempt_from_training_waiver` is not set on the leave. The auto-linked training waiver should appear in the Training Waivers tab. If missing, create a standalone training waiver from the Waiver Management page. |
| Duplicate training record warning | The system detects records with the same member + course name (case-insensitive) + completion date within ±1 day. Review the warning and either proceed or skip the duplicate. |
| Compliance card shows wrong color | Red = expired certs or <50% requirements met; Yellow = expiring certs or <100% requirements met; Green = all met. Check individual requirement progress for details. |
| Certification alert not received | Alerts are sent once per tier (90/60/30/7 days). Check the record's `alert_*_sent_at` fields. If all tiers are already sent, no further alerts will be triggered. |
| Rank shows as unrecognized | Navigate to Members Admin to see rank validation results. Update the member's rank to match one of the configured operational ranks in Settings. |
| Cannot see the Training module | Training is an optional module. Your department administrator must enable it in Settings > Modules. |
| External integration not syncing | Check the integration configuration and sync logs. Ensure user mappings are correctly set up. |

---

## Skills Testing

The Training module includes a **Skills Testing** sub-module for conducting structured psychomotor evaluations — the digital equivalent of NREMT skill sheets.

With Skills Testing, examiners can:
- Select a published skill sheet template (e.g., "Patient Assessment — Trauma")
- Score each step as the candidate performs the procedure
- Track critical (required) criteria that trigger automatic failure
- Automatically calculate pass/fail results based on scoring thresholds

For a comprehensive guide with a realistic NREMT example walkthrough, see the dedicated **[Skills Testing & Psychomotor Evaluations](./09-skills-testing.md)** training guide.

> **Screenshot placeholder:**
> _[Screenshot of the Skills Testing section within Training Admin, showing the template list with published templates and a "New Test" button]_

---

**Previous:** [Membership Management](./01-membership.md) | **Next:** [Shifts & Scheduling](./03-scheduling.md)
