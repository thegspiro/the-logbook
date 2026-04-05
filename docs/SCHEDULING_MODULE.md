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

The main scheduling interface is a 7-tab hub accessible at `/scheduling` (supports `?tab=` deep-linking):

| Tab | Access | Description |
|-----|--------|-------------|
| **Schedule** | All members | Calendar view (week/month) with shift cards. Click a shift to open the detail panel. Admins see "Create Shift" button. |
| **My Shifts** | All members | Personal upcoming/past shifts. Confirm or decline assignments. Request swaps or time off. |
| **Open Shifts** | All members | Browse upcoming shifts grouped by date. Sign up for positions with inline position selector. |
| **Requests** | All members | View swap and time-off requests. Admins can approve/deny with reviewer notes. |
| **Templates** | `scheduling.manage` | Manage shift templates and scheduling patterns. Generate shifts from patterns. |
| **Equipment Checks** | All members | Browse apparatus checklists, perform ad-hoc or shift-linked equipment checks |
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

The scheduling module connects to the training module through **Shift Completion Reports** and the **Shift Finalization Workflow**:

1. **Shift Finalization** (`POST /scheduling/shifts/{id}/finalize`): Officers finalize past shifts, which snapshots call_count and total_hours, computes per-member call counts, and auto-creates draft ShiftCompletionReports for enrolled trainees *(2026-03-28)*
2. **Shift Report Page** (`ShiftReportPage.tsx`): Officers file shift completion reports documenting trainee performance
3. **Auto-Population**: Report form auto-populates hours, calls, and call types from shift attendance and ShiftCall records via `GET /training/shift-reports/shift-preview/{shift_id}/{trainee_id}` *(2026-03-28)*
4. **Draft Review Workflow**: Auto-created drafts are completed by officers, optionally reviewed by training officers (approve/flag with field redaction), and acknowledged by trainees *(2026-03-28)*
5. **Skill Observations**: Track which skills were demonstrated during a shift (structured JSON: `{skill_name, demonstrated, notes, comment}`)
6. **Tasks Performed**: Log tasks completed during the shift (structured JSON: `{task, description, comment}`)
7. **Pipeline Progress**: Shift hours, shift count, and call count (with call type matching) automatically update training pipeline requirements. Draft reports defer progress until completed *(2026-03-28)*
8. **Performance Ratings**: 1-5 star ratings with strengths/improvement areas (encrypted at rest)
9. **Officer Analytics**: Org-wide analytics dashboard with per-trainee breakdown, status counts, and monthly trends (`GET /training/shift-reports/officer-analytics`) *(2026-03-29)*
10. **Trainee Stats**: Personal stats dashboard with total hours, calls, average rating, and monthly breakdown (`GET /training/shift-reports/my-stats`) *(2026-03-29)*

This integration allows training officers to document field observations, automatically advance trainees through their training programs based on shift activity, and track department-wide training progress through analytical dashboards.

### Shift Reports Settings *(2026-04-04)*

The **Shift Reports** settings tab (within Scheduling Settings) provides centralized configuration for the shift completion report workflow:

#### Checklist Timing Windows

| Setting | Default | Description |
|---------|---------|-------------|
| `start_of_shift_enabled` | `true` | Whether start-of-shift equipment checklists are active |
| `end_of_shift_enabled` | `true` | Whether end-of-shift equipment checklists are active |

#### Post-Shift Validation

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Whether post-shift validation reminders are active |
| `require_officer_report` | `false` | Whether a shift completion report is mandatory after every shift |
| `validation_window_hours` | `2` | Hours after shift end during which validation reminders are sent |

#### Report Form Section Toggles

Controls which optional sections appear on the shift completion report form (separate from trainee visibility):

| Toggle | Default | Controls |
|--------|---------|----------|
| `form_show_performance_rating` | `true` | Performance rating stars/scale |
| `form_show_areas_of_strength` | `true` | Strengths text field |
| `form_show_areas_for_improvement` | `true` | Improvement text field |
| `form_show_officer_narrative` | `true` | Free-form officer assessment |
| `form_show_skills_observed` | `true` | Structured skills checklist |
| `form_show_tasks_performed` | `true` | Structured tasks checklist |
| `form_show_call_types` | `true` | Call type selection |

#### Per-Apparatus-Type Skills and Tasks

Maps apparatus types to specific skills and tasks so the report form auto-populates relevant items based on the shift's assigned apparatus. Configured via an accordion UI in the settings panel.

**Example mapping:**

| Apparatus Type | Skills | Tasks |
|----------------|--------|-------|
| Engine | Pump operations, Hose deployment, Hydrant connection, Drafting, Foam operations, Attack line advancement, Water supply establishment, Apparatus positioning | Pump test, Hose load inventory, Nozzle inspection, Hydrant flow check |
| Ladder | Aerial operations, Ground ladder deployment, Ventilation, Rescue, Elevated stream operations, Tower bucket operations | Aerial extension test, Ground ladder inventory, Outrigger inspection, Bucket inspection |
| Ambulance | Patient assessment, CPR/AED, IV access, Medication administration, Airway management, Splinting/immobilization | Drug box inventory, Oxygen supply check, AED test, Stretcher inspection |

Departments can edit, add, or remove skills and tasks per apparatus type. When no mapping exists for a given type, the system falls back to the org-wide default skills and tasks lists.

#### Rating Scale Customization

| Setting | Default | Description |
|---------|---------|-------------|
| `rating_label` | "Performance Rating" | Label displayed above the rating input |
| `rating_scale_type` | "stars" | Display type: "stars" (star icons) or "descriptive" (labeled buttons) |
| `rating_scale_labels` | `null` | Custom labels per rating level (e.g., `{1: "Needs Improvement", 2: "Developing", 3: "Competent", 4: "Proficient", 5: "Exceptional"}`) |

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

| Scenario | Behavior |
|----------|----------|
| All form sections toggled off | Only core fields (trainee, date, hours, calls) remain; form still submittable |
| Apparatus type with no mapped skills | Falls back to org-wide default skills; if none, skills section is empty |
| Save as draft with missing fields | Saved successfully; validation deferred until final submission |
| Trainee list when linked to a shift | Auto-filters to only show shift members; ad-hoc reports show full member list |
| Rating scale "descriptive" with no labels | Falls back to numeric display (1-5) |

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
- `UniqueConstraint(shift_id, trainee_id)` on `ShiftCompletionReport` prevents duplicate reports *(2026-03-28)*
- `IntegrityError` catch on concurrent assignment attempts as a race condition fallback
- Overlap query scoped to ±1 day of `shift_date` to prevent false positives from ancient unclosed shifts
- `confirm_assignment` validates `organization_id` to prevent cross-org access
- Date range validation on time-off requests (`end_date >= start_date`)
- Pattern generation deduplicates `assigned_members` by `user_id`
- PATCH endpoints use `exclude_unset` so clients can explicitly clear optional fields
- Finalized shifts cannot be edited or deleted *(2026-03-28)*
- Shifts with associated completion reports cannot be deleted *(2026-03-28)*

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
import { schedulingService } from '@/modules/scheduling/services/api';
```

---

## Template Positions & Timezone Fixes (2026-03-15)

### Template Positions Carry to Crew Roster

Shift templates with defined `positions` and `min_staffing` values now persist these to created shifts via two new columns on the `shifts` table:

| Column | Type | Description |
|--------|------|-------------|
| `positions` | JSON, nullable | Position definitions inherited from the template at shift creation time |
| `min_staffing` | Integer, nullable | Minimum staffing level inherited from the template |

Both direct shift creation and pattern-based bulk generation pass template staffing requirements through. In the `ShiftDetailPanel`, when an apparatus has no positions defined, the component falls back to shift-level positions, ensuring crew roster always displays the correct position structure.

**Alembic migration**: `20260314_0200_add_positions_to_shifts.py`

### Shift Timezone Display Fix

Two timezone display bugs were fixed:

1. **ShiftReportsTab**: Was using `toISOString()` (UTC) for today's date comparison instead of `getTodayLocalDate(tz)`. Reports now correctly filter based on the user's local date.

2. **ShiftDetailPanel `toTimeValue()`**: The function extracted `HH:MM` by string-splitting the ISO datetime on `'T'`, which returned the UTC time portion. For a shift starting at 2:30 PM Eastern (18:30 UTC), the edit form showed `18:30` instead of `14:30`. Now uses `Intl.DateTimeFormat` with the user's timezone to extract local `HH:MM`, and `localToUTC()` when saving edits back to the API.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Shifts created before this migration | `positions` and `min_staffing` are `NULL`; UI falls back to apparatus-level positions |
| `toTimeValue` with missing/invalid datetime | Returns empty string instead of crashing |
| Template edits after shift creation | Existing shifts retain original positions — only newly created shifts get updated values |
| Timezone-unaware shift times | The `load` event listener (added 2026-03-14) stamps naive datetimes with UTC tzinfo, so all shift times are timezone-aware in API responses |

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

| Module | File | Description |
|--------|------|-------------|
| Shared | `hooks/useHtml5Scanner.ts` | Reusable scanner hook with camera fallback |
| Shared | `types/scanner.ts` | Scanner configuration types |
| Shared | `constants/camera.ts` | Camera resolution presets and error messages |

All scanner consumers (InventoryScanModal, MemberIdScannerModal, MemberScanPage) share the same camera initialization, error handling, and resolution logic.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Desktop with no camera | Error message displayed; manual entry available |
| Desktop with only webcam | Falls back to user-facing camera |
| Declined shift on dashboard | Filtered from "My Upcoming Shifts" |
| Cancelled shift on dashboard | Filtered from "My Upcoming Shifts" |

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

| Field | Type | Description |
|-------|------|-------------|
| `position` | String | Position name (e.g., "officer", "driver") |
| `required` | Boolean | Whether the position must be filled for minimum staffing |

Backward-compatible: bare strings in existing templates default to `required=true`. Frontend shows violet badge for required positions and muted for optional. Section renamed from "Required Positions" to "Crew Positions".

### Staffing Status Visualization

Shift cards and the crew info box now display staffing status:

| State | Visual |
|-------|--------|
| Fully staffed | Green CheckCircle2 icon on card, green background in crew box, ratio "4/4" |
| Understaffed | Amber background in crew box, amber open position count, ratio "2/4" |
| Staffing-based tints | Green tint overrides template color when full; amber when short |

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

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Shift overlap false positives across UTC date boundaries | Open-ended shifts (no `end_time`) treated as infinitely long | Restrict to same `shift_date`: `and_(Shift.end_time.is_(None), Shift.shift_date == shift.shift_date)` |
| Shift assignment/reminder times in UTC | `_notify_shift_assignment()` and `run_shift_reminders()` used raw UTC times | Convert to org timezone via `pytz` before formatting |
| All shifts defaulting to indigo color | `getShiftTemplateColor()` parsed full ISO string (`"2026-03-24T14:00:00"` → 2026) | Extract time after "T" split: `shift.start_time.split("T")[1]?.split(":")[0]` |
| Empty notes causing 422 | `editingNotesValue ?? undefined` passes empty string | Changed to `editingNotesValue \|\| undefined` |
| Pattern generation 422 | `GenerateShiftsRequest` required `pattern_id` in body (already URL param) | Removed field from schema |
| Member hours report empty | Queried `ShiftAttendance` (clock-in only) | Changed to `ShiftAssignment` joined with `Shift` |
| Member hours report type mismatch | Endpoint returned flat array; frontend expected wrapped object | Wrapped in `{ members, period_start, period_end, total_members }` |
| Missing first_name/last_name in report | `MemberHoursReport` schema lacked fields | Added to both Pydantic schema and TS type |
| Dark mode poor contrast on scheduling buttons | Interactive elements missing `dark:` modifiers | Added `dark:text-*-400`, `dark:hover:bg-*-*/20` variants |
| Shift card text unreadable in dark mode | `hexColorStyle()` set text to raw hex against 10% opacity bg | WCAG AA contrast calculation with iterative adjustment |

### Code Quality

- Consolidated `ShiftDetailPanel.tsx` from 33 to 23 useState hooks (11 async-pending booleans grouped into `pending` state object)
- Extracted `INACTIVE_ASSIGNMENT_STATUSES` constant (replaces 3 inline `[DECLINED, CANCELLED]` lists)
- Deduplicated shift enrichment via `_enrich_shift_dict()` method
- Typed `getMyChecklists()` return as `ActiveChecklistRecord[]`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Bulk confirm with API failure on one shift | Optimistic UI reverts failed assignment; others remain confirmed |
| Template with bare string positions (pre-migration) | Defaults to `required=true` (backward-compatible) |
| Shift with no `end_time` on different date | No longer falsely overlaps; restricted to same `shift_date` |
| Reminder for shift that already started | Skipped — only shifts starting within lookahead window |
| All positions filled via bulk assign | "Fill All Open" button hidden |
| Member on leave in assignment dropdown | Filtered out via unavailable-members endpoint |
| Dark mode with light template color (e.g., #FFD700) | Text auto-darkened to maintain WCAG AA 4.5:1 contrast |
| Notes field cleared to empty | Converted to `undefined` to prevent backend 422 |

---

## Notification Cards, Deep-Linking & Standalone Equipment Checks (2026-03-26)

### Notification Metadata & Deep-Linking

Shift-related notifications now carry structured metadata for rich card rendering:

| Field | Type | Description |
|-------|------|-------------|
| `notification_logs.metadata` | JSON (nullable) | Structured context: `shift_id`, `shift_date`, `checklist_count`, etc. |

**Alembic migration**: `20260326_0100_add_notification_metadata.py`

Notification cards use this metadata to render:
- **Contextual CTAs**: "View Shift" for assignment notifications, "Start Checklist" for equipment check reminders
- **Time-aware CTA**: "Start Checklist" shown only during the shift window; "View Shift" outside the window
- **Shift deep-links**: Clicking opens `/scheduling?tab=my-shifts` with the shift pre-selected

### Scheduling Page `?tab=` Query Parameter

`SchedulingPage.tsx` now reads the `?tab=` query parameter on mount:

| Parameter | Tab |
|-----------|-----|
| `?tab=schedule` | Schedule (calendar) — default |
| `?tab=my-shifts` | My Shifts |
| `?tab=open-shifts` | Open Shifts |
| `?tab=requests` | Requests |
| `?tab=equipment-checks` | Equipment Checks |

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

| Data | Location | Description |
|------|----------|-------------|
| `users.evoc_level` | Member profile | Basic, Intermediate, Advanced |
| `apparatus.required_evoc_level` | Apparatus record | Minimum EVOC for operators |
| Scheduling validation | Driver/Operator assignment | Warning when member EVOC < required |

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

| Scenario | Behavior |
|----------|----------|
| Notification with no metadata | Basic card rendering without deep-link CTAs |
| `?tab=invalid` in URL | Falls back to Schedule tab |
| Standalone check with no shift | Saved as "ad hoc"; included in reports |
| Section header in scoring | Excluded from pass/fail calculations |
| Template clone with headers | `is_header` and `critical_minimum_quantity` preserved |
| Container restart during scheduled task | Tasks resume; idempotent checks prevent duplicates |
| MySQL not ready at startup | Retries up to 5 times with exponential backoff |
| EVOC not set for member | Warning on driver assignment; assignment still allowed |
| Event attendee already in ballot | Skipped silently; count reflects new additions only |
| `navigate(-1)` from deep link | Now navigates to hardcoded parent page |
| Finalize shift with incomplete end-of-shift checks | Blocked; Finalize button disabled |
| Finalize shift that hasn't ended yet | Finalize button not shown |
| Finalize already-finalized shift | Returns 400 error |
| Delete finalized shift | Blocked with descriptive error |
| Delete shift with completion reports | Blocked with descriptive error |
| Draft auto-creation fails for one trainee | Logged; remaining trainees processed |
| Duplicate report for same shift + trainee | Unique constraint prevents; descriptive error returned |
| Auto-populate preview for trainee not on shift | Returns zeroed data |

---

## Shift Finalization & Completion Reports (2026-03-28)

### New Data Model Fields

| Table | Column | Type | Description |
|-------|--------|------|-------------|
| `shifts` | `call_count` | Integer, nullable | Aggregate call count snapshot at finalization |
| `shifts` | `total_hours` | Float, nullable | Total attendance hours snapshot at finalization |
| `shifts` | `is_finalized` | Boolean, default=False | Whether the shift has been finalized |
| `shifts` | `finalized_at` | DateTime, nullable | When the shift was finalized |
| `shifts` | `finalized_by` | FK → users, nullable | Officer who finalized the shift |
| `shift_attendance` | `call_count` | Integer, nullable | Per-member call participation count |

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
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

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/training/shift-reports/officer-analytics` | Org-wide totals, per-trainee breakdown, status counts, monthly trends |
| `GET` | `/api/v1/training/shift-reports/by-officer` | Reports filed by current officer |
| `GET` | `/api/v1/training/shift-reports/trainee/{id}` | Reports for a specific trainee |
| `GET` | `/api/v1/training/shift-reports/trainee/{id}/stats` | Stats for a specific trainee |

### Trainee Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/training/shift-reports/my-reports` | Trainee's approved reports (visibility-filtered) |
| `GET` | `/api/v1/training/shift-reports/my-stats` | Trainee's aggregate statistics |

### ShiftReportsTab View Modes

| View | Who Sees It | Content |
|------|-------------|---------|
| **My Reports** | Trainees | Received approved reports with acknowledgment |
| **Filed by Me** | Officers | Reports the officer has filed |
| **Pending Review** | Training officers | Reports awaiting review approval |
| **Drafts** | Officers | Auto-created drafts from finalization |
| **Create** | Officers | New report form with auto-population |

---

*Last Updated: March 31, 2026*
