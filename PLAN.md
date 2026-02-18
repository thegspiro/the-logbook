# Scheduling & Shifts Module Enhancement Plan

## Current State

**Backend (fully built):**
- Shift CRUD, templates, patterns, generation from patterns
- Shift assignments with 9 position types (officer, driver, firefighter, EMS, captain, lieutenant, probationary, volunteer, other)
- Swap requests (create, review, approve/deny, cancel)
- Time-off requests (create, review, approve/deny, cancel)
- Attendance tracking (check-in/out, duration)
- Shift calls/incidents recording
- Shift completion reports (training pipeline integration)
- Reporting (member hours, coverage, call volume, availability)
- `apparatus_id` and `station_id` fields on Shift (exist but no FK constraints)

**Frontend (exists but scattered):**
- SchedulingPage.tsx — calendar view, create shifts
- ShiftAssignmentsPage.tsx — assign members, swaps, time off (3 tabs)
- ShiftTemplatesPage.tsx — templates + patterns + generation
- ShiftAttendancePage.tsx — attendance records
- ShiftReportPage.tsx — completion reports
- SchedulingReportsPage.tsx — reports (4 tabs)
- Dashboard shows "my upcoming shifts"

## What's Missing

1. **Member shift signup** — no way for members to browse open shifts and volunteer for positions
2. **Apparatus in shifts** — `apparatus_id` exists on the model but UI doesn't use it
3. **Lightweight apparatus page** — departments without the apparatus module need a basic way to define their vehicles/units for shift staffing
4. **Unified scheduling experience** — pages are split across 6+ separate routes with no cohesive flow
5. **Shift detail view** — no dedicated shift detail page showing positions, crew, calls, attendance in one place

## Plan

### Step 1: Lightweight Apparatus Page (like Locations fallback)

Create a simple "Apparatus" management page for departments that don't have the full Apparatus module enabled. This provides basic vehicle/unit definitions used for shift staffing.

- **New page**: `ApparatusBasicPage.tsx` at `/apparatus-basic`
- **Uses existing** `locationsService`-style pattern but for apparatus
- **Backend**: The apparatus endpoints already exist — we just need the frontend to call them. The full apparatus module endpoints are under `/apparatus`. For non-module users, they only need:
  - List apparatus (name, unit_number, type)
  - Create/edit basic apparatus
  - Types management (Engine, Ladder, Ambulance, etc.)
- **Navigation**: Show "Apparatus" under Operations when module is OFF (same pattern as Locations vs Facilities)
- **Module toggle**: Add apparatus to `ModuleSettings` schema if not already there

### Step 2: Rebuild Scheduling Page as a Tabbed Hub

Consolidate the 6 scattered scheduling pages into one cohesive `SchedulingPage.tsx` with tabs:

**Tab 1: Schedule (Calendar)**
- Week/month calendar view (existing)
- Click a shift to open the Shift Detail panel
- Create shift button → modal with apparatus/station selection and template picker
- Color-code shifts by apparatus or template

**Tab 2: My Shifts (Member View)**
- Personal upcoming and past shifts
- Confirm/decline assignments
- Request swap or time off
- Sign up for open positions on upcoming shifts

**Tab 3: Open Shifts (Signup)**
- List of upcoming shifts with unfilled positions
- Show required positions vs filled positions
- "Sign Up" button per position → creates a ShiftAssignment with ASSIGNED status
- Filter by date range, apparatus, station

**Tab 4: Requests (Swaps & Time Off)**
- Combined swap requests and time-off requests
- Members see their own requests
- Admins see all requests with approve/deny actions

**Tab 5: Templates & Patterns (Admin)**
- Existing template/pattern management
- Generate shifts from patterns
- Configure apparatus-specific templates

**Tab 6: Reports (Admin)**
- Existing reports (member hours, coverage, call volume, availability)

### Step 3: Shift Detail Panel

A slide-out or dedicated view when clicking a shift showing:
- **Header**: Date, time, apparatus, station, shift officer
- **Crew Roster**: All assigned positions with member names, status (assigned/confirmed/declined)
- **Open Positions**: Unfilled slots with "Sign Up" or "Assign" buttons
- **Attendance**: Check-in/out records
- **Calls**: Incidents responded to during the shift
- **Notes/Activities**: Shift log

### Step 4: Apparatus Integration in Shift Creation

When creating/editing a shift:
- Dropdown to select apparatus (from basic or full apparatus list)
- When apparatus is selected, show apparatus-specific position templates
- Position slots tied to apparatus type (e.g., Engine = officer + driver + 2 firefighters)
- Station auto-fills from apparatus's primary_station

### Step 5: Shift Signup Flow for Members

Add to the backend (new endpoints needed):
- `POST /scheduling/shifts/{shift_id}/signup` — member signs up for an open position
- `DELETE /scheduling/shifts/{shift_id}/signup` — member withdraws signup

Frontend flow:
1. Member views "Open Shifts" tab → sees shifts with unfilled positions
2. Clicks "Sign Up" → picks a position from available slots
3. Creates a ShiftAssignment with status ASSIGNED (or a new PENDING status if approval is needed)
4. Admin can review and confirm/decline

Actually — the existing `POST /shifts/{shift_id}/assignments` endpoint already supports this if we allow members to self-assign. We may just need to relax the `scheduling.assign` permission or add a `scheduling.signup` permission.

### Step 6: Navigation & Module Toggle Updates

- When Apparatus module is ON: "Apparatus" under Operations shows full ApparatusPage
- When Apparatus module is OFF: "Apparatus" under Operations shows ApparatusBasicPage
- Scheduling always shows under its own section
- Add scheduling sub-pages to routing

## Implementation Order

1. **Step 1**: ApparatusBasicPage + module toggle (small, self-contained)
2. **Step 2-3**: Rebuild SchedulingPage as tabbed hub with shift detail panel
3. **Step 4**: Apparatus integration in shift creation
4. **Step 5**: Member signup flow (backend permission + frontend UI)
5. **Step 6**: Navigation updates

## Files to Create/Modify

**New files:**
- `frontend/src/pages/ApparatusBasicPage.tsx`
- `frontend/src/pages/scheduling/ShiftDetailPanel.tsx`
- `frontend/src/pages/scheduling/MyShiftsTab.tsx`
- `frontend/src/pages/scheduling/OpenShiftsTab.tsx`
- `frontend/src/pages/scheduling/RequestsTab.tsx`
- `frontend/src/pages/scheduling/TemplatesTab.tsx`
- `frontend/src/pages/scheduling/ReportsTab.tsx`

**Modified files:**
- `frontend/src/pages/SchedulingPage.tsx` (rewrite as tabbed hub)
- `frontend/src/services/api.ts` (add signup methods, apparatus basic methods)
- `frontend/src/components/layout/SideNavigation.tsx` (apparatus toggle)
- `frontend/src/components/layout/TopNavigation.tsx` (apparatus toggle)
- `frontend/src/App.tsx` (add routes)
- `frontend/src/types/modules.ts` (apparatus module entry — already exists)
- `backend/app/schemas/organization.py` (apparatus in ModuleSettings — check if exists)
