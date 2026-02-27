# Admin Hours Module

The Admin Hours module tracks administrative work hours for department members via QR code clock-in/clock-out or manual entry, with configurable approval workflows.

---

## Key Features

- **QR Code Clock-In/Clock-Out** — Scan a printed QR code at a work location to start/stop tracking time
- **Manual Entry** — Submit hours retroactively with date, duration, and notes
- **Configurable Categories** — Define work categories (e.g., Committee Meeting, Building Maintenance, Fundraising, Training Prep)
- **Auto-Approve Thresholds** — Entries below a configurable duration threshold are auto-approved; longer entries require review
- **Approval Workflow** — Admins review, approve, or reject pending entries from the management dashboard
- **Personal Hours Log** — Members view their own hours, active sessions, and submission history
- **Summary Dashboard** — Admin view of total hours, pending reviews, entries by category, and per-member breakdowns
- **Printable QR Codes** — Generate and print QR codes per category for posting at work locations

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/admin-hours` | My Admin Hours | Authenticated |
| `/admin-hours/manage` | Admin Hours Management | `admin_hours.manage` |
| `/admin-hours/qr-codes` | QR Code Generation | `admin_hours.manage` |
| `/admin-hours/clock-in` | QR Clock-In Landing | Authenticated |

---

## Workflow

### QR Code Clock-In

1. Admin creates a category (e.g., "Building Maintenance") in **Manage > Categories**
2. Admin prints the QR code from **QR Codes** tab and posts it at the work location
3. Member scans the QR code with their phone camera or the in-app scanner
4. Member is taken to the clock-in page and clicks **Clock In**
5. When done, member returns to the page (or scans again) and clicks **Clock Out**
6. Entry is submitted — auto-approved if below threshold, or queued for review

### Manual Entry

1. Member navigates to **My Admin Hours**
2. Clicks **Add Manual Entry**
3. Selects category, enters date, start/end time, and optional notes
4. Entry is submitted for review (manual entries always require approval unless below auto-approve threshold)

### Approval

1. Admin navigates to **Admin Hours > Manage**
2. Reviews pending entries in the **Pending Review** queue
3. Approves or rejects each entry with optional notes

---

## API Endpoints

```
GET    /api/v1/admin-hours/categories          # List categories
POST   /api/v1/admin-hours/categories          # Create category
PATCH  /api/v1/admin-hours/categories/{id}     # Update category
DELETE /api/v1/admin-hours/categories/{id}     # Delete category

POST   /api/v1/admin-hours/clock-in            # Clock in to a category
POST   /api/v1/admin-hours/clock-out           # Clock out of active session
POST   /api/v1/admin-hours/manual-entry        # Submit manual hours entry

GET    /api/v1/admin-hours/entries             # List all entries (admin, with filters)
GET    /api/v1/admin-hours/my-entries          # List personal entries
PATCH  /api/v1/admin-hours/entries/{id}/approve # Approve entry
PATCH  /api/v1/admin-hours/entries/{id}/reject  # Reject entry

GET    /api/v1/admin-hours/summary             # Hours summary dashboard
```

---

## Permissions

| Permission | Description |
|------------|-------------|
| `admin_hours.view` | View admin hours data (implicit for authenticated members viewing own hours) |
| `admin_hours.log` | Submit clock-in/clock-out and manual entries |
| `admin_hours.manage` | Create/edit categories, approve/reject entries, view all members' hours, generate QR codes |

---

## Data Model

### AdminHoursCategory

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | FK to organizations |
| `name` | String | Category name (e.g., "Building Maintenance") |
| `description` | Text | Optional description |
| `auto_approve` | Boolean | Whether entries below threshold are auto-approved |
| `approval_threshold_minutes` | Integer | Duration threshold for auto-approval |
| `is_active` | Boolean | Active/inactive status |

### AdminHoursEntry

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | FK to organizations |
| `user_id` | UUID | FK to users (member who worked) |
| `category_id` | UUID | FK to admin_hours_categories |
| `clock_in` | DateTime | Start time |
| `clock_out` | DateTime | End time (nullable while active) |
| `duration_minutes` | Integer | Computed duration |
| `entry_type` | String | `clock_in` or `manual` |
| `status` | String | `pending`, `approved`, `rejected` |
| `notes` | Text | Optional notes from member |
| `reviewer_id` | UUID | FK to users (who approved/rejected) |
| `reviewer_notes` | Text | Optional notes from reviewer |

---

## Frontend Architecture

### Module Structure

```
frontend/src/modules/admin-hours/
├── index.ts                    # Barrel export
├── routes.tsx                  # Route definitions
├── types/                      # TypeScript types
├── services/                   # API service (axios)
├── store/                      # Zustand store
├── pages/
│   ├── AdminHoursPage.tsx      # Personal hours view
│   ├── AdminHoursManagePage.tsx # Admin management dashboard
│   ├── AdminHoursQRCodePage.tsx # QR code generation
│   └── AdminHoursClockInPage.tsx # QR scan landing page
└── components/                 # Shared components
```

---

**See also:** [Scheduling Module](Module-Scheduling) | [Training Module](Module-Training) | [Module Configuration](Configuration-Modules)
