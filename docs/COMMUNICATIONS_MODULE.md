# Communications Module

Internal department messaging: leadership announcements with targeting,
read/acknowledgment tracking, and multi-channel (in-app / email / SMS) delivery.
This document covers the **Department Messages** feature. Email templates and the
outbound message-history log are adjacent and documented separately.
**Suggestion boxes** _(2026-09-23)_ live in the same frontend module and are
documented in [their own section](#suggestion-boxes-2026-09-23) below, as are
the [member email policy](#member-email-policy-2026-09-28) every sender reads,
[in-app notification stacks](#in-app-notification-stacks-2026-09-28), and a
pointer to the [email redesign](#email-templates-the-solid-tab-redesign-2026-09-27).

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
  `[IMPORTANT]`/`[URGENT]` subject prefix. In the member email policy it is
  the **required** kind `department_messages`, so it is also listed under
  "Always emailed to you" on the member's settings — see
  [Member email policy](#member-email-policy-2026-09-28).
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

| Route                              | Gate                 | Purpose                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/suggestions`                     | Signed in            | Tabs **Submit**, **Idea board** (only when an open box has a board), **My submissions**, **Follow up with a key**, and **Review** (only when `GET /review/summary` reports the caller a reviewer). Reads `?tab=` and `?id=`, which the notification emails link to |
| `/communications/suggestion-boxes` | `suggestions.manage` | Box configuration. Sidebar: **Administration → Forms & Comms → Suggestion Boxes**                                                                                                                                                                                  |

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
**Compliance Officer** position (`compliance_officer`, new in #2673 and offered
in the onboarding position editor for every agency type; it carries compliance,
reports and documents management, `training.manage` — which gates the
Compliance Officer dashboard — with `training.view_all` and
`training.configure`, a read-only roster, and the member baseline). The same
slug is what the certification-expiry compliance CC and the
`{{compliance_officer_*}}` email signature variables resolve to: onboarding creates it
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

| What        | Anonymous submission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author      | `submitted_by` NULL; submitter-side `suggestion_messages.author_id` NULL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Audit       | No `suggestion_submitted` entry (named submissions only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Timestamps  | `created_at` / `updated_at`, attachment `created_at` and the file's mtime pinned to 12:00:00 UTC of the day; an anonymous reply does not bump `updated_at`. The UI shows these as a date only                                                                                                                                                                                                                                                                                                                                                                                               |
| Screenshots | Magic-byte type check (PNG/JPEG/WebP/GIF), ≤5 files, ≤10 MB each; re-encoded to WebP (q85, ≤2560²), which drops EXIF; stored as `{uuid}.webp` with the original filename discarded                                                                                                                                                                                                                                                                                                                                                                                                          |
| Logging     | _(2026-09-30)_ The submission and follow-up routes (`UNLOGGED_PATH` in `app/core/logging.py`) are written to no access log: uvicorn's access log and `IPLoggingMiddleware` skip them, and the bundled nginx configs drop the line (`$access_loggable`) and raise the error log to `crit`. A failure there writes no `error_logs` row (`is_excluded_path`), the frontend's `reportApiError` does not report it, and `POST /errors/log` discards one an older cached build sends (`is_excluded_client_path`). The structured log still records the failure with route and time, no user or IP |
| Follow-up   | Only in a follow-up box: `secrets.token_urlsafe(32)` returned once in the receipt; only its SHA-256 digest is stored. Key routes take the key in the POST body and still require a session ("the key proves authorship, the session proves the caller is a member")                                                                                                                                                                                                                                                                                                                         |

Accepted limits — server-side timing correlation (the reviewer email's send
time, in-app `sent_at`, session activity), a reverse proxy the operator runs in
front of the app (it logs these routes unless configured the same way;
`docs/deployment/aws.md` shows how for its host nginx), unrecoverable keys,
screenshot content, and exact file `ctime` — are recorded in
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) under "Suggestion Boxes — What
Anonymity Does and Does Not Cover".

### Dispositions and notifications

Dispositions: `new`, `under_review`, `accepted`, `implemented`, `declined`,
`duplicate`; "open" = `new` or `under_review`. The internal note is never in the
submitter's response schema. In a one-way box (`allow_follow_up` false) the
submitter sees neither disposition nor messages.

**Status history.** In a follow-up box the submitter also sees a timeline:
receipt, then each step reviewers took, from `suggestion_status_events`. A step
is written when the disposition changes or a reviewer adds a **public
response** (`publicResponse` on `PATCH /review/{id}`, at most 2,000
characters), and a status change plus response saved together are one step.
An internal-note edit alone adds nothing. Steps name no reviewer: the submitter
sees "Reviewers", and who acted is in the audit log. Receipt is the
suggestion's own `created_at`, so an anonymous submission's receipt stays
day-precise. Steps are ordered by a per-suggestion `sequence` taken under a row
lock, because MySQL timestamps are whole seconds. A response is refused in a
one-way box, and the reviewer screen offers none where the submitter can't come
back to read it (anonymous with no key).

Notices go through the background task `send_suggestion_notice` to active
members only. Each recipient gets an in-app notification (category
`suggestions`, linking to the submission), a web push where push is configured,
and **their own email**, so no recipient sees another's address. Every channel
**carries a link and never the content**, and nothing identifying the submitter
goes into the notification row.

**The email follows the member's choice** _(2026-09-28)_. It is the optional
kind `EmailKind.SUGGESTION_BOX` ("Suggestion box"), checked with
`member_receives_email` per recipient, so a reviewer who switches it off — or
turns **Email Notifications** off — gets the bell entry and the push but no
email, unless the department has made the kind required on Member Emails &
Texts. The bell entry is written either way. (Until #2774 this paragraph said
the email ignored preferences as the reviewer's channel of record; the policy
classifies it as optional because the box and the bell carry the same notice.)

| Event                                 | Recipients                                                     | Email template                                |
| ------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| New submission                        | The box's reviewers                                            | `suggestion_submitted` (editable)             |
| New submission                        | The box's notified people ("Also notify"), minus its reviewers | `suggestion_box` (fixed; no link to the item) |
| Submitter reply                       | The box's reviewers and forward recipients                     | `suggestion_box`                              |
| Disposition change or public response | Named submitter, follow-up boxes only                          | `suggestion_box`                              |
| Reviewer reply                        | Named submitter                                                | `suggestion_box`                              |
| Forward                               | The new recipients                                             | `suggestion_box`                              |

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
`suggestion_box_updated`, `suggestion_box_deleted`, `suggestion_submitted`
(named only), `suggestion_disposition_changed`, `suggestion_forwarded`,
`suggestion_forward_withdrawn`.

**The submit form states the screenshot rules** _(2026-09-29)_ the server
enforces — formats, 10 MB, scaling to 2560 px on the longest side, first frame
only for an animated GIF. `SuggestionSubmitForm.tsx` keeps them as constants
shared with the dropzone's `accept` / `maxSizeMB`, mirroring
`ALLOWED_SCREENSHOT_MIME`, `MAX_SCREENSHOT_BYTES` and
`SCREENSHOT_MAX_DIMENSIONS` in `suggestion_service.py`; the backend is what
refuses or resizes.

### Idea board

A box with **Public idea board** on (`suggestion_boxes.public_board_enabled`,
default off) lets its reviewers publish a suggestion for every member to see
and vote on.

- **Only a reviewer-written copy is published.** `POST /review/{id}/publish`
  takes a title and summary, stored as `published_title` and
  `published_summary`. The board (`GET /board`) returns only that copy, the
  status, the latest public response, the vote count and whether the caller
  voted. The details, screenshots and submitter are never included:
  `BoardEntry` has no field for them. The original may name people, and its
  wording can identify an anonymous author.
- **The latest public response is shown with a published idea.** Reviewers
  write those responses to the submitter, so the reviewer screen says so
  while an idea is published.
- **Only the box's own reviewers publish or unpublish.** A forward recipient
  gets 403.
- **Nothing is published automatically.**
- **Votes:** `POST` and `DELETE /board/{id}/vote` are idempotent, one per member
  (unique on suggestion and user). Only counts and the caller's own vote are
  exposed. Unpublishing keeps the votes, so republishing restores its support.
- **Hiding without unpublishing.** An idea leaves the board when its box is
  archived or the board is switched off. An update that omits
  `publicBoardEnabled` leaves the setting unchanged.
- **Audit events:** `suggestion_published`, `suggestion_publication_edited`,
  `suggestion_unpublished`.

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

| Revision       | What it does                                                                                                                                                            | Downgrade                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `80e2004cd691` | Creates the five box/suggestion tables, each guarded on absence (no-op after `create_all`)                                                                              | Drops them — **every suggestion, attachment record and message**; files under `uploads/suggestions` are left on disk |
| `394600cbfae2` | Adds `suggestions.manage` to `is_system` rows for `fire_chief`, `deputy_chief`, `assistant_chief`, `president`, `communications_officer` where absent                   | Removes it from the same rows, including a deliberate post-upgrade grant                                             |
| `9cb132ad83dc` | Creates `suggestion_forwards`                                                                                                                                           | Drops it — every forward, suggestions intact                                                                         |
| `e79309de6735` | Adds `suggestion_boxes.public_board_enabled` (default off), the four `suggestions.published_*` columns, and `suggestion_votes`; every step guarded                      | Drops them — **every vote and every published copy**; submissions untouched                                          |
| `0010291816fd` | Creates `suggestion_status_events`; backfills one step for each suggestion already past `new`, dated `disposition_updated_at` (earlier steps were never recorded)       | Drops it — **every public response**; dispositions on `suggestions` survive                                          |
| `1ae1ffbc445e` | Widens `notification_rules.trigger` and the two `template_type` enums with `suggestion_submitted`; creates `suggestion_box_watchers`                                    | Deletes rules and templates of that value, narrows the enums, drops the watchers table                               |
| `3c918c06466d` | Seeds the `compliance_officer` system position and an inactive **Compliance** box reviewed by it into existing departments; keeps a department's own position or box    | Removes only unassigned seeded positions and seeded boxes that received nothing                                      |
| `7d2b4e8a1c35` | Switches on each Compliance box still exactly as `3c918c06466d` seeded it (seeded name and description, no creator, never saved, has a reviewer); also merges two heads | Switches the same signature back off                                                                                 |

## Member email policy _(2026-09-28)_

Every email to a member's account belongs to one `EmailKind` in
`app/services/email_policy.py`, classified **required** or **optional** (with a
default). Senders ask `member_receives_email` / `recipients_for` rather than
reading preferences themselves; all 28 sender call sites also pass
`department_required_kinds(org)`, a required argument so a sender cannot
forget it.

| Required (always sent)                                                                                                                      | Optional (on by default)                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and security, election ballots, department messages, leaving the department, store receipts, skills test results, overdue equipment | Event reminders, training and certification reminders, shift notices, equipment and inventory updates, store announcements, volunteer calls, election notices, suggestion box; officer duty emails (event, scheduling, training, election administration, quartermaster, membership and store administration) |

**Order of decision for one member and one kind:** required by the system or
by the department → sent; master switch (`email_notifications`) off → not sent;
an explicit per-kind choice in `notification_preferences["email_kinds"]`; the
legacy `event_reminders` / `training_reminders` choice where the kind replaces
one; otherwise the kind's default. A malformed value counts as no choice.

- **Department-required kinds** live in
  `Organization.settings["email_policy"]["required_kinds"]`.
  `PUT /api/v1/email-templates/member-email-policy` (`settings.manage` or
  `organization.update_settings`) replaces the list, is audited, and refuses
  a kind that is not optional with 400 — the move is one-way.
- `GET /api/v1/email-templates/member-email-policy` (those two, or
  `notifications.manage`) lists every kind with its label, what it includes,
  why, and `can_edit`, plus the alerts `SmsAlert` allows to be texted. It backs
  **Member Emails & Texts** at `/communications/member-emails` (Administration →
  Forms & Comms).
- `GET /api/v1/users/me/email-choices` returns the member's switchable kinds and
  the labels of the ones always sent. Officer duty kinds are offered only to a
  member holding a management permission.
- Saving notification preferences merges `email_kinds` per kind and no longer
  discards other stored keys (it had wiped the scheduling dashboard layout).
- Two behaviours changed with the move: certification escalations no longer
  reach an opted-out member's **personal** address (officers' copies are
  unchanged), and an election report or eligibility summary an officer asks for
  is always sent while the automatic report at close follows the officer's
  choice.

## In-app notification stacks _(2026-09-28)_

The inbox (`/notifications?tab=inbox`) and the dashboard's My Updates card fold
two or more notifications sharing a raw `category` into one expandable stack
(`utils/notificationStacks.ts`, `components/NotificationStack.tsx`). Nothing is
merged on the server: each row keeps its own link and read state. Pinned and
uncategorized rows never stack; on the dashboard a stack is one row that opens
the inbox.

Two self-scoped endpoints share one definition of "stackable"
(`NotificationsService._stackable_unread_filters`: in-app, unread, categorized,
unpinned, unexpired), so a stack's badge can count pages not yet loaded and its
**Mark all read** clears them too:

```
GET    /api/v1/notifications/my/unread-by-category   # {category: unread count}
POST   /api/v1/notifications/my/read-category        # mark one category read
```

No schema change.

## Email templates: the solid-tab redesign _(2026-09-27)_

Every email renders into the solid-tab shell in `app/services/email_theme.py`,
and migration `15c5bc7700aa` reset every stored template of a shipped type to
it, keeping the old content in `email_template_backups`. Per-template
stylesheets are no longer honoured. The editor's **Previous version (before the
redesign)** panel loads a backup's wording back as an unsaved draft
(`GET /api/v1/email-templates/{id}/backups`). Test sends and previews use the
deployment's live links, the department's real contact details, the admin's own
name and today-relative dates, and the department's next event or shift where
one exists. Operator-facing detail is in
[the wiki](../wiki/Module-Communications.md#email-redesign-and-test-sends-2026-09-27),
the upgrade effect in
[UPGRADING.md](./UPGRADING.md#every-email-template-is-reset-to-the-new-design-2026-09-27),
and what the shell does not reach in
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md#email-design--what-the-solid-tab-shell-does-not-reach-2026-09-27).

## User documentation

Member/officer how-to:
[Documents, Forms & Communications → Department Messages](./training/07-documents-forms.md#department-messages).
Wiki overview: [Communications module](../wiki/Module-Communications.md).
