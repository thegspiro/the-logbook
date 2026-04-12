# Shifts & Scheduling

The Scheduling module manages duty rosters, shift assignments, attendance tracking, time-off requests, swap requests, and shift compliance reporting. It supports multiple shift patterns and provides both calendar and list views for managing your department's schedule.

---

## Table of Contents

1. [Schedule Overview](#schedule-overview)
2. [Calendar Views](#calendar-views)
3. [My Shifts](#my-shifts)
4. [Open Shifts](#open-shifts)
5. [Shift Assignments](#shift-assignments)
6. [Attendance Tracking](#attendance-tracking)
7. [Call Logging](#call-logging)
8. [Time-Off Requests](#time-off-requests)
9. [Shift Swap Requests](#shift-swap-requests)
10. [Shift Templates and Patterns](#shift-templates-and-patterns)
11. [Minimum Staffing and Coverage Rules](#minimum-staffing-and-coverage-rules)
12. [Shift Reports and Compliance](#shift-reports-and-compliance)
13. [How Shift Hours Feed Training Compliance](#how-shift-hours-feed-training-compliance)
14. [Realistic Example: Setting Up a 24/48 Platoon Rotation](#realistic-example-setting-up-a-2448-platoon-rotation)
15. [Troubleshooting](#troubleshooting)

---

## Schedule Overview

Navigate to **Shift Scheduling** in the sidebar. The scheduling page is organized into tabs:

| Tab | Description |
|-----|-------------|
| **Schedule** | Calendar view of all shifts |
| **My Shifts** | Your personal shift assignments |
| **Open Shifts** | Shifts available for sign-up |
| **Requests** | Time-off and swap requests |
| **Shift Templates** | Reusable shift configurations |
| **Reports** | Hours, coverage, and compliance reports |
| **Settings** | Notification preferences, shift rules, coverage settings, and shift report configuration (section toggles, apparatus skills/tasks, rating scale) |

> **Note:** *(2026-04-11)* Departments that do not use the Scheduling module can file shift completion reports via the standalone **Manual Shift Report** page at `/training/manual-shift-report`. See [Training > Manual Shift Report Entry](./02-training.md#manual-shift-report-entry) for details.

> **Screenshot placeholder:**
> _[Screenshot of the Scheduling page showing the tab bar at the top with all seven tabs, and the Schedule (calendar) tab active showing a monthly calendar view with color-coded shifts]_

> **Note:** The scheduling module uses a dedicated state store and API service. All scheduling data (shifts, templates, patterns, members) is managed centrally and updates in real time across all tabs.

---

## Calendar Views

The **Schedule** tab displays shifts in a calendar format. You can toggle between:

- **Week View** - Detailed daily breakdown with time slots
- **Month View** - Overview of the entire month

Each shift is displayed as a colored block on the calendar showing:
- Shift name or type
- Start and end times
- Assigned apparatus (if any)
- Staffing count

Click on any shift to open the **Shift Detail Panel** with full information, attendance records, and actions.

> **Screenshot placeholder:**
> _[Screenshot of the month calendar view showing several shifts across different days, with color coding for different shift types (e.g., Day shift in blue, Night shift in purple). Include the week/month toggle buttons]_

> **Screenshot placeholder:**
> _[Screenshot of the Shift Detail Panel (slide-out drawer) showing shift details at the top (date, time, type, apparatus), an attendance list with check-in/out times, and action buttons (Edit Shift, Add Attendance)]_

---

## My Shifts

The **My Shifts** tab shows only your assigned and upcoming shifts. This is your personal schedule view.

For each shift you can see:
- Date and time
- Shift type
- Your assignment status (Pending, Confirmed, Declined)
- Apparatus assignment
- Whether you have checked in/out

**Confirming an Assignment:**
When you are assigned to a shift, you may need to confirm your availability. Click **Confirm** on the assignment to acknowledge.

> **Screenshot placeholder:**
> _[Screenshot of the My Shifts tab showing a list of upcoming shifts with date, time, type, status badges (Confirmed in green, Pending in yellow), and a Confirm button on pending assignments]_

---

## Open Shifts

The **Open Shifts** tab lists shifts that need additional coverage. Members can sign up for these shifts.

1. Browse available open shifts by date.
2. Click **Sign Up** to volunteer for a shift.
3. An officer will review and approve your sign-up.

You can also **withdraw** from an open shift you signed up for, as long as it has not been approved yet.

> **Screenshot placeholder:**
> _[Screenshot of the Open Shifts tab showing available shifts with date, time, positions needed, current sign-ups, and Sign Up/Withdraw buttons]_

> **Hint:** Open shifts are a great way to pick up additional hours toward shift-based training requirements.

---

## Shift Assignments

**Required Permission:** `scheduling.manage`

Officers can assign members to shifts from the Shift Detail Panel:

1. Open the calendar and click on a shift.
2. In the detail panel, click **Add Assignment**.
3. Select the member, position, and apparatus.
4. Save the assignment.

The assigned member will receive a notification and can confirm or decline.

**Changing a Member's Position:**
Officers can change a member's assigned position (Officer, Driver, Firefighter, etc.) directly on the shift card using the inline position change UI, without opening a separate modal.

**Editing Shift Details:**
Officers can edit shift start and end times, apparatus assignment, color, notes, and custom creation times from the shift detail panel after the shift has been created.

> **Screenshot placeholder:**
> _[Screenshot of the assignment creation form within the Shift Detail Panel, showing a member dropdown, position selector, apparatus selector, and save button]_

> **Hint:** If a member is on **Leave of Absence** for the shift date, the system will prevent the assignment and display a message: "Member is on leave of absence for this date." See [Membership > Leave of Absence](./01-membership.md#leave-of-absence) for details.

---

## Attendance Tracking

Attendance is recorded for each shift to track who was present and for how long.

**Recording Attendance:**

1. Open the shift from the calendar.
2. In the detail panel, use the attendance section to:
   - **Check In** a member (records the check-in time)
   - **Check Out** a member (records the check-out time)
   - **Manually set times** for retroactive recording

The system calculates **duration in minutes** automatically from check-in and check-out times.

> **Screenshot placeholder:**
> _[Screenshot of the attendance section within a shift detail panel, showing a table of members with check-in time, check-out time, duration, and edit buttons]_

### Post-Shift Validation

After a shift ends, the shift officer receives an automatic notification prompting them to review and validate the attendance records. This ensures all check-in/check-out times are recorded before the data is used for compliance reporting.

---

## Call Logging

During a shift, officers can log calls responded to:

1. Open the shift detail panel.
2. Navigate to the **Calls** section.
3. Click **Add Call**.
4. Enter the call type, time, and any notes.

Calls logged against a shift contribute to **call-based training requirements** for enrolled members.

> **Screenshot placeholder:**
> _[Screenshot of the call logging section showing a list of calls with type, time, and notes, and an "Add Call" button]_

---

## Time-Off Requests

Members can request time off from the **Requests** tab:

1. Click **Request Time Off**.
2. Select the **start date** and **end date**.
3. Add a **reason** for the request.
4. Submit the request.

Officers will review the request and approve or deny it.

**Request Statuses:**
- **Pending** - Awaiting officer review
- **Approved** - Time off granted
- **Denied** - Request denied (reason provided)
- **Cancelled** - Withdrawn by the member

> **Screenshot placeholder:**
> _[Screenshot of the time-off request form showing start date, end date, reason field, and submit button. Below, show a list of past requests with their statuses]_

---

## Shift Swap Requests

Members can request to swap shifts with another member:

1. Navigate to the **Requests** tab.
2. Click **Request Swap**.
3. Select the shift you want to swap and the shift you are offering.
4. The system notifies the other member and the officer.

**Swap Workflow:**
1. Member A requests a swap.
2. Member B accepts or declines.
3. An officer reviews and approves the swap.
4. Assignments are updated automatically.

> **Screenshot placeholder:**
> _[Screenshot of the swap request form showing the "Your Shift" and "Requested Shift" selectors, and a list of active swap requests with status indicators]_

---

## Shift Templates and Patterns

**Required Permission:** `scheduling.manage`

### Templates

Shift templates define reusable shift configurations (name, times, positions, apparatus). Navigate to the **Shift Templates** tab to manage them.

- **Create a template** with a name, start/end times, required positions, and linked apparatus.
- **Reuse templates** when creating individual shifts to avoid entering the same details repeatedly.

> **Screenshot placeholder:**
> _[Screenshot of the Shift Templates tab showing a list of templates with name, start time, end time, positions, and edit/delete actions]_

### Patterns

Shift patterns automate shift creation over a date range based on a template:

| Pattern Type | Description | Common Use |
|-------------|-------------|------------|
| **Daily** | Creates a shift every day | Staffed stations with daily coverage |
| **Weekly** | Creates shifts on selected weekdays | Volunteer departments with set drill nights (e.g., every Tuesday) |
| **Platoon** | Rotates on/off days in a fixed cycle | Career departments running 24/48, 48/96, or Kelly schedules |
| **Custom** | Specific dates you choose manually | One-off details, special events, holiday coverage |

To generate shifts from a pattern:

1. Create a pattern linked to a template.
2. Set the date range.
3. Click **Generate Shifts**.
4. Review and confirm the generated shifts.

> **Screenshot placeholder:**
> _[Screenshot of the pattern creation form showing the pattern type selector (Daily, Weekly, Platoon, Custom), the linked template dropdown, start/end date pickers, and for Platoon type: days on / days off fields]_

### Understanding Platoon Rotations

Platoon patterns are the most complex pattern type. They work by cycling through a fixed on/off rotation:

| Schedule | Days On | Days Off | Cycle Length | Avg Hours/Week |
|----------|---------|----------|-------------|----------------|
| **24/48** | 1 day (24 hrs) | 2 days off | 3 days | ~56 hrs |
| **48/96** | 2 days (48 hrs) | 4 days off | 6 days | ~56 hrs |
| **Kelly** | 1 on, 1 off, 1 on, 1 off, 1 on, 4 off | (built into cycle) | 9 days | ~49 hrs |

**How the cycle works:**

For a 24/48 rotation with 3 platoons (A, B, C):

```
Day:     Mon   Tue   Wed   Thu   Fri   Sat   Sun   Mon   Tue
A:        ON   off   off    ON   off   off    ON   off   off
B:       off    ON   off   off    ON   off   off    ON   off
C:       off   off    ON   off   off    ON   off   off    ON
```

Each platoon works every third day. The system generates the full rotation from a **start date** and **platoon label** — you set which platoon starts on day 1, and the system fills in the rest.

**At pattern boundaries:** When a generated pattern reaches its end date, the last shift ends cleanly on that date. To extend, generate a new pattern starting from the day after the previous one ended. The system does not automatically roll over into a new month — you generate explicitly.

> **Hint:** For departments using a Kelly schedule, set up the pattern as Platoon with a 9-day cycle: 1 on, 1 off, 1 on, 1 off, 1 on, 4 off. The system handles the irregular spacing within the cycle.

---

## Minimum Staffing and Coverage Rules

**Required Permission:** `scheduling.manage`

Minimum staffing rules ensure each shift meets your department's coverage requirements.

### Configuring Minimum Staffing

Navigate to **Shift Scheduling > Settings** to set staffing rules:

- **Minimum members per shift** — The system warns when a shift falls below this threshold
- **Required positions** — Certain positions (e.g., Officer, Driver/Operator) must be filled
- **Apparatus minimums** — Each apparatus can have a minimum crew size

### How Understaffing Is Handled

When a shift is below minimum staffing:
- The calendar highlights the shift with a **warning indicator** (yellow border)
- The shift detail panel shows a staffing alert: "2/4 positions filled — below minimum"
- The **Coverage** report flags understaffed shifts for the selected date range
- Open shifts are automatically created for unfilled positions (if configured)

> **Hint:** The system does not prevent an understaffed shift from occurring — it alerts so officers can take action. Automatic open shift creation can be enabled in Scheduling Settings.

---

## Shift Reports and Compliance

The **Reports** tab provides several reporting views:

| Report | Description |
|--------|-------------|
| **Member Hours** | Total hours per member for a date range |
| **Coverage** | Shift staffing levels and gaps |
| **Call Volume** | Calls by day, week, or month |
| **Compliance** | Member compliance against shift/hours requirements |

### Compliance Report

The compliance report evaluates each member's shift attendance and hours against active training requirements of type SHIFTS or HOURS.

For each requirement, the report shows:
- Required value (shifts or hours)
- Each member's completed value
- Compliance percentage
- Whether the member is compliant

> **Screenshot placeholder:**
> _[Screenshot of the compliance report showing a requirement (e.g., "Monthly Minimum Shifts: 4") with a table of members, their completed shifts, percentage, and a compliant/non-compliant badge. Show one member with a "Leave: 2 months" annotation and a reduced requirement]_

> **Hint:** Members with active leaves of absence will have their requirements pro-rated. The report shows the adjusted requirement and the number of leave months for transparency.

---

## How Shift Hours Feed Training Compliance

Shift attendance data flows directly into the Training module's compliance calculations. Understanding this connection helps both members and officers see why accurate attendance records matter.

### The Data Flow

```
Shift Attendance (check-in/out recorded)
    ↓
Hours calculated automatically
    ↓
Training Requirements (type: HOURS or SHIFTS) pick up the data
    ↓
Compliance Matrix / Member Training Dashboard updated
    ↓
Shift Completion Reports (filed by officer) credit program requirements
```

### What Counts

| Requirement Type | What the system counts | Source |
|-----------------|----------------------|--------|
| **HOURS** | Total attendance hours (check-out minus check-in) | Attendance records |
| **SHIFTS** | Number of shifts with recorded attendance | Attendance records |
| **CALLS** | Number of calls logged during attended shifts | Call log entries |

### Requirements for Data to Flow

1. **Attendance must be recorded** — a shift with no check-in/out contributes nothing
2. **Both check-in and check-out** must exist for hours to calculate
3. **The requirement must be active** and cover the current period
4. **Shift completion reports** (filed by the shift officer) are needed for training program auto-progression — raw attendance alone updates hours/shift counts, but program phase requirements need the officer's report

### Leave of Absence Adjustments

When a member has an active leave, shift-based requirements are pro-rated just like training hours:

```
adjusted_required_shifts = base_required × (active_months / total_months)
```

For example, a requirement of 8 shifts per quarter for a member with 1 month of leave becomes `8 × (2/3) = 5.3`, rounded to **6 shifts required**.

> For full details on leave adjustments, see [Membership > Leave of Absence](./01-membership.md#leave-of-absence) and [Training > Compliance Matrix](./02-training.md#compliance-matrix).

---

## Realistic Example: Setting Up a 24/48 Platoon Rotation

This walkthrough demonstrates a complete scheduling setup — from template creation through a full month of generated shifts — using a realistic fire department scenario.

### Background

**Oakville Fire Department** is transitioning from a paper schedule to The Logbook. Captain **Mike Reilly** (Scheduling Officer) needs to set up a 3-platoon, 24/48 rotation for **Station 1** starting April 1. The station runs one engine (Engine 1) with a minimum crew of 4 per shift.

The three platoons are:
- **A Platoon** — Lt. Davis, FF Carter, FF Nguyen, FF Patel
- **B Platoon** — Lt. Morrison, FF Brooks, FF Kim, FF Walsh
- **C Platoon** — Lt. Hernandez, FF Cooper, FF Yamada, FF Schmidt

---

### Part 1: Creating the Shift Template

Capt. Reilly navigates to **Shift Scheduling > Shift Templates** and clicks **Create Template**.

**Template settings:**

| Field | Value |
|-------|-------|
| **Name** | Station 1 — 24-Hour Shift |
| **Start Time** | 07:00 |
| **End Time** | 07:00 (next day) |
| **Duration** | 24 hours |
| **Apparatus** | Engine 1 |
| **Minimum Staffing** | 4 |
| **Required Positions** | 1 Officer, 1 Driver/Operator, 2 Firefighter |

He saves the template. It now appears in the templates list and can be reused for any 24-hour shift at Station 1.

---

### Part 2: Generating the April Schedule

Next, Capt. Reilly navigates to **Shift Scheduling > Shift Templates** and clicks **Create Pattern**.

**Pattern settings:**

| Field | Value |
|-------|-------|
| **Pattern Type** | Platoon |
| **Template** | Station 1 — 24-Hour Shift |
| **Start Date** | April 1 |
| **End Date** | April 30 |
| **Days On** | 1 |
| **Days Off** | 2 |
| **Starting Platoon** | A Platoon |

He clicks **Generate Shifts**. The system creates 30 shifts (one per day) and presents a preview:

```
April Schedule Preview — Station 1

  Sun   Mon   Tue   Wed   Thu   Fri   Sat
              1(A)  2(B)  3(C)  4(A)  5(B)
  6(C)  7(A)  8(B)  9(C)  10(A) 11(B) 12(C)
  13(A) 14(B) 15(C) 16(A) 17(B) 18(C) 19(A)
  20(B) 21(C) 22(A) 23(B) 24(C) 25(A) 26(B)
  27(C) 28(A) 29(B) 30(C)
```

Each platoon works every third day — A Platoon works April 1, 4, 7, 10, 13, 16, 19, 22, 25, 28 (10 shifts). B and C each also work 10 shifts.

Capt. Reilly reviews the preview to confirm the rotation looks correct, then clicks **Confirm** to create all 30 shifts on the calendar.

---

### Part 3: Assigning Members to Platoons

With shifts generated, Capt. Reilly assigns members. He opens the first A Platoon shift (April 1) from the calendar:

1. Clicks **Add Assignment** — assigns **Lt. Davis** as Officer
2. Clicks **Add Assignment** — assigns **FF Carter** as Driver/Operator
3. Clicks **Add Assignment** — assigns **FF Nguyen** as Firefighter
4. Clicks **Add Assignment** — assigns **FF Patel** as Firefighter

The staffing indicator changes from "0/4 — Below Minimum" (red) to "4/4 — Fully Staffed" (green).

Because these members work all A Platoon shifts, Capt. Reilly can use bulk assignment to apply the same crew to all A Platoon dates in one action, then repeat for B and C Platoons.

Each assigned member receives a notification and sees the shift on their **My Shifts** tab.

---

### Part 4: Handling a Swap Request

On April 8, FF Brooks (B Platoon) needs to swap with FF Nguyen (A Platoon) for April 10:

1. FF Brooks navigates to **Requests > Request Swap**
2. Selects his shift (April 8, B Platoon) and the target shift (April 10, A Platoon)
3. Submits the swap request

FF Nguyen receives a notification and clicks **Accept**. Capt. Reilly reviews and clicks **Approve**. The system automatically updates the assignments:
- April 8: FF Nguyen now works (instead of FF Brooks)
- April 10: FF Brooks now works (instead of FF Nguyen)

Both members see the updated schedule on their My Shifts tab.

---

### Part 5: End-of-Month Compliance Check

At the end of April, Capt. Reilly navigates to **Shift Scheduling > Reports > Compliance**.

The department has an active training requirement: **"Minimum 8 shifts per month"** (type: SHIFTS, frequency: Monthly).

The compliance report for April shows:

| Member | Required Shifts | Completed | Compliance | Status |
|--------|----------------|-----------|------------|--------|
| Lt. Davis | 8 | 10 | 125% | Compliant |
| FF Carter | 8 | 10 | 125% | Compliant |
| FF Nguyen | 8 | 10 | 125% | Compliant |
| FF Patel | 8 | 10 | 125% | Compliant |
| Lt. Morrison | 8 | 10 | 125% | Compliant |
| FF Brooks | 8 | 10 | 125% | Compliant |
| FF Kim | 8 | 10 | 125% | Compliant |
| FF Walsh | 8 | 10 | 125% | Compliant |
| Lt. Hernandez | 8 | 10 | 125% | Compliant |
| FF Cooper | 8 | 10 | 125% | Compliant |
| FF Yamada | 8 | 10 | 125% | Compliant |
| FF Schmidt | **4** (LOA) | 5 | 125% | Compliant |

FF Schmidt was on a 2-week Leave of Absence (April 1-14), so his requirement was pro-rated from 8 to 4 shifts. He completed 5 shifts in his active period and is marked Compliant.

> **Hint:** The compliance data automatically feeds into the Training module's Compliance Matrix. Members and training officers see the same numbers in both places — there is no need to manually enter shift data into training records.

---

## Position Eligibility & Equipment Checks (2026-03-19)

### Shift Position Eligibility

Operational ranks now define which shift positions each rank is eligible for. When members sign up for open shifts, they only see positions their rank qualifies for.

**Setting up eligible positions:**

1. Navigate to **Settings > Operational Ranks**.
2. For each rank, select the eligible positions using the toggle matrix.
3. Save. Existing ranks are backfilled with default eligible positions.

> **Screenshot needed:**
> _[Screenshot of the Settings > Operational Ranks page showing the eligible positions matrix — a grid with ranks on the left (Chief, Captain, Lieutenant, Firefighter, Probationary) and position types across the top (Officer, Driver, Firefighter, EMT), with toggles for each combination]_

**How it affects shift signup:**

- The Dashboard's open shifts section only shows the **Sign Up** button for shifts where the member's rank qualifies for at least one open position
- When clicking Sign Up, only eligible positions appear in the dropdown
- Ranks with no `eligible_positions` defined default to all positions being eligible (backward-compatible)

> **Screenshot needed:**
> _[Screenshot of the Dashboard "Open Shifts" section showing shift cards — one with a "Sign Up" button (member is eligible) and one without (member's rank doesn't qualify for remaining open positions)]_

### Scheduling Admin Pages

Admin functionality has been extracted into dedicated pages for better navigation:

| URL | Page | What It Does |
|-----|------|-------------|
| `/scheduling/templates` | Templates | Manage shift templates |
| `/scheduling/patterns` | Patterns | Create and manage shift patterns |
| `/scheduling/reports` | Reports | View hours, coverage, and compliance reports |
| `/scheduling/settings` | Settings | Configure scheduling rules and preferences |

Each page has back navigation to the main scheduling hub. Access requires `scheduling.manage` permission.

> **Screenshot needed:**
> _[Screenshot of one of the scheduling admin sub-pages (e.g., Templates) showing the page header with back navigation arrow, and the content area below]_

### Equipment Check System

The Equipment Check system allows structured, shift-based vehicle and equipment inspections. It consists of three parts: template building, check submission, and reporting.

#### For Administrators: Building Templates

Navigate to **Scheduling > Settings > Equipment** to see the template list, then click **Create Template** to open the template builder.

1. Set the template name, timing (start or end of shift), and type (equipment, vehicle, or combined)
2. Optionally assign to a specific apparatus or apparatus type
3. Optionally restrict to specific positions (e.g., only Driver/Operator sees this checklist)
4. Add **compartments** — named sections representing physical areas (e.g., "Officer Door Entry", "Pump Panel", "Cab Interior")
5. Within each compartment, add **items** with one of 7 check types:

| Check Type | What It Records | Example |
|-----------|----------------|---------|
| **Pass/Fail** | Binary pass or fail | "Fire extinguisher pin intact" |
| **Present** | Item is present or missing | "Traffic cones (6)" |
| **Functional** | Item works or doesn't | "PA system" |
| **Quantity** | Numeric count | "SCBA bottles — required: 4" |
| **Level** | Fill level with unit | "Fuel — gallons" |
| **Date/Lot** | Expiration date and lot number | "EpiPen — exp: 2026-09" |
| **Reading** | Numeric reading with unit | "Pump engine hours — hours" |

6. Items can track serial numbers, lot numbers, expiration dates (with warning windows), and required quantities
7. Use **drag-and-drop** to reorder compartments and items
8. Use **vehicle check presets** to import common inspection categories for engine, ladder, or ambulance types

> **Screenshot needed:**
> _[Screenshot of the Equipment Check Template Builder showing the template header (name, timing, type), a compartment ("Cab Interior") expanded with several check items of different types (pass/fail, quantity, date/lot), and the drag-handle icons for reordering]_

> **Screenshot needed:**
> _[Screenshot of the vehicle check preset picker showing preset categories (Engine, Ladder, Ambulance) with preview of included compartments and items]_

#### For Members: Submitting Equipment Checks

During a shift, members see pending equipment checks on their dashboard or via **Scheduling > My Checklists**.

1. Open the checklist for your current shift
2. Work through each compartment and item:
   - **Pass/Fail**: Tap pass or fail
   - **Quantity**: Enter the count
   - **Level**: Enter the level reading
   - **Date/Lot**: Verify expiration date and lot number
   - **Reading**: Enter the reading value
3. Optionally attach photos to any item (up to 3 per item)
4. Submit the completed check

> **Screenshot needed:**
> _[Screenshot of the equipment check form on a mobile device showing a compartment heading, several check items with pass/fail toggle buttons, a quantity field, and the photo attachment button]_

**Auto-fail rules:**
- Items with `has_expiration: true` and a past expiration date auto-fail regardless of the submitted result
- Items below the `required_quantity` auto-fail
- A single failed item marks the entire apparatus as **deficient** — the apparatus record shows a deficiency badge until a subsequent full check passes all items

#### For Officers: Reports

Navigate to **Scheduling > Equipment Check Reports** to view three report tabs:

| Tab | What It Shows |
|-----|-------------|
| **Compliance Dashboard** | Pass rates by apparatus, member compliance stats, check frequency |
| **Failure/Deficiency Log** | Paginated list of failed items with filters by apparatus, date, and check type |
| **Item Trend History** | Pass/fail trends over time by interval (daily, weekly, monthly) |

Reports can be exported as **CSV** or **PDF**.

> **Screenshot needed:**
> _[Screenshot of the Equipment Check Reports page showing the Compliance Dashboard tab with apparatus cards showing pass rates (e.g., "Engine 1: 98% pass rate"), and the tab bar showing Compliance / Failures / Trends]_

#### Equipment Check Edge Cases

| Scenario | Behavior |
|----------|----------|
| No template assigned to apparatus | No checklist appears for that shift |
| Position-based template | Only members in assigned positions see the checklist |
| Expired item submitted as "Pass" | Auto-fails with "expired" reason |
| Item below required quantity | Auto-fails with "under required quantity" reason |
| All items pass | Clears apparatus deficiency flag if previously set |
| Photo upload | Max 3 per item, max 10 MB each, auto-converted to WebP |
| Template cloning | Deep clones compartments and items to another apparatus |
| Serial/lot number update | Submitting new serial/lot updates the template item for future reference |

### Shift Finalization *(2026-03-28)*

After a shift ends, officers finalize the shift to lock in data and trigger training pipeline integration.

#### How to Finalize a Shift

1. Open the **Shift Detail Panel** for a past, un-finalized shift
2. Click **"Finalize Shift"** — a pre-finalization checklist modal appears

> **[SCREENSHOT NEEDED]:** _Screenshot of the pre-finalization checklist modal showing the equipment check validation status (green checkmark or red X), attendance count, call count, and the Finalize button at the bottom._

3. The checklist validates:
   - **End-of-shift equipment checks** must be completed (blocks finalization if incomplete)
   - Attendance summary and call count shown for reference
4. Click **Finalize** to confirm

#### What Happens on Finalization

| Action | Description |
|--------|-------------|
| **Data snapshots** | `call_count` and `total_hours` frozen on the shift record |
| **Per-member call counts** | Each member's individual call participation count computed from ShiftCall records and stored on their ShiftAttendance record |
| **Shift locked** | `is_finalized=true`, `finalized_at` timestamp, `finalized_by` officer ID set |
| **Draft reports created** | ShiftCompletionReport drafts auto-created for all attendees with active training program enrollments |
| **Notification sent** | Officer receives notification with count of drafts created |

After finalization, a green badge shows "Shift finalized on [date]".

> **[SCREENSHOT NEEDED]:** _Screenshot of the ShiftDetailPanel after finalization showing the green "Finalized" badge with timestamp and the locked state (no edit buttons)._

#### Shift Finalization Edge Cases

| Scenario | Behavior |
|----------|----------|
| End-of-shift equipment checks incomplete | Finalization blocked; Finalize button disabled with tooltip explaining why |
| Start-of-shift checks incomplete | Does not block finalization |
| Shift has not ended yet | Finalize button not shown for future/in-progress shifts |
| Already finalized shift | Finalize button replaced with finalized badge |
| Editing a finalized shift | Blocked — edit controls hidden after finalization |
| Deleting a finalized shift | Blocked — returns "Cannot delete a finalized shift" error |
| Deleting a shift with completion reports | Blocked — returns "Cannot delete a shift with completion reports" error |
| Draft creation fails for one trainee | Error logged; remaining trainees still get draft reports |
| Attendee with no active enrollment | No draft created for that attendee |

### Shift Reports Settings *(2026-04-04)*

Navigate to **Scheduling > Settings > Shift Reports** to configure the shift completion report workflow. This settings tab connects the scheduling module to the training module and controls how officers file post-shift reports.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Shift Reports Settings tab showing three cards: "Checklist Timing" with start/end toggles, "Post-Shift Validation" with enable/require/window settings, and "Report Form Sections" with toggle switches._

#### Checklist Timing

| Setting | Default | Description |
|---------|---------|-------------|
| Start of shift enabled | On | Whether start-of-shift equipment checklists are prompted |
| End of shift enabled | On | Whether end-of-shift equipment checklists are prompted |

#### Post-Shift Validation

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | On | Whether post-shift validation reminders are sent |
| Require officer report | Off | Whether a shift completion report is mandatory after every shift |
| Validation window (hours) | 2 | How many hours after shift end validation reminders are active |

#### Report Form Section Toggles

Controls which optional sections appear on the shift completion report form when officers file reports. These are separate from the trainee visibility settings in Training Module Configuration.

| Section | Default | What Officers See |
|---------|---------|-------------------|
| Performance Rating | On | Star rating or descriptive scale |
| Areas of Strength | On | Free-text field for positive observations |
| Areas for Improvement | On | Free-text field for development areas |
| Officer Narrative | On | Extended assessment text area |
| Skills Observed | On | Checklist of demonstrated skills |
| Tasks Performed | On | Checklist of completed tasks |
| Call Types | On | Multi-select of incident types responded to |

> **[SCREENSHOT NEEDED]:** _Screenshot showing the "Report Form Sections" card with 7 toggle switches, some on (green) and some off (grey), demonstrating how officers can customize which sections appear when filing reports._

**When to toggle sections off:**
- Small volunteer departments may not need detailed skills tracking — toggle off Skills Observed and Tasks Performed
- Departments that don't track call types separately can toggle off Call Types
- If your department uses a separate evaluation system, toggle off Performance Rating
- Toggling off a section hides it completely from the report form; officers cannot enter data for hidden sections

#### Per-Apparatus-Type Skills and Tasks

Below the toggles, the settings panel shows apparatus-type-specific skill and task mappings. These determine which skills and tasks appear in the report form based on the shift's assigned apparatus.

1. Expand an apparatus type accordion (Engine, Ladder, Ambulance, Rescue, etc.)
2. View the current skills and tasks mapped to that type
3. Add new skills/tasks using the text input and "+" button
4. Remove skills/tasks by clicking the "×" button
5. Changes save when you click **Save** at the bottom of the settings panel

> **[SCREENSHOT NEEDED]:** _Screenshot of the per-apparatus skills/tasks accordion, with "Engine" expanded showing skills like "Pump operations", "Hose deployment", "Hydrant connection" and a text input with "+" button for adding new skills._

**How this connects to the report form:**
- Officer opens the report form for a trainee on an Engine shift
- The Skills Observed section pre-populates with engine-specific skills (pump ops, hose deployment, etc.)
- The Tasks Performed section pre-populates with engine-specific tasks
- Officer checks off which skills were demonstrated and which tasks were completed
- If the shift has no linked apparatus or the type has no mappings, org-wide defaults are used

#### Rating Scale Customization

| Setting | Default | Description |
|---------|---------|-------------|
| Rating Label | "Performance Rating" | Text shown above the rating input |
| Scale Type | Stars | "Stars" (1-5 star icons) or "Descriptive" (labeled buttons) |
| Scale Labels | (none) | Custom labels per level (e.g., 1="Needs Improvement", 5="Exceptional") |

> **[SCREENSHOT NEEDED]:** _Screenshot showing the rating scale customization section with a dropdown for scale type (Stars vs Descriptive), a text input for the rating label, and a table of 5 rows for custom labels per level._

#### Save as Draft

Officers can save incomplete reports as drafts by clicking **Save as Draft** instead of submitting:

- Drafts appear in the **Drafts** view of the Shift Reports tab
- No training pipeline progress is triggered for drafts
- Officers can return to complete drafts at any time
- On final submission, deferred pipeline progress is applied

#### Auto-Filter Trainee List

When filing a report linked to a specific shift, the trainee dropdown automatically shows only members assigned to that shift. This prevents filing reports for members who weren't on duty. For ad-hoc reports (no shift selected), the full member list is available.

#### Shift Report Settings Edge Cases

| Scenario | Behavior |
|----------|----------|
| All form sections toggled off | Core fields (trainee, date, hours, calls) remain; form is still submittable |
| Apparatus type with no mapped skills | Falls back to org-wide default skills; if none, section is empty |
| Save as draft with incomplete data | Saved; required field validation deferred to final submission |
| Trainee list with no shift linked | Full member list shown (ad-hoc mode) |
| Descriptive rating with no custom labels | Falls back to numeric display (1-5) |
| Trainee has shift assignment but no attendance | Auto-populate returns zeros; officer enters hours manually |
| Report shift_date doesn't match linked shift | Validation error returned |

---

### Structured Position Slots & Decline Handling

Shifts now define required and optional position slots. When a member declines or is removed from a shift:

- The system sends a decline notification
- The open slot becomes visible on the shift card for re-assignment
- Other eligible members can sign up for the vacated slot

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel showing position slots — some filled (with member name and green badge), one marked "Open" with a yellow badge, and an "Assign" button next to the open slot]_

### Additional Fixes (2026-03-19)

- **Dashboard shows only relevant shifts**: My Upcoming Shifts hides declined and cancelled assignments; Open Shifts hides shifts the user already signed up for
- **Shift signup re-enrollment**: Members who previously cancelled can re-sign up (cleanup of old cancelled assignment prevents constraint violation)
- **Attendee count accuracy**: Cancelled and no-show assignments no longer inflate the displayed count
- **Timezone fixes**: Fixed naive local times being sent as UTC when creating shifts from the scheduling page; fixed template-based generation ignoring org timezone

---

## Shift Permissions & Cleanup (2026-03-23)

### Permission Model

The scheduling module uses two separate permissions for different operations:

| Permission | Controls | Who Needs It |
|------------|----------|-------------|
| `scheduling.manage` | Shift CRUD (create, edit, delete shifts) | Shift officers, scheduling admins |
| `scheduling.assign` | Member assignments (assign, edit positions, remove from shift, edit notes) | Shift officers, crew chiefs |

A user with `scheduling.assign` but not `scheduling.manage` can assign members to existing shifts but cannot create or delete shifts. A user with `scheduling.manage` but not `scheduling.assign` can edit shift times and apparatus but must use the admin assignment flow to assign members.

Self-signup (the Sign Up button on open shifts) requires no special permission — all authenticated members can sign up for shifts they are eligible for.

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel showing the assignment controls (Assign Member dropdown, position change, remove button) visible to a user with scheduling.assign permission, and the Edit/Delete shift buttons visible only to a user with scheduling.manage permission]_

### Calls/Incidents Section

The Calls/Incidents placeholder section has been removed from the shift detail panel. This section previously displayed "Calls will appear here once the shift is underway" but there was no CAD integration to populate it. Call logging will be available once ePCR/NEMSIS import integration is implemented. Backend endpoints remain accessible at `POST /api/v1/scheduling/shifts/{id}/calls` for programmatic use.

---

## Template Positions & Timezone Fixes (2026-03-15)

### Template Positions Carry to Crew Roster

Shift templates now pass their position definitions and minimum staffing requirements through to created shifts. Previously, only the template's time and apparatus information were inherited — position assignments had to be set up manually on each shift.

When a shift is created from a template (either directly or via pattern-based generation), the template's `positions` and `min_staffing` values are copied to the new shift. In the `ShiftDetailPanel`, if the linked apparatus has no positions defined, the system falls back to the shift-level positions from the template.

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel crew roster showing position assignments inherited from a template, with position labels (Officer, Driver, Firefighter) and the min staffing indicator]_

### Timezone Display Fix

Two timezone display issues were corrected:

1. **Shift reports date filter**: The reports tab was comparing against UTC dates instead of the user's local date. For example, at 11 PM Eastern on March 14, the tab would show March 15 reports because UTC had already crossed midnight.

2. **Shift time editing**: When editing a shift, the start/end times displayed in the form were showing UTC values instead of local times. A shift starting at 2:30 PM Eastern appeared as 18:30 in the edit form.

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel edit form showing correctly localized start and end times (e.g., "14:30" for a 2:30 PM Eastern shift)]_

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Shifts created before this update | Position fields are empty; UI falls back to apparatus-level positions |
| Template edits after shift creation | Existing shifts keep original positions; only new shifts get updated values |
| Missing timezone data | Falls back to browser's local timezone |

---

## Shift Assignment & Scheduling Edge Cases

These edge cases describe system behavior during shift assignment, time-off approval, pattern generation, and staffing calculations.

### Shift Assignment Guards

| Scenario | Behavior |
|----------|----------|
| Member already assigned to this shift | Returns "Member is already assigned to this shift." Declined and cancelled assignments are excluded from this check — members can re-sign up after cancellation. |
| Overlapping shift on same day | System checks ±1 day for time conflicts. Returns "Member has a conflicting shift on [date]" with all conflict dates listed. |
| Shift has no end time | Overlap detection falls back to same-day check only — any assignment on the same date is flagged. |
| Member on active Leave of Absence | Returns "Member is on leave of absence for this date." Only the shift's date is checked, not the full time span. |
| First officer-position member assigned | If no shift officer is set, assigning an Officer, Captain, or Lieutenant auto-sets them as shift officer. Silent — no notification. |
| Shift officer changed to a different member | The previous officer-position assignment is automatically downgraded to `firefighter` position. No notification is sent for this displacement. |
| Database integrity violation on duplicate | A secondary `UNIQUE` constraint catches race conditions, returning the same "already assigned" message. |

### Time-Off Approval Side Effects

| Scenario | Behavior |
|----------|----------|
| Time-off request approved | All conflicting shift assignments within the time-off date range are auto-cancelled. The count is appended to reviewer notes (e.g., "2 conflicting assignments auto-cancelled"). |
| Time-off request for pending status only | Only pending requests can be reviewed. Attempting to review an already-approved/denied request returns "Time-off request is no longer pending." |
| Auto-cancelled assignments | Only `assigned` and `confirmed` statuses are cancelled. Already-declined or cancelled assignments are not touched. |

### Pattern Generation

| Scenario | Behavior |
|----------|----------|
| Weekly patterns and weekday convention | Weekly patterns use JavaScript convention (0=Sunday). Pattern configuration must use this format — Python convention (0=Monday) will produce shifts on the wrong day. |
| Overnight shifts (end before start) | If end time < start time after UTC conversion, end datetime is automatically pushed to the next day. |
| Platoon pattern with day/night entries | Maps to separate day/night `ShiftTemplate` records. If `day_template_id` or `night_template_id` is missing from config, falls back to the main template silently. |
| Duplicate shift detection | Compares against existing shifts by start time (UTC), not by date. Two templates with the same start time in different timezones could collide. |

### Staffing Calculations

| Scenario | Behavior |
|----------|----------|
| Shift has structured position slots | Understaffing is checked by matching filled positions against required slots (case-insensitive). |
| No structured positions defined | Falls back to comparing total headcount against `min_staffing` threshold. |
| Cancelled and no-show assignments | Excluded from attendee count. Only `assigned` and `confirmed` statuses count toward staffing. |

---

## Shift Report Enhancements *(2026-04-07)*

### 1-5 Skill Scoring

When filing shift completion reports, officers can now assign a **1-5 numeric score** to each observed skill. This score is separate from the "demonstrated" checkbox and provides a quantitative assessment of the trainee's proficiency.

| Score | Label | Color |
|-------|-------|-------|
| 1 | Needs work | Violet (muted) |
| 2 | Developing | Violet (muted) |
| 3 | Competent | Violet (standard) |
| 4 | Proficient | Violet (standard) |
| 5 | Excellent | Violet (bright) |

Scores appear as interactive buttons on the report form (with tooltip labels) and as inline text in read-only views. Scores flow through to `SkillCheckoff` records and the competency score history in the Training module.

> **[SCREENSHOT NEEDED]:** _Screenshot of the shift report form's skills section showing 3-4 skills, each with a row of 5 violet score buttons (1-5), the "demonstrated" checkbox, and a comment field. One skill should have score 4 selected (highlighted), another score 2._

### Batch Review

Officers with `training.manage` permission can now review multiple shift reports at once:

1. Navigate to the **Pending Review** or **Flagged** view in the Shift Reports tab
2. Check individual report cards using the checkbox on each card, or use the **select-all** toggle
3. Click **"Approve Selected"** or **"Flag Selected"** at the top of the list
4. In the batch review modal, optionally add **reviewer notes** (applied to all selected reports)
5. Confirm the action — the system processes up to 100 reports and returns a count of successfully reviewed vs. failed

> **[SCREENSHOT NEEDED]:** _Screenshot of the Pending Review view with 5 report cards visible, 3 checked with checkboxes, the select-all toggle shown, and "Approve Selected (3)" / "Flag Selected (3)" buttons visible at the top._

> **Hint:** Batch review does not support per-report field redaction. For reports requiring individual redaction, review them one at a time using the standard review modal.

### Flagged Reports View

Reports that reviewers flag for follow-up are now accessible from a dedicated **Flagged** tab in the Shift Reports section:

- View all flagged reports with their reviewer notes and flag date
- **Re-review** flagged reports — approve them to move to the Approved state, or add additional notes
- When a flagged report is approved, deferred pipeline progress is triggered if the report has an enrollment linkage

> **[SCREENSHOT NEEDED]:** _Screenshot of the Flagged tab showing 2-3 flagged report cards with red "Flagged" badges, reviewer notes visible, and a "Re-review" button on each card._

### Trainee & Officer Names on Report Cards

Report cards now display **trainee and officer names** alongside dates:

- Card header: "**Trainee Name** — April 5, 2026"
- Card footer: "Filed by **Officer Name** on April 6, 2026"
- Review modal: Shows shift date alongside trainee and officer names in the header

> **[SCREENSHOT NEEDED]:** _Screenshot of a shift report card showing "FF Carter — April 5, 2026" in the header, performance rating stars, hours/calls metadata, and "Filed by Lt. Davis" in the footer._

### Full Report Content in Review Modal

The review modal now displays the **complete report** so reviewers have full context when approving or flagging:

- Hours on shift, calls responded, call types
- Performance rating (with custom labels if configured)
- Areas of strength and improvement
- Officer narrative
- Skills observed (with scores and notes)
- Tasks performed (with descriptions)
- Trainee comments (if acknowledged)
- Requirements progressed (if enrollment linked)

> **[SCREENSHOT NEEDED]:** _Screenshot of the review modal showing the full report content in the top section (hours, rating, narrative, skills with scores) and the review controls (Approve/Flag buttons, reviewer notes textarea) in the bottom section._

### Skill Linkage Status in Settings

The **Shift Reports** settings panel (Scheduling > Settings > Shift Reports) now shows whether each apparatus-type skill matches a formal `SkillEvaluation` record in the Training module:

- **Green tag** with checkmark: Skill name matches a SkillEvaluation — scores will track competency, create checkoffs, and progress pipeline requirements
- **Amber tag** with warning: No matching SkillEvaluation — skill is observed on reports but won't flow into formal training tracking
- A **legend** at the bottom of the skills section explains the color coding

> **[SCREENSHOT NEEDED]:** _Screenshot of the Shift Reports settings panel's apparatus skills section (e.g., "Engine" expanded) showing 4 skills with green tags ("Pump operations" ✓, "Hose deployment" ✓) and 2 with amber tags ("Ladder placement" ⚠, "Custom skill" ⚠), plus the explanatory legend below._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Skill score outside 1-5 range via API | Rejected by Pydantic `Field(ge=1, le=5)` with 422 error |
| Batch review with >100 report IDs | Rejected by `max_length=100` constraint |
| Batch review with mix of valid/invalid IDs | Valid reports processed; `failed` count returned separately |
| Flagged report re-approved | Triggers deferred pipeline progress if enrollment linked |
| Skill name matching for linkage | Case-sensitive exact match against `SkillEvaluation.name` |
| No SkillEvaluation records in org | All apparatus-type skills show amber "unlinked" tags |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot sign up for an open shift | Check that you are logged in as an active member and the shift has not already been filled. |
| Shift assignment shows "Member is on leave" | The member has an active leave of absence covering the shift date. The leave must be deactivated before assigning. |
| Attendance hours not calculating | Ensure both check-in and check-out times are recorded. Duration is calculated automatically. |
| Generated shifts not appearing on calendar | Check the date range filter on the calendar. Generated shifts appear for the pattern's date range. |
| Swap request stuck in pending | Both the other member and an officer must act. Check with the other member first, then the reviewing officer. |
| Compliance report shows incorrect hours | Verify that attendance records have accurate check-in/out times. Only shifts with recorded attendance count. |
| Platoon rotation seems off by a day | Check the "Starting Platoon" setting when generating the pattern. If the wrong platoon is set for day 1, the entire rotation shifts. |
| Minimum staffing warning on a fully staffed shift | Verify all assigned members have confirmed their assignment. Pending assignments may not count toward the staffing total depending on your department's settings. |
| Shift hours not appearing in Training compliance | Attendance must be recorded (check-in and check-out). Shifts without attendance data contribute zero hours to training requirements. |
| Scheduling data not updating across tabs | The module uses a centralized Zustand store. Try refreshing the page. If the issue persists, clear browser cache. |
| Settings tab not showing | The Settings tab requires `scheduling.manage` permission. Contact your administrator. |
| "Too many attempts" on shift signup | Rate limiting may be active. Wait a few seconds and try again. |
| Cannot edit shift times after creation | Officers with `scheduling.manage` can now edit shift start/end times, apparatus, color, notes, and custom creation times from the shift detail panel. |
| Position change requires opening a modal | Use the new inline position change UI directly on the shift card to change a member's assigned position without navigating away. |
| Shift signup shows no positions | Your rank may not have eligible positions configured. Ask your administrator to check Settings > Operational Ranks. |
| Dashboard still shows cancelled shifts | Fixed 2026-03-19 — declined and cancelled assignments are now filtered from "My Upcoming Shifts". Pull latest. |
| Sign Up button not appearing for open shifts | Your rank may not be eligible for the remaining open positions. Check with your administrator. |
| Can see assignment controls but get 403 error | The shift detail panel now uses separate permissions: `scheduling.manage` for shift editing and `scheduling.assign` for member assignments. Ask your administrator to grant the appropriate permission. |
| Self-signup form missing on shift detail | Fixed 2026-03-23 — the self-signup form on non-apparatus shifts is no longer hidden behind a permission gate. All members can self-sign up for open shifts. |
| "Calls/Incidents" section missing from shift detail | Removed 2026-03-23 — the placeholder section was removed because there is no CAD integration to populate it. Call data will appear once ePCR/NEMSIS integration is implemented. |
| Equipment check template not appearing for shift | Template must be assigned to the shift's apparatus (or apparatus type) and your position must match the template's assigned positions. |
| Equipment check shows auto-fail on a working item | Check the item's expiration date — items past their expiration auto-fail regardless of submitted result. |
| Apparatus shows deficiency badge but check passed | A subsequent full check must pass ALL items to clear the deficiency flag. Partial checks don't clear it. |
| Equipment check photo won't upload | Photos must be JPEG, PNG, or WebP and under 10 MB. Max 3 photos per item. |
| Equipment check reports showing no data | Ensure at least one equipment check has been submitted. Check the date range filter. |
| Shift times showing in wrong timezone | Fixed 2026-03-19 — shift creation now converts local times to UTC using org timezone. Template-generated shifts also inherit correct timezone. |
| Cannot assign members to shifts | Fixed 2026-03-22 — assignment UI was gated by `scheduling.manage_assignments`; now works with `scheduling.manage`. |
| Sign Up button not appearing despite eligible rank | Fixed 2026-03-22 — Open Shifts tab fallback permission and self-signup visibility corrected. |
| Dashboard shows cancelled/declined shifts | Fixed 2026-03-22 — "My Upcoming Shifts" now filters out declined and cancelled assignments. |
| Barcode/QR scan not working on desktop | Fixed 2026-03-22 — scanning now falls back to user-facing camera on desktop browsers. |

---

## Permission Fixes & Shift Signup Improvements (2026-03-22)

### Shift Assignment Permission Update

The shift assignment UI previously required the `scheduling.manage_assignments` permission, which was more restrictive than intended. As of 2026-03-22, users with the broader `scheduling.manage` permission can assign members to shifts.

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel showing the "Add Assignment" button visible for a user with `scheduling.manage` permission, with the member dropdown and position selector]_

### Open Shifts Self-Signup Fix

The self-signup button visibility on the Open Shifts tab had a fallback permission issue where non-admin members couldn't see the Sign Up button even when their rank was eligible. This has been corrected.

> **Screenshot needed:**
> _[Screenshot of the Open Shifts tab showing shift cards with visible "Sign Up" buttons for an eligible non-admin member]_

### Dashboard Shift Display

The "My Upcoming Shifts" section on the dashboard now correctly filters out:
- Declined assignments (shifts you said "no" to)
- Cancelled assignments (shifts that were cancelled after you were assigned)

Only pending and confirmed assignments appear.

> **Screenshot needed:**
> _[Screenshot of the Dashboard "My Upcoming Shifts" section showing only pending (yellow badge) and confirmed (green badge) shifts, with no declined or cancelled entries]_

### Desktop Camera Scanning

Camera-based scanning (QR codes, barcodes, member IDs) now works on desktop browsers. The system automatically detects available cameras and falls back to a user-facing camera when no environment-facing camera is detected.

This affects:
- **MemberIdScannerModal** — scanning member ID cards during inventory checkout
- **InventoryScanModal** — scanning item barcodes for check-in/check-out
- **MemberScanPage** — scanning member QR codes for attendance

> **Screenshot needed:**
> _[Screenshot of the MemberIdScannerModal running on a desktop browser, showing the user-facing camera feed in the scanner viewport with a QR code being detected]_

### Edge Cases (2026-03-22)

| Scenario | Behavior |
|----------|----------|
| Desktop with no camera | Scanner shows error message; manual entry still available |
| Desktop with only webcam | Falls back to user-facing camera automatically |
| Multiple cameras on desktop | Prefers environment-facing, then user-facing |
| Shift detail panel Calls/Incidents section | Removed — feature not yet implemented |

---

## Bulk Actions, Staffing Visualization & Shift Notifications (2026-03-24)

### Bulk Confirm/Decline on My Shifts

When you have 2 or more pending shift assignments, checkboxes appear on each pending shift card. You can:

1. **Select individual shifts** by tapping checkboxes
2. **Select All** using the toggle at the top of the pending section
3. **Confirm All** or **Decline All** using the bulk action buttons

The UI updates immediately (optimistic update). If the API call fails for any shift, that shift reverts to its previous state and a toast notification shows the error.

> **Screenshot needed:**
> _[Screenshot of the My Shifts tab showing 3 pending shift cards with checkboxes selected, the "Select All" toggle enabled, and the "Confirm All" / "Decline All" bulk action buttons visible in the action bar above]_

> **Edge case:** If you select 5 shifts and "Confirm All" but one fails (e.g., shift was cancelled by an officer), that one reverts to pending while the other 4 remain confirmed.

### Inline Approve/Deny on Requests

Swap and time-off request cards now show **Approve** and **Deny** buttons directly on the card, without needing to open a modal. A "+ Notes" link is still available to open the review modal if you want to add reviewer comments.

> **Screenshot needed:**
> _[Screenshot of the Requests tab showing a swap request card with inline "Approve" (green) and "Deny" (red) buttons, and a "+ Notes" link below them]_

### Staffing Status on Shift Cards

Shift cards now show staffing status at a glance:

| Visual | Meaning |
|--------|---------|
| Green CheckCircle2 icon | Shift is fully staffed |
| Green background in crew info | All positions filled |
| Amber background in crew info | Below minimum staffing |
| Staffing ratio (e.g., "4/4") | Filled / required positions |
| Green tint on shift card | Overrides template color when fully staffed |
| Amber tint on shift card | Overrides template color when understaffed |

> **Screenshot needed:**
> _[Screenshot of the weekly calendar view showing three shift cards: one with green tint and CheckCircle2 (fully staffed, 4/4), one with amber tint (understaffed, 2/4), and one with template color (no min staffing configured)]_

### Position-First Assignment Flow

The crew board in the shift detail panel now uses a position-first workflow:

1. **Position dropdown** appears first (defaults to the first open slot)
2. **Member search** appears below
3. Click **Assign** to complete

You can also click the **"Assign"** button directly on an open slot in the crew board to pre-fill the position.

**Bulk Assignment:** When 2+ positions are unfilled, a **"Fill All Open"** button appears. This shows a compact form with one member dropdown per open position, letting you fill all positions at once.

> **Screenshot needed:**
> _[Screenshot of the ShiftDetailPanel crew board showing two filled positions (with member names and green badges), one open slot with an "Assign" button, and the "Fill All Open" button at the bottom]_

> **Edge case:** Members on leave, with approved time-off covering the shift date, or already assigned to the shift are automatically excluded from the member dropdown.

### Required/Optional Position Toggle

In the shift template editor, each crew position now has a **required/optional toggle**:

- **Required** (violet badge) — the position must be filled for minimum staffing
- **Optional** (muted) — position is available but not counted toward minimum staffing

> **Screenshot needed:**
> _[Screenshot of the ShiftTemplatesPage position editor showing 4 positions: "Officer" and "Driver" with violet required badges, "Firefighter" with a muted optional badge, and the toggle switch next to each]_

> **Edge case:** Existing templates with bare string positions (created before this update) default to `required=true` automatically.

### Shift Assignment Notifications

When an officer assigns you to a shift, you now receive:

- **In-app notification** with the shift date, time (in your organization's timezone), and position
- **Optional email notification** (if enabled by your department)

Officers can configure these in **Settings > Scheduling > Notifications > Shift Assignment Alerts**.

> **Screenshot needed:**
> _[Screenshot of the SchedulingNotificationsPanel showing the "Shift Assignment Alerts" section with toggles for "Notify on assignment" (enabled), "Send email" (enabled), and a CC email input field]_

### Start-of-Shift Reminders

A scheduled task runs every 30 minutes to send reminders to members assigned to upcoming shifts:

- Reminders include the shift time, position, apparatus, and a list of equipment checklists to complete
- Configurable lookahead window (default: 2 hours before shift start)
- Optional email in addition to in-app notification

Department settings for reminders are under **Settings > Scheduling > Notifications > Start-of-Shift Reminders**.

> **Screenshot needed:**
> _[Screenshot of the SchedulingNotificationsPanel showing the "Start-of-Shift Reminders" section with toggles for "Enable reminders" (enabled), a "Lookahead" dropdown set to "2 hours", "Send email" (disabled), and a CC email field]_

> **Edge case:** A shift that has already started is skipped. Reminders are sent only once per shift (tracked via `activities.start_reminder_sent`).

### Selected Shift Highlight

When you open a shift's detail panel, the corresponding shift card on the calendar is highlighted with a **violet ring**. This helps you see which shift you're viewing, especially in dense calendar views.

### Additional UX Improvements (2026-03-24)

- **Collapsible shift creation**: The shift creation form now shows only Start Date and End Date initially. Custom Times, Apparatus, Officer, and Notes are hidden behind an "Additional Options" disclosure section
- **Searchable template dropdown**: When your department has more than 5 templates, a search field appears in the template dropdown
- **Open/Specific swap selector**: Two-card radio buttons instead of a single dropdown for selecting swap type
- **Time-off conflict warning**: An amber banner appears on the shift detail if you have approved time-off covering the shift dates
- **Notification history link**: An "Alerts" link on the My Shifts tab shows your scheduling-related notifications
- **Equipment check status**: Badge counts (pass/fail/in-progress/pending) appear next to the equipment check header on shift detail, with action hints like "Start check → Go to Checklists tab"
- **Mobile note truncation**: Shift notes on calendar cards show 2 lines with ellipsis instead of 1 line
- **Mobile touch targets**: All action buttons increased to 44px minimum (WCAG standard)

### Bug Fixes (2026-03-24)

| Issue | Solution |
|-------|----------|
| Shift overlap false positive — night shift flagged as conflicting with next day's open shift | Open-ended shifts now restricted to same date; no cross-day false positives |
| Shift notifications showing UTC time (e.g., "22:00" instead of "18:00 Eastern") | Times converted to org timezone before formatting |
| All shifts appearing as indigo on calendar despite custom template colors | Color parsing fixed — extracts hour from time portion, not full ISO string |
| Clearing shift notes causes 422 error | Empty notes converted to `undefined` via `\|\|` instead of `??` |
| "Fill pattern" 422 error on shift generation | Removed redundant `pattern_id` from request body |
| Member hours report showing empty data | Now queries `ShiftAssignment` instead of `ShiftAttendance` (clock-in records) |
| Member hours report missing names | `first_name` and `last_name` added to report schema |
| Dark mode buttons hard to read | Added proper `dark:` color variants on all interactive elements |
| Shift card text unreadable against colored background in dark mode | WCAG AA contrast calculation dynamically adjusts text color |

---


## Notification Cards, Deep-Linking & Standalone Equipment Checks (2026-03-26)

### Expandable Notification Cards

Shift-related notifications now use expandable cards that show a summary preview when collapsed and full details when expanded. Key behaviors:

- **Pinned-first sorting**: Pinned notifications always appear at the top of the list
- **Mark as read on collapse**: Notifications are only marked as read when you collapse the card, not when you first open it — this prevents accidental mark-as-read from quick glances
- **Contextual action buttons**: Each notification type shows relevant action buttons (e.g., "View Shift" for assignment notifications, "Start Checklist" for equipment check reminders)

> **Screenshot needed:**
> _[Screenshot of the notification inbox showing two notification cards: one collapsed showing summary text with a pin icon and "View Shift" button, and one expanded showing full notification details with "Start Checklist" and "Dismiss" buttons]_

### Scheduling Page Deep-Linking

The scheduling page now supports `?tab=` query parameters for direct navigation to specific tabs:

| Parameter | Tab |
|-----------|-----|
| `?tab=schedule` | Schedule (calendar) |
| `?tab=my-shifts` | My Shifts |
| `?tab=open-shifts` | Open Shifts |
| `?tab=requests` | Requests |
| `?tab=equipment-checks` | Equipment Checks |

Shift notifications automatically deep-link to the correct tab. For example, clicking a shift assignment notification opens the scheduling page with My Shifts selected and the shift highlighted.

> **Screenshot needed:**
> _[Screenshot of the browser URL bar showing `/scheduling?tab=equipment-checks` and the Equipment Checks tab selected on the scheduling page]_

### Standalone Equipment Checks

Equipment checks are no longer tied exclusively to active shifts. Members can now perform ad-hoc checks on any apparatus at any time:

1. Navigate to **Scheduling > Equipment Checks** tab
2. Select the apparatus to check
3. Complete the checklist as normal
4. Submit — the check is saved without a shift association and appears in reports as "ad hoc"

> **Screenshot needed:**
> _[Screenshot of the Equipment Checks tab showing a list of apparatus with "Start Check" buttons, and one apparatus with a recent check timestamp and pass/fail badge]_

### Flat Scrollable Check Form

The equipment check form has been redesigned from a tabbed compartment view to a single flat scrollable page:

- All compartments are displayed inline with clear section headers
- Sub-compartments are merged under their parent compartment heading
- Section headers (items with `is_header: true`) appear as bold black labels for visual grouping — they have no pass/fail controls and are not scored

> **Screenshot needed:**
> _[Screenshot of the flat equipment check form on a mobile device showing a compartment header ("Cab Interior"), a section header in bold ("Safety Equipment"), and several check items below with pass/fail buttons and quantity fields]_

### Text Check Type

The "Text" check type has been changed from a free-form text input to a read-only statement display. This is used for instructional text or safety reminders within checklists:

- The text appears as a styled statement in the check form
- Members read it but do not need to enter any response
- Text items are not included in pass/fail scoring

Example: "Verify all compartment doors are secure before moving apparatus"

### Critical Minimum Quantity

Quantity-type check items now support a `critical_minimum_quantity` threshold:

- When the count falls below this value, the item is flagged as **critical** (red warning) even if above the required minimum
- Useful for items where a certain threshold triggers a restock alert (e.g., "4 SCBA bottles required, critical if below 2")

> **Edge case:** Critical minimum must be ≤ required minimum. Validation enforced when saving the template.

### In-Process Scheduled Task Runner

The backend now includes a built-in asyncio task runner in `main.py` that handles:

- Start-of-shift reminders (30-minute intervals)
- Notification cleanup
- Other periodic maintenance tasks

This replaces the need for external cron jobs. Tasks resume automatically on container restart with idempotent checks to prevent duplicate sends.

### Edge Cases (2026-03-26)

| Scenario | Behavior |
|----------|----------|
| Notification with no metadata | Card renders in basic mode without deep-link buttons |
| `?tab=invalid-name` in URL | Falls back to Schedule (calendar) tab |
| Standalone check with no shift | Saved as "ad hoc"; included in compliance reports |
| Section header in check scoring | Not scored — excluded from pass/fail calculations |
| Template clone with section headers | Headers and critical_minimum_quantity preserved |
| App restart during scheduled task window | Tasks resume; idempotent checks prevent duplicate notifications |

---

## EVOC Certification & Position Validation (2026-03-24)

### EVOC Certification Levels

EVOC (Emergency Vehicle Operations Course) certification levels are now integrated across training, apparatus, and scheduling:

1. **Member profiles** track EVOC level (Basic, Intermediate, Advanced)
2. **Apparatus records** specify required EVOC level for operators
3. **Scheduling** validates EVOC certification when assigning members to driver/operator positions

When assigning a member to a Driver/Operator position, the system checks the apparatus's required EVOC level against the member's certification. If the member's level is insufficient, a warning is displayed.

> **Screenshot needed:**
> _[Screenshot of a member's profile showing EVOC certification level (e.g., "EVOC Level: Advanced") alongside other certifications]_

> **Screenshot needed:**
> _[Screenshot of the apparatus detail page showing the "Required EVOC Level" field set to "Intermediate"]_

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| EVOC not set for member | Can be assigned to driver position but warning shown |
| Apparatus with no required EVOC level | No validation on driver assignments |
| Member with expired EVOC certification | Warning shown; assignment still allowed |

---

## Shift Report Creation Redesign — Shift-First Batch Workflow (2026-04-07)

The shift report creation flow has been completely redesigned. Instead of creating one report at a time per trainee, officers now use a **shift-first batch workflow** that processes the entire crew at once.

### How It Works

1. Navigate to **Shift Reports** and click **New Report**
2. **Select a shift** from the dropdown — the system loads all crew members assigned to that shift
3. Fill in **shared data** once: hours on shift, calls responded, and call types. These values apply to all crew members
4. For each **trainee** on the crew, expand their evaluation panel to add:
   - Performance rating (1-5)
   - Skills observed with individual 1-5 scores
   - Tasks performed
   - Areas of strength and areas for improvement
   - Officer narrative
5. **Non-trainees** (members without active training program enrollments) appear in the crew list but only receive hours/calls credit — no evaluation section is shown for them
6. Click **Submit All** to create reports for all crew members in a single batch

> **[SCREENSHOT NEEDED]:** _Screenshot of the batch report creation form showing: (1) the shift selector dropdown at top with a selected shift, (2) the shared data section with hours, calls, and call type fields, (3) the crew list below with two trainees expanded showing evaluation fields and one non-trainee showing only hours/calls credit._

> **[SCREENSHOT NEEDED]:** _Screenshot of the submission confirmation showing "Created 5 reports, skipped 1" result after a batch submission._

### Task Defaults Pre-Population

When the selected shift is linked to an apparatus type (e.g., Engine, Ladder, Ambulance), the **Add Task** dialog pre-populates from the apparatus-type task mapping configured in **Scheduling > Settings > Shift Reports**. After selecting a task, the defaults remain visible for reference.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Add Task dialog showing pre-populated tasks from the engine apparatus type mapping (e.g., "Pump test", "Hose load inventory") with an "Add Custom" option at the bottom._

### Score Labels

The 1-5 skill score buttons now display descriptive label text inline next to each button:

| Score | Label |
|-------|-------|
| 1 | Needs work |
| 2 | Developing |
| 3 | Competent |
| 4 | Proficient |
| 5 | Excellent |

> **[SCREENSHOT NEEDED]:** _Screenshot of the skills section in the evaluation panel showing three skills with 1-5 score buttons, each button labeled with its descriptive text (e.g., "3 — Competent" highlighted for "Pump Operations")._

### Review Workflow Improvements

- **Require reason when flagging**: When flagging a report, the modal now requires entering a reason before submission. The "Flag" button is disabled until text is entered. This ensures trainees always receive feedback when a report is flagged
- **Reviewer name displayed**: Report cards show the reviewer's full name next to the review status badge (e.g., "Approved by Lt. Davis")
- **Flagged report explanation**: Flagged reports show the reviewer's reason and a "Re-review" action in all view modes — not just in the dedicated Flagged tab
- **Actual server error messages**: Toast notifications now display the server's error message instead of generic text like "Failed to submit", improving troubleshooting

> **[SCREENSHOT NEEDED]:** _Screenshot of a flagged report card showing the orange "Flagged" badge, the reviewer name, the reason text, and the "Re-review" button._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Batch create with mix of trainees and non-trainees | Non-trainees get hours/calls only; no evaluation data |
| Reports already exist for some crew | Existing reports skipped; `skipped` count returned |
| All sections toggled off in settings | Only core fields (trainee, shift, hours, calls) on form |
| Task defaults after apparatus type change | Defaults update to match the new apparatus type |
| Flagging without entering a reason | Modal blocks submission until text is provided |

---

## Shift Report Offline Support (2026-04-08)

### Draft Auto-Save

When filling out a shift report, your form data is **automatically saved to local storage** as you work. This prevents data loss from:

- Connectivity drops during field operations
- Accidental browser tab closure or page navigation
- Browser crashes or device restarts

The auto-save stores your shift selection, all form fields, crew selections, individual trainee evaluations, and crew remarks. Up to 20 drafts are retained — when the limit is reached, the oldest draft is evicted.

When you return to the shift reports form, any existing draft for the selected shift is automatically loaded, so you can pick up where you left off.

### Offline Submission Queue

If your device loses connectivity while submitting a batch of shift reports, the reports are **queued locally** and automatically submitted when connectivity returns:

1. You click "Submit All" while offline
2. A toast notification confirms the reports have been queued
3. When connectivity returns, queued reports are submitted automatically in order
4. A notification confirms successful submission

This uses the same IndexedDB-backed architecture as the equipment check offline queue, ensuring reliable offline-to-online synchronization.

> **[SCREENSHOT NEEDED]:** _Screenshot showing the offline indicator banner at the top of the shift reports page, a "Queued for sync" badge on a pending report, and the count of pending reports._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Browser closed with unsaved form | Auto-saved draft restored on next visit |
| 21st draft saved | Oldest draft evicted (LRU policy) |
| Connectivity restored with queued reports | Queue drains automatically; no duplicates |
| Same shift submitted online and offline | Duplicate detection on the server; skipped reports counted |

---

## Shift Report Print Page (2026-04-08)

A new **print-formatted page** renders shift completion reports for paper output at `/scheduling/shift-reports/print`.

### What's Included on the Printed Report

- **Header**: Department name and logo
- **Shift information**: Date, start/end time, apparatus, station
- **Personnel**: Trainee name and rank, filing officer name and rank
- **Performance data**: Hours on shift, calls responded, call types, performance rating with label
- **Assessment**: Areas of strength, areas for improvement, officer narrative
- **Skills observed**: Each skill with its 1-5 score and descriptive label
- **Tasks performed**: Each task with description
- **Reviewer information** (if reviewed): Reviewer name, review date, review status
- **Signature lines**: Spaces for officer and trainee signatures at the bottom

The page is formatted for **letter-size (8.5" × 11")** printing and automatically opens the browser's print dialog after loading.

### How to Print a Report

1. Navigate to **Shift Reports** and find the report you want to print
2. Click the **Print** button on the report card
3. The print page opens in a new tab with the formatted report
4. Your browser's print dialog opens automatically — select your printer and print

> **[SCREENSHOT NEEDED]:** _Screenshot of the print-formatted shift report showing the letter-size layout with department branding header, structured sections, and signature lines at the bottom._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Report with redacted fields | Printed as "[Redacted]" |
| Report with all optional sections off | Only core fields printed |
| Browser blocks auto-print dialog | Page remains visible for manual Ctrl+P |

---

## Equipment Check Improvements (2026-04-07)

### Incomplete Checklist Warning

When submitting an equipment check with unanswered items, a **confirmation dialog** now warns about the incomplete state before allowing submission. The dialog shows the count of unanswered items and asks the member to confirm.

This prevents accidental submission of partially completed checks while still allowing intentional partial submissions (e.g., when an item is not accessible).

> **[SCREENSHOT NEEDED]:** _Screenshot of the confirmation dialog showing "3 items not answered" warning with "Go Back" and "Submit Anyway" buttons._

### Resuming In-Progress Checks

Previously, if you started an equipment check but couldn't finish it, the check was stuck in an incomplete state. Now:

1. Navigate to **Scheduling > My Checklists**
2. In-progress checks show a **"Resume"** button alongside the completion percentage (e.g., "Resume — 65% complete")
3. Click Resume to open the check form with previously answered items pre-filled
4. Complete the remaining unanswered items and submit

> **[SCREENSHOT NEEDED]:** _Screenshot of the My Checklists page showing two checklists: one completed (green checkmark) and one in-progress with "Resume — 65% complete" button and a progress bar._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Resume check after template items added | New items appear as unanswered alongside pre-filled items |
| Resume check after template items removed | Orphaned answers preserved but flagged |
| Submit with 0 items answered | Confirmation dialog warns; still allowed |

---

**Previous:** [Training & Certification](./02-training.md) | **Next:** [Events & Meetings](./04-events-meetings.md)
