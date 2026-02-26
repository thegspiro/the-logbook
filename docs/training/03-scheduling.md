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
| **Settings** | Scheduling configuration |

> **Screenshot placeholder:**
> _[Screenshot of the Scheduling page showing the tab bar at the top with all seven tabs, and the Schedule (calendar) tab active showing a monthly calendar view with color-coded shifts]_

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

---

**Previous:** [Training & Certification](./02-training.md) | **Next:** [Events & Meetings](./04-events-meetings.md)
