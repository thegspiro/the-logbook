# Admin Hours Module

The Admin Hours module tracks administrative work hours for department members via QR code clock-in/clock-out or manual entry, with configurable approval workflows.

---

## Key Features

- **QR Code Clock-In/Clock-Out** — Scan a printed QR code at a work location to start/stop tracking time
- **Manual Entry** — Submit hours retroactively with date, duration, and notes
- **Configurable Categories** — Define work categories (e.g., Committee Meeting, Building Maintenance, Fundraising, Training Prep)
- **Auto-Approve Thresholds** — A category that requires approval can still auto-approve entries under a set number of hours (**Auto-approve under (hours)**). Approval settings govern **clock-in/clock-out sessions and event attendance credit only** — hours a member logs manually always go to an officer, whatever the category says. See [Where auto-approval applies](#where-auto-approval-applies-2026-09-27)
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
- **Correct, Withdraw or Resubmit Your Own Entries** — _(2026-09-27)_ On My Admin Hours a member can **Edit** an entry awaiting review, **Edit & resubmit** one an officer rejected, or **Withdraw** either. Approved entries are an officer's to change. See [Members correct their own entries](#members-correct-their-own-entries-2026-09-27)
- **Officer Edits** — Holders of `admin_hours.manage` can still edit any pending entry (times, category, description) from the management screen
- **Active Sessions Management** — View and manage active clock-in sessions; stale sessions from other users are filtered out

---

## Pages

| URL                                           | Page                                                         | Permission           |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------- |
| `/admin-hours`                                | My Admin Hours                                               | Authenticated        |
| `/admin-hours/manage`                         | Admin Hours Management                                       | `admin_hours.manage` |
| `/admin-hours/categories/:categoryId/qr-code` | A category's QR code (and, for managers, its NFC tag writer) | Authenticated        |
| `/admin-hours/:categoryId/clock-in`           | QR Clock-In Landing                                          | Authenticated        |

Admin Hours Management has five tabs: Categories, Active Sessions, Pending
Review, All Entries and Summary.

> **Corrected 2026-10-04.** This table previously listed `/admin-hours/qr-codes`
> and `/admin-hours/clock-in`. Neither route exists: the QR code and the
> clock-in landing are both per category, at the addresses above.

---

## Workflow

### QR Code Clock-In

1. Admin creates a category (e.g., "Building Maintenance") in **Manage > Categories**
2. Admin prints the QR code from **QR Codes** tab and posts it at the work location
3. Member scans the QR code with their phone camera or the in-app scanner
4. Member is taken to the clock-in page and clicks **Clock In**
5. When done, member returns to the page (or scans again) and clicks **Clock Out**
6. Entry is submitted — approved at once if the category does not require approval or the session ran shorter than its **Auto-approve under** threshold; otherwise queued for review. A session left open past the category's max hours is closed and goes to review

The QR page also tells a member who has an NFC tag to tap it ("Have an NFC tag here? Tap it with your phone to clock in or out."), and the My Admin Hours header carries a **Tap a tag to clock in** button. The tag writer is offered only to `admin_hours.manage`, closed behind **Set up an NFC tag** _(2026-10-03)_.

### Manual Entry

1. Member navigates to **My Admin Hours**
2. Clicks **Log Hours Manually**
3. Selects category, enters start and end time (or a quick-duration preset), and an optional description
4. Clicks **Submit for review** — the toast reads "Hours submitted for review"

**A manual entry always goes to an officer for review, whatever the category's
approval settings.** The member supplies both the start and the end, so
auto-approving it would let anyone credit themselves backdated time (security
finding AH-1). The form says so above its fields.

### Correcting or withdrawing an entry _(2026-09-27)_

1. On **My Admin Hours**, find the entry in the list (the **Awaiting review**
   card is a button: it filters the list to pending entries and moves focus there)
2. **Edit** (pending) or **Edit & resubmit** (rejected) opens an inline editor
   — category, start, end and description. **Save changes** / **Resubmit**
3. **Withdraw** asks first ("Withdraw these hours?", **Keep it** / **Withdraw**)
   and keeps the entry in the member's history as _withdrawn_

### Approval

1. Admin navigates to **Admin Hours > Manage**
2. Reviews pending entries in the **Pending Review** queue
3. Approves, or rejects with a reason (**Reject** without one is refused:
   "Enter a reason for rejecting this entry"). A rejection is no longer final: the member can correct the entry and
   resubmit it, which returns it to this queue

---

## API Endpoints

All under `/api/v1/admin-hours`. `M` = requires `admin_hours.manage`; the rest
need only a signed-in member and act on the caller's own records.

```
GET    /categories                         # List categories
POST   /categories                         # M  Create category
PATCH  /categories/{category_id}           # M  Update category
DELETE /categories/{category_id}           # M  Delete category
GET    /categories/{category_id}/qr-data   # What the QR / NFC page renders

POST   /clock-in/{category_id}             # Start a session
POST   /clock-out/{entry_id}               # End your session
POST   /clock-out-by-category/{category_id} # End your session from the category's QR
GET    /active                             # Your open session, if any
GET    /active-sessions                    # M  Everyone's open sessions
POST   /entries/{entry_id}/force-clock-out # M  End someone else's session
POST   /close-stale-sessions               # M  Close sessions past their category's max hours

POST   /entries                            # Log hours manually (always pending)
GET    /entries/my                         # Your entries (paginated, filterable)
PATCH  /entries/my/{entry_id}              # Correct your own pending/rejected entry (2026-09-27)
POST   /entries/my/{entry_id}/withdraw     # Withdraw your own pending/rejected entry (2026-09-27)

GET    /entries                            # M  All entries, with filters
PATCH  /entries/{entry_id}                 # M  Edit a pending entry
POST   /entries/{entry_id}/review          # M  Approve or reject (reason required to reject)
POST   /entries/bulk-approve               # M  Approve several (your own are refused)
GET    /pending-count                      # M  Badge count
GET    /entries/export                     # M  CSV export (times in the department's timezone)

GET    /summary                            # Totals; scoped to you unless M and no user named
GET    /compliance/{user_id}               # Requirement progress
GET    /event-mappings                     # Event type -> category mappings
POST   /event-mappings                     # M
PATCH  /event-mappings/{mapping_id}        # M
DELETE /event-mappings/{mapping_id}        # M
POST   /seed-defaults                      # M  Seed the default categories
```

> **Corrected 2026-10-04.** The list this replaces named routes that do not
> exist (`/clock-in` and `/clock-out` without an id, `/manual-entry`,
> `/my-entries`, `PATCH /entries/{id}/approve` and `/reject`). The paths above
> are read from `backend/app/api/v1/endpoints/admin_hours.py`.

---

## Permissions

| Permission           | Description                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `admin_hours.view`   | Registered, but no route checks it — every member reaches their own hours by signing in                                           |
| `admin_hours.log`    | Registered, but no route checks it — clocking in/out, manual entries and correcting your own entries need only a signed-in member |
| `admin_hours.manage` | Create/edit categories, approve/reject entries, view all members' hours, write NFC tags                                           |

> **Corrected 2026-10-04.** `admin_hours.view` and `admin_hours.log` were
> described as gating a member's own hours. Neither is consulted by any
> endpoint or route; see also the 2026-09-05 dashboard note below.

---

## Data Model

### AdminHoursCategory

| Field                      | Type    | Description                                                                  |
| -------------------------- | ------- | ---------------------------------------------------------------------------- |
| `id`                       | UUID    | Primary key                                                                  |
| `organization_id`          | UUID    | FK to organizations                                                          |
| `name`                     | String  | Category name (e.g., "Building Maintenance")                                 |
| `description`              | Text    | Optional description                                                         |
| `color`                    | String  | Hex colour for the UI                                                        |
| `require_approval`         | Boolean | Whether clocked sessions and event credit need an officer (default true)     |
| `auto_approve_under_hours` | Float   | With approval required, sessions shorter than this are approved on clock-out |
| `max_hours_per_session`    | Float   | A session past this is closed and sent for review                            |
| `is_active`                | Boolean | Active/inactive status                                                       |
| `sort_order`               | Integer | Display order                                                                |

### AdminHoursEntry

| Field              | Type     | Description                                                           |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `id`               | UUID     | Primary key                                                           |
| `organization_id`  | UUID     | FK to organizations                                                   |
| `user_id`          | UUID     | FK to users (member who worked)                                       |
| `category_id`      | UUID     | FK to admin_hours_categories                                          |
| `clock_in_at`      | DateTime | Start time (UTC)                                                      |
| `clock_out_at`     | DateTime | End time (UTC; null while active)                                     |
| `duration_minutes` | Integer  | Computed duration                                                     |
| `description`      | Text     | Optional, from the member                                             |
| `entry_method`     | Enum     | `qr_scan`, `nfc_station`, `manual`, `event_attendance`                |
| `source_event_id`  | UUID     | The event an `event_attendance` entry came from                       |
| `status`           | Enum     | `active`, `pending`, `approved`, `rejected`, `withdrawn` (2026-09-27) |
| `approved_by`      | UUID     | FK to users — who approved or rejected                                |
| `approved_at`      | DateTime | When                                                                  |
| `rejection_reason` | Text     | Required on a rejection; cleared when the member resubmits            |

> **Corrected 2026-10-04.** These tables previously listed `auto_approve`,
> `approval_threshold_minutes`, `clock_in`, `clock_out`, `entry_type`, `notes`,
> `reviewer_id` and `reviewer_notes` — none of which are columns. They are now
> read from `backend/app/models/admin_hours.py`.

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

## Compliance, duration and dashboard fixes _(2026-09-05)_

### Grading

- **A profile's at-risk-threshold override of `0` was silently discarded.**
  Compliance grading fell back to the organization's default threshold instead,
  so a profile configured to grade any shortfall `non_compliant` with no
  at-risk buffer had that choice ignored.
- **Quarterly requirements and a historical year.** Admin Hours compliance for
  a quarterly requirement ignored a requested historical year and graded the
  live quarter instead.

> **⚠️ API behaviour change.**
> `GET /admin-hours/compliance/{user_id}?year=…` now returns **400 Bad
> Request** when the requested year is not the current year and the resolved
> compliance profile has a quarterly requirement — instead of `200 OK` with the
> quarterly item silently missing from the list.
>
> The endpoint's only shipped caller always uses the default (current) year, so
> no in-app flow is affected. An external caller passing an explicit `year`
> against a quarterly-graded profile now gets an error rather than a response
> that looked complete while quietly omitting an item. Passing the current
> year, or omitting `year`, is unaffected.

### A DST fall-back could shorten a logged shift

Picking a quick-duration preset — or letting the end time follow a moved start
— across the one hour per year that repeats when clocks fall back could submit
a **shorter entry than the one selected and previewed**: a 2-hour entry
recorded as 1 hour.

### Bulk approval deadlock

Bulk-approving entries could deadlock against a concurrent single-entry edit.
The previous fix had `bulk_approve` lock its own batch of entries in sorted
order and `edit_pending_entry` lock the owning member's `User` row before the
entry row — but the two did not share one global lock order. A batch containing
two entries for the same member, racing an edit whose locking overlap check
reached into the other entry in that batch, could still deadlock (InnoDB
aborting one side as a 500).

`bulk_approve` now also locks every affected member's `User` row, in sorted
order, before locking any entry row — the same _"member rows first, then entry
rows, both in a stable order"_ protocol `edit_pending_entry` already followed.

### The dashboard's Administrative hours row

Three separate defects on one row:

- **It read "Unavailable" to every ordinary member.** "Unavailable" is a claim
  the figure is unknown; the figure was simply never fetched. The dashboard
  gated the read on `admin_hours.view`, a permission that exists in the
  registry and that **no default position or rank grants** — while every other
  gate on the feature is open: `/admin-hours` carries no `ProtectedRoute`, the
  sidebar entry carries no permission, and `GET /admin-hours/summary` requires
  only authentication. The read is now unconditional, and a member who has
  logged no time this month reads `0`.
- **An officer's "My Hours" card totalled the whole department.**
  `GET /admin-hours/summary` only falls back to the caller's own id for someone
  _without_ `admin_hours.manage`, and the service applies no user filter when
  none is supplied. The request now passes the member's own id explicitly.
- **Everything logged today fell outside the month.** The month-to-date range
  went as a bare `YYYY-MM-DD`; the endpoint parses that as midnight and filters
  `clock_in_at <= end_date`, so the current day was excluded entirely — and the
  start bound cut the month at UTC midnight rather than the department's,
  pulling the tail of the previous month in for any department west of UTC.

The dashboard header's duplicate "N hrs in Month" chip is gone; the hours card
below it carries the same total plus the per-source breakdown and its own
failure state, so it is now the single statement.

## Members correct their own entries _(2026-09-27)_

Until this change a submitted entry was out of the member's hands: no edit, no
withdraw, and a rejection was final — so an officer had no way to send hours
back for correction short of rejecting them and asking for a fresh entry.

| Entry is…                                    | The member can                                      |
| -------------------------------------------- | --------------------------------------------------- |
| **Pending** (awaiting review)                | **Edit** it, or **Withdraw** it                     |
| **Rejected**                                 | **Edit & resubmit** it, or **Withdraw** it          |
| **Approved**                                 | Nothing — credited hours are an officer's to change |
| From **event attendance** (pending/rejected) | **Withdraw** only — see below                       |

- **Resubmitting clears the old decision.** Saving a rejected entry returns it
  to `pending`, and clears the approver, the decision time and the rejection
  reason: the officer's rejection applied to hours that no longer exist. The
  editor shows the reason it came back with ("Returned with: …") while you fix it.
- **Withdrawn is a status, not a delete.** A `withdrawn` entry stays in the
  member's history (with its own filter option), counts toward nothing — not
  the totals, not compliance, not the summary — and no longer blocks the member
  re-logging the same time.
- **Event-attendance entries cannot be edited by the member.** They follow the
  event's check-in record, and a resync of the event rewrites them, so an edit
  would be silently overwritten. The row says to withdraw it or ask an officer
  to correct the attendance.
- **The same guards as the officer's edit.** The member and officer edit paths
  share one validator: no time in the future, no entry over 24 hours, no
  overlap with the member's other entries, and the member's `User` row locked
  before the entry — the lock order the rest of the feature follows.

Endpoints: `PATCH /admin-hours/entries/my/{id}` and
`POST /admin-hours/entries/my/{id}/withdraw`. Another member's entry reads as
not found. Migration `8c47e8945f69` adds `withdrawn` to the status enum; it is
additive, and its downgrade turns any withdrawn entry into `rejected` with the
reason "Withdrawn by member".

## Where auto-approval applies _(2026-09-27)_

An officer who switched **Require approval** off on a category still saw every
manually logged entry land pending, and read it as a bug. It is deliberate, and
always was: approval settings — **Require approval** and **Auto-approve under
(hours)** — govern **clock-in/clock-out sessions and event attendance credit**.
A manual entry carries a start and an end the member typed, so it goes to an
officer whatever the category says (AH-1).

What changed is that the screens now say so:

- **Category form** — under the approval settings: "Approval settings apply to
  clock-in/clock-out sessions and event attendance credit. Hours a member logs
  manually always go to an officer for review, because the member enters both
  the start and end time."
- **Category list** — each row reads **Approval: Required** or **Approval: Not
  required**, **Auto-approved under \_N_h** only where approval is otherwise
  required (the threshold is inert when it is off), and **Manual entries: always
  reviewed**.
- **Log Hours Manually** — the form states that manual hours go to an officer,
  the button reads **Submit for review**, and the toast "Hours submitted for
  review".

## Training events no longer credit admin hours _(2026-09-29)_

A Training event's attendance is credited to the members' training records when
it is finalized. Crediting admin hours as well counted the same hours twice
wherever the two are added (the dashboard's My Hours, the annual compliance
report's total). An event-type mapping for `training` is now refused when
created or re-activated, one stored earlier is labelled **not in effect** on the
settings screen, and finalizing a Training event removes the admin-hours entries
that event had written — approved ones included. Details and the entries this
leaves behind are in `docs/KNOWN_LIMITATIONS.md`.

## Times in the department's timezone _(2026-09-25 → 09-26)_

- **CSV export** — Date, Clock In and Clock Out were written as UTC with no
  label, so an evening entry landed on the next day. They are now the
  department's wall clock.
- **"This year" and the quarters** for admin-hours compliance, and the default
  date range, are cut at the department's midnight rather than the server's.
