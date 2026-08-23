# Scheduling & Shifts Module

Comprehensive shift scheduling, member signup, swap/time-off management, templates, patterns, and reporting.

## Overview

The Scheduling module manages the full shift lifecycle for fire departments and emergency services organizations. It provides:

- **Shift creation and calendar views** (week/month)
- **Member self-service signup** for open shift positions
- **Shift assignments** with 9 position types (officer, driver, firefighter, EMT, captain, lieutenant, probationary, volunteer, other)
- **Shift conflict detection** preventing duplicate assignments and overlapping time conflicts
- **Shift officer assignment** from a member dropdown in the create/edit modal
- **Understaffing indicators** with amber warning badges on calendar when staffing is below minimum
- **Template colors on calendar** — shifts inherit color from their template for visual organization
- **Swap and time-off requests** with admin approval workflow
- **Shift templates and patterns** for recurring schedules (daily, weekly, platoon, custom)
- **Fire department shift pattern presets** — Built-in patterns (24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB) and custom pattern builder
- **Shift generation** from patterns for bulk schedule creation with correct weekday mapping
- **Apparatus connection** linking shifts to vehicles (vehicle type dropdown on Standard and Specialty templates)
- **Vehicle linking on templates** — Templates linked to actual department vehicles from the Apparatus module
- **Auto-default shift officer** — When a member is assigned the "Officer" position, they are automatically set as the shift officer
- **Scheduling reports** (member hours, coverage, call volume, availability)
- **Training integration** via shift completion reports and observations
- **Shift call/run logging** _(2026-06-09)_ — Officers record the calls a crew ran during a shift (incident type/number, dispatched/on-scene/cleared times, cancelled-en-route and medical-refusal flags, responding members, notes). Read-only after the shift is finalized
- **Staffing-based open shifts** _(2026-06-09)_ — Open Shifts is computed from actual staffing (unfilled required position, or active `ASSIGNED`/`CONFIRMED` count below `min_staffing`) instead of a fixed page, so fully-staffed shifts can't crowd open ones out of view (capped at 500 candidates per window). Backed by the composite index `idx_shift_assign_shift_status` on `shift_assignments(shift_id, assignment_status)`

---

## Architecture

### Frontend

The scheduling frontend uses a modular architecture:

```
frontend/src/modules/scheduling/
├── index.ts                        # Barrel export (routes, components, types)
├── services/
│   └── api.ts                      # Module-scoped API service (uses createApiClient)
├── store/
│   ├── schedulingStore.ts          # Zustand store for scheduling state
│   └── schedulingStore.test.ts     # Store unit tests
├── components/
│   ├── ShiftSettingsPanel.tsx       # Scheduling configuration panel
│   ├── ShiftReportsSettingsPanel.tsx # Shift report and post-shift validation settings
│   ├── SchedulingNotificationsPanel.tsx  # Notification management
│   ├── TemplateFormModal.tsx        # Create/edit shift template modal
│   ├── PatternFormModal.tsx         # Create/edit shift pattern modal
│   ├── GenerateShiftsModal.tsx      # Bulk generate shifts from pattern
│   └── shiftTemplateTypes.ts        # TypeScript types for template/pattern forms

frontend/src/pages/
├── SchedulingPage.tsx              # Main 7-tab hub (slim orchestrator)
├── scheduling/
│   ├── MyShiftsTab.tsx             # Personal shift view, confirm/decline, swap/time-off requests
│   ├── OpenShiftsTab.tsx           # Browse & sign up for upcoming shifts
│   ├── RequestsTab.tsx             # Combined swap + time-off request management
│   ├── PatternsTab.tsx             # Shift pattern management
│   └── ShiftDetailPanel.tsx        # Slide-out panel: crew roster, signup, calls
├── ShiftTemplatesPage.tsx          # Templates & patterns management (admin)
├── SchedulingReportsPage.tsx       # Reports: hours, coverage, call volume, availability
├── ShiftAssignmentsPage.tsx        # Assignment management (admin)
├── ShiftAttendancePage.tsx         # Attendance records for a shift
├── ShiftReportPage.tsx             # Shift completion reports (training integration)
└── ApparatusBasicPage.tsx          # Lightweight apparatus management

frontend/src/pages/training/
├── ManualShiftReportPage.tsx       # Manual shift report entry (no scheduling module required) (2026-04-11)
└── ManualEntrySettingsPanel.tsx    # Admin config for manual shift entry (2026-04-11)
```

### Backend

```
backend/app/
├── models/training.py              # Shift, ShiftAssignment, ShiftTemplate, ShiftPattern,
│                                   # ShiftAttendance, ShiftCall, BasicApparatus models
├── schemas/scheduling.py           # Pydantic schemas for all scheduling operations
├── services/scheduling_service.py  # Business logic for scheduling operations
├── api/v1/endpoints/scheduling.py  # All scheduling REST endpoints
└── alembic/versions/
    ├── 20260122_0015_*.py          # Initial shift tables
    └── 20260218_0200_*.py          # BasicApparatus table
```

### Services (Frontend API)

Scheduling API calls go through the module-scoped service in `frontend/src/modules/scheduling/services/api.ts`, which uses the shared `createApiClient()` factory for consistent interceptors (auth refresh, CSRF, caching).

---

## Models

### Shift

Core shift record representing a single scheduled shift.

| Field              | Type     | Description                                      |
| ------------------ | -------- | ------------------------------------------------ |
| `id`               | UUID     | Primary key                                      |
| `organization_id`  | UUID     | FK to organizations                              |
| `shift_date`       | Date     | The date of the shift                            |
| `start_time`       | DateTime | Shift start time                                 |
| `end_time`         | DateTime | Shift end time (nullable)                        |
| `template_id`      | UUID     | FK to shift_templates (nullable)                 |
| `apparatus_id`     | UUID     | FK to apparatus/basic_apparatus (nullable)       |
| `station_id`       | UUID     | FK to locations (nullable)                       |
| `shift_officer_id` | UUID     | FK to users (nullable)                           |
| `status`           | String   | scheduled, in_progress, completed, cancelled     |
| `notes`            | Text     | Optional notes                                   |
| `activities`       | JSON     | What happened during shift                       |
| `color`            | String   | Template color for calendar display (nullable)   |
| `attendee_count`   | Integer  | Computed count of confirmed attendees            |
| `min_staffing`     | Integer  | Minimum staffing (enriched from apparatus)       |
| `call_count`       | Integer  | Snapshotted at finalization (nullable)           |
| `closeout_step`    | Integer  | Close-out resume point (nullable) _(2026-08-19)_ |

> **`closeout_step` carries no entered data.** `0`/NULL = not started, `1` =
> attendance saved, `2` = calls saved. The close-out wizard writes real records
> as it advances, so this column only says which screen to reopen on. It is
> cleared on finalize, and a finalized shift reports `0` regardless — reopening
> deliberately restarts the wizard.

### ShiftAssignment

Links a member to a shift with a specific position.

| Field               | Type     | Description                                                                            |
| ------------------- | -------- | -------------------------------------------------------------------------------------- |
| `id`                | UUID     | Primary key                                                                            |
| `shift_id`          | UUID     | FK to shifts                                                                           |
| `user_id`           | UUID     | FK to users                                                                            |
| `position`          | String   | officer, driver, firefighter, emt, captain, lieutenant, probationary, volunteer, other |
| `assignment_status` | String   | assigned, confirmed, declined, no_show, cancelled                                      |
| `assigned_by`       | UUID     | Who made the assignment                                                                |
| `confirmed_at`      | DateTime | When member confirmed                                                                  |
| `notes`             | Text     | Optional notes                                                                         |

### OrgCall _(2026-08-18)_

One call the department ran, counted **once** no matter how many units went.
Only written by departments on `count_only` call tracking.

| Field             | Type     | Description                                                       |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `id`              | UUID     | Primary key                                                       |
| `organization_id` | UUID     | FK to organizations, CASCADE                                      |
| `call_date`       | **Date** | Date only — a timestamp would let response times be reconstructed |
| `call_type`       | String   | Slug into the org's own type list (nullable = unclassified)       |
| `source`          | String   | `manual` \| `dispatch` \| `derived`; not a DB enum                |
| `external_ref`    | String   | Dispatch's own id; never displayed. Unique per org                |
| `created_at`      | DateTime |                                                                   |
| `created_by`      | UUID     | FK to users, SET NULL                                             |

### OrgCallResponse _(2026-08-18)_

One apparatus responding to one call — the join that makes deduplication work.
N of these against a single `OrgCall` is N units on one call, which counts as
**one** for the department and **one run each** for the units.

| Field             | Type     | Description                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------- |
| `id`              | UUID     | Primary key                                                                             |
| `organization_id` | UUID     | FK to organizations, CASCADE                                                            |
| `call_id`         | UUID     | FK to org_calls, CASCADE                                                                |
| `shift_id`        | UUID     | FK to shifts, **SET NULL** — deleting a shift must not reduce historical volume         |
| `apparatus_id`    | UUID     | **Polymorphic, no FK** — resolved via `utils/apparatus_ref`, like `shifts.apparatus_id` |
| `created_at`      | DateTime |                                                                                         |

Unique on `(call_id, apparatus_id)`: a unit responds to a given call once.
Without it, re-finalizing a shift would add a second run to the apparatus's
tally every time an officer corrected a number.

> **What these tables deliberately do not hold:** no address, no cross streets,
> no patient or caller identity, no narrative, no dispatch/on-scene/clear times,
> and no CAD incident number for display. Enforced by absence — there is no
> parameter to pass one to and no column to land it in. A department that wants
> incident-level records wants an incident module, behind its own consent and
> access-control story.

### ShiftTemplate

Reusable shift configuration defining times and staffing.

| Field               | Type    | Description                          |
| ------------------- | ------- | ------------------------------------ |
| `id`                | UUID    | Primary key                          |
| `name`              | String  | Template name (e.g., "Day Shift A")  |
| `start_time_of_day` | String  | Start time (e.g., "08:00")           |
| `end_time_of_day`   | String  | End time (e.g., "20:00")             |
| `duration_hours`    | Float   | Shift duration in hours              |
| `color`             | String  | Color for calendar display           |
| `min_staffing`      | Integer | Minimum required staffing            |
| `positions`         | JSON    | Position definitions                 |
| `is_default`        | Boolean | Whether this is the default template |
| `is_active`         | Boolean | Active/inactive status               |

### ShiftPattern

Defines recurring shift schedules for bulk shift generation.

| Field              | Type    | Description                           |
| ------------------ | ------- | ------------------------------------- |
| `id`               | UUID    | Primary key                           |
| `name`             | String  | Pattern name (e.g., "24/48 Rotation") |
| `pattern_type`     | String  | daily, weekly, platoon, custom        |
| `template_id`      | UUID    | FK to shift_templates (nullable)      |
| `rotation_days`    | Integer | Total days in rotation cycle          |
| `days_on`          | Integer | Consecutive days on duty              |
| `days_off`         | Integer | Consecutive days off duty             |
| `schedule_config`  | JSON    | Additional pattern configuration      |
| `start_date`       | Date    | Pattern effective start               |
| `end_date`         | Date    | Pattern effective end (nullable)      |
| `assigned_members` | JSON    | Members in this rotation              |
| `is_active`        | Boolean | Active/inactive status                |

### BasicApparatus

Lightweight vehicle management for departments without the full Apparatus module.

| Field             | Type        | Description                                                                       |
| ----------------- | ----------- | --------------------------------------------------------------------------------- |
| `id`              | UUID        | Primary key                                                                       |
| `organization_id` | UUID        | FK to organizations                                                               |
| `unit_number`     | String(20)  | Vehicle unit number (e.g., "E-1")                                                 |
| `name`            | String(100) | Vehicle name (e.g., "Engine 1")                                                   |
| `apparatus_type`  | String(50)  | engine, ladder, rescue, ambulance, brush, tanker, battalion, utility, boat, other |
| `min_staffing`    | Integer     | Minimum crew size                                                                 |
| `positions`       | JSON        | Array of crew position names                                                      |
| `is_active`       | Boolean     | Active/inactive status                                                            |

**Default positions by apparatus type:**

| Type      | Default Positions                                      |
| --------- | ------------------------------------------------------ |
| Engine    | Officer, Driver, Firefighter, Firefighter              |
| Ladder    | Officer, Driver, Firefighter, Firefighter, Firefighter |
| Rescue    | Officer, Driver, Firefighter                           |
| Ambulance | Driver, EMT                                            |
| Brush     | Driver, Firefighter                                    |
| Tanker    | Driver, Operator                                       |
| Battalion | Battalion Chief                                        |

### SwapRequest

Shift swap request between members.

| Field                 | Type   | Description                          |
| --------------------- | ------ | ------------------------------------ |
| `id`                  | UUID   | Primary key                          |
| `requesting_user_id`  | UUID   | Member requesting the swap           |
| `target_user_id`      | UUID   | Target member (nullable)             |
| `offering_shift_id`   | UUID   | Shift being offered                  |
| `requesting_shift_id` | UUID   | Shift wanted in return (nullable)    |
| `status`              | String | pending, approved, denied, cancelled |
| `reason`              | Text   | Why the swap is requested            |
| `reviewer_notes`      | Text   | Admin notes on decision              |

### TimeOffRequest

Time-off request for date ranges.

| Field            | Type   | Description                          |
| ---------------- | ------ | ------------------------------------ |
| `id`             | UUID   | Primary key                          |
| `user_id`        | UUID   | Requesting member                    |
| `start_date`     | Date   | Start of time off                    |
| `end_date`       | Date   | End of time off                      |
| `status`         | String | pending, approved, denied, cancelled |
| `reason`         | Text   | Reason for time off                  |
| `reviewer_notes` | Text   | Admin notes on decision              |

---

## API Endpoints

### Shifts

```
GET    /api/v1/scheduling/shifts                    # List shifts (with date filters)
POST   /api/v1/scheduling/shifts                    # Create shift (scheduling.manage)
GET    /api/v1/scheduling/shifts/{id}               # Get shift by ID
PATCH  /api/v1/scheduling/shifts/{id}               # Update shift (scheduling.manage)
DELETE /api/v1/scheduling/shifts/{id}               # Delete shift (scheduling.manage)
GET    /api/v1/scheduling/shifts/open               # Get upcoming open shifts
GET    /api/v1/scheduling/calendar/week/{date}      # Week calendar view
GET    /api/v1/scheduling/calendar/month/{y}/{m}    # Month calendar view
```

### Shift Signup (Member Self-Service)

```
POST   /api/v1/scheduling/shifts/{id}/signup        # Sign up for a shift position
DELETE /api/v1/scheduling/shifts/{id}/signup         # Withdraw from a shift
```

**Signup request body:**

```json
{
  "position": "firefighter"
}
```

These endpoints use `get_current_user` (not `require_permission`), allowing any authenticated member to sign up.

### Assignments (Admin)

```
GET    /api/v1/scheduling/shifts/{id}/assignments   # List shift assignments
POST   /api/v1/scheduling/shifts/{id}/assignments   # Create assignment (scheduling.assign)
PATCH  /api/v1/scheduling/assignments/{id}          # Update assignment
DELETE /api/v1/scheduling/assignments/{id}          # Remove assignment
POST   /api/v1/scheduling/assignments/{id}/confirm  # Confirm assignment
GET    /api/v1/scheduling/my-assignments             # Get current user's assignments
GET    /api/v1/scheduling/my-shifts                  # Get current user's shifts
```

### Templates & Patterns

```
GET    /api/v1/scheduling/templates                 # List templates
POST   /api/v1/scheduling/templates                 # Create template (scheduling.manage)
PATCH  /api/v1/scheduling/templates/{id}            # Update template
DELETE /api/v1/scheduling/templates/{id}            # Delete template
GET    /api/v1/scheduling/patterns                  # List patterns
POST   /api/v1/scheduling/patterns                  # Create pattern (scheduling.manage)
PATCH  /api/v1/scheduling/patterns/{id}             # Update pattern
DELETE /api/v1/scheduling/patterns/{id}             # Delete pattern
POST   /api/v1/scheduling/patterns/{id}/generate    # Generate shifts from pattern
```

### Swap Requests

```
GET    /api/v1/scheduling/swap-requests             # List swap requests
POST   /api/v1/scheduling/swap-requests             # Create swap request
PATCH  /api/v1/scheduling/swap-requests/{id}/review # Approve/deny (scheduling.manage)
DELETE /api/v1/scheduling/swap-requests/{id}        # Cancel own request
```

**Trade candidates** — who could take over the caller's seat:

```
GET    /api/v1/scheduling/shifts/{id}/trade-candidates   # Member self-service
```

The server has already excluded anyone who could not accept: already on the
shift, on leave or approved time off, not cleared for the seat's position, or
already rostered on a shift that overlaps or abuts this one (a 12-hour
department does not want an accepted trade to produce a 24-hour tour silently).
Each candidate carries their shift count for the month and whether they owe the
caller a trade, so the picker ranks by who is least loaded rather than
alphabetically. Holding no seat on the shift is a 409, not an empty list —
"nobody can cover this" is a different and much more alarming answer.

**Expiry** _(2026-08-23)_ — a pending offer holds the seat with the member who
made it, so left alone it survives the shift itself: the offerer believes they
are covered, the duty officer sees a name that will not turn up, and nobody is
told. The daily `swap_offer_expiry` task cancels offers still pending the day
before the shift and notifies the offerer, the member they asked, and the duty
officer. Email is the channel of record; the in-app entry is an addition to it.

### Standing Shifts _(2026-08-23)_

A standing shift is a member's recurring claim on a seat — "every Tuesday night
through December". It is a _member_ record, not a department schedule:
`ShiftPattern` generates the shifts, and a standing claim seats one member on
the ones that match it. Giving up a single date leaves the series intact, which
is the whole reason it is stored rather than written once as a batch of
assignments.

```
GET    /api/v1/scheduling/standing-shifts/preview       # Dates + conflicts, no writes
GET    /api/v1/scheduling/standing-shifts               # The caller's own claims
POST   /api/v1/scheduling/standing-shifts               # Create, and claim matching dates
DELETE /api/v1/scheduling/standing-shifts/{id}          # End a series (?release_future=)
GET    /api/v1/scheduling/shifts/{id}/standing-claim    # The series this shift belongs to
```

All member self-service, like signup — no `scheduling.manage` anywhere.

**The claim has two readers, and only means something because both exist.**
Creating one seats the member on the matching shifts already on record;
creating a _shift_ seats every member whose active claim matches it
(`SchedulingService.apply_standing_claims`, called after `create_shift` and
after pattern generation). Without the second, a member's series would go quiet
the moment the department generated next month's schedule — the very month they
set it up for.

Seating goes through `SchedulingService.seat_member_self_service`, which pins
`self_signup=True` so eligibility, capacity, past-date and driver checks apply
to every date exactly as they would to a single tap on the calendar. That
wrapper exists rather than calling `create_assignment` directly because the
flag defaults to False there — handing the raw method over is the silent way
to seat a member on dates they could not have claimed by hand. A date the
signup path refuses is reported as _skipped_ rather than failing the series:
one full shift in November must not cost the member the other eleven months.

`tests/test_standing_shift_wiring.py` guards both readers and this wrapper.
The failure it exists for is invisible at the call site and shows up weeks
later as members not being seated on a schedule that was generated normally.

A claim names the half of the day it wants (`day` = a local start before noon,
`night` = noon or later) rather than a template, because departments define
their own templates and times. Day/night is decided in the organisation's
timezone — reading the hour off the stored UTC column would relabel a
department's night shift twice a year as daylight saving moved it across
midnight.

`DELETE` defaults to `release_future=false`. Ending a series and giving up the
dates already on the roster are separate decisions: a member moving off
Tuesdays next quarter still works the Tuesdays already rostered, and quietly
emptying those seats is how a shift goes short with nobody notified.

### Time-Off Requests

```
GET    /api/v1/scheduling/time-off                  # List time-off requests
POST   /api/v1/scheduling/time-off                  # Create time-off request
PATCH  /api/v1/scheduling/time-off/{id}/review      # Approve/deny (scheduling.manage)
DELETE /api/v1/scheduling/time-off/{id}             # Cancel own request
```

### Attendance

```
GET    /api/v1/scheduling/shifts/{id}/attendance    # Get shift attendance
GET    /api/v1/scheduling/my-attendance-history     # Current member's attendance history
PATCH  /api/v1/scheduling/attendance/{id}           # Update attendance record
DELETE /api/v1/scheduling/attendance/{id}           # Delete attendance record
```

`GET /my-attendance-history` accepts `limit` (1–200, default 50) plus optional
`start_date` / `end_date` (`YYYY-MM-DD`) to page further back than `limit`. It
joins `Shift` to `ShiftAttendance` so each row embeds `shift_date`,
`shift_start_time`, and `shift_end_time`, ordered by `shift_date` descending.
(2026-05)

### Calls

```
GET    /api/v1/scheduling/shifts/{id}/calls         # Get calls during shift
GET    /api/v1/scheduling/calls/{call_id}           # Get one call
PATCH  /api/v1/scheduling/calls/{call_id}           # Update a call
DELETE /api/v1/scheduling/calls/{call_id}           # Delete a call
```

### Shift Close-Out _(2026-08-19)_

```
GET    /api/v1/scheduling/shifts/{id}/closeout              # Wizard state + resume point
PATCH  /api/v1/scheduling/shifts/{id}/closeout/attendance   # Step 1 — who was on, and when
PATCH  /api/v1/scheduling/shifts/{id}/closeout/calls        # Step 2 — how many calls
POST   /api/v1/scheduling/shifts/{id}/finalize              # Step 3 — confirm and close
```

All four require `scheduling.manage` **or** being the shift's own officer
(`_authorize_shift_management`). Each step writes as it advances, so an
interrupted close-out resumes rather than restarting.

`GET …/closeout` → `CloseoutStateResponse`:

| Field                                         | Meaning                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `closeout_step`                               | `0` not started, `1` attendance saved, `2` calls saved                                                                     |
| `call_tracking_mode`                          | `detailed` \| `count_only` \| `off`                                                                                        |
| `call_types`                                  | The org's own `{slug, label}` list                                                                                         |
| `members`                                     | Assigned + attended crew, with times, hours, credit, `missing_checkout`                                                    |
| `combined_hours`                              | Summed across the crew — "combined" because it is several times the shift's length and reads as a mistake without the word |
| `reported_call_count` / `reported_call_types` | Redisplay for a resumed or reopened shift                                                                                  |
| `attachable_calls`                            | **Served empty** — see the note below                                                                                      |

`PATCH …/closeout/calls` accepts `reported_call_count`,
`reported_call_types`, `attach_call_ids`. `null` for the count is meaningful
(it clears a previously reported figure) and is distinguished from an omitted
field by `count_provided`, so a client that only attaches calls does not wipe a
count it never mentioned.

`POST …/finalize` additionally accepts `manual_hours`, `member_call_counts`,
`override_incomplete_checks` + `override_reason` (audited as
`shift_finalized_check_override`), and `pass_down_notes`.

> **`attachable_calls` is deliberately empty.** Claiming another unit's call has
> no UI yet, so nothing can send `attach_call_ids` from the browser, and
> `list_calls_in_window` would cost two queries on every close-out GET for a
> list nothing reads. The field stays on the response so the contract does not
> change when the picker lands. See **SCHED-10** in
> [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md#scheduling-module).

### Basic Apparatus

```
GET    /api/v1/scheduling/apparatus                 # List basic apparatus
POST   /api/v1/scheduling/apparatus                 # Create (scheduling.manage)
PATCH  /api/v1/scheduling/apparatus/{id}            # Update (scheduling.manage)
DELETE /api/v1/scheduling/apparatus/{id}            # Delete (scheduling.manage)
```

### Reports

```
GET    /api/v1/scheduling/reports/member-hours      # Member hours report
GET    /api/v1/scheduling/reports/coverage           # Shift coverage report
GET    /api/v1/scheduling/reports/call-volume        # Call volume report
GET    /api/v1/scheduling/reports/availability       # Member availability
GET    /api/v1/scheduling/summary                    # Dashboard summary stats
```

#### Worked vs. scheduled _(field rename, 2026-08-01)_

Both responses used to name their figures as though scheduled and worked time
were the same kind of number. `GET /summary` was the worst case: three counts
of _scheduled_ shifts sat beside a sum of _worked_ attendance minutes, under
names that gave no hint. The fields now say which they are.

| Endpoint                | Was                                                     | Now                                                                                                                   |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/summary`              | `total_shifts`, `shifts_this_week`, `shifts_this_month` | `shifts_scheduled`, `shifts_scheduled_this_week`, `shifts_scheduled_this_month`                                       |
| `/summary`              | `total_hours_this_month`                                | `hours_worked_this_month`                                                                                             |
| `/reports/member-hours` | `shift_count`, `total_minutes`, `total_hours`           | `shifts_attended`, `worked_minutes`, `worked_hours` — plus `shifts_scheduled`, `scheduled_minutes`, `scheduled_hours` |

`member-hours` is also **sourced from attendance** now
(`ShiftAttendance.duration_minutes`, from check-in/check-out) rather than
assignment durations. An assignment is a plan: a shift can run short or long,
and a member can be rostered for one they never work, so anything that credits
a member has to use the measured figure. The scheduled totals stay alongside
so the difference is visible.

The two aggregates are merged on member rather than joined, so a member who
worked a shift they were never assigned to appears in the report with
`shifts_scheduled: 0`.

---

## Frontend Pages

### SchedulingPage (Main Hub)

The main scheduling interface is a 7-tab hub accessible at `/scheduling` (supports `?tab=` deep-linking):

| Tab                  | Access              | Description                                                                                                                                |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Schedule**         | All members         | The shift board (see below) — month/week grid beside a day panel with the crew roster and one-tap claim. Admins see "Create Shift" button. |
| **My Shifts**        | All members         | Personal upcoming/past shifts. Confirm or decline assignments. Request swaps or time off.                                                  |
| **Open Shifts**      | All members         | Browse upcoming shifts grouped by date. Sign up for positions with inline position selector.                                               |
| **Requests**         | All members         | View swap and time-off requests. Admins can approve/deny with reviewer notes.                                                              |
| **Templates**        | `scheduling.manage` | Manage shift templates and scheduling patterns. Generate shifts from patterns.                                                             |
| **Equipment Checks** | All members         | Browse apparatus checklists, perform ad-hoc or shift-linked equipment checks                                                               |
| **Reports**          | `scheduling.manage` | Scheduling analytics: member hours, coverage, call volume, availability.                                                                   |

### The Shift Board _(2026-08-23)_

`pages/scheduling/board/` replaces the Schedule tab's grid of shift cards. A
card said a shift existed; the board says whether it still needs somebody and
lets a member be that somebody without leaving the page.

| File                     | What it is                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| `ShiftBoard.tsx`         | Orchestrator: fetches the visible range, owns selection, filters and the modals  |
| `MonthGrid.tsx`          | Desktop day cells with one status chip per shift                                 |
| `DayDetailPanel.tsx`     | Right column: "your next shift", then the selected day's crews                   |
| `ShiftSeatList.tsx`      | One shift's seats and its single action; shared by the panel and the phone sheet |
| `PhoneMonth.tsx`         | Phone grid — one coloured bar per shift, plus the legend that decodes them       |
| `PhoneDaySheet.tsx`      | Phone day sheet and the post-claim confirmation                                  |
| `GiveUpShiftModal.tsx`   | Release / offer flow, three steps                                                |
| `StandingShiftModal.tsx` | Recurring-claim setup with a live preview of the dates                           |
| `statusStyles.ts`        | The four status colours, written down once                                       |

The judgements behind it — capacity, open seats, which colour a shift earns,
which seat the primary button claims — live in
`modules/scheduling/utils/shiftBoard.ts` rather than in JSX, so the cell, the
panel and the phone sheet cannot drift into three different answers about the
same shift.

**Status colours**, in precedence order. "You are on it" deliberately beats the
staffing colours: a member scanning the month is first asking where they are
already committed, and a shift they hold is not one they can claim again.

| State         | Meaning | Chip        |
| ------------- | ------- | ----------- |
| You are on it | Blue    | `You + 2/4` |
| 2+ seats open | Red     | `2 open`    |
| 1 seat open   | Amber   | `1 open`    |
| Fully staffed | Green   | `Full 4/4`  |

A day carrying three or more open seats across its shifts gets an `URGENT`
flag. Filters (**All shifts / Needs staffing / My shifts**) _dim_ rather than
hide, so the month keeps its shape and a member counting Tuesdays does not have
to re-find them after switching.

**Seat capacity is enforced on self-signup.** A shift with named positions was
already capped seat by seat. A shift that names none has only `min_staffing` to
say how big the crew is, and nothing read it — so the calendar could show
"Full 4/4" while the server kept accepting a fifth. Both now refuse a
self-service claim, with the message naming which race was lost. Officer
assignment is deliberately _not_ capped: adding a fifth body is something an
officer does on purpose, and refusing it would make the roster disagree with
who is actually turning up.

**One request per range.** Every shift response now carries `roster` — the
occupied seats, with names and positions — so selecting a day costs no network
call and a cell can be coloured "yours" at all. Claiming is optimistic: the
chip, the badge and the CTA move together because they read the same roster,
and a refused claim rolls back and re-reads from the server.

**Not implemented:** the design's "Join the standby list" on a full crew. There
is no waitlist in the data model, and a button that stored nothing would tell a
member they were queued for a shift when they were not. A full crew says so
instead.

### ShiftDetailPanel

A slide-out panel that appears when clicking a shift on the calendar:

- **Shift info**: Date, time, apparatus, station, notes
- **Crew roster**: List of assigned members with positions and status
- **Open positions**: Available positions members can sign up for
- **Calls/incidents**: Calls that occurred during the shift
- **Actions**: Sign up (members), assign members (admins), remove assignments (admins)
- **Check-in QR + NFC** _(2026-08-18)_: the apparatus check-in code, built by
  `buildShiftCheckInUrl({ apparatusId })` so it resolves to whichever shift is
  running when it is used, with an NFC tag writer beneath it
- **Close out shift** _(2026-08-19)_: on a past, unfinalized, uncancelled shift,
  for `scheduling.manage` or the shift's officer. Opens the single finalize
  checklist, or the three-step close-out wizard when the department records a
  call count — see below

### Call volume tracking and the close-out wizard _(2026-08-19)_

One organization setting decides which close-out screen opens:
**Scheduling → Settings → General → Shift close-out rules → Record a call count
at close-out**, stored as `scheduling.call_tracking.mode` in the organization's
settings JSON alongside `scheduling.call_tracking.call_types`.

| Mode                 | Close-out screen                            | Where call volume comes from       |
| -------------------- | ------------------------------------------- | ---------------------------------- |
| `detailed` (default) | Single finalize checklist                   | Per-incident `ShiftCall` rows      |
| `count_only`         | Three-step wizard                           | `org_calls` / `org_call_responses` |
| `off`                | Single finalize checklist, no call question | Not tracked                        |

**A missing setting reads as `detailed`, never `off`.** Defaulting absence to
disabled would silently stop call logging for every existing installation on
upgrade, and nobody connects a missing year of call volume back to a deploy
(CLAUDE.md pitfall #19). `ShiftEligibilityService.get_call_tracking_settings`
is the resolver, and it degrades a malformed `call_types` list to the built-in
nine rather than raising — an exception there would take out close-out for the
whole department over one hand-edited entry.

**Three quantities, three code paths, and they are not supposed to reconcile:**

| Quantity               | Source                          | Note                                                                                                                                                                     |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Department call volume | distinct `OrgCall` rows         | One call is one call however many units rolled                                                                                                                           |
| Apparatus runs         | `OrgCallResponse` rows per unit | A 400-call department can hold 380 engine runs and 240 medic runs                                                                                                        |
| Member credit          | `ShiftAttendance.call_count`    | A member who came on at 0300 was not on the 2200 call — and it is never summed back into a department total, which with a four-person crew multiplies every call by four |

`GET /scheduling/reports/call-volume` reads **one** source and never mixes them;
reading both and adding them would count every call twice for an org that has
used each mode in turn. The count-only branch sets `counts_unit_responses`, and
the renderer relabels **Total Calls → Unit Responses**, **Avg Calls/Day → Avg
Responses/Day**, **Peak Calls → Peak Responses**, with a footnote — because
until the attach picker lands, two units on one incident are counted twice, and
calling that "calls" overstates the department's volume.

### ApparatusBasicPage

Lightweight apparatus management at `/apparatus-basic`:

- CRUD for vehicles with unit number, name, type, min staffing, and crew positions
- Search and filter functionality
- Card grid layout with create/edit modal
- Default crew positions auto-populated based on apparatus type
- Only shown when the full Apparatus module is disabled (mirrors Locations vs Facilities pattern)

---

## Permissions

| Permission          | Description                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduling.manage` | Create/edit/delete shifts, templates, patterns. Approve/deny requests. View reports.                                                                                         |
| `scheduling.assign` | Assign members to shifts (admin assignment, not self-signup).                                                                                                                |
| `scheduling.view`   | View scheduling data (implicit for all authenticated members). **Not a meaningful gate** — anything genuinely restricted needs `assign`/`manage` or the shift-officer check. |
| `scheduling.swap`   | Request/manage shift swaps and time-off.                                                                                                                                     |
| `scheduling.report` | View shift reports and analytics.                                                                                                                                            |

**Note:** Shift signup (`POST /shifts/{id}/signup`) uses `get_current_user`, not `require_permission`. Any authenticated member can sign up for open positions.

**Per-shift officer authority _(2026-07-16)_:** The officer named on a shift (`shift_officer_id`) may manage that shift's crew, attendance, calls, finalize, and cancellation even without `scheduling.assign`/`scheduling.manage` — enforced by `_authorize_shift_management`/`_authorize_assignment_management` in `endpoints/scheduling.py` (permission OR is-shift-officer). Editing/deleting the shift record itself still requires `scheduling.manage`. The **Scheduling Officer** role now also holds `scheduling.swap` and `scheduling.report`.

---

## Module Toggle: Apparatus

The scheduling module supports two modes for apparatus/vehicle management:

### Full Apparatus Module (enabled)

- Side navigation links to `/apparatus`
- Full vehicle tracking, maintenance schedules, equipment inventory
- Vehicles from the Apparatus module appear in shift creation dropdown

### Lightweight Apparatus Basic (disabled)

- Side navigation links to `/apparatus-basic`
- Simple vehicle definitions with crew positions
- Provides enough data for shift scheduling without the full module overhead
- `BasicApparatus` model stored in `basic_apparatus` table

This follows the same pattern as **Facilities** (full) vs **Locations** (lightweight).

---

## Database Migrations

### Shift Framework (Initial)

**File:** `20260122_0015_add_training_programs_and_requirements.py`

Creates the initial shift tables as part of the training module framework:

- `shifts` table
- `shift_assignments` table
- `shift_templates` table
- `shift_patterns` table
- `shift_attendance` table
- `shift_calls` table
- `swap_requests` table
- `time_off_requests` table

### Basic Apparatus Table

**File:** `20260218_0200_add_basic_apparatus_table.py`

Creates:

- `basic_apparatus` table with columns: id, organization_id, unit_number, name, apparatus_type, min_staffing, positions (JSON), is_active, created_at, updated_at
- Index: `idx_basic_apparatus_org` on organization_id

**Revision chain:** `20260218_0100` → `20260218_0200`

---

## Shift Pattern Presets (Added 2026-02-28)

The pattern creation form includes a **presets dropdown** with fire department shift rotations commonly used across the US:

| Preset                   | On/Off Pattern                                   | Cycle Length | Description                                |
| ------------------------ | ------------------------------------------------ | ------------ | ------------------------------------------ |
| **24/48**                | 1 on / 2 off                                     | 3 days       | Most common US fire department rotation    |
| **48/96**                | 2 on / 4 off                                     | 6 days       | Common in Western US departments           |
| **Kelly Schedule**       | 24 on / 24 off / 24 on / 24 off / 24 on / 96 off | 9 days       | Three-platoon rotation                     |
| **California 3-Platoon** | 24 on / 24 off / 24 on / 48 off                  | 4 days       | Modified Kelly for 3 platoons              |
| **ABCAB**                | Variable on/off                                  | 5 days       | Five-day rotation used by some departments |

### Custom Pattern Builder

For non-standard rotations, the **custom pattern builder** allows:

- Defining arbitrary sequences of on/off days
- Visual preview showing 30 days of the generated schedule
- Assigning members to the rotation
- Linking to a shift template for auto-populated shift details

### Auto-Default Shift Officer (Added 2026-02-28)

When creating or editing a shift, if a member is assigned the **Officer** position in the crew assignments, the system automatically sets that member as the shift officer. This eliminates the need to separately select the shift officer from the dropdown when it matches the assigned officer.

### Dashboard Shift Display (Updated 2026-02-28)

The main Dashboard now displays shifts in two separate sections:

- **My Upcoming Shifts** — Shifts you are assigned to, with date, time, position, and apparatus
- **Open Shifts** — Available shifts you can sign up for, with a quick-signup button

This replaces the previous single shift list that mixed assigned and open shifts together.

### Vehicle Linking on Templates (Added 2026-02-28)

Shift templates can now be linked to actual department vehicles from the Apparatus module (or Basic Apparatus if the full module is disabled). When a template is linked to a vehicle:

- The vehicle name and type display on shifts created from that template
- Calendar cards show the vehicle designation
- Shift creation pre-fills the apparatus field from the template

---

## Platoon Rotations (Added 2026-06-19)

Departments that staff by **platoon** (a/k/a shift, group, or color — A/B/C
crews that rotate through the same cycle) can have the schedule built from
platoon membership instead of assigning each shift by hand. The entire feature
is **opt-in** and **off by default**.

### Enabling Platoons (Department Toggle)

Platoons are enabled per organization via
`org.settings["scheduling"]["platoons_enabled"]` (boolean, default `false`),
controlled from the Scheduling settings. When disabled, the module behaves
exactly as before — no platoon fields, badges, or roster are surfaced anywhere
in the UI, and generation ignores platoons.

### Platoon Membership Is a Person-Level Attribute

Platoon membership lives on the member, not the shift: `User.platoon` (nullable
string, migration `20260618_0100`). This mirrors how departments actually
operate — a firefighter is "on A platoon" as a standing assignment, and the
schedule is derived from that.

- **Members** see their platoon on their profile / assignments view.
- **Managers** set a member's platoon from the member admin UI (one-click
  control plus a card badge showing the current platoon).

### Multi-Platoon Rotation Generation

When generating from a rotation, each platoon runs the **same cycle offset by**
`i × cycle_length / num_platoons` **days**, so the platoons tile to exactly one
on-duty platoon per day:

| Rotation      | Cycle | Platoons  | Offsets (days) |
| ------------- | ----- | --------- | -------------- |
| 24/48         | 3     | 3 (A/B/C) | 0, 1, 2        |
| Kelly (9-day) | 9     | 3         | 0, 3, 6        |
| 48/96         | 6     | 3         | 0, 2, 4        |

The offset math was verified to tile cleanly (exactly one platoon on duty each
day) for these common presets.

### Leave Integration

Generated platoon shifts reflect the platoon's **actual makeup**:

- A member with **approved leave** is omitted from the shifts they would
  otherwise staff during the generation window.
- **Approving leave cancels** the member's conflicting already-generated shifts,
  so the roster stays accurate after the schedule is built.

### Hold-Over Roster & One-Click Assign

The **shift detail** view shows a **hold-over roster** — members who are
available to fill a gap or be held over: same organization, **not on leave**,
and **not already assigned** to the shift. Each row has a **one-click Assign**
so a supervisor can immediately fill an open slot. The platoon responsible for a
generated shift is stored on the row (`Shift.platoon`, migration
`20260618_0200`).

> **Roster visibility is restricted _(2026-08-17)_.** The hold-over roster is
> derived from **who is on approved leave**, so `GET /scheduling/shifts/{id}`
> returns `platoon_roster` only to callers satisfying
> `_can_view_platoon_roster(shift, user)`:
>
> ```
> scheduling.assign  OR  scheduling.manage  OR  user.id == shift.shift_officer_id
> ```
>
> Everyone else receives `platoon_roster: []` and the roster is **not fetched
> at all** — the restriction is on the read, not on the serializer. Every other
> field on the shift (time, apparatus, assignments, check-in state) is
> unchanged for any member holding `scheduling.view`.
>
> This closes a gap that the endpoint's own permission could not: `scheduling.view`
> is implicit for all authenticated members, so gating the endpoint on it never
> gated the roster.

### Department Platoon Overview & Bulk Assignment

A dedicated **Platoon Management** page (`/scheduling/platoons`,
`scheduling.manage`, linked from Scheduling Settings → Platoons) shows every
platoon and the unassigned bucket with their active members at a glance, and
lets a manager **bulk-assign** many members to a platoon (or clear it) in one
operation:

- `GET /scheduling/platoons/overview` (**`scheduling.manage`** as of
  2026-08-17; previously `scheduling.view`) → `{ platoons_enabled,
groups: [{ platoon, member_count, members: [{ user_id, user_name, rank }] }] }`
  (named platoons sorted, then the `platoon: null` unassigned group).

  > **Breaking for existing users.** `scheduling.view` is implicit for every
  > authenticated member, so this endpoint published the entire department's
  > platoon assignments to anyone signed in. Members who reached
  > `/scheduling/platoons` before the change and do not hold
  > `scheduling.manage` now get a permission error; grant `scheduling.manage`
  > to the roles that legitimately need the department-wide roster.

- `POST /scheduling/platoons/bulk-assign` (`scheduling.manage`) → body
  `{ user_ids: [...], platoon: "A" | null }`; only members in the caller's org
  are updated (IDOR-safe), audit-logged `platoon_bulk_assigned`. Returns
  `{ updated, platoon }`.

The inline per-member roster (Settings → Platoons) remains for quick single
edits; the overview page is the roster-wide view + batch tool.

---

## Training Module Integration

The scheduling module connects to the training module through **Shift Completion Reports** and the **Shift Finalization Workflow**:

1. **Shift Finalization** (`POST /scheduling/shifts/{id}/finalize`): Officers finalize past shifts, which snapshots call_count and total_hours, computes per-member call counts, and auto-creates draft ShiftCompletionReports for enrolled trainees _(2026-03-28)_
2. **Shift Report Page** (`ShiftReportPage.tsx`): Officers file shift completion reports documenting trainee performance
3. **Auto-Population**: Report form auto-populates hours, calls, and call types from shift attendance and ShiftCall records via `GET /training/shift-reports/shift-preview/{shift_id}/{trainee_id}` _(2026-03-28)_
4. **Draft Review Workflow**: Auto-created drafts are completed by officers, optionally reviewed by training officers (approve/flag with field redaction), and acknowledged by trainees _(2026-03-28)_
5. **Skill Observations**: Track which skills were demonstrated during a shift (structured JSON: `{skill_name, demonstrated, notes, comment}`)
6. **Tasks Performed**: Log tasks completed during the shift (structured JSON: `{task, description, comment}`)
7. **Pipeline Progress**: Shift hours, shift count, and call count (with call type matching) automatically update training pipeline requirements. Draft reports defer progress until completed _(2026-03-28)_
8. **Performance Ratings**: 1-5 star ratings with strengths/improvement areas (encrypted at rest)
9. **Officer Analytics**: Org-wide analytics dashboard with per-trainee breakdown, status counts, and monthly trends (`GET /training/shift-reports/officer-analytics`) _(2026-03-29)_
10. **Trainee Stats**: Personal stats dashboard with total hours, calls, average rating, and monthly breakdown (`GET /training/shift-reports/my-stats`) _(2026-03-29)_

This integration allows training officers to document field observations, automatically advance trainees through their training programs based on shift activity, and track department-wide training progress through analytical dashboards.

### Shift Reports Settings _(2026-04-04)_

The **Shift Reports** settings tab (within Scheduling Settings) provides centralized configuration for the shift completion report workflow:

#### Checklist Timing Windows

| Setting                  | Default | Description                                            |
| ------------------------ | ------- | ------------------------------------------------------ |
| `start_of_shift_enabled` | `true`  | Whether start-of-shift equipment checklists are active |
| `end_of_shift_enabled`   | `true`  | Whether end-of-shift equipment checklists are active   |

#### Post-Shift Validation

| Setting                   | Default | Description                                                      |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| `enabled`                 | `true`  | Whether post-shift validation reminders are active               |
| `require_officer_report`  | `false` | Whether a shift completion report is mandatory after every shift |
| `validation_window_hours` | `2`     | Hours after shift end during which validation reminders are sent |

#### Report Form Section Toggles

Controls which optional sections appear on the shift completion report form (separate from trainee visibility):

| Toggle                            | Default | Controls                       |
| --------------------------------- | ------- | ------------------------------ |
| `form_show_performance_rating`    | `true`  | Performance rating stars/scale |
| `form_show_areas_of_strength`     | `true`  | Strengths text field           |
| `form_show_areas_for_improvement` | `true`  | Improvement text field         |
| `form_show_officer_narrative`     | `true`  | Free-form officer assessment   |
| `form_show_skills_observed`       | `true`  | Structured skills checklist    |
| `form_show_tasks_performed`       | `true`  | Structured tasks checklist     |
| `form_show_call_types`            | `true`  | Call type selection            |

#### Per-Apparatus-Type Skills and Tasks

Maps apparatus types to specific skills and tasks so the report form auto-populates relevant items based on the shift's assigned apparatus. Configured via an accordion UI in the settings panel.

**Example mapping:**

| Apparatus Type | Skills                                                                                                                                                      | Tasks                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Engine         | Pump operations, Hose deployment, Hydrant connection, Drafting, Foam operations, Attack line advancement, Water supply establishment, Apparatus positioning | Pump test, Hose load inventory, Nozzle inspection, Hydrant flow check                   |
| Ladder         | Aerial operations, Ground ladder deployment, Ventilation, Rescue, Elevated stream operations, Tower bucket operations                                       | Aerial extension test, Ground ladder inventory, Outrigger inspection, Bucket inspection |
| Ambulance      | Patient assessment, CPR/AED, IV access, Medication administration, Airway management, Splinting/immobilization                                              | Drug box inventory, Oxygen supply check, AED test, Stretcher inspection                 |

Departments can edit, add, or remove skills and tasks per apparatus type. When no mapping exists for a given type, the system falls back to the org-wide default skills and tasks lists.

#### Rating Scale Customization

| Setting               | Default              | Description                                                                                                                           |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rating_label`        | "Performance Rating" | Label displayed above the rating input                                                                                                |
| `rating_scale_type`   | "stars"              | Display type: "stars" (star icons) or "descriptive" (labeled buttons)                                                                 |
| `rating_scale_labels` | `null`               | Custom labels per rating level (e.g., `{1: "Needs Improvement", 2: "Developing", 3: "Competent", 4: "Proficient", 5: "Exceptional"}`) |

#### Save as Draft

Officers can save incomplete reports as drafts by enabling the `save_as_draft` flag on submission. Drafts:

- Do not trigger training pipeline progress
- Appear in the officer's **Drafts** view in ShiftReportsTab
- Can be edited and completed at any time
- Transition to `approved` or `pending_review` status on final submission, at which point pipeline progress is applied

#### Data Flow: Settings → Report Form

```
Scheduling Settings (ShiftReportsSettingsPanel)
    ↓ saves to org.settings["shift_reports"]
Checklist timing & post-shift validation

Training Module Config (training_module_configs table)
    ↓ provides
Form section toggles (form_show_*)
    ↓ controls
Report form UI (which sections are visible to officers)

Training Module Config (apparatus_type_skills / apparatus_type_tasks)
    ↓ filtered by
Shift's apparatus type
    ↓ populates
Skills and tasks checklists on the report form
```

#### Edge Cases

| Scenario                                  | Behavior                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| All form sections toggled off             | Only core fields (trainee, date, hours, calls) remain; form still submittable |
| Apparatus type with no mapped skills      | Falls back to org-wide default skills; if none, skills section is empty       |
| Save as draft with missing fields         | Saved successfully; validation deferred until final submission                |
| Trainee list when linked to a shift       | Auto-filters to only show shift members; ad-hoc reports show full member list |
| Rating scale "descriptive" with no labels | Falls back to numeric display (1-5)                                           |

---

## Shift Lifecycle

```
1. CREATE      → Admin creates shift (from template or manually)
2. SIGN UP     → Members sign up for open positions
3. ASSIGN      → Admin assigns remaining positions (if needed)
4. CONFIRM     → Members confirm their assignments
5. START       → Shift begins, attendance tracked
6. CALLS       → Calls/incidents logged during shift
7. END         → Shift ends, checkout recorded
8. FINALIZE    → Officer finalizes shift (snapshots data, creates draft reports)
9. FOLLOW-UP   → Officer completes draft reports, training pipeline updated
```

---

## Security

### Input Validation

- All inputs validated with Pydantic schemas
- Position values restricted to the 9 defined types
- Date validation prevents past-date signups
- Organization scoping on all queries

### Authorization

- Shift creation/deletion requires `scheduling.manage`
- Member assignment requires `scheduling.assign`
- Self-service signup requires only authentication
- Request review requires `scheduling.manage`
- All queries scoped to user's organization

### Data Integrity

- Foreign key constraints on all relationship fields
- Cascade delete on organization removal
- `UniqueConstraint(shift_id, user_id)` on `ShiftAssignment` prevents duplicate assignments
- `UniqueConstraint(shift_id, trainee_id)` on `ShiftCompletionReport` prevents duplicate reports _(2026-03-28)_
- `IntegrityError` catch on concurrent assignment attempts as a race condition fallback
- Overlap query scoped to ±1 day of `shift_date` to prevent false positives from ancient unclosed shifts
- `confirm_assignment` validates `organization_id` to prevent cross-org access
- Date range validation on time-off requests (`end_date >= start_date`)
- Pattern generation deduplicates `assigned_members` by `user_id`
- PATCH endpoints use `exclude_unset` so clients can explicitly clear optional fields
- Finalized shifts cannot be edited or deleted _(2026-03-28)_
- Shifts with associated completion reports cannot be deleted _(2026-03-28)_

---

## Recent Fixes (2026-02-27)

### Shift Pattern Weekday Convention

The frontend sends weekday numbers in JavaScript convention (0=Sunday) but the backend previously used Python's `date.weekday()` (0=Monday). Weekly patterns now convert Python weekday to JS convention before comparison, ensuring shifts land on the correct days.

### Route Ordering

`/shifts/open` is now defined before `/shifts/{shift_id}` to prevent route shadowing that made the open shifts endpoint unreachable (422 error).

### Data Enrichment

All shift responses now populate:

- `shift_officer_name` via User join
- `attendee_count` computed on list/calendar endpoints (was always 0)
- `user_name` on assignment, swap, time-off, and attendance responses
- Embedded shift data on `my-assignments` endpoint
- `min_staffing` from apparatus on shift responses

### Time String Handling

`formatTime()` handles bare time strings like `"08:00:00"` from the backend by prepending the shift date to form valid datetime strings. `getShiftTemplateColor()` parses hours directly from the time string instead of via `new Date()`.

### Dashboard

Dashboard changed from `getMyShifts()` (user-assigned only) to `getShifts()` to show all organization shifts on the Upcoming Shifts widget.

---

## Architecture Refactor (2026-02-28)

The scheduling module was refactored from a monolithic 1,200-line `SchedulingPage.tsx` into a proper modular architecture:

### What Changed

- **SchedulingPage** slimmed from ~1,200 lines to a thin orchestrator that delegates to the Zustand store and sub-components
- **Dedicated Zustand store** (`schedulingStore.ts`): Centralized state for shifts, templates, patterns, members, and apparatus with typed async actions
- **Module-scoped API service** (`modules/scheduling/services/api.ts`): All 20+ scheduling endpoints moved from the global `services/api.ts` into a dedicated client using `createApiClient()`
- **ShiftSettingsPanel**: Configuration panel for notification preferences, shift rules, and coverage settings (new Settings tab)
- **SchedulingNotificationsPanel**: Notification management for shift reminders and scheduling alerts
- **InlineConfirmAction** (`components/ux/InlineConfirmAction.tsx`): New reusable UX component for inline "Are you sure?" confirmations before destructive actions, with comprehensive tests
- **Scheduling store tests**: Unit tests covering store initialization, async actions, and state transitions
- **Backend service extraction**: `SchedulingService` class consolidates business logic previously scattered across endpoint handlers

### Migration Notes

If you have custom code importing scheduling functions from `@/services/api`, update to:

```typescript
import { schedulingService } from "@/modules/scheduling/services/api";
```

---

## Template Positions & Timezone Fixes (2026-03-15)

### Template Positions Carry to Crew Roster

Shift templates with defined `positions` and `min_staffing` values now persist these to created shifts via two new columns on the `shifts` table:

| Column         | Type              | Description                                                             |
| -------------- | ----------------- | ----------------------------------------------------------------------- |
| `positions`    | JSON, nullable    | Position definitions inherited from the template at shift creation time |
| `min_staffing` | Integer, nullable | Minimum staffing level inherited from the template                      |

Both direct shift creation and pattern-based bulk generation pass template staffing requirements through. In the `ShiftDetailPanel`, when an apparatus has no positions defined, the component falls back to shift-level positions, ensuring crew roster always displays the correct position structure.

**Alembic migration**: `20260314_0200_add_positions_to_shifts.py`

### Shift Timezone Display Fix

Two timezone display bugs were fixed:

1. **ShiftReportsTab**: Was using `toISOString()` (UTC) for today's date comparison instead of `getTodayLocalDate(tz)`. Reports now correctly filter based on the user's local date.

2. **ShiftDetailPanel `toTimeValue()`**: The function extracted `HH:MM` by string-splitting the ISO datetime on `'T'`, which returned the UTC time portion. For a shift starting at 2:30 PM Eastern (18:30 UTC), the edit form showed `18:30` instead of `14:30`. Now uses `Intl.DateTimeFormat` with the user's timezone to extract local `HH:MM`, and `localToUTC()` when saving edits back to the API.

### Edge Cases

| Scenario                                    | Behavior                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Shifts created before this migration        | `positions` and `min_staffing` are `NULL`; UI falls back to apparatus-level positions                                                       |
| `toTimeValue` with missing/invalid datetime | Returns empty string instead of crashing                                                                                                    |
| Template edits after shift creation         | Existing shifts retain original positions — only newly created shifts get updated values                                                    |
| Timezone-unaware shift times                | The `load` event listener (added 2026-03-14) stamps naive datetimes with UTC tzinfo, so all shift times are timezone-aware in API responses |

---

## Position Eligibility, Admin Sub-Pages & Equipment Checks (2026-03-19)

See the [CHANGELOG](../CHANGELOG.md) and [Wiki Scheduling Module](../wiki/Module-Scheduling.md) for full details on:

- Shift position eligibility system
- Rank eligible positions UI redesign
- Scheduling admin sub-pages (`/scheduling/templates`, `/scheduling/patterns`, `/scheduling/reports`, `/scheduling/settings`)
- Structured position slots with decline handling
- Dashboard shift display fixes
- Equipment check template builder, phone-first check form, and reports

---

## Permission Fixes & Shift Signup Improvements (2026-03-22)

### Permission Changes

- **Shift assignment broadened**: Assignment UI now works with `scheduling.manage` permission (previously required `scheduling.manage_assignments`)
- **Open Shifts visibility fix**: Self-signup button and Open Shifts tab fallback permission corrected for non-admin members
- **Redundant permission checks removed**: OpenShiftsTab and ShiftDetailPanel no longer perform redundant permission checks

### UI Changes

- **Calls/Incidents section removed**: Placeholder removed from shift detail panel (feature not yet implemented)
- **Dashboard shift filtering**: "My Upcoming Shifts" hides declined and cancelled assignments
- **Position editing**: Officers edit position assignments directly from the shift detail edit form

### Desktop Camera Scanning

Camera-based scanning now works on desktop browsers:

| Module | File                       | Description                                  |
| ------ | -------------------------- | -------------------------------------------- |
| Shared | `hooks/useHtml5Scanner.ts` | Reusable scanner hook with camera fallback   |
| Shared | `types/scanner.ts`         | Scanner configuration types                  |
| Shared | `constants/camera.ts`      | Camera resolution presets and error messages |

All scanner consumers (InventoryScanModal, MemberIdScannerModal, MemberScanPage) share the same camera initialization, error handling, and resolution logic.

### Edge Cases

| Scenario                     | Behavior                                        |
| ---------------------------- | ----------------------------------------------- |
| Desktop with no camera       | Error message displayed; manual entry available |
| Desktop with only webcam     | Falls back to user-facing camera                |
| Declined shift on dashboard  | Filtered from "My Upcoming Shifts"              |
| Cancelled shift on dashboard | Filtered from "My Upcoming Shifts"              |

---

## Bulk Actions, Staffing Visualization, Notifications & Bug Fixes (2026-03-24)

### New API Endpoint

```
GET /api/v1/scheduling/shifts/{id}/unavailable-members
```

Returns consolidated list of user IDs that cannot be assigned to a shift (members on leave, with approved time-off, or already assigned). Requires `scheduling.assign` permission. Used by ShiftDetailPanel to filter assignment dropdowns.

### Shift Assignment Notifications

Two notification pathways added:

**1. Assignment Notification** — triggered when a member is assigned to a shift via `_notify_shift_assignment()`:

- In-app notification with shift date, time, and position
- Optional email notification
- Times displayed in org timezone (not UTC)
- Settings stored in `org.settings.scheduling_assignment`

**2. Start-of-Shift Reminder** — scheduled task `run_shift_reminders()` runs every 30 minutes:

- Finds shifts starting within configurable lookahead window (default 2 hours)
- Sends in-app notification (and optional email) to assigned members
- Includes list of start-of-shift equipment checklists for the apparatus
- Marks shifts with `activities.start_reminder_sent = True` to avoid duplicates
- Settings stored in `org.settings.shift_reminders`:
  - `enabled` (bool, default True)
  - `lookahead_hours` (int, default 2)
  - `send_email` (bool, default False)
  - `cc_emails` (list[str], default [])

### Template Position Required/Optional Toggle

Template positions changed from `string[]` to structured `PositionEntry[]`:

| Field      | Type    | Description                                              |
| ---------- | ------- | -------------------------------------------------------- |
| `position` | String  | Position name (e.g., "officer", "driver")                |
| `required` | Boolean | Whether the position must be filled for minimum staffing |

Backward-compatible: bare strings in existing templates default to `required=true`. Frontend shows violet badge for required positions and muted for optional. Section renamed from "Required Positions" to "Crew Positions".

### Staffing Status Visualization

Shift cards and the crew info box now display staffing status:

| State                | Visual                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| Fully staffed        | Green CheckCircle2 icon on card, green background in crew box, ratio "4/4" |
| Understaffed         | Amber background in crew box, amber open position count, ratio "2/4"       |
| Staffing-based tints | Green tint overrides template color when full; amber when short            |

The text color on shift cards with custom hex colors now passes WCAG AA contrast checks (4.5:1 minimum). Functions in `utils/colorContrast.ts`:

- `relativeLuminance()` — WCAG 2.x luminance formula
- `contrastRatio()` — compares two luminance values
- `accessibleTextColor()` — iteratively adjusts until target contrast reached

### Bulk Actions

**My Shifts Tab:**

- Checkboxes on pending shift cards when 2+ pending assignments exist
- "Select All" toggle + "Confirm All" / "Decline All" action bar
- Optimistic UI: assignments update immediately, revert on API failure

**Requests Tab:**

- Inline "Approve" and "Deny" buttons directly on request cards
- "+ Notes" link opens review modal for reviewer comments
- Applied to both swap requests and time-off requests

**ShiftDetailPanel:**

- "Fill All Open" bulk assignment button when 2+ positions unfilled
- Position-first assignment flow: position dropdown first, member search below
- "Assign" button on open crew board slots pre-fills position
- After assignment, form resets position to next open slot

### UX Improvements

- **Selected shift highlight**: Violet ring on currently viewed shift across all calendar views
- **Collapsible additional options**: Shift creation form shows Start/End Date first; Custom Times, Apparatus, Officer, Notes in collapsible section
- **Searchable template dropdown**: Search input appears when >5 templates, filters by name/apparatus/category
- **Open/Specific swap selector**: Two-card radio buttons replace dropdown
- **Time-off conflict warning**: Amber banner listing conflicting shifts
- **Notification history link**: "Alerts" link on My Shifts tab filtered to `schedule_change` trigger type
- **Equipment check inline status**: Badge counts (pass/fail/in-progress/pending), action hints
- **Mobile note truncation**: 2-line `line-clamp-2` with ellipsis
- **Mobile touch targets**: 44px minimum (WCAG standard) on action buttons

### Bug Fixes (2026-03-24)

| Bug                                                      | Root Cause                                                                        | Fix                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Shift overlap false positives across UTC date boundaries | Open-ended shifts (no `end_time`) treated as infinitely long                      | Restrict to same `shift_date`: `and_(Shift.end_time.is_(None), Shift.shift_date == shift.shift_date)` |
| Shift assignment/reminder times in UTC                   | `_notify_shift_assignment()` and `run_shift_reminders()` used raw UTC times       | Convert to org timezone via `pytz` before formatting                                                  |
| All shifts defaulting to indigo color                    | `getShiftTemplateColor()` parsed full ISO string (`"2026-03-24T14:00:00"` → 2026) | Extract time after "T" split: `shift.start_time.split("T")[1]?.split(":")[0]`                         |
| Empty notes causing 422                                  | `editingNotesValue ?? undefined` passes empty string                              | Changed to `editingNotesValue \|\| undefined`                                                         |
| Pattern generation 422                                   | `GenerateShiftsRequest` required `pattern_id` in body (already URL param)         | Removed field from schema                                                                             |
| Member hours report empty                                | Queried `ShiftAttendance` (clock-in only)                                         | Changed to `ShiftAssignment` joined with `Shift`                                                      |
| Member hours report type mismatch                        | Endpoint returned flat array; frontend expected wrapped object                    | Wrapped in `{ members, period_start, period_end, total_members }`                                     |
| Missing first_name/last_name in report                   | `MemberHoursReport` schema lacked fields                                          | Added to both Pydantic schema and TS type                                                             |
| Dark mode poor contrast on scheduling buttons            | Interactive elements missing `dark:` modifiers                                    | Added `dark:text-*-400`, `dark:hover:bg-*-*/20` variants                                              |
| Shift card text unreadable in dark mode                  | `hexColorStyle()` set text to raw hex against 10% opacity bg                      | WCAG AA contrast calculation with iterative adjustment                                                |

### Code Quality

- Consolidated `ShiftDetailPanel.tsx` from 33 to 23 useState hooks (11 async-pending booleans grouped into `pending` state object)
- Extracted `INACTIVE_ASSIGNMENT_STATUSES` constant (replaces 3 inline `[DECLINED, CANCELLED]` lists)
- Deduplicated shift enrichment via `_enrich_shift_dict()` method
- Typed `getMyChecklists()` return as `ActiveChecklistRecord[]`

### Edge Cases

| Scenario                                            | Behavior                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Bulk confirm with API failure on one shift          | Optimistic UI reverts failed assignment; others remain confirmed |
| Template with bare string positions (pre-migration) | Defaults to `required=true` (backward-compatible)                |
| Shift with no `end_time` on different date          | No longer falsely overlaps; restricted to same `shift_date`      |
| Reminder for shift that already started             | Skipped — only shifts starting within lookahead window           |
| All positions filled via bulk assign                | "Fill All Open" button hidden                                    |
| Member on leave in assignment dropdown              | Filtered out via unavailable-members endpoint                    |
| Dark mode with light template color (e.g., #FFD700) | Text auto-darkened to maintain WCAG AA 4.5:1 contrast            |
| Notes field cleared to empty                        | Converted to `undefined` to prevent backend 422                  |

---

## Notification Cards, Deep-Linking & Standalone Equipment Checks (2026-03-26)

### Notification Metadata & Deep-Linking

Shift-related notifications now carry structured metadata for rich card rendering:

| Field                        | Type            | Description                                                           |
| ---------------------------- | --------------- | --------------------------------------------------------------------- |
| `notification_logs.metadata` | JSON (nullable) | Structured context: `shift_id`, `shift_date`, `checklist_count`, etc. |

**Alembic migration**: `20260326_0100_add_notification_metadata.py`

Notification cards use this metadata to render:

- **Contextual CTAs**: "View Shift" for assignment notifications, "Start Checklist" for equipment check reminders
- **Time-aware CTA**: "Start Checklist" shown only during the shift window; "View Shift" outside the window
- **Shift deep-links**: Clicking opens `/scheduling?tab=my-shifts` with the shift pre-selected

### Scheduling Page `?tab=` Query Parameter

`SchedulingPage.tsx` now reads the `?tab=` query parameter on mount:

| Parameter               | Tab                           |
| ----------------------- | ----------------------------- |
| `?tab=schedule`         | Schedule (calendar) — default |
| `?tab=my-shifts`        | My Shifts                     |
| `?tab=open-shifts`      | Open Shifts                   |
| `?tab=requests`         | Requests                      |
| `?tab=equipment-checks` | Equipment Checks              |

Invalid values fall back to the Schedule tab. This enables deep-linking from notifications, email links, and the Start Checklist CTA in notification cards.

### Expandable Notification Cards

`NotificationCard.tsx` redesigned with expand/collapse behavior:

- **Pinned-first sort**: Pinned notifications sorted to top across dashboard and inbox
- **Mark as read on collapse**: Notifications marked read only when collapsed (not on expand) to prevent accidental mark-as-read from quick glances
- **Smooth CSS transitions**: Height and opacity transitions on expand/collapse

### In-Process Scheduled Task Runner

`backend/main.py` now includes a built-in asyncio scheduled task runner:

- Replaces external cron for shift reminders, notification cleanup, and periodic tasks
- Tasks are idempotent — container restarts don't cause duplicate sends
- Runs within the FastAPI process as a background asyncio task
- Intervals configurable via organization settings

### Standalone Equipment Checks

Equipment checks are no longer tied exclusively to active shifts:

- Members can perform ad-hoc checks on any apparatus at any time
- Navigate to **Scheduling > Equipment Checks** tab to start
- Checks saved without shift association appear in reports as "ad hoc"
- Admin link added from Equipment Checks tab to template management

### Flat Scrollable Check Form

Equipment check form redesigned from tabbed compartments to a single flat scrollable view:

- All compartments displayed inline with section headers
- Sub-compartments merged under parent headings
- Section headers (`is_header: true` items) displayed as bold black text — not scored

### Text Check Type Change

The "Text" check type changed from free-form text input to read-only statement display:

- Used for safety reminders and instructions within checklists
- Not included in pass/fail scoring
- Example: "Verify all compartment doors are secure before moving apparatus"

### Critical Minimum Quantity

Quantity-type check items support `critical_minimum_quantity` threshold:

- Items below this value flagged as **critical** (red warning) even if above required minimum
- Validation: critical minimum must be ≤ required minimum

### Template Clone Fix

Template cloning now correctly copies:

- `is_header` field on check items
- `critical_minimum_quantity` field on quantity items

### EVOC Certification Integration

EVOC levels integrated across training, apparatus, and scheduling:

| Data                            | Location                   | Description                         |
| ------------------------------- | -------------------------- | ----------------------------------- |
| `users.evoc_level`              | Member profile             | Basic, Intermediate, Advanced       |
| `apparatus.required_evoc_level` | Apparatus record           | Minimum EVOC for operators          |
| Scheduling validation           | Driver/Operator assignment | Warning when member EVOC < required |

### Training Record Categories

Training records now include a `category` field (Fire, EMS, Hazmat, Rescue, etc.) for state reporting compliance. Virginia NCCR recertification standards added with category-based hour minimums.

### Elections — Event Attendee Import

Officers can import checked-in attendees from a linked event into an election's ballot list. Linked elections now display on event and minutes detail pages with status badges.

### Navigation Fixes

- `navigate(-1)` replaced with hardcoded parent page paths across all modules
- Breadcrumb navigation added to hierarchical pages
- Chrome label printing fixed via iframe-based approach with top-level `@page` rules

### App Startup

- MySQL readiness check with retry and exponential backoff
- Alembic migration head merge for divergent branches

### Apparatus Badge Fix

Apparatus type and status badges now render actual Lucide icon components instead of icon names as text.

### Edge Cases

| Scenario                                           | Behavior                                               |
| -------------------------------------------------- | ------------------------------------------------------ |
| Notification with no metadata                      | Basic card rendering without deep-link CTAs            |
| `?tab=invalid` in URL                              | Falls back to Schedule tab                             |
| Standalone check with no shift                     | Saved as "ad hoc"; included in reports                 |
| Section header in scoring                          | Excluded from pass/fail calculations                   |
| Template clone with headers                        | `is_header` and `critical_minimum_quantity` preserved  |
| Container restart during scheduled task            | Tasks resume; idempotent checks prevent duplicates     |
| MySQL not ready at startup                         | Retries up to 5 times with exponential backoff         |
| EVOC not set for member                            | Warning on driver assignment; assignment still allowed |
| Event attendee already in ballot                   | Skipped silently; count reflects new additions only    |
| `navigate(-1)` from deep link                      | Now navigates to hardcoded parent page                 |
| Finalize shift with incomplete end-of-shift checks | Blocked; Finalize button disabled                      |
| Finalize shift that hasn't ended yet               | Finalize button not shown                              |
| Finalize already-finalized shift                   | Returns 400 error                                      |
| Delete finalized shift                             | Blocked with descriptive error                         |
| Delete shift with completion reports               | Blocked with descriptive error                         |
| Draft auto-creation fails for one trainee          | Logged; remaining trainees processed                   |
| Duplicate report for same shift + trainee          | Unique constraint prevents; descriptive error returned |
| Auto-populate preview for trainee not on shift     | Returns zeroed data                                    |

---

## Shift Finalization & Completion Reports (2026-03-28)

### New Data Model Fields

| Table              | Column         | Type                   | Description                                     |
| ------------------ | -------------- | ---------------------- | ----------------------------------------------- |
| `shifts`           | `call_count`   | Integer, nullable      | Aggregate call count snapshot at finalization   |
| `shifts`           | `total_hours`  | Float, nullable        | Total attendance hours snapshot at finalization |
| `shifts`           | `is_finalized` | Boolean, default=False | Whether the shift has been finalized            |
| `shifts`           | `finalized_at` | DateTime, nullable     | When the shift was finalized                    |
| `shifts`           | `finalized_by` | FK → users, nullable   | Officer who finalized the shift                 |
| `shift_attendance` | `call_count`   | Integer, nullable      | Per-member call participation count             |

### New API Endpoints

| Method | Path                                      | Description                                                  |
| ------ | ----------------------------------------- | ------------------------------------------------------------ |
| `POST` | `/api/v1/scheduling/shifts/{id}/finalize` | Finalize shift with data snapshots and draft report creation |

### Finalization Data Flow

```
Officer clicks "Finalize Shift"
    ↓
Pre-finalization checklist validates end-of-shift equipment checks
    ↓
POST /scheduling/shifts/{id}/finalize
    ↓
Backend:
  1. Validates shift has ended and is not already finalized
  2. Queries ShiftCall records → snapshots call_count on shift
  3. Sums ShiftAttendance.duration_minutes → snapshots total_hours
  4. For each attendee: counts calls from responding_members → per-member call_count
  5. Sets is_finalized=true, finalized_at, finalized_by
  6. For each attendee with active ProgramEnrollment:
     Creates ShiftCompletionReport (review_status="draft")
     Pre-populates hours and calls from shift data
  7. Sends notification to officer with draft count
    ↓
Frontend shows "Finalized" badge, hides edit controls
```

---

## Shift Report Analytics (2026-03-29)

### Officer Analytics Endpoints

| Method | Path                                                | Description                                                           |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/api/v1/training/shift-reports/officer-analytics`  | Org-wide totals, per-trainee breakdown, status counts, monthly trends |
| `GET`  | `/api/v1/training/shift-reports/by-officer`         | Reports filed by current officer                                      |
| `GET`  | `/api/v1/training/shift-reports/trainee/{id}`       | Reports for a specific trainee                                        |
| `GET`  | `/api/v1/training/shift-reports/trainee/{id}/stats` | Stats for a specific trainee                                          |

### Trainee Endpoints

| Method | Path                                        | Description                                      |
| ------ | ------------------------------------------- | ------------------------------------------------ |
| `GET`  | `/api/v1/training/shift-reports/my-reports` | Trainee's approved reports (visibility-filtered) |
| `GET`  | `/api/v1/training/shift-reports/my-stats`   | Trainee's aggregate statistics                   |

### ShiftReportsTab View Modes

| View               | Who Sees It       | Content                                                                |
| ------------------ | ----------------- | ---------------------------------------------------------------------- |
| **My Reports**     | Trainees          | Received approved reports with acknowledgment                          |
| **Filed by Me**    | Officers          | Reports the officer has filed                                          |
| **Pending Review** | Training officers | Reports awaiting review approval                                       |
| **Flagged**        | Training officers | Reports flagged for follow-up with re-review capability _(2026-04-07)_ |
| **Drafts**         | Officers          | Auto-created drafts from finalization                                  |
| **Create**         | Officers          | New report form with auto-population                                   |

---

## Skill Scoring, Batch Review & Security Hardening (2026-04-07)

### New Endpoints

| Method | Path                                          | Description                                        |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| `POST` | `/api/v1/training/shift-reports/batch-review` | Batch approve/flag up to 100 reports at once       |
| `GET`  | `/api/v1/training/shift-reports/flagged`      | Get flagged reports for follow-up review           |
| `GET`  | `/api/v1/training/module-config/skill-names`  | Get active SkillEvaluation names for skill linkage |

### 1-5 Skill Scoring

Each observed skill in a shift completion report can now be assigned a 1-5 score (1=Needs work → 5=Excellent). Scores flow to `SkillCheckoff` records and competency score history. The `SkillObservation` schema adds a `score` field (`int | None`, ge=1, le=5). Score buttons use a consistent violet color theme.

### Batch Review

Checkboxes on report cards in the pending-review and flagged views, select-all toggle, and "Approve Selected" / "Flag Selected" action buttons. `BatchReviewRequest` schema accepts `report_ids` (list, max 100), `review_status`, and optional `reviewer_notes`.

### Flagged Reports View

New "Flagged" tab in ShiftReportsTab with `GET /flagged` endpoint. Flagged reports can be re-reviewed and approved.

### Trainee & Officer Names

`ShiftCompletionReport` model adds `trainee` and `officer` relationships to `User`. Response schema adds `trainee_name` and `officer_name`. Cards show "Trainee Name — Date" in header.

### Review Modal Content

Review modal now renders full report content (hours, calls, rating, strengths, improvements, narrative, skills with scores, tasks).

### Skill Linkage in Apparatus Settings

`ShiftReportsSettingsPanel` shows green (linked to SkillEvaluation) or amber (unlinked) tags for each apparatus-type skill. Powered by `GET /module-config/skill-names`.

### Security

- **Authorization bypass fixed** on `GET /shift-reports/{report_id}` — now requires trainee, officer, or `training.manage`
- **Audit logging** added: `shift_report_created`, `shift_report_updated`, `shift_report_reviewed`, `shift_report_acknowledged`, `shift_reports_bulk_submitted`

### Bug Fixes

- MySQL `Decimal` TypeError in weekly/monthly calendar `SUM()` — wrapped in `float()`
- `??` → `||` for 35 optional form fields in prospective-members and apparatus
- `shift_date` type made required in TypeScript types
- Unused `LogOut` import removed from `MyShiftsTab`
- Center-aligned numeric columns in trainee summary table

---

## Shift Report Creation Redesign, Offline Support & Print (2026-04-07 — 2026-04-09)

### Shift-First Batch Workflow

The report creation flow has been redesigned from a one-report-at-a-time model to a **shift-first batch workflow**:

1. Officer selects a shift → system loads all crew members for that shift
2. Officer fills in **shared data** once (hours, calls, call types)
3. For each **trainee**, officer expands an evaluation panel (rating, skills with 1-5 scores, tasks, narrative)
4. Non-trainees receive hours/calls credit only — no evaluation UI shown
5. **Submit All** sends `POST /api/v1/shift-completion-reports/batch` and returns `{created, skipped}` counts

**New endpoint:** `POST /api/v1/shift-completion-reports/batch`

Accepts a `BatchShiftReportCreate` payload with:

- Shared fields: `shift_id`, `shift_date`, `hours_on_shift`, `calls_responded`, `call_types`
- Per-member evaluations: `trainee_id`, `performance_rating`, `skills_observed`, `tasks_performed`, `areas_of_strength`, `areas_for_improvement`, `officer_narrative`
- `save_as_draft: bool` — optionally save as drafts instead of submitting for review

### Review Workflow Improvements (2026-04-07)

- **Require reason when flagging**: Flagging a report now requires entering a reason (modal blocks submission without text)
- **Reviewer name on cards**: `ShiftCompletionReportResponse` gains a `reviewer_name` field resolved from the `reviewed_by` → `User` relationship. Displayed alongside the review status badge
- **Flagged report explanation**: Flagged reports show the reviewer's reason and a "Re-review" action in all view modes
- **Server error messages in toasts**: Toast notifications show actual API error messages instead of generic "Failed to submit"
- **Score labels inline**: 1-5 skill score buttons show descriptive text (Needs work, Developing, Competent, Proficient, Excellent) alongside the buttons, not just as tooltips
- **Task defaults visible after selection**: Apparatus-type task defaults remain visible after selecting a task, and the Add Task dialog pre-populates from the mapping

### Offline Support

#### Draft Auto-Save (`utils/shiftReportDrafts.ts`)

In-progress shift report forms are auto-saved to `localStorage`:

- Stores shift ID, form data, crew selections, trainee evaluations, crew remarks, and timestamp
- Maximum 20 drafts retained (LRU eviction)
- Functions: `saveDraft()`, `loadDraft()`, `deleteDraft()`, `listDrafts()`, `hasDraft()`

#### Offline Submission Queue (`utils/shiftReportOfflineQueue.ts`)

Reports submitted while offline are queued in IndexedDB and synced on reconnection:

- Same architecture as equipment check offline queue
- Stores full `BatchShiftReportCreate` payload, queued timestamp, and retry count
- Functions: `enqueueShiftReport()`, `listPendingReports()`, `dequeueShiftReport()`, `markReportRetry()`, `pendingReportCount()`

### Shift Report Print Page

**Route:** `/scheduling/shift-reports/print`  
**Component:** `ShiftReportPrintPage`

Paper-formatted shift completion report (8.5" × 11" letter size):

- Department branding (org name/logo) in header
- Structured sections: shift info, trainee/officer names, hours, calls, rating, strengths, improvements, narrative, skills with scores, tasks, reviewer notes
- Signature lines for officer and trainee
- Auto-triggers browser print dialog after loading
- Accessed via "Print" button on report cards in ShiftReportsTab

### Department-Level Shift Report Settings (2026-04-08)

Extended the `ShiftReportsSettingsPanel` with:

- **Editable tag lists**: Skills and tasks per apparatus type managed via `EditableTagList` component with inline add/remove UI
- **Granular department toggles**: Additional behavioral toggles beyond form section visibility

### Equipment Check Improvements (2026-04-07)

- **Incomplete checklist warning**: Confirmation dialog when submitting with unanswered items
- **Resume in-progress checks**: `PUT /api/v1/equipment-checks/checks/{id}/complete` for completing remaining items
- **MyChecklistsPage**: "Resume" button with completion percentage for in-progress checks

### Frontend Architecture Changes

New shared components extracted to reduce code duplication:

| Component              | File                                                     | Purpose                             |
| ---------------------- | -------------------------------------------------------- | ----------------------------------- |
| `EditableTagList`      | `modules/scheduling/components/EditableTagList.tsx`      | Inline add/remove tag list          |
| `ReportContentDisplay` | `modules/scheduling/components/ReportContentDisplay.tsx` | Renders report content sections     |
| `StarRating`           | `modules/scheduling/components/StarRating.tsx`           | Reusable star rating display        |
| `AssignmentActions`    | `pages/scheduling/AssignmentActions.tsx`                 | Crew assignment action buttons      |
| `CrewBoardSlot`        | `pages/scheduling/CrewBoardSlot.tsx`                     | Individual crew board position slot |
| `PositionEditor`       | `pages/scheduling/PositionEditor.tsx`                    | Inline position editing             |
| `ShiftReportPrintPage` | `pages/scheduling/ShiftReportPrintPage.tsx`              | Print-formatted shift report        |

New shared constants:

| File                                                   | Contents                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `modules/scheduling/constants/shiftReportConstants.ts` | Call types, default skills/tasks, score labels, status display mappings |

New utility modules:

| File                               | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `utils/shiftReportDrafts.ts`       | localStorage-based auto-save for report forms |
| `utils/shiftReportOfflineQueue.ts` | IndexedDB-backed offline submission queue     |

### New Routes

| Route                             | Component              | Description                  |
| --------------------------------- | ---------------------- | ---------------------------- |
| `/scheduling/shift-reports/print` | `ShiftReportPrintPage` | Print-formatted shift report |

### New API Endpoints

| Method | Path                                            | Description                                  |
| ------ | ----------------------------------------------- | -------------------------------------------- |
| `POST` | `/api/v1/shift-completion-reports/batch`        | Batch-create reports for all crew on a shift |
| `PUT`  | `/api/v1/equipment-checks/checks/{id}/complete` | Complete remaining items on incomplete check |

### Edge Cases (2026-04-07 — 2026-04-09)

| Scenario                                         | Behavior                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Batch create with mixed trainee/non-trainee crew | Non-trainees get hours/calls credit; no evaluation data     |
| Reports already exist for some crew              | Existing reports skipped; `skipped` count returned          |
| Offline queue drain on reconnection              | Reports submitted in order; no duplicates                   |
| Draft auto-save limit exceeded                   | Oldest draft evicted (LRU)                                  |
| Print page for redacted report                   | "[Redacted]" placeholder for redacted fields                |
| Resume incomplete check after template changes   | New items appear unanswered; orphaned answers preserved     |
| Submit check with 0 items answered               | Confirmation dialog warns; still allowed                    |
| Flagging without reason text                     | Modal blocks submission                                     |
| Batch create as drafts                           | All reports saved as drafts; no pipeline progress triggered |

---

## Member Summaries, Trainee Escalation & Richer Reminders (2026-05-02)

### New Scheduled Tasks

Two scheduled tasks were added in `backend/app/services/scheduled_tasks.py`
(register them with whatever runs the existing scheduled tasks — see the
recommended crontab at the top of that file):

| Task                        | Cadence      | Gate                                                                       | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `end_of_shift_summary`      | Every 30 min | `org.settings["shift_reports"]["member_summary"].enabled` (default `true`) | Sends each member who attended a shift that ended within `lookback_hours` (default 4) a personalized email **and** in-app summary (date, time range, apparatus, hours, calls, report link). When `require_finalized` (default `true`) is `false`, unfinalized shifts are still summarized and the message is labeled **"Preliminary Shift Summary"**. Idempotent per member via `shift.activities["member_summaries_sent"]` |
| `trainee_report_escalation` | Daily 08:00  | `org.settings["shift_reports"]["follow_up"].enabled` (default `true`)      | For each **approved** `ShiftCompletionReport` not acknowledged by the trainee within `acknowledgment_days` (default 7), sends an escalation reminder to the trainee and notifies the filing officer + training officers. Rate-limited to `max_reminders` (default 3) tracked via the report's `review_history` JSON                                                                                                         |

### Low-Rating Officer Alert

`shift_completion_service.py` alerts **training officers** (excluding the filing
officer, to avoid self-alerts) when an approved report has either:

- `performance_rating <= low_rating_threshold` (default `2` on the 5-point
  scale; set the threshold to `0` to disable this trigger entirely), **or**
- non-empty `areas_for_improvement` text.

The notification deep-links to `/scheduling?tab=shift-reports&report=<id>`.

### Richer Shift Reminders

`run_shift_reminders` now builds a structured message including the apparatus,
an active-member crew roster (capped at 8, then `+N more`), assigned
start-of-shift checklists, and a **Mark Arrival** button. Roster and reminder
queries filter on `User.is_active`.

> **Email default:** `shift_reminders.send_email` is read with a default of
> `True` in the code, so reminder emails are sent unless an org explicitly sets
> `send_email = false`. (The docstring comment in `scheduled_tasks.py` still
> reads `default False` and is stale relative to the code.)

### Deep-Link Corrections

| Context        | Old (broken) link                                | New link                                            |
| -------------- | ------------------------------------------------ | --------------------------------------------------- |
| Shift check-in | `/scheduling/checkin?shift=<id>&user=<id>`       | `/scheduling/checkin?shift=<id>` (dropped `?user=`) |
| Shift report   | `/scheduling/reports/<id>` (route never existed) | `/scheduling?tab=shift-reports&report=<id>`         |

### MyShiftsTab Past View

`MyShiftsTab` honors `?view=past` to open directly on past shifts and
synthesizes "completed" walk-on entries from `ShiftAttendance` rows that have no
matching `ShiftAssignment` (e.g. deleted assignments / walk-ons). The dashboard
**Standby** card deep-links to `/scheduling?tab=my-shifts&view=past`.

### Org Settings Keys (summary)

| Key                                              | Default | Purpose                                                         |
| ------------------------------------------------ | ------- | --------------------------------------------------------------- |
| `shift_reminders.send_email`                     | `true`  | Send reminder emails (code default)                             |
| `shift_reminders.cc_emails`                      | `[]`    | Extra CC recipients on reminder emails                          |
| `shift_reports.member_summary.enabled`           | `true`  | Enable `end_of_shift_summary`                                   |
| `shift_reports.member_summary.lookback_hours`    | `4`     | Window of recently-ended shifts to summarize                    |
| `shift_reports.member_summary.require_finalized` | `true`  | When `false`, summarize unfinalized shifts as "Preliminary"     |
| `shift_reports.follow_up.enabled`                | `true`  | Enable `trainee_report_escalation` + low-rating alert           |
| `shift_reports.follow_up.acknowledgment_days`    | `7`     | Days before an unacknowledged approved report escalates         |
| `shift_reports.follow_up.max_reminders`          | `3`     | Cap on escalation reminders per report                          |
| `shift_reports.follow_up.low_rating_threshold`   | `2`     | Rating at/below which the low-rating alert fires (`0` disables) |

### Migration

`20260502_0001` backfills NULL boolean columns in `training_config` so legacy
rows no longer break boolean gating.

**Source:** `scheduled_tasks.py`, `shift_completion_service.py`, `scheduling.py`.

---

## Shift Lifecycle, Personal Calendars, Automation & Safeguards (2026-07-16)

A broad review closing operational gaps from shift start-up through close-out,
adding member conveniences, and fixing correctness/security issues.

### Running a shift end-to-end

- **Per-shift officer authority** — the named shift officer manages that shift's
  crew, attendance, calls, finalize, and cancellation without a department-wide
  grant (see the Permissions note above).
- **Live readiness panel** (`ShiftDetailPanel`) — during the shift, shows
  present-vs-assigned, staffing vs. target (understaffed flag), and outstanding
  start-of-shift equipment checks, instead of that state only appearing in the
  finalize dialog.
- **Cancel a shift** — `Shift.status` (`ShiftStatus`: `scheduled`/`cancelled`)
  plus `cancelled_at`/`cancelled_by`/`cancellation_reason`. `cancel_shift`
  preserves the record, marks active assignments cancelled, notifies the crew;
  finalized shifts can't be cancelled; cancelled shifts are excluded from
  open-shift signup.
- **Reopen / unfinalize** — `reopen_shift` clears the finalized flag for
  corrections (audit-logged); re-finalizing re-snapshots.
- **Crew pass-down** — `Shift.pass_down_notes`, captured at finalize, shown on
  the shift, and surfaced to the next crew on the same apparatus via
  `GET /shifts/{id}/handoff`.

### Close-out enforcement (opt-in)

- **Require end-of-shift equipment checks** — `finalize_shift` now enforces
  this server-side when the department enables it (previously a UI-only
  disabled button that a direct API call bypassed). The officer can override
  with a reason (audit event `shift_finalized_check_override`).
- **Restrict check-in to assigned members** — `member_check_in` rejects
  non-rostered members (open shifts exempt).
- **Understaffed shifts** are flagged in the finalize checklist.

### Member conveniences

- **Personal calendar (ICS) feed** — per-user `User.calendar_feed_token`; the
  member subscribes via a private token URL served by the public endpoint (see
  Endpoints). Managed from **My Shifts → "Subscribe to my shifts"**.
- **Overtime / hours advisory** — soft, non-blocking warning when an assignment
  or self-signup pushes a member's scheduled hours in a trailing window over
  the department cap. Returned as `overtime_warnings` (see the response-model
  fix below).

### Training integration

- **Training-position crew slots** — `ShiftAssignment.is_training`,
  `training_program_id`, `training_evaluator_id`. On finalize,
  `_create_draft_reports_for_trainees` drafts a completion report against the
  linked program with the evaluator as reviewer.

### Automation

- **Automatic shift generation** — daily `shift_pattern_generation` task
  (`scheduled_tasks.py`, registered in `TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`/
  `SCHEDULE`) calls `auto_generate_shifts_for_org` to keep active patterns
  generating shifts to the configured horizon. Idempotent per pattern.

### New / changed endpoints

| Method | Path                                      | Notes                                                            |
| ------ | ----------------------------------------- | ---------------------------------------------------------------- |
| `POST` | `/api/v1/scheduling/shifts/{id}/cancel`   | Cancel a shift (manage or shift officer)                         |
| `POST` | `/api/v1/scheduling/shifts/{id}/reopen`   | Reopen a finalized shift (manage or shift officer; audit-logged) |
| `GET`  | `/api/v1/scheduling/shifts/{id}/handoff`  | Previous crew's pass-down for this apparatus                     |
| `GET`  | `/api/v1/scheduling/calendar-feed`        | Mint/return the member's ICS token + path                        |
| `POST` | `/api/v1/scheduling/calendar-feed/rotate` | Rotate the ICS token                                             |
| `GET`  | `/api/public/v1/calendar/{token}.ics`     | Public, token-protected personal shift feed                      |

`POST /shifts/{id}/finalize` gained `override_incomplete_checks`,
`override_reason`, and `pass_down_notes`. Assign/signup responses now include
`evoc_warnings` and `overtime_warnings`.

### New `org.settings["scheduling"]` keys

| Key                            | Default | Purpose                                                                            |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| `require_end_of_shift_checks`  | `false` | Block finalize while end-of-shift checks are outstanding (officer override logged) |
| `restrict_checkin_to_assigned` | `false` | Only rostered members may check in (open shifts exempt)                            |
| `max_hours_per_window`         | `null`  | Overtime cap; `0`/absent disables the advisory                                     |
| `hours_window_days`            | `7`     | Trailing window for the overtime advisory                                          |
| `auto_generate_enabled`        | `false` | Enable rolling automatic shift generation from patterns                            |
| `auto_generate_weeks`          | `4`     | How many weeks ahead auto-generation fills                                         |

### Correctness & security fixes

- **`response_model` was stripping advisories** — `ShiftAssignmentResponse` had
  no `evoc_warnings`/`overtime_warnings` fields, so the EVOC and overtime
  warnings the endpoints attached never reached the client. Fields added; both
  now surface on assign and self-signup.
- **S4** — `update_assignment` can no longer force an assignment to `confirmed`
  (confirmation stays self-only). **S8** — `run-task` now requires the
  wildcard-only `system.run_tasks` permission. **C5** — manual overnight shifts
  roll the end to the next day on create/edit.

### Migrations

- `20260720_0001` — `shift_assignments` training-slot fields + `shifts`
  lifecycle (`status`, `cancelled_at`, `cancelled_by`, `cancellation_reason`).
- `20260721_0001` — `users.calendar_feed_token`.
- `20260722_0001` — `shifts.pass_down_notes`.

**Source:** `models/training.py`, `schemas/scheduling.py`,
`services/scheduling_service.py`, `services/shift_eligibility_service.py`,
`api/v1/endpoints/scheduling.py`, `api/public/calendar.py`,
`services/scheduled_tasks.py`, `core/permissions.py`.

---

## Supply Tracking: Inventory ↔ Equipment Checks (2026-08-10)

An equipment check produces a **report**: a scheduled, signed pass over a whole
apparatus. It was also the only write path into a truck's stock, so a crew that
used the last of something mid-shift had nowhere to put that fact. This closes
the loop between the shelf (Inventory) and the truck (Equipment Checks).

### New pages

| URL                               | Page                                                                | Permission                                                                |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/scheduling/supply/expiring`     | Expiring on Apparatus — the supply worklist                         | any of `scheduling.manage`, `equipment_check.view`, `inventory.view`      |
| `/scheduling/apparatus-inventory` | Apparatus Inventory — standing view of one truck, outside any check | any of `equipment_check.submit`, `equipment_check.view`, `inventory.view` |

The worklist is reached from the **Supply** tile on the Scheduling hub (which
carries a count badge) and from the Gear Admin hub. The apparatus view is
reached from **My Equipment Checklists → Apparatus Inventory**.

### Schema

| Object                                                                     | Purpose                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_item_deployed_lots`                                                 | One row per lot's presence on one position. A position's count is their **sum**, its expiration the **earliest**. `inventory_lot_id` is `SET NULL` and lot number/expiration are **snapshotted**, so a consumed shelf lot does not erase the truck's record |
| `check_template_items.quantity_on_truck`                                   | The live count. **NULL = never counted**; the target stands in                                                                                                                                                                                              |
| `check_template_items.restock_needed` (+ `_reported_by` / `_at` / `_note`) | A report raised by whoever used the unit, at the time they used it                                                                                                                                                                                          |
| `shift_equipment_check_items.expiration_found`                             | The counterpart to `serial_found` / `lot_found`, written back onto the template item on submit                                                                                                                                                              |

### Endpoints

All under `/api/v1/equipment-checks`. **Writes accept `equipment_check.submit`**
— the default member position — as well as the manage permissions.

```
GET    /supply/expiring-items?days_ahead=30
GET    /supply/item-deployments/{inventory_item_id}
GET    /apparatus/{apparatus_id}/inventory
POST   /items/{id}/used            DELETE /items/{id}/used
PUT    /items/{id}/quantity        POST   /items/{id}/swap
GET    /items/{id}/deployed-lots   PUT    /items/{id}/deployed-lots/{lot_id}
GET    /templates/{id}/inventory-matches
POST   /templates/{id}/inventory-links
```

### Behaviour that is easy to get wrong

- **Expiry is decided server-side**, recomputed from the soonest date aboard. A
  client-supplied `is_expired` is ignored: that flag is what force-fails a
  safety-critical item.
- **Expired shelf stock is not ready stock** — excluded from the count, flagged
  in the payload, and refused by the swap.
- **Consumption draws first-expiring-first-out.** Undated lots sort last.
- **A recount reconciles against the lots**: short comes off soonest-first, over
  lands in an undated row.
- **A restock report clears only when the truck is back at target.** Two of four
  back is still a truck short two.
- **A quantity item arrives on the check form carrying the running on-truck
  count and with no pass/fail status.** Seeding a status let a crew submit a
  sixty-item check untouched and file a complete report against a truck nobody
  had looked at.

### Also in this release

- **Catalog linking at add time.** The template builder's quick-add bar searches
  the inventory catalog as you type; the toolbar carries a linked/unlinked count.
  A reviewed bulk pass proposes a link for every unlinked position on an existing
  template — **only exact name matches are pre-selected**, because "Oxygen Mask"
  scores high against both the adult and the pediatric mask.
- **A weekly `supply_expiration_alerts` task**, split by whether an in-date lot is
  actually behind each row.
- **A lot swap now writes a `swap` changelog entry** carrying the previous and new
  lot/expiration and the shelf lot it came from. It previously took a `user`
  parameter and never used it, so the one change to a template nobody typed was
  also the only one with no author.

### Migrations

- `20260810_0005` — `shift_equipment_check_items.expiration_found`
- `20260810_0006` — `check_template_items.restock_needed` + three companions,
  `idx_check_item_restock`
- `20260810_0007` — `check_template_items.quantity_on_truck`
- `20260810_0008` — `check_item_deployed_lots` + data migration of existing
  single-lot rows

Renumbered from `_0003`–`_0006` after main landed the email-template pair at
those ids. **Run `alembic heads` after merging main** — a duplicate revision id
is not a conflict git can see, and the backend crashes on startup rather than at
review.

**Source:** `models/apparatus.py`, `schemas/equipment_check.py`,
`services/equipment_check_service.py`, `services/inventory_service.py`,
`api/v1/endpoints/equipment_check.py`, `api/v1/endpoints/inventory.py`,
`services/scheduled_tasks.py`.

---

## Crew Board & Dashboard Fixes (2026-08-10)

- **A designated shift officer held no seat.** `_sync_officer_assignment` read
  `BasicApparatus.positions` alone to decide whether the board had an "officer"
  position, while the response builder resolves the list differently — the
  apparatus's riding positions when it has them, the shift's own otherwise. The
  two disagreed on **exactly the departments running the full Apparatus module**,
  which deliberately does not model riding positions. The panel named a Shift
  Officer who appeared on no roster and counted toward no staffing total. The
  sync now resolves seats the same way the response does.
- **Today's shift read as yesterday's.** `shift_date` is a calendar date with no
  time and no zone; padding it to `T00:00:00` and handing it to a zone-aware
  formatter rendered Aug 10 as "Sun, Aug 9" for any viewer west of the browser's
  offset. `formatCalendarDate()` anchors and formats in UTC, and is used for
  shift dates and leave-of-absence ranges.
- **Two filter controls painted over their neighbours.** `form-input` carries
  `w-full`; pinned `sm:flex-none` with no width of its own, that resolves against
  the whole row rather than the space beside the icon and label preceding it.
- **"1 calls"** — pluralised on the report card and in the review modal.

---

_Last Updated: August 10, 2026_

## August 12–14, 2026 scheduling/apparatus connections

Shift settings now travel through organization-scoped `GET/PUT/DELETE /api/v1/scheduling/shift-settings`
endpoints and persist in `SchedulingModuleConfig`; frontend state and caches must
be keyed by organization. Shift templates can reference vehicle fields and
apparatus crew positions use rank IDs as canonical data, retaining legacy names
for display only. Completion/report flows remain available to authorized
members after equipment-check administration was tightened. Related completion
actions archive matching notifications by organization plus entity/action ID,
not by presentation text. See
[training lesson 19](./training/19-august-2026-release-changes.md#apparatus-crew-seats-and-scheduling-settings).

---

## Fleet Board & Check Log (2026-08-16)

The Equipment Checks tab was a personal to-do list serving three audiences. It
is now organised around the **apparatus**, with a check log that reports on
checks that _did not happen_.

### Why the expected side had to be reconstructed

`shift_equipment_checks` records only checks that were performed. Every count
derived from that table alone uses "checks done" as its own denominator and can
never fall below 100% — which is why `checks_expected` on the compliance report
was hardcoded to `0`. `EquipmentReadinessService` rebuilds the expected side
from **(shift × resolved template)**, the same pairing `get_my_checklists`
walks for one user, and left-joins the submissions onto it. A missed check is
therefore a row with a null `checkId`.

Three rules the reconstruction honours, each of which silently produces a
plausible wrong number when left implicit:

1. **Grid columns are shared duty dates; rates are per-apparatus occasions.** A
   rig on a weekly check would read as neglected if its rate were measured
   against a fortnight of calendar days. `B-7` gets four squares in a fortnight
   and a correct 100%.
2. **Out of service is not missed.** Availability is reconstructed from
   `apparatus_status_history` — not the apparatus's _current_ status, which
   cannot express a rig that went to the shop last Tuesday and came back
   Friday. Those days leave the denominator instead of counting against the
   crew.
3. **Apparatus identity comes from the shift, not the check.**
   `ShiftEquipmentCheck.apparatus_id` is an FK to `apparatus.id` and is NULL for
   a department running `BasicApparatus` (see `utils/apparatus_ref`), so
   grouping checks by that column would drop every row for those departments.
   Shift-based checks are attributed through `shifts.apparatus_id`.

### Readiness is a claim, so it carries its reason

`readinessReason` is non-optional and rendered next to every pill. Only two
things take a rig off the road — the apparatus module's own status
(`ApparatusStatus.is_available`) and an item a crew marked `out_of_service` —
because those are the two places a human made that call explicitly. Everything
else (missed checks, failed items, an unfinished check) is _needs attention_.

### Routes

| Route                                | Purpose                                                      | Permission                                                                   |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `/scheduling/equipment`              | Fleet board — one card per apparatus                         | any of `equipment_check.view`, `scheduling.manage`                           |
| `/scheduling/equipment/checks`       | Check log, fleet-wide (grid + log)                           | any of `equipment_check.submit`, `equipment_check.view`, `scheduling.manage` |
| `/scheduling/equipment/:apparatusId` | Apparatus detail — Checks / Inventory / Findings / Check log | any of `equipment_check.view`, `scheduling.manage`                           |

The Equipment Checks tab (`EquipmentChecksTab`) branches on
`equipment_check.view`: holders get the fleet board, everyone else keeps
`MyChecklistsPage`. That is not a preference — the fleet endpoint is gated and
would 403 a plain member.

### Endpoints

All under `/api/v1/equipment-checks`.

| Method | Path     | Notes                                                                                                                                                                                                                                                                           |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/fleet` | Readiness roll-up. `equipment_check.view`. Params: `strip_dates` (1–90), `expiring_days` (1–365)                                                                                                                                                                                |
| `GET`  | `/log`   | Expected-vs-actual. Open to any authenticated member; **the server sets the scope** — without `equipment_check.view` the caller gets only their own checks and no grid, because a matrix of one member's checks reads as fleet coverage. Params: `dates` (1–90), `apparatus_id` |

`ApparatusInventoryPage` takes an optional `apparatusId` prop; supplied, it
drops its own picker and fleet-walk and becomes the detail page's Inventory
tab. `CheckLogPage` takes the same prop for the Check log tab.

### What this deliberately does not add

There is no deficiency record. "Open finding" means _the last time anyone
looked, this was broken_ — computed from the most recent check per
(apparatus, template), so a fault fixed the next morning stops being reported.
Assignment, repair and verification tracking would need a real
`equipment_deficiencies` table and is not part of this change.

## Driver Qualification: EVOC Administration & Position Roster (2026-08-16)

Two gaps closed on the same chain: EVOC levels were modelled and enforced but
unreachable from the UI, and there was no way to ask "who is cleared to drive?"
short of opening every apparatus in turn.

### EVOC levels are now administrable

`evoc_levels` had full CRUD endpoints and no caller. Nothing in the frontend
created a level, no migration seeded one, and `EvocLevelResponse` came back
camelCase while the request schemas accepted snake_case only — so the first
client to round-trip a level would have 422'd on `level_number`.

With no levels on file, `Apparatus.required_evoc_level_id` stayed NULL,
`check_driver_evoc_eligibility()` returned `eligible: True` unconditionally, and
`auto_add_operators_for_evoc_completion()` never fired. The entire
training → EVOC → apparatus-operator chain was inert in every installation.

| Change                                                            | Where                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Standard EVOC 1–4 ladder seeded lazily per org                    | `EvocLevelService.seed_defaults()`, called from `GET /apparatus/evoc-levels` |
| Admin UI (create/edit/delete/activate, link certifying program)   | Settings → **EVOC Levels** (`EvocLevelsSettingsSection.tsx`)                 |
| Request schemas accept camelCase                                  | `EvocLevelBase`, `EvocLevelUpdate`                                           |
| `training_program_id` validated in-org (XC-1)                     | `EvocLevelService._assert_program_in_org()`                                  |
| Level/code collisions return 400, not a 500 from the unique index | `EvocLevelService.update_level()`                                            |
| Explicit nulls clear instead of being dropped                     | `apply_updates()` in `update_level()`                                        |

Levels are seeded **per organization**, not as org-agnostic system rows: each
carries a `training_program_id` pointing at that department's own certifying
program, and a shared row would leak that link across tenants. The seed guard
counts all rows including inactive ones, so deactivating an unused level does
not resurrect the ladder — the same trade-off `OperationalRankService` makes.

### Position qualification roster

```
GET /api/v1/scheduling/eligibility/roster?position=driver
```

Requires `scheduling.view` or `scheduling.manage`. Returns every active member
eligible for the position with the _sources_ of that eligibility (rank,
completed training, or the org's open-position list), their highest current EVOC
level, and the apparatus they hold an operator record on. Surfaced at
`/scheduling/qualifications` via the **Qualifications** admin card.

Eligibility mirrors `get_eligible_positions()` exactly — same union behind the
same membership-type gate — so the roster can never disagree with what
self-signup enforces. Per-shift narrowing is deliberately not applied; this is
the department-wide roster.

Only _current_ operator records count (active, certified, unexpired), matching
`check_driver_evoc_eligibility()`. An expired card must not read as cleared.

### Edge Cases

| Scenario                                  | Behavior                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| Org has no EVOC levels                    | Standard 1–4 seeded on first read of the levels endpoint        |
| Every level deleted                       | Ladder re-seeds on next read; deactivate instead to suppress    |
| Level deleted while apparatus requires it | Blocked with a descriptive 400                                  |
| Certifying program from another org       | Rejected as "Invalid training program"                          |
| Member rank-eligible with no EVOC         | Listed on the roster, flagged "No EVOC certification on file"   |
| Member's EVOC expired                     | Excluded from EVOC level and apparatus clearances               |
| Caller lacks `apparatus.manage`           | EVOC Levels settings section hidden rather than shown as a 403  |
| Position roster during a refetch          | Labels derive from the loaded roster, not the pending selection |

---

_Last Updated: August 16, 2026_

## EVOC Enforcement & Chief-Approved Driver Exceptions (2026-08-16)

The EVOC check was advisory: `_attach_assignment_warnings` attached a
non-blocking `evoc_warnings` entry and the assignment went through regardless.
An officer could seat any member as the driver of any apparatus. It is now a
hard block with a sanctioned, auditable override.

### Enforcement

`ShiftEligibilityService.evaluate_driver_assignment()` is the single decision
point, returning `allowed`, `blocked_reason`, `warnings`, and the `exception`
that carried an otherwise-blocked assignment.

The block is applied in **`SchedulingService.create_assignment`**, not at the
endpoints. Member self-signup and officer assignment both reach that one call,
so the rule is written once and a future third write path inherits it.
`update_assignment` re-checks when an edit moves someone into the driver seat —
otherwise an officer blocked at create time could assign the member as a
firefighter and PATCH the position to `driver`.

`get_driver_assignment_warnings()` is now a thin wrapper over the same
evaluation, so enforcement and display cannot describe one assignment
differently.

**`org.settings.scheduling.enforce_evoc` defaults to `true`.** Safe to switch on
for existing organizations because the check is inert until an admin
deliberately sets `required_evoc_level_id` on an apparatus. Turning it off
downgrades the block to the previous advisory warning; the toggle is in
Scheduling → Settings → General.

### Driver exceptions

New `driver_exceptions` table and `/api/v1/apparatus/driver-exceptions`
endpoints, surfaced at `/scheduling/qualifications` under the **Driver
exceptions** tab. Four controls make the override trustworthy:

| Control                                                            | Where                                |
| ------------------------------------------------------------------ | ------------------------------------ |
| A request grants nothing — approval is a separate act              | `status` starts `pending`            |
| Requester ≠ approver, and the beneficiary cannot approve their own | `assert_different_person`, twice     |
| Chief-level permission to approve                                  | `apparatus.approve_driver_exception` |
| Bounded validity — `valid_until` required, ≤ 366 days              | `MAX_VALIDITY_DAYS`                  |

`apparatus.approve_driver_exception` is granted by default to fire chief,
deputy chief, and assistant chief only — deliberately not to captain,
lieutenant, or the president, who hold `apparatus.manage`. Authorizing an
uncertified driver is an operational safety call.

Request, approve, deny, and revoke are audit-logged (`driver_exception_*`,
category `apparatus`; approval logs at `warning` severity). Revocation
deliberately has **no** separation-of-duties bar: withdrawing permission is
always the safe direction, and requiring a second signature to take an unsafe
driver off a truck would be a hazard rather than a control.

A NULL `apparatus_id` means "any apparatus" — the broader grant, so the request
form asks for a unit first and the enforcement lookup prefers a unit-specific
exception over a blanket one when both match, surfacing the narrower
restrictions.

### Edge Cases

| Scenario                                             | Behavior                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Uncertified member assigned as driver                | 400 with the shortfall and how to resolve it                 |
| Uncertified member self-signs up as driver           | Same block, same message                                     |
| Assigned as firefighter, then PATCHed to driver      | Re-checked and blocked                                       |
| Shift has no apparatus                               | No EVOC requirement to check; never blocked                  |
| Apparatus has no `required_evoc_level_id`            | Never blocked                                                |
| `enforce_evoc` off                                   | Advisory warning only, as before                             |
| Approved exception covers the member, unit, and date | Allowed, with the restrictions surfaced to the officer       |
| Exception pending, denied, or revoked                | Block stays in place                                         |
| Exception expired before the shift date              | Block stays in place                                         |
| Chief approves their own request, or one naming them | 400 (separation of duties); the UI hides the button          |
| Re-deciding an already approved/denied request       | 400 — raise a new request                                    |
| Approving a request whose window already closed      | 400                                                          |
| Exception's apparatus deleted                        | `SET NULL` — widens to any apparatus, keeps the audit record |

### The refusal has a route forward

A block with no next step is where a safety control turns into a workaround —
someone drives anyway and nobody records it. When an assignment or signup is
refused, `ShiftDetailPanel` opens `DriverBlockedDialog` rather than a toast:

- what is missing, in the backend's own words;
- **who can approve an exception**, by name and rank, so the officer knows who
  to call. Resolved from live permissions (positions + rank defaults, matched
  with the same `permission_matches` the dependency layer uses) rather than
  assumed from rank, so a department that moved the grant onto a training
  officer sees the training officer. `GET /apparatus/driver-exceptions/approvers`,
  readable by any member — names and ranks only, no contact details, which stay
  behind the member directory's visibility settings;
- an inline **request form**, prefilled with the member, the shift's apparatus,
  and the shift date as a single-day window — the narrowest grant that solves
  the problem in front of the officer.

The dialog opens off the **`LB-SCHED-001`** support code, not the message text.
`_check_driver_qualification` raises `CodedValueError`, `create_assignment` and
`update_assignment` re-raise it rather than flattening it into their
`(result, error)` tuple, and the three endpoints convert it to a
`CodedHTTPException`. Matching on wording would break the moment the wording
changed.

Members without `scheduling.assign` / `scheduling.manage` / `apparatus.manage`
see the approver list and are told to ask — the form is absent rather than
present-and-failing. When nobody holds the approval grant at all, the dialog
says so, instead of leaving an officer waiting on an approval that can never
arrive.

| Scenario                                    | Behavior                                                        |
| ------------------------------------------- | --------------------------------------------------------------- |
| Driver block on assign or signup            | Dialog with the shortfall, the approvers, and an inline request |
| Approver lookup fails                       | Block still shown; the names are simply absent                  |
| Nobody holds the approval grant             | Says so, rather than implying an approval is coming             |
| Requester lacks the permission to raise one | Approver list only, with who to ask                             |
| Any other assignment error                  | Unchanged — an ordinary toast                                   |

---

_Last Updated: August 16, 2026_
