# Events Module

The Events module manages department events with QR code check-in, recurring events, templates, RSVP tracking, and attendance analytics.

---

## Key Features

- **Event Creation** — Create one-time or recurring events with location, time, and attendance tracking
- **QR Code Check-In** — Generate unique QR codes for event check-in; members scan to register attendance
- **NFC Tag Check-In** — _(2026-08-18)_ Write the same check-in URL to a reusable NFC tag from `/events/:id/qr-code`, and read one with **Tap Tag** on the Events page. See [NFC Tags](#nfc-tags-2026-08-18) below
- **Guest Check-In** — _(2026-08-09)_ Opt-in **second** QR code on the room display that a **non-member** can scan to sign themselves in, with no account and no login. Built for outreach — volunteer interest nights, open houses. Optionally opens a prospective-member record for each guest who leaves an email. See [Guest Check-In](#guest-check-in-2026-08-09) below
- **Recurring Events** — Daily, weekly, monthly, monthly-by-weekday (e.g., "2nd Tuesday"), and annual recurrence patterns with end dates and series management
- **Event Templates** — Save and reuse event configurations
- **RSVP Management** — Going/Maybe/Not Going with RSVP overrides for admins
- **Booking Prevention** — Prevents double-booking of locations at the same time
- **Event Attachments** — The API stores, lists and serves attachments (`/events/{id}/attachments`), but no screen uploads one: the create form says "Files can't be attached from the app yet." _(corrected 2026-09-29)_
- **Reminders** — Configurable multi-tier reminders (e.g., 24 hours and 1 hour before)
- **Organizer & alternate** — _(2026-10-03)_ Every event names an organizer and an optional alternate; they decide its attendance requests and can transfer it. See [Organizer, alternate and transfer](#organizer-alternate-and-transfer-2026-10-03)
- **"I was there" attendance requests** — _(2026-09-30)_ A member with no check-in can ask to be marked present for 30 days after the event. See [Attendance requests](#attendance-requests-i-was-there-2026-09-30)
- **Room NFC tags & kiosk ID-card check-in** — _(2026-10-02)_ A tag by a room's door checks a member in to whatever is open in the room; a room kiosk can accept member ID-card taps. See [Room tags and badge check-in](#room-tags-and-badge-check-in-2026-10-02)
- **Post-Event Validation** — Organizers receive notifications to review/finalize attendance. **Finalizing closes the event**: the roster is fixed, hours are credited to everyone checked in, and the linked training record is written. Reopening needs `events.reopen_attendance`, deliberately kept out of `events.manage` so the organizer who closed an event cannot quietly reopen it and change numbers already fed into hours and compliance
- **Past Events Tab** — Managers can browse historical events (hidden from regular members by default)
- **Attendee Management** — Add/remove attendees directly from event detail page
- **Training Integration** — Events can generate training sessions for attendance credit. _(2026-08-05)_ The reverse now exists too: generating a **course cohort** creates one event per class of a multi-class course (a recruit school's fifteen subjects), each with its linked training session and the roster already RSVP'd — see [Module-Training](Module-Training#multi-class-courses--cohorts-2026-08-05)
- **Custom Event Categories** — _(2026-03-04)_ Define organization-specific event categories with color badges, filterable on the Events page and selectable in the Event form. Configured in Events Settings > Custom Event Categories

---

## Pages

| URL                               | Page                                                                                                                                                                           | Permission       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `/events`                         | Events List                                                                                                                                                                    | Authenticated    |
| `/events/:id`                     | Event Detail                                                                                                                                                                   | Authenticated    |
| `/events/:id/qr-code`             | Event QR Code                                                                                                                                                                  | Authenticated    |
| `/events/:id/check-in`            | Self Check-In                                                                                                                                                                  | Authenticated    |
| `/events/:id/edit`                | Edit Event                                                                                                                                                                     | `events.manage`  |
| `/events/:id/monitoring`          | Check-In Monitoring                                                                                                                                                            | `events.manage`  |
| `/events/:id/analytics`           | Event Analytics                                                                                                                                                                | `analytics.view` |
| `/locations/:locationId/check-in` | Room check-in — where a room's NFC tag lands; forwards to the open event's `/events/:id/check-in` _(2026-10-02)_                                                               | Authenticated    |
| `/events/admin`                   | Events Admin Hub — the sidebar entry is labeled **Manage Events** and points at `/events` since 2026-08-13; Create/Settings deep-link here via `?tab=create` / `?tab=settings` | `events.manage`  |

---

## API Endpoints

```
GET    /api/v1/events                        # List events
POST   /api/v1/events                        # Create event
GET    /api/v1/events/{id}                   # Get event details
PATCH  /api/v1/events/{id}                   # Update event
DELETE /api/v1/events/{id}                   # Delete event
POST   /api/v1/events/{id}/check-in          # Check in to event
POST   /api/v1/events/{id}/rsvp              # RSVP to event
GET    /api/v1/events/{id}/attendees         # List attendees
POST   /api/v1/events/{id}/attendees         # Add attendee
POST   /api/v1/events/{id}/duplicate         # Duplicate event
GET    /api/v1/events/{id}/qr-code           # Get QR code
POST   /api/v1/events/{id}/transfer          # Hand to a new organizer/alternate; scope "this" | "future" (2026-10-03)
GET    /api/v1/events/settings/position-options          # Positions for the attendance-request fallback (2026-10-03)
POST   /api/v1/events/{id}/attendance-petitions          # "I was there" request (2026-09-30)
GET    /api/v1/events/{id}/attendance-petitions/mine     # The caller's request and can_request
GET    /api/v1/events/{id}/attendance-petitions          # All requests (organizer, alternate or events.manage)
POST   /api/v1/events/{id}/attendance-petitions/{pid}/approve
POST   /api/v1/events/{id}/attendance-petitions/{pid}/reject
PUT    /api/v1/locations/{id}/badge-check-in             # Per-room ID-card kiosk switch, locations.manage_nfc_tags (2026-10-02)
POST   /api/public/v1/display/{code}/badge-tap           # Unauthenticated kiosk card tap (2026-10-02)
```

---

## Guest Check-In _(2026-08-09)_

A room display used to show **one** QR code, pointing at `/events/{id}/check-in`
— a member route behind authentication. A visitor at a volunteer interest night
who scanned it was bounced to the login page, so their attendance was recorded by
hand or not at all.

An event can now opt in to a **second, guest-specific** QR code. The two stay
separate rather than one code serving both: the member flow is untouched,
including **check-out**, which is meaningless for a walk-in.

### Turning it on

Both switches are on **Edit Event → Check-In Settings**, and both default to off.

| Setting                                     | Field                             | Effect                                                                        |
| ------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| Allow guest check-in                        | `allow_guest_check_in`            | Shows the guest QR code on the room display and opens the public sign-in page |
| Create a prospective member from each guest | `guest_check_in_creates_prospect` | Also opens a pipeline record for each guest who supplies an email             |

> **Off by default is deliberate.** Turning the first one on exposes an
> **unauthenticated write path**. It belongs on outreach events and should stay
> off for business meetings and training sessions, whose attendance drives
> records that only apply to members.

### What the guest sees

`/display/:code/events/:eventId/guest` — a public sign-in form, outside the app
shell. It asks for first and last name (required) and, optionally, email, phone,
the organization they are with, and why they came. Nothing more: a walk-in should
be asked for the minimum needed to follow up, not for a membership application.
The real application form is what the follow-up email links to.

The page is addressed through the **room's display code** so the backend can
resolve the department without a session, and it uses bare `fetch` rather than
the shared axios instance — that instance's 401 interceptor would redirect the
very visitors the page exists for.

### What gets written

| Record                     | When                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `event_external_attendees` | Always. `source = 'kiosk_qr'`, distinguishing a self-recorded sign-in from one a staff member typed in |
| `prospective_members`      | Only when the event opts in **and** the guest supplied an email                                        |
| `prospect_event_links`     | Links that prospect to the event, `referral_source = "Attended: {title}"`                              |

`event_external_attendees.prospect_id` ties the two together with
`ON DELETE SET NULL`, so purging a prospect never destroys the record of who was
in the room — that is the event's history, not the prospect's.

### How it is protected

- The department is resolved from the **display code**, never from the request,
  and the event must actually be held in that room.
- **Per-IP rate limiting** and a **per-event daily ceiling**
  (`GUEST_CHECK_IN_DAILY_LIMIT`, default 300; `0` disables it). Per-IP limiting
  alone cannot stop a distributed flood, and each sign-in can create a pipeline
  record — a far more expensive side effect than a page view.
- A **honeypot field** that a real browser leaves empty. A populated honeypot is
  answered with a plausible success and nothing is written, so a bot gets no
  signal to adapt to.

### Edge cases

| Situation                                                                    | Behavior                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest arrives before the check-in window opens                               | Refused. Guests get the organizer's window **minus the early-arrival grace** members get — a member checking in early is identifiable and correctable, an anonymous early write is neither                                                                                                                                                       |
| Guest taps the QR code twice                                                 | Matched on email where one was given, on name where it was not; returns `already_checked_in` rather than a second row                                                                                                                                                                                                                            |
| Two guests with the same name and no email                                   | They collapse into one row. The weaker fallback is deliberate — a duplicate on every double-tap is the far more common problem at a kiosk                                                                                                                                                                                                        |
| Staff pre-registered the guest                                               | The sign-in fills blanks only; anything staff deliberately typed is kept                                                                                                                                                                                                                                                                         |
| Guest is already in the pipeline                                             | The existing active prospect is linked to the event instead of a duplicate being opened                                                                                                                                                                                                                                                          |
| The prospect cannot be created                                               | Logged and swallowed. The attendance is still recorded and the guest still sees a confirmation — the sign-in is the thing they came to do                                                                                                                                                                                                        |
| The prospect is later purged                                                 | The attendance row survives with `prospect_id` set to NULL                                                                                                                                                                                                                                                                                       |
| Guest leaves no email                                                        | Attendance is recorded; no prospect is opened, because there is no way to follow up                                                                                                                                                                                                                                                              |
| Guest opens a prospect, whose pipeline later has an "attend a meeting" stage | _(2026-09-16)_ The sign-in that opened the record counts for a meeting stage the applicant is on **at that event**, but not for a later stage — that needs a second meeting. And a check-in advances nobody by itself: the stage moves when the event's attendance is **finalized**, or 7 days after it ends (`PIPELINE_ATTENDANCE_SETTLE_DAYS`) |

---

## Public Outreach Request Pipeline

The Events module includes a public outreach request pipeline that lets community members submit event requests (fire safety demos, station tours, school visits, CPR classes, etc.) through a public-facing form. Department coordinators manage requests through a configurable workflow.

> **Public intake is opt-in** _(2026-08-17)_. Turn it on under **Events →
> Settings → Request pipeline → Accept Public Requests**; it is **off by
> default**, including for existing departments. While it is off the public
> endpoint answers as though the department does not exist — deliberately
> indistinguishable, so the endpoint cannot be used to enumerate which
> departments accept requests — and staff can still create requests
> internally. When it is on, a submission must clear a human challenge and a
> hidden honeypot field, and each department has a daily ceiling
> (`public_daily_limit`, default 50) that counts **valid** submissions only,
> so junk traffic cannot exhaust the allowance and lock out real requesters.

### Pipeline Features

- **Public Submission Form** — Community members fill out a form (via the Forms module) that feeds into the pipeline. No authentication required.
- **Configurable Outreach Types** — Each department defines their own outreach categories (e.g., `fire_safety_demo`, `station_tour`, `school_visit`).
- **Default Coordinator Assignment** — New requests auto-assign to a configured coordinator who receives an email notification.
- **Flexible Date Preferences** — Requesters can specify exact dates, a general timeframe, or indicate full flexibility.
- **Configurable Pipeline Tasks** — Departments define custom checklist steps (e.g., "Chief Approval", "Volunteer Signup Email", "Equipment Prep") with reorderable tasks.
- **Scheduling with Room Booking** — Coordinators set a confirmed date, create a calendar event, and book a room — with double-booking prevention.
- **Comment Thread** — Internal discussion thread on each request visible to coordinators.
- **Cancel / Postpone** — Both the requester (from the public status page) and the department can cancel or postpone. Postponed requests can have a new date or no date.
- **Email Templates & Triggers** — Departments configure which status changes send email notifications and store reusable templates (e.g., "How to Find Our Building" email).
- **Public Status Page** — Token-based public page where requesters can check their request status, see progress (if department enables it), and cancel.

### Pipeline Status Flow

```
submitted → in_progress → scheduled → completed
                ↕               ↕
            postponed       postponed

Any active status → declined / cancelled
```

### Pages

| URL                                  | Page                      | Permission       |
| ------------------------------------ | ------------------------- | ---------------- |
| `/events/admin` (Event Requests tab) | Event Requests Admin      | `events.manage`  |
| `/events/admin` (Settings tab)       | Pipeline & Email Settings | `events.manage`  |
| `/request-status/:token`             | Public Request Status     | Public (no auth) |
| `/f/:slug`                           | Public Request Form       | Public (no auth) |

### API Endpoints — Event Requests

```
POST   /api/v1/event-requests/public                     # Submit new request (public)
GET    /api/v1/event-requests/public/outreach-labels      # Get outreach type labels
GET    /api/v1/event-requests/status/{token}              # Check public status
POST   /api/v1/event-requests/status/{token}/cancel       # Public self-cancel

GET    /api/v1/event-requests                             # List requests (admin)
GET    /api/v1/event-requests/{id}                        # Get request detail (admin)
PATCH  /api/v1/event-requests/{id}/status                 # Update status
PATCH  /api/v1/event-requests/{id}/assign                 # Assign coordinator
POST   /api/v1/event-requests/{id}/comments               # Add comment
PATCH  /api/v1/event-requests/{id}/schedule               # Schedule with room booking
PATCH  /api/v1/event-requests/{id}/postpone               # Postpone request
PATCH  /api/v1/event-requests/{id}/tasks                  # Toggle pipeline task
POST   /api/v1/event-requests/{id}/send-email             # Send template email

GET    /api/v1/event-requests/email-templates              # List email templates
POST   /api/v1/event-requests/email-templates              # Create template
PATCH  /api/v1/event-requests/email-templates/{id}         # Update template
DELETE /api/v1/event-requests/email-templates/{id}         # Delete template
```

---

## Recent Changes (2026-03-13)

### Event Detail Page Refactor & Quick-Create

- **EventDetailPage split into sub-components**: Extracted `EventAttachmentsList`, `EventNotificationPanel`, `EventRSVPSection`, `EventRecurrenceInfo` for focused, maintainable detail page sections
- **Quick-create events**: Streamlined creation flow requiring only title, date, and time with sensible defaults for all other fields
- **Rich text descriptions**: Event descriptions now support WYSIWYG rich text formatting

### Calendar View & Analytics

- **CalendarView component**: Monthly calendar grid with event dots, day highlighting, collapsible daily event lists, timezone-aware display, navigation between months, event type badges with color coding
- **EventAnalyticsPage**: Summary cards (total events, RSVPs, check-ins, attendance rate, avg check-in time), event type distribution bar chart, monthly trends line chart, top events table with date range filtering
- **Event templates management page**: Dedicated `EventTemplatesPage` for CRUD on event templates with list view, create/edit modal, toggle active status, delete confirmation

### RSVP Enhancements

- **RSVP history tracking**: Collapsible activity history feed showing all RSVP changes with timestamps on the event detail page
- **Dietary/accessibility RSVP fields**: RSVP form collects dietary restrictions and accessibility requirements
- **Inline RSVP**: RSVP directly from the events list without opening the detail page
- **Series RSVP**: RSVP to all events in a recurring series at once
- **RSVP countdown**: Shows time remaining until RSVP deadline
- **Waitlist system**: Events at capacity auto-waitlist new RSVPs; waitlisted attendees promoted when spots open
- **Non-respondent reminders**: Send targeted reminders to members who haven't RSVP'd
- **CSV export**: Export event attendee list as CSV
- **Print roster**: Print-formatted attendee roster for on-site use

### Event Notification Panel

- **EventNotificationPanel component**: Send targeted notifications from event detail page
- **Notification types**: announcement, reminder, follow_up, missed_event, check_in_confirmation
- **Target audiences**: all, going (RSVP'd yes), not_responded, checked_in, not_checked_in (RSVP'd but absent)

### Recurrence Improvements

- **Recurrence editing**: Edit recurrence pattern on existing events
- **Edit all future**: Updates the edited occurrence and every later one in the series (UI: **This and all future events**). _(2026-09-28)_ Times are applied as a shift, not copied — see [Recurring series keep their dates and times](#recurring-series-keep-their-dates-and-times-2026-09-28)
- **Recurrence exceptions**: Exclude individual occurrences from a recurring series without affecting others
- **Series overview & navigation**: Recurring event detail pages show series badge, "View All in Series" link, and series management actions

### Bulk & Import Features

- **Duplicate/bulk actions**: Duplicate events with one click; bulk actions for managing multiple events
- **CSV import**: Import events from CSV files for bulk creation (validates required fields, skips invalid rows with error reporting)
- **Saved filter presets**: Save and recall frequently used event filter combinations
- **Template picker**: Quick-select from existing templates when creating a new event

### Additional Features

- **Draft/publish workflow**: Events can be saved as drafts and published when ready (drafts hidden from non-admin users)
- **Save as template**: Save any event configuration as a reusable template
- **Enhanced search**: Full-text search across event titles, descriptions, and locations
- **My Events filter**: Filter events to show only those the current user has RSVP'd to
- **Sort options**: Sort events by date, title, attendance, or creation date
- **Conflict detection**: Warning when creating events that overlap with existing events at the same location (warns, does not block)
- **Timezone labels**: All event times display with timezone abbreviation labels
- **Directions link**: Map/directions link for events with a location
- **Dashboard widget**: Events widget on the main dashboard showing upcoming events
- **File upload UI**: Upload attachments (flyers, agendas, maps) directly to events
- **Capacity bar**: Visual progress bar showing RSVP count vs. capacity on event cards
- **Calendar export**: Export events to iCal/Google Calendar format
- **Attendance display**: Visual attendance count on event cards

### New Pages (2026-03-13)

| URL                 | Page                       | Permission       |
| ------------------- | -------------------------- | ---------------- |
| `/events/analytics` | Event Analytics Dashboard  | `analytics.view` |
| `/events/templates` | Event Templates Management | `events.manage`  |

### Edge Cases (2026-03-13)

| Scenario                 | Behavior                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Waitlisted attendees     | Promoted in RSVP order when spots open                                              |
| Draft events             | Not visible to non-admin users                                                      |
| Conflict detection       | Warns but does not block — departments may intentionally schedule concurrent events |
| Recurrence exceptions    | Tracked per-occurrence; deleting the exception restores the occurrence              |
| CSV import invalid rows  | Skipped with error reporting; valid rows are still imported                         |
| Calendar export          | Respects user's timezone setting                                                    |
| Non-respondent reminders | Excludes members who already responded (going, not going, or maybe)                 |
| Template picker          | Shows only active templates; deactivated templates hidden but not deleted           |

---

## Recent Changes (2026-05-29)

### Dashboard, Offline RSVP & Audit

- **"Upcoming Events" dashboard count is now a rolling 30-day window**: the count
  uses `start_datetime >= now AND start_datetime < now + 30 days` and excludes
  cancelled events (previously counted every future non-cancelled event,
  inflating the number with events years out). The card description reads
  "Next 30 days"
- **Offline RSVP queuing**: event RSVPs made while offline are queued in
  IndexedDB and drained automatically when connectivity returns (shares the new
  generic offline-queue infrastructure with training submissions). The nav shows
  an "N pending sync" indicator
- **`event_attendee_overwritten` audit event** (severity `warning`): logged when
  a manager adds an attendee whose action overwrites an existing RSVP (a normal
  add logs `event_attendee_added` at `info`)

---

## Recent Changes (2026-03-22)

### Recurring Series, End Event, Admin Hours & Notifications

- **Rolling 12-month recurrence**: Recurring events can use a rolling 12-month window that automatically extends the series forward
- **Delete series support**: Officers can delete an entire recurring event series with confirmation showing the count of events to be removed
- **"End Event" button**: Bulk checkout of all currently checked-in attendees at once from the event detail page
- **Compact event create form**: 2-column grid layout pairing related sections for reduced scrolling
- **Event-to-admin-hours integration**: Events linked to admin hour tracking categories automatically credit attendance hours toward administrative compliance
- **Event deletion FK fix**: Deleting events with linked meeting minutes no longer fails — cascade properly handles the FK constraint
- **Check-in monitoring consistency**: Fixed monitoring page using different time window logic than QR self-check-in
- **Event request form publish status**: Request forms show publish status badges on Events Settings page
- **Dashboard notifications**: event notices appear in the dashboard's **My Updates** feed, one list of unread notifications and department messages — opening a row marks it read, and **Older Items** opens the full inbox. Only holders of `notifications.manage` or `settings.manage` can clear a persistent department message, and clearing it removes it for everyone. _(The per-card clear and dismiss buttons this entry first described were replaced by that feed on 2026-08-16; there is no Clear All.)_
- **Notification channel filter**: Notifications page includes channel filter (email, in-app, SMS)
- **Email deliverability improvements**: Message-ID headers, batch rate limiting, inline CSS, SMTP reuse, Gmail clipping fix

### Data Model Changes (2026-03-22)

| Table                      | Change                         | Description                                        |
| -------------------------- | ------------------------------ | -------------------------------------------------- |
| `events`                   | `rolling_recurrence` (Boolean) | Enables rolling 12-month recurrence window         |
| `event_hour_mappings`      | New table                      | Maps event types to admin hour tracking categories |
| `admin_hours_requirements` | New table                      | Compliance requirements for admin hour categories  |
| `meeting_minutes`          | FK cascade update              | `event_id` FK cascades on delete                   |
| `department_messages`      | `is_persistent` (Boolean)      | Messages only admins can clear                     |

### API Endpoints (2026-03-22)

```
DELETE /api/v1/events/{id}/series                # Delete entire recurring event series
POST   /api/v1/events/{id}/end                   # Bulk checkout all checked-in attendees
```

### Edge Cases (2026-03-22)

| Scenario                                 | Behavior                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| Rolling recurrence with no end date      | Generates 12 months ahead, auto-refreshed                  |
| Delete series with past events           | All events removed (past and future)                       |
| "End Event" with no checked-in attendees | No-op with informational message                           |
| Event linked to minutes then deleted     | Minutes `event_id` set to null via cascade                 |
| Admin hours with no mapping configured   | Attendance not credited; mapping required                  |
| Non-admin clearing persistent message    | Clear button not shown                                     |
| Gmail with large email body              | Hosted image URLs replace base64 logos to prevent clipping |

---

## Recent Changes (2026-03-19)

### In-App Notifications, Time Picker & Check-In Fix

- **In-app notification delivery**: Event notifications (announcement, reminder, follow-up, missed_event, check_in_confirmation) now deliver via in-app notifications in addition to email
- **15-minute increment enforcement**: All time pickers across event forms now restrict to quarter-hour increments (`:00`, `:15`, `:30`, `:45`)
- **QR display / self-check-in timing mismatch fix**: Fixed a bug where the QR code display page and the self-check-in page used different datetime sources for the check-in window, causing valid check-ins to be rejected
- **UTC timezone stamping**: All event response schemas now inherit from `UTCResponseBase`, ensuring consistent timezone serialization

### Edge Cases (2026-03-19)

| Scenario                                         | Behavior                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| In-app notifications                             | Appear in the member's notification bell alongside email delivery     |
| Time picker with pre-existing non-quarter values | Rounds to the nearest quarter-hour on next edit                       |
| Check-in window near midnight                    | Uses consistent datetime source for both QR display and self-check-in |

---

## Recent Changes (2026-03-15)

### Series End Reminders & Check-In Fix

- **Series end email reminders**: When a recurring event series is nearing its end date, organizers receive an email reminder to extend or close the series. Sent 7 days before the last occurrence
- **Recurring event creation crash fix**: Fixed crash when creating recurring events with certain recurrence patterns that generated dates beyond the series end date
- **Check-in modal fix**: Added missing `GET /api/v1/events/{id}/eligible-members` endpoint. Fixed modal overlay z-index so the check-in modal is above the backdrop
- **EventForm timezone bug fix**: Date arithmetic and conflict detection now use timezone-aware calculations instead of raw UTC comparisons

### Edge Cases (2026-03-15)

| Scenario                           | Behavior                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Series already ended               | No reminder is sent                                                           |
| Eligible members endpoint          | Returns only members who haven't already checked in                           |
| Conflict detection across midnight | Correctly identifies overlaps when events span midnight in the org's timezone |

---

## Recent Changes (2026-03-12)

- **Monthly-by-weekday recurrence**: Events can recur on patterns like "2nd Tuesday of every month" or "last Friday of every month". New `recurrence_week` and `recurrence_day_of_week` database columns
- **Annual recurrence**: Yearly recurrence on a specific date, combinable with monthly-by-weekday for patterns like "first Monday in October every year"
- **Recurring event UI**: Recurrence pattern selector in EventForm with radio buttons for daily/weekly/monthly/monthly-by-weekday/annual. Weekday picker auto-populates from event date
- **Series management**: Event detail page shows recurring event badges, "View All in Series" link, and series management actions (edit all future, delete series). Events list shows recurrence indicator badges
- **Duplicate event prevention**: Recurring event creation checks for existing events at the same time/location
- **QR check-in timezone fix**: QR check-in data now includes `organizationTimezone` for correct local time display. Fixed ISO datetime string construction that caused "N/A" in check-in window
- **Timezone standardization**: All date/time displays use `dateFormatting.ts` utilities with IANA timezone support instead of raw `toLocaleString()`
- **Events settings refactored**: `EventsSettingsTab` extracted into 6 section components (`CategoriesSection`, `EmailSection`, `FormSection`, `OutreachSection`, `PipelineSection`, `VisibilitySection`) with shared types
- **Form generation redirect**: After generating an event request form, user is redirected to the Forms page with the new form pre-selected
- **Custom categories schema fix**: `custom_event_categories` accepts objects (`{id, label, color}`) instead of plain strings
- **Settings persistence fix**: Uses `copy.deepcopy()` for JSON column mutations to prevent silent write failures
- **`??` to `||` form value fix**: All optional form fields now use `||` to coerce empty strings to `undefined`
- **Ballot email notifications**: Election detail page supports sending ballot notification emails to eligible voters with org logo header

### API Endpoints — Recurring Events

```
PATCH  /api/v1/events/{id}/update-future         # Update this and all later occurrences
DELETE /api/v1/events/{id}/series                # Delete entire series
POST   /api/v1/events/{id}/cancel-series         # Cancel the series (optionally future only)

# Corrected 2026-10-04: this block listed POST /series and PUT /series/future,
# which do not exist. The frontend reads a series through the events list.
```

### Edge Cases — Recurring Events

| Scenario                           | Behavior                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monthly-by-weekday with "5th week" | Falls back to last occurrence when month has fewer than 5 weeks                                                                                            |
| Annual events on Feb 29            | Shifts to Feb 28 in non-leap years                                                                                                                         |
| Delete single occurrence           | Does not affect other occurrences in the series                                                                                                            |
| "Edit all future"                  | Modifies the anchor occurrence and every later one (`start_datetime >= anchor`); earlier occurrences are unchanged — the boundary is the anchor, not today |
| Duplicate detection                | Checks time + location overlap before creating each occurrence                                                                                             |

---

## Recent Changes (2026-03-06)

- **Attendance Duration Finalization** — New `finalize_event_attendance()` calculates duration for checked-in members who didn't check out (the default when `require_checkout` is false). Uses `actual_end_time` with fallback to `end_datetime`. Auto-triggers when secretary records actual end time. Updates linked training records still at 0 hours
- **Events Page Search & Pagination** — Search bar filters events by title and location. Pagination added. Upcoming/Past toggle accessible to all users (past events were previously admin-only)
- **RSVP Status Badge** — Event cards now show the current user's RSVP status (Going/Maybe/Not Going) with `user_rsvp_status` on `EventListItem`
- **Action Button Reorganization** — Event detail page organizes 9+ manager buttons into primary actions (RSVP, QR Code, Edit, Check In) plus a "More" dropdown for secondary actions (Duplicate, Record Times, Finalize Attendance, Monitoring, Create Meeting, Cancel, Delete)
- **Duplicate RSVP Prevention** — `_process_event_registration` checks for existing RSVPs before creating new ones, updating to GOING status if one exists
- **Cancelled Event Badge Fix** — Badge/text colors corrected for light mode (`text-red-300` → `text-red-700 dark:text-red-300`)

### API Endpoints — Attendance Finalization

```
POST   /api/v1/events/{id}/finalize-attendance   # Calculate duration for unchecked-out members
```

---

## Recent Changes (2026-03-04)

- **Custom Event Categories** — Full-stack integration: `custom_category` column on events table, visibility settings, category filter tabs on Events page, category dropdown in Event form
- **Events Settings Redesign** — Sidebar + content panel layout (matching Organization Settings) replaces collapsible sections. Desktop sidebar navigation with section descriptions; mobile horizontal scrollable tabs
- **Outreach Types Auto-ID** — Outreach Event Types form auto-generates ID from label (removed separate ID input)
- **Email Configuration Consolidation** — Email Notifications and Email Templates merged into a single "Email Configuration" section
- **Theme Compliance** — EventRequestStatusPage and ApparatusListPage updated from hardcoded colors to theme-aware CSS variables

### API Endpoints — Custom Categories

```
GET    /api/v1/events/visible-event-types       # Returns visible types + custom categories
```

The `custom_category` field is available on all event create/update/list endpoints.

---

**See also:** [Scheduling Module](Module-Scheduling) | [Training Module](Module-Training) | [Public Programs How-To](Public-Programs)

## Reminder audience and check-in defaults (August 14, 2026)

Event and template forms persist `reminder_target` separately from the reminder
schedule: `going` targets active members who RSVP Going, `all` targets all active
members in the organization, and `none` disables delivery. Optional events
default to `going`; mandatory events default to `all` until an organizer makes
an explicit choice. Legacy null values resolve with the same mandatory/optional
fallback. Email still follows each recipient's notification preference.

Flexible self-check-in now defaults to 60 minutes before start through actual or
scheduled end. Strict opens at actual/scheduled start; Window defaults to 15
minutes on each side. An overlapping prior meeting can reduce the new event's
lead time to 15 minutes. Guest early check-in remains blocked; a known member on
a Flexible event can be admitted early with a localized informational notice.

---

## Recruitment Events and Prospect Provenance _(2026-08-20)_

### A `recruitment` event type

Open houses and recruitment nights now have an event type of their own.
Departments previously filed them under `public_education` or `other`, which
meant a membership-pipeline stage could not point at "the next recruitment
event" without also matching every fire-safety demo on the calendar.

**Choosing Recruitment on a new event switches guest sign-in on** — both
`allow_guest_check_in` and `guest_check_in_creates_prospect`. A recruitment
event whose attendees never reach the pipeline has not recruited anybody, and
that pair of switches is the difference between a sign-in sheet and a list of
prospects.

The default is applied carefully rather than bluntly:

- **Create only.** Changing an existing event's type to Recruitment does not
  flip its switches — an event that has already been running with guest
  sign-in off keeps that setting.
- **It yields to you.** Once you touch either switch yourself, the automatic
  default stops applying for the rest of that form session.
- **It reverts cleanly.** If you pick Recruitment and then change to another
  type, switches that were set _automatically_ are turned back off; switches
  you set _yourself_ are left alone.

A recruitment event whose guest sign-in is off shows a banner on the form
explaining that prospects reach the pipeline by signing in as guests, with a
button to turn it on. That banner is the backstop for the create-only rule —
the usual failure is an outreach night whose attendees are recorded as
external attendees and never become leads.

### Seeing who an event brought in

The event page shows the applicants that came from it, and the membership
pipeline board can be filtered by the event applicants came from — so "did the
October open house actually produce members?" is a question the product can
answer rather than one somebody reconstructs from dates.

### Why `recruitment` is last in the type list

It is appended **after** `other`, rather than sitting beside the other
outward-facing types where it would read better in the dropdown.

MySQL stores an `ENUM` as the member's **ordinal**, not its name. Inserting a
new value mid-list renumbers everything after it, so every event already
stored would silently change type — a row holding ordinal 6 (`ceremony`) would
come back as whatever now sits sixth. Appending leaves every existing ordinal
untouched.

This is worth knowing before anyone "tidies" the enum order.

### Edge cases

- Existing open houses filed under `public_education` or `other` are **not**
  reclassified. The new type applies going forward; re-typing past events is a
  manual choice.
- Guest sign-in defaults on for **new** recruitment events only — switching an
  existing event's type does not retroactively enable it. Watch for the banner
  instead.
- Event templates prefill the form the same way an edit does, so a template
  does not trigger the automatic switch either. Only a genuinely new event
  does.
- Past recruitment events are grouped with `other` on the Past Events tab.

## NFC Tags _(2026-08-18)_

An NFC tag is a **second way in to a check-in that already has a QR code** —
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

## Ranked Events List and Early Check-In _(2026-08-23 → 08-24)_

### The list says what it wants from you

`/events` is ranked by what each event needs from the viewing member, with a
**Needs you** band at the top. `GET /events/missed-mandatory` supplies the
mandatory events the caller did not attend.

`missed-mandatory` is **excluded from the client-side API cache**. It is a
per-member answer, and a cached copy on a shared station device would show one
member's misses to the next person who signed in.

Two corrections that came with it:

- **The page no longer accuses members who could not have attended.** A member
  who joined after an event ran, or who was not in its audience, is not counted
  as having missed it.
- Credited hours read **"up to"**, because what a member is actually credited
  depends on their recorded attendance, not on the event's nominal length.

### Early check-in is flagged, never credited

An NFC tap or a QR scan can land inside the check-in window but well before the
event starts. `event_rsvps.early_check_in_minutes` records how far ahead of the
scheduled start it was.

- **The tap time stays the honest record of when the member arrived.** The new
  column does not replace it; it saves the event's manager from comparing
  timestamps by eye.
- **An early check-in is never credited as attendance.** Attendance credit runs
  from the scheduled start.
- **Historical rows are NULL.** Backfilling would mean deciding, for every past
  RSVP, what its event's start time was at the moment somebody tapped — and an
  event whose start was edited afterwards would be given a number that was
  never true. NULL reads as "not recorded", which is what it is.

## Who's going, RSVP and the waitlist _(2026-09-01)_

Three things a member could not do before this: see who else is attending,
respond to an event that does not require a response, and find out where they
stand in a queue.

### The attendee list is shareable

An event's attendee list was reachable only with `events.manage`, so an
ordinary member saw aggregate counts and nothing else.

**What a member sees is names and going status — nothing else.** Contact
details, RSVP notes, dietary restrictions, accessibility needs, guest counts
and check-in times stay in the organizer view and are never included.

| Setting                               | Where                                    | Default        |
| ------------------------------------- | ---------------------------------------- | -------------- |
| `events.defaults.attendee_visibility` | Organization settings                    | `managers`     |
| `events.attendee_visibility`          | Per event, overrides in either direction | NULL = inherit |

NULL is a real third state, not a missing value, so **no backfill was
performed and nothing changes for an existing department until it opts in.**

### `requires_rsvp` means "a response is expected", not "responses are permitted"

It still drives the Required badge, the deadline and the non-respondent
reminder audience. What it no longer does is refuse a response outright, which
had left members with nothing to do on the majority of events.

### Waitlist standing

The detail page says **"You're #2 of 5 on the waitlist"**, ordered by the same
column the server actually promotes on. Releasing several seats now promotes
several members rather than one, and a party larger than the whole event is
refused at RSVP time instead of sitting at the head of the queue blocking
everyone behind it.

### ⚠️ Guests occupy seats

`allow_guests` had been on the model since the beginning and was **read
nowhere**, so guests were accepted on events that forbade them. Capacity
counted going _rows_, leaving guests out entirely, so a capped event could be
oversubscribed by however many guests attendees brought.

Capacity is now a sum of seats. **A capped event will fill sooner than it used
to — that is the correction, not a regression.** Events already over the seat
count are left alone rather than retroactively waitlisted; they simply admit
nobody new.

### Also fixed

- **"Apply to all future events" works on an optional series**, and goes
  through the same guarded write path as a single RSVP, so capacity, guests and
  deadlines are enforced on every occurrence rather than none.
- The RSVP modal opens with the member's existing response rather than blank —
  which had quietly discarded their notes, and, once guests consumed capacity,
  silently released the seats those guests were holding.
- **Inline RSVP from the dashboard**, matching the sign-up open shifts already
  offered there.

## The check-in QR code is withheld until its window opens _(2026-09-05)_

Outside the check-in window the event QR page rendered the **real code at 40%
opacity** so the page would be "ready" when the window opened. A phone camera
reads a code straight through that, so members scanned early, hit a check-in
that refuses them, and had nothing on the page explaining why.

The code is now withheld entirely until `can_check_in`, with a same-size
placeholder holding the space so the layout does not shift when the real code
takes over on the next 30-second refresh.

The gate is `can_check_in`, **not** the stricter `is_valid`: a Flexible/Window
event admits a scan up to an hour before its official window, and withholding
the code there would have blocked a check-in the backend was ready to accept.

Separately, the 30-second poll on both the QR page and the self-check-in page
was being answered from the shared client cache — fresh for 30s, then stale for
a further 60s — so **the window could open without the page noticing for 90
seconds.** That payload now skips the cache, which is the whole point of it.

## Two Corrections Worth Acting On _(24–25 August 2026)_

Both concern reopening a finalized event, and both leave a department holding a
belief about its own data that may be wrong. Neither is fixed retroactively.

**Reopening returned 500 for any event with a `location_id` — and reopened it
anyway.** `reopen_event_attendance` fetched the event with no eager loads while
the endpoint serializes through `_build_event_response`, whose first read is
`event.location_obj`; under the async session that lazy load is IO outside the
greenlet context, so it raised `MissingGreenlet` **after the reopen had already
committed**. The lock was genuinely cleared while the caller saw a failure.
Events with a NULL `location_id` short-circuit on the foreign key and never
reached the load, which is why it passed testing and failed in the field.

> **Action:** any event somebody attempted to reopen on 24 August 2026 may be
> open without their knowing. Check its actual state rather than trusting what
> the screen said at the time.

**Re-finalizing applied no delta to the totals behind the training record.** The
progress ledger is idempotent per `(progress, source_type, source_id)`, so a
re-finalize found its own prior entry and did nothing: the training record moved
to the corrected hours while certification and phase totals kept the original
figure. `apply_requirement_credit` now takes a `restate` flag, and the
enrollment lookups include `COMPLETED` rows — when this session's own credit is
what carried a member past 100%, an `ACTIVE`-only filter finds nothing to
correct.

> **Action:** re-check any member whose hours were corrected by reopening and
> re-finalizing before 25 August 2026.

**Related, same window:** the lock itself was a check followed by a hope. Every
attendance writer now takes `SELECT ... FOR UPDATE` on the event row and
finalize commits the close in the same transaction, so a check-in arriving
mid-finalize blocks and then finds the event closed rather than landing as
checked-in-but-uncredited behind a lock. The bulk paths (`update_future_events`,
`cancel_series`, `delete_event_series`) were reading the finalized state without
holding the rows at all.

## Recurring series keep their dates and times _(2026-09-28)_

Found driving workflow review W18 (`docs/workflow-review/W18-events-and-recurring.md`).

- **Series were stepped in UTC.** `_generate_recurrence_dates` added seven days
  to the stored UTC instant, so a weekly 7:00 PM Chicago drill (`00:00Z`)
  read 6:00 PM from 2 November. Custom weekdays, Nth-weekday patterns and skip
  dates were matched against the UTC day — the next day for any US evening
  event — while the client sends all three as the department's calendar. The
  generator now steps in wall-clock time in the department's zone and converts
  each occurrence back to UTC; `create_recurring_event` and
  `run_rolling_recurrence_extend` (resolving the zone once per organization)
  both pass it.
- **`update_future_events` collapsed the series onto one date.** It copied
  every payload field onto every later occurrence, and the edit form always
  sends `start_datetime` / `end_datetime`. Times are now applied as a change:
  each occurrence moves by the anchor's own wall-clock shift and takes its new
  length, an RSVP deadline keeps its lead ahead of each occurrence's start, and
  unchanged times leave every occurrence alone. The finalized-attendance guard
  fires only when times actually change.
- A cancelled occurrence reads "Series of N" rather than "Occurrence of N";
  the schedule controls are named ("Series end date", "Date to skip", "Start
  time" / "End time" via `DateTimeQuarterHour`'s new `timeLabel`).

> **Not repaired:** rows already stored. A series spanning a DST change is an
> hour off after it; evening series with custom weekdays, Nth-weekday patterns
> or skip dates may be a day out; a series edited with "This and all future
> events" may have later occurrences collapsed onto one date, which the rows
> cannot recover. Regenerating from the parent's pattern would move events
> members RSVP'd to — flagged (W18-3), and covered for operators in
> `docs/UPGRADING.md`.

## RSVP closes with the event; the past-event page _(2026-09-29 → 09-30)_

- **List card and dashboard timeline** offered Going / Not Going / Change RSVP
  / Leave Waitlist on events past their end or deadline, and the API answered 400. `isRsvpClosed()` in `utils/eventHelpers.ts` mirrors the two time checks
  in `EventService.create_or_update_rsvp` and gates both. An unparseable date
  counts as open, so the server makes the call.
- **Add to Calendar** is hidden once the event has ended (scheduled end passed
  or `actual_end_time` set). **View QR Code** is hidden once self check-in
  cannot succeed — window closed, cancelled, or finalized. The close is the
  new `check_in_closes_at` on the event detail response, from
  `EventService._get_check_in_window`, so a WINDOW event's after-end minutes
  are honoured rather than re-derived in the browser.
- **W19** (`docs/workflow-review/W19-rsvp.md`): RSVP Activity prints labels,
  not stored values; "1 person"; the RSVP dialog's choices are 44px on a
  phone. Flagged: waitlist promotion notifies **in-app only** (W19-1, no email
  — pitfall 18), and writes no `rsvp_history` row (W19-3).

## Attendance requests ("I was there") _(2026-09-30)_

New table `event_attendance_petitions` (migration `0ff2dfd2e9a2`, additive,
guarded; downgrade drops it), unique on `(event_id, user_id)` — one request
per member per event, a double tap included. Responses are excluded from the
client API cache.

- **Eligibility is the server's** (`GET …/attendance-petitions/mine` returns
  `can_request` and `unavailable_reason`): not draft or cancelled; the check-in
  window (`_get_check_in_window`) has closed — while self check-in still works
  the answer is "Check in instead"; within `PETITION_WINDOW_DAYS = 30` of the
  event's effective end; and not already present (`checked_in` or an
  `override_check_in_at`). Requested times cannot be in the future.
- **Approval writes the same manager override Edit Times writes** onto the
  RSVP, so crediting stays on one path — finalize credits it. Approval is
  therefore refused while attendance is finalized (`attendance_locked_error`);
  declining is not. Nobody decides their own request.
- **Notices:** the request goes to reviewers in-app and by email
  (`EmailKind.EVENT_DUTIES`); the decision goes to the member
  (`EVENT_REMINDERS`).

## Organizer, alternate and transfer _(2026-10-03)_

`events.organizer_id` / `alternate_organizer_id` (migration `90070d4a2f6f`;
the organizer is backfilled from `created_by`, so existing routing is
unchanged). `event_organizer_service.py` owns routing and handover.

- **Routing for attendance requests:** organizer + alternate; failing both
  (left, or the only one set is the requester), the position chosen per event
  type in `org.settings.events.attendance_request_fallback_positions`
  (**Event settings → Attendance → Attendance requests**, default "Secretary"),
  then the `secretary` position, then every `events.manage` holder — never
  nobody.
- **Decision rights:** organizer, alternate, or `events.manage`. The creator no
  longer decides once the event is handed over. The page gates on the server's
  `can_manage_organizers` rather than comparing ids.
- **`POST /events/{id}/transfer`**, scope `this` or `future` (upcoming
  occurrences plus the series parent; past occurrences keep their organizer).
  Open requests are re-addressed, the new and relieved members are told, and
  the change is audit-logged. The series-end reminder goes to the organizer
  pair, and rolling series copy it.
- **UI:** Organizer / Alternate pickers on Create Event (`Me (default)`), an
  **Organized by** row with **Transfer event** on the detail page, and the
  **Transfer Event** dialog (**Apply to**: this and all future events in the
  series / this event only).

## An attendance-lock refusal is a 409 with its sentence _(2026-09-29)_

Services refuse a write on finalized attendance with `attendance_locked_error()`
— a sentence behind the internal `ATTENDANCE_LOCKED::` prefix. Eleven routes
mishandled it: the marker went out raw (400, or 404 on the cohort cancels)
from the legacy `POST /training/sessions/{id}/finalize`, `PATCH
…/update-future`, `DELETE …/series`, `POST …/cancel-series`, the cohort shift /
cancel / class reschedule / class cancel routes and the event-request schedule
and postpone moves; bulk add's per-row errors carried it on a race; and `PATCH
/events/{id}`, `DELETE /events/{id}` and cancel sanitized first, where
`safe_error_detail`'s 300-character cap replaced a long refusal (an edit that
also picked a category, or any update-future save) with "An unexpected error
occurred". One mapping now serves all of them: `attendance_lock_reason()` in
`event_service.py` and `attendance_lock_http_error()` in
`app/api/attendance_lock.py`, applied to the raw error **before** sanitizing.
`POST /events/{id}/cancel` also stopped turning its own 404 into a 500.

## A finalized event can be edited — the lock refuses changes, not mentions _(2026-10-06)_

Finalizing attendance locks the fields credited hours were calculated from:
`start_datetime`, `end_datetime`, `event_type`, `custom_category` and the
check-in rules (`check_in_window_type`, `check_in_minutes_before`,
`check_in_minutes_after`, `require_checkout`). The lock used to refuse a save
that **carried** any of them, and the edit form resends everything it shows, so
no finalized event could be saved from the form, not even to fix a typo in its
title. It now refuses a **changed value** only:

- `update_event` compares each locked field with the stored value (a datetime by
  instant, an enum against its string value, a NULL check-in rule against the
  default the check-in window applies) and the refusal names only the fields that
  would change; unchanged ones are not rewritten.
- **Edit form.** On a finalized event a notice reads "Attendance for this event
  is finalized", says what is locked, why, and how to unlock it (someone who can
  reopen attendance reopens it from the event page); the type and category
  selects, the schedule and the check-in rules are disabled (guest sign-in stays
  editable), and the page leaves the locked fields out of the save.
  `ATTENDANCE_LOCKED_EVENT_FIELDS` in `frontend/src/utils/eventAttendanceLock.ts`
  mirrors the backend set, and `test_attendance_locked_fields_parity.py` fails
  when they disagree.
- **This and all future events.** Each finalized later occurrence is checked
  against its own values, since the series loop writes the edited occurrence's
  values onto every later one; a time change moves every occurrence, so it counts
  as a change. A save is refused when it would change a finalized occurrence,
  with the count of changed out of finalized ("(2 of 3 finalized occurrences
  would change)"; the cancel and delete refusals keep their wording, since every
  finalized occurrence blocks those). From an open occurrence, a description-only
  edit goes through unless a finalized later occurrence differs in type,
  category or check-in rules (the category part is new). The check runs on what
  was sent, so a series spanning the hour clocks fall back is no longer refused
  for a zero-length event when only the RSVP deadline was sent.
- `custom_fields` keeps each row's **own** lifecycle markers
  (`attendance_finalized`, `reminders_sent`, `validation_notification_sent`) on
  both save paths. A series save used to copy the edited occurrence's markers onto
  every later one — locking open occurrences through the legacy marker with no
  Reopen to offer, and stripping a finalized occurrence's own.
- A stored category is shown even when the department lists none (or the list
  failed to load); the unlisted mandatory member-type row has a 44px target.
- **Edit Times** pre-fills the **credited** check-in. A self check-in before the
  start is credited from the start, but a manager's override is taken verbatim;
  the dialog used to pre-fill the raw tap, so saving it unchanged turned a
  40-minute-early tap into an override that credited those minutes.
  `GET /events/{id}/rsvps` now returns `credited_check_in_at` for it.

## Room tags and badge check-in _(2026-10-02)_

- **Room NFC tags.** `NfcTagTarget.ROOM_CHECK_IN` writes
  `/locations/<id>/check-in`. The landing page (`RoomCheckInPage`) asks the
  existing org-scoped `GET /locations/{id}/display` what is in its check-in
  window: one event forwards to its `/events/:id/check-in`, several ask "Which
  event are you here for?", none says "Nothing to check in to" with **Check
  again**. Attendance is still the event's own self check-in. Room cards on
  **Check-In QR Codes** offer **Write NFC tag** with the room link; the kiosk
  code is never written to a tag. LOC5-32-1 (`docs/security-review/LOC5-32-locations-kiosk.md`)
  then redacted `event_description` on that endpoint to match its public
  sibling, since it had gained a caller.
- **Who writes tags** (migration `5bed4c485d2f`, additive, gated per
  `docs/rules/migrations.md`): `apparatus.manage_nfc_tags` — President, Vice
  President, Chief, Deputy Chief, Assistant Chief, Apparatus Officer;
  `locations.manage_nfc_tags` — the same leadership and the Facilities
  Manager; `members.manage_id_cards` added to the Assistant Membership
  Coordinator. Both tag grants gate only the app's writer — writing never
  reaches the server and a tag carries no secret.
- **Kiosk badge check-in.** `locations.nfc_badge_check_in_enabled` (migration
  `040ae44ad286`, server default off for every room) is switched per room with
  `PUT /locations/{id}/badge-check-in` (`locations.manage_nfc_tags`, audited,
  refused while the NFC ID Cards integration is off) — not a field on the
  general location form. `POST /api/public/v1/display/{code}/badge-tap`
  re-checks both switches on every tap; the room decides the event (exactly
  one in its window; an overlap is refused unless the member is checked in to
  exactly one, i.e. a check-out); the tap goes through
  `NfcTagService.check_in` with the station's bounce guard. The response
  carries a first name and last initial only. 60 taps a minute per IP and per
  room; every tap that moves attendance is audited (`nfc_kiosk_badge_tap`). New
  error code **LB-EVT-005** for a room without badge check-in. The accepted
  risk — a copied card works unattended — is in `docs/KNOWN_LIMITATIONS.md`.

## Check-in, templates, requests and settings fixes _(2026-09-28 → 10-04)_

- **W20** (`W20-check-in.md`): the self check-in success screen said "Training
  Record Created" on every Training event. `QRCheckInData.records_training` is
  now computed with the same test the record writer uses (pitfall 29) and gates
  the notice, now headed "Training Record". The manual check-in dialog's
  buttons are named "Check in {name}"; monitoring prints "Going".
- **W21** (`W21-templates-admin-analytics.md`): moving the start carries the end
  with it (`handleStartDateChange`); a template edit sends cleared optional
  fields as `null` (pitfall 1, update path); a template's default start is the
  next hour on the department's clock. Flagged: template **Delete** soft-deletes
  (W21-5) and analytics' "Avg Attendance Rate" pools upcoming events (W21-6).
- **W22** (`W22-event-request.md`): public form fields get `id`/`htmlFor` and a
  checkbox group a `<fieldset>`; pipeline tasks get `aria-pressed`; coordinator
  lists use `formatRank`. Flagged: the requester is never given their status
  link (W22-4).
- **W23** (`W23-locations-kiosk-guest.md`): Locations' create/edit/delete,
  wizard and station-mode controls are gated on the permissions their
  endpoints check. Flagged: a guest whose event creates prospects lands in no
  pipeline when none is `is_default` (W23-1), and no screen lists guest
  sign-ins (W23-2).
- **A single-event create with Require RSVP needs an RSVP Deadline**, as
  `EventCreate.validate_dates` already required; the form asks instead of
  rendering the 422's `{field, message}` array as a React child, which crashed
  the page (2026-09-27, `getErrorDetail()` at 43 call sites).
- **Event settings on phones** (2026-10-02): `AdminHubFrame`'s header wraps
  (shared by every administration hub), a deep-linked Settings tab scrolls into
  view, long category/outreach IDs wrap, icon-only controls use
  `touch-target-phone`, headings step h1 › h2 › h3, and a malformed response
  takes the load-error path instead of the ErrorBoundary.
- **Event detail** (2026-10-04): roster Check In / Edit Times / Remove and the
  remove confirmation use `touch-target-phone`; the notification panel's
  Send / Confirm and the check-in modal's bulk add move to `btn-info` /
  `btn-success`; every card uses the `card` utility.
- **First-time members** (2026-09-29): an unnarrowed empty list reads "No
  upcoming events yet" with a Learning Center link; the QR page explains the
  code before its window opens.
- **Copy pass** (2026-09-29, #2779): "Events settings" → "Event settings",
  "Successfully Checked In!" → "You're Checked In", check-in window option
  descriptions, "Minutes After End", "Keep Event" / "Keep Series" / "Keep It
  Running", and "Notify members who RSVP'd Going or Maybe" on the cancel
  dialog. Training guide 04 tables the old and new wording.
