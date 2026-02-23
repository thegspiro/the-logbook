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

**See also:** [Scheduling Module](Module-Scheduling) | [Training Module](Module-Training)
