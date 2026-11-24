# Events Module

The Events module manages department events: creation and recurring series,
RSVPs and waitlists, QR / NFC / kiosk check-in, guest sign-in for outreach
nights, attendance finalization and credit, "I was there" attendance
requests, templates, analytics, and the public outreach request pipeline.

---

> **Developers:** routes, API endpoints, the data model and the frontend
> architecture are on [Events Module — Developer Reference](Module-Events-Developer).

## Key Features

- **Event creation** — one-time or recurring events with location, time,
  check-in rules, reminders and attendance tracking. See
  [Creating and Editing Events](#creating-and-editing-events)
- **Recurring events** — daily, weekly, biweekly, monthly, monthly-by-weekday
  ("2nd Tuesday"), annual, annual-by-weekday and custom-weekday patterns, with
  end dates, skip dates, rolling 12-month series and series management. See
  [Recurring Events](#recurring-events)
- **Ranked events list** — `/events` is ordered by what each event needs from
  the viewer, with a **Needs You** band at the top. See
  [Events List](#events-list)
- **RSVP management** — Going / Maybe / Not Going, guests, dietary and
  accessibility notes, series RSVP, waitlist with visible standing, and admin
  overrides. See [RSVP, Attendees and the Waitlist](#rsvp-attendees-and-the-waitlist)
- **QR code check-in** — each event has a check-in QR code that members scan
  to record attendance. See [Check-In](#check-in)
- **NFC tag check-in** — the same check-in URL can be written to a reusable NFC
  tag from `/events/:id/qr-code`, and read with **Tap Tag** on the Events
  page. See [NFC Tags](#nfc-tags)
- **Room NFC tags & kiosk ID-card check-in** — a tag by a room's door checks a
  member in to whatever is open in the room; a room kiosk can accept member
  ID-card taps. See [Room Tags and Badge Check-In](#room-tags-and-badge-check-in)
- **Guest check-in** — an opt-in **second** QR code on the room display that a
  **non-member** can scan to sign themselves in, with no account. Optionally
  opens a prospective-member record for each guest who leaves an email. See
  [Guest Check-In](#guest-check-in)
- **Recruitment events** — a `recruitment` event type that switches guest
  sign-in on and shows which applicants an event produced. See
  [Recruitment Events and Prospect Provenance](#recruitment-events-and-prospect-provenance)
- **Booking prevention** — the server refuses an event that double-books a
  location
- **Event attachments** — the API stores, lists and serves attachments
  (`/events/{id}/attachments`) and the detail page lists them, but no screen
  uploads one: the create form says "Files can't be attached from the app
  yet."
- **Reminders** — configurable multi-tier reminders (e.g. 24 hours and 1 hour
  before) with a chosen audience. See
  [Reminders and Notifications](#reminders-and-notifications)
- **Organizer & alternate** — every event names an organizer and an optional
  alternate; they decide its attendance requests and can transfer it. See
  [Organizer, Alternate and Transfer](#organizer-alternate-and-transfer)
- **"I was there" attendance requests** — a member with no check-in can ask to
  be marked present for 30 days after the event. See
  [Attendance Requests ("I was there")](#attendance-requests-i-was-there)
- **Post-event validation and finalization** — organizers are prompted to
  review and finalize attendance. **Finalizing closes the event**: the roster
  is fixed, hours are credited to everyone checked in, and the linked training
  record is written. Reopening needs `events.reopen_attendance`, deliberately
  kept out of `events.manage` so the organizer who closed an event cannot
  quietly reopen it and change numbers already fed into hours and compliance.
  On a **Training** event a `training.manage` holder may also edit the event,
  close it (Finalize, End Event, Record Times) and reopen it — including one
  they closed themselves, which the department chose over a second-person
  check; the audit row records who reopened it. See
  [Training managers on Training events](#training-managers-on-training-events)
  See [Attendance Finalization and the Lock](#attendance-finalization-and-the-lock)
- **Past events** — every member can switch the Events list to past events;
  managers also get a **Past Events** tab in the Events admin hub
- **Attendee management** — add/remove attendees, bulk add, edit times and
  check members in directly from the event detail page
- **Training integration** — events can generate training sessions for
  attendance credit, and generating a **course cohort** creates one event per
  class of a multi-class course, each with its linked training session and the
  roster already RSVP'd — see
  [Module-Training](Module-Training#multi-class-courses--cohorts)
- **Admin hours integration** — event types and custom categories can be mapped
  to admin hours categories so attendance credits administrative hours
- **Custom event categories** — organization-specific categories with color
  badges, filterable on the Events page and selectable in the Event form.
  Configured in **Event settings → Categories**
- **Templates, drafts, duplication, CSV import, calendar export** — see
  [Event Templates](#event-templates) and [Events List](#events-list)

---

## Creating and Editing Events

Events are created from **Events Admin Hub → Create Event** (or a template)
and edited at `/events/:id/edit`. Both render `EventComposer`
(`components/event-form/`), which owns one `useEventFormModel` and draws the
single-page `EventForm` for every type but **Training**, and the step-by-step
`TrainingEventWizard` (`components/training-event/`) for Training _(2026-11-11)_.
Changing the type swaps the form in place and carries every value across, both
ways. Training Admin's **Create Session** renders the same composer with the
type fixed. `?template=<id>` on Create Event applies a template; a Training
template opens the wizard and, when it saved training details, fills Training
Info too _(2026-11-20)_.

- **Compact layout** — a two-column grid pairing related sections, with
  **Check-In Settings** and **Notifications** side by side.
- **Quick Duration** buttons set the end time from the start; moving the start
  carries the end with it.
- **Time pickers** (`DateTimeQuarterHour`) restrict to quarter-hour increments
  (`:00`, `:15`, `:30`, `:45`).
- **Description** is a textarea with a formatting toolbar that inserts
  Markdown around the selection.
- **Drafts** — an event can be saved as a draft and published later
  (`POST /events/{id}/publish`); drafts are hidden from members without
  `events.manage`.
- **Require RSVP** on a single event requires an **RSVP Deadline**
  (`EventCreate.validate_dates`); the form asks for it before submitting.
- **Location double-booking is refused** by the server ("Location is already
  booked during this time", naming up to three conflicting events). The
  client-supplied location must belong to the caller's organization.
- **Conflict warning** — the form separately warns (does not block) when the
  chosen time overlaps events the user has RSVP'd to.
- **Organizer / Alternate** pickers default to `Me (default)`. See
  [Organizer, Alternate and Transfer](#organizer-alternate-and-transfer).
- **Custom category** — `custom_category` is available on all event
  create/update/list endpoints; the dropdown lists the department's categories,
  and a stored category is shown even when the department lists none.
- **Template picker** — a new event can start from an active template; **Save
  as Template** on the detail page saves an event's configuration as one.
- **Timezone** — all date arithmetic and display use the department's
  timezone through `utils/dateFormatting.ts`; every time is labeled with its
  timezone abbreviation.

### Check-in lead time default

The form sets **Check-in minutes before** to 60 unless a business meeting the
user is attending ends within the hour before the new event starts. In that
case the lead is capped at the actual gap, up to a shortened 15 minutes, so
check-in can never open while the earlier meeting is still in progress (a
back-to-back meeting yields 0). Editing the field by hand stops the automatic
default.

---

## Recurring Events

### Patterns

`RecurrencePattern`: `daily`, `weekly`, `biweekly`, `monthly`,
`monthly_weekday` ("2nd Tuesday of every month", or the last weekday of the
month), `annually`, `annually_weekday` ("first Monday in October every year")
and `custom` (chosen weekdays, `recurrence_custom_days`). The pattern selector
in `EventForm` auto-populates the weekday from the event date; schedule
controls are labeled **Series end date**, **Date to skip**, **Start time** and
**End time**.

- **Skip dates** (`recurrence_exceptions`) exclude individual occurrences
  without affecting the others.
- **Rolling series** (`rolling_recurrence`) keep a 12-month horizon: a daily
  scheduled task (`rolling_recurrence_extend`) generates further occurrences
  as the horizon approaches. Each new occurrence copies the **latest**
  occurrence that is not cancelled, not the parent (`ROLLING_OCCURRENCE_FIELDS`
  in `scheduled_tasks.py`, including `mandatory_membership_types` and
  `attendee_visibility`), so a "this and all future events" edit carries
  forward. Rolling series copy the organizer pair. On a Training series the
  job also clones the latest occurrence's training session and its
  attendance-requirement links on to each new occurrence
  (`clone_sessions_for_events`); a second run adds nothing _(2026-11-11)_.
- **Duplicate detection** — creating a recurring event checks each occurrence
  for an existing event at the same time and location.

Series are stepped in **wall-clock time in the department's timezone** and each
occurrence converted back to UTC, so a weekly 7:00 PM drill stays at 7:00 PM
across daylight-saving changes, and custom weekdays, Nth-weekday patterns and
skip dates are matched against the department's calendar day.

### Series management

The detail page of a recurring occurrence shows its position in the series
("Occurrence of N"; a cancelled occurrence reads "Series of N"), a **View
All** link listing the series, and the series actions. The events list shows a
recurrence badge.

| Action                         | Endpoint                                    | Behavior                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This and all future events** | `PATCH /events/{id}/update-future`          | Updates the anchor occurrence and every later one (`start_datetime >= anchor`). Earlier occurrences are unchanged — the boundary is the anchor, not today                                                           |
| Delete series                  | `DELETE /events/{id}/series`                | Confirmation shows the count of events to be removed. Deletes every occurrence, past and future, unless `delete_future_only` is set                                                                                 |
| Cancel series                  | `POST /events/{id}/cancel-series`           | Cancels the series, or only future occurrences with `cancel_future_only`, which also ends the series at its last kept occurrence and turns rolling off (2026-11-21). The dialog's keep button reads **Keep Series** |
| RSVP to series                 | `POST /events/{id}/rsvp-series`             | "Apply to all future events" — goes through the same guarded write path as a single RSVP, so capacity, guests and deadlines are enforced on every occurrence. Works on optional series too                          |
| Transfer                       | `POST /events/{id}/transfer` scope `future` | See [Organizer, Alternate and Transfer](#organizer-alternate-and-transfer)                                                                                                                                          |

**How "This and all future events" applies times.** Times are applied as a
change, not copied: each occurrence moves by the anchor's own wall-clock shift
and takes the new length, an RSVP deadline keeps its lead ahead of each
occurrence's start, and unchanged times leave every occurrence alone. Each
occurrence keeps its own lifecycle markers in `custom_fields`. Finalized
occurrences are protected as described in
[Editing a finalized event](#editing-a-finalized-event). _(2026-11-21, #4478)_
A time change that would leave existing check-ins outside an open
occurrence's new check-in window is refused before anything is written,
naming the members and occurrences affected — the same rule a single event's
edit applies (`_count_stranded_check_ins`).

### Series end reminders

A daily scheduled task (`series_end_reminders`) emails the series' organizer
and alternate — or its creator when neither can be reached — when a
non-rolling series' `recurrence_end_date` falls within the next 6 months (180
days), so they can extend or close it. Each series is reminded once
(`custom_fields.series_end_reminder_sent`); cancelled series are skipped.

### Edge cases

| Scenario                            | Behavior                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Monthly-by-weekday with "5th" week  | Months with no 5th occurrence of the weekday are skipped; use "last" for the final one                                   |
| Annual events on Feb 29             | Fall on Feb 28 in non-leap years and return to the 29th in leap years                                                    |
| Delete single occurrence            | Does not affect other occurrences in the series                                                                          |
| Skip dates                          | Tracked per occurrence; removing a skip date restores the occurrence                                                     |
| Rolling recurrence with no end date | Generates 12 months ahead, extended daily; never recreates a date the series holds, cancelled ones included (2026-11-21) |
| Series spanning a DST change        | Occurrences keep their local wall-clock time                                                                             |

---

## Events List

`/events` is ranked by what each event needs from the viewing member, with a
**Needs You** band ("Events needing your response") at the top. The band's
overflow link narrows the grid to what needs a response.

Until an unanswered **mandatory** event enters the response window described
below _(2026-11-16)_, it renders as routine and its RSVP buttons still work.
The band, the card's "Response needed" strip and the needs-response filter
all read `getEventUrgency`, so they agree.

- **Mandatory events awaiting a response** _(2026-11-16, #4338)_ — an
  unanswered mandatory event is urgent (`action`) and in the band only once it
  starts within the department's response window (**Events settings →
  Attendance → Mandatory event responses**, 1–365 days, default 60), so a
  recurring mandatory series does not ask about every future occurrence at
  once. One whose RSVP deadline is under 48 hours away is in the band
  regardless. An unparseable start is treated as inside the window.
  `getEventUrgency` in `utils/eventHelpers.ts` is the one rule for the band and
  the cards.
- **Missed mandatory events** — `GET /events/missed-mandatory` supplies the
  mandatory events the caller did not attend, for the band's "missed" rows. A
  member who joined after an event ran, or who was not in its audience, is not
  counted as having missed it. The endpoint is **excluded from the client-side
  API cache**: it is a per-member answer, and a cached copy on a shared station
  device would show one member's misses to the next person who signed in.
- **Credited hours** read **"up to"**, because what a member is credited
  depends on their recorded attendance, not on the event's nominal length.
- **Search** filters by title, description and location; **pagination**,
  **sort** (date, title, attendance, creation date), **category/type filter
  tabs**, **My Events** (only events the viewer has RSVP'd to) and **saved
  filter presets**.
- **Upcoming / Past** toggle, available to every member.
- **Event cards** show the viewer's RSVP status (`user_rsvp_status` on
  `EventListItem`), a capacity bar (RSVPs vs. capacity), attendance count,
  recurrence badge and category badge.
- **Inline RSVP** from the card (and from the dashboard timeline), without
  opening the detail page. RSVP buttons are hidden once RSVP has closed — see
  [RSVP closes with the event](#rsvp-closes-with-the-event).
- **Calendar view** (`CalendarView`) — monthly grid with event dots, day
  highlighting, collapsible daily lists and type color badges.
- **Bulk actions** — a selection mode entered from the overflow menu (e.g. bulk
  cancel); **Duplicate** copies an event in one click
  (`POST /events/{id}/duplicate`).
- **Postpone** _(2026-11-10)_ — **More → Postpone Event**
  (`POST /events/{id}/postpone`, authorized like Edit) moves an event to a new
  start and end with a reason of 10–500 characters. RSVPs are kept; check-ins,
  corrections, guest check-ins and the hours and training credit they produced
  are cleared; reminders resend for the new time; Going/Maybe members are told
  in-app and by email when the box is ticked. The first original start is kept
  in `postponed_from_start`, and the list card shows a **Postponed** badge.
  Refused for a cancelled or finalized event, a past or unchanged start, a
  booked room, or pending attendance requests. Migration `09f0171ccf5e` adds
  three nullable columns.
- **CSV import** (`POST /events/import-csv`) — validates required fields,
  skips invalid rows with error reporting, and still imports the valid rows.
- **Calendar export** — iCal (`.ics`) export, in the user's timezone.
- **Tap Tag** reads an NFC tag while the app is in the foreground — see
  [NFC Tags](#nfc-tags).
- **Attendance requests banner** — "N attendance requests are waiting for you"
  links to `/events/attendance-requests` when there are any.
- **Empty state** — an unnarrowed empty list for a new member reads "No
  upcoming events yet" with a Learning Center link.

### Dashboard

- The **Upcoming Events** admin card counts non-cancelled events starting in
  the next 30 days (`start_datetime >= now AND < now + 30 days`); its
  description reads "Next 30 days".
- An events widget on the dashboard shows upcoming events, with inline RSVP.
- Event notices appear in the dashboard's **My Updates** feed — see
  [Reminders and Notifications](#reminders-and-notifications).

---

## RSVP, Attendees and the Waitlist

### RSVP

- **Responses:** Going / Maybe / Not Going (the set an event accepts is
  `allowed_rsvp_statuses`). The RSVP dialog opens with the member's existing
  response, notes and guest count; its choices are 44px touch targets on a
  phone.
- **Fields:** guest count (only when `allow_guests` is on), notes, dietary
  restrictions and accessibility needs.
- **`requires_rsvp` means "a response is expected", not "responses are
  permitted".** It drives the Required badge, the deadline and the
  non-respondent reminder audience; members can respond to any event.
- **RSVP deadline countdown** shows the time remaining.
- **Offline RSVP** — RSVPs made offline are queued in IndexedDB
  (`genericOfflineQueue`, kind `event-rsvp`) and sent when connectivity
  returns; the nav shows an "N pending sync" indicator.
- **RSVP Activity** — a collapsible history of RSVP changes with timestamps
  (`GET /events/{id}/rsvp-history`, managers), printing human labels.

### RSVP closes with the event

The list card and dashboard timeline hide Going / Not Going / Change RSVP /
Leave Waitlist once the event has ended or its deadline has passed.
`isRsvpClosed()` in `utils/eventHelpers.ts` mirrors the two time checks in
`EventService.create_or_update_rsvp`; an unparseable date counts as open, so
the server makes the call.

On the detail page, **Add to Calendar** is hidden once the event has ended
(scheduled end passed or `actual_end_time` set). **View QR Code** is hidden
once self check-in cannot succeed — window closed, cancelled, or finalized. The
close time is `check_in_closes_at` on the event detail response, computed by
`EventService._get_check_in_window`, so a Window event's after-end minutes are
honoured rather than re-derived in the browser.

### Capacity and guests

Capacity (`max_attendees`) is a **sum of seats** — each Going RSVP counts
itself plus its guests. Guests are accepted only on events with `allow_guests`
on. A party larger than the whole event is refused at RSVP time. Events already
over their seat count are not retroactively waitlisted; they simply admit
nobody new.

### Waitlist

- RSVPs to an event at capacity are waitlisted (`waitlisted` status).
- The detail page shows the member's standing — **"You're #2 of 5 on the
  waitlist"** — ordered by the same column the server promotes on.
- When seats open, waitlisted members are promoted in RSVP order; releasing
  several seats promotes several members. Managers can promote manually
  (`POST /events/{id}/promote-waitlist`).

### Who's going

What an ordinary member may see of the attendee list is configurable:

| Setting                               | Where                                                   | Default        |
| ------------------------------------- | ------------------------------------------------------- | -------------- |
| `events.defaults.attendee_visibility` | Organization settings (**Event settings → Attendance**) | `managers`     |
| `events.attendee_visibility`          | Per event, overrides the default in either direction    | NULL = inherit |

Values are `managers` and `members`. NULL is a real third state meaning
"inherit". With `members`, `GET /events/{id}/attendees` returns a going-only
list of **names and status — nothing else**. Contact details, RSVP notes,
dietary restrictions, accessibility needs, guest counts and check-in times stay
in the organizer view (`GET /events/{id}/rsvps` — `events.manage`, the
event's organizer pair, or `training.manage` on a Training event).

### Training managers on Training events

A `training.manage` holder without `events.manage` gets, on **Training** events
only: **Edit** (the type is locked to Training, and a "this and all future
events" edit is refused if any occurrence it reaches is another type),
**End Event**, **Finalize Attendance**, **Record Times** and **Reopen
Attendance**, as well as the attendance tools above. The More menu (duplicate,
cancel, delete, templates, meetings) and reminders stay with `events.manage`.
The page reads `can_edit_event` and `can_reopen_attendance` from
`GET /events/{id}`; `/events/:id/edit` admits `training.manage` and then asks
the event.

Training details are not theirs to change _(2026-11-11)_: an event edit from a
caller admitted only as a training manager that carries `training_details` is
refused with 403, because every session write needs `events.manage`. The edit
form shows them Training Info read-only ("Training details are changed by an
event manager.") and leaves `training_details` out of the save. Training
Admin's **Create Session** shows them a notice instead of a form.

### Manager tools on the detail page

The detail page groups manager buttons into primary actions (RSVP, QR Code,
Edit, Check In) and a **More** menu (Duplicate, Record Times, Finalize
Attendance, Monitoring, Create Meeting, Cancel, Delete). The roster supports:

- **Add attendee** (`POST /events/{id}/add-attendee`) and **bulk add**
  (`POST /events/{id}/bulk-add-attendees`). When an add overwrites an existing
  RSVP, the audit log records `event_attendee_overwritten` (severity
  `warning`); a normal add logs `event_attendee_added` (`info`).
- **Check In**, **Edit Times** (manager override,
  `PATCH /events/{id}/rsvps/{user_id}/override`) and **Remove**
  (`DELETE /events/{id}/rsvps/{user_id}`).

**The organizer runs their own event's attendance.** The roster, the
statistics card and the **Check In** window (add, bulk add, check in, Edit
Times, Remove) are also shown to the event's organizer and alternate without
`events.manage`, and to `training.manage` holders on any Training event. Two
limits apply to the organizer pair: they cannot record their own attendance
(they check in like any member, or ask the alternate or a manager — the same
"someone else vouches for you" rule as attendance requests), and on a Training
event they do not get **Edit Times**, because those minutes become training
credit. The other manager controls — Edit, Finalize, Record Times, the More
menu — stay with `events.manage`. See
[Module-Events-Developer](Module-Events-Developer) for the access table.

- **Export CSV** of the attendee list and **Print roster**. The attendee CSV
  and both event-list exports end with a **Source** column, **Imported** (the
  Historical Data Import wrote it, per the `imported_source_records` ledger)
  or **The Logbook** _(2026-11-19, #4355; `services/import_provenance.py`;
  `source` / `source_label` on `EventListItem` and the roster's
  `RSVPResponse`)_.
- **Non-respondent reminders** (`POST /events/{id}/send-reminders`) — exclude
  members who already responded (going, not going or maybe).
- **Get Directions** — a map link for events with a location.

---

## Check-In

### Check-in window types

| `check_in_window_type` | Window                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `flexible` (default)   | From `check_in_minutes_before` (default 60) before start through the actual or scheduled end   |
| `strict`               | From the actual/scheduled start through the end — a hard gate with no grace period             |
| `window`               | `check_in_minutes_before` / `check_in_minutes_after` around the event, default 15 on each side |

For Flexible and Window events a member may check in up to **one hour before
the official window**; the check-in succeeds with an informational notice
("You're a bit early. The official check-in window for this event opens at
…"). After the window closes, self check-in is refused and an organizer records
a late check-in through the manager override. Guests never get the early grace
— see [Guest Check-In](#guest-check-in).

`require_checkout` adds a check-out step. When it is off, finalization
calculates durations for members who never checked out.

### QR code and self check-in

- `/events/:id/qr-code` shows the check-in QR code. Outside the check-in
  window the **real code is withheld**, with a same-size placeholder holding
  the space and an explanation of when the code appears. The gate is
  `can_check_in`, not the stricter `is_valid`, so the code shows during the
  one-hour early grace a Flexible/Window event accepts.
- Both the QR page and the self check-in page poll
  `GET /events/{id}/qr-check-in-data` every 30 seconds with `_skipCache`, so
  the page notices the window opening promptly. The payload includes
  `organizationTimezone` for local display of the window.
- `POST /events/{id}/self-check-in` performs the member's own check-in (and
  check-out when required). The success screen reads "You're Checked In" (or
  "You're Checked Out"), and shows a **Training Record** notice only when
  `QRCheckInData.records_training` is true — computed with the same test the
  training-record writer uses.

### Early check-in

An NFC tap or QR scan can land inside the check-in window but well before the
event starts. `event_rsvps.early_check_in_minutes` records how far ahead of the
scheduled start it was.

- **The tap time stays the honest record of when the member arrived.** The
  column does not replace it; it saves the event's manager from comparing
  timestamps by eye.
- **An early check-in is never credited as attendance.** Attendance credit
  runs from the scheduled start. (A manager's override, by contrast, is taken
  verbatim — see [Edit Times](#edit-times).)

### Manager check-in and monitoring

- The check-in modal on the detail page lists all active members
  (`GET /events/{id}/eligible-members`) and checks them in
  (`POST /events/{id}/check-in`); its buttons are named "Check in {name}", and
  it offers bulk add.
- **An officer check-in after the scheduled start is stored at the scheduled
  start** _(2026-11-17, #4395)_: the officer is vouching for attendance, so a
  member is not docked the minutes it took to reach their name. It is written
  as `checked_in_at`, not `override_check_in_at`, so the row is not marked
  "(times edited)". Self check-ins (QR, ID card, the member's own button) still
  count from the tap; a genuinely late arrival is corrected with **Edit Times**,
  and the click time stays in the `event_checkin` audit entry.
- `/events/:id/monitoring` (`GET /events/{id}/check-in-monitoring`) shows live
  check-in status using the same window logic as self check-in.
- **End Event** (`POST /events/{id}/end-event`) ends an in-progress event:
  it records the actual end time as now, bulk-checks-out everyone checked in,
  and finalizes attendance durations. The confirmation's cancel button reads
  **Keep It Running**.
- **Record Times** (`POST /events/{id}/record-times`) records actual start and
  end times; recording the actual end triggers duration finalization.

---

## NFC Tags

An NFC tag is a **second way in to a check-in that already has a QR code** —
not a new flow. A station can mount one reusable sticker instead of reprinting
a sheet, and a member taps it with their phone. No camera, which is the part
that fails in a dark apparatus bay or with gloves on.

**Writing a tag.** The tag writer sits on the same page as the QR code. Open
**Set up an NFC tag**, tap **Write tag**, and hold a blank tag to the phone.

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

---

## Room Tags and Badge Check-In

### Room NFC tags

`NfcTagTarget.ROOM_CHECK_IN` writes `/locations/<id>/check-in`. The landing
page (`RoomCheckInPage`) asks the org-scoped `GET /locations/{id}/display` what
is in its check-in window:

| Events in the window | Result                                             |
| -------------------- | -------------------------------------------------- |
| One                  | Forwards to its `/events/:id/check-in`             |
| Several              | Asks "Which event are you here for?"               |
| None                 | Says "Nothing to check in to" with **Check again** |

Attendance is still the event's own self check-in. Room cards on **Check-In QR
Codes** (Locations) offer **Write NFC tag** with the room link; the kiosk
display code is never written to a tag. The endpoint redacts
`event_description`, matching its public sibling.

### Who writes tags

| Permission                  | Seeded on                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `apparatus.manage_nfc_tags` | President, Vice President, Chief, Deputy Chief, Assistant Chief, Apparatus Officer |
| `locations.manage_nfc_tags` | The same leadership and the Facilities Manager                                     |
| `members.manage_id_cards`   | Includes the Membership Coordinator and Assistant Membership Coordinator           |

Both tag grants gate only the app's writer — writing never reaches the server
and a tag carries no secret.

### Kiosk badge check-in

A room kiosk can accept member ID-card taps.

- **Switch:** `locations.nfc_badge_check_in_enabled`, off by default for every
  room, switched per room with `PUT /locations/{id}/badge-check-in`
  (`locations.manage_nfc_tags`, audited). It is refused while the NFC ID Cards
  integration is off, and it is not a field on the general location form.
- **Tap:** `POST /api/public/v1/display/{code}/badge-tap` re-checks both
  switches on every tap. The room decides the event: exactly one in its
  window; an overlap is refused unless the member is checked in to exactly one
  of them (i.e. a check-out). The tap goes through `NfcTagService.check_in`
  with the station's bounce guard.
- **Response** carries a first name and last initial only.
- **Limits:** 60 taps a minute per IP and per room. Every tap that moves
  attendance is audited (`nfc_kiosk_badge_tap`).
- **Error code** **LB-EVT-005** — the room does not have badge check-in.
- The accepted risk — a copied card works unattended — is recorded in
  `docs/KNOWN_LIMITATIONS.md`.

---

## Guest Check-In

An event can opt in to a **second, guest-specific** QR code on the room
display, so a visitor at a volunteer interest night or open house can sign in
without an account. The member QR code (`/events/{id}/check-in`) is behind
authentication, so the two stay separate rather than one code serving both:
the member flow is untouched, including **check-out**, which is meaningless for
a walk-in.

### Turning it on

Both switches are in **Check-In Settings** on the event form, and both default
to off (except on new recruitment events — see
[Recruitment Events](#recruitment-events-and-prospect-provenance)).

| Setting (form label)                           | Field                             | Effect                                                                        |
| ---------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| Allow guest (non-member) sign-in               | `allow_guest_check_in`            | Shows the guest QR code on the room display and opens the public sign-in page |
| Add guests to the prospective members pipeline | `guest_check_in_creates_prospect` | Signs guests in by email instead, and only active applicants (see below)      |

> **Off by default is deliberate.** Turning the first one on exposes an
> **unauthenticated write path**. It belongs on outreach events and should stay
> off for business meetings and training sessions, whose attendance drives
> records that only apply to members.

Guest sign-in stays editable on a finalized event.

### What the guest sees

`/display/:code/events/:eventId/guest` — a public sign-in page, outside the app
shell. At an event **without** the pipeline switch it is a form that asks for first and last name (required) and, optionally, email, phone,
the organization they are with, and why they came. Nothing more: a walk-in should
be asked for the minimum needed to follow up, not for a membership application.
The real application form is what the follow-up email links to.

At an event **with** the pipeline switch the page is email-first
_(2026-10-25)_. The guest enters an email; an **active** applicant is shown their
first name and last initial ("Is this you, Jane S.?") and confirms; anyone else
— a member account, a withdrawn, rejected or on-hold applicant, or an unknown
address — is asked to see a member of staff. _(2026-11-08)_ A member account
used to be told to scan the member QR code, which let anyone holding the public
link test which addresses belong to members; the audit row still records the
true outcome. **The kiosk opens no new applicants at these events**, and the typed
`guest-check-in` endpoint refuses them with `LB-EVT-006`, so hiding the form is
not the only thing stopping it. The confirm call carries a ten-minute signed
token bound to the applicant, event, room and department; the browser never
names the applicant.

The page is addressed through the **room's display code** so the backend can
resolve the department without a session, and it uses bare `fetch` rather than
the shared axios instance — that instance's 401 interceptor would redirect the
very visitors the page exists for. The backing endpoints are
`GET /api/public/v1/display/{code}/events/{event_id}/guest`,
`POST …/guest-check-in` (typed form), and `POST …/guest-lookup` with
`POST …/guest-confirm` (email-first) — see
`docs/PUBLIC_API_DOCUMENTATION.md` §8.

### What gets written

| Record                     | When                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `event_external_attendees` | Always. `source = 'kiosk_qr'`, distinguishing a self-recorded sign-in from one a staff member typed in                        |
| `prospective_members`      | Not by the kiosk: an email-first sign-in finds an existing active applicant. Opened when **staff** check in a walk-in (below) |
| `prospect_event_links`     | Links the confirmed applicant to the event                                                                                    |

`event_external_attendees.prospect_id` ties the two together with
`ON DELETE SET NULL`, so purging a prospect never destroys the record of who was
in the room — that is the event's history, not the prospect's.

Guests who signed in are listed on the event detail page in a **Guests** card
(managers only — `GET /events/{id}/external-attendees` returns contact
details). They are not counted in member attendance.

**Staff entry** _(2026-10-25)_. The card's **Add guest** posts
`POST /events/{id}/external-attendees` and then
`PATCH …/external-attendees/{attendee_id}/check-in`; a row entered earlier gets
a **Sign in** button for the second call alone. The check-in links an existing
active applicant with that email, as it always has. At an event with
`guest_check_in_creates_prospect`, it now also **opens** an application for a
walk-in who is not one — the visitor the email-first kiosk sent to staff —
following the kiosk's lookup: a member account is left alone, and nothing is
opened without an email or without a first and last name (split on the last
space of `name`). The new prospect carries `metadata.source = 'staff_entry'`,
its event link the note "Checked in at {title} by staff", and a phone longer than
the applicant record's 20 characters is left off rather than cut. The check-in
response's `prospect_id` names the applicant linked or opened. The attendance
is committed first; a pipeline failure is logged and rolled back without
costing the guest their sign-in, and checking the same guest in again opens
nothing new.

### How it is protected

- The department is resolved from the **display code**, never from the request,
  and the event must actually be held in that room.
- **Per-IP rate limiting** and a **per-event daily ceiling**
  (`GUEST_CHECK_IN_DAILY_LIMIT`, default 300; `0` disables it). Per-IP limiting
  alone cannot stop a distributed flood, and each sign-in writes attendance — a
  more expensive side effect than a page view.
- The email lookup has its own **per-IP limit** and **per-event daily ceiling**,
  works only while the check-in window is open, and is **audited** on every
  call (outcome and applicant id, never the email), because it is the endpoint
  someone holding a room's link would script to learn who is applying.
- A **honeypot field** that a real browser leaves empty. A populated honeypot is
  answered with a plausible success and nothing is written, so a bot gets no
  signal to adapt to.

### Edge cases

| Situation                                                | Behavior                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest arrives before the check-in window opens           | Refused. Guests get the organizer's window **minus the early-arrival grace** members get — a member checking in early is identifiable and correctable, an anonymous early write is neither                                                                                                             |
| Guest taps the QR code twice                             | Matched on email where one was given, on name where it was not; returns `already_checked_in` rather than a second row                                                                                                                                                                                  |
| Two guests with the same name and no email               | They collapse into one row. The weaker fallback is deliberate — a duplicate on every double-tap is the far more common problem at a kiosk                                                                                                                                                              |
| Staff pre-registered the guest                           | The sign-in fills blanks only; anything staff deliberately typed is kept                                                                                                                                                                                                                               |
| Applicant confirms twice                                 | The second confirm answers `already_checked_in` ("You're already checked in, Jane S.") and changes nothing                                                                                                                                                                                             |
| Applicant withdrawn between "Continue" and "Yes"         | The confirm is refused; the applicant is re-read, not trusted from the lookup                                                                                                                                                                                                                          |
| The link to the applicant cannot be written              | Logged and swallowed. The attendance is still recorded and the guest still sees a confirmation — the sign-in is the thing they came to do                                                                                                                                                              |
| The prospect is later purged                             | The attendance row survives with `prospect_id` set to NULL                                                                                                                                                                                                                                             |
| The applicant's pipeline has an "attend a meeting" stage | The sign-in counts for a meeting stage the applicant is on **at that event**, but not for a later stage — that needs a second meeting. A check-in advances nobody by itself: the stage moves when the event's attendance is **finalized**, or 7 days after it ends (`PIPELINE_ATTENDANCE_SETTLE_DAYS`) |

---

## Recruitment Events and Prospect Provenance

### The `recruitment` event type

Open houses and recruitment nights have an event type of their own, so a
membership-pipeline stage can point at "the next recruitment event" without
also matching every fire-safety demo on the calendar.

**Choosing Recruitment on a new event switches guest sign-in on** — both
`allow_guest_check_in` and `guest_check_in_creates_prospect`. A recruitment
event whose attendees never reach the pipeline has not recruited anybody, and
that pair of switches is the difference between a sign-in sheet and a list of
prospects.

The default is applied carefully rather than bluntly:

- **Create only.** Changing an existing event's type to Recruitment does not
  flip its switches — an event that has been running with guest sign-in off
  keeps that setting. Templates prefill the form the way an edit does, so a
  template does not trigger the automatic switch either.
- **It yields to you.** Once you touch either switch yourself, the automatic
  default stops applying for the rest of that form session.
- **It reverts cleanly.** If you pick Recruitment and then change to another
  type, switches that were set _automatically_ are turned back off; switches
  you set _yourself_ are left alone.

A recruitment event whose guest sign-in is off shows a banner on the form
explaining that applicants record their attendance by signing in as guests, with a
button to turn it on. That banner is the backstop for the create-only rule —
the usual failure is an outreach night whose attendees are recorded as
external attendees and never become leads.

Events filed under `public_education` or `other` are not reclassified
automatically; re-typing them is a manual choice. Past recruitment events are
grouped with `other` on the Past Events tab.

### Seeing who an event brought in

The event page shows the applicants that came from it (**Prospects** card), and
the membership pipeline board can be filtered by the event applicants came
from — so "did the October open house actually produce members?" is a
question the product can answer.

### Why `recruitment` is last in the type list

It sits **after** `other`, rather than beside the other outward-facing types
where it would read better in the dropdown. MySQL stores an `ENUM` as the
member's **ordinal**, not its name. Inserting a value mid-list renumbers
everything after it, so every stored event would silently change type — a row
holding ordinal 6 (`ceremony`) would come back as whatever sits sixth.
Appending leaves every existing ordinal untouched. Do not "tidy" the enum
order.

---

## Attendance Finalization and the Lock

### Finalizing

`POST /events/{id}/finalize-attendance` (`finalize_event_attendance()`)
closes the event's attendance:

- calculates duration for checked-in members who did not check out (the normal
  case when `require_checkout` is off), using `actual_end_time` with fallback
  to `end_datetime`;
- credits hours to everyone checked in, including approved attendance
  requests and manager overrides;
- writes or updates the linked training record and credits training progress;
- credits admin hours through the event's hour mappings;
- stamps `attendance_finalized_at` / `attendance_finalized_by`.

Recording the actual end time (Record Times, End Event) triggers duration
finalization automatically.

**Reopening** (`POST /events/{id}/reopen-attendance`) requires
`events.reopen_attendance`, or `training.manage` on a Training event.
Re-finalizing after a correction restates the
credit: `apply_requirement_credit` takes a `restate` flag, and the enrollment
lookups include `COMPLETED` enrollments, so certification and phase totals move
with the corrected hours.

**Concurrency.** Every attendance writer takes `SELECT ... FOR UPDATE` on the
event row, and finalize commits the close in the same transaction, so a
check-in arriving mid-finalize blocks and then finds the event closed. The bulk
series paths (`update_future_events`, `cancel_series`, `delete_event_series`)
hold the rows they check.

### Refusals are a 409 with a sentence

Services refuse a write on finalized attendance with
`attendance_locked_error()` — a sentence behind the internal
`ATTENDANCE_LOCKED::` prefix. One mapping turns it into an HTTP 409 carrying the
sentence on every route that can hit it: `attendance_lock_reason()` in
`event_service.py` and `attendance_lock_http_error()` in
`app/api/attendance_lock.py`, applied to the raw error **before**
`safe_error_detail` sanitizing (whose 300-character cap would otherwise replace
a long refusal). Routes covered include event update, delete, cancel,
update-future, delete series, cancel series, bulk add, the legacy
`POST /training/sessions/{id}/finalize`, the cohort shift/cancel/reschedule
routes and the event-request schedule and postpone moves.

### Editing a finalized event

Finalizing locks the fields credited hours were calculated from:
`start_datetime`, `end_datetime`, `event_type`, `custom_category` and the
check-in rules (`check_in_window_type`, `check_in_minutes_before`,
`check_in_minutes_after`, `require_checkout`). The lock refuses a **changed
value**, not a save that merely carries one, so a finalized event can still be
saved to fix its title or description.

- `update_event` compares each locked field with the stored value (a datetime by
  instant, an enum against its string value, a NULL check-in rule against the
  default the check-in window applies). The refusal names only the fields that
  would change; unchanged ones are not rewritten.
- **Edit form.** On a finalized event a notice reads "Attendance for this event
  is finalized", says what is locked, why, and how to unlock it (someone who can
  reopen attendance reopens it from the event page). The type and category
  selects, the schedule and the check-in rules are disabled (guest sign-in
  stays editable), and the page leaves the locked fields out of the save.
  `ATTENDANCE_LOCKED_EVENT_FIELDS` in `frontend/src/utils/eventAttendanceLock.ts`
  mirrors the backend set, and `backend/tests/test_attendance_locked_fields_parity.py`
  fails when they disagree.
- **This and all future events.** Each finalized later occurrence is checked
  against its own values, since the series loop writes the edited occurrence's
  values onto every later one; a time change moves every occurrence, so it
  counts as a change. A save that would change a finalized occurrence is
  refused with the count ("(2 of 3 finalized occurrences would change)"); the
  cancel and delete refusals do not count, since every finalized occurrence
  blocks those. From an open occurrence, a description-only edit goes through
  unless a finalized later occurrence differs in type, category or check-in
  rules. The check runs on what was sent.
- `custom_fields` keeps each row's **own** lifecycle markers
  (`attendance_finalized`, `reminders_sent`, `validation_notification_sent`,
  `series_end_reminder_sent`) on both save paths, and copies (duplicate,
  series generation) strip them.

### Edit Times

**Edit Times** (`PATCH /events/{id}/rsvps/{user_id}/override`) writes a manager
override (`override_check_in_at`, `override_check_out_at`,
`override_duration_minutes`). The dialog pre-fills the **credited** check-in
(`credited_check_in_at` on `GET /events/{id}/rsvps`): a self check-in before the
start is credited from the start, but a manager's override is taken verbatim,
so pre-filling the raw tap would turn an early tap into credited minutes.

---

## Attendance Requests ("I was there")

A member with no check-in can ask to be marked present after the event. Stored
in `event_attendance_petitions`, unique on `(event_id, user_id)` — one request
per member per event, a double tap included. Responses are excluded from the
client API cache (`/attendance-petitions` in `UNCACHEABLE_PREFIXES`).

- **Eligibility is the server's** (`GET /events/{id}/attendance-petitions/mine`
  returns `can_request` and `unavailable_reason`):
  - the event is not a draft and not cancelled;
  - the check-in window (`_get_check_in_window`) has closed — while self
    check-in still works the answer is "Check in instead";
  - it is within `PETITION_WINDOW_DAYS = 30` of the event's effective end;
  - the member is not already present (`checked_in` or an
    `override_check_in_at`).

  Requested times cannot be in the future.

- **Approval writes the same manager override Edit Times writes** onto the
  RSVP, so crediting stays on one path — finalize credits it. Approval is
  therefore refused while attendance is finalized
  (`attendance_locked_error`); declining is not. Nobody decides their own
  request.
- **Who decides:** the organizer, the alternate, or an `events.manage` holder —
  see [Organizer, Alternate and Transfer](#organizer-alternate-and-transfer)
  for routing.
- **Notices:** the request goes to reviewers in-app and by email
  (`EmailKind.EVENT_DUTIES`); the decision goes to the member
  (`EVENT_REMINDERS`).
- **Withdrawing:** `DELETE /events/{id}/attendance-petitions/mine` removes the
  member's own request while it is pending — **Withdraw request** on the
  waiting notice, behind a confirmation. The reviewers' prompts are archived
  and the audit log keeps the record. A decided request cannot be withdrawn.
- **Withdrawal limit:** at most `MAX_PETITION_WITHDRAWALS = 2` per member per
  event, so a request cannot be cycled to re-notify the organizer; the third
  request is final and **Withdraw request** is not offered (`can_withdraw` on
  `GET …/mine`; the API answers 400). A withdrawn request is kept with status
  `withdrawn` and a `withdrawal_count`, and asking again reuses that row.
  Reviewers never see withdrawn rows.
- **Resend count for reviewers:** petition responses carry `withdrawal_count`,
  and the event card and the Attendance Requests page show "Withdrawn and sent
  again once / twice" on a resent request, so an organizer notified more than
  once can see why.
- **Finalized-event hint:** when the event's attendance is already finalized as
  the request arrives, the reviewers' in-app prompt and email say approving
  needs attendance reopened first, and that declining works either way, instead
  of the plain "Review the request" line.
- **Across events:** `/events/attendance-requests` lists every pending request
  routed to the viewer — on events they organize or are alternate for, and any
  a fallback step sent them — oldest first, with
  **Approve** / **Decline** in place (the same dialogs as the event card,
  `AttendancePetitionDecisionDialogs.tsx`). `events.manage` holders get **All
  events**. The Events page shows "N attendance requests are waiting for you"
  when there are any. Backed by
  `GET /events/attendance-petitions/pending?scope=mine|all`; the viewer's own
  requests are never listed.

Statuses: `pending`, `approved`, `rejected`, `withdrawn`.

---

## Organizer, Alternate and Transfer

`events.organizer_id` and `events.alternate_organizer_id` name who is
responsible for an event (the organizer defaults to the creator).
`event_organizer_service.py` owns routing and handover.

- **Routing for attendance requests:** organizer + alternate; failing both
  (left, or the only one set is the requester), the position chosen per event
  type in `org.settings.events.attendance_request_fallback_positions`
  (**Event settings → Attendance → Attendance requests**, default
  "Secretary"; options from `GET /events/settings/position-options`), then the
  `secretary` position, then every `events.manage` holder — never nobody.
- **Decision rights:** organizer, alternate, `events.manage`, or whoever the
  request is currently routed to — a fallback position holder without
  `events.manage` may decide the request they were sent
  (`EventOrganizerService.may_decide_attendance_request`, which reuses the
  routing above). The creator does not decide once the event is handed over.
  The page shows the requests card on the server's
  `can_review_attendance_requests` rather than comparing ids.
- **Attendance:** the organizer pair also run their own event's attendance —
  see [Manager tools on the detail page](#manager-tools-on-the-detail-page).
- **`POST /events/{id}/transfer`**, scope `this` or `future` (upcoming
  occurrences plus the series parent; past occurrences keep their organizer).
  Open requests are re-addressed, the new and relieved members are told, and
  the change is audit-logged. The series-end reminder and the post-event
  "validate attendance" prompt (`post_event_validation`) go to the organizer
  pair, or to the creator when neither can be reached.
- **UI:** Organizer / Alternate pickers on Create Event (`Me (default)`), an
  **Organized by** row with **Transfer event** on the detail page, and the
  **Transfer Event** dialog (**Apply to**: this and all future events in the
  series / this event only).

---

## Reminders and Notifications

### Reminders

Event and template forms persist the reminder schedule (`reminder_schedule`,
multi-tier, e.g. 24 hours and 1 hour before) and the audience
(`reminder_target`) separately:

| `reminder_target` | Audience                               |
| ----------------- | -------------------------------------- |
| `going`           | Active members who RSVP'd Going        |
| `all`             | All active members in the organization |
| `none`            | No reminders                           |

Optional events default to `going`; mandatory events default to `all` until an
organizer makes an explicit choice. Email follows each recipient's
notification preference.

### Event notification panel

`EventNotificationPanel` on the detail page sends targeted notifications
(`POST /events/{id}/notify`), delivered in-app (the notification bell) and by
email.

| Notification types                                                               | Audiences                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `announcement`, `reminder`, `follow_up`, `missed_event`, `check_in_confirmation` | `all`, `going` (RSVP'd yes), `not_responded`, `checked_in`, `not_checked_in` (RSVP'd but absent) |

Which member email switch governs the email (`NOTIFICATION_EMAIL_KINDS` in
`event_service.py`): an `announcement` is a department message and is always
sent; `reminder`, `missed_event` and `check_in_confirmation` follow **Event
reminders**; `follow_up` follows **Event changes and cancellations**. All the
recipients' emails go out in one send.

Cancelling an event offers "Notify members who RSVP'd Going or Maybe". With it
ticked, those members get a bell entry linking to the event and the **Event
Cancelled** email template (`event_cancellation`). Changing an event's title,
start or end time, or location tells members who answered Going or Maybe in
the bell and by an "Event Updated" email showing the new time and place. Both
emails follow the member's **Event changes and cancellations** switch
(`event_changes`, on by default), which a department can make required. A
failed email never undoes the cancellation or the edit.

### Dashboard feed

Event notices appear in the dashboard's **My Updates** feed — one list of
unread notifications and department messages. Opening a row marks it read, and
**Older Items** opens the full inbox. Only holders of `notifications.manage` or
`settings.manage` can clear a persistent department message
(`department_messages.is_persistent`), and clearing it removes it for everyone.
The Notifications page filters by channel (email, in-app, SMS).

### Email delivery

Event emails carry Message-ID headers, inline CSS, batch rate limiting and SMTP
connection reuse; hosted image URLs replace base64 logos so Gmail does not clip
large messages.

---

## Training and Admin Hours Integration

- **Training sessions** — a Training event carries a linked training session;
  finalizing attendance writes the training records. Since 2026-11-11 the
  training-event form sends the session as `training_details` on `POST /events`
  and `/events/recurring` (`TrainingSessionAttach`, course optional) and on
  `PATCH /events/{id}` and `/update-future` (`TrainingSessionDetailsUpdate`,
  three-state: left out is untouched, `null` clears), so every Training event it
  creates has a session. The event page's `TrainingSessionLinkageCard` is a
  read-only summary with **Edit training details** (`events.manage`) linking to
  `/events/:id/edit?step=training`. A duplicate copies the session and its
  links, not its finalized state. Course cohorts generate events in the other
  direction — see [Module-Training](Module-Training#multi-class-courses--cohorts).
  _(2026-11-21, #4478)_ Hours that follow the event's length (no course, no
  typed hours) are re-set whenever the event's time moves — `update_event`,
  `update_future_events` and `postpone_event` call
  `TrainingSessionService.follow_event_length` unless the same save sets the
  hours. A session awaiting sign-off approval is not counted as held by the
  attendance graders until the approval is decided (`load_held_sessions`). A
  linked requirement no longer active counts the session against no one; the
  card says so and the waiver card shows the `not_counted` / `exempt` refusal
  rather than nothing (#4366).
- **Admin hours** — `event_hour_mappings` map an event type or custom category
  to an admin hours category with a percentage split (e.g. 70% Training, 30%
  Professional Development). Configured in **Event settings → Hour Tracking**.
  Attendance on an event with no mapping is not credited to admin hours.

---

## Event Templates

`/events/templates` (`EventTemplatesPage`) lists templates with a create/edit
modal (`EventTemplateForm`), active toggle and delete confirmation.

- A template's default start is the next hour on the department's clock;
  moving the start carries the end with it.
- A template edit sends cleared optional fields as `null`, so a cleared field
  is actually cleared.
- **Delete** deactivates the template (`is_active = false`) rather than
  removing the row. The template picker shows only active templates.
- Templates carry the event defaults: type, title, description, location,
  duration, RSVP, capacity, guests, attendee visibility, check-in rules
  (including **Minutes After End**), reminders and custom fields.
- **A Training template also carries the session's training details**
  _(owner decision 2026-11-20)_ in `event_templates.training_details`: the
  course (library, one-off name and code, or none), training type, credit
  hours and their source, lead instructor, and certification settings, and
  since 2026-11-23 the category, program and phase, requirement link, Counts
  toward attendance and the completion settings. The editor's **Training Details** section (TrainingInfoStep's
  `template` variant) edits them; **Save as Template** on a Training event
  saves its session's. Applying one checks the course and instructor against
  the Course Library and member list (`reconcileTemplateTraining`): a course
  no longer listed falls back to No course yet, an instructor no longer a
  member is cleared, and a category, program, phase or requirement no longer
  active is dropped (`reconcileTemplateLinks`, against
  `useTrainingLinkageData`'s lists), each with a note on Training Info.

---

## Apparatus Events

Outreach that puts an apparatus on the road with a named crew — a Santamobile
run, a parade, a touch-a-truck — but is **not a shift**. Under **Events
Administration → Community Outreach → Apparatus Events**
(`ApparatusEventsTab`, `apparatus_events.manage`).

- **Templates** name the apparatus, free-text seats (Driver, Navigator, Santa,
  Elf × 4), the Driver seat's **EVOC rule** (Enforce / Warn only / Don't
  check), whether members may self sign-up, and the **Admin Hours category**
  the crew's time goes to. **Duplicate** copies a template with per-seat
  counts, for a smaller or larger version.
- **Schedule nights** turns a template into one or many ordinary events, each
  with its own crew (`event_apparatus_plans` / `_units` / `_seats`). A night
  whose apparatus is on another apparatus night, or out of service, is
  flagged; the coordinator can schedule over it.
- **Crew card** on the event page: members take or leave an open seat
  (`apparatus_events.signup`), which also sets their RSVP; coordinators
  assign, clear, **Edit this night** (this night only) and **Remove crew**
  (while no seat is filled). The Driver seat uses the same EVOC rule and
  driver exceptions as shift driver assignment.
- **Hours**: check in as usual, then **Finalize Attendance**. A night's
  category **replaces** the event type's Admin Hours mapping — never both.
- **Coordinator approves self sign-ups** (per template, copied to each night,
  changeable in Edit this night): **Sign me up** becomes **Ask for this seat**
  and records an `apparatus_event_seat_requests` row while the seat stays
  open. Several members may ask for one seat; **Approve** seats one and
  declines the rest (`POST …/events/{id}/requests/{rid}/approve`, `/decline`
  with an optional note, `/withdraw` by the member). The organizer and
  alternate holding `apparatus_events.manage` are emailed each request
  (Event officer duties). The member is emailed the answer (Event changes).
  `apparatus_seat_request_lapse` (every 15 minutes) declines anything still
  waiting once a night starts or is cancelled.
- **Email members** on the crew card emails chosen members about the run's
  open seats: one email listing every upcoming night a member can still take
  a seat on (`POST /apparatus-events/events/{id}/seat-call`). Each send is
  recorded in `apparatus_event_seat_calls` and the card shows the last one.
- **Shift Scheduling** shows nights as read-only `Outreach · not a shift`
  chips; they never count toward shift staffing.
- **Public requests**: a scheduled request's page has **Apparatus Crew →
  Add apparatus crew**, below Volunteer Staffing (`POST /event-requests/{id}/apparatus-crew`, needs
  `events.manage` and `apparatus_events.manage`). The crew goes on the
  request's own calendar event, so a new date moves it and a cancellation
  stands it down. Volunteer signups stay available alongside it.

API under `/api/v1/apparatus-events/` (uncacheable — crew boards name
members).

**Choosing who an email goes to** (`member_audience`, shared by the open-seat
email and the request volunteer call): member classes, membership statuses
(with the department's own tiers) and positions. Any match within a group,
every group across them, an empty group does not narrow. Only current members
(`ACTIVE_ACCOUNT_STATUSES`) with an address, and the **Volunteer calls**
opt-out applies. `GET /member-audience/options` and `POST
/member-audience/preview` (a count) need `events.manage` or
`apparatus_events.manage`. Choices the first release made without a ruling are in
`docs/KNOWN_LIMITATIONS.md` → "Apparatus Events".

---

## Analytics

- **`/events/analytics`** (`EventAnalyticsPage`, `analytics.view`) — summary
  cards (total events, RSVPs, check-ins, attendance rate, average check-in
  time), event type distribution chart, monthly trends chart and a top events
  table, with date range filtering (`GET /events/analytics/summary`).
- **`/events/:id/analytics`** — per-event analytics dashboard.
- **QR Code Analytics** and **Outreach Impact** (formerly Community Engagement) tabs in the Events admin
  hub. Outreach Impact (`GET /dashboard/community-engagement?period=`,
  `events.manage`) reports events held, people reached — a guest headcount
  recorded on the event, else guest sign-ins, else the request's audience
  size, reported separately — member hours, requests completed in the period
  (dated by the request's activity log) and received in it, a monthly
  breakdown, a by-type breakdown in two groups (public request types and
  department event types) and recent events, against the same span of the
  previous period. `GET /dashboard/community-engagement/events?period=` returns
  every event in the period, for the export and for the printable summary at
  `/events/admin/community/print?period=` (`events.manage`), which the tab's
  **Print summary** opens. An outreach event's **Guest
  headcount** card (`PUT /events/{id}/guest-headcount`, `events.manage`) sets or
  clears `events.guest_headcount`. The daily `guest_headcount_reminders` task
  emails and notifies, once, the organizer and alternate (else the creator) who
  hold `events.manage` of an outreach event that ended before today, within the
  last 14 days, with no headcount. The email is the switchable **Guest Headcount
  Reminder** template, under the member's **Event officer duties** preference;
  the event's `custom_fields.guest_headcount_reminder_sent` records that it was
  sent, and postponing clears it. _(2026-11-21)_ Beside it, a **How it went**
  card (`PUT /events/{id}/outreach-closeout`, same rule) records the outcome
  and follow-ups, the apparatus that attended, the materials handed out and
  whether photos were taken with the host's consent. The tab totals
  **Materials handed out** for the period, and the CSV export gains
  **Materials handed out**, **Photos** and **Outcome** columns; the printed
  summary does not show them. _(2026-11-23)_ **Requester feedback**:
  `request_pipeline.feedback_form_id` names a published form from Forms, and
  `feedback_rating_field_id` the question averaged as the rating
  (`GET /events/settings/feedback-forms`, `POST .../starter`, `events.manage`).
  Once a request is Completed, `GET`/`POST /event-requests/status/{token}/feedback`
  serve that form and take one response per request (the status token is the
  credential; the Forms module's branching rules are enforced on submit; 409
  once sent), stored in `event_request_feedback` with the rating copied in.
  Officers read it at `GET /event-requests/{id}/feedback`, and the report adds
  `feedback_responses`, `average_rating` and `rating_scale_max`. _(2026-11-24)_
  Each response notifies the request's coordinator, else the default
  coordinator, else every current member holding `events.manage` (each must
  hold it): a bell (`outreach_feedback`) written in the submit's transaction,
  and after the commit the **Requester Feedback Received** email
  (`outreach_feedback_received`, "Event officer duties"), subject prefixed
  "Low rating: " at 3 or less out of 5. A failed email never fails the submit.

---

## Public Outreach Request Pipeline

Community members submit event requests (fire safety demos, station tours,
school visits, CPR classes, etc.) through a public form. Department
coordinators manage requests through a configurable workflow on the **Requests**
tab of the Events admin hub.

> **Public intake is opt-in.** Turn it on under **Event settings → Public Requests →
> Overview → Accept Public Requests**; it is **off by default**. While it is off the
> public endpoint answers as though the department does not exist —
> deliberately indistinguishable, so the endpoint cannot be used to enumerate
> which departments accept requests — and staff can still create requests
> internally. When it is on, a submission must clear a human challenge
> (CAPTCHA) and a hidden honeypot field, and each department has a daily
> ceiling (`public_daily_limit`, default 50) that counts **valid** submissions
> only, so junk traffic cannot exhaust the allowance and lock out real
> requesters.

### Pipeline features

- **Requests taken by phone** _(2026-11-21)_ — **New request** on the
  Requests tab files a request a coordinator took by phone, email or in person
  (`POST /event-requests`, `events.manage`). It records **How it came in**,
  needs a phone or an email (not both), works while public intake is off, has
  no CAPTCHA or daily limit, and flags a date inside the minimum lead time
  rather than refusing it. The coordinator can decline the acknowledgement;
  a request with no email never emails the requester.
- **Public submission form** — a Forms-module form (`/f/:slug`) feeds the
  pipeline; no authentication required. **Generate form** in settings creates
  it and redirects to the Forms page with the new form selected; request forms
  show publish status badges in Event settings.
- **Configurable outreach types** — each department defines its own outreach
  categories (e.g. `fire_safety_demo`, `station_tour`, `school_visit`); the ID
  is generated from the label. _(2026-11-21)_ Each type can keep a **role
  preset** (**Set roles** under Types & roles): the volunteers it usually
  needs, which a new signup sheet starts from. Only configured roles, at most
  50 seats.
- **A page per request** _(2026-11-21)_ — a request opens at
  `/events/admin/requests/:requestId` rather than a side panel, so it can be
  linked, bookmarked, refreshed and left with the back button. On a phone the
  next action stays in a bar at the bottom.
- **Default coordinator assignment** — new requests auto-assign to a configured
  coordinator, who receives an email. Since 2026-11-19 (#4380, #4432) the
  default-coordinator and per-request coordinator pickers list current members
  only (active or probationary), and `PATCH /events/settings` and
  `PATCH /event-requests/{id}/assign` refuse a newly chosen former member with
  a 400 "Only current members can be chosen as … coordinator". A coordinator
  already saved who has since left is kept (shown "(former member)").
- **Flexible date preferences** — exact dates, a general timeframe, or full
  flexibility. Since 2026-11-21 the dates are stored as calendar dates, so the
  day picked is the day shown on every screen, whatever the viewer's time
  zone; the status page shows the scheduled date in the department's zone.
- **Configurable pipeline tasks** — custom, reorderable checklist steps (e.g.
  "Chief Approval", "Volunteer Signup Email", "Equipment Prep").
- **Scheduling with room booking** — coordinators set a confirmed date, create
  a calendar event and book a room, with double-booking prevention.
- **Volunteer staffing** — for a scheduled request, open a volunteer signup
  sheet (an open-to-all shift on the confirmed date, filled through the
  ordinary Open Shifts flow, which lists outreach sheets 60 days ahead rather
  than 30) and email the membership asking who can help
  (email only — not an SMS alert), narrowed by member class, membership
  status and positions. Bringing an apparatus? **Add apparatus
  crew** puts a template's crew on the request's calendar event — see
  [Apparatus Events](#apparatus-events). _(2026-11-21)_ A member who claims a
  role is given a **Going** RSVP on the event (and goes back to not going when
  their last seat there is cancelled or declined), so the attendance list
  shows the crew and **Check In** lists them first. An outreach event created
  directly, with no request, opens the same sheet from its **Volunteer
  staffing** card; an event scheduled from a request is staffed from the
  request. Moving the event moves its sheet; cancelling or deleting it stands
  the sheet down and tells the crew (a series cancel does not yet).
- **Comment thread** — internal discussion visible to coordinators.
- **Cancel / postpone** — both the requester (from the status page) and the
  department can cancel or postpone; a postponed request can have a new date or
  none.
- **Email templates & triggers** — departments choose which status changes send
  email and store reusable templates (e.g. "How to Find Our Building").
- **Public status page** — token-based page (`/event-request/status/:token`)
  showing status, progress (if the department enables it) and a cancel
  button. Coordinators copy the status link from the request detail; neither
  the form's confirmation nor the default emails carry it (reaffirmed
  2026-11-21).
- **Completion** _(2026-11-21)_ — finalizing the event's attendance completes
  a still-scheduled request and sends the completion email. **Mark
  completed** is offered, and accepted, only once the event's date has
  passed.

### Status flow

```
submitted → in_progress → scheduled → completed
                ↕               ↕
            postponed       postponed

Any active status → declined / cancelled
```

---

## Event Settings

**Event settings** (Events admin hub → Settings) uses the shared
`SettingsLayout`: a section sidebar with descriptions on desktop and a
scrollable tab strip on phones. A deep-linked Settings tab scrolls into view.

| Section          | Holds                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility       | Event type visibility (primary filter categories)                                                                                                                                                                |
| Categories       | Custom event categories (`{id, label, color}`)                                                                                                                                                                   |
| Attendance       | Attendee visibility default; attendance-request fallback positions; mandatory event responses                                                                                                                    |
| Hour Tracking    | Event → admin hours category mappings                                                                                                                                                                            |
| Public Requests  | Five pages: **Overview** (Accept Public Requests, lead time), **Request form**, **Types & roles** (types, role presets, outreach roles), **Handling** (coordinator, checklist), **Emails** (triggers, templates) |
| Headline Metrics | The four cards at the top of the admin hub                                                                                                                                                                       |

Settings are stored in `organization.settings.events`; nested JSON writes use
`copy.deepcopy()` so changes persist.

---

## Permissions

| Permission                                 | Grants                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| (authenticated)                            | List and view events, RSVP, self check-in, attendance requests, decide requests as organizer/alternate                           |
| `events.view`                              | Attendee list (subject to attendee visibility), attachments, event folder                                                        |
| `events.manage`                            | Create, edit, delete, cancel, templates, rosters, check-in, finalize, settings, outreach pipeline, decide any attendance request |
| `events.reopen_attendance`                 | Reopen finalized attendance (deliberately not part of `events.manage`)                                                           |
| `apparatus_events.signup`                  | Take or leave a crew seat on an apparatus night (seeded wherever `events.view` is)                                               |
| `apparatus_events.manage`                  | Apparatus event templates, scheduling nights, assigning seats (seeded wherever `events.manage` is)                               |
| `analytics.view`                           | Event analytics pages                                                                                                            |
| `locations.manage_nfc_tags`                | Write room NFC tags; switch kiosk badge check-in                                                                                 |
| `apparatus.manage_nfc_tags`                | Write apparatus NFC tags                                                                                                         |
| `notifications.manage` / `settings.manage` | Clear persistent department messages                                                                                             |

---

## Known Limitations

- **Attachments** can be uploaded through the API only; no screen uploads one.
- **Waitlist promotion** notifies the promoted member in-app only (no email)
  and writes no `rsvp_history` row.
- **Analytics' "Avg Attendance Rate"** pools upcoming events with past ones in
  the selected range.
- **Template Delete** deactivates rather than deletes.
- **Guest applications opened by staff** land in no pipeline when the
  department has no default pipeline.
- **Outreach requesters** are not sent their status link automatically; a
  coordinator copies it from the request.
- **An outreach event's own signup sheet** is not stood down when its
  recurring series is cancelled, has no **Email the membership** call, and a
  volunteer's Going RSVP counts toward the event's capacity — see
  `docs/KNOWN_LIMITATIONS.md`.
- **Kiosk badge check-in** accepts a copied card unattended — see
  `docs/KNOWN_LIMITATIONS.md`.

---

## Related Documentation

- [Scheduling Module](Module-Scheduling)
- [Training Module](Module-Training)
- [Public Programs How-To](Public-Programs)
- [Member ID Cards](Member-ID-Cards)
- [API Reference](API-Reference)
