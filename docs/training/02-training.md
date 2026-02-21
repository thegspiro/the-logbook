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
| Cannot see the Training module | Training is an optional module. Your department administrator must enable it in Settings > Modules. |
| External integration not syncing | Check the integration configuration and sync logs. Ensure user mappings are correctly set up. |

---

**Previous:** [Membership Management](./01-membership.md) | **Next:** [Shifts & Scheduling](./03-scheduling.md)
