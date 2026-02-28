# Shifts Module — Comprehensive Review

**Reviewed:** 2026-02-28
**Scope:** Full-stack review of the scheduling/shifts module (frontend + backend)
**Files examined:** ~15 frontend components/pages, ~6 backend files, 3 test files, types, schemas, models, service layer

---

## Executive Summary

The shifts module is a feature-rich scheduling system covering shift creation, calendar views, crew assignments, swap requests, time-off management, pattern-based generation, attendance tracking, and shift completion reports. It is functionally complete and covers the major fire department scheduling workflows well. However, there are significant architectural, code quality, testing, and UX issues that should be addressed to improve maintainability, reliability, and the user experience.

---

## 1. Architecture & Code Organization

### 1.1 SchedulingPage.tsx is a 2,686-line monolith
**File:** `frontend/src/pages/SchedulingPage.tsx`
**Severity:** High

The root page contains the main scheduling view, the `ShiftSettingsPanel` component (~790 lines), the `SchedulingNotificationsPanel` component (~125 lines), plus all related types, constants, and helper functions — all in a single file. This violates the project's module conventions documented in CLAUDE.md where feature modules should be self-contained under `modules/<module>/`.

**Recommendation:** Refactor into a proper module structure:
```
frontend/src/modules/scheduling/
├── index.ts
├── routes.tsx
├── pages/
│   └── SchedulingPage.tsx        (calendar + tab router only)
├── components/
│   ├── ShiftSettingsPanel.tsx
│   ├── SchedulingNotificationsPanel.tsx
│   ├── ShiftCalendar.tsx         (extracted from SchedulingPage)
│   ├── ShiftCreateModal.tsx      (extracted from SchedulingPage)
│   ├── ShiftCard.tsx             (shift card rendering)
│   └── ... (existing tab components)
├── services/
│   └── api.ts                    (module-specific axios instance)
├── store/
│   └── schedulingStore.ts
├── types/
│   └── index.ts
└── constants/
    └── index.ts
```

### 1.2 No dedicated Zustand store
**Severity:** High

All scheduling state is managed via local `useState` in individual components. This causes:
- **Redundant data fetching:** The members list is loaded independently in both `SchedulingPage` and `ShiftDetailPanel`. Templates are loaded separately in `SchedulingPage` and `PatternsTab`.
- **No shared cache:** Navigating between tabs re-fetches all data.
- **Prop drilling:** The `onViewShift` callback is passed through multiple layers.

**Recommendation:** Create a `schedulingStore.ts` with centralized state for shifts, templates, apparatus, members, and summary data. Components subscribe to slices they need.

### 1.3 API service lives in the global services/api.ts
**Severity:** Medium

The `schedulingService` object is defined in the global `services/api.ts` alongside all other module services. Per CLAUDE.md conventions, each module should have its own `services/api.ts` with its own axios instance.

**Recommendation:** Extract `schedulingService` into `modules/scheduling/services/api.ts`.

### 1.4 Shift models are defined inside training.py
**File:** `backend/app/models/training.py` (lines 2079–2628)
**Severity:** Medium

All 10 shift-related SQLAlchemy models (`Shift`, `ShiftAttendance`, `ShiftCall`, `ShiftTemplate`, `ShiftPattern`, `ShiftAssignment`, `ShiftSwapRequest`, `ShiftTimeOff`, `BasicApparatus`, and related enums) are defined inside `training.py`. This makes the training models file extremely large and creates a misleading organizational structure.

**Recommendation:** Move shift models to `backend/app/models/scheduling.py`. Keep `ShiftCompletionReport` in `training.py` since it's tightly coupled to the training pipeline.

### 1.5 Backend scheduling_service.py is 105KB
**File:** `backend/app/services/scheduling_service.py`
**Severity:** Medium

At ~105KB, this is an extremely large service file covering shifts, templates, patterns, assignments, swaps, time-off, attendance, calls, apparatus, and reporting.

**Recommendation:** Split into focused services:
- `ShiftService` — core shift CRUD, calendar views
- `AssignmentService` — assignments, signups, confirmations
- `PatternService` — patterns and shift generation
- `SwapService` — swap requests and reviews
- `TimeOffService` — time-off requests and reviews
- `SchedulingReportService` — reports and compliance

---

## 2. Data & State Management Issues

### 2.1 Settings stored in localStorage instead of the backend
**File:** `frontend/src/pages/SchedulingPage.tsx:1901–1913`
**Severity:** High

`ShiftSettingsPanel` persists settings (default duration, min staffing, overtime threshold, custom positions, apparatus type defaults, etc.) to `localStorage`. This means:
- Settings are lost when switching browsers/devices
- Settings are not shared across the organization
- Multiple admins see different configurations

**Recommendation:** Create a backend endpoint for organization scheduling settings (similar to `TrainingModuleConfig`). Save/load from the API.

### 2.2 N+1 query problem in RequestsTab
**File:** `frontend/src/pages/scheduling/RequestsTab.tsx:56–69`
**Severity:** High

When loading swap requests, the component fetches each referenced shift individually:
```typescript
await Promise.all(
  Array.from(shiftIds).map(async (id) => {
    const shift = await schedulingService.getShift(id);
    shiftMap.set(id, shift);
  })
);
```
If there are 20 swap requests referencing 15 unique shifts, this fires 15 individual API calls.

**Recommendation:** Either:
1. Have the backend include shift details in the swap request response (server-side join), or
2. Add a batch endpoint `GET /scheduling/shifts/batch?ids=a,b,c` to fetch multiple shifts in one call.

### 2.3 Members list loaded redundantly
**Files:** `SchedulingPage.tsx:265–279`, `ShiftDetailPanel.tsx:142–160`
**Severity:** Medium

Both components independently call `userService.getUsers()` to populate member dropdowns. This fetch is not cached or shared.

**Recommendation:** Load members once in the Zustand store and share across components.

### 2.4 Assignment status field ambiguity
**File:** `frontend/src/types/scheduling.ts:15–26`
**Severity:** Medium

The `Assignment` interface has both `status` and `assignment_status` fields, both optional strings. Code throughout defensively checks both:
```typescript
const effectiveStatus = assignment.status || assignment.assignment_status || 'assigned';
```

**Recommendation:** Normalize to a single `status` field. Update the backend response schema to always populate `status` consistently. Remove `assignment_status` from the frontend type.

---

## 3. Frontend Code Quality Issues

### 3.1 `calls` typed as `Record<string, unknown>[]`
**File:** `frontend/src/pages/scheduling/ShiftDetailPanel.tsx:52`
**Severity:** Medium

Shift calls are stored as `Record<string, unknown>[]` and accessed with unsafe `String()` casts:
```typescript
String((call.incident_type ?? 'Unknown') as string)
```
The `ShiftCall` interface is already defined in `types/scheduling.ts` but not used here.

**Recommendation:** Type the state as `ShiftCall[]` and remove the `String()` casts.

### 3.2 Duplicated confirm/decline/remove UI patterns
**Files:** `ShiftDetailPanel.tsx`, `MyShiftsTab.tsx`
**Severity:** Medium

The inline two-step confirmation pattern (show "Decline?" → Yes/No) is implemented identically in multiple places:
- `MyShiftsTab` — confirm/decline assignments
- `ShiftDetailPanel` — crew board confirm/decline/remove (duplicated for both apparatus-based and standard roster views)

**Recommendation:** Extract an `InlineConfirmAction` component that encapsulates the two-step confirmation pattern. The project already has `ConfirmDialog` in `components/ux/` — consider using that or extending it.

### 3.3 Open shifts fallback swallows errors silently
**File:** `frontend/src/pages/scheduling/OpenShiftsTab.tsx:40–62`
**Severity:** Medium

The nested try/catch silently swallows the `getOpenShifts` error and falls back to `getShifts`. If both fail, only the outer error is shown. The user gets no indication that the primary endpoint failed.

**Recommendation:** Log the first error or remove the fallback pattern. If `getOpenShifts` is the correct endpoint, it should work or show an appropriate error.

### 3.4 `isPast` check ignores timezone
**File:** `frontend/src/pages/scheduling/ShiftDetailPanel.tsx:307`
**Severity:** Low

```typescript
const isPast = shiftDate < new Date();
```
This compares a date constructed from `shift.shift_date + 'T12:00:00'` with `new Date()` in the local timezone but doesn't account for the organization's timezone.

**Recommendation:** Use `getTodayLocalDate(tz)` for comparison, consistent with how `MyShiftsTab` handles it.

### 3.5 Fallback template IDs could collide
**File:** `frontend/src/pages/SchedulingPage.tsx:76–106`
**Severity:** Low

Fallback templates use IDs `_day`, `_night`, `_24hr`. While unlikely, these could theoretically collide with backend-generated IDs or cause confusion in template selection logic.

**Recommendation:** Use a more distinctive prefix like `__fallback_day` or check backend templates before falling back.

### 3.6 No shift detail panel for calls CRUD
**File:** `frontend/src/pages/scheduling/ShiftDetailPanel.tsx:818–855`
**Severity:** Low

The detail panel displays calls in read-only mode. Admins with `scheduling.manage` permission cannot create, edit, or delete calls from the UI, despite the backend supporting full CRUD.

**Recommendation:** Add call creation/editing forms in the detail panel for admin users.

---

## 4. Backend Issues

### 4.1 No overlapping shift validation
**Severity:** High

When creating assignments, neither the endpoint nor the service layer checks whether the member is already assigned to another shift that overlaps in time. A firefighter could be double-booked.

**Recommendation:** Add overlap detection in `create_assignment()`:
```python
# Check if user has conflicting assignments at the same time
existing = await db.execute(
    select(ShiftAssignment)
    .join(Shift)
    .where(ShiftAssignment.user_id == user_id)
    .where(Shift.shift_date == target_shift.shift_date)
    .where(ShiftAssignment.assignment_status.notin_(['declined', 'cancelled']))
)
```

### 4.2 Approved time-off doesn't affect existing assignments
**Severity:** High

When a time-off request is approved, existing shift assignments within that date range are not automatically flagged, removed, or reassigned. The admin must manually handle conflicts.

**Recommendation:** When approving time-off:
1. Query for assignments in the date range
2. Either auto-cancel them or surface them as conflicts for the admin to resolve
3. Send notifications about affected shifts

### 4.3 No rate limiting on swap/time-off creation
**Severity:** Medium

Users can create unlimited swap and time-off requests. A misbehaving client or frustrated user could spam the system.

**Recommendation:** Add reasonable rate limits (e.g., max 5 pending swap requests per user, max 10 time-off requests per month).

### 4.4 Pattern generation doesn't warn about existing shifts
**Severity:** Medium

While there's a duplicate-guard that prevents generating the same pattern twice, generating shifts doesn't check for or warn about conflicts with manually-created shifts on the same dates.

**Recommendation:** Return a preview/dry-run of what shifts would be generated, highlighting conflicts, before actually creating them.

### 4.5 Service returns (result, error) tuples inconsistently
**Severity:** Low

Some service methods return `(result, error_string)` tuples while others raise exceptions. This inconsistency requires the endpoint layer to handle two different error patterns.

**Recommendation:** Standardize on one approach. The project convention (per CLAUDE.md) is to raise `ValueError` for validation errors and `HTTPException` for HTTP-specific errors.

---

## 5. Testing Gaps

### 5.1 Extremely shallow frontend test coverage
**Severity:** Critical

The three existing test files total ~353 lines and only verify rendering states:

| File | Lines | What it tests |
|------|-------|---------------|
| `MyShiftsTab.test.tsx` | 105 | Loading spinner, empty state, toggle existence |
| `OpenShiftsTab.test.tsx` | 105 | Loading spinner, empty state, date filter existence |
| `RequestsTab.test.tsx` | 143 | Loading spinner, empty state, tab toggle, admin buttons existence |

None of these tests verify:
- User interactions (confirming/declining shifts, submitting swaps, signing up)
- Error handling paths
- Data transformation logic
- Modal open/close behavior
- Form validation

### 5.2 Missing test files entirely
**Severity:** Critical

The following components have zero test coverage:
- **`SchedulingPage.tsx`** (2,686 lines) — the main page with calendar, shift creation, settings
- **`ShiftDetailPanel.tsx`** (862 lines) — crew management, assignment actions
- **`PatternsTab.tsx`** (1,089 lines) — pattern creation, shift generation
- **`ShiftReportsTab.tsx`** (979 lines) — completion reports, review workflow
- **`CustomPatternBuilder.tsx`** (243 lines) — visual pattern editor
- **`PresetPatterns.tsx`** (122 lines) — preset pattern grid

### 5.3 Test assertions check CSS classes instead of content
**Severity:** Medium

Tests rely on implementation details like CSS class names:
```typescript
expect(document.querySelector('.animate-spin')).toBeInTheDocument();
```
This is fragile and doesn't verify meaningful behavior. Tests should use `screen.getByRole`, `screen.getByText`, or `screen.getByLabelText` from Testing Library.

### 5.4 No backend endpoint tests for scheduling
**Severity:** Medium

While `test_scheduling.py` exists for integration tests via the service layer, and `test_scheduling_endpoints.py` has unit tests for permission dependencies, there are no full HTTP-level endpoint tests that verify the complete request/response cycle for the scheduling API.

**Recommendation:** Add endpoint-level tests using `httpx.AsyncClient` or the FastAPI `TestClient` for critical paths: shift creation, assignment workflow, swap approval flow, pattern generation.

---

## 6. UX Improvements

### 6.1 No conflict detection for time-off requests
**Severity:** High

When a member requests time off, the modal (`MyShiftsTab.tsx:365–403`) shows only start date, end date, and reason. It doesn't display which existing shifts would be affected by the time-off period. Members and admins can't make informed decisions.

**Recommendation:** Show a list of affected shifts below the date picker: "This time-off overlaps with 2 assigned shifts: Mar 3 Day Shift, Mar 5 Night Shift."

### 6.2 No print/export view for schedules
**Severity:** Medium

Fire departments commonly print weekly/monthly schedules for posting on station bulletin boards. The module has no print stylesheet or export option.

**Recommendation:** Add a "Print Schedule" button that renders a clean, printer-friendly layout. Also consider PDF export.

### 6.3 No iCal/calendar subscription
**Severity:** Medium

Members can't subscribe to their shift schedule in external calendar apps (Google Calendar, Apple Calendar, Outlook). This is a very common feature request for scheduling tools.

**Recommendation:** Add a per-user iCal feed endpoint (`GET /scheduling/my-shifts.ics`) that returns shifts in iCalendar format.

### 6.4 No shift cloning
**Severity:** Medium

There's no way to duplicate an existing shift to a new date. Admins must recreate shifts from scratch each time, even when the configuration (template, apparatus, notes) is identical.

**Recommendation:** Add a "Duplicate Shift" action in `ShiftDetailPanel` that pre-fills the create modal with the existing shift's configuration.

### 6.5 No color legend on calendar
**Severity:** Low

The calendar uses template-based colors and time-of-day-based color coding (morning = orange, midday = yellow, evening = indigo) but doesn't display a legend explaining what each color represents.

**Recommendation:** Add a collapsible color legend below the calendar navigation bar.

### 6.6 No bulk shift operations
**Severity:** Low

Can't select multiple shifts for batch deletion, reassignment, or status changes. Managing large schedules requires repetitive individual operations.

**Recommendation:** Add checkbox selection on shift cards with a floating action bar for bulk operations.

### 6.7 Unsaved settings warning missing
**File:** `frontend/src/pages/SchedulingPage.tsx` (ShiftSettingsPanel)
**Severity:** Low

The settings tab doesn't warn users about unsaved changes when navigating away. Changes are silently lost.

**Recommendation:** Track dirty state and show a warning on tab change or navigation: "You have unsaved changes. Save before leaving?"

### 6.8 No real-time updates
**Severity:** Low (future enhancement)

When multiple admins manage shifts simultaneously, there's no mechanism (WebSocket, polling, or SSE) to keep the calendar synchronized. One admin's changes don't appear for another until they manually refresh.

**Recommendation:** Consider adding either polling (every 30s on the active tab) or WebSocket-based push notifications for shift changes.

---

## 7. Security Considerations

### 7.1 Shift settings bypass backend validation
**Severity:** Medium

Since settings are stored in `localStorage`, any input validation happens only client-side. A user could modify `localStorage` to set overtime threshold to 0 or staffing requirements to absurd values. When these settings are used for shift creation, they bypass server-side validation.

**Recommendation:** Move settings to the backend where they can be validated and enforced server-side.

### 7.2 Member search exposes full user list
**Files:** `SchedulingPage.tsx:265`, `ShiftDetailPanel.tsx:147`
**Severity:** Low

The member dropdown loads all active users via `userService.getUsers()`. For large organizations, this could expose more user data than necessary and create performance issues.

**Recommendation:** Use a paginated search endpoint that returns only matching users, limiting the data exposure.

---

## 8. Summary of Priorities

### Must Fix (High Priority)
1. **Split SchedulingPage.tsx monolith** into module structure
2. **Move settings to backend** — localStorage is not appropriate for org-wide configuration
3. **Fix N+1 query** in RequestsTab swap request enrichment
4. **Add overlapping shift validation** in assignment creation
5. **Handle time-off / assignment conflicts** when approving time-off
6. **Add meaningful test coverage** for ShiftDetailPanel, PatternsTab, SchedulingPage

### Should Fix (Medium Priority)
7. Create a Zustand store for shared scheduling state
8. Extract schedulingService to its own module API file
9. Move shift models to their own models file
10. Normalize the `status`/`assignment_status` ambiguity
11. Type shift calls properly (use `ShiftCall` interface)
12. Extract duplicated inline confirmation UI into shared component
13. Add iCal/calendar subscription support
14. Add print/export view for schedules
15. Add shift cloning functionality

### Nice to Have (Low Priority)
16. Add color legend to calendar
17. Add bulk shift operations
18. Add call CRUD in the detail panel
19. Fix timezone-unaware `isPast` comparison
20. Add rate limiting on swap/time-off creation
21. Add unsaved changes warning in settings
22. Consider real-time update mechanism
