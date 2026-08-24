# Admin Hours Module

The Admin Hours module tracks administrative work hours for department members via QR code clock-in/clock-out or manual entry, with configurable approval workflows.

---

## Key Features

- **QR Code Clock-In/Clock-Out** — Scan a printed QR code at a work location to start/stop tracking time
- **Manual Entry** — Submit hours retroactively with date, duration, and notes
- **Configurable Categories** — Define work categories (e.g., Committee Meeting, Building Maintenance, Fundraising, Training Prep)
- **Auto-Approve Thresholds** — Entries below a configurable duration threshold are auto-approved; longer entries require review
- **Approval Workflow** — Admins review, approve, or reject pending entries from the management dashboard
- **Separation of Duties** _(2026-08-01)_ — Nobody can approve their own hours entry, even holding the approval permission. Officers log time into the same pool they approve, so a second person has to sign it off. Rejecting your own entry is still allowed — withdrawing a claim is not a conflict.
- **Personal Hours Log** — Members view their own hours, active sessions, and submission history
- **Prominent Clock-Out Card** — Active sessions display a full-width card with elapsed time and prominent clock-out button (replaces the previous slim banner)
- **Summary Dashboard** — Admin view of total hours, pending reviews, entries by category, and per-member breakdowns
- **Printable QR Codes** — Generate and print QR codes per category for posting at work locations
- **NFC Tags** — _(2026-08-18)_ Write a category's clock-in URL to a reusable tag from `/admin-hours/categories/:id/qr-code`, and read one with **Tap Tag** on My Admin Hours. See [NFC Tags](#nfc-tags-2026-08-18) below
- **Pagination & Filters** — Filter entries by status, category, member, and date range with paginated results
- **Bulk Approve** — Select multiple pending entries and approve them in one action (your own entries are refused, as above)
- **CSV Export** — Export filtered admin hours data to CSV for external reporting
- **Dashboard Integration** — Admin hours summary widget on the main Dashboard page
- **Reports Integration** — Admin hours data included in the Reports page
- **Member Profile Integration** — Individual member's admin hours visible on their profile page
- **Department Overview Integration** — Aggregate admin hours statistics in the Department Overview
- **Edit Pending Entries** — Members can edit pending entries (duration, category, notes) before approval
- **Active Sessions Management** — View and manage active clock-in sessions; stale sessions from other users are filtered out

---

## Pages

| URL                     | Page                   | Permission           |
| ----------------------- | ---------------------- | -------------------- |
| `/admin-hours`          | My Admin Hours         | Authenticated        |
| `/admin-hours/manage`   | Admin Hours Management | `admin_hours.manage` |
| `/admin-hours/qr-codes` | QR Code Generation     | `admin_hours.manage` |
| `/admin-hours/clock-in` | QR Clock-In Landing    | Authenticated        |

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
GET    /api/v1/admin-hours/active-sessions    # List active clock-in sessions
PATCH  /api/v1/admin-hours/entries/{id}       # Edit pending entry (before approval)
```

---

## Permissions

| Permission           | Description                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `admin_hours.view`   | View admin hours data (implicit for authenticated members viewing own hours)               |
| `admin_hours.log`    | Submit clock-in/clock-out and manual entries                                               |
| `admin_hours.manage` | Create/edit categories, approve/reject entries, view all members' hours, generate QR codes |

---

## Data Model

### AdminHoursCategory

| Field                        | Type    | Description                                       |
| ---------------------------- | ------- | ------------------------------------------------- |
| `id`                         | UUID    | Primary key                                       |
| `organization_id`            | UUID    | FK to organizations                               |
| `name`                       | String  | Category name (e.g., "Building Maintenance")      |
| `description`                | Text    | Optional description                              |
| `auto_approve`               | Boolean | Whether entries below threshold are auto-approved |
| `approval_threshold_minutes` | Integer | Duration threshold for auto-approval              |
| `is_active`                  | Boolean | Active/inactive status                            |

### AdminHoursEntry

| Field              | Type     | Description                         |
| ------------------ | -------- | ----------------------------------- |
| `id`               | UUID     | Primary key                         |
| `organization_id`  | UUID     | FK to organizations                 |
| `user_id`          | UUID     | FK to users (member who worked)     |
| `category_id`      | UUID     | FK to admin_hours_categories        |
| `clock_in`         | DateTime | Start time                          |
| `clock_out`        | DateTime | End time (nullable while active)    |
| `duration_minutes` | Integer  | Computed duration                   |
| `entry_type`       | String   | `clock_in` or `manual`              |
| `status`           | String   | `pending`, `approved`, `rejected`   |
| `notes`            | Text     | Optional notes from member          |
| `reviewer_id`      | UUID     | FK to users (who approved/rejected) |
| `reviewer_notes`   | Text     | Optional notes from reviewer        |

---

## Frontend Architecture

### Module Structure

```
frontend/src/modules/admin-hours/
├── index.ts                    # Barrel export
├── routes.tsx                  # Route definitions (lazy-loaded)
├── types/                      # TypeScript types
├── services/                   # API service (axios)
├── store/                      # Zustand store + tests
│   └── adminHoursStore.test.ts # 661-line test suite
├── pages/
│   ├── AdminHoursPage.tsx      # Personal hours view
│   ├── AdminHoursManagePage.tsx # Admin management (thin orchestrator)
│   ├── AdminHoursQRCodePage.tsx # QR code generation
│   └── AdminHoursClockInPage.tsx # QR scan landing page
└── components/                 # Focused sub-components (decomposed 2026-03-02)
    ├── ActiveSessionsTab.tsx   # Active clock-in sessions
    ├── AllEntriesTab.tsx       # All entries with filters
    ├── CategoriesTab.tsx       # Category management
    ├── PendingReviewTab.tsx    # Approval queue
    └── SummaryTab.tsx          # Summary dashboard
```

The `AdminHoursManagePage` was decomposed from a 1,000+ line monolith into 5 focused tab components for better maintainability.

---

**See also:** [Scheduling Module](Module-Scheduling) | [Training Module](Module-Training) | [Module Configuration](Configuration-Modules)

---

## NFC Tags _(2026-08-18)_

An NFC tag is a **second way in to a clock-in that already has a QR code** —
not a new flow. A station can mount one reusable sticker instead of reprinting
a sheet, and a member taps it with their phone. No camera, which is the part
that fails in a dark apparatus bay or with gloves on.

**Writing a tag.** The tag writer sits on the same page as the QR code. Tap
**Write to an NFC tag**, hold a blank tag to the phone, done.

**Reading one.** Android hands a URL tag straight to the browser when the app
is closed. When the app is already in the foreground the OS does not, so
**Tap Tag** in the app reads it instead — it routes by what the tag says rather
than by where the button lives.

**A tag is untrusted input, and is treated as such.** Anyone with a phone can
write one, so the payload is on par with a scanned QR code rather than with
configuration. The parser resolves it against the app's own origin, rejects
anything that lands anywhere else, accepts only known routes, and hands
react-router a **rebuilt** path rather than the raw string. An unrecognized tag
leaves the scan armed and says so rather than navigating somewhere unintended.

**Requirements: Chrome on Android, over HTTPS.** Web NFC exists nowhere else,
and browsers expose it only in a secure context — a LAN deployment on plain
`http://` cannot use it. The writer panel says which of the two you are hitting
rather than a bare "unavailable". QR remains the universal path.

## The Personal View, Rebuilt _(2026-08-23)_

### The summary is now scoped to you

`GET /admin-hours/summary` returns **organization-wide** totals when no user is
named, and the personal page fetched it unscoped — so any member holding
`admin_hours.manage` was reading the whole department's hours under "My Admin
Hours" headings.

The summary is now always scoped to the signed-in member, and lives in its own
store slice so an org-wide fetch from the management screen cannot linger under
the personal headings.

### What replaced the six-tile grid

The old layout was four fixed stats plus one tile per category that had hours,
so the tile count varied with the data and a category tile looked identical to
a headline stat while meaning something entirely different. Categories with no
hours never appeared at all, "Total Hours" restated Approved + Pending, and
"Entries" was a bare count with nothing to compare it against.

| Now                                                                       | Note                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A reporting period** — this month / last 30 days / this year / all time | Drives both the totals and the entry list, so the two always describe the same window. Period edges come from the department's calendar date and are converted to UTC instants through the shared day-boundary helpers |
| **Three fixed stats** — approved, awaiting review, logged this period     | Entry counts appear as sublines rather than tiles of their own                                                                                                                                                         |
| **Requirement progress**, from the compliance endpoint                    | The personal page never surfaced it, despite it answering the question members actually have. Rendered only where the department has configured requirements for the member's profile                                  |
| **A ranked category breakdown** with share bars                           | One muted line names the categories with no hours in the period, instead of a tile reading zero for each                                                                                                               |
| **An empty state that says what to do**                                   | In place of a row of zeros                                                                                                                                                                                             |

**The period defaults to all time.** A calendar-year opening view hid older
entries behind a control the member has to notice first, and "no hours logged
in this year" reads as an empty account rather than as an active filter. The
period phrasing sits on the option as a trailing clause, so all time reads "No
hours logged yet" rather than the ungrammatical "in all time".

## NFC Station Check-In _(2026-08-23)_

An ID card tapped at an officer-operated station now records entry method
**`nfc_station`**. It was previously recorded as `qr_scan` — the value the
clock-in path was originally written for — so exports and audits claimed a
member had scanned a category's QR code with their own phone when in fact
somebody else had tapped their card at a station. **The two are different acts
by different people** and need to be distinguishable.

Historical `qr_scan` rows are left alone: they really were written by the QR
path, and rewriting any of them would invent a provenance the database never
recorded.
