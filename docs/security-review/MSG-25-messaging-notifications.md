# Security Review — Messaging & Notifications

**Prefix:** `MSG` · **Iteration:** 25 · **Reviewed:** 2026-08-26 · **PR:** #1907

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

## Completion gate

| Check                                                            | Result                  |
| ---------------------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                                         | clean                   |
| `black --check` (changed files)                                  | clean                   |
| `isort --check-only` (changed files)                             | clean                   |
| `python3 scripts/validate_migrations.py --strict`                | PASSED (no migrations)  |
| backend tests, scope (messaging/notifications/email-theme files) | 855/855 passed          |
| backend tests, full suite                                        | 8914 passed, 22 skipped |
