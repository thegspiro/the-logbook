# Scheduling Module

The Scheduling module manages shift scheduling, member self-service signup, swap and time-off requests, shift templates, and scheduling reports.

---

## Key Features

- **Shift Calendar** — Week and month views of all scheduled shifts
- **Member Self-Service** — Sign up for open positions, confirm/decline assignments
- **9 Position Types** — Officer, driver, firefighter, EMS, and more per shift
- **Swap Requests** — Members request shift swaps with approval workflow
- **Time-Off Requests** — Request time off with admin approve/deny
- **Shift Templates** — Reusable shift configurations
- **Shift Patterns** — Daily, weekly, platoon, and custom patterns for bulk generation
- **Bulk Shift Generation** — Generate multiple shifts from templates and patterns
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

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus)
