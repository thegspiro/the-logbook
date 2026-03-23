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
| **Settings** | Notification preferences, shift rules, and coverage settings |

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

**Previous:** [Training & Certification](./02-training.md) | **Next:** [Events & Meetings](./04-events-meetings.md)
