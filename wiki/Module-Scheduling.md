# Scheduling Module

The Scheduling module manages shift scheduling, member self-service signup, swap and time-off requests, shift templates, and scheduling reports.

---

## Key Features

- **Shift Calendar** — Week and month views of all scheduled shifts
- **Member Self-Service** — Sign up for open positions, confirm/decline assignments
- **9 Position Types** — Officer, driver, firefighter, EMT, captain, lieutenant, probationary, volunteer, other
- **Shift Conflict Detection** — Prevents duplicate assignment and detects overlapping shift time conflicts
- **Shift Officer Assignment** — Assign shift officers via dropdown in create/edit modals
- **Understaffing Indicators** — Amber warning badges on calendar cards when staffing is below apparatus minimum
- **Template Colors** — Shifts inherit color from templates for visual calendar organization
- **Swap Requests** — Members request shift swaps with approval workflow
- **Time-Off Requests** — Request time off with admin approve/deny (date range validation enforced)
- **Shift Templates** — Reusable shift configurations with vehicle type selector for Standard and Specialty categories
- **Shift Patterns** — Daily, weekly, platoon, and custom patterns for bulk generation (JS weekday convention)
- **Shift Pattern Presets** — Built-in fire department rotations (24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB) plus custom pattern builder
- **Bulk Shift Generation** — Generate multiple shifts from templates and patterns, with duplicate check by date + start_time
- **Vehicle Linking on Templates** — Templates linked to actual department vehicles from the Apparatus module
- **Auto-Default Shift Officer** — Assigning the "Officer" position automatically sets that member as the shift officer
- **Apparatus Connection** — Link shifts to vehicles from the apparatus dropdown
- **Shift Completion Reports** — Officers file reports that auto-credit training programs
- **Leave of Absence Integration** — Members on leave excluded from scheduling
- **Multiple Reports** — Hours, coverage, call volume, availability analytics
- **Manual Shift Report Page** — *(2026-04-11)* Standalone page at `/training/manual-shift-report` for departments without the scheduling module enabled. Officers manually enter shift date, start/end times, apparatus, crew, and trainee evaluations
- **Shift Report Hardening** — *(2026-04-11)* 20+ security and data integrity fixes for production readiness including submit-all-drafts scope fix, enrollment ID whitelist validation, draft regression guard, and print button restoration

---

## Recent Improvements (2026-04-11)

### Shift Completion Service Hardening
- **Submit-all-drafts scope**: `POST /api/v1/training/shift-reports/drafts/submit-all` now correctly scopes to the current officer's drafts only
- **Enrollment ID validation**: Draft-to-submitted transition validates that the trainee still has an active enrollment before crediting program progress
- **Draft regression guard**: Prevents re-creation of draft reports for shifts that already have submitted or reviewed reports
- **Print button fix**: Restored broken print functionality on shift report cards in ShiftReportsTab
- **Crew loading fix**: Fixed crew members not loading in shift completion report form when navigating directly to a shift

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling` | Scheduling Hub | Authenticated |

### Scheduling Tabs

| Tab | Description | Admin Only |
|-----|-------------|------------|
| Schedule | Calendar view of shifts | No |
| My Shifts | Personal shifts, confirm/decline, swap/time-off | No |
| Open Shifts | Browse and sign up for available shifts | No |
| Requests | Swap and time-off request management | No |
| Templates | Shift template and pattern management | Yes |
| Reports | Hours, coverage, call volume, availability | Yes |
| Settings | Scheduling configuration | Yes |

---

## API Endpoints

```
GET    /api/v1/scheduling/shifts             # List shifts
POST   /api/v1/scheduling/shifts             # Create shift
GET    /api/v1/scheduling/shifts/{id}        # Get shift details
POST   /api/v1/scheduling/shifts/{id}/signup # Sign up for shift
POST   /api/v1/scheduling/shifts/{id}/withdraw # Withdraw from shift
POST   /api/v1/scheduling/shifts/{id}/assignments # Assign member
GET    /api/v1/scheduling/templates          # List templates
POST   /api/v1/scheduling/templates          # Create template
POST   /api/v1/scheduling/patterns           # Create shift pattern
POST   /api/v1/scheduling/swap-requests      # Request swap
POST   /api/v1/scheduling/time-off-requests  # Request time off
GET    /api/v1/scheduling/reports/*           # Scheduling reports
GET    /api/v1/scheduling/apparatus          # List basic apparatus
GET    /api/v1/scheduling/shifts/{id}/unavailable-members  # Unavailable user IDs for assignment filtering
```

---

## Recent Improvements (2026-03-02)

### Component Decomposition & Architecture
- **ShiftSettingsPanel decomposed**: Split from an 800+ line component into 6 focused card components: `ApparatusTypeDefaultsCard`, `DepartmentDefaultsCard`, `PositionNamesCard`, `ResourceTypeDefaultsCard`, `TemplatesOverviewCard`, `PositionListEditor`
- **Dedicated types**: New `shiftSettings.ts` type file for scheduling configuration types
- **Route module extraction**: Scheduling routes defined in `modules/scheduling/routes.tsx` with `lazyWithRetry()` for chunk-loading resilience
- **Type safety**: Full TypeScript typing added to scheduling service API

### Shift Editing & Position Changes (2026-03-01)
- **Expanded shift editing**: Officers can edit shift times, apparatus assignment, color, notes, and custom creation times directly from the shift detail panel
- **Inline position change UI**: Change member position assignments (Officer, Driver, Firefighter, etc.) directly on shift cards without opening a separate modal

---

## Improvements (2026-02-28)

### Architecture Refactor
- **Modular architecture**: Scheduling refactored from a monolithic 1,200-line page into a proper module structure under `frontend/src/modules/scheduling/`
- **Dedicated Zustand store** (`schedulingStore.ts`): Centralized state management for shifts, templates, patterns, members, and apparatus
- **Dedicated API service** (`modules/scheduling/services/api.ts`): All scheduling API calls moved from the global service into a module-scoped client using `createApiClient()`
- **ShiftSettingsPanel**: New scheduling configuration panel for notification preferences and shift rules
- **SchedulingNotificationsPanel**: Notification management for shift reminders and scheduling alerts
- **InlineConfirmAction component**: New reusable UX component for inline confirmation actions, with tests
- **Scheduling store tests**: Unit tests for store state and async actions

### Features & Fixes
- **Fire department shift pattern presets**: Built-in patterns (24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB) plus custom pattern builder with 30-day preview
- **Vehicle linking on templates**: Shift templates can be linked to actual department vehicles from the Apparatus module
- **Auto-default shift officer**: Assigning the "Officer" position automatically sets that member as the shift officer
- **Dashboard shift split**: Dashboard now shows "My Upcoming Shifts" and "Open Shifts" as separate sections
- **Scheduling module hardening**: Type safety, error sanitization, input validation, and conflict detection
- **Shift signup error fix**: Error messages from failed signups now correctly display server-provided details
- **Mobile responsiveness**: Scheduling reports and calendar views improved for small screens

### Previous Improvements (2026-02-27)

- **Shift conflict detection**: Backend prevents duplicate assignment and overlapping time conflicts with `UniqueConstraint(shift_id, user_id)`
- **Data enrichment**: All shift responses now populate `shift_officer_name`, `attendee_count`, `user_name` on assignments, and embedded shift data on `my-assignments`
- **Pattern weekday fix**: Weekly patterns now correctly map JS weekday convention (0=Sun) to Python convention
- **Route ordering**: `/shifts/open` placed before `/shifts/{shift_id}` to prevent route shadowing
- **Dashboard fix**: Shows all organization shifts instead of only user-assigned shifts
- **Time string handling**: `formatTime()` handles bare time strings from backend
- **EMS renamed to EMT**: Position label updated across all files

---

## Recent Improvements (2026-03-24)

### Bulk Actions, Staffing Visualization & Shift Notifications

- **Bulk confirm/decline**: Checkboxes on pending shift cards with "Select All", "Confirm All", "Decline All" buttons. Optimistic UI with rollback on failure
- **Inline approve/deny on Requests**: Direct "Approve"/"Deny" buttons on swap and time-off request cards without modal
- **Staffing status visualization**: Green CheckCircle2 on fully staffed shift cards. Staffing ratio ("4/4") in crew info box. Green/amber color tints override template colors
- **Position-first assignment flow**: Position dropdown first in crew board, "Assign" button on open slots, "Fill All Open" bulk assignment
- **Unavailable member filtering**: New `GET /scheduling/shifts/{id}/unavailable-members` endpoint. Members on leave, with time-off, or already assigned removed from dropdowns
- **Required/Optional position toggle**: Template positions changed from `string[]` to `{position, required}[]`. Violet badge for required, muted for optional
- **Shift assignment notifications**: In-app + optional email on member assignment. Settings in Scheduling Notifications Panel
- **Start-of-shift reminders**: Scheduled task (30-min interval) with configurable lookahead. Includes equipment checklist list. Settings: `org.settings.shift_reminders`
- **Selected shift highlight**: Violet ring on current shift across all calendar views
- **Collapsible shift creation**: Start/End Date first; additional options behind disclosure
- **Searchable template dropdown**: Search input for >5 templates, filters by name/apparatus/category
- **Equipment check inline status**: Badge counts and action hints on shift detail
- **WCAG AA text contrast**: Shift card colors pass 4.5:1 contrast via `colorContrast.ts` utility
- **Mobile touch targets**: 44px minimum on action buttons (WCAG standard)

### Bug Fixes (2026-03-24)

- **Shift overlap false positives**: Open-ended shifts restricted to same `shift_date`
- **UTC in notifications**: Assignment/reminder times now display in org timezone
- **Shift color parsing**: Extracts hour from time portion, not full ISO string
- **Notes 422 error**: Empty notes coerced to `undefined` via `||`
- **Pattern generation 422**: Removed redundant `pattern_id` from request body
- **Member hours report**: Queries `ShiftAssignment` instead of `ShiftAttendance`; added `first_name`/`last_name`
- **Dark mode contrast**: Added `dark:` variants on all interactive elements

### Edge Cases (2026-03-24)

| Scenario | Behavior |
|----------|----------|
| Bulk confirm with API failure | Optimistic UI reverts; toast shows error |
| Template with bare string positions | Defaults to `required=true` (backward-compatible) |
| Open-ended shift on different date | No false overlap; restricted to same date |
| Reminder for already-started shift | Skipped |
| Member on leave in assignment dropdown | Filtered out |
| Dark mode with light template color | Text auto-adjusted for WCAG AA contrast |

---

## Recent Improvements (2026-03-23)

### Permission Fixes & Calls/Incidents Cleanup

- **Shift assignment permission fix**: `ShiftDetailPanel` now correctly checks `scheduling.assign` (not `scheduling.manage`) for assignment-related UI — assign members, edit positions, remove assignments, edit notes. `canManage` retained for shift CRUD (edit/delete shift)
- **Self-signup visibility fix**: Non-apparatus self-signup form is no longer hidden behind a permission gate, matching the backend's open signup policy
- **OpenShiftsTab fallback guard**: Direct-assignment fallback guarded behind `canAssign` so members without the permission get a clear signup error instead of opaque 403
- **Calls/Incidents section removed**: Placeholder "Calls will appear here once the shift is underway" section removed from `ShiftDetailPanel` — no CAD integration exists to populate it. Frontend `ShiftCall` types and API methods cleaned up. Backend endpoints retained for future ePCR/NEMSIS integration

### Edge Cases (2026-03-23)

| Scenario | Behavior |
|----------|----------|
| User has `scheduling.assign` but not `scheduling.manage` | Can assign members but cannot edit/delete shifts |
| User has `scheduling.manage` but not `scheduling.assign` | Can edit/delete shifts but cannot directly assign members |
| Self-signup on non-apparatus shifts | Available to all authenticated users, no permission required |
| Calls/Incidents API endpoints | Still functional at `POST /api/v1/scheduling/shifts/{id}/calls` for programmatic access |

---

## Recent Improvements (2026-03-19)

### Position Eligibility, Admin Sub-Pages & Timezone Fixes

- **Shift position eligibility system**: Operational ranks now define `eligible_positions` — a list of shift positions each rank is qualified for. Dashboard signup validates against eligibility. Existing ranks backfilled via migration
- **Rank eligible positions UI redesign**: Settings page shows a clear matrix of ranks × positions with toggle controls
- **Scheduling admin sub-pages**: Admin tabs extracted into dedicated routed pages: `/scheduling/templates`, `/scheduling/patterns`, `/scheduling/reports`, `/scheduling/settings` with back navigation and `ProtectedRoute` gating
- **Shift settings tabbed sub-navigation**: Settings page reorganized into tabbed sections
- **Structured position slots**: Shifts define required and optional position slots with decline notifications
- **Open slot visibility**: Declined or removed members reveal open slots for re-assignment
- **Position editing in shift detail**: Officers edit position assignments directly in the shift detail edit form
- **Dashboard shift display fixes**: No longer shows shifts user already signed up for; hides declined/cancelled shifts from "My Upcoming Shifts"; fixes 422 error from invalid `general` position on signup
- **Shift signup re-enrollment**: Members who previously cancelled can re-sign up for the same shift
- **Attendee count fix**: Cancelled and no-show assignments no longer inflate the displayed count
- **Shift timezone fixes**: Fixed naive local times sent as UTC when creating shifts; fixed template generation ignoring org timezone; fixed naive datetime construction across 7 backend services
- **UTC response schema refactor**: `UTCResponseBase` base class stamps naive datetimes with UTC timezone markers in all scheduling response schemas
- **Equipment check system**: Full-stack vehicle and equipment inspection system (see [Apparatus Module](Module-Apparatus#equipment-check-system-2026-03-19))

### New Pages (2026-03-19)

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling/templates` | Scheduling Templates | `scheduling.manage` |
| `/scheduling/patterns` | Scheduling Patterns | `scheduling.manage` |
| `/scheduling/reports` | Scheduling Reports | `scheduling.manage` |
| `/scheduling/settings` | Scheduling Settings | `scheduling.manage` |
| `/scheduling/equipment-check-templates/new` | Equipment Check Template Builder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | Edit Equipment Check Template | `equipment_check.manage` |
| `/scheduling/equipment-check-reports` | Equipment Check Reports | `equipment_check.manage` |

### Data Model Changes (2026-03-19)

| Table | Column | Description |
|-------|--------|-------------|
| `operational_ranks` | `eligible_positions` (JSON) | Shift positions this rank is qualified for |
| `shift_assignments` | `position_slot_id` (String, nullable) | Links to a structured position slot |

### Edge Cases (2026-03-19)

| Scenario | Behavior |
|----------|----------|
| Ranks with no `eligible_positions` | Default to all positions being eligible (backward-compatible) |
| Dashboard signup button | Only appears for shifts with open positions the member's rank qualifies for |
| Previously cancelled signup | Cleaned up before re-enrollment to avoid constraint violations |
| Shift create from scheduling page | Converts local times to UTC using org timezone before API call |
| Template-generated shifts | Inherit timezone-correct start/end times |
| Declined assignments | Create open slots visible to other members |

---

## Recent Improvements (2026-03-15)

### Template Positions & Timezone Fixes

- **Template positions carry to crew roster**: Shift templates with defined `positions` and `min_staffing` now persist these values to created shifts via new `positions` (JSON) and `min_staffing` (Integer) columns on the `shifts` table. Both direct creation and pattern-based generation pass template staffing requirements through. ShiftDetailPanel falls back to shift-level positions when apparatus has none defined
- **Shift timezone display fix**: `ShiftReportsTab` was using UTC date (`toISOString()`) instead of local timezone; now uses `getTodayLocalDate(tz)`. `ShiftDetailPanel` edit form was extracting time from the UTC ISO string instead of converting to local timezone via `Intl.DateTimeFormat`
- **`toTimeValue` local timezone fix**: The function was extracting `HH:MM` by string-splitting the ISO datetime on `'T'`, returning the UTC time portion. For a shift starting at 2:30 PM Eastern (18:30 UTC), the edit form showed 18:30 instead of 14:30. Now uses `Intl.DateTimeFormat` with the user's timezone

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Shifts created before migration | `positions` and `min_staffing` are `NULL`; UI falls back to apparatus-level positions |
| `toTimeValue` with invalid datetime | Returns empty string instead of crashing |
| Template edits after shift creation | Existing shifts retain original positions; only newly created shifts get updated values |

---

## Recent Improvements (2026-03-22)

### Permission Fixes, Shift Signup & Camera Scanning

- **Shift assignment permission fix**: Shift assignment UI was gated by `scheduling.manage_assignments` instead of the broader `scheduling.manage` — users with manage permission can now assign members
- **Self-signup visibility fix**: Open Shifts tab fallback permission and self-signup button visibility corrected for non-admin members
- **Calls/Incidents section removed**: Removed placeholder Calls/Incidents section from shift detail panel (not yet implemented)
- **Dashboard shift cleanup**: "My Upcoming Shifts" hides declined and cancelled assignments
- **Position editing in shift detail**: Officers edit position assignments directly from the shift detail edit form
- **Desktop camera scanning**: Camera-based QR/barcode scanning now works on desktop via shared `useHtml5Scanner` hook with user-facing camera fallback
- **Scheduling permission cleanup**: Removed redundant permission checks and narrowed fallback scope in OpenShiftsTab and ShiftDetailPanel

### Edge Cases (2026-03-22)

| Scenario | Behavior |
|----------|----------|
| User with `scheduling.manage` but not `scheduling.manage_assignments` | Can now assign members (permission broadened) |
| Declined shift in "My Upcoming Shifts" | Filtered from dashboard display |
| Desktop with only user-facing camera | Falls back automatically for scanning |
| Member re-signing up after cancellation | Previous cancelled assignment cleaned up to avoid constraint violation |

---

---

## Notification Deep-Linking & Scheduled Tasks (2026-03-26)

- **Scheduling page `?tab=` deep-linking**: SchedulingPage accepts `?tab=schedule|my-shifts|open-shifts|requests|equipment-checks` query parameter for direct navigation to a specific tab from notifications and external links
- **Shift notification deep-link**: Shift assignment and reminder notifications link directly to the scheduling page with the shift pre-selected
- **In-process scheduled task runner**: Backend runs shift reminders, notification cleanup, and periodic tasks via a built-in asyncio task runner in `main.py` — no external cron required
- **Start-of-shift checklist CTA**: Notification cards show "Start Checklist" during the shift window or "View Shift" outside it, with deep-link to the Equipment Checks tab

### Standalone Equipment Checks (2026-03-25)

- **Equipment checks without active shift**: Members can perform ad-hoc equipment checks on any apparatus without being on an active shift
- **Flat scrollable check form**: Check form redesigned from tabbed compartments to a single scrollable view with inline compartment headers
- **Section headers in templates**: Template items support `is_header: true` for visual grouping labels that don't participate in pass/fail scoring
- **Text check type**: Read-only statement display for safety reminders and instructions within checklists
- **Critical minimum quantity**: Warning threshold below the required minimum; items below this are flagged as critical
- **Template clone fix**: `is_header` and `critical_minimum_quantity` fields now preserved during template cloning

### EVOC Certification Integration (2026-03-24)

- **EVOC certification levels**: EVOC levels (Basic, Intermediate, Advanced) tracked per member and validated against apparatus requirements for driver/operator position assignments
- **Required EVOC level on apparatus**: Each apparatus can specify a minimum EVOC level for operators

---

## Bug Fixes (2026-03-25)

| Issue | Fix |
|-------|-----|
| Apparatus type/status badges showing icon names as text | Fixed to render actual Lucide icon components |
| `navigate(-1)` causing unexpected navigation from deep links | Replaced with hardcoded parent page paths and breadcrumbs |
| Chrome ignoring custom label page sizes | Switched to iframe-based printing with top-level `@page` rules |
| App crash when MySQL not ready at startup | Added retry with exponential backoff on migration check |
| Alembic multiple migration heads | Merged divergent branches into single linear chain |

---

## Shift Reports Settings & Form Customization (2026-04-04)

### Shift Reports Settings Panel

A new **Shift Reports** sub-tab within Scheduling Settings provides centralized configuration for the shift completion report workflow, including checklist timing, post-shift validation, form section toggles, apparatus-specific skills/tasks, and rating scale customization.

**Settings stored in `org.settings["shift_reports"]`:**

| Setting | Default | Description |
|---------|---------|-------------|
| `checklist_timing.start_of_shift_enabled` | `true` | Start-of-shift equipment checklists active |
| `checklist_timing.end_of_shift_enabled` | `true` | End-of-shift equipment checklists active |
| `post_shift_validation.enabled` | `true` | Post-shift validation reminders active |
| `post_shift_validation.require_officer_report` | `false` | Mandatory shift completion report per shift |
| `post_shift_validation.validation_window_hours` | `2` | Hours after shift end for validation reminders |

### Report Form Section Toggles

Controls which optional sections appear on the shift completion report form (stored on `training_module_configs`):

| Toggle | Default | Controls |
|--------|---------|----------|
| `form_show_performance_rating` | `true` | Rating stars/scale |
| `form_show_areas_of_strength` | `true` | Strengths text field |
| `form_show_areas_for_improvement` | `true` | Improvement areas text field |
| `form_show_officer_narrative` | `true` | Free-form officer assessment |
| `form_show_skills_observed` | `true` | Structured skills checklist |
| `form_show_tasks_performed` | `true` | Structured tasks list |
| `form_show_call_types` | `true` | Call type selection |

These toggles are **separate** from the existing `show_*` visibility columns, which control what trainees see after submission.

### Per-Apparatus-Type Skills and Tasks

New JSON columns on `training_module_configs` map apparatus types to specific skills and tasks:

- **`apparatus_type_skills`** — e.g., `{"engine": ["Pump operations", "Hose deployment"], "ladder": ["Aerial operations", "Ventilation"]}`
- **`apparatus_type_tasks`** — e.g., `{"engine": ["Pump test", "Hose load inventory"], "ladder": ["Aerial extension test"]}`

When filing a report linked to a shift with an assigned apparatus, the form auto-populates the skills and tasks checklist from the apparatus type mapping. Falls back to org-wide defaults when no type-specific mapping exists.

### Rating Scale Customization

| Setting | Default | Description |
|---------|---------|-------------|
| `rating_label` | "Performance Rating" | Custom label for the rating input |
| `rating_scale_type` | "stars" | "stars" or "descriptive" |
| `rating_scale_labels` | `null` | Custom labels per level (e.g., `{1: "Needs Improvement", 5: "Exceptional"}`) |

### Save as Draft

Officers can save incomplete reports as drafts. Drafts do not trigger training pipeline progress until completed and transitioned to `approved` or `pending_review`.

### Auto-Filter Trainee List

When a shift report is linked to a specific shift, the trainee dropdown filters to show only members assigned to that shift. Ad-hoc reports (no shift linked) show the full member list.

### Bug Fixes (2026-04-04)

| Issue | Fix |
|-------|-----|
| Standalone checklist submission failing | Made `shift_id` nullable in `shift_equipment_checks` for ad-hoc checks |
| Equipment check empty templates | Return "No items to check" instead of empty form |
| Equipment check duplicate submissions | Added composite unique constraint on shift + apparatus + timing |
| Equipment check status logic | Corrected pass/fail computation for mixed check types |
| Shift report with assignment but no attendance | Gracefully handles missing attendance; allows manual hour entry |
| Report shift_date mismatch | Validates report date matches linked shift's actual date |
| Pipeline enrollment field name | Fixed incorrect field reference causing 500 errors |
| Requirement progress started_at | Added missing column referenced by training program service |
| NotificationLog metadata attribute | Renamed from reserved `metadata` to `notification_metadata` |
| Post-shift validation notification UX | Fixed "Start Checklist" / "View Shift" button logic |
| Notification deep-linking | Shift check notifications now link to checklist page |
| Equipment check query performance | Added composite indexes on `(shift_id, template_id)` and `(check_id, template_item_id)` |

### Component Architecture (2026-04-03)

ShiftTemplatesPage decomposed into focused components:
- `TemplateFormModal` — Create/edit shift template
- `PatternFormModal` — Create/edit shift pattern
- `GenerateShiftsModal` — Bulk generate shifts from pattern
- `shiftTemplateTypes.ts` — Shared TypeScript types for template/pattern forms

### Edge Cases (2026-04-04)

| Scenario | Behavior |
|----------|----------|
| All form sections toggled off | Core fields (trainee, date, hours, calls) remain; form submittable |
| Apparatus type with no mapped skills | Falls back to org-wide defaults; empty if none configured |
| Draft saved with missing fields | Validation deferred until final submission |
| Standalone equipment check (no shift) | Saved with `shift_id=NULL`; not linked to shift finalization |
| Descriptive rating with no labels | Falls back to numeric display (1-5) |
| Duplicate equipment check | Blocked by composite constraint; descriptive error returned |

---

## Skill Scoring, Batch Review & Security Hardening (2026-04-07)

### 1-5 Skill Scoring

Officers can now assign a 1-5 numeric score to each observed skill on shift completion reports. Scores flow through to `SkillCheckoff` records and competency score history. Score labels: 1=Needs work, 2=Developing, 3=Competent, 4=Proficient, 5=Excellent. Violet-themed score buttons across both `ShiftReportPage` and `ShiftReportsTab`.

### Batch Review

New batch review workflow for shift reports:

- Checkboxes appear on report cards in the **Pending Review** and **Flagged** views
- Select-all toggle to check/uncheck all reports
- "Approve Selected" and "Flag Selected" action buttons
- Backend: `POST /api/v1/training/shift-reports/batch-review` (up to 100 reports per batch)
- Returns `{reviewed, failed}` counts for feedback

### Flagged Reports

- New **Flagged** tab in ShiftReportsTab for reports flagged by reviewers
- `GET /api/v1/training/shift-reports/flagged` endpoint
- Re-review capability: flagged reports can be approved from this view

### Trainee & Officer Names

Report cards now show trainee and officer names (resolved from `User` relationships). Cards display "Trainee Name — Date" in headers. Review modal shows shift date alongside names.

### Report Content in Review Modal

Review modal renders complete report content (hours, calls, rating, strengths, improvements, narrative, skills with scores, tasks) for reviewer context.

### Skill Linkage in Apparatus Settings

`ShiftReportsSettingsPanel` shows green/amber tags for each apparatus-type skill:
- **Green**: Matches a `SkillEvaluation` record (tracks competency)
- **Amber**: No match (observed but not formally tracked)

Powered by `GET /api/v1/training/module-config/skill-names`.

### Security Fixes

- **Authorization bypass** on `GET /shift-reports/{report_id}` fixed — now requires trainee, officer, or `training.manage` permission
- **Audit logging** added to all shift report endpoints: `shift_report_created`, `shift_report_updated`, `shift_report_reviewed`, `shift_report_acknowledged`, `shift_reports_bulk_submitted`

### Bug Fixes (2026-04-07)

| Issue | Fix |
|-------|-----|
| Decimal TypeError in weekly/monthly calendar | MySQL `SUM()` returns `Decimal`; wrapped in `float()` |
| `??` → `||` for optional fields | 35 instances in prospective-members and apparatus |
| `shift_date` type mismatch | Changed from optional to required in TS types |
| Unused `LogOut` import | Removed from `MyShiftsTab` |
| Numeric column alignment | Center-aligned trainee summary table columns |

### Edge Cases (2026-04-07)

| Scenario | Behavior |
|----------|----------|
| Skill score outside 1-5 | 422 error via Pydantic `Field(ge=1, le=5)` |
| Batch review >100 IDs | Rejected by `max_length=100` |
| Batch review with invalid IDs | Valid reports processed; failed count returned |
| Flagged report re-approved | Moves to approved; deferred pipeline progress triggered |
| Non-authorized user reads report by ID | 403 Forbidden |
| Trainee reads own report | Visibility-filtered; `reviewer_notes` stripped |

---

## Shift Report Creation Redesign — Shift-First Batch Workflow (2026-04-07)

### Overview

The shift report creation flow has been redesigned from a one-report-at-a-time approach to a **shift-first batch workflow**. Officers now select a shift, see all crew members for that shift, and file reports for the entire crew in a single operation.

### How Batch Creation Works

1. Navigate to **Shift Reports > Create Report** (or click "New Report" from the reports tab)
2. Select a **shift** from the dropdown — the system loads all crew members assigned to that shift
3. Fill in **shared data** that applies to all crew members: hours on shift, calls responded, and call types
4. For each **trainee** on the crew, expand their evaluation section to add individual assessment data: performance rating, skills observed (with 1-5 scores), tasks performed, strengths, areas for improvement, and officer narrative
5. Non-trainees appear in the crew list but only receive hours/calls credit — no evaluation section is shown
6. Click **Submit All** — the system creates reports for all crew members in a single batch via `POST /api/v1/shift-completion-reports/batch`
7. The response shows `{created: N, skipped: N}` — reports are skipped if one already exists for that trainee on that shift

### Task Defaults Pre-Population

When a shift is linked to an apparatus type, the **Add Task** dialog pre-populates from the apparatus-type task mapping configured in **Scheduling > Settings > Shift Reports**. After selecting a task, the defaults remain visible for reference. This reduces data entry and ensures consistency across officers.

### Score Label Improvements

The 1-5 skill score buttons now show descriptive label text inline next to the button (not just as tooltips):
- 1 = Needs work
- 2 = Developing
- 3 = Competent
- 4 = Proficient
- 5 = Excellent

This applies to both `ShiftReportPage` and `ShiftReportsTab` and uses a consistent violet color scheme.

### Review Workflow Improvements

- **Require reason when flagging**: Flagging a report now requires entering a reason. The modal blocks submission until text is provided
- **Reviewer name on cards**: Report cards display the reviewer's name alongside the review status badge
- **Flagged report explanation**: Flagged reports show the reviewer's reason and a "Re-review" action in all view modes (not just the Flagged tab)
- **Server error messages**: Toast notifications show actual server error messages instead of generic "Failed to submit" text

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/shift-completion-reports/batch` | Batch-create shift reports for all crew on a shift |

### Edge Cases (2026-04-07)

| Scenario | Behavior |
|----------|----------|
| Batch create with mixed trainee/non-trainee crew | Non-trainees get hours/calls credit only; no evaluation data |
| Reports already exist for some crew members | Existing reports skipped; `skipped` count returned |
| Shift with no crew assignments | Empty crew list shown; submit button disabled |
| Task defaults after apparatus type change | Defaults update to match new apparatus type |
| Review comment required for flagging | Modal blocks submission without text |

---

## Shift Report Offline Support (2026-04-08)

### Draft Auto-Save

In-progress shift report forms are automatically saved to `localStorage` to prevent data loss from connectivity drops, browser crashes, or accidental navigation. The system stores:

- Shift ID and shift label
- All form field values
- Crew selections and evaluation data
- Crew remarks
- Timestamp of last save

Up to **20 drafts** are retained. When the limit is reached, the oldest draft is evicted (LRU policy).

### Offline Submission Queue

When connectivity is lost during report submission, reports are queued in **IndexedDB** and automatically synced when connectivity returns:

- Uses the same architecture as the equipment check offline queue
- Queue items include the full `BatchShiftReportCreate` payload, queued timestamp, and retry count
- On reconnection, queued reports are submitted in order
- Failed submissions are retried with incrementing retry counter

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Browser closed with unsaved form | Auto-saved draft restored on next visit |
| 21st draft saved | Oldest draft evicted to stay within 20 limit |
| Connectivity restored with queued reports | Queue drains automatically; no duplicate submissions |
| Queue item fails on retry | Retry counter incremented; kept in queue for next attempt |

---

## Shift Report Print Page (2026-04-08)

New route at `/scheduling/shift-reports/print` renders a shift completion report formatted for printing:

- **Letter-size layout** (8.5" × 11") with proper margins and page breaks
- **Department branding**: Organization name and logo in the header
- **Structured sections**: Shift info, trainee/officer names, hours, calls, performance rating, strengths, areas for improvement, narrative, skills with scores, tasks, and reviewer notes (if applicable)
- **Signature lines**: Spaces for officer and trainee signatures at the bottom
- **Auto-print**: Browser print dialog opens automatically after the page loads
- **Access**: "Print" button on report cards in ShiftReportsTab navigates to this page with `?id=<reportId>`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Redacted fields on printed report | Shows "[Redacted]" placeholder text |
| Print page for report with all sections toggled off | Only core fields (trainee, date, hours, calls) appear |
| Browser blocks auto-print dialog | Page remains visible for manual Ctrl+P |

---

## Equipment Check Improvements (2026-04-07)

### Incomplete Checklist Warning

When a member submits an equipment check with unanswered items, a confirmation dialog warns about the incomplete state. The dialog shows the count of unanswered items and asks the member to confirm they want to submit with gaps.

### Reopening In-Progress Checks

Previously, incomplete checks could not be resumed. Now:

- `PUT /api/v1/equipment-checks/checks/{id}/complete` allows completing remaining items on an incomplete check
- **MyChecklistsPage** shows a "Resume" button alongside the completion percentage for in-progress checks
- The check form loads with previously answered items pre-filled and unanswered items highlighted

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Resume check after template items were added | New items appear as unanswered alongside previously answered items |
| Resume check after template items were removed | Orphaned answers preserved but marked as "template item removed" |
| Submit with 0 items answered | Confirmation dialog warns; submission still allowed for edge cases |

---

## Department-Level Shift Report Settings (2026-04-08)

New granular toggles in the **Shift Reports Settings Panel** extend the existing form section toggles with department-level behavioral controls:

- **Editable tag lists**: Skills and tasks per apparatus type are now managed via inline `EditableTagList` components with add/remove buttons, replacing the previous accordion-only display
- **Settings connection**: Settings panel reads from and writes to both `training_module_configs` (form section toggles, apparatus mappings) and `org.settings["shift_reports"]` (checklist timing, post-shift validation)

---

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus)
