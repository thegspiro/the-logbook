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

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus)
