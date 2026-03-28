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

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus)
