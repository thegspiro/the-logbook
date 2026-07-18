# Communications Module

Internal department messaging: leadership announcements with targeting,
read/acknowledgment tracking, and multi-channel (in-app / email / SMS) delivery.
This document covers the **Department Messages** feature. Email templates and the
outbound message-history log are adjacent and documented separately.

## Overview

A **department message** is an announcement an officer (`notifications.manage`)
posts to the whole department or a targeted subset. Members read it in the app
(the `/messages` inbox, the dashboard card, and the notification bell). By
priority, messages are escalated to email and SMS so they reach members who
aren't in the app. Messages can require acknowledgment (with a compliance
report), be scheduled for later, expire, be pinned, or be persistent.

## Architecture

### Backend

| Layer | File |
|-------|------|
| Model | `backend/app/models/notification.py` (`DepartmentMessage`, `DepartmentMessageRead`, `MessagePriority`, `MessageTargetType`) |
| Endpoints | `backend/app/api/v1/endpoints/messages.py` (mounted at `/api/v1/messages`) |
| Service (CRUD, targeting, read/ack, reports) | `backend/app/services/messaging_service.py` |
| Delivery / escalation | `backend/app/services/message_delivery_service.py` |
| Scheduled publish task | `backend/app/services/scheduled_tasks.py` (`run_publish_scheduled_messages`) |

### Frontend (`frontend/src/modules/communications/`)

| Concern | File |
|---------|------|
| Member inbox | `pages/MessagesInboxPage.tsx` (`/messages`) |
| Admin compose/manage | `pages/MessagesAdminPage.tsx` (`/communications/messages`) |
| Compose/edit form | `components/MessageComposeForm.tsx` |
| Service | `services/communicationsServices.ts` (`messagesService`) |

Message bodies render through `components/ux/LinkifiedText.tsx`, which turns
`http(s)` URLs into links safely (text is emitted as React nodes — no
`dangerouslySetInnerHTML`).

## Data Model

### `DepartmentMessage` (`department_messages`)

| Column | Notes |
|--------|-------|
| `title`, `body` | Content. Body is plain text (links auto-rendered). |
| `priority` | `normal` / `important` / `urgent` — drives escalation. |
| `target_type` | `all` / `roles` / `statuses` / `members`. |
| `target_roles` | JSON array of **role (position) ids** (rename-safe; name fallback for legacy rows). |
| `target_statuses`, `target_member_ids` | JSON arrays for status/member targeting. |
| `is_pinned`, `is_persistent`, `requires_acknowledgment` | Display/behavior flags. |
| `is_active` | Deactivated (e.g. by soft delete) messages are hidden. |
| `expires_at` | Optional; expired messages drop out of the inbox. Indexed via `idx_dept_msg_org_active_expires`. |
| `deleted_at` | Soft delete — hides the message while preserving read/ack records. |
| `scheduled_at` | Future value = not yet published; cleared to NULL on publish. Indexed via `idx_dept_msg_scheduled_at`. |
| `posted_by` | Author (FK users, SET NULL). |

### `DepartmentMessageRead` (`department_message_reads`)

One row per (message, user): `read_at`, `acknowledged_at`. Unique on
`(message_id, user_id)`. Preserved on soft delete — this is the compliance
evidence of who acknowledged a mandatory notice.

## Targeting

`MessagingService._is_targeted` decides visibility: `all` → everyone; `roles` →
the user holds a targeted role (matched by **id**, with a name fallback for
un-backfilled legacy entries); `statuses` → the user's status is targeted;
`members` → the user id is listed. The same logic drives the inbox, the unread
count, escalation recipients, and the acknowledgment report, so they never
disagree about the audience.

## Delivery & escalation

On create (immediate) or at scheduled publish, `MessageDeliveryService.deliver`
fans the message out (excluding the author):

| Priority / flag | In-app | Email | SMS |
|-----------------|:---:|:---:|:---:|
| Normal / Important | ✅ | — | — |
| Requires acknowledgment | ✅ | ✅ | — |
| Urgent | ✅ | ✅ | ✅ |

- **In-app:** one `NotificationLog` (`channel="in_app"`, category
  `department_message`) per recipient → the bell inbox.
- **Email:** reuses `EmailService` + `wrap_email_body`; respects the member's
  `notification_preferences.email_notifications`.
- **SMS:** `SMSService.send_bulk_sms` when Twilio is enabled and the member has a
  `mobile`/`phone`; respects `notification_preferences.sms_notifications`.

Escalation runs in a FastAPI `BackgroundTask` on its own DB session so the POST
returns immediately. `deliver` is fully failure-guarded (one bad message can't
halt a scheduled-publish batch), and the email/SMS channels are **rate-limited
per organization** via `is_rate_limited` (fail-open, so real urgent alerts still
go out). The in-app notification is never rate-limited or opt-out-able.

## Scheduling

`create_message` stores `scheduled_at` only if it's in the future; otherwise the
message is immediate and escalated at once. The inbox/unread queries hide
messages whose `scheduled_at` is still in the future. `run_publish_scheduled_messages`
(every ~15 min) selects due, active, non-deleted messages, clears `scheduled_at`
(before delivery, to avoid re-escalation on retry), and delivers them.
`update_message` refuses to move an already-published message (`scheduled_at`
NULL) back to a future time.

## API Endpoints

Admin endpoints require `notifications.manage`; inbox/read/acknowledge are
available to any authenticated member (scoped to messages targeted to them).

```
GET    /api/v1/messages                         # List (include_inactive, search, priority, skip, limit)
POST   /api/v1/messages                         # Create (optional scheduled_at)
GET    /api/v1/messages/roles                   # Roles for targeting (id, name, slug)
GET    /api/v1/messages/{id}                     # Get
PATCH  /api/v1/messages/{id}                     # Edit / reschedule
DELETE /api/v1/messages/{id}                     # Soft-delete
GET    /api/v1/messages/{id}/stats               # Read/ack counts + total_targeted
GET    /api/v1/messages/{id}/acknowledgments     # Per-recipient breakdown
GET    /api/v1/messages/inbox                    # Current user's messages
GET    /api/v1/messages/inbox/unread-count        # Current user's unread/pending count
POST   /api/v1/messages/{id}/read                # Mark read
POST   /api/v1/messages/{id}/acknowledge         # Acknowledge
```

## Permissions

| Action | Permission |
|--------|------------|
| Create / edit / delete / stats / acknowledgment report | `notifications.manage` |
| Read own inbox, mark read, acknowledge | Authenticated member (targeting-gated) |

Message create, update, delete, and acknowledgment are audit-logged.

## Migrations

- `20260218_0500_add_department_messages.py` — original tables.
- `20260321_0301_add_department_message_is_persistent.py` — `is_persistent`.
- `20260720_0001_add_department_message_deleted_at.py` — `deleted_at` + expiry index.
- `20260720_0002_backfill_department_message_role_ids.py` — role names → ids.
- `20260720_0003_add_department_message_scheduled_at.py` — `scheduled_at` + index.

## User documentation

Member/officer how-to:
[Documents, Forms & Communications → Department Messages](./training/07-documents-forms.md#department-messages).
Wiki overview: [Communications module](../wiki/Module-Communications.md).
