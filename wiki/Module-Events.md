# Events Module

The Events module manages department events with QR code check-in, recurring events, templates, RSVP tracking, and attendance analytics.

---

## Key Features

- **Event Creation** — Create one-time or recurring events with location, time, and attendance tracking
- **QR Code Check-In** — Generate unique QR codes for event check-in; members scan to register attendance
- **Recurring Events** — Daily, weekly, monthly, and yearly recurrence patterns with end dates
- **Event Templates** — Save and reuse event configurations
- **RSVP Management** — Going/Maybe/Not Going with RSVP overrides for admins
- **Booking Prevention** — Prevents double-booking of locations at the same time
- **Event Attachments** — Upload documents, images, or files to events
- **Reminders** — Configurable multi-tier reminders (e.g., 24 hours and 1 hour before)
- **Post-Event Validation** — Organizers receive notifications to review/finalize attendance
- **Past Events Tab** — Managers can browse historical events (hidden from regular members by default)
- **Attendee Management** — Add/remove attendees directly from event detail page
- **Training Integration** — Events can generate training sessions for attendance credit

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

**See also:** [Scheduling Module](Module-Scheduling) | [Training Module](Module-Training) | [Public Programs How-To](Public-Programs)
