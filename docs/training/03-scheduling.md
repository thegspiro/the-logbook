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
11. [Shift Reports and Compliance](#shift-reports-and-compliance)
12. [Troubleshooting](#troubleshooting)

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

| Pattern Type | Description |
|-------------|-------------|
| **Daily** | Creates a shift every day |
| **Weekly** | Creates shifts on selected weekdays |
| **Platoon** | Rotates on/off days (e.g., 24 on / 48 off) |
| **Custom** | Specific dates |

To generate shifts from a pattern:

1. Create a pattern linked to a template.
2. Set the date range.
3. Click **Generate Shifts**.
4. Review and confirm the generated shifts.

> **Screenshot placeholder:**
> _[Screenshot of the pattern creation form showing the pattern type selector (Daily, Weekly, Platoon, Custom), the linked template dropdown, start/end date pickers, and for Platoon type: days on / days off fields]_

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

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot sign up for an open shift | Check that you are logged in as an active member and the shift has not already been filled. |
| Shift assignment shows "Member is on leave" | The member has an active leave of absence covering the shift date. The leave must be deactivated before assigning. |
| Attendance hours not calculating | Ensure both check-in and check-out times are recorded. Duration is calculated automatically. |
| Generated shifts not appearing on calendar | Check the date range filter on the calendar. Generated shifts appear for the pattern's date range. |
| Swap request stuck in pending | Both the other member and an officer must act. Check with the other member first, then the reviewing officer. |
| Compliance report shows incorrect hours | Verify that attendance records have accurate check-in/out times. Only shifts with recorded attendance count. |

---

**Previous:** [Training & Certification](./02-training.md) | **Next:** [Events & Meetings](./04-events-meetings.md)
