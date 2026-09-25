# Communications Module

Internal department messaging: leadership announcements with targeting,
read/acknowledgment tracking, and multi-channel (in-app / email / SMS) delivery.
This document covers the **Department Messages** feature. Email templates and the
outbound message-history log are adjacent and documented separately.
**Suggestion boxes** _(2026-09-23)_ live in the same frontend module and are
documented in [their own section](#suggestion-boxes-2026-09-23) below.

## Overview

A **department message** is an announcement an officer (`notifications.manage`)
posts to the whole department or a targeted subset. Members read it in the app
(the `/messages` inbox, the dashboard card, and the notification bell). By
priority, messages are escalated to email and SMS so they reach members who
aren't in the app. Messages can require acknowledgment (with a compliance
report), be scheduled for later, expire, be pinned, or be persistent.

## Architecture

### Backend

| Layer                                        | File                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Model                                        | `backend/app/models/notification.py` (`DepartmentMessage`, `DepartmentMessageRead`, `MessagePriority`, `MessageTargetType`) |
| Endpoints                                    | `backend/app/api/v1/endpoints/messages.py` (mounted at `/api/v1/messages`)                                                  |
| Service (CRUD, targeting, read/ack, reports) | `backend/app/services/messaging_service.py`                                                                                 |
| Delivery / escalation                        | `backend/app/services/message_delivery_service.py`                                                                          |
| Scheduled publish task                       | `backend/app/services/scheduled_tasks.py` (`run_publish_scheduled_messages`)                                                |

### Frontend (`frontend/src/modules/communications/`)

| Concern              | File                                                       |
| -------------------- | ---------------------------------------------------------- |
| Member inbox         | `pages/MessagesInboxPage.tsx` (`/messages`)                |
| Admin compose/manage | `pages/MessagesAdminPage.tsx` (`/communications/messages`) |
| Compose/edit form    | `components/MessageComposeForm.tsx`                        |
| Service              | `services/communicationsServices.ts` (`messagesService`)   |

Message bodies render through `components/ux/LinkifiedText.tsx`, which turns
`http(s)` URLs into links safely (text is emitted as React nodes — no
`dangerouslySetInnerHTML`).

## Data Model

### `DepartmentMessage` (`department_messages`)

| Column                                                  | Notes                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `title`, `body`                                         | Content. Body is plain text (links auto-rendered).                                                     |
| `priority`                                              | `normal` / `important` / `urgent` — drives escalation.                                                 |
| `target_type`                                           | `all` / `roles` / `statuses` / `members`.                                                              |
| `target_roles`                                          | JSON array of **role (position) ids** (rename-safe; name fallback for legacy rows).                    |
| `target_statuses`, `target_member_ids`                  | JSON arrays for status/member targeting.                                                               |
| `is_pinned`, `is_persistent`, `requires_acknowledgment` | Display/behavior flags.                                                                                |
| `is_active`                                             | Deactivated (e.g. by soft delete) messages are hidden.                                                 |
| `expires_at`                                            | Optional; expired messages drop out of the inbox. Indexed via `idx_dept_msg_org_active_expires`.       |
| `deleted_at`                                            | Soft delete — hides the message while preserving read/ack records.                                     |
| `scheduled_at`                                          | Future value = not yet published; cleared to NULL on publish. Indexed via `idx_dept_msg_scheduled_at`. |
| `posted_by`                                             | Author (FK users, SET NULL).                                                                           |

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

| Priority / flag         | In-app | Email | SMS |
| ----------------------- | :----: | :---: | :-: |
| Normal / Important      |   ✅   |  ✅   |  —  |
| Requires acknowledgment |   ✅   |  ✅   |  —  |
| Urgent                  |   ✅   |  ✅   | ✅  |

- **In-app:** one `NotificationLog` (`channel="in_app"`, category
  `department_message`) per recipient → the bell inbox.
- **Email:** reuses `EmailService` + `wrap_email_body`. For a department message
  this is the **record-of-notice channel**, so it is sent for **every message,
  at every priority**, and **unconditionally** per member — deliberately _not_
  filtered by the member's `email_notifications` preference or by consent, so a
  member can never claim they weren't informed. Important/urgent messages get an
  `[IMPORTANT]`/`[URGENT]` subject prefix. (The `email_notifications` preference
  still governs the separate reminder/alert flows.)
- **SMS:** `SMSService.send_bulk_sms` when Twilio is enabled and the member has a
  `mobile`/`phone`, **and** the member has granted express **SMS consent**
  (`ConsentType.SMS_NOTIFICATIONS`, checked via `ConsentService.granted_user_ids`,
  which fails closed — a member who was never asked is treated as _not_ consented,
  per US TCPA), **and** their `sms_notifications` preference is on. A member who
  turns off (or never grants) SMS still receives the email above.

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

| Action                                                 | Permission                             |
| ------------------------------------------------------ | -------------------------------------- |
| Create / edit / delete / stats / acknowledgment report | `notifications.manage`                 |
| Read own inbox, mark read, acknowledge                 | Authenticated member (targeting-gated) |

Message create, update, delete, and acknowledgment are audit-logged.

## Migrations

- `20260218_0500_add_department_messages.py` — original tables.
- `20260321_0301_add_department_message_is_persistent.py` — `is_persistent`.
- `20260720_0002_backfill_department_message_role_ids.py` — role names → ids.
- `20260720_0003_add_department_message_scheduled_at.py` — `scheduled_at` + index.
- `20260720_0004_add_department_message_deleted_at.py` — `deleted_at` + expiry
  index (renumbered from `20260720_0001` in the duplicate-revision fix).

## Email templates & footers _(2026-08-10)_

Templates and the department's **footer library** are documented in the wiki
rather than here, because this page is scoped to Department Messages. In short:

- The footer used to be copy-pasted into all 35 default bodies. It is now a
  named library on `Organization.settings` — **Internal** (the default),
  **Public** and **Official notice** — with each template naming its footer via
  `email_templates.footer_key` (NULL = the library's default).
- It reaches every render path as `{{footer_html}}` / `{{footer_text}}`, injected
  by `build_context` and resolved **a step before** the template body, because
  rendering is a single substitution pass.
- `GET` / `PUT /api/v1/email-templates/footers`, behind `settings.manage` **or**
  `organization.update_settings`.
- Nine more `{{organization_*}}` variables were added (tax ID, the three
  department identifiers with their scheme label, county, founded year, fax,
  description, type).

Full detail:
[Communications module → Email Footer Library](../wiki/Module-Communications.md#email-footer-library-2026-08-10).

## Suggestion Boxes _(2026-09-23)_

Configurable, optionally anonymous suggestion boxes with per-box reviewers.
Shipped in PR #2649. User-facing walkthrough:
[`training/07-documents-forms.md`](./training/07-documents-forms.md#suggestion-boxes-2026-09-23).

### Code map

| Layer    | Where                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | `app/models/suggestion.py` — `SuggestionBox`, `SuggestionBoxReviewer`, `SuggestionBoxWatcher`, `Suggestion`, `SuggestionAttachment`, `SuggestionMessage`, `SuggestionForward` |
| Service  | `app/services/suggestion_service.py`                                                                                                                                          |
| API      | `app/api/v1/endpoints/suggestions.py`, mounted at `/api/v1/suggestions`                                                                                                       |
| Frontend | `modules/communications/pages/SuggestionsPage.tsx`, `SuggestionBoxesAdminPage.tsx`, `components/Suggestion*.tsx`, `services/suggestionsService.ts`                            |

### Pages

| Route                              | Gate                 | Purpose                                                                                                                                                                                                        |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/suggestions`                     | Signed in            | Tabs **Submit**, **My submissions**, **Follow up with a key**, and **Review** (only when `GET /review/summary` reports the caller a reviewer). Reads `?tab=` and `?id=`, which the notification emails link to |
| `/communications/suggestion-boxes` | `suggestions.manage` | Box configuration. Sidebar: **Administration → Forms & Comms → Suggestion Boxes**                                                                                                                              |

### Authorization model

**Configuring a box and reading it are separate on purpose.** `suggestions.manage`
(new category `suggestions`) creates and edits boxes and chooses reviewers; the
admin response carries no submission fields, so the grant alone discloses
nothing a complaints box receives. **Reading is decided per box in the service,
not by a permission**: a caller reviews a box when they are a listed reviewer
member or currently hold a listed reviewer position, and reviews a single
suggestion when it was forwarded to them (by member or by a position they hold
at the time of the request). Only a box's own reviewers may forward or withdraw
a forward (403 otherwise). Holding `suggestions.manage` also surfaces the
Administration section (`ADMIN_NAVIGATION_PERMISSIONS`).

Seeded on the Fire Chief, Deputy Chief and Assistant Chief ranks and on the
President and Communications Officer positions; migration `394600cbfae2`
carries it to existing installations' `is_system` position rows (see
[Migrations](#suggestion-box-migrations)).

### The default Compliance box _(2026-09-24)_

Every department gets a box named **Compliance** whose reviewer is the seeded
**Compliance Officer** position (`compliance_officer`): onboarding creates it
(`SuggestionService.seed_compliance_box`) and migration `3c918c06466d` adds it
to existing departments. Anonymous submissions are allowed and follow-up is on,
so an anonymous reporter can still be asked questions.

**It is created active**, so members can file a concern from day one. The
position starts with no holder, so **reports filed before an officer is
appointed wait unread**. Assign the Compliance Officer on the positions screen
promptly; they see everything the box has received so far. If no position
carries the `compliance_officer` slug, the box is created inactive instead,
because a live box with no reviewer at all is refused.

A department that already had a box named `Compliance` keeps its own; one that
had created its own `compliance_officer` position gets that position as the
reviewer.

Migration `3c918c06466d` first seeded these boxes inactive; `7d2b4e8a1c35`
switches on each one that is still exactly as seeded (no creator, the seeded
description, never saved from the admin screen, with a reviewer). A box an
administrator has already saved is left as they set it.

### Anonymity is structural

| What        | Anonymous submission                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author      | `submitted_by` NULL; submitter-side `suggestion_messages.author_id` NULL                                                                                                                                                                                            |
| Audit       | No `suggestion_submitted` entry (named submissions only)                                                                                                                                                                                                            |
| Timestamps  | `created_at` / `updated_at`, attachment `created_at` and the file's mtime pinned to 12:00:00 UTC of the day; an anonymous reply does not bump `updated_at`. The UI shows these as a date only                                                                       |
| Screenshots | Magic-byte type check (PNG/JPEG/WebP/GIF), ≤5 files, ≤10 MB each; re-encoded to WebP (q85, ≤2560²), which drops EXIF; stored as `{uuid}.webp` with the original filename discarded                                                                                  |
| Follow-up   | Only in a follow-up box: `secrets.token_urlsafe(32)` returned once in the receipt; only its SHA-256 digest is stored. Key routes take the key in the POST body and still require a session ("the key proves authorship, the session proves the caller is a member") |

Accepted limits — server-side timing correlation (access log, the reviewer
email's send time, session activity), unrecoverable keys, screenshot content,
and exact file `ctime` — are recorded in
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) under "Suggestion Boxes — What
Anonymity Does and Does Not Cover".

### Dispositions and notifications

Dispositions: `new`, `under_review`, `accepted`, `implemented`, `declined`,
`duplicate`; "open" = `new` or `under_review`. The internal note is never in the
submitter's response schema. In a one-way box (`allow_follow_up` false) the
submitter sees neither disposition nor messages.

Notices go through the background task `send_suggestion_notice` to active
members only. Each recipient gets an in-app notification (category
`suggestions`, linking to the submission), a web push where push is configured,
and **their own email**, so no recipient sees another's address. Every channel
**carries a link and never the content**, and nothing identifying the submitter
goes into the notification row. Email is not gated on the member's email
preference: for a reviewer it is the channel of record (CLAUDE.md pitfall #18).

| Event              | Recipients                                                     | Email template                                |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------- |
| New submission     | The box's reviewers                                            | `suggestion_submitted` (editable)             |
| New submission     | The box's notified people ("Also notify"), minus its reviewers | `suggestion_box` (fixed; no link to the item) |
| Submitter reply    | The box's reviewers and forward recipients                     | `suggestion_box`                              |
| Disposition change | Named submitter, follow-up boxes only                          | `suggestion_box`                              |
| Reviewer reply     | Named submitter                                                | `suggestion_box`                              |
| Forward            | The new recipients                                             | `suggestion_box`                              |

**Notified people are not reviewers.** `suggestion_box_watchers` names positions
or members told that a box received something; they cannot open it, and their
notice links to `/suggestions`, not to the submission. A chief who asks to know
the Compliance box is in use must not become able to read a complaint about
themselves by asking. An update that omits both `watcherPositionIds` and
`watcherMemberIds` leaves them unchanged, so a client older than the field does
not clear them.

**The new-submission notices can be switched off** under Notification Rules
(trigger `suggestion_submitted`). No rule means on. The switch covers only the
two new-submission rows above; replies, forwards and status changes are the
conversation itself and always go out.

Anonymous submitters are never notified. Audit events: `suggestion_box_created`,
`suggestion_box_updated`, `suggestion_submitted` (named only),
`suggestion_disposition_changed`, `suggestion_forwarded`,
`suggestion_forward_withdrawn`.

### Deliberate decisions

- **Not gated by the `communications` module flag.** `communications` defaults
  off and none of its screens honour the flag, so gating only this would hide
  suggestion boxes on almost every installation. Listed in
  `DELIBERATELY_UNGATED` in `tests/test_module_api_gating.py`.
- **`/suggestions` is in `UNCACHEABLE_PREFIXES`** — a cached thread would hide a
  reply, and the payload is sensitive.
- **Closing a box and deleting one are different.** `is_active` closes a box
  and keeps everything in it. `DELETE /admin/boxes/{id}` (`suggestions.manage`)
  removes the box.
  - An empty box deletes directly.
  - A box that has received submissions deletes only with `confirm_name` equal
    to its name. Otherwise the endpoint returns 409 and the screen offers
    archiving first.
  - Deletion cascades through every submission, screenshot row, message,
    forward and status step. Screenshot files are removed after the commit.
  - It is audited as `suggestion_box_deleted`, with the number of submissions
    lost, at `warning` severity when that number is above zero.
  - The admin list reports `submissionCount` for this.
- **An active box must have at least one reviewer.**

### Suggestion box migrations

| Revision       | What it does                                                                                                                                          | Downgrade                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `80e2004cd691` | Creates the five box/suggestion tables, each guarded on absence (no-op after `create_all`)                                                            | Drops them — **every suggestion, attachment record and message**; files under `uploads/suggestions` are left on disk |
| `394600cbfae2` | Adds `suggestions.manage` to `is_system` rows for `fire_chief`, `deputy_chief`, `assistant_chief`, `president`, `communications_officer` where absent | Removes it from the same rows, including a deliberate post-upgrade grant                                             |
| `9cb132ad83dc` | Creates `suggestion_forwards`                                                                                                                         | Drops it — every forward, suggestions intact                                                                         |
| `1ae1ffbc445e` | Widens `notification_rules.trigger` and the two `template_type` enums with `suggestion_submitted`; creates `suggestion_box_watchers`                  | Deletes rules and templates of that value, narrows the enums, drops the watchers table                               |

## User documentation

Member/officer how-to:
[Documents, Forms & Communications → Department Messages](./training/07-documents-forms.md#department-messages).
Wiki overview: [Communications module](../wiki/Module-Communications.md).
