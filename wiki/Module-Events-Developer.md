# Events Module — Developer Reference

Routes, API endpoints, data model and frontend architecture for the
events module. What the module does and how departments use it is on
[Events Module](Module-Events).

## Pages

### Member and manager pages

| URL                                 | Page                                                                                                                        | Permission       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `/events`                           | Events List                                                                                                                 | Authenticated    |
| `/events/:id`                       | Event Detail                                                                                                                | Authenticated    |
| `/events/:id/qr-code`               | Event QR Code (and NFC tag writer)                                                                                          | Authenticated    |
| `/events/:id/check-in`              | Self Check-In                                                                                                               | Authenticated    |
| `/events/attendance-requests`       | Attendance requests across events — pending "I was there" requests sent to the viewer; **All events** for `events.manage`   | Authenticated    |
| `/locations/:locationId/check-in`   | Room check-in — where a room's NFC tag lands; forwards to the open event's `/events/:id/check-in`                           | Authenticated    |
| `/events/:id/edit`                  | Edit Event                                                                                                                  | `events.manage`  |
| `/events/:id/monitoring`            | Check-In Monitoring                                                                                                         | `events.manage`  |
| `/events/:id/analytics`             | Per-event analytics dashboard                                                                                               | `analytics.view` |
| `/events/analytics`                 | Event Analytics Dashboard                                                                                                   | `analytics.view` |
| `/events/templates`                 | Event Templates Management                                                                                                  | `events.manage`  |
| `/events/admin`                     | Events Admin Hub (the **Manage Events** menu entry); Create/Settings deep-link here via `?tab=create` / `?tab=settings`     | `events.manage`  |
| `/events/new`                       | Redirects to `/events/admin?tab=create`                                                                                     | `events.manage`  |
| `/events/admin/requests/:requestId` | One outreach request on its own page (`EventRequestPage`, which renders `EventRequestsTab` with `requestId`) _(2026-11-21)_ | `events.manage`  |
| `/events/admin/community/print`     | Printable Outreach Impact summary (`?period=`)                                                                              | `events.manage`  |

The Events Admin Hub (`EVENTS_ADMIN_TABS` / `EVENTS_ADMIN_AREAS` in
`pages/eventsAdminTabs.ts`) groups nine pages under four areas: **Events**
(**Create Event**, **Past Events**), **Community Outreach** (**Overview**,
**Outreach Requests**, **Outreach Impact**, **Apparatus Events**),
**Check-ins** (**QR Code Analytics**, **Card Check-ins**) and **Settings**.
The tab ids did not change with the 2026-11-21 renames (`?tab=requests`,
`?tab=community`). An area card opens on its first destination, so
**Community Outreach** lands on `?tab=overview` _(2026-11-21)_.

**Outreach Overview** (`pages/outreach-overview/`) reads
`GET /events/outreach-calendar` (`OutreachCalendarService`, at most 93 days
and 500 rows). It decides nothing itself: which events count is
`outreach_event_clause` (the Outreach Impact rule), sheet fill is
`staffing_counts_by_request` (which now accepts events as well as requests,
keyed by owner id), crew fill is `ApparatusEventService.crew_summary`, and
closed out is `attendance_is_finalized`. Drafts are included and flagged;
cancelled events are excluded. **Log a request** links to
`?tab=requests&new=1`, which `EventRequestsTab` reads once to open the **New
request** dialog and then strips from the URL with `replace`, so a refresh or
Back does not reopen it.

### Public pages (no login)

| URL                                    | Page                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `/display/:code`                       | Room kiosk display (shows the event QR codes for the room)              |
| `/display/:code/events/:eventId/guest` | Guest sign-in form — see [Guest Check-In](Module-Events#guest-check-in) |
| `/f/:slug`                             | Public outreach request form (served by the Forms module)               |
| `/event-request/status/:token`         | Public outreach request status page                                     |

---

## API Endpoints

All under `/api/v1` unless noted. "manage" = `events.manage`.

### Events

```
GET    /events                                   # List events (authenticated)
POST   /events                                   # Create event (manage)
POST   /events/recurring                         # Create recurring series (manage)
POST   /events/import-csv                        # Bulk create from CSV (manage)
GET    /events/missed-mandatory                  # Caller's missed mandatory events
GET    /events/visible-event-types               # Visible types, custom categories, mandatory RSVP window
GET    /events/public-calendar                   # Public calendar feed (no auth)
GET    /events/analytics/summary                 # analytics.view or manage
GET    /events/settings                          # Event settings (manage)
PATCH  /events/settings                          # Update event settings (manage)
GET    /events/settings/position-options         # Positions for the attendance-request fallback (manage)
GET    /events/{id}                              # Event detail (authenticated)
PATCH  /events/{id}                              # Update (manage, or training.manage on Training; type locked)
DELETE /events/{id}                              # Delete (manage)
POST   /events/{id}/publish                      # Publish a draft (manage)
POST   /events/{id}/duplicate                    # Duplicate (manage)
POST   /events/{id}/cancel                       # Cancel (manage)
POST   /events/{id}/transfer                     # New organizer/alternate; scope "this" | "future"
GET    /events/{id}/stats                        # Event stats (attendance access, below)
GET    /events/{id}/folder                       # Event document folder (events.view)
```

`GET /events/missed-mandatory` takes `since_days` (default 30, 1–365) and
returns recent mandatory events the caller was expected at and has no
check-in for. It is narrower than `GET /events?mandatory_only=true`: events
held before the member joined, during an approved leave of absence, or
mandatory only for a membership type the member does not hold are excluded
on the server. It is per member, so it is never served from the client API
cache.

### Recurring series

```
PATCH  /events/{id}/update-future                # This and all later occurrences (manage, or training.manage on an all-Training series)
DELETE /events/{id}/series                       # Delete series; delete_future_only (manage)
POST   /events/{id}/cancel-series                # Cancel series; cancel_future_only (manage)
POST   /events/{id}/rsvp-series                  # RSVP to all future occurrences
```

### RSVP and attendees

```
POST   /events/{id}/rsvp                         # Create/update own RSVP
GET    /events/{id}/rsvps                        # Full roster with details (attendance access)
GET    /events/{id}/attendees                    # Going-only names (events.view or manage; per visibility)
GET    /events/{id}/rsvp-history                 # RSVP activity (attendance access)
GET    /events/{id}/eligible-members             # Active members for manual check-in (attendance access)
POST   /events/{id}/add-attendee                 # Add attendee (attendance access)
POST   /events/{id}/bulk-add-attendees           # Bulk add (attendance access)
PATCH  /events/{id}/rsvps/{user_id}/override     # Edit Times override (attendance access; not an organizer on Training)
DELETE /events/{id}/rsvps/{user_id}              # Remove attendee (attendance access)
POST   /events/{id}/promote-waitlist             # Promote from waitlist (manage)
POST   /events/{id}/send-reminders               # Non-respondent reminders (manage)
POST   /events/{id}/notify                       # Targeted notification (manage)
```

**Training-event administration.** Edit, update-future, record-times,
end-event, finalize-attendance and reopen-attendance go through
`_authorize_event_admin` in `endpoints/events.py`: the route's own grant
(`events.manage`, or `events.reopen_attendance` for reopen) is admitted before
any read, as before; otherwise `training.manage` is admitted on an event read
org-scoped whose type is Training (`training_manager_administers`). A training
manager's edit may not change `event_type`, and
`EventService.update_future_events(only_event_type=...)` refuses a series edit
that would reach an occurrence of another type. Edit, update-future and
reopen audit events record `acting_as`.

**Attendance access.** The roster routes above, and `POST /events/{id}/check-in`,
admit more than `events.manage`. `_authorize_attendance_manager` in
`endpoints/events.py` lets in:

| Caller                             | Events          | Limits                                                         |
| ---------------------------------- | --------------- | -------------------------------------------------------------- |
| `events.manage`                    | any             | none — admitted before the event is read, as before            |
| `training.manage`                  | Training events | none                                                           |
| the event's organizer or alternate | their own       | not their own row; on a Training event, no Edit Times override |

Anyone else gets `403`, and an event outside the caller's organization `404`.
Writes record `acting_as` (`events_manager` / `training_manager` /
`organizer`) in the audit event. Off the `events.manage` path, `user_email` on
`GET /events/{id}/rsvps` follows the member contact policy, as
`eligible-members` does. `GET /events/{id}` reports the caller's standing as
`attendance_access` and `can_correct_attendance_times`, which the detail page
reads instead of re-deriving them.

**Training-phase gate.** `POST /events/{id}/rsvp`,
`POST /events/{id}/rsvp-series` and `POST /events/{id}/self-check-in` take
`?override=<bool>`. When the member is enrolled in a training program and the
session's phase is ahead of their current phase, they answer `409` with
`{ "detail": { "warning_type": "phase_gate", "message": "…" } }`
(`rsvp-series` adds an `occurrences` list and writes nothing). Repeat with
`override=true` to proceed.

**`credited_check_in_at`** on `GET /events/{id}/rsvps` is the check-in the
credit is computed from — the officer's override if one is set, otherwise
the tap clamped forward to the scheduled start. Other RSVP responses leave it
null.

### Community risk reduction (CRR)

```
GET    /crr/catalogue                            # Activity types, counts and tags; seeds the defaults on first read (manage)
POST   /crr/activity-types                       # Add a type, with its counts (manage)
PATCH  /crr/activity-types/{id}                  # Rename, describe, reorder, retire, restore (manage)
DELETE /crr/activity-types/{id}                  # A type the department added; a built-in one is refused (manage)
PUT    /crr/activity-types/{id}/tags             # Replace a type's default tags (manage)
POST   /crr/activity-types/{id}/measures         # Add a count (manage)
PATCH  /crr/measures/{id}                        # Rename, retire, restore a count (manage)
POST   /crr/tags                                 # Add a risk or a priority population (manage)
PATCH  /crr/tags/{id}                            # Rename, retire, restore a tag (manage)
GET    /crr/zip-lookup/{zip}                     # City, state, county from the bundled GeoNames data; 404 when unknown (record or manage)
PUT    /crr/settings                             # How many months resident details are kept, 1-120, default 24 (manage)
GET    /crr/form-options                         # Active types, tags, members, the department's city and state, can_view_contact (record or manage)
GET    /crr/activities                           # Newest first; start, end, activity_type_id, event_id, limit, offset (record or manage)
GET    /crr/activities/{id}                      # One activity (record or manage)
POST   /crr/activities                           # Record one; a log entry credits its members' Admin Hours, an event's does not (record or manage)
PATCH  /crr/activities/{id}                      # Counts, tags, place, notes, resident details; recorder or events.manage (record or manage)
DELETE /crr/activities/{id}                      # Removes it and the Admin Hours it credited; recorder or events.manage (record or manage)
```

"record or manage" is `crr.record` or `events.manage`. Resident details
(address, name, phone, email) and notes are `EncryptedText`, returned only to
`crr.view_contact` holders, and each response that discloses any is audited as
`crr.resident_details_viewed` with activity ids only. Changing details needs
`crr.view_contact` too. The daily `crr_resident_details_retention` task clears
them after the department's period and stamps `resident_details_cleared_at`,
keeping ZIP, city, state, county and counts. A log entry's Admin Hours entries
carry `entry_method = crr_activity` and `source_crr_activity_id`, in the type's
own category at 100%, or else through the Public Education mapping. The event
detail response's `can_record_crr` says whether the event page offers the
recording card (`crr_recording_offered` in `endpoints/events.py`).

The ZIP data is `backend/app/data/us_zip_codes.json`, rebuilt by
`backend/scripts/build_us_zip_codes.py`. `data/` is gitignored repository-wide,
so a rebuilt file is committed with `git add -f`; `tests/test_zip_lookup.py`
fails if it is missing.
Each entry is `[city, state, county, latitude, longitude]`; `lookup_zip`
reads the first three, `zip_coordinates` the last two.

**On Outreach Impact.** `GET /dashboard/community-engagement` carries a `crr`
object for the same period and comparison as the rest of the report, built by
`CrrImpactService.breakdown` (`services/crr_impact_service.py`): `activities`
and `previous_activities`, `by_type` (each type's counts with their previous
figures), `by_tag` (an activity counts under every tag it carries, so the rows
do not sum to the total), `by_zip` (GeoNames' city and state, and the ZIP's
centre for the map) and `unplaced_activities`. It reads no resident detail.
The map (`CrrZipMap.tsx`, Leaflet, lazy) draws OpenStreetMap's tiles only once
**Show map** is pressed; the nginx CSPs allow `https://tile.openstreetmap.org`
in `img-src` and nothing else from outside, which `tests/test_csp_map_tiles.py`
holds.

### Check-in and attendance

```
GET    /events/{id}/qr-check-in-data             # QR / self check-in payload (authenticated; carries the caller's own check-in and check-out times)
POST   /events/{id}/self-check-in                # Member self check-in / check-out
POST   /events/{id}/check-in                     # Checks a member in (attendance access)
GET    /events/{id}/check-in-monitoring          # Live monitoring (manage)
POST   /events/{id}/record-times                 # Record actual start/end (manage, or training.manage on Training)
PUT    /events/{id}/guest-headcount              # Set or clear the guests counted at an outreach event (manage)
PUT    /events/{id}/outreach-closeout            # Replace the outreach close-out: outcome note, apparatus, materials, photos (manage)
GET    /events/{id}/staffing                     # The volunteer signup sheet staffing this event, its own or its request's (manage)
POST   /events/{id}/staffing                     # Open a signup sheet on an outreach event with no request behind it (manage)
POST   /events/{id}/volunteer-call               # Email the membership for help with the event's own sheet (manage; email only)
GET    /events/outreach-calendar?start=&end=     # Outreach events in a range (<= 93 days) with sheet and crew fill, for the Outreach Overview (manage)
POST   /events/{id}/end-event                    # End now + bulk checkout + finalize durations (manage, or training.manage on Training)
POST   /events/{id}/finalize-attendance          # Finalize attendance (manage, or training.manage on Training)
POST   /events/{id}/reopen-attendance            # Reopen (events.reopen_attendance, or training.manage on Training)
```

### Attendance requests

```
GET    /events/attendance-petitions/pending?scope=mine|all   # Pending across events
POST   /events/{id}/attendance-petitions                     # "I was there" request
GET    /events/{id}/attendance-petitions/mine                # Caller's request, can_request, can_withdraw
DELETE /events/{id}/attendance-petitions/mine                # Withdraw a pending request
GET    /events/{id}/attendance-petitions                     # All requests (organizer, alternate or manage)
POST   /events/{id}/attendance-petitions/{pid}/approve
POST   /events/{id}/attendance-petitions/{pid}/reject
```

All seven routes require authentication only; who may review is checked per
event in the handler (the organizer, the alternate or an `events.manage`
holder), because an organizer need not hold `events.manage`.
`GET .../pending` lists pending requests with `event_title`,
`event_start_datetime`, `event_end_datetime`, `event_actual_start_time`,
`event_actual_end_time` and `attendance_finalized`, oldest first; `scope=mine`
(default) is events the caller organizes or is alternate for, `scope=all` is
the whole department and needs `events.manage`. The caller's own requests are
never listed.

| Route         | Body                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` (ask)  | `reason` (1–1000 chars, required); `requested_check_in_at`, `requested_check_out_at` (optional, not in the future, departure after arrival) |
| `.../approve` | `check_in_at`, `check_out_at` (both required, check-out after check-in and not in the future); `review_note` (optional, ≤1000)              |
| `.../reject`  | `review_note` (1–1000 chars, required — it is the only thing the member is told)                                                            |

`GET .../mine` returns `{ petition, can_request, unavailable_reason,
can_withdraw }`; the screen offers **I was there** exactly when
`can_request` is true. A request is accepted only when the event is neither a
draft nor cancelled, its check-in window has closed, it ended
(`actual_end_time`, else `end_datetime`) no more than **30 days** ago, the
caller is not already present (`checked_in` or an `override_check_in_at`),
and the caller has no request on file (one per member per event, unique
index). Withdrawing (`DELETE .../mine`, `204`) keeps the row as `withdrawn`
so asking again reuses it and its `withdrawal_count`; after **two**
withdrawals the pending request is final (`can_withdraw: false`, further
withdrawal `400`). Every petition response carries `withdrawal_count`.
Approval writes the same override as **Edit Times**
(`override_check_in_at`, `override_check_out_at`,
`override_duration_minutes`) and sets `checked_in`; finalize credits it.
Nobody decides their own request. Audit events:
`event_attendance_petition_submitted` / `_withdrawn` / `_approved` /
`_rejected`.

| Status | When                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| `400`  | Not eligible (the sentence says why), invalid times, or the request is already decided (including on withdraw) |
| `403`  | Not the organizer, alternate or an `events.manage` holder, or deciding one's own request                       |
| `404`  | Event or request not in the caller's organization, the event is a draft, or no request to withdraw             |
| `409`  | Approve while attendance is finalized — reopen attendance first                                                |

Responses carry member names and free-text reasons, so the frontend never
caches them (`/attendance-petitions` in `UNCACHEABLE_SUBSTRINGS`).

### External attendees (guests)

```
GET    /events/{id}/external-attendees                       # (manage)
POST   /events/{id}/external-attendees                       # (manage)
PATCH  /events/{id}/external-attendees/{attendee_id}         # (manage)
PATCH  /events/{id}/external-attendees/{attendee_id}/check-in # (manage)
DELETE /events/{id}/external-attendees/{attendee_id}         # (manage)
```

### Attachments and templates

```
POST   /events/{id}/attachments                              # Upload (manage; API only)
GET    /events/{id}/attachments                              # List (events.view or manage)
GET    /events/{id}/attachments/{attachment_id}/download     # Download (events.view or manage)
DELETE /events/{id}/attachments/{attachment_id}              # Delete (manage)

GET    /events/templates                                     # List (manage)
POST   /events/templates                                     # Create (manage)
GET    /events/templates/{template_id}                       # Get (manage)
PATCH  /events/templates/{template_id}                       # Update (manage)
DELETE /events/templates/{template_id}                       # Deactivate (manage)
```

### Locations and kiosk

```
GET    /locations/{id}/display                               # What is in the room's check-in window
PUT    /locations/{id}/badge-check-in                        # Per-room ID-card kiosk switch (locations.manage_nfc_tags)

# Public, no auth — under /api/public/v1/display
GET    /api/public/v1/display/{code}                                       # Kiosk display
POST   /api/public/v1/display/{code}/badge-tap                             # Kiosk ID-card tap
GET    /api/public/v1/display/{code}/events/{event_id}/guest               # Guest sign-in info
POST   /api/public/v1/display/{code}/events/{event_id}/guest-check-in      # Guest sign-in
```

**Guest check-in.** Both guest routes work only when the event has
`allow_guest_check_in` set **and** is held in the room the display code
belongs to (`404` otherwise). The department is resolved from the display
code, never from the body, so an anonymous caller cannot name the
organization it writes to.

`GuestCheckInRequest`: `first_name`, `last_name` (required, 1–100 chars, must
contain a non-whitespace character, trimmed), `email` (needed for a prospect
to be created), `phone` (≤ 50), `organization_name` (≤ 255),
`interest_reason` (≤ 2000, stored as the attendance row's `notes`),
`hp_website` (honeypot). Response: `status` (`checked_in` |
`already_checked_in`), `attendee_id`, `event_name`, `checked_in_at`,
`message` — no prospect flag; the "someone will follow up" notice comes from
the event's `collects_prospect_details`. The GET (`GuestCheckInEventInfo`)
returns name, type, start/end, room, department name, `is_open` +
`closed_reason`, `collects_prospect_details` and the department `timezone`;
the description is withheld.

| Condition                                         | Result                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| Per-IP rate limit exceeded                        | `429`                                                                |
| Honeypot populated                                | `201` with a plausible success body, nothing written                 |
| Outside the check-in window, or attendance closed | `400` with the reason                                                |
| Per-event daily cap exceeded                      | `429` — `GUEST_CHECK_IN_DAILY_LIMIT`, default `300`, `0` disables it |

The cap is spent only by a sign-in that passed every other gate. Guests get
no early-arrival grace. Every sign-in writes an `event_external_attendees`
row with `source = 'kiosk_qr'`; with `guest_check_in_creates_prospect` and an
email it also opens or reuses a prospect, links it through
`prospect_event_links` and stores `prospect_id` on the row — a pipeline
failure is logged and swallowed. A repeat sign-in matches on email, else on
name, and returns `already_checked_in`; a guest pre-registered by staff keeps
the staff-entered details and the kiosk only fills blanks.

### Event requests (outreach pipeline)

```
POST   /event-requests/public                         # Submit (public; CAPTCHA + rate limit)
GET    /event-requests/types/labels                   # Outreach type labels (public)
GET    /event-requests/status/{token}                 # Public status
POST   /event-requests/status/{token}/cancel          # Public self-cancel

GET    /event-requests                                # List (admin)
POST   /event-requests                                # Enter a request taken by phone, email or in person (manage; no CAPTCHA or public limits)
GET    /event-requests/outreach-roles                 # Outreach role vocabulary
GET    /event-requests/forms                          # Connected request forms (manage)
POST   /event-requests/generate-form                  # Generate the public form (manage)
GET    /event-requests/{id}                           # Detail (admin)
PATCH  /event-requests/{id}/status                    # Update status
PATCH  /event-requests/{id}/assign                    # Assign coordinator
POST   /event-requests/{id}/comments                  # Add comment
PATCH  /event-requests/{id}/schedule                  # Schedule with room booking
PATCH  /event-requests/{id}/postpone                  # Postpone
PATCH  /event-requests/{id}/tasks                     # Toggle pipeline task
POST   /event-requests/{id}/send-email                # Send template email
GET    /event-requests/{id}/staffing                  # Volunteer signups (manage)
POST   /event-requests/{id}/staffing                  # Open volunteer signup sheet (manage)
POST   /event-requests/{id}/volunteer-call            # Email members for volunteers (manage)
POST   /event-requests/{id}/apparatus-crew            # Put an apparatus event template's crew on the request's event (manage + apparatus_events.manage)

GET    /event-requests/email-templates                # List email templates
POST   /event-requests/email-templates                # Create
PATCH  /event-requests/email-templates/{id}           # Update
DELETE /event-requests/email-templates/{id}           # Delete
```

**Outreach changes of 2026-11-21 (#4474), for whoever touches them next:**

- **Staff-entered requests.** `event_requests.source` (`web`, `phone`,
  `email`, `in_person`, `other`; existing rows `web`) and a nullable
  `contact_email`. Every requester email is skipped when `contact_email` is
  NULL or `notify_requester` was false; the coordinator's copy still goes, and
  `send-email` to a request with no address is a 400. The lead time is flagged
  (`reviewer_notes` "Short notice: …" plus a `lead_time_warning` activity), not
  refused. `lead_time_error` now requires the department's `today` keyword.
- **Requested dates are `DATE`** (`preferred_date_start`/`_end`), read on the
  department's calendar; the public API still accepts a datetime and keeps the
  date written in it. The public status response carries the department's
  `timezone`, and the status page formats the scheduled date in it.
- **Completion.** `PATCH /event-requests/{id}/status` to `completed` before the
  event's date is a 400. `complete_request_for_finalized_event` runs after a
  durable finalize (both exits), moves only a `scheduled` request, logs the
  activity, sends `on_completed`, and never undoes the finalize on failure.
- **Role presets.** Each `outreach_event_types` entry may carry
  `default_roles` (`[{role, count}]`), settled on save: an unknown role is a 400,
  at most 50 seats.
- **Event-owned signup sheets.** `events.staffing_shift_id` (SET NULL) and
  `events.staffing_roles`; ownership is decided once in
  `event_staffing_service.py` — an event a request was scheduled onto is
  staffed from the request. `update_event` and `postpone_event` move the sheet;
  `cancel_event` and `delete_event` stand it down (`cancel_shift`, which tells
  the crew). `cancel_event_series` and `delete_event_series` stand down every
  occurrence's own sheet too _(2026-11-21)_: the sheet ids are read before the
  commit (a deleted row's columns are gone after it), and a cancel run with
  `defer_commit=True` queues them for `complete_deferred_writes`, because
  `cancel_shift` commits on its own. `can_staff_event` on the event response
  gates the card.
- **Volunteer = RSVP.** `sync_volunteer_rsvps` (called by `SchedulingService`
  after a seat is created, edited, declined or removed has committed) makes a
  seat-holder `going` with `event_rsvps.is_volunteer = true`, and a member with
  no remaining seat `not_going` with the flag cleared; it never touches a
  checked-in RSVP or a cancelled or finalized event.
- **Volunteers take no attendee seat** _(2026-11-21, migration
  `c7e1a94d2f58`)_. Every seat count goes through `rsvp_seats(rsvp)` or
  `rsvp_seats_sql()` in `event_service.py` — 0 for a volunteer plus their
  `guest_count`, else 1 + `guest_count` — on the RSVP path, waitlist
  promotion, the list card, the detail page and the stats. A volunteer is
  never waitlisted, so guests they add must fit at once (a locking read of the
  other going seats). When a sync frees seats on a capped event (an audience
  RSVP turned crew), it returns the event id and the caller runs
  `promote_after_sync` after its commit. The check-in
  modal sorts `going` members first. `/staffing` is in
  `UNCACHEABLE_SUBSTRINGS`.
- **Close-out.** `events.outreach_outcome_note`, `outreach_apparatus_ids`
  (checked in-org in either apparatus table), `outreach_materials` (one entry
  per item, case-insensitively) and `outreach_photos` (`none`, `consented`,
  `not_consented`). Offered on the same rule as the guest headcount. Outreach
  Impact returns `materials` totals, and each event row its close-out.
- **Open Shifts window.** `OUTREACH_LOOKAHEAD_DAYS = 60` in
  `endpoints/scheduling.py`: with no end date, outreach sheets are listed 60
  days ahead and duty shifts 30.

**Outreach changes of 2026-11-22 and 2026-11-23 (#4561, #4582):**

- **Self-ticking checklist.** `AUTOMATIC_TASK_HINTS`,
  `automatic_task_states` and `effective_task_completions` in
  `event_request_service.py` (owner decision, 2026-11-22). `review_request`,
  `assign_coordinator`, `confirm_date` and `arrange_volunteers` are decided
  from the request's status, `assigned_to` and the `(filled, total)` from
  `staffing_counts_by_request`; `arrange_volunteers` is automatic only when a
  live sheet has seats. Read, never stored: every reader (detail, list, public
  status progress, the toggle's response) returns `effective_task_completions`,
  which overrides a stored tick either way — including one made by hand before
  the rule — so no backfill exists. `EventRequestResponse.automatic_tasks`
  (task id → hint) tells the screen which to lock; `PATCH …/tasks` on one is a
  400 carrying the hint. Matched by task id, so a renamed default keeps it.
- **Volunteer signup from the event page.** `EventResponse.volunteer_signup`
  (detail endpoint only; `member_signup_sheet` in `event_staffing_service.py`)
  carries the sheet's `shift_id`, its roles' counts and the caller's own
  `signed_up` / `my_role_label` — no other volunteer's name, which stays
  behind `events.manage` on `GET /events/{id}/staffing`. None for a cancelled
  event or one with no live sheet. Signing up goes through the scheduling
  signup endpoint with `outreach_role`, which enforces eligibility and the
  window. `OutreachRoleSignup` (`modules/scheduling/components/`) is the one
  control the event page (`EventVolunteerSignupCard`, or inside
  `EventStaffingCard` for an organizer) and `ShiftDetailPanel` use; the panel
  no longer offers per-seat signup, bulk fill or a position on an outreach
  sheet, and its assign form sends `outreach_role`.
- **Swaps sync RSVPs.** `_sync_outreach_after_swap` in `scheduling_service.py`
  runs `_sync_outreach_rsvps` after a swap commits, once per shift, naming the
  member who gave each seat up in `removed_user_ids` (a swap rewrites the
  seat's `user_id`, so the sync cannot see them otherwise) and adding the
  requested shift of an approved one-way move. Covers officer-approved swaps,
  accepted offers and picked-up open swaps.
- **Volunteer call from an event's own sheet.** `send_event_volunteer_call`
  reuses `volunteer_call_recipients`, `roles_still_needed` and
  `email_volunteer_call` (split out of the request's `send_volunteer_call`),
  stamps `events.volunteer_call_sent_at` (migration `e3b8d61f4a27`, nullable,
  existing rows NULL) and is audited as `event_volunteer_call_sent`. Refused
  (400) for a cancelled or past event, one with no sheet, and one linked to a
  request. Email only — not an `SmsAlert`.
- **Phone-only requests on a skipped migration.** Migration `c4e7a9d2f1b8`
  re-applies `5a41041e328b` (nullable `contact_email`, `source`) on an
  installation stamped past it by the "already exists" fallback in `main.py`,
  where a request with no email failed with MySQL 1048. A no-op elsewhere; its
  downgrade does nothing.

All event response schemas inherit from `UTCResponseBase`, so datetimes are
serialized with an explicit UTC offset.

---

## Data Model

| Table                        | Purpose                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `events`                     | The event                                                                                               |
| `event_rsvps`                | One RSVP per member per event (unique `event_id, user_id`), with check-in, override and duration fields |
| `rsvp_history`               | RSVP status changes                                                                                     |
| `event_templates`            | Reusable event defaults; `training_details` JSON on Training templates only, one shape settled at write |
| `event_external_attendees`   | Guests and non-member attendees                                                                         |
| `event_attendance_petitions` | "I was there" requests (unique `event_id, user_id`)                                                     |
| `event_hour_mappings`        | Event type / custom category → admin hours category, with percentage                                    |

### `events` — notable columns

| Column                                                                                                                                                                                                                            | Notes                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_type`                                                                                                                                                                                                                      | `business_meeting`, `public_education`, `training`, `social`, `fundraiser`, `ceremony`, `other`, `recruitment` (order is load-bearing — see above) |
| `custom_category`                                                                                                                                                                                                                 | Organization-defined category id (indexed)                                                                                                         |
| `location_id`, `location`, `location_details`                                                                                                                                                                                     | Booked location or free text                                                                                                                       |
| `start_datetime`, `end_datetime`, `actual_start_time`, `actual_end_time`                                                                                                                                                          | UTC                                                                                                                                                |
| `requires_rsvp`, `rsvp_deadline`, `max_attendees`, `allowed_rsvp_statuses`                                                                                                                                                        | RSVP rules                                                                                                                                         |
| `attendee_visibility`                                                                                                                                                                                                             | `managers` / `members` / NULL (inherit)                                                                                                            |
| `is_mandatory`, `mandatory_membership_types`                                                                                                                                                                                      | Mandatory audience                                                                                                                                 |
| `allow_guests`                                                                                                                                                                                                                    | Members may bring guests; guests occupy seats                                                                                                      |
| `send_reminders`, `reminder_schedule`, `reminder_target`                                                                                                                                                                          | Reminders                                                                                                                                          |
| `check_in_window_type`, `check_in_minutes_before`, `check_in_minutes_after`, `require_checkout`                                                                                                                                   | Check-in rules (locked once finalized)                                                                                                             |
| `allow_guest_check_in`, `guest_check_in_creates_prospect`                                                                                                                                                                         | Guest check-in                                                                                                                                     |
| `is_recurring`, `recurrence_pattern`, `recurrence_end_date`, `recurrence_custom_days`, `recurrence_weekday`, `recurrence_week_ordinal`, `recurrence_month`, `recurrence_exceptions`, `rolling_recurrence`, `recurrence_parent_id` | Recurrence                                                                                                                                         |
| `template_id`, `custom_fields`, `attachments`                                                                                                                                                                                     | `custom_fields` also holds lifecycle markers                                                                                                       |
| `attendance_finalized_at`, `attendance_finalized_by`                                                                                                                                                                              | Finalization                                                                                                                                       |
| `is_draft`, `is_cancelled`, `cancellation_reason`, `cancelled_at`                                                                                                                                                                 | Lifecycle                                                                                                                                          |
| `organizer_id`, `alternate_organizer_id`                                                                                                                                                                                          | Responsibility (indexed)                                                                                                                           |

### `event_rsvps` — notable columns

`status` (`going`, `not_going`, `maybe`, `waitlisted`), `guest_count`, `notes`,
`dietary_restrictions`, `accessibility_needs`, `checked_in`, `checked_in_at`,
`checked_out_at`, `attendance_duration_minutes`, `early_check_in_minutes`,
`override_check_in_at`, `override_check_out_at`, `override_duration_minutes`,
`overridden_by`, `overridden_at`.

`early_check_in_minutes` records how many minutes before the scheduled
start a _self_ check-in landed (null when it did not precede the start, and
never set for a manager-recorded check-in). The tap time stays the arrival
record, but credited attendance starts at the scheduled start: a
self-recorded early check-in is clamped forward, while a late one is left
alone. A manager's `override_check_in_at` is honoured verbatim. Check-In
Monitoring (`GET /events/{id}/check-in-monitoring`) lists taps at least 10
minutes early that have no override as `early_check_ins`.

### `event_external_attendees`

`name`, `email`, `phone`, `organization_name`, `checked_in`, `checked_in_at`,
`source` (`kiosk_qr`, `form_submission`, …), `source_id`, `notes`,
`prospect_id` (`ON DELETE SET NULL`).

### `event_attendance_petitions`

`status` (`pending`, `approved`, `rejected`, `withdrawn`), `reason`,
`withdrawal_count`, `requested_check_in_at`, `requested_check_out_at`,
`reviewed_by`, `reviewed_at`, `review_note`.

### Related columns elsewhere

| Table                 | Column                       | Notes                                                      |
| --------------------- | ---------------------------- | ---------------------------------------------------------- |
| `locations`           | `nfc_badge_check_in_enabled` | Per-room kiosk ID-card check-in, default off               |
| `meeting_minutes`     | `event_id`                   | `ON DELETE SET NULL` — deleting an event keeps its minutes |
| `department_messages` | `is_persistent`              | Messages only admins can clear                             |

---

## Frontend Architecture

| Area                   | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routes                 | `modules/events/routes.tsx` (`getEventsRoutes`, `getEventsPublicRoutes`); room check-in and kiosk/guest routes in `modules/facilities/routes.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| List                   | `pages/EventsPage.tsx`, `components/events/NeedsYouBand.tsx`, `EventListCard.tsx`, `eventUrgencyPresentation.tsx`, `components/CalendarView.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Detail                 | `pages/EventDetailPage.tsx` and `components/event-detail/` — `EventRSVPSection`, `EventRSVPModal`, `EventAttendeesCard`, `EventGuestsCard`, `EventProspectsCard`, `EventAttachmentsList`, `EventNotificationPanel`, `EventRecurrenceInfo`, `EventCheckInModal`, `EventOverrideAttendanceModal`, `EventRecordTimesModal`, `EventEndConfirmModal`, `EventCancelModal`, `EventCancelSeriesModal`, `EventDeleteConfirmModal`, `EventSaveTemplateModal`, `EventTransferModal`, `EventAttendancePetitionPrompt`, `EventAttendancePetitionsCard`, `AttendancePetitionDecisionDialogs`, `TrainingSessionLinkageCard` |
| Forms                  | `components/event-form/EventComposer.tsx` (picks the form by type), `components/EventForm.tsx`, `components/event-form/useEventFormModel.ts` and `sections/`, `components/training-event/TrainingEventWizard.tsx` (Training events), `components/EventOrganizerPickers.tsx`, `components/EventTemplateForm.tsx`, `components/ux/DateTimeQuarterHour.tsx`, `pages/EventCreatePage.tsx`, `pages/EventEditPage.tsx`                                                                                                                                                                                             |
| Check-in               | `pages/EventQRCodePage.tsx`, `pages/EventSelfCheckInPage.tsx`, `pages/EventCheckInMonitoringPage.tsx`, `pages/RoomCheckInPage.tsx`, `pages/GuestCheckInPage.tsx`, `pages/LocationKioskPage.tsx`                                                                                                                                                                                                                                                                                                                                                                                                              |
| NFC                    | `components/nfc/NfcTagWriter.tsx`, `NfcTagWriteButton.tsx`, `NfcTapButton.tsx`, `constants/nfc.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Admin                  | `pages/EventsAdminHub.tsx`, `pages/eventsAdminTabs.ts`, `pages/PastEventsTab.tsx`, `pages/EventRequestsTab.tsx`, `pages/EventsSettingsTab.tsx`, `pages/events-settings/*`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Other pages            | `pages/AttendanceRequestsPage.tsx`, `pages/EventTemplatesPage.tsx`, `pages/EventAnalyticsPage.tsx`, `pages/EventRequestStatusPage.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Services and utilities | `services/eventServices.ts`, `utils/eventHelpers.ts` (`isRsvpClosed`), `utils/eventAttendanceLock.ts`, `utils/genericOfflineQueue.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Backend counterparts: `api/v1/endpoints/events.py`,
`event_attendance_petitions.py`, `event_requests.py`, `locations.py`,
`api/public/display.py`; services `event_service.py`,
`event_attendance_petition_service.py`, `event_organizer_service.py`,
`guest_check_in_service.py`, `event_request_service.py`; scheduled tasks
`series_end_reminders` and `rolling_recurrence_extend` in `scheduled_tasks.py`.

Cache: `/events/missed-mandatory` and `/attendance-petitions` are in
`UNCACHEABLE_PREFIXES` (`utils/apiCache.ts`); the QR check-in payload is
fetched with `_skipCache`.

---
