# Security Review — Messaging & Notifications

**Prefix:** `MSG` · **Iteration:** 25 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-31 (pass 2), 2026-09-06 (pass 3) · **PR:** #1907 (pass 1), pass 2 PR
recorded in `PROGRESS.md`, pass 3 PR TBD

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

**Migrations:** no net change — `20260826_1700_d4e5f6a7b8c9_message_recipients.py`
(the `DepartmentMessageRecipient` backfill, part of PR #1938) and its
`merge_heads` companion predate this pass and were reviewed as part of the
architecture change above. An initial reading flagged a real-looking defect
(**MSG-11**, below) and added a guard; a follow-up investigation on the same
PR (prompted by Codex) found the guard unnecessary and reverted it. The test
suite gained a general-purpose ratchet (`_find_autoload_offenders`) and a
correctness fix (`_tables_created_by_migrations` now recognizes
`op.rename_table`) either way.

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

### MSG-11 — investigated, **not reproducible** — the recipient-materialization backfill migration's `positions`/`user_positions` reflection is unguarded, but both tables are guaranteed present when it runs

**Original claim:** `20260826_1700_d4e5f6a7b8c9_message_recipients.py`'s
backfill step reflects `positions`/`user_positions` with raw SQLAlchemy Core
(`sa.Table(name, meta, autoload_with=bind)`) and, at the time this was
opened as a separate follow-up PR (#2083), had no existence guard. The
reasoning pattern-matched CLAUDE.md Pitfall #26 (`positions` is one of that
section's own listed examples of a create_all-only table) and concluded
`alembic upgrade head` against a fresh, empty database would raise
`NoSuchTableError` on this reflection and fail the whole chain — the same
class of bug that broke `event_requests` migrations on 2026-08-24.

**Why it doesn't reproduce:** `positions`/`user_positions` are _not_
create_all-only. `20260805_0008_rename_roles_to_positions.py` renames
`roles`/`user_roles` — created outright by `op.create_table` in
`20260118_0001_initial_schema.py` — to `positions`/`user_positions` on the
fresh-chain path (its "Shape 1"). `20260805_0008` is a required
upgrade-path ancestor of this migration (confirmed by walking the revision
DAG with `ScriptDirectory.walk_revisions`, not just by date order), so on
_every_ valid `alembic upgrade head` run, `positions`/`user_positions` exist
by the time this migration's reflection runs — the rename has always
already happened.

**Verified empirically, not just by re-reading the code:** created a fresh
MySQL database with the same collation CI/production use
(`utf8mb4_unicode_ci` — an earlier attempt with the server default
`utf8mb4_general_ci` failed on an unrelated, pre-existing FK-collation issue
in an unrelated early migration, which is why this needs stating explicitly)
and ran `alembic upgrade head` against it from `base`. The full 394-revision
chain, including this migration, completed with no error; `positions` and
`user_positions` were present (and `roles`/`user_roles` were not, confirming
the rename had run).

**Root cause of the false positive:** `test_migration_create_all_tables.py`'s
`_tables_created_by_migrations` (used to compute the create_all-only set
these checks apply to) only recognized `op.create_table`, not
`op.rename_table` destinations — so it already misclassified
`positions`/`user_positions` as create_all-only before this pass, even
though the pre-existing `op.*`-based detector never had occasion to flag it
(nothing else in the chain touches those tables via `op.add_column` et al.
without a guard). **Fixed:** `_tables_created_by_migrations` now also counts
`op.rename_table(old, new)` destinations. `positions`/`user_positions`
(and, incidentally, `minutes_action_items`/`meeting_action_items` via
`20260312_0200_rename_meeting_action_items_table.py`'s round trip) now
correctly count as migration-created.

**Disposition:** the existence guard that had been added to
`20260826_1700_d4e5f6a7b8c9_message_recipients.py` was **reverted**, for two
reasons beyond simply being unneeded: (1) its early-return path was never
exercised on any valid upgrade path, so it was untested dead code load-bearing
on an incorrect belief; (2) had it ever been reached — e.g., on a database
manually missing one of the two tables — it would have silently stamped the
migration complete with **zero** recipient rows created, which on an
installation that already had real `department_messages`/user data would
have permanently dropped existing messages from every member's inbox (inbox
visibility now derives from the `DepartmentMessageRecipient` join). Silently
skipping is only correct for a genuinely empty database, and this migration
never runs against one that isn't already guaranteed to have both tables.

Kept, because it has independent value as a ratchet against a _real_ future
instance of this shape: the new `_find_autoload_offenders`/`_AUTOLOAD_TABLE`
detector for unguarded `sa.Table(..., autoload_with=...)` reflections of a
genuinely create_all-only table (which `_TABLE_FIRST`/`_TABLE_SECOND` cannot
see, since those only recognize `op.*` calls). With
`_tables_created_by_migrations` fixed, it now correctly reports zero
offenders for the current migration chain.

Two further rounds of Codex review on this same PR caught real problems in
the new detector code itself, both fixed:

- **The `_AUTOLOAD_TABLE` regex only matched one exact spelling**
  (`sa.Table("t", meta, autoload_with=...)`), missing a bare (directly
  imported) `Table(...)`, reordered/extra arguments before `autoload_with`,
  and an argument containing its own call (`sa.MetaData()`) — any of which
  would let a genuinely unguarded reflection pass the ratchet undetected.
  Broadened to tolerate an optional module-qualifier, one level of nested
  parens, and argument order, with pinning tests for each new shape plus a
  negative test (`MyTable(...)` must not match).
- **`_tables_created_by_migrations`'s new `op.rename_table` recognition
  scanned the whole file, not just `upgrade()`** — so a rename destination
  that exists only in `downgrade()` (undoing an `upgrade()`-side rename)
  would be wrongly credited as migration-created, which is the dangerous
  direction: it removes a genuinely create_all-only table from that set and
  lets an unguarded `upgrade()`-time reflection of it slip past this exact
  ratchet. `20260312_0200_rename_meeting_action_items_table.py`'s
  `downgrade()` renames `minutes_action_items` back to
  `meeting_action_items` for exactly this shape — harmless only by
  coincidence, since that table is separately created by `op.create_table`
  too. Fixed by adding `_upgrade_body`, which extracts and scopes both the
  `create_table` and `rename_table` scans to `upgrade()` only. (Its first
  version, matching only an unannotated `def upgrade():`, matched nothing
  at all against this codebase's `def upgrade() -> None:` convention and
  was caught before shipping by comparing its output against the unscoped
  scan on the real chain — not by review, by actually running it.)

Kept the `_returns_early_when_a_model_only_table_is_absent` exemption and
`_guarded_tables` themselves file-wide/unscoped, per the "not addressed"
paragraph below — narrowing the classification of what counts as
"created" is safe to get precise; narrowing what counts as "guarded"
without the same rigor risks the opposite failure mode (a real offender
going undetected), which is exactly the class of mistake this scoping fix
was written to prevent elsewhere in the same file.

**Not addressed:** Codex separately noted (on PR #2083, before this
correction) that `_guarded_tables`'s guard-detection scans a migration's
whole source text rather than being scoped to `upgrade()`, so a guard that
only appears in `downgrade()` (or after the reflection it should protect)
would be misread as covering it. This is a pre-existing limitation of the
whole detector (predates this PR, applies equally to the original
`op.*`-based check), not something newly introduced here, and a proper fix
needs function/statement-order-aware analysis rather than the current
regex-over-whole-file approach — out of scope for this pass. No migration in
the current chain is known to rely on this gap for a false "clean" result;
flagged here so a future pass doesn't have to rediscover it.

### MSG-12 — LOW-MED — a failed, stranded, or throttled channel delivery is never retried — FLAGGED (needs a product decision)

**What:** `_claim_delivery` commits a `DepartmentMessageDelivery` row with
`status="pending"` _before_ the actual `send_email`/`send_bulk_sms` call —
this is what makes a raced or retried `deliver()` call safe (a second
attempt hits the row's unique `(message_id, recipient_id, channel)`
constraint and skips, the mechanism the "New architecture reviewed" section
above documents as defense-in-depth on top of MSG-4). That same constraint
means no outcome for a claimed row is ever revisited, and a department
message is published exactly once — no future `deliver()` call comes back
around. Two rounds of Codex review on this same PR each broadened what
this finding originally reported as a crash-only scenario; there are three
distinct ways a recipient ends up missing a channel:

- **Stranded `pending`** (the originally reported scenario) — if the
  process is killed, OOM-killed, or loses its DB connection between
  `_claim_delivery`'s commit and `_finish_delivery`'s follow-up commit, the
  row is left `status="pending"` permanently. Requires a crash in an exact
  window.
- **`failed`, from an ordinary provider error — no crash needed.**
  `_finish_delivery(attempt, error)` (line 126) sets
  `status = "failed" if error else "delivered"` whenever the provider
  raises, or reports zero successes (`EmailService.send_email` returns
  `(sent, failed)`; `SMSService.send_bulk_sms` returns a count). This is
  `_finish_delivery`'s ordinary, intended behavior — hit by a transient
  SMTP outage, a rate limit, or one rejected recipient, not an edge case.
  `_claim_delivery` rejects a retry attempt on the unique constraint
  regardless of the existing row's status, so a `failed` row is exactly as
  permanently un-retriable as a stranded `pending` one.
- **Throttled — no row at all.** `_send_email`/`_send_sms` (lines
  231–303/304+) each check `is_rate_limited` against the org's per-hour
  escalation cap — the 30/org/hour email, 10/org/hour SMS limits MSG-4's
  own write-up references — **before** the `for user in ... recipients`
  loop that calls `_claim_delivery`. On a throttled org, the method
  returns at that check, logging a warning, having claimed zero
  recipients. There is no `DepartmentMessageDelivery` row for any of them
  to later find or retry — the recommendation below, as originally
  written, only sweeps that table, so it cannot recover this path at all.
  **Where:** `app/services/message_delivery_service.py`
  (`_claim_delivery`/`_finish_delivery` lines 87–129, `_send_email`, `_send_sms`).
  **Failure scenario:** (a) a background worker is killed at the exact
  moment between `_claim_delivery`'s commit and the provider call returning;
  (b) the email or SMS provider has a routine transient failure during the
  one delivery attempt a department message ever gets; or (c) the org's
  message volume trips the per-hour escalation cap for that channel. Any of
  the three leaves that recipient's copy of that department message
  permanently un-sent on that channel — worst case, email, the channel this
  feature's own module docstring calls "the record of notice" — with no
  automatic recovery, and (c) leaves no error surfaced anywhere beyond a log
  line. The blast radius is one recipient/one channel/one message for (a)
  and (b), but a whole channel's worth of recipients at once for (c); (b)
  and (c) both need no crash.
  **Why flagged, not fixed:** correcting this needs a policy decision this
  pass should not make unilaterally, and the decision has to cover all
  three paths together — a fix scoped to `DepartmentMessageDelivery` rows
  alone leaves the throttled path, which creates no row, completely
  unaddressed. Open questions: what counts as eligible for retry (any
  `failed`/stale-`pending` row? a cap on attempts?), whether a throttled
  batch should be recorded somewhere retriable rather than only logged,
  whether retry is automatic via a new scheduled task or surfaced to an
  admin instead, and — since a crash could land either before or after the
  provider actually accepted the send — whether the department would rather
  risk an occasional duplicate delivery (retry unconditionally) or an
  occasional silent miss (leave it and alert). Mirrored into
  `docs/KNOWN_LIMITATIONS.md`.
  **Recommendation:** a scheduled task (mirroring
  `run_publish_scheduled_messages`'s cadence) that finds
  `DepartmentMessageDelivery` rows with `status="failed"` or `status="pending"`
  with `attempted_at` older than some threshold, and either re-attempts the
  send or flips them to a distinct `"orphaned"` status an admin view can
  surface — plus a separate mechanism for the throttled path, since it
  creates no row for that sweep to find; recording a throttled batch
  somewhere retriable is itself part of the open product decision, not a
  settled design. Left for a future iteration with product input on which
  tradeoff (silently-never-sent vs. possibly-duplicate) the department would
  prefer.

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

### New flagged items — see `docs/KNOWN_LIMITATIONS.md`

**MSG-9** in this doc is the org-scoping defense-in-depth fix above (FIXED).
**MSG-12** (above) is also flagged, not fixed, and mirrored into
`docs/KNOWN_LIMITATIONS.md` in its own right. **MSG-10**, a third and
unrelated finding from this pass, needed a product decision rather than a
mechanical fix and is recorded only in
`docs/KNOWN_LIMITATIONS.md`: **narrowing a published message's audience
(`reconcile_recipients`) hard-deletes the `DepartmentMessageRecipient` row —
including `read_at`/`acknowledged_at` — for any member the new audience no
longer includes**, erasing that member's row in `get_acknowledgment_report`
and their inbox visibility for the message. This reliably erases the
_report's_ record, which the same file's `delete_message` docstring calls
"compliance evidence" and specifically avoids losing on message deletion.
Whether it also erases the underlying evidence depends on a second fact:
`acknowledge_message` (`messages.py:425-436`) writes an independent,
tamper-evident `message_acknowledged` audit-log entry at acknowledgment time
that `reconcile_recipients` never touches — but that write is best-effort,
not guaranteed. `AuditLogger.create_log_entry` (`app/core/audit.py:265-270`)
is deliberately fail-open (catches any exception, logs it, returns `None`
rather than raising), and `acknowledge_message` never checks the return
value, so a silently-failed audit write leaves no trace for
`reconcile_recipients` to later strand. Not cross-tenant, not fixed here
(fixing it changes
inbox-visibility semantics, since visibility is currently derived from the
same row the fix would need to keep). See `docs/KNOWN_LIMITATIONS.md` →
"MSG-10 — Narrowing a Department Message's Audience Erases the Acknowledgment
Report's Record; an Independent Audit Entry May Survive" for the full
write-up and options.

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
- `backend/tests/test_migration_create_all_tables.py`: a second detector,
  `_find_autoload_offenders`/`_AUTOLOAD_TABLE`, extending the file's
  existing create_all-only-table ratchet to `sa.Table(...,
autoload_with=...)` reflection — the shape the original `op.*`-only
  detector could not see — plus the real-migrations assertion
  (`test_migrations_reflecting_a_create_all_table_guard_on_its_existence`)
  and two synthetic pinning tests (`test_an_unguarded_reflection_is_flagged`,
  `test_a_guarded_reflection_is_not_flagged`) that exercise the detector
  directly rather than through the real migration chain. Kept as a ratchet
  against a real future instance of this shape even though the migration
  that motivated it (MSG-11, below) turned out not to need a guard.
  `_tables_created_by_migrations` was also fixed, independently of the
  above, to recognize `op.rename_table` destinations — see MSG-11.

## Completion gate (pass 2)

Re-run in full against current `main` (which already includes PR #2081's
MSG-9 fix) after adding the MSG-11/MSG-12 follow-up — two concurrent
security-review sessions independently reached feature 25, pass 2, at the
same time; see `PROGRESS.md`'s log for the full sequence. Re-run again after
investigating Codex's review of this follow-up PR, which found MSG-11 to be
a false positive (see MSG-11 above) — that pass reverted the migration guard,
fixed `_tables_created_by_migrations`, and re-verified with a real fresh-
database `alembic upgrade head` run, not just the static gate below. The
table covers the final change set: the MSG-9 org-scoping fix (already
merged), the `test_migration_create_all_tables.py` detector fix/addition,
and both sets of guard tests.

| Check                                                      | Result                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                              | clean                                                     |
| `black --check app/ tests/ alembic/`                       | clean — 1337 files unchanged                              |
| `isort --check-only app/ tests/ alembic/` (CI's 8.0.1 pin) | clean                                                     |
| `python3 scripts/validate_migrations.py --strict`          | PASSED — 394 revisions, single head                       |
| backend tests, scope (messaging/notifications/email files) | 1036 passed, 1 skipped                                    |
| backend tests, full suite                                  | 9291 passed, 22 skipped, 0 failed                         |
| `npx tsc --noEmit` (frontend)                              | 0 errors                                                  |
| `npx eslint .` (frontend)                                  | 0 errors, 8 pre-existing warnings (none in touched files) |

No frontend file was modified by any part of this pass (MSG-9's fix is a
backend query filter; MSG-11's investigation touched only a migration file
and a backend test file), so `tsc`/`eslint` establish that no backend
change regressed the frontend build.

---

## Pass 3 (2026-09-06)

**Backend:** re-read, fresh and in full, via two parallel background agents:
`messages.py`/`message_history.py`/`messaging_service.py`/`notifications.py`/
`notifications_service.py`/`push_service.py`/`notification_rules.py`/
`notification_channels.py`/`integration_services/notification_dispatch.py`
(agent 1), and `email_templates.py`/`email_template_service.py`/
`email_templates_storefront.py`/`email_footers.py`/`email_theme.py`/
`email_service.py` (agent 2). `message_delivery_service.py` and
`scheduled_tasks.py`'s messaging-related tasks were read directly, not
delegated, after their line counts showed the largest growth since pass 2
(296 → 547 lines).
**Frontend:** not re-read this pass — nothing in this pass's backend
findings touches a frontend contract, and pass 2 already reviewed the
frontend module in full.
**Migrations:** none added this pass. Two migrations landed on `main`
since pass 2 that this pass verified rather than authored:
`20260901_1000_b2c9d4e6f813` (adds `DepartmentMessageRecipient.revoked_at`)
and its merge-heads companion — see MSG-10 below.

### Doc correction — MSG-10 was already fixed; `KNOWN_LIMITATIONS.md` still said open

Not a code finding. `reconcile_recipients` (`messaging_service.py:602-657`)
no longer hard-deletes a `DepartmentMessageRecipient` row that carries
`read_at`/`acknowledged_at` evidence when a message's audience narrows —
current code prunes only rows with **neither** timestamp set, and soft-
revokes the rest (`row.revoked_at = now`), restoring access
(`revoked_at = None`) if the member re-enters the audience later. This is
exactly option (b) from MSG-10's own "closing this needs a product
decision" list. `revoked_at.is_(None)` is checked consistently everywhere
audience-derived visibility or counts are read: `get_inbox` (:387),
`get_unread_count` (:555), `_visible_message_or_none` (:767), and all
three `get_message_stats` counts (:991/999/1007);
`get_acknowledgment_report` (:1054) surfaces a revoked-but-evidenced
member as `removed` rather than silently dropping them from the
denominator. Backed by a real migration
(`20260901_1000_b2c9d4e6f813_recipient_revoked_at.py`,
`nullable=True` — correct, no `ondelete` involved) and covered by tests in
`test_messaging_service.py`. Whoever shipped this did not update
`docs/KNOWN_LIMITATIONS.md`, which still described the pre-fix hard-delete
behavior in detail — removed that entry (rather than left contradicting
current code) and added a `CHANGELOG.md` entry under `[Unreleased]`, since
this is a genuinely user-visible fix that had never been announced.

### MSG-13 — LOW-MED — unbounded push-subscription registration — ✅ FIXED

**What:** `PushService.subscribe()` deduped only on exact `endpoint_hash`
and had no cap on how many distinct subscriptions one user could register.
`send_to_user()` then loops over **every** stored subscription for that
user on **every** notification, dispatching each via
`asyncio.to_thread(self._send_one, ...)` — a real blocking network call
per row. `validate_push_endpoint`'s allowlist restricts the _hostname_ to
~7 real vendor push services but does nothing to bound _how many_ endpoints
on those hosts one authenticated caller can register.
**Where:** `app/services/push_service.py`, `subscribe`.
**Failure scenario:** an authenticated member scripts a few thousand
`subscribe` calls with distinct fake paths on an allowlisted host (each
hashes differently, so none dedupe); every future notification meant for
that member becomes a several-thousand-fold fan-out of thread-pool work
and outbound HTTP attempts — a self-inflicted but real resource-exhaustion
vector shared with the rest of the app's thread pool, not scoped to that
one member's own notifications.
**Fix:** a generous `_MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20` cap, checked
before creating a **new** row (re-pointing an existing endpoint hash on
refresh is exempt, so a member already at the cap can still refresh a
device they already have). Raises `ValueError` → 400 via the endpoint's
existing `except ValueError` handler, no new error-handling path needed.
**Guard tests:** `test_push_service.py::TestSubscribe::
test_a_user_cannot_register_unbounded_devices`,
`test_resubscribing_an_existing_endpoint_is_not_blocked_by_the_cap`. Logic
verified with a mocked session (this sandbox cannot build the optional
`pywebpush`/`http-ece` wheel, the same pre-existing limitation the test
file's own docstring documents) — confirmed the count query raises at
exactly the cap and not before via a scripted repro against the real
`subscribe()` method; the real integration tests will exercise it in CI
where the dependency is installed.

**Two rounds of Codex review on this fix's own PR (#2305) each found a
real gap, both fixed:**

- **Round 1, P2:** reassigning a device currently owned by a _different_
  user hit the `if existing:` branch, which re-pointed the row and
  returned before the cap check ever ran — two accounts could trade one
  endpoint back and forth to grow one of them past the limit with no race
  needed. Fixed by exempting only a genuine self-refresh
  (`existing.user_id == str(user_id)`) from the cap; reassigning someone
  else's device now goes through the same locked count-and-cap check as a
  brand-new subscription. Guard test:
  `test_reassigning_someone_elses_device_still_respects_the_cap`.
- **Round 1, P1:** the count-then-insert was a plain check-then-act race —
  two concurrent `subscribe()` calls for the same user could each observe
  a count below the cap and both commit. Fixed by locking the target
  user's row first, then making the count itself a locking read too
  (`.with_for_update()` on both) — under REPEATABLE READ, locking the
  parent row alone does not refresh the snapshot the request's transaction
  already took when `current_user` was loaded upstream (same shape as
  CLAUDE.md pitfall #27's "make the count itself a locking read" lesson).
- **Round 2, P2:** the round-1 fix introduced a new deadlock. Two callers
  swapping endpoints with each other at the same moment (A claims B's
  device, B claims A's) would each lock their own target user first and
  then block on the other's existing subscription row at UPDATE time — a
  textbook AB/BA cycle that MySQL's deadlock detector resolves by aborting
  one side with an unhandled error (a 500 at `/push/subscribe`). Fixed by
  locking every user affected by the call — the target, and (when
  reassigning) the endpoint's previous owner — in a fixed order sorted by
  id, rather than in whichever order each side of a swap happens to reach
  them. Guard test:
  `TestConcurrentEndpointSwapDoesNotDeadlock::test_two_users_swapping_endpoints_at_once_both_succeed`,
  using two real independent sessions and `asyncio.gather` against a live
  database — a mocked session cannot reproduce a real InnoDB
  deadlock-detector outcome, so this one could not be verified with the
  mocked-logic technique the other guard tests use; it will run for real
  in CI where `pywebpush` is installed.
- **Round 2, P1 (disputed, not applied):** Codex separately flagged this
  same completion-gate table's "3 pre-existing warnings (none in touched
  files)" line as continuing past a known failure. Checked directly:
  `frontend/package.json`'s `lint` script is `eslint --max-warnings 10` —
  the project's own configured gate already tolerates up to 10 warnings —
  and re-running `npm run lint` returns exit code 0 with exactly this
  count. The 3 warnings are `testing-library/no-node-access` in
  `src/pages/scheduling/ShiftDetailPanel.test.tsx`, a file this PR's diff
  does not touch. Replied on the PR with this evidence and left the
  thread open for a maintainer call rather than resolving it myself, since
  it is a policy-scope question (whether to tighten `max-warnings`
  repo-wide) rather than a defect in this change.
- **Round 3, P1:** the self-refresh fast path decided "the caller already
  owns this endpoint" from the same _plain_ read used to guess who to
  lock — itself stale for the reason round 1's own fix already
  established (the request's transaction snapshot predates `subscribe()`
  being called). If a transfer away from the endpoint committed in
  between, the refresh would still overwrite the row's encryption keys
  with its own while leaving `user_id` pointing at the new owner: a push
  meant for the new owner would then be encrypted with keys only the
  _old_ owner's device holds the matching private key for, and delivered
  there instead. Fixed by making the endpoint lookup itself a locking
  read before the self-refresh decision is made. Guard test:
  `TestConcurrentRefreshDuringTransferStaysConsistent::
test_a_refresh_racing_a_transfer_never_splits_owner_from_keys`.
- **CI itself then caught a real deadlock — not from Codex, from a live
  MariaDB run of round 2's own guard test.** `Backend Integration Tests
(MariaDB 10.11)` failed on the round-3 commit with
  `OperationalError: (1213, 'Deadlock found when trying to get lock')`
  from `test_two_users_swapping_endpoints_at_once_both_succeed` — the
  exact scenario round 2 was supposed to have closed. Root cause: round
  3's fix took its endpoint-row lock _before_ round 2's sorted user-row
  locks, reintroducing the identical AB/BA cycle round 2 closed, just
  relocated onto the endpoint rows instead of the user rows. Fixed by
  reordering: the unlocked guess of the endpoint's current owner now only
  decides which `User` rows to lock (never anything about the endpoint
  itself); those locks are still acquired sorted, exactly as round 2
  established; only after they're held does the request take its one
  locking read of the specific endpoint row. No test changes were
  needed — both existing guard tests already asserted exactly the
  properties this reordering restores. This is the one guard test in
  this PR that this sandbox's inability to build `pywebpush`/`http-ece`
  could not substitute a mocked check for: only a real, live database run
  reproduces an actual InnoDB/MariaDB deadlock-detector outcome, and CI —
  not local verification — is what caught this.

### MSG-14 — LOW — `build_shell`'s `subtitle` was not HTML-escaped — ✅ FIXED

**What:** `build_shell` (`email_theme.py`) escapes `title` — or rather,
relies on its one non-template caller (`wrap_email_body`) to escape it
before calling in — but concatenated `subtitle` straight into the email
header markup with no escaping at all, at either layer.
**Where:** `app/services/email_theme.py`, `build_shell`.
**Impact:** not currently exploitable — every one of the ~19 existing
`subtitle=` call sites (across `email_template_service.py`'s default
templates and `email_templates_storefront.py`) passes either a static
literal or a `{{token}}` placeholder with no HTML metacharacters, and
`wrap_email_body`'s own callers never pass a non-empty `subtitle` with
runtime data today. Fixed anyway: the escaping contract between `title`
and `subtitle` was inconsistent, and a future caller passing user-editable
text as a subtitle (an event name, an order note) would reintroduce HTML
injection into outgoing mail with nothing to catch it.
**Fix:** `subtitle` is now escaped inside `build_shell` itself — the one
place every caller goes through — rather than pushing the obligation onto
each call site the way `title` does.
**Guard test:** `test_email_theme_shell.py::TestBuildShell::
test_subtitle_is_escaped`. Verified to fail against the reverted (unfixed)
code and pass after.

### MSG-15 — LOW — flagged, not fixed — Web Push's send-time DNS-rebinding pin is skipped outside `ENVIRONMENT in ("production", "staging")`

**What:** `PushService._send_one` only builds the IP-pinned session that
closes the check/use DNS-rebinding window
(`_pinned_session`/`_resolve_public_address`) when
`settings.ENVIRONMENT in ("production", "staging")`. `ENVIRONMENT` is a
bare, unvalidated `str` (`core/config.py:32`, default `"development"`,
no enum), so a real deployment left at the default or set to any other
value never gets the send-time pin — only the one-time, allowlist-based
`validate_push_endpoint` check at subscribe time applies.
**Where:** `app/services/push_service.py`, `_send_one`.
**Why flagged, not fixed:** the gate is not an oversight — it exists so
`tests/test_push_service.py`'s real local HTTP server (standing in for a
browser push service, deliberately _not_ mocked so encryption/VAPID/DB
constraints are genuinely exercised) can be reached at all: that server is
`http://127.0.0.1:<port>`, which `validate_push_endpoint`'s HTTPS-only,
vendor-hostname-only allowlist would reject outright if pinning/validation
ran unconditionally, and `PushService.subscribe()` itself does not call
`validate_push_endpoint` (by design — that check lives at the API
boundary), so the test suite subscribes such endpoints directly. The same
`ENVIRONMENT in ("production", "staging")` idiom is also the codebase's
established pattern for other prod-only checks (`core/config.py:460`), so
narrowly special-casing push here would be inconsistent with it. Closing
this properly needs either a test-infrastructure change (so the local test
server does not depend on skipping validation) or a more precise signal
than `ENVIRONMENT` for "is this deployment internet-facing" — a design
decision, not a one-line fix, and the practical exposure today is narrow:
`validate_push_endpoint`'s exact-hostname allowlist already means an
attacker would need to compromise DNS for a major push vendor
(`fcm.googleapis.com` et al.), not merely register an arbitrary host.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### Informational — not filed as findings

- **`ensure_default_templates` issues one `get_template` SELECT per default
  template (~35) on every `GET /email-templates` request** — an N+1 shape,
  but bounded by the fixed default-template count (not org size), gated on
  `settings.manage`, and each SELECT is a fast indexed lookup. Same
  disposition as pass 1's `get_inbox`/`get_logs` in-Python pagination note:
  worth an eventual "check all types in one query" rewrite, not a security
  fix.
- **`GET /email-templates/scheduled` has no pagination** — same
  disposition: bounded by how many emails a department schedules,
  `settings.manage`-gated, consistent with the existing accepted pattern
  for admin-only list endpoints in this feature.
- **`GET /notifications/rules` has no pagination** — rules are
  admin-authored, not user-generated, so row counts stay small in
  practice; noted only because every other list endpoint in the file is
  paginated.

### Confirmed still open — unchanged, re-verified fresh

MSG-3 (test-email arbitrary destination), MAIL-4 (arbitrary scheduled-email
recipients), `email_service.py`'s F4 (no SSRF guard on an org-configured
SMTP host — deliberate policy), and the informational
`NotificationRuleCreate.config` unbounded-JSON note are all re-verified
unchanged from pass 1/2 and not re-flagged. MSG-12's `failed`/throttled
sub-cases remain open (see the doc correction above and
`docs/KNOWN_LIMITATIONS.md`).

### Everything else re-verified intact, not re-derived

MSG-4/5/6/7/8/9, the Codex-round `cc_emails` legacy-read fix, MSG-11's
migration-detector ratchet, the `GET /notifications/logs` `scope`
parameter (a fix landed independently of this rotation, between pass 2 and
pass 3 — verified correct: `mine` needs no extra permission, `organization`
requires `notifications.manage`), cursor-based pagination on both
notification lists, and the `DepartmentMessageRecipient`
materialization/idempotent-delivery architecture were all re-checked
against current code rather than trusted from the prior write-up. No
regressions found in any of them.

## Guard tests added (pass 3)

- `backend/tests/test_push_service.py::TestSubscribe::
test_a_user_cannot_register_unbounded_devices`,
  `test_resubscribing_an_existing_endpoint_is_not_blocked_by_the_cap`, and
  `test_reassigning_someone_elses_device_still_respects_the_cap` (MSG-13).
- `backend/tests/test_push_service.py::TestConcurrentEndpointSwapDoesNotDeadlock::
test_two_users_swapping_endpoints_at_once_both_succeed` (MSG-13, Codex
  round 2) — two real independent sessions racing via `asyncio.gather`.
- `backend/tests/test_email_theme_shell.py::TestBuildShell::
test_subtitle_is_escaped` (MSG-14). Verified to fail against the
  reverted code and pass after.

## Completion gate (pass 3)

| Check                                                                                  | Result                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                          | clean (0 violations)                                          |
| `black --check app/ tests/ alembic/`                                                   | clean (1503 files unchanged)                                  |
| `isort --check-only app/ tests/ alembic/`                                              | clean                                                         |
| `python3 scripts/validate_migrations.py --strict`                                      | PASSED — 431 revisions, single head                           |
| backend tests, scope (`-k "push_service or email_theme or messaging or notification"`) | 747 passed, 1 skipped (pre-existing, py_vapid/http-ece)       |
| backend tests, full suite                                                              | 11,471 passed, 21 skipped (environment-only), 0 failed        |
| `npx tsc --noEmit` (frontend)                                                          | 0 errors                                                      |
| `npx eslint .` (frontend)                                                              | 0 errors, 3 pre-existing warnings (unrelated file, untouched) |

No frontend file was modified by this pass, so `tsc`/`eslint` establish
that the backend fixes didn't regress the frontend build.
