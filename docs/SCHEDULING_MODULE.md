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

---

## Architecture

### Frontend

```
frontend/src/pages/
├── SchedulingPage.tsx              # Main 6-tab hub
├── scheduling/
│   ├── MyShiftsTab.tsx             # Personal shift view, confirm/decline, swap/time-off requests
│   ├── OpenShiftsTab.tsx           # Browse & sign up for upcoming shifts
│   ├── RequestsTab.tsx             # Combined swap + time-off request management
│   └── ShiftDetailPanel.tsx        # Slide-out panel: crew roster, signup, calls
├── ShiftTemplatesPage.tsx          # Templates & patterns management (admin)
├── SchedulingReportsPage.tsx       # Reports: hours, coverage, call volume, availability
├── ShiftAssignmentsPage.tsx        # Assignment management (admin)
├── ShiftAttendancePage.tsx         # Attendance records for a shift
├── ShiftReportPage.tsx             # Shift completion reports (training integration)
└── ApparatusBasicPage.tsx          # Lightweight apparatus management
```

### Backend

```
backend/app/
├── models/training.py              # Shift, ShiftAssignment, ShiftTemplate, ShiftPattern,
│                                   # ShiftAttendance, ShiftCall, BasicApparatus models
├── schemas/scheduling.py           # Pydantic schemas for all scheduling operations
├── api/v1/endpoints/scheduling.py  # All scheduling REST endpoints
└── alembic/versions/
    ├── 20260122_0015_*.py          # Initial shift tables
    └── 20260218_0200_*.py          # BasicApparatus table
```

### Services (Frontend API)

All scheduling API calls go through `schedulingService` in `frontend/src/services/api.ts`.

---

## Models

### Shift

Core shift record representing a single scheduled shift.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | FK to organizations |
| `shift_date` | Date | The date of the shift |
| `start_time` | DateTime | Shift start time |
| `end_time` | DateTime | Shift end time (nullable) |
| `template_id` | UUID | FK to shift_templates (nullable) |
| `apparatus_id` | UUID | FK to apparatus/basic_apparatus (nullable) |
| `station_id` | UUID | FK to locations (nullable) |
| `shift_officer_id` | UUID | FK to users (nullable) |
| `status` | String | scheduled, in_progress, completed, cancelled |
| `notes` | Text | Optional notes |
| `activities` | JSON | What happened during shift |
| `color` | String | Template color for calendar display (nullable) |
| `attendee_count` | Integer | Computed count of confirmed attendees |
| `min_staffing` | Integer | Minimum staffing (enriched from apparatus) |

### ShiftAssignment

Links a member to a shift with a specific position.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `shift_id` | UUID | FK to shifts |
| `user_id` | UUID | FK to users |
| `position` | String | officer, driver, firefighter, emt, captain, lieutenant, probationary, volunteer, other |
| `assignment_status` | String | assigned, confirmed, declined, no_show, cancelled |
| `assigned_by` | UUID | Who made the assignment |
| `confirmed_at` | DateTime | When member confirmed |
| `notes` | Text | Optional notes |

### ShiftTemplate

Reusable shift configuration defining times and staffing.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Template name (e.g., "Day Shift A") |
| `start_time_of_day` | String | Start time (e.g., "08:00") |
| `end_time_of_day` | String | End time (e.g., "20:00") |
| `duration_hours` | Float | Shift duration in hours |
| `color` | String | Color for calendar display |
| `min_staffing` | Integer | Minimum required staffing |
| `positions` | JSON | Position definitions |
| `is_default` | Boolean | Whether this is the default template |
| `is_active` | Boolean | Active/inactive status |

### ShiftPattern

Defines recurring shift schedules for bulk shift generation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Pattern name (e.g., "24/48 Rotation") |
| `pattern_type` | String | daily, weekly, platoon, custom |
| `template_id` | UUID | FK to shift_templates (nullable) |
| `rotation_days` | Integer | Total days in rotation cycle |
| `days_on` | Integer | Consecutive days on duty |
| `days_off` | Integer | Consecutive days off duty |
| `schedule_config` | JSON | Additional pattern configuration |
| `start_date` | Date | Pattern effective start |
| `end_date` | Date | Pattern effective end (nullable) |
| `assigned_members` | JSON | Members in this rotation |
| `is_active` | Boolean | Active/inactive status |

### BasicApparatus

Lightweight vehicle management for departments without the full Apparatus module.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | FK to organizations |
| `unit_number` | String(20) | Vehicle unit number (e.g., "E-1") |
| `name` | String(100) | Vehicle name (e.g., "Engine 1") |
| `apparatus_type` | String(50) | engine, ladder, rescue, ambulance, brush, tanker, battalion, utility, boat, other |
| `min_staffing` | Integer | Minimum crew size |
| `positions` | JSON | Array of crew position names |
| `is_active` | Boolean | Active/inactive status |

**Default positions by apparatus type:**

| Type | Default Positions |
|------|------------------|
| Engine | Officer, Driver, Firefighter, Firefighter |
| Ladder | Officer, Driver, Firefighter, Firefighter, Firefighter |
| Rescue | Officer, Driver, Firefighter |
| Ambulance | Driver, EMT |
| Brush | Driver, Firefighter |
| Tanker | Driver, Operator |
| Battalion | Battalion Chief |

### SwapRequest

Shift swap request between members.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `requesting_user_id` | UUID | Member requesting the swap |
| `target_user_id` | UUID | Target member (nullable) |
| `offering_shift_id` | UUID | Shift being offered |
| `requesting_shift_id` | UUID | Shift wanted in return (nullable) |
| `status` | String | pending, approved, denied, cancelled |
| `reason` | Text | Why the swap is requested |
| `reviewer_notes` | Text | Admin notes on decision |

### TimeOffRequest

Time-off request for date ranges.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Requesting member |
| `start_date` | Date | Start of time off |
| `end_date` | Date | End of time off |
| `status` | String | pending, approved, denied, cancelled |
| `reason` | Text | Reason for time off |
| `reviewer_notes` | Text | Admin notes on decision |

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
PATCH  /api/v1/scheduling/attendance/{id}           # Update attendance record
DELETE /api/v1/scheduling/attendance/{id}           # Delete attendance record
```

### Calls

```
GET    /api/v1/scheduling/shifts/{id}/calls         # Get calls during shift
```

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

---

## Frontend Pages

### SchedulingPage (Main Hub)

The main scheduling interface is a 6-tab hub accessible at `/scheduling`:

| Tab | Access | Description |
|-----|--------|-------------|
| **Schedule** | All members | Calendar view (week/month) with shift cards. Click a shift to open the detail panel. Admins see "Create Shift" button. |
| **My Shifts** | All members | Personal upcoming/past shifts. Confirm or decline assignments. Request swaps or time off. |
| **Open Shifts** | All members | Browse upcoming shifts grouped by date. Sign up for positions with inline position selector. |
| **Requests** | All members | View swap and time-off requests. Admins can approve/deny with reviewer notes. |
| **Templates** | `scheduling.manage` | Manage shift templates and scheduling patterns. Generate shifts from patterns. |
| **Reports** | `scheduling.manage` | Scheduling analytics: member hours, coverage, call volume, availability. |

### ShiftDetailPanel

A slide-out panel that appears when clicking a shift on the calendar:

- **Shift info**: Date, time, apparatus, station, notes
- **Crew roster**: List of assigned members with positions and status
- **Open positions**: Available positions members can sign up for
- **Calls/incidents**: Calls that occurred during the shift
- **Actions**: Sign up (members), assign members (admins), remove assignments (admins)

### ApparatusBasicPage

Lightweight apparatus management at `/apparatus-basic`:

- CRUD for vehicles with unit number, name, type, min staffing, and crew positions
- Search and filter functionality
- Card grid layout with create/edit modal
- Default crew positions auto-populated based on apparatus type
- Only shown when the full Apparatus module is disabled (mirrors Locations vs Facilities pattern)

---

## Permissions

| Permission | Description |
|------------|-------------|
| `scheduling.manage` | Create/edit/delete shifts, templates, patterns. Approve/deny requests. View reports. |
| `scheduling.assign` | Assign members to shifts (admin assignment, not self-signup). |
| `scheduling.view` | View scheduling data (implicit for all authenticated members). |

**Note:** Shift signup (`POST /shifts/{id}/signup`) uses `get_current_user`, not `require_permission`. Any authenticated member can sign up for open positions.

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

| Preset | On/Off Pattern | Cycle Length | Description |
|--------|---------------|-------------|-------------|
| **24/48** | 1 on / 2 off | 3 days | Most common US fire department rotation |
| **48/96** | 2 on / 4 off | 6 days | Common in Western US departments |
| **Kelly Schedule** | 24 on / 24 off / 24 on / 24 off / 24 on / 96 off | 9 days | Three-platoon rotation |
| **California 3-Platoon** | 24 on / 24 off / 24 on / 48 off | 4 days | Modified Kelly for 3 platoons |
| **ABCAB** | Variable on/off | 5 days | Five-day rotation used by some departments |

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

## Training Module Integration

The scheduling module connects to the training module through **Shift Completion Reports**:

1. **Shift Report Page** (`ShiftReportPage.tsx`): Officers file shift completion reports documenting trainee performance
2. **Skill Observations**: Track which skills were demonstrated during a shift
3. **Tasks Performed**: Log tasks completed during the shift
4. **Pipeline Progress**: Shift hours and calls automatically update training pipeline requirements
5. **Performance Ratings**: 1-5 star ratings with strengths/improvement areas

This integration allows training officers to document field observations and automatically advance trainees through their training programs based on shift activity.

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
8. FOLLOW-UP   → Shift completion report filed, training updated
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
- `IntegrityError` catch on concurrent assignment attempts as a race condition fallback
- Overlap query scoped to ±1 day of `shift_date` to prevent false positives from ancient unclosed shifts
- `confirm_assignment` validates `organization_id` to prevent cross-org access
- Date range validation on time-off requests (`end_date >= start_date`)
- Pattern generation deduplicates `assigned_members` by `user_id`
- PATCH endpoints use `exclude_unset` so clients can explicitly clear optional fields

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

*Last Updated: February 27, 2026*
