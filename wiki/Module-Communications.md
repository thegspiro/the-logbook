# Communications Module

The Communications module covers how the department reaches its members:
**Department Messages** (internal announcements with read/acknowledgment
tracking and multi-channel delivery), **Email Templates**, and the outbound
**Message History** log. This page focuses on Department Messages; notification
_rules_ and the member notification inbox are covered under
[Events](Module-Events) and the Notifications page.

## Key Features

- **Department Messages** — leadership announcements targeted to everyone, to
  specific roles, to member statuses, or to hand-picked members.
- **Priority-based escalation** — every targeted member gets an in-app
  notification (bell inbox, dashboard card, Messages page); **important /
  acknowledgment-required** messages are also emailed; **urgent** messages add
  SMS (when Twilio is configured and the member has a mobile number).
- **Required acknowledgment** — messages that members must confirm they've read.
  They stay "pending" until acknowledged, and officers get a per-recipient
  report of who has and has not acknowledged (with an audience denominator).
- **Scheduled send** — schedule a message to publish (and escalate) at a future
  time; it stays hidden until then.
- **Persistent messages** — stay visible until an admin clears them.
- **Editing & soft delete** — edit a message in place; deleting hides it from
  members but preserves read/acknowledgment records as compliance evidence.
- **Rename-safe role targeting** — role-targeted messages follow the role's
  identity, so renaming a role never silently stops delivery.
- **Member controls** — members opt out of email or urgent-SMS escalation under
  Settings → Notifications; the in-app notification is always delivered.

## Pages

| Page                        | Route                             | Audience    | Permission             |
| --------------------------- | --------------------------------- | ----------- | ---------------------- |
| Messages (inbox)            | `/messages`                       | All members | Authenticated          |
| Department Messages (admin) | `/communications/messages`        | Officers    | `notifications.manage` |
| Email Templates             | `/communications/email-templates` | Admins      | `settings.manage`      |

Members also see recent messages on the **dashboard** "Department Messages" card
and in the notification **bell**.

## API Endpoints

```
# Admin (notifications.manage)
GET    /api/v1/messages                         # List (include_inactive, search, priority, pagination)
POST   /api/v1/messages                         # Create (optional scheduled_at defers publish)
GET    /api/v1/messages/roles                   # Roles available for targeting (id, name, slug)
GET    /api/v1/messages/{id}                     # Get one
PATCH  /api/v1/messages/{id}                     # Edit / reschedule
DELETE /api/v1/messages/{id}                     # Soft-delete (read/ack records preserved)
GET    /api/v1/messages/{id}/stats               # Read/ack counts + audience denominator
GET    /api/v1/messages/{id}/acknowledgments     # Per-recipient read/ack breakdown

# Member (authenticated)
GET    /api/v1/messages/inbox                    # Messages targeted to me
GET    /api/v1/messages/inbox/unread-count        # My unread/pending count
POST   /api/v1/messages/{id}/read                # Mark read
POST   /api/v1/messages/{id}/acknowledge         # Acknowledge (ack-required messages)
```

## Delivery matrix

| Priority / flag         | In-app | Email | SMS |
| ----------------------- | :----: | :---: | :-: |
| Normal / Important      |   ✅   |   —   |  —  |
| Requires acknowledgment |   ✅   |  ✅   |  —  |
| Urgent                  |   ✅   |  ✅   | ✅  |

Escalation runs as a background task (posting stays instant) and is
**rate-limited per organization** on the email/SMS channels so a runaway or
compromised account can't blast the whole department; the limiter fails open so
real urgent alerts still go out if the limiter is unavailable.

## Scheduled publishing

A message with a future `scheduled_at` is created hidden and published by the
`publish_scheduled_messages` scheduled task (runs every ~15 minutes), which marks
it live and escalates it. An already-published message cannot be moved back to a
future time (that would re-send it); pending messages remain reschedulable.

## Recent Changes (2026-07-17)

### Features

- Cross-channel escalation (in-app + email + SMS) by priority.
- Required-acknowledgment enforcement + per-recipient acknowledgment report.
- Scheduled send; in-place editing; soft delete preserving ack evidence.
- Rename-safe role-id targeting (existing messages backfilled).
- Admin search / priority filter / pagination; clickable links in bodies.
- Member `sms_notifications` preference for urgent-message SMS.

### Data Model Changes

`department_messages` gained `deleted_at` (soft delete), `scheduled_at`
(deferred publish), and an `idx_dept_msg_scheduled_at` index; role targeting now
stores role **ids** rather than names. `department_message_reads` continues to
track per-user `read_at` / `acknowledged_at` and is retained on soft delete.

### Safety

- Message content is escaped on every surface (web, email subject/body); SMS is
  plain capped text — no injection path via a malicious message.
- The delivery path is fully failure-isolated: one bad message can't halt the
  scheduled-publish batch.

See the member/officer how-to in the
[Documents, Forms & Communications training guide](../docs/training/07-documents-forms.md#department-messages).

## Email Templates (2026-08-07)

### Catalogue Categories

The template catalogue had grown past three dozen entries rendered as a single
flat scroll. Templates are now grouped into collapsible categories with
per-category counts: **Members & Accounts, Events & Scheduling, Training,
Elections, Inventory, Department Store, Other**.

Two behaviours that keep the grouping from getting in the way:

- An active **search expands every group**, so a hit is never hidden behind a
  collapsed header.
- The category holding the **selected** template is force-expanded, so the
  selection cannot scroll out of view.

### Officer Signature Variables

A notice sent by a member-services clerk, or by a nightly scheduled task, had no
way to be signed by the officer whose name belongs on it.

A **department office directory** now backs every template. Each catalogued
office — President, Vice President, Chief, Deputy Chief, Assistant Chief,
Secretary, Assistant Secretary, Treasurer, Safety Officer, Training Officer,
Quartermaster — exposes `{{<office>_name}}`, `{{<office>_title}}`,
`{{<office>_email}}` and `{{<office>_phone}}`.

**Resolution order** for a holder: an admin override on the office → the member
the office is linked to (so the values track that member's profile) →
auto-detection from members carrying the matching position slug. The last of
these means a department that never opens the Officers tab still signs its
notices correctly.

**Caching.** The resolved values are flattened into
`Organization.settings["officer_directory"]`, which the _synchronous_
`EmailTemplateService.render()` reads from the organization it already receives —
avoiding an async lookup threaded through all ten render call sites. Only
catalogued variable names are injected, so a hand-edited settings blob cannot
introduce arbitrary template variables. The cache is rebuilt on every office
write, when the Officers tab loads, and nightly by `officer_directory_sync` — the
last of which catches a change made to the _member behind_ an office rather than
to the assignment.

See [DEPARTMENT_OFFICERS.md](../docs/DEPARTMENT_OFFICERS.md) for the full catalogue
and API.

### Fixed

- `inventory_notification_service` passed **no organization** to `render()`, so
  every `{{organization_*}}` variable was silently dropped from inventory change
  emails.
