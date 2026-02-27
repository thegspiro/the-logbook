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
- **Bulk Shift Generation** — Generate multiple shifts from templates and patterns, with duplicate check by date + start_time
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

## Recent Improvements (2026-02-27)

- **Shift conflict detection**: Backend prevents duplicate assignment and overlapping time conflicts with `UniqueConstraint(shift_id, user_id)`
- **Data enrichment**: All shift responses now populate `shift_officer_name`, `attendee_count`, `user_name` on assignments, and embedded shift data on `my-assignments`
- **Pattern weekday fix**: Weekly patterns now correctly map JS weekday convention (0=Sun) to Python convention
- **Route ordering**: `/shifts/open` placed before `/shifts/{shift_id}` to prevent route shadowing
- **Dashboard fix**: Shows all organization shifts instead of only user-assigned shifts
- **Time string handling**: `formatTime()` handles bare time strings from backend
- **EMS renamed to EMT**: Position label updated across all files

---

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus)
