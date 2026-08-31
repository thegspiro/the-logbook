# Security Review — Messaging & Notifications

**Prefix:** `MSG` · **Iteration:** 25 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-31 (pass 2) · **PR:** #1907 (pass 1), pass 2 PR recorded in
`PROGRESS.md`

## Pass 1 (2026-08-26)

**Backend:** `app/api/v1/endpoints/messages.py` (461 L), `message_history.py`
(256 L), `notifications.py` (422 L), `email_templates.py` (904 L),
`app/services/messaging_service.py` (968 L), `message_delivery_service.py`
(296 L), `notifications_service.py` (518 L), `push_service.py` (287 L),
`notification_rules.py` (134 L), `notification_channels.py` (110 L),
`integration_services/notification_dispatch.py` (254 L),
`email_template_service.py` (3245 L), `email_templates_storefront.py`
(564 L), `email_footers.py` (268 L), `email_theme.py` (429 L), and the
shared send layer `email_service.py` (1738 L).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — every fix this iteration is service/schema-layer only.

---

## Scope

This is the most heavily pre-audited feature in the rotation: department
messaging, notifications, and email templates each already carry a module
audit and a 4-to-5-pass app-review (`docs/module-audit/messaging.md`,
`docs/module-audit/notifications.md`, `docs/app-review/messaging.md`,
`docs/app-review/notifications.md`, `docs/app-review/email-templates.md`).
Given that, this pass's job was to **re-verify** those findings against
current code and focus on what's grown or is new since — not re-derive from
scratch. Four parallel background agents split the surface: messaging
(`messages.py`/`message_history.py`/`messaging_service.py`/
`message_delivery_service.py`), notifications (`notifications.py`/
`notifications_service.py`/`push_service.py` plus three files with **no**
prior review at all — `notification_rules.py`, `notification_channels.py`,
`integration_services/notification_dispatch.py`), email templates
(`email_templates.py`/`email_template_service.py`/
`email_templates_storefront.py` plus two never-reviewed utility modules —
`email_footers.py`, `email_theme.py`), and the shared send layer
(`email_service.py`, reviewed on its own — the widest-blast-radius file in
scope, since every other email-producing feature in the app calls into it).

Every prior finding tracked in those five documents was re-verified as still
holding; none are re-derived here. See each agent's findings below.

## Verified good ✅ (re-confirmed, not re-derived)

- **MSG-1/MSG-2/MSG-3** (messaging): test-email HTML escaping, `_validate_targeting`
  org-scoping on create/update, and the by-design arbitrary test-email
  destination all intact.
- **Tenant isolation and audience targeting** (messaging): every by-id path
  routes through `get_message_by_id(id, org)`; the `_targeted_users` choke
  point still bounds audience resolution to the message's own org; a member
  cannot read/ack a message not addressed to them.
- **NOTIF-1/NOTIF-2/NOTIF2-3/NOTIF2-4** (notifications): the `/logs/{id}/read`
  permission gate, `safe_error_detail()` error sanitization on all six
  mutating methods, both stages of the Web Push SSRF fix (subscribe-time
  `validate_push_endpoint` + send-time `assert_outbound_url_safe`), and rule
  enum validation are all unchanged and correct.
- **SMS allowlist (Pitfall #18)**: `resolve_sms_recipients` is confirmed the
  _only_ path any notification code reaches Twilio through — no other file
  imports `SMSService` directly for a routine notification.
- **First-pass review of the three previously-uncovered notification files**
  (`notification_rules.py`, `notification_channels.py`,
  `integration_services/notification_dispatch.py`): all clean — org-scoped
  queries throughout, the "absence means on" resolver semantics are correct,
  `reminder_schedule_from` degrades safely on malformed JSON config, all
  three webhook senders (Slack/Discord/Teams) independently SSRF-guard
  themselves before `notification_dispatch.py` calls them.
- **MAIL-1/MAIL-2/MAIL-5** (email templates): the subject/text-vs-HTML escape
  boundary, both layers of the scheduled-email `template_id` org-scoping fix,
  and the fallback-render escape parity are all intact. **MAIL-3** (attachment
  magic-byte validation) is confirmed to have _improved_ since the last pass —
  `detect_mime_type` now fails closed (503) rather than silently degrading to
  extension-only when libmagic is unavailable.
- **`update_template`** (email templates) was already migrated to
  `apply_updates` by a prior, unrelated commit (`5b7f09b1`) — re-verified
  intact, no action needed here.
- **`_RAW_HTML_VARIABLES` allowlist** (email templates): every member added
  since the last pass still escapes at its own construction site — re-traced
  all of them, including the newer storefront set.
- **Credential handling, BCC-never-a-header, Cloudflare provider pinning**
  (email send layer): all verified clean — no credentials logged, `bcc_emails`
  never becomes a visible header, the Cloudflare account id is regex-validated
  before being interpolated into the request URL.

## Findings

### MSG-4 — MEDIUM — a past `scheduled_at` on an already-published message re-triggers full redelivery — ✅ FIXED

**What:** `update_message`'s reschedule guard only rejected moving an
already-published message (`scheduled_at is None`) to a **future** time. A
past or current timestamp passed the guard unmodified and was written
straight onto the row — leaving a non-null, due `scheduled_at` on a message
that had already gone out. The next `run_publish_scheduled_messages` sweep
(every 15 minutes) then treats it as newly due: clears `scheduled_at`, and
calls `MessageDeliveryService.deliver()` again — a second full fan-out
(duplicate in-app notifications with no throttle at all, a duplicate email up
to the 30/org/hour cap, and a duplicate SMS blast up to 10/org/hour if the
message is urgent), repeatable roughly every 15 minutes.
**Where:** `app/services/messaging_service.py`, `update_message`.
**Fix:** a past/current `scheduled_at` value on an already-published message
now collapses to `None` before reaching the update, mirroring
`create_message`'s own `effective_scheduled` normalization exactly — making
it a no-op instead of a re-trigger. Guard test added.

### MSG-5 — LOW — `notifications_service.update_rule` couldn't clear an optional field, and used a blind `setattr` loop — ✅ FIXED

**What:** the endpoint called `rule.model_dump(exclude_none=True)`, which
drops any field the client explicitly nulled before the service ever sees
it — indistinguishable from "field not touched" — and the service applied
the (already-filtered) payload via a raw `setattr` loop with no
`apply_updates`. A caller trying to clear `description`/`config` on a rule
would get a 200 with the old value silently retained. Low impact today: the
only production frontend caller of `PATCH /rules/{id}` is `toggleRule`,
which only ever sends `{"enabled": ...}`; the generic `updateRule()` service
method has no other UI caller. Still a live, callable admin API.
**Where:** `app/api/v1/endpoints/notifications.py` (`update_rule`),
`app/services/notifications_service.py` (`update_rule`).
**Fix:** endpoint switched to `exclude_unset=True`; service routes through
`apply_updates`. Guard tests added (clears an explicit null; rejects null
against the NOT NULL `name` column).

### MSG-6 — MEDIUM — `email_service.py`'s header construction skipped 4 of 6 header-bearing fields, and one unvalidated field already reaches it — ✅ FIXED

**What:** `_sanitize_header` (CR/LF/NUL stripping) was applied to
`Subject`/`From`/attachment filenames only. `To`, `Cc`, `Reply-To`, and
`List-Unsubscribe` were set unsanitized in both `build_message` and the
duplicated per-recipient block inside `send_email`. Today's stdlib `email`
generator happens to raise on most classic `\r\n<header>` injection
payloads — but that's incidental behavior the code never establishes or
tests for, and a **NUL byte demonstrably passes through unmodified** with no
error. A live unvalidated path already reaches one of these fields:
`MemberDropNotificationSettings.cc_emails` / `ScheduleNotificationSettings.cc_emails`
were typed `List[str]` rather than `List[EmailStr]` (every other cc/to/bcc
field that reaches this file elsewhere already uses `EmailStr`), and flow
unvalidated through `scheduling_service.py` into `send_email(cc_emails=...)`
and then straight onto `msg["Cc"]`.
**Where:** `app/services/email_service.py` (`build_message`, `send_email`),
`app/schemas/organization.py` (`MemberDropNotificationSettings.cc_emails`,
`ScheduleNotificationSettings.cc_emails`).
**Fix:** `_sanitize_header` now runs on `to_email`, every `cc_email`,
`reply_to`, and `list_unsubscribe` at both header-construction sites. Both
`cc_emails` schema fields changed to `List[EmailStr]`, closing the one
confirmed unvalidated path at its source as well.

### MSG-7 — MEDIUM — SMTP send path had no attachment size budget, and two send branches weren't exception-safe — ✅ FIXED

**What:** two related gaps in `email_service.py`'s `send_email`:

1. The SMTP attachment-loading loop had no size cap, unlike the Cloudflare
   branch (`_CLOUDFLARE_ATTACHMENT_BUDGET`, 4.5 MiB). Worse, the per-recipient
   loop serializes a full copy of the message (including base64 attachment
   data) for every recipient before any send begins — so memory cost scales
   as `attachment_size × recipient_count`, not once. A concretely reachable
   combination: `election_service.py` sends a generated pre-meeting PDF
   attachment to the full voter roster (potentially hundreds of members) via
   this exact path — ordinary usage, not abuse, that could hold tens to
   low-hundreds of MB in memory at once on a department with a few hundred
   members.
2. The multi-recipient (`elif batch:`) and Cloudflare branches had no
   `try/except`, unlike the single-recipient branch, which degrades to
   `results = [False]` on failure. `send_email`'s own docstring promises a
   `(success_count, failure_count)` tuple, never an exception — but a
   connection-level failure on either of those two branches raised straight
   out instead.
   **Where:** `app/services/email_service.py`, `send_email`.
   **Fix:** a new `_SMTP_ATTACHMENT_BUDGET` (18 MiB raw, mirroring the
   Cloudflare pattern, sized to stay under most relays' ~25 MiB accept limit
   after base64 inflation) skips attachments that would exceed it, logged the
   same way the Cloudflare path already does. Both the batch and Cloudflare
   branches now wrap their send call in the same `try/except Exception` →
   `[False] * len(...)` pattern the single-recipient branch already used.

### MSG-8 — MEDIUM-LOW — `email_theme._SHELL_COLOURWAYS` grew unbounded on every email sent (Pitfall #9) — ✅ FIXED

**What:** `_SHELL_COLOURWAYS` is a module-level dict with no cap or
eviction, populated by every call to `build_shell()`. `build_shell()` is
called in two contexts: at **import time**, once each, for the ~35 constant
default-template bodies (bounded), and at **runtime** via
`wrap_email_body()` — from roughly 20 call sites across scheduled reminders,
election notices, storefront order emails, security-event mail, and
"send test email." The only reader, `colourway_for()`, is called exactly
once at class-definition time against the fixed default set; none of the
runtime-built shells (each containing per-instance data, so effectively
unique) are ever looked up again — every runtime call was pure write-only
growth, unbounded, for the lifetime of the worker process. This is the exact
shape CLAUDE.md Pitfall #9 exists to prevent, just for a colourway lookup
cache rather than a rate-limiter or IP tracker.
**Where:** `app/services/email_theme.py` (`build_shell`, `_SHELL_COLOURWAYS`),
`app/services/email_service.py` (`wrap_email_body`).
**Fix:** `build_shell` gained a `cache: bool = True` parameter; the one
runtime caller (`wrap_email_body`) now passes `cache=False`, so per-send
traffic no longer populates a dict nothing reads back. The ~35+9 default
constants (built once at import time, all through the default `cache=True`)
are unaffected — `colourway_for()` still resolves them exactly as before.
Guard test added asserting `_SHELL_COLOURWAYS` doesn't grow on a
`cache=False` build.

## Revised after Codex review

Codex reviewed PR #1907 and caught one real regression in the MSG-6 fix
before merge:

- **P2 — the `List[EmailStr]` tightening broke reads of pre-existing
  data.** `get_organization_settings` reconstructs the entire stored
  settings blob via Pydantic on every read (including the read at the end
  of an unrelated settings update), and `scheduling` flowed through
  unvalidated `extra_settings` into that reconstruction. An org that had
  saved a malformed `cc_emails` entry back when the field was a plain
  `List[str]` would find `GET /organization/settings`, and any subsequent
  settings update touching an unrelated field, raising a `ValidationError`
  with no way to fix it through the API. Fixed by reconstructing
  `scheduling` explicitly and filtering `cc_emails` to syntactically valid
  addresses on the read path only — writes stay strictly validated via
  `OrganizationSettingsUpdate`, unchanged. Traced the equivalent
  `MemberDropNotificationSettings.cc_emails` field Codex flagged as
  carrying the same risk and confirmed it doesn't: `member_drop_notifications`
  is excluded from this reconstruction path entirely today (a separate,
  pre-existing gap unrelated to this change — its stored value is never
  read into the response model), and its only other reader accesses it as
  a raw dict, never through Pydantic. 3 regression tests added, including
  one that updates an unrelated field on an org with legacy bad data and
  asserts it no longer breaks. Full completion gate re-verified green
  (8917/8917 full suite) before the final push.

## Confirmed still open — nothing needing a product decision

Everything this pass found had a mechanical fix available and was applied.
Prior flagged-by-design items (MSG-3 test-email destination, MAIL-3 residual
attachment-format gaps, MAIL-4 arbitrary scheduled-email recipients, the
`get_inbox`/`get_logs` in-Python pagination) were all re-verified unchanged
and are not re-flagged — they remain the same deliberate product/scale
decisions the prior passes recorded. One new observation, informational
only, not re-flagged as a bug: `NotificationRuleCreate`/`Update.config` is
unbounded `Any` JSON with no size guard — low severity (same-org,
already-privileged caller only), noted for awareness rather than fixed.
`email_service.py`'s F4 finding (no SSRF-style validation on an
org-configured SMTP host) was deliberately **not** fixed: unlike the
webhook-URL pattern this codebase already applies elsewhere, a legitimate
department may intentionally point `smtp_host` at an internal on-prem mail
relay, so blocking private IPs here would be a functional regression, not a
hardening — a policy call, not a bug.

## Schema & migration notes

None — every fix is service/endpoint/schema-layer only, no model or column
changes.

## Guard tests added

- `tests/test_messaging_service.py`: `TestRescheduleGuard` — added
  `test_past_scheduled_at_on_published_message_is_normalized_not_stored`.
- `tests/test_notifications_service.py`: new `TestUpdateRule` class —
  `test_clears_an_explicit_null_field`,
  `test_rejects_null_against_not_null_name` (real `NotificationRule` ORM
  instance, not a mock, so the nullability check is actually exercised).
- `tests/test_email_theme_shell.py`: `TestBuildShell` — added
  `test_cache_false_does_not_grow_shell_colourways`.
- `tests/test_organization_settings_legacy_cc_emails.py` (new, added after
  Codex's review round) — a legacy invalid `cc_emails` entry doesn't crash
  the read, a valid list round-trips unchanged, and an unrelated settings
  update on an org with legacy bad data no longer breaks.

## Completion gate (pass 1)

| Check                                                            | Result                  |
| ---------------------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                                         | clean                   |
| `black --check` (changed files)                                  | clean                   |
| `isort --check-only` (changed files)                             | clean                   |
| `python3 scripts/validate_migrations.py --strict`                | PASSED (no migrations)  |
| backend tests, scope (messaging/notifications/email-theme files) | 855/855 passed          |
| backend tests, full suite                                        | 8917 passed, 22 skipped |

---

## Pass 2 (2026-08-31)

**Backend:** re-read `messaging_service.py` (now 1047 L, up from 968), `messages.py`
(471 L), `message_history.py` (256 L) in full — messaging's architecture changed
materially since pass 1: PR #1938 (merged 2026-08-27, after pass 1 closed)
replaced live, in-Python audience re-evaluation on every inbox read with a
durable `DepartmentMessageRecipient` table, materialized at publish time and
reconciled on an audience edit. `notifications.py`/`notifications_service.py`/
`push_service.py`/`notification_rules.py`/`notification_channels.py`/
`integration_services/notification_dispatch.py` and the whole email-templates
surface (`email_templates.py`, `email_template_service.py`, `email_service.py`,
`email_theme.py`, `email_templates_storefront.py`) confirmed unchanged since
pass 1 (`git log` shows only a no-op merge commit touching these files, diff
verified empty) — not re-read line-by-line, per the rotation's own "re-verify,
don't re-derive" rule; each pass-1 fix was instead spot-checked directly against
current code (see below).

**Frontend:** reviewed for the first time this rotation (pass 1 was backend
only). `frontend/src/modules/communications/` (routes, pages, components,
services, store — the messaging admin/inbox UI and the email-template
editor/preview/scheduler), `frontend/src/modules/notifications/`,
`frontend/src/pages/NotificationsPage.tsx`, `frontend/src/hooks/
usePushNotifications.ts`, `frontend/src/components/NotificationCard.tsx`, and
`frontend/src/services/communicationsServices.ts`.

**Migrations:** none new. `20260826_1700_d4e5f6a7b8c9_message_recipients.py`
(the `DepartmentMessageRecipient` backfill, part of PR #1938) and its
`merge_heads` companion predate this pass and were reviewed as part of the
architecture change above, not written by it.

### Pass-1 fixes re-verified intact

All eight (MSG-4 through MSG-8, plus the Codex-round `cc_emails` legacy-read
fix) re-checked directly against current source, not merely trusted:

- **MSG-4** (past `scheduled_at` on a published message collapses to `None`) —
  `messaging_service.py` `update_message`, same logic, same comment. Confirmed
  the new recipient-materialization code composes correctly with it: a still-
  _pending_ message that is explicitly un-scheduled (`scheduled_at: null`, the
  path the frontend's "clear the schedule field" flow actually uses) correctly
  sets `_published_by_update = True` and calls `materialize_recipients`; a
  _published_ message given a past `scheduled_at` still collapses to `None` and
  triggers neither a re-publish nor a duplicate `materialize_recipients` call.
- **MSG-5** (`update_rule` via `apply_updates`) — intact,
  `notifications_service.py:103-119` unchanged.
- **MSG-6** (header sanitization on `To`/`Cc`/`Reply-To`/`List-Unsubscribe`;
  `cc_emails` tightened to `List[EmailStr]`) — `_sanitize_header` still applied
  at both header-construction sites in `email_service.py`; both schema fields
  still `List[EmailStr]`.
- **MSG-7** (`_SMTP_ATTACHMENT_BUDGET`, exception-safety on all three send
  branches) — both constants (`_CLOUDFLARE_ATTACHMENT_BUDGET`,
  `_SMTP_ATTACHMENT_BUDGET`) present and used as before.
- **MSG-8** (`build_shell(cache=False)` on the runtime path) — intact in
  `email_theme.py`/`email_service.py`.
- **Codex-round fix** (`get_organization_settings` reconstructs `scheduling`
  explicitly and filters legacy-invalid `cc_emails` on read) — intact in
  `organization_service.py:326-344`.

### New architecture reviewed: durable recipient materialization (PR #1938)

The old design re-evaluated `_is_targeted` in Python against live user/role
data on every inbox read. The new design persists one
`DepartmentMessageRecipient` row per (message, targeted user) at publish time
(`materialize_recipients`) and rebuilds it when a live message's audience is
edited (`reconcile_recipients`), with `get_inbox`/`get_unread_count`/
`_visible_message_or_none` all now pure-SQL joins against that table instead of
an in-Python filter over the org's users. Reviewed against all seven checklist
dimensions:

- **Tenant isolation:** every recipient row is written with
  `organization_id = message.organization_id` at creation
  (`materialize_recipients`, `reconcile_recipients`); every read joins on both
  `organization_id` and `user_id`/`message_id`. `_targeted_users` — the single
  choke point both materialization and live delivery call — still filters
  `User.organization_id == organization_id`, so a foreign role/status/member id
  in a message's targeting still matches nobody, matching pass 1's finding.
- **Role targeting uses the right table.** The backfill migration
  (`20260826_1700_d4e5f6a7b8c9_message_recipients.py`) builds its role-match set
  from `user_positions`/`positions`, which looked like a mismatch against the
  app-level `Role`/`_validate_targeting` code at first read — until confirmed
  that `app/models/user.py:665` aliases `Role = Position` and `user_roles =
user_positions` (a documented backward-compatible rename), so the migration
  and the live code resolve against the exact same tables. Verified, not
  assumed, by reading the alias definitions directly.
- **Idempotent delivery, independently of MSG-4.** `DepartmentMessageDelivery`
  carries a `UniqueConstraint("message_id", "recipient_id", "channel")` and an
  `idempotency_key`; `_claim_delivery` catches the resulting `IntegrityError`
  and no-ops on a duplicate claim. `_create_in_app` has the equivalent
  constraint on `NotificationLog`. So even if something did re-trigger
  `MessageDeliveryService.deliver()` for an already-delivered message, no
  member would receive a second email/SMS/in-app notification — the MSG-4 fix
  turns out to be defense-in-depth on top of an idempotent delivery layer, not
  the only thing preventing duplicate sends.
- **Capacity/locking (checklist dimension 6, Pitfall #27 shape):** the
  publish-sweep (`scheduled_tasks.run_publish_scheduled_messages`) claims due
  messages with `.with_for_update(skip_locked=True)` before doing any network
  I/O, so two concurrent scheduler runs can't double-publish the same message.

### MSG-9 — LOW-MED (defense-in-depth) — `get_message_stats`'s read/ack counts weren't org-scoped — ✅ FIXED

**What:** `read_count`/`ack_count` in `get_message_stats` filtered only
`DepartmentMessageRecipient.message_id == message_id`, unlike the
`targeted_count` query three lines below it (and every other by-id query in
this file), which also filters `organization_id`.

**Where:** `app/services/messaging_service.py`, `get_message_stats`.

**Impact:** not currently exploitable — `message_id` is only ever an id this
same call already resolved via `get_message_by_id(message_id, organization_id)`
one line above, which 404s on a foreign or missing id before either count query
runs, and `DepartmentMessageRecipient` rows are always written with the same
`organization_id` as their parent message. So the missing filter could not
today return another org's count. Fixed anyway, for the same reason the
checklist calls this dimension out explicitly: a by-id count that only filters
by `message_id` is one refactor away (e.g. a future caller that passes a raw
client id without first resolving it through `get_message_by_id`) from becoming
a real cross-tenant read, and the fix costs nothing.

**Fix:** added `DepartmentMessageRecipient.organization_id == organization_id`
to both queries, matching `targeted_count`. Guard test added
(`TestGetMessageStats::test_read_and_ack_counts_are_org_scoped`) that inspects
the compiled `WHERE` clause of all three count queries and fails if
`organization_id` is dropped from any of them — verified to fail against the
pre-fix code (reintroducing the bug locally and re-running the test reproduces
the failure), then reverted to the fix.

### Doc correction — MAIL-3 (attachment magic-byte validation) was already fixed, `docs/app-review/email-templates.md` still said OPEN

Not a code finding — `upload_attachment` (`email_templates.py:595-634`) already
calls `detect_mime_type` on uploaded bytes against an explicit
`ALLOWED_EMAIL_MIME_TYPES` allowlist and fails closed (503) when libmagic is
unavailable, matching what pass 1's "Verified good" section already noted
("MAIL-3 ... confirmed to have improved since the last pass"). The app-review
doc's own MAIL-3 entry, however, still read "OPEN" with the old
extension-only description — pass 1 verified the code but never corrected the
doc it was re-verifying against. Corrected `docs/app-review/email-templates.md`
(the MAIL-3 entry, its pass-2 summary line, and its "Future development" list)
to point at the current code and stop presenting a closed gap as open.

### Confirmed still open — no new product-decision items from re-verification

MSG-3 (test-email to an arbitrary address, by design), MAIL-4 (arbitrary
scheduled-email recipients, cross-referenced to CS-9), and the informational
`NotificationRuleCreate.config` unbounded-JSON note are all re-verified
unchanged from pass 1 and not re-flagged. `email_service.py`'s F4 (no SSRF
guard on an org-configured SMTP host) remains a deliberate, unchanged policy
call for the same reason pass 1 recorded it.

### New flagged item — see `docs/KNOWN_LIMITATIONS.md`

**MSG-9** in this doc is the org-scoping defense-in-depth fix above (FIXED). A
second, unrelated finding from this pass needed a product decision rather than
a mechanical fix and is recorded only in `docs/KNOWN_LIMITATIONS.md` to avoid a
duplicate id: **narrowing a published message's audience
(`reconcile_recipients`) hard-deletes the `DepartmentMessageRecipient` row —
including `read_at`/`acknowledged_at` — for any member the new audience no
longer includes**, silently destroying acknowledgment history the same file's
own `delete_message` docstring calls "compliance evidence." Not cross-tenant,
not fixed here (fixing it changes inbox-visibility semantics, since visibility
is currently derived from the same row the fix would need to keep). See
`docs/KNOWN_LIMITATIONS.md` → "MSG-9 — Narrowing a Department Message's
Audience Can Destroy Read/Acknowledgment History" for the full write-up and
options.

### Frontend — verified good ✅

- **No `window.confirm`/`alert`/`prompt`** anywhere in `modules/communications`,
  `modules/notifications`, `pages/NotificationsPage.tsx`, or
  `services/communicationsServices.ts` — deletes (message, attachment) go
  through the app's `ConfirmDialog`/pending-item state pattern.
- **No `dangerouslySetInnerHTML`.** Department-message bodies render through
  `LinkifiedText` (`components/ux/LinkifiedText.tsx`), which is explicitly
  built to emit only React text nodes plus `<a>` elements for `https?://` URL
  matches (regex requires the scheme, so a `javascript:` URL can never become
  an `href`) — verified by reading the component, not just grepping for the
  absence of the dangerous prop.
- **Email template preview is XSS-isolated.** `TemplatePreview.tsx` renders
  arbitrary template HTML into an `<iframe sandbox="allow-same-origin">` with
  no `allow-scripts` — the sandbox attribute blocks script execution
  regardless of what the template body contains, so `allow-same-origin` alone
  cannot be used to reach the parent document.
- **No direct `fetch(`** in the reviewed module/service files — both
  `communicationsServices.ts` and the module code import the shared
  `apiClient` (`withCredentials: true` + CSRF interceptor), not a bare axios or
  fetch instance.
- **No banned date-formatting methods** (`.toLocaleString`/`.toLocaleDateString`/
  `.toLocaleTimeString`/`date-fns`) — `MessageComposeForm.tsx` uses
  `formatForDateTimeInput`/`localToUTC` from `utils/dateFormatting.ts` with an
  explicit `useTimezone()` value throughout.
- **Update payload correctness (Pitfall #1):** `MessageComposeForm.tsx`'s edit
  path sends explicit `null` for `expires_at`/`scheduled_at` and for the
  now-irrelevant audience lists when the target type changes, matching the
  backend's `exclude_unset` + explicit-null-clears-the-field contract; the
  create path omits unset optional keys instead of sending `undefined`,
  matching `exactOptionalPropertyTypes`.
- **`UNCACHEABLE_PREFIXES` coverage confirmed current:** `/messages` (no
  trailing slash, so it covers `/messages/inbox`, `/messages/{id}/stats`,
  `/messages/{id}/acknowledgments`, etc.), `/message-history`,
  `/notifications/my`, `/notifications/logs`, and
  `/email-templates/scheduled` are all present in
  `frontend/src/utils/apiCache.ts`.
- **Push subscription flow** (`usePushNotifications.ts`) has no client-side
  security issue: VAPID key handling is standard base64url decoding, the
  subscribe/unsubscribe calls go through the shared `apiClient`, and server-
  side endpoint validation (`validate_push_endpoint` at subscribe time,
  `assert_outbound_url_safe` at send time) was already re-verified intact on
  the backend side above.
- **Route permission gating matches backend gates:** `/communications/
email-templates` requires `settings.manage` (13/13 backend endpoints in
  `email_templates.py` gated on `settings.manage`/`organization.update_settings`
  — enumerated, not sampled); `/communications/messages` requires
  `notifications.manage` (all 10 backend admin routes in `messages.py` match);
  `/messages` and `/messages/:messageId` (inbox, detail) require only sign-in,
  matching the backend's self-scoped `get_current_user` + recipient-row-join
  visibility gate rather than a permission string.

## Guard tests added (pass 2)

- `tests/test_messaging_service.py`: new `TestGetMessageStats` class —
  `test_read_and_ack_counts_are_org_scoped` — asserts `organization_id` appears
  in the compiled `WHERE` clause of all three count queries `get_message_stats`
  issues. Verified to fail on reintroduction (reproduced locally, restored).

## Completion gate (pass 2)

| Check                                                      | Result                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                              | clean                                                                       |
| `black --check app/ tests/ alembic/`                       | clean — 1337 files unchanged                                                |
| `isort --check-only app/ tests/ alembic/` (CI's 8.0.1 pin) | clean                                                                       |
| `python3 scripts/validate_migrations.py --strict`          | PASSED — 394 revisions, single head                                         |
| backend tests, scope (messaging/notifications/email files) | 1100 passed, 1 skipped                                                      |
| backend tests, full suite                                  | 9288 passed, 22 skipped, 0 failed                                           |
| `npx tsc --noEmit` (frontend)                              | 0 errors                                                                    |
| `npx eslint .` (frontend)                                  | 0 errors, 8 pre-existing warnings (max-warnings 10; none in reviewed files) |

No frontend file was modified this pass (findings there were "verified good" —
no fix required), so `tsc`/`eslint` establish that the backend changes did not
regress the frontend build, not that new frontend code was checked.
