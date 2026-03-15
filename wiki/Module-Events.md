# Events Module

The Events module manages department events with QR code check-in, recurring events, templates, RSVP tracking, and attendance analytics.

---

## Key Features

- **Event Creation** — Create one-time or recurring events with location, time, and attendance tracking
- **QR Code Check-In** — Generate unique QR codes for event check-in; members scan to register attendance
- **Recurring Events** — Daily, weekly, monthly, monthly-by-weekday (e.g., "2nd Tuesday"), and annual recurrence patterns with end dates and series management
- **Event Templates** — Save and reuse event configurations
- **RSVP Management** — Going/Maybe/Not Going with RSVP overrides for admins
- **Booking Prevention** — Prevents double-booking of locations at the same time
- **Event Attachments** — Upload documents, images, or files to events
- **Reminders** — Configurable multi-tier reminders (e.g., 24 hours and 1 hour before)
- **Post-Event Validation** — Organizers receive notifications to review/finalize attendance
- **Past Events Tab** — Managers can browse historical events (hidden from regular members by default)
- **Attendee Management** — Add/remove attendees directly from event detail page
- **Training Integration** — Events can generate training sessions for attendance credit
- **Custom Event Categories** — *(2026-03-04)* Define organization-specific event categories with color badges, filterable on the Events page and selectable in the Event form. Configured in Events Settings > Custom Event Categories

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/events` | Events List | Authenticated |
| `/events/:id` | Event Detail | Authenticated |
| `/events/:id/qr-code` | Event QR Code | Authenticated |
| `/events/:id/check-in` | Self Check-In | Authenticated |
| `/events/:id/edit` | Edit Event | `events.manage` |
| `/events/:id/monitoring` | Check-In Monitoring | `events.manage` |
| `/events/:id/analytics` | Event Analytics | `analytics.view` |
| `/events/admin` | Events Admin Hub | `events.manage` |

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
```

---

## Public Outreach Request Pipeline

The Events module includes a public outreach request pipeline that lets community members submit event requests (fire safety demos, station tours, school visits, CPR classes, etc.) through a public-facing form. Department coordinators manage requests through a configurable workflow.

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

| URL | Page | Permission |
|-----|------|------------|
| `/events/admin` (Event Requests tab) | Event Requests Admin | `events.manage` |
| `/events/admin` (Settings tab) | Pipeline & Email Settings | `events.manage` |
| `/request-status/:token` | Public Request Status | Public (no auth) |
| `/f/:slug` | Public Request Form | Public (no auth) |

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
- **Edit all future**: Updates only future occurrences in a series
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

| URL | Page | Permission |
|-----|------|------------|
| `/events/analytics` | Event Analytics Dashboard | `analytics.view` |
| `/events/templates` | Event Templates Management | `events.manage` |

### Edge Cases (2026-03-13)

| Scenario | Behavior |
|----------|----------|
| Waitlisted attendees | Promoted in RSVP order when spots open |
| Draft events | Not visible to non-admin users |
| Conflict detection | Warns but does not block — departments may intentionally schedule concurrent events |
| Recurrence exceptions | Tracked per-occurrence; deleting the exception restores the occurrence |
| CSV import invalid rows | Skipped with error reporting; valid rows are still imported |
| Calendar export | Respects user's timezone setting |
| Non-respondent reminders | Excludes members who already responded (going, not going, or maybe) |
| Template picker | Shows only active templates; deactivated templates hidden but not deleted |

---

## Recent Changes (2026-03-15)

### Series End Reminders & Check-In Fix

- **Series end email reminders**: When a recurring event series is nearing its end date, organizers receive an email reminder to extend or close the series. Sent 7 days before the last occurrence
- **Recurring event creation crash fix**: Fixed crash when creating recurring events with certain recurrence patterns that generated dates beyond the series end date
- **Check-in modal fix**: Added missing `GET /api/v1/events/{id}/eligible-members` endpoint. Fixed modal overlay z-index so the check-in modal is above the backdrop
- **EventForm timezone bug fix**: Date arithmetic and conflict detection now use timezone-aware calculations instead of raw UTC comparisons

### Edge Cases (2026-03-15)

| Scenario | Behavior |
|----------|----------|
| Series already ended | No reminder is sent |
| Eligible members endpoint | Returns only members who haven't already checked in |
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
POST   /api/v1/events/{id}/series               # Get all events in a recurring series
PUT    /api/v1/events/{id}/series/future         # Update all future events in series
DELETE /api/v1/events/{id}/series                # Delete entire series
```

### Edge Cases — Recurring Events

| Scenario | Behavior |
|----------|----------|
| Monthly-by-weekday with "5th week" | Falls back to last occurrence when month has fewer than 5 weeks |
| Annual events on Feb 29 | Shifts to Feb 28 in non-leap years |
| Delete single occurrence | Does not affect other occurrences in the series |
| "Edit all future" | Only modifies events after the current date; past occurrences are unchanged |
| Duplicate detection | Checks time + location overlap before creating each occurrence |

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
