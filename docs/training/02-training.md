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
10. [Waiver Management](#waiver-management)
11. [Compliance Summary](#compliance-summary)
12. [Shift Completion Reports](#shift-completion-reports)
13. [External Training Integrations](#external-training-integrations)
14. [Historical Import](#historical-import)
15. [Competency Matrix](#competency-matrix)
16. [Recertification Tracking](#recertification-tracking)
17. [Instructor Management](#instructor-management)
18. [Training Effectiveness Scoring](#training-effectiveness-scoring)
19. [Multi-Agency Training](#multi-agency-training)
20. [xAPI (Tin Can) Integration](#xapi-tin-can-integration)
21. [Compliance Officer Dashboard](#compliance-officer-dashboard)
22. [Training Record Attachments](#training-record-attachments)
23. [Troubleshooting](#troubleshooting)
24. [Skills Testing](#skills-testing)

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

**Required Permission:** `training.manage` (officers) / authenticated (trainees, own reports only)

Navigate to **Training Admin > Shift Reports** or the **Shift Reports** tab in the Scheduling page to view and manage shift officer reports.

Shift completion reports are filed by shift officers after each shift. They record:
- **Trainee name** and linked shift
- **Hours on shift** — auto-populated from shift attendance records
- **Calls responded** — auto-populated from ShiftCall records where the trainee was a responding member
- **Call types** — extracted from incident types of matching ShiftCall records
- **Performance rating** (1-5 scale, configurable label and scale type)
- **Areas of strength** and **areas for improvement** (encrypted at rest with AES-256)
- **Officer narrative** (encrypted free-form assessment)
- **Skills observed** — structured list of `{skill_name, demonstrated, score (1-5), notes, comment}` entries. Each skill can be scored on a 1-5 scale: 1=Needs work, 2=Developing, 3=Competent, 4=Proficient, 5=Excellent. Scores flow through to `SkillCheckoff` records and the competency score history
- **Tasks performed** — structured list of `{task, description, comment}` entries

These reports **automatically update training program progress** for enrolled members. When a report is filed (or a draft is completed), the system credits hours, shift count, and call count toward matching requirements. Call type requirements support **case-insensitive matching** against the report's call_types array — only calls matching the required types count toward progress.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Shift Reports tab showing a list of filed reports with columns for date, officer, trainee, hours, calls, rating, and a status indicator showing which requirements were auto-progressed._

### Shift Finalization Workflow *(2026-03-28)*

Before filing shift reports, officers should **finalize the shift**. This creates snapshot data and auto-generates draft reports.

1. Navigate to the **Shift Detail Panel** for a past shift
2. Click **"Finalize Shift"** — a pre-finalization checklist modal appears
3. The checklist validates:
   - **End-of-shift equipment checks** must be completed (blocking requirement)
   - Attendance count and call count displayed for reference
4. On confirmation, the system:
   - Snapshots `call_count` and `total_hours` on the shift record
   - Computes per-member `call_count` on each ShiftAttendance record
   - Sets `is_finalized=true` with timestamp and officer ID
   - **Auto-creates draft ShiftCompletionReports** for all attendees with active training program enrollments
   - Sends a notification to the officer listing the number of drafts created
5. After finalization, a green badge shows "Shift finalized on [date]"

> **[SCREENSHOT NEEDED]:** _Screenshot of the pre-finalization checklist modal showing the equipment check validation, attendance count, call count, and the Finalize button._

> **[SCREENSHOT NEEDED]:** _Screenshot of the ShiftDetailPanel after finalization showing the green "Finalized" badge with timestamp._

### Auto-Population from Shift Data

When creating or completing a shift report, the system can auto-populate data from shift records:

1. Select a **shift date** and **trainee** in the report form
2. The system calls the **shift preview** endpoint to pull:
   - **Hours on shift** from ShiftAttendance duration
   - **Calls responded** from ShiftCall records where the trainee is in `responding_members`
   - **Call types** from the incident types of matching ShiftCall records
3. Auto-populated fields display an **(auto)** badge in the form
4. Officers can edit all auto-populated values before submitting
5. The `data_sources` field tracks which fields were auto-populated vs manually entered for audit purposes

> **[SCREENSHOT NEEDED]:** _Screenshot of the shift report form showing auto-populated hours and calls fields with the (auto) badge, plus the performance rating stars and narrative text areas below._

### Draft Reports and Review Workflow *(2026-03-28)*

The shift report system supports a multi-stage review workflow:

1. **Draft** — Auto-created on shift finalization. Officer completes the evaluation fields (rating, narrative, skills, tasks)
2. **Pending Review** — Report submitted for review by a training officer (if `report_review_required` is enabled in org config)
3. **Approved** — Report finalized and visible to the trainee (subject to visibility config)
4. **Flagged** — Report flagged by reviewer for correction or concern

**For Officers:**
- Navigate to the **Drafts** view in ShiftReportsTab to see auto-created drafts awaiting completion
- Click a draft to edit and fill in evaluation details
- Submit to transition the draft to `approved` or `pending_review`
- Draft → approved transition triggers **deferred pipeline progress** (progress was not applied when the draft was created)

**For Reviewers:**
- Navigate to the **Pending Review** view
- Review reports and approve or flag them — the review modal displays the full report content (hours, calls, rating, strengths, improvements, narrative, skills with scores, tasks) for complete context
- **Batch review** *(2026-04-07)* — Select multiple reports using checkboxes, toggle select-all, then click "Approve Selected" or "Flag Selected" to review up to 100 reports at once
- Navigate to the **Flagged** view *(2026-04-07)* — Reports previously flagged appear here for follow-up. Flagged reports can be re-reviewed and approved
- Optionally **redact fields** — clearing sensitive content from specified fields before the trainee sees the report
- Add **reviewer notes** (encrypted, never visible to trainees)

> **[SCREENSHOT NEEDED]:** _Screenshot of the Pending Review view showing report cards with checkboxes, the select-all toggle at the top, and the "Approve Selected" / "Flag Selected" action buttons. Show at least 3 reports with 2 checked._

> **[SCREENSHOT NEEDED]:** _Screenshot of the Flagged tab showing previously flagged reports with a "Re-review" button and the flagged status badge on each card._

**For Trainees:**
- Navigate to **My Reports** to see approved reports
- Click **Acknowledge** to confirm you have reviewed the report
- Add optional **comments** during acknowledgment
- View personal statistics: total hours, calls, average rating, and monthly breakdown

> **[SCREENSHOT NEEDED]:** _Screenshot of the officer's Drafts view showing auto-created draft reports with shift date, trainee name, auto-populated hours/calls, and an "Edit" button to complete the report._

> **[SCREENSHOT NEEDED]:** _Screenshot of the review modal showing review status options (Approve/Flag), field redaction checkboxes, and reviewer notes textarea._

> **[SCREENSHOT NEEDED]:** _Screenshot of the trainee's My Reports view showing a list of approved reports with an Acknowledge button and the personal stats card above._

### Officer Analytics Dashboard *(2026-03-29)*

Navigate to the **Officer Dashboard** view in ShiftReportsTab to see org-wide analytics:

- **Summary cards** — Total reports, total hours, total calls, average rating
- **Per-trainee breakdown table** — Each trainee's report count, hours, calls, and average rating
- **Status counts** — How many reports are in draft, pending_review, approved, and flagged status
- **Monthly trend** — Chart data showing reports, hours, and calls per month

> **[SCREENSHOT NEEDED]:** _Screenshot of the officer analytics dashboard showing the summary metric cards at the top, the per-trainee data table in the middle, and the monthly trend section below._

### Trainee Statistics Dashboard *(2026-03-29)*

Trainees see a personal stats card at the top of their My Reports view:

- **Total reports** received
- **Total hours** logged across all reports
- **Total calls** responded
- **Average rating** across all rated reports
- **Monthly breakdown** — per-month data for the current evaluation period

> **[SCREENSHOT NEEDED]:** _Screenshot of the trainee stats card showing total hours, calls, average rating, and monthly breakdown._

### Visibility Configuration

Training officers can control what trainees see via **Training Module Configuration**:

| Setting | Controls |
|---------|----------|
| `show_performance_rating` | Whether rating stars appear on trainee-visible reports |
| `show_officer_narrative` | Whether officer's free-form assessment is visible to trainee |
| `show_areas_of_strength` | Whether strengths are visible to trainee |
| `show_areas_for_improvement` | Whether improvement areas are visible to trainee |
| `show_skills_observed` | Whether skills observations appear |
| `show_shift_stats` | Whether the trainee stats dashboard appears |
| `show_shift_reports` | Whether the shift reports section appears at all |
| `report_review_required` | Whether reports require reviewer approval before trainee visibility |
| `rating_label` | Custom label for the performance rating (e.g., "Performance", "Readiness") |
| `rating_scale_type` | Rating scale type: "stars" (star icons) or "descriptive" (labeled buttons) |
| `rating_scale_labels` | Custom labels for each rating level (e.g., `{1: "Needs Improvement", 5: "Exceptional"}`) |

### Report Form Section Toggles *(2026-04-04)*

Separate from trainee visibility, officers can control which **optional sections appear on the report creation form** itself:

| Toggle | Default | Controls |
|--------|---------|----------|
| `form_show_performance_rating` | On | Performance rating stars/scale on the form |
| `form_show_areas_of_strength` | On | Strengths text field on the form |
| `form_show_areas_for_improvement` | On | Improvement text field on the form |
| `form_show_officer_narrative` | On | Free-form officer assessment on the form |
| `form_show_skills_observed` | On | Structured skills checklist on the form |
| `form_show_tasks_performed` | On | Structured tasks checklist on the form |
| `form_show_call_types` | On | Call type selection on the form |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Shift Reports Settings panel showing the "Report Form Sections" card with toggle switches for each section (performance rating, strengths, improvement, narrative, skills, tasks, call types), showing some toggled on and some toggled off._

These toggles are managed in **Scheduling > Settings > Shift Reports**. When a section is toggled off, it is hidden from the report creation form entirely — officers do not see it and cannot enter data for it. The trainee visibility settings (above) are separate and control what trainees see after a report is filed.

### Per-Apparatus-Type Skills and Tasks *(2026-04-04)*

The report form can auto-populate skills and tasks relevant to the specific apparatus type used during the shift. For example, if a trainee worked on an engine company, the skills checklist might show "Pump operations", "Hose deployment", and "Hydrant connection" rather than generic skills.

**How it works:**
1. Navigate to **Scheduling > Settings > Shift Reports** to configure per-apparatus-type mappings
2. Expand an apparatus type (e.g., Engine, Ladder, Ambulance) in the accordion
3. Add or remove skills and tasks specific to that apparatus type
4. When an officer files a report linked to a shift with that apparatus type, the form pre-populates the relevant skills and tasks

> **[SCREENSHOT NEEDED]:** _Screenshot of the Shift Reports Settings panel showing the "Per-Apparatus Skills & Tasks" accordion, with one type (e.g., "Engine") expanded showing a list of skills like "Pump operations", "Hose deployment", "Hydrant connection" with add/remove buttons._

If no mapping exists for the shift's apparatus type, the system falls back to the org-wide default skills and tasks lists. If neither exists, the skills/tasks sections are empty (but still visible unless toggled off via form section toggles).

### Save as Draft *(2026-04-04)*

Officers can save incomplete shift completion reports as drafts:

1. Begin filling in the report form
2. Click **Save as Draft** instead of Submit
3. The report is saved with `review_status: "draft"` — no pipeline progress is triggered
4. Return to the **Drafts** view in the Shift Reports tab to see all saved drafts
5. Click **Edit** on a draft to complete it
6. On final submission, the report transitions to `approved` or `pending_review`, and deferred pipeline progress is applied

> **[SCREENSHOT NEEDED]:** _Screenshot of the shift report form showing the two action buttons at the bottom: "Save as Draft" (outlined/secondary) and "Submit Report" (primary/filled), with the form partially completed._

> **[SCREENSHOT NEEDED]:** _Screenshot of the Drafts view in ShiftReportsTab showing a list of saved draft reports with shift date, trainee name, auto-populated hours/calls, and an "Edit" button to complete each draft._

### Auto-Filter Trainee List *(2026-04-04)*

When filing a shift report and linking it to a specific shift, the trainee dropdown automatically filters to show only members who were assigned to that shift. This prevents accidentally filing a report for someone who wasn't on duty.

For ad-hoc reports (no shift selected), the full member list is shown.

> **[SCREENSHOT NEEDED]:** _Screenshot of the shift report form showing the trainee dropdown with a smaller filtered list (only 4-5 names) when a shift is selected, with a note or badge saying "Filtered to shift members"._

### Edge Cases

- **Duplicate prevention:** A unique constraint on `(shift_id, trainee_id)` prevents filing two reports for the same trainee on the same shift. If a second report is attempted, the system returns a descriptive error.
- **Finalization blocking:** Shifts cannot be finalized if end-of-shift equipment checks are incomplete. Start-of-shift checks do not block finalization.
- **Finalized shift protection:** Finalized shifts cannot be edited or deleted. Shifts with associated completion reports also cannot be deleted.
- **Draft pipeline deferral:** Draft reports do not trigger training pipeline progress on creation. Progress is deferred until the draft is completed and transitions to `approved` or `pending_review`.
- **Save as draft with missing fields:** Drafts can be saved with incomplete data — validation of required fields is deferred until the final submission.
- **Field redaction:** When a reviewer redacts fields, those field values are set to null before the report becomes visible to the trainee. The original values are not recoverable.
- **Reviewer notes privacy:** The `reviewer_notes` field (encrypted at rest) is never exposed to the trainee in any view or API response.
- **Auto-populate edge case:** If the trainee is not found in the shift's attendance records, the preview returns zeroed data. If there are no ShiftCall records, calls_responded defaults to 0 and call_types is empty.
- **Trainee with assignment but no attendance:** If a trainee has a shift assignment but no attendance record (e.g., they were assigned but didn't check in), the auto-populate returns zeros and the officer can manually enter hours.
- **Report shift_date validation:** When a report is linked to a specific shift, the report's `shift_date` must match the linked shift's actual date. A mismatch returns a validation error.
- **Call type matching:** Requirements with `required_call_types` use case-insensitive matching. "Medical" in a requirement matches "medical" in a call type. The system tracks matched types in `progress_notes` for audit.
- **Ad hoc reports:** Reports filed without a `shift_id` are saved as ad hoc reports — no auto-population is available, and they appear in reports as "ad hoc".
- **Failure isolation during finalization:** If draft auto-creation fails for one trainee, the error is logged and processing continues for remaining attendees.
- **All form sections toggled off:** When all optional sections are disabled, only core fields (trainee, shift date, hours, calls) remain on the form. The form is still submittable.
- **Apparatus type with no mapped skills:** Falls back to org-wide default skills list. If no defaults exist either, the skills section appears empty (unless toggled off).
- **Descriptive rating with no custom labels:** Falls back to numeric display (1-5) instead of showing empty labels.
- **Skill score outside 1-5 range:** Rejected by Pydantic validation with a 422 error. The UI constrains selection to 1-5 buttons, but API callers sending out-of-range values get an immediate validation error.
- **Batch review with more than 100 reports:** Rejected by `max_length=100` on the `BatchReviewRequest` schema. Select fewer reports and retry.
- **Batch review with invalid or already-reviewed report IDs:** Valid reports are processed; a `failed` count is returned for reports that could not be reviewed (e.g., already approved, wrong org, or nonexistent ID).
- **Flagged report re-approved:** Moves from the Flagged view to Approved status. If the report has a linked enrollment, deferred pipeline progress is triggered on approval.
- **Non-authorized user accessing a report by ID:** Returns 403 Forbidden. Only the trainee, the filing officer, or users with `training.manage` permission can access a specific report. *(Security fix 2026-04-07)*
- **Trainee accessing their own report:** Data is filtered by visibility settings (e.g., if `show_performance_rating` is off, the rating is stripped). `reviewer_notes` are always stripped for trainees regardless of settings.
- **Skill linkage status:** When an apparatus-type skill name exactly matches a `SkillEvaluation.name` in the training module, it shows as "linked" (green) in the settings panel. Unlinked skills (amber) are still observed on reports but don't flow into formal competency tracking.
- **No SkillEvaluation records in org:** All skills show amber "unlinked" tags in the apparatus settings panel.

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

## Competency Matrix

**Required Permission:** `training.manage`

Navigate to **Training Admin > Compliance Matrix** and select the **Competency** view to see a department-wide readiness heat-map.

The competency matrix provides a visual representation of skills and qualifications across all members. Each cell shows a proficiency level using color-coded indicators:

- **Dark green** — Expert / fully qualified
- **Green** — Proficient
- **Yellow** — Developing / partially trained
- **Red** — Not trained / gap identified
- **Gray** — Not applicable to this member's role

> **Screenshot placeholder:**
> _[Screenshot of the Competency Matrix showing a heat-map grid with member names on rows, competency areas on columns, and color-coded cells. Include the filter bar at the top for filtering by station, rank, or competency category]_

### Edge Cases

- The competency heat-map is cached for approximately 5 minutes. Changes to training records or skill test results may not appear immediately — wait for cache expiry or refresh the page.
- Members whose roles do not include a particular competency area show gray (N/A) cells, not red. This prevents false negatives in department readiness views.
- If a member has a waiver active for a competency-related requirement, their cell reflects the waiver-adjusted status, not the full requirement.

---

## Recertification Tracking

**Required Permission:** `training.manage`

The system automatically tracks certification expiration dates and generates recertification reminders with configurable lead times.

### Recertification Pathways

Navigate to **Training Admin > Enhancements > Recertification** to configure recertification pathways. Each pathway defines:

- **Certification type** — Which certification this pathway applies to
- **Lead time** — How far in advance to begin sending reminders (e.g., 90 days before expiry)
- **Renewal tasks** — Specific steps required for recertification (courses, exams, documentation)
- **Auto-generation** — Whether to automatically create renewal tasks for members

> **Screenshot placeholder:**
> _[Screenshot of the Recertification Pathways configuration page showing a list of configured pathways with certification type, lead time, and task count columns. Show one pathway expanded to reveal the renewal task checklist]_

### Member View

Members can view their upcoming recertification tasks at **Training > My Training** in the recertification section. Each task shows:

- The certification requiring renewal
- Days until expiration
- Required renewal steps and their completion status
- Links to relevant courses or submission forms

> **Screenshot placeholder:**
> _[Screenshot of the member's My Training page showing the recertification section with a certification expiring in 45 days, renewal tasks with checkmarks for completed steps, and a progress indicator]_

### Edge Cases

- Recertification reminders require `EMAIL_ENABLED=true` in the environment and an active Celery beat scheduler running the `process_recertification_reminders` task.
- If a member holds multiple certifications of the same type (e.g., from different issuers), the system tracks each independently. The earliest expiration triggers reminders first.
- Permanent waivers do not suppress recertification reminders — certifications must still be maintained even if training hour requirements are waived.
- If a certification is renewed before the recertification pathway tasks are completed, the tasks are automatically closed and marked as superseded.

---

## Instructor Management

**Required Permission:** `training.manage`

Navigate to **Training Admin > Enhancements > Instructors** to manage instructor qualifications and availability.

### Instructor Qualifications

Each instructor qualification record tracks:

| Field | Description |
|-------|-------------|
| **Member** | The qualified instructor |
| **Qualification type** | instructor, evaluator, lead_instructor, or mentor |
| **Course** | Which course(s) the instructor is qualified to teach |
| **Certification date** | When the qualification was earned |
| **Expiration date** | When the qualification expires (if applicable) |

> **Screenshot placeholder:**
> _[Screenshot of the Instructor Qualifications page showing a table of instructors with columns for member name, qualification type badge, qualified courses, certification date, and expiration status indicator]_

### Assigning Instructors to Sessions

When creating a training session, you can assign a qualified instructor. The system validates that the instructor holds a valid qualification for the course being taught.

### Edge Cases

- Instructor availability is tracked separately from member scheduling. An instructor may be available for training but assigned to a shift — check both the instructor availability calendar and the scheduling module.
- If an instructor's qualification expires between session creation and the session date, the system displays a warning but does not automatically remove the assignment. The training officer should reassign.
- The `GET /training/instructors/validate/{userId}/{courseId}` endpoint can programmatically verify whether a member is qualified to instruct a specific course.

---

## Training Effectiveness Scoring

**Required Permission:** `training.manage`

Navigate to **Training Admin > Enhancements > Effectiveness** to view and manage training effectiveness evaluations.

The system uses the **Kirkpatrick Model** to measure training effectiveness across four levels:

| Level | Name | What It Measures |
|-------|------|-----------------|
| 1 | **Reaction** | How participants felt about the training |
| 2 | **Learning** | Knowledge or skills gained |
| 3 | **Behavior** | On-the-job application of training |
| 4 | **Results** | Organizational impact of the training |

### Submitting Evaluations

After a training session, evaluations can be submitted to capture participant feedback and learning outcomes. Navigate to **Training Admin > Effectiveness** and click **Submit Evaluation**.

> **Screenshot placeholder:**
> _[Screenshot of the Effectiveness Evaluation form showing fields for training session selection, evaluation level dropdown (Reaction/Learning/Behavior/Results), score slider, and notes textarea. Show a summary dashboard below with average scores per level displayed as a bar chart]_

### Viewing Summaries

The effectiveness summary for a course aggregates all evaluations and displays:
- Average score per Kirkpatrick level
- Number of evaluations submitted
- Trend over time

### Edge Cases

- Effectiveness scoring requires post-training evaluations to be submitted. Scores will not appear until the evaluation period configured on the training session has elapsed and at least one evaluation has been submitted.
- Level 3 (Behavior) and Level 4 (Results) evaluations are typically submitted weeks or months after training. The system allows backdated evaluation submissions.
- If no evaluations exist for a course, the effectiveness summary returns empty data rather than zeros, to distinguish "not measured" from "scored zero."

---

## Multi-Agency Training

Navigate to **Training Admin > Enhancements > Multi-Agency** to coordinate joint training sessions with other departments.

Multi-agency training sessions allow:
- Scheduling joint training events across departments
- Sharing training records between participating organizations
- Mutual aid tracking and documentation
- xAPI statement delivery to external Learning Record Stores (LRS)

> **Screenshot placeholder:**
> _[Screenshot of the Multi-Agency Training page showing a list of joint training sessions with participating organization names, session date, participant count from each org, and status badges (planned, in_progress, completed)]_

### Creating a Multi-Agency Session

1. Click **Create Multi-Agency Session**.
2. Enter the session details (title, date, location, description).
3. Add participating organizations by name or code.
4. Assign the lead organization responsible for reporting.
5. Click **Save**.

### Edge Cases

- Multi-agency training records are sent asynchronously via Celery. If xAPI statements are not appearing in the external LRS, check Celery worker logs for delivery failures and verify the LRS endpoint URL and API key in training integration settings.
- Data sharing between organizations is limited to training session metadata, completion status, and hours. Member PII (names, contact info) is not shared unless explicitly configured by both organizations.
- If a participating organization does not use The Logbook, their members' training records can still be logged manually with organization attribution.

---

## xAPI (Tin Can) Integration

Navigate to **Training Admin > Integrations** to configure xAPI Learning Record Store (LRS) connections.

xAPI integration enables standardized training activity tracking using the Experience API specification. Training activities generate xAPI statements that are delivered to configured LRS endpoints.

### Configuration

| Setting | Description |
|---------|-------------|
| **LRS Endpoint URL** | The URL of the Learning Record Store |
| **API Key** | Authentication key for the LRS |
| **Statement types** | Which training activities generate xAPI statements |
| **Delivery mode** | Synchronous or asynchronous (via Celery) |

### Edge Cases

- xAPI statements are delivered asynchronously via Celery by default. Delivery failures are retried with exponential backoff.
- If the LRS endpoint is unreachable, statements are queued and retried. Check the Celery dead-letter queue if statements consistently fail.
- Batch processing is supported via `POST /training/xapi/statements/batch` for bulk statement delivery.

---

## Compliance Officer Dashboard

**Required Permission:** `training.manage`

Navigate to **Training Admin > Enhancements > Compliance** for a specialized compliance officer view.

This dashboard provides:

### ISO Readiness

Track organizational readiness against ISO standards with:
- Overall readiness score
- Category-by-category assessment
- Gap identification and remediation tracking

> **Screenshot placeholder:**
> _[Screenshot of the ISO Readiness dashboard showing an overall readiness percentage gauge, a breakdown by ISO category with progress bars, and a list of identified gaps with priority indicators]_

### Compliance Attestations

Officers can submit and track compliance attestations — formal declarations that specific compliance requirements have been verified.

> **Screenshot placeholder:**
> _[Screenshot of the Compliance Attestations page showing a table of submitted attestations with columns for attestation type, submitted by, date, status, and a "Create Attestation" button]_

### Annual Compliance Report

Generate a comprehensive annual compliance report covering:
- Department-wide training completion rates
- Certification status across all members
- Waiver summary and impact
- Requirement-by-requirement breakdown
- Year-over-year comparison

The report can be exported as a formatted document for regulatory submissions.

> **Screenshot placeholder:**
> _[Screenshot of the Annual Compliance Report page showing summary statistics at the top (overall compliance %, members compliant, certifications current), a department-wide breakdown table, and an "Export Report" button]_

### Compliance Forecast

The compliance forecast projects future compliance trends based on:
- Current training completion rates and trajectories
- Upcoming certification expirations
- Scheduled training sessions
- Historical compliance patterns

> **Screenshot placeholder:**
> _[Screenshot of the Compliance Forecast view showing a line chart projecting compliance percentage over the next 6 months, with annotations for upcoming certification expirations and scheduled training sessions]_

### Edge Cases

- The compliance forecast uses historical data to project trends. Forecasts are less reliable for organizations with fewer than 6 months of data.
- Annual compliance reports include waiver-adjusted requirements. If a waiver end date changes retroactively (e.g., a member returns from leave early), the report reflects the updated adjustments.
- Record completeness checks (`GET /compliance/record-completeness`) identify training records missing key fields (hours, certification numbers, completion dates). Incomplete records may not count toward compliance.

---

## Training Record Attachments

Members and officers can attach supporting documents (certificates, transcripts, completion letters) to training records.

### Uploading Attachments

1. Navigate to a training record detail view.
2. Click **Add Attachment**.
3. Upload the file (PDF, image, or document).
4. The attachment is linked to the training record for verification purposes.

> **Screenshot placeholder:**
> _[Screenshot of a training record detail view showing the record information (course, date, hours, status) with an "Attachments" section below containing uploaded certificate thumbnails and an "Add Attachment" button]_

### Edge Cases

- Attachments are stored via the configured file storage backend (local, S3-compatible, or MinIO). If file storage is not configured, attachment uploads will fail with a clear error message.
- Maximum file size is determined by the server configuration. Large files (>10MB) may time out on slower connections — the system displays a progress indicator during upload.

---

## Training Submission & Compliance Edge Cases

The training module has several boundary behaviors that affect how submissions are processed, how compliance is calculated, and how waivers interact with requirements.

### Self-Reported Submission Processing

| Scenario | Behavior |
|----------|----------|
| Department disables approval requirement | Submissions are auto-approved immediately — no officer review. A training record is created on submit. |
| Hours below `auto_approve_under_hours` threshold | Auto-approved even when approval is generally required. Officers configure this threshold in Training Settings. |
| Hours exceed `max_hours_per_submission` | Submission rejected: "Hours exceed maximum of N per submission." Re-submit with corrected hours. |
| Training type not in allowed types list | Submission rejected: "Training type 'X' is not allowed for self-reporting." Only types listed in the configuration are accepted. |
| Submission already reviewed | Attempting to approve or reject a non-pending submission returns: "Submission has already been reviewed." |

### Compliance Calculation

| Scenario | Behavior |
|----------|----------|
| Membership tier marked `training_exempt` | Member is fully exempt from all training requirements — shows green compliance regardless of hours. |
| Tier has `training_exempt_types` list | Member is exempt only from requirements matching those training types. Other requirements still apply. |
| Tier lookup fails (corrupt config) | System fails open — member is treated as non-exempt and must meet all requirements. Officers may see unexpected non-compliance for senior-tier members. |
| `COURSES` requirement with empty `required_courses` list | Auto-completes immediately (100% progress). Appears green in the compliance matrix. |
| `CERTIFICATION` requirement matching | Matches records via three fallback strategies: (1) `training_type` match, (2) case-insensitive requirement name substring in course name, (3) `registry_code` substring in certification number. If none match, the member shows as non-compliant. |
| Biannual requirement with expired certification | Even if the member has accumulated sufficient hours, an expired certification resets progress to 0 and blocks further activity. |
| `BIANNUAL` or `ONE_TIME` frequency requirements | No date window applied — ALL historical training records count toward the requirement, not just recent ones. |

### Waiver Behavior

| Scenario | Behavior |
|----------|----------|
| Waiver covers fewer than 15 days of a month | That month is NOT counted as waived — the member must still meet the full requirement for that month. |
| Waiver covers 15 or more days of a month | The entire month is waived and the requirement is pro-rated. |
| Permanent waiver (no end date) | Stored with a sentinel end date of 9999-12-31 for calculation purposes. Displays as "Permanent" in the UI. |
| LOA with unrecognized leave type | Auto-linked training waiver defaults to `OTHER` waiver type. The waiver still functions but the type classification may not match expectations. |

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
| Imported requirements missing source info | Update to the latest version. Imports now include `source`, `source_url`, and `last_updated` fields displayed in the UI for traceability. |
| How to list available registries | Use the CLI tool: `python scripts/generate_registry.py --list` to see all available registries (NFPA, NREMT, Pro Board, etc.). |
| Source filter not working on requirements | Update to the latest version. The source field has been added to the API schema and the filter is now wired up. |
| Recertification reminders not sending | Verify: (1) certification has expiration date, (2) recertification lead time is configured, (3) `EMAIL_ENABLED=true` in environment, (4) Celery beat is running the `process_recertification_reminders` task. |
| Competency matrix shows stale data | The competency heat-map is cached for ~5 minutes. Wait for cache expiry or clear Redis cache in development. |
| xAPI statements not appearing in LRS | Multi-agency training records are sent asynchronously via Celery. Check Celery worker logs for delivery failures. Verify LRS endpoint URL and API key in training integration settings. |
| Instructor not available for session | Instructor availability is tracked separately from member scheduling. Check the instructor's availability calendar in Training Admin > Instructors. |
| Effectiveness score not calculating | Training effectiveness scoring (Kirkpatrick model) requires post-training evaluations to be submitted. Scores appear after the evaluation period configured on the training session. |

---

## Recurring Training Sessions (2026-03-15)

Training sessions can now recur on a schedule, just like events. This eliminates the need to manually create individual sessions for ongoing training activities like weekly drills, monthly CPR refreshers, or quarterly hazmat reviews.

### Creating a Recurring Training Session

1. Navigate to **Training > Admin > Create Session**
2. Fill in the session details (title, training type, instructor, location)
3. Select a **course** from the dropdown — the form auto-fills training type, credit hours, instructor, expiration months, and max participants from the course template

> **Screenshot needed:**
> _[Screenshot of the Create Training Session form showing the course auto-populate feature with the details preview card below the course dropdown]_

4. Set the **start date/time** using the new quarter-hour time picker (restricted to `:00`, `:15`, `:30`, `:45`)

> **Screenshot needed:**
> _[Screenshot of the DateTimeQuarterHour component showing the date picker and the quarter-hour dropdown side by side]_

5. Use one of the **quick duration buttons** (1 hr, 2 hr, 4 hr, 8 hr) to auto-set the end time, or set it manually

> **Screenshot needed:**
> _[Screenshot of the quick duration buttons row (1 hr | 2 hr | 4 hr | 8 hr) appearing below the start date field]_

6. Enable **Recurrence** and choose a pattern:
   - **Daily** — every N days
   - **Weekly** — specific days of the week
   - **Biweekly** — every two weeks
   - **Monthly** — same day of month
   - **Monthly by Weekday** — e.g., "2nd Tuesday of every month"
   - **Annually** — same date each year
   - **Custom** — user-defined interval

> **Screenshot needed:**
> _[Screenshot of the recurrence pattern selector showing radio buttons for each pattern type with the "Monthly by Weekday" option selected, displaying "2nd Tuesday of every month"]_

7. Set the series **end date** and click **Create**

The system creates one event per occurrence and links a `TrainingSession` record to each one. Each session inherits the training type, credit hours, and other fields from the parent configuration.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Deleting the parent event | Does not cascade-delete the linked training session record |
| Quarter-hour picker with imported data | Arbitrary minute values from external sources are rounded to the nearest quarter-hour |
| Course auto-populate | Fills all fields but does not lock them — you can override any auto-filled value |
| Quick duration buttons | Disabled until a start date is selected |
| Recurrence beyond series end date | Events past the end date are not created |
| Existing course changes | Sessions created from a course snapshot values at creation time — later course edits do not retroactively update existing sessions |

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


## Training Record Categories & Virginia NCCR Standards (2026-03-24)

### Training Record Categories

Training records now include a **Category** field for classification. When submitting or reviewing training records, select the appropriate category:

| Category | Description |
|----------|-------------|
| Fire | Fire suppression and prevention training |
| EMS | Emergency Medical Services training |
| Hazmat | Hazardous materials response training |
| Rescue | Technical rescue training |
| Driver/Operator | Apparatus operation and EVOC training |
| Leadership | Officer development and leadership training |

Categories align with state reporting requirements and are used in compliance calculations for jurisdictions that require specific category hour minimums.

> **Screenshot needed:**
> _[Screenshot of the training record submission form showing the new "Category" dropdown field with options like Fire, EMS, Hazmat, Rescue, and the existing fields (course, date, hours)]_

### Virginia NCCR Recertification Standards

Virginia's National Continued Competency Requirements (NCCR) recertification standards have been added to the compliance tracking system. These define:

- Required training categories for recertification
- Hour minimums per category
- Recertification cycle periods

The compliance dashboard shows progress toward NCCR requirements with category breakdowns.

> **Screenshot needed:**
> _[Screenshot of the compliance dashboard showing a Virginia NCCR progress card with category bars (Fire: 12/16 hours, EMS: 8/8 hours, Hazmat: 2/4 hours) and an overall progress percentage]_

### EVOC Certification Levels

EVOC (Emergency Vehicle Operations Course) certification levels are now tracked on member profiles:

- **Basic** — Standard vehicle operation
- **Intermediate** — Emergency vehicle operation with lights and sirens
- **Advanced** — Specialized apparatus operation (aerials, heavy rescue)

EVOC levels integrate with the Apparatus module (required EVOC level per vehicle) and Scheduling module (validation on driver/operator assignments).

> **Screenshot needed:**
> _[Screenshot of a member's training profile showing the EVOC certification level field with "Advanced" selected and the certification date]_

### Bulk Entry Improvements

The bulk training record entry form now includes all available fields, matching the individual record creation form:

- Category selection
- Training type
- Certification-related fields (certification name, expiration date, certifying body)
- Notes and attachments

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Training record with no category | Not counted toward category-specific compliance requirements |
| Virginia NCCR with incomplete categories | Missing categories flagged in compliance dashboard |
| EVOC level not set on member profile | Member can still be assigned to driver positions but a warning is shown |
| Bulk entry with mixed categories | Each record saves with its own category independently |

---

## Printing Training Records, Programs & Compliance (2026-04-08)

Three new print-formatted pages allow you to generate paper copies of training data for audits, regulatory filings, annual reviews, and member records.

### Printing a Member's Training History

1. Navigate to **Training > Members** and select a member, or open a member's training history page
2. Click the **Print** button in the page header
3. A new tab opens with a paper-formatted view of the member's training records

The printed record includes:

- Member name, rank, station, and membership dates
- Training hours summary (current period and all-time)
- Certification status and expiration dates
- Compliance indicators (green/yellow/red) for all active requirements
- Complete list of training records with course name, date, hours, category, and status

> **[SCREENSHOT NEEDED]:** _Screenshot of the printed Member Training History page showing the letter-size layout with member info header, summary statistics, certification table, compliance badges, and training records table._

### Printing a Training Program

1. Navigate to **Training > Programs** and select a program
2. Click the **Print** button in the page header
3. A new tab opens with a paper-formatted view of the program

The printed program includes:

- Program name, description, type (Flexible/Sequential/Phase-based), and status
- Phase breakdown with all requirements listed under each phase
- Milestone checkpoints with completion criteria
- Enrollment roster with per-member progress percentages

> **[SCREENSHOT NEEDED]:** _Screenshot of the printed Training Program page showing the program header, phases with requirements listed under each, progress bars per requirement, milestone checkpoints, and enrollment table with member progress._

### Printing the Compliance Matrix

**Required Permission:** `training.manage`

1. Navigate to **Training Admin > Compliance Matrix**
2. Click the **Print** button in the toolbar above the matrix
3. A new tab opens with the full compliance matrix formatted for paper

The printed matrix includes:

- All members listed as rows and all active requirements as columns
- Color-coded cells (green for compliant, yellow for in-progress, red for non-compliant) with percentage values
- Designed for **landscape printing** on letter-size paper
- Repeat column headers across page breaks when the matrix spans multiple pages

> **[SCREENSHOT NEEDED]:** _Screenshot of the printed Compliance Matrix page showing the landscape grid with member names on the left, requirement names across the top, and colored cells with percentages. Show page break indicators._

This is particularly useful for:
- **Annual training audits** — print the matrix at year-end for records
- **Regulatory filings** — provide printed compliance evidence to regulatory agencies
- **Officer reviews** — give training officers a paper overview during planning meetings
- **Insurance requirements** — document department-wide training compliance

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Member with no training records | Print page shows empty table with "No records found" |
| Program with no enrollments | Enrollment section shows "No members enrolled" |
| Compliance matrix with 100+ members | Paginated across multiple pages with repeated headers |
| Browser blocks auto-print dialog | Page remains visible for manual Ctrl+P |
| Member on leave of absence | Print page shows adjusted requirements with leave notation |

---

**Previous:** [Membership Management](./01-membership.md) | **Next:** [Shifts & Scheduling](./03-scheduling.md)
