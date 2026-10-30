# Security Review — Messaging & Notifications

**Prefix:** `MSG` · **Iteration:** 25 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-31 (pass 2), 2026-09-06 (pass 3), 2026-09-13 (pass 4), 2026-10-03
(pass 5), 2026-10-07 (pass 6), 2026-10-17 (pass 7) · **PR:** #1907 (pass 1),
pass 2 PR recorded in `PROGRESS.md`, #2305 (pass 3), pass 4 PR recorded in
`PROGRESS.md`, pass 5 PR recorded in `PROGRESS.md`, #2984 (pass 6), pass 7
(this PR)

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
- **Round 4 — three more findings, two fixed with a structural change,
  one fixed with a scope-appropriate delivery-side bound rather than a
  data migration:**
  - **Gap-lock deadlock, same-user and cross-user.** The endpoint lookup
    still took a `FOR UPDATE` read that could match nothing (for a
    genuinely brand-new endpoint) — and a "not found" locking read takes
    an InnoDB _gap_ lock over the index range instead of a record lock.
    Unlike a record lock, a gap lock is compatible with another
    transaction's gap lock on the same range: two callers registering
    different never-before-seen endpoints that hash into the same gap
    (same user or different users — reported as two separate findings,
    same mechanism) can each acquire one, then each block on the other's
    later insert-intention lock. This is the identical shape already
    fixed once in this codebase — FAC-45 in `documents_service.py` — and
    fixed the same way: peek by `endpoint_hash` with a plain read first
    (never locking), and only take a real lock via a point lookup on the
    id the peek already found. A brand-new endpoint now never takes any
    lock on the endpoint table before its INSERT.
  - **A deeper residual interleaving, closed with a retry rather than a
    fourth ordering patch.** Codex's own follow-up: a stale guess plus
    two _unrelated_ concurrent transfers landing at just the right moment
    can still make one request's cap-count range-lock overlap a different
    request's specific-row lock — a real deadlock shape, but one with no
    single resource both sides could agree to lock first, since which
    rows a target's own cap-count will touch is exactly what's unknown
    before the lock is taken. Continuing to chase individual
    interleavings risks introducing a fifth subtle ordering bug under
    time pressure without ever proving the scheme deadlock-free for
    arbitrary N-party cases. A deadlock is not a correctness or
    data-integrity failure — InnoDB always cleanly aborts and fully rolls
    back exactly one side — so `subscribe()` now retries once,
    specifically on MySQL error 1213, never any other `OperationalError`
    (which would silently mask a real connectivity or syntax failure
    instead of retrying a lock).
  - **The cap only protected new registrations.** `send_to_user` still
    loaded and iterated every existing row for a user, so an account that
    already exceeded 20 devices before this fix shipped kept the exact
    fan-out this whole change exists to prevent. Fixed at delivery rather
    than with a data migration — trimming existing rows would force a
    decision about _which_ of an over-cap account's devices to delete,
    a real and irreversible product call this PR shouldn't make
    unilaterally. `send_to_user`'s query is now ordered newest-first and
    capped at the same `_MAX_PUSH_SUBSCRIPTIONS_PER_USER`, so a legacy
    over-cap account is delivered to its most recent devices only, with
    no schema change and no information lost.
  - **Guard tests:** `TestDeadlockRetry` (retries once on 1213, never on a
    second deadlock or any non-deadlock `OperationalError`);
    `test_delivery_is_capped_for_an_account_that_predates_the_limit`
    (inserts 25 rows directly, bypassing `subscribe()`'s cap, and asserts
    delivery reaches only the 20 newest).

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

---

## Pass 4 (2026-09-13)

**Backend:** re-read, fresh and in full: `messages.py` (492 L, up from 461 at
pass 1), `message_history.py` (256 L, unchanged), `notifications.py` (514 L,
up from 422 at pass 1), `email_templates.py` (937 L, up from 904),
`messaging_service.py` (1120 L), `message_delivery_service.py` (547 L,
unchanged since pass 3), `notifications_service.py` (590 L),
`push_service.py` (539 L), `notification_rules.py` (134 L, unchanged),
`notification_channels.py` (136 L), `integration_services/
notification_dispatch.py` (254 L, unchanged), plus targeted re-checks of
`email_theme.py`, `email_service.py` (the two fixed-invariant regions:
`_sanitize_header`/attachment budgets, and the `build_shell`/
`_SHELL_COLOURWAYS` cache split) and `app/schemas/notifications.py`.
`email_template_service.py`, `email_templates_storefront.py` and
`email_footers.py` were not re-read line-by-line — `git log` since pass 3
shows zero commits touching any of the three, so nothing to re-derive; pass
3's full read of them stands.
**Frontend:** not re-read line-by-line this pass. `git log` since pass 2
(the pass that read the frontend module in full) shows only two mobile-
accessibility commits touching this feature's frontend
(`communicationsServices.ts`'s `getRules` and two settings-page components),
neither security-relevant — read both diffs directly rather than assumed
clean: one adds `expectArray` validation on a notification-rules response
(a reliability fix, throws instead of silently substituting `[]` on a
malformed body — matches the file's own documented invariant that an empty
rules list must never be inferred), the other resizes a filter control and a
breadcrumb. Neither touches auth, permissions, org-scoping, or payload
construction.
**Migrations:** none added this pass. `validate_migrations.py --strict`
reports 443 revisions, one head — up from pass 3's 431, entirely from other
features' work landing on `main` between passes.

### Doc correction — MSG-12's stranded-`pending` sub-case was already fixed on `main`; this file didn't say so

Not a new code finding. `KNOWN_LIMITATIONS.md`'s own MSG-12 entry already
carries a "(stranded-pending sub-case fixed 2026-09-06)" qualifier and
describes the fix in full, but this findings file's own MSG-12 write-up
(pass 2, reproduced verbatim in pass 3's "confirmed still open" note) never
picked up the correction and still reads as if all three sub-cases —
stranded `pending`, ordinary `failed`, and throttled-with-no-row — remain
open. They do not, in full: a scheduled task,
`run_recover_stranded_message_deliveries`
(`app/services/scheduled_tasks.py:3895`, registered in `SCHEDULE`,
`TASK_RUNNERS` (the dispatch map), and `TASK_INTERVALS_SECONDS` at 1800s /
30 minutes), now sweeps `DepartmentMessageDelivery` rows stuck at
`status="pending"` past `_STRANDED_CLAIM_AFTER_MINUTES = 35`. Verified by
reading the task in full (not merely the `KNOWN_LIMITATIONS.md` prose): it
retires claims whose message or organization is no longer active/live
(`status="failed"`, with a reason, rather than left `pending` forever —
otherwise one dead message's claims would fill the bounded 500-row scan
window on every run and starve genuinely recoverable ones), and re-delivers
the rest through `MessageDeliveryService.deliver(message,
only_user_ids=...)`, which reclaims the stale claim via
`_reclaim_stale_delivery` rather than creating a duplicate — the same
idempotency mechanism `deliver()`'s normal path already relies on. Covered by
`backend/tests/test_message_delivery_claim_recovery.py` (module-level
`pytestmark = [pytest.mark.integration]`, correctly per Pitfall #30b since
every test uses `db_session`).

**Still genuinely open, unchanged:** the ordinary `failed` path (a
transient SMTP/Twilio error or a rejected recipient commits the same
un-revisitable row the stranded-`pending` fix does not touch — `_finish_delivery`
only ever writes `"failed"` when an error occurred, and nothing re-queues a
`"failed"` row) and the throttled path (`_send_email`/`_send_sms` return
before claiming a single recipient when the org's per-hour cap is hit, so
there is no row for any sweep — this one or a future one — to find). Both
still need the product decision pass 2/3 described (what counts as
eligible for retry, whether a throttled batch should be recorded somewhere
retriable, automatic vs. admin-surfaced, duplicate-risk vs. silent-miss).
**Fix applied here:** corrected this file's own MSG-12 entry (above, in the
Pass 2 section) to no longer describe the stranded-`pending` path as open,
and pointed it at `KNOWN_LIMITATIONS.md` for the current, accurate state —
this is a documentation-only change; no code in `scheduled_tasks.py` was
touched by this pass.

### MSG-16 — LOW-MED — `POST /notifications/push/unsubscribe` let any member of the same org delete a colleague's push subscription — ✅ FIXED

**What:** `PushService.unsubscribe` filtered only on `endpoint_hash` and
`organization_id`, never `user_id` — the one self-scoped route in this file
that didn't. Every sibling self-scoped route already filters on the
caller's own id, not merely the org: `subscribe()` writes rows keyed to
`current_user.id`; `notifications_service.mark_as_read`'s `/my/{log_id}/read`
path and `toggle_pin` both additionally filter `recipient_id ==
current_user.id`, the latter's docstring stating the reason explicitly
("prevent an IDOR where any authenticated member could mark another
member's notification as read by guessing its log_id"). `unsubscribe` did
not, and CLAUDE.md's own authorization checklist names this exact shape
("self-scoped routes ... filter on the caller's own id, not merely the
org").

**Where:** `app/services/push_service.py`, `unsubscribe`;
`app/api/v1/endpoints/notifications.py`, `unsubscribe_from_push`.

**Failure scenario:** a push endpoint is a long, effectively-unguessable
per-device URL issued by the browser's push service, so this is not
opportunistically exploitable at scale — but it is a real, unauthenticated-
by-user action once a caller obtains one: a shared station computer, an
endpoint value logged or cached somewhere, or a future bug elsewhere that
echoes one back. Any member of the same organization who has (or guesses)
another member's endpoint could call this route directly (it needs no
special permission — `get_current_user` only) and silently unsubscribe that
colleague's device, with no error surfaced to either party. Not
cross-tenant (the org filter already blocked another department), and not a
data-exposure issue (it deletes a row, it doesn't read one) — but it is an
authorization gap matching the checklist's dimension 2 "self-scoped routes"
criterion exactly, the same category MSG-9 (pass 2) and the `/my/{log_id}`
routes were fixed/designed against.

**Impact:** low — the only consequence is that the victim stops receiving
web push notifications (they still receive the same notice by email, the
channel of record, per the "Notifications Are Email-First" pitfall) until
they re-subscribe, which most PWA install flows do automatically on next
open. No data is read, and nothing but that one row is affected.

**Fix:** `PushService.unsubscribe` now takes `user_id` and filters on it
alongside `organization_id`; `unsubscribe_from_push` passes
`current_user.id`. The one other caller (`tests/test_push_service.py`'s
`TestOrgScoping`) was updated for the new signature.

**Guard test:** `tests/test_push_service.py::TestOrgScoping::
test_another_member_of_the_same_org_cannot_unsubscribe_this_endpoint` —
inserts a second user in the same org as the subscription's real owner and
asserts that user's `unsubscribe` call returns `False` and leaves the row
in place, then confirms the real owner's call still succeeds. Like the rest
of this file, this could not be executed in this sandbox (the whole module
is `importorskip`-skipped without the optional `py_vapid`/`pywebpush`
dependency — confirmed by running `pytest tests/test_push_service.py
--collect-only`, which reports the single skip and collects zero tests);
the logic is a direct mechanical mirror of the adjacent, already-passing
`test_another_org_cannot_unsubscribe_this_endpoint` in the same class, which
exercises the identical delete-with-a-filter shape against a real database
in CI.

### Route inventory (enumerated, not sampled)

48 routes across the four endpoint files, all carrying an auth dependency.

| Method | Path                                                | Auth dependency      | Permission                                        | Org/self-scoped                    | Notes                                  |
| ------ | --------------------------------------------------- | -------------------- | ------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| GET    | `/messages`                                         | `require_permission` | `notifications.manage`                            | org (service)                      | admin list                             |
| POST   | `/messages`                                         | `require_permission` | `notifications.manage`                            | org (stamped)                      | create                                 |
| GET    | `/messages/roles`                                   | `require_permission` | `notifications.manage`                            | org                                | targeting picker                       |
| GET    | `/messages/inbox`                                   | `get_current_user`   | —                                                 | self (recipient join)              |                                        |
| GET    | `/messages/inbox/unread-count`                      | `get_current_user`   | —                                                 | self                               |                                        |
| GET    | `/messages/inbox/{message_id}`                      | `get_current_user`   | —                                                 | self (`_visible_message_or_none`)  |                                        |
| GET    | `/messages/{message_id}`                            | `require_permission` | `notifications.manage`                            | org (`get_message_by_id`)          | admin view                             |
| PATCH  | `/messages/{message_id}`                            | `require_permission` | `notifications.manage`                            | org                                |                                        |
| DELETE | `/messages/{message_id}`                            | `require_permission` | `notifications.manage`                            | org                                | soft delete                            |
| POST   | `/messages/{message_id}/read`                       | `get_current_user`   | —                                                 | self                               |                                        |
| POST   | `/messages/{message_id}/acknowledge`                | `get_current_user`   | —                                                 | self                               | audit-logged                           |
| GET    | `/messages/{message_id}/stats`                      | `require_permission` | `notifications.manage`                            | org                                | MSG-9 fix                              |
| GET    | `/messages/{message_id}/acknowledgments`            | `require_permission` | `notifications.manage`                            | org                                |                                        |
| GET    | `/message-history`                                  | `require_permission` | `settings.manage`\|`organization.update_settings` | org                                | LIKE-escaped search                    |
| POST   | `/message-history/test-email`                       | `require_permission` | `settings.manage`\|`organization.update_settings` | org                                | MSG-3: `to_email` arbitrary, by design |
| GET    | `/notifications/rules`                              | `require_permission` | `notifications.view`                              | org                                | LIKE-escaped search                    |
| POST   | `/notifications/rules`                              | `require_permission` | `notifications.manage`                            | org                                |                                        |
| GET    | `/notifications/rules/{id}`                         | `require_permission` | `notifications.view`                              | org                                |                                        |
| PATCH  | `/notifications/rules/{id}`                         | `require_permission` | `notifications.manage`                            | org                                | `apply_updates` (MSG-5)                |
| DELETE | `/notifications/rules/{id}`                         | `require_permission` | `notifications.manage`                            | org                                |                                        |
| POST   | `/notifications/rules/{id}/toggle`                  | `require_permission` | `notifications.manage`                            | org                                |                                        |
| GET    | `/notifications/logs`                               | `get_current_user`   | `notifications.manage` iff `scope=organization`   | self by default                    | `_resolve_log_scope`                   |
| POST   | `/notifications/logs/read-all`                      | `get_current_user`   | same                                              | self by default                    |                                        |
| POST   | `/notifications/logs/{id}/read`                     | `require_permission` | `notifications.manage`                            | org (any recipient)                | admin log view                         |
| GET    | `/notifications/my`                                 | `get_current_user`   | —                                                 | self                               | cursor-paginated                       |
| GET    | `/notifications/my/unread-count`                    | `get_current_user`   | —                                                 | self                               |                                        |
| GET    | `/notifications/my/unread-by-category`              | `get_current_user`   | —                                                 | self                               | inbox stacks                           |
| POST   | `/notifications/my/read-category`                   | `get_current_user`   | —                                                 | self (`recipient_id` filter)       | inbox stacks; skips pinned             |
| POST   | `/notifications/my/read-all`                        | `get_current_user`   | —                                                 | self                               |                                        |
| POST   | `/notifications/my/{id}/read`                       | `get_current_user`   | —                                                 | self (`user_id` filter)            |                                        |
| POST   | `/notifications/my/{id}/pin`                        | `get_current_user`   | —                                                 | self (`user_id` filter)            |                                        |
| GET    | `/notifications/summary`                            | `require_permission` | `notifications.view`                              | org                                |                                        |
| GET    | `/notifications/push/config`                        | `get_current_user`   | —                                                 | n/a (public VAPID key)             |                                        |
| POST   | `/notifications/push/subscribe`                     | `get_current_user`   | —                                                 | self                               | SSRF-guarded endpoint                  |
| POST   | `/notifications/push/unsubscribe`                   | `get_current_user`   | —                                                 | self + org                         | **MSG-16 fix: now self-scoped**        |
| GET    | `/email-templates/footers`                          | `require_permission` | `settings.manage`\|`organization.update_settings` | org                                |                                        |
| PUT    | `/email-templates/footers`                          | same                 | same                                              | org                                | `copy.deepcopy` (Pitfall #12)          |
| GET    | `/email-templates`                                  | same                 | same                                              | org                                |                                        |
| GET    | `/email-templates/scheduled`                        | same                 | same                                              | org                                | unpaginated (accepted)                 |
| GET    | `/email-templates/{id}`                             | same                 | same                                              | org                                |                                        |
| PUT    | `/email-templates/{id}`                             | same                 | same                                              | org                                | `exclude_unset` + `apply_updates`      |
| POST   | `/email-templates/{id}/reset`                       | same                 | same                                              | org                                |                                        |
| POST   | `/email-templates/{id}/preview`                     | same                 | same                                              | org                                |                                        |
| POST   | `/email-templates/{id}/attachments`                 | same                 | same                                              | org                                | magic-byte MIME check                  |
| DELETE | `/email-templates/{id}/attachments/{attachment_id}` | same                 | same                                              | org (joined)                       | file-then-row delete order             |
| POST   | `/email-templates/schedule`                         | same                 | same                                              | org; `template_id` `assert_in_org` | `to/cc/bcc_emails` arbitrary (MAIL-4)  |
| PATCH  | `/email-templates/scheduled/{id}`                   | same                 | same                                              | org                                |                                        |
| DELETE | `/email-templates/scheduled/{id}`                   | same                 | same                                              | org                                |                                        |

No route without an auth dependency was found. No permission string reads as
under-gated for its data's sensitivity (dimension 2): the one org-wide
read-everyone's-notification-body view (`GET /notifications/logs
?scope=organization`) is gated on `notifications.manage`, not the weaker
`notifications.view`, specifically because `NotificationLog` carries
`subject`/`message`/`recipient_email` for every recipient (see
`_resolve_log_scope`'s own docstring).

### Re-verified still intact (not re-derived)

- **MSG-4** through **MSG-9** (reschedule-guard normalization,
  `update_rule`/`apply_updates`, email header sanitization + `cc_emails`
  tightening, SMTP attachment budget + exception safety, `build_shell`
  cache split, `get_message_stats` org-scoping) — all re-read directly
  against current source, unchanged.
- **MSG-13** (push-subscription cap, the four-round lock-ordering fix) —
  `_MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20`, the sorted-lock-then-peek
  sequence, the deadlock retry, and the `send_to_user` newest-first cap are
  all present exactly as pass 3 left them.
- **MSG-14** (`build_shell` subtitle escaping) — intact.
- **Tenant isolation / audience targeting** — `_targeted_users` is still
  the single choke point for delivery, stats, and the acknowledgment
  report, still filtered to `User.organization_id == message.organization_id`.
  `_validate_targeting` still rejects a foreign member/role id on
  create/update.
- **Recipient materialization / revocation** (`DepartmentMessageRecipient`,
  `revoked_at`) — `reconcile_recipients` still prunes only un-evidenced rows
  and soft-revokes the rest, matching the MSG-10 fix pass 3 confirmed.
- **SMS allowlist (Pitfall #18)** — `resolve_sms_targets`/
  `resolve_sms_recipients` in `notification_channels.py` remain the only
  path to `SMSService`; grepped the whole feature (`grep -rn "SMSService()"`)
  and found exactly one call site outside that module
  (`message_delivery_service.py`), which goes through the resolver.
- **Chat-integration webhook senders** (Slack/Discord/Teams) — unchanged,
  each still self-guards before `notification_dispatch.py` calls it.
- **`ondelete="SET NULL"` nullability (Pitfall #2)** — re-checked every
  `SET NULL` FK in `app/models/notification.py`
  (`NotificationLog.rule_id`, `NotificationLog.recipient_id`,
  `DepartmentMessage.posted_by`); all three are `nullable=True`.
- **LIKE escaping (Pitfall #25)** — every `.ilike(` call in the feature's
  services (`messaging_service.py`, `notifications_service.py`,
  `message_history.py`) passes `escape=LIKE_ESCAPE_CHAR` via `like_pattern()`.
  No bare `.like(`/`.ilike(` call exists anywhere in this feature's files.
- **No CSV export in this feature** — the only `"csv"` hits in the four
  endpoint files are an allowed attachment extension/MIME type in
  `email_templates.py`, not an export. Checklist dimension 4's
  `SafeCsvWriter` rule is n/a here.

### Confirmed still open — unchanged, no new product-decision items

MSG-3 (test-email arbitrary destination, by design), MSG-12's `failed` and
throttled sub-cases (see the doc correction above — the stranded-`pending`
sub-case is now fixed), MSG-15 (Web Push send-time DNS-rebinding pin skipped
outside `production`/`staging`), MAIL-4 (arbitrary scheduled-email
recipients), `email_service.py`'s F4 (no SSRF guard on an org-configured
SMTP host — deliberate policy), and the informational
`NotificationRuleCreate`/`Update.config` unbounded-JSON note are all
re-verified unchanged and not re-flagged. The three informational
pagination/N+1 notes from pass 3 (`get_inbox`/`get_logs` in-Python
pagination — actually cursor/keyset-paginated now, see below —
`ensure_default_templates`'s ~35-query N+1, `GET /email-templates/scheduled`
and `GET /notifications/rules` having no pagination) are unchanged
performance observations, not security findings.

**Correction to a stale pass-1 note, not a new finding:** pass 1's "Future
development" list still described `get_inbox`'s pagination as an in-Python
`skip:skip+limit` slice with no total. That was true in pass 1; PR #1938
(before pass 2) replaced it with the `DepartmentMessageRecipient` join, and
`GET /notifications/logs`/`GET /notifications/my` both gained cursor
pagination independently, also before pass 2. Pass 2 and 3 already
description-corrected this in their own bodies; noted here only because a
reader skimming from pass 1's still-present language alone would be
mistaken. No code change.

## Guard tests added (pass 4)

- `backend/tests/test_push_service.py::TestOrgScoping::
test_another_member_of_the_same_org_cannot_unsubscribe_this_endpoint`
  (MSG-16) — same-org, cross-user `unsubscribe` attempt is rejected; the
  legitimate owner's call still succeeds. Cannot run in this sandbox (see
  MSG-16 above); mirrors the adjacent passing cross-org test's shape.

## Completion gate (pass 4)

| Check                                                                                                                                                                                               | Result                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                       | clean (0 violations)                                                                                                             |
| `black --check app/ tests/ alembic/`                                                                                                                                                                | clean (1586 files unchanged)                                                                                                     |
| `isort --check-only app/ tests/ alembic/` (installed 9.0.1, matching CI's pin)                                                                                                                      | clean                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                   | PASSED — 443 revisions, single head                                                                                              |
| backend tests, scope (`-k "push_service or messaging or notification or message_history or message_delivery or email_theme or email_template or email_service or message_delivery_claim_recovery"`) | 1127 passed, 1 skipped (pre-existing, `py_vapid`/`pywebpush` unavailable in this sandbox)                                        |
| backend tests, full suite                                                                                                                                                                           | 12,447 passed, 21 skipped (environment-only: `py_vapid`/`pywebpush`, Docker daemon/registry, API-contract opt-in flag), 0 failed |
| `npx tsc --noEmit` (frontend, via `npm run typecheck`)                                                                                                                                              | 0 errors                                                                                                                         |
| `npx eslint --max-warnings 10` (frontend, via `npm run lint`)                                                                                                                                       | exit 0, no output (0 errors, 0 warnings)                                                                                         |

No frontend file was modified by this pass (MSG-16 is backend-only), so
`tsc`/`eslint` establish the backend fix didn't regress the frontend build.

---

## Pass 5 (2026-10-03) — watchdog pickup, substantial churn, 0 new findings

Picked up by a watchdog check: the dedicated `/loop 30m /security-review`
session had stalled 2+ hours with no open security-review PR and no
in-progress `claude/security-review-*` branch. Confirmed via the GitHub API
(`list_pull_requests`, state=open) immediately before starting, and again
immediately before opening this pass's own PR, that no PR with a head branch
starting with `claude/security-review-` existed either time.

**Backend:** re-read, fresh and in full: `messages.py` (492 L, unchanged since
pass 4), `message_history.py` (266 L, +10 — the "send test email to me"
blank-address guard and attachment-forwarding wiring), `notifications.py`
(556 L, +42 — the `/my/unread-by-category` and `/my/read-category` stacking
endpoints), `email_templates.py` (1104 L, +167 — three new routes:
`GET`/`PUT /member-email-policy`, `GET /{id}/backups`), `messaging_service.py`,
`message_delivery_service.py`, `notification_rules.py`, `notification_channels.py`,
`integration_services/notification_dispatch.py`, `schemas/notifications.py` —
confirmed byte-identical to pass 4 via `git diff` against the pass-4-era
commit, so re-verified by diff rather than re-read line by line.
`notifications_service.py` (649 L) was diffed and re-read at the two changed
regions (the category-stacking filters, and a timezone-aware "emails this
month" fix). `push_service.py` (552 L) and `notification_channels.py` were
re-read; the only change in either since pass 4 was descriptive metadata
(`SmsAlertInfo`/`SMS_ALERT_DETAILS`/`SMS_CONDITIONS`) with no logic change.
`email_service.py` (2318 L, +580) and `email_theme.py` (1174 L, +745) grew
substantially from a full email redesign — re-verified every pass-1/pass-3
invariant (`_sanitize_header` on all header fields, both attachment budgets,
the `_SHELL_COLOURWAYS` cache split, `subtitle` escaping) still present and
unchanged at their same call sites, and read the new attachment-build code
(`built_for` positional tracking in the SMTP batch path) — a correctness
improvement, not a regression, since it fixes answers shifting onto the wrong
recipient when one message fails to build. `email_template_service.py`
(4055 L) and `email_templates_storefront.py`/`email_footers.py` (frozen
default-template bodies plus the new per-field footer contact flags) were
read at every function the diff touched, not the ~3,700 lines of unchanged
frozen template HTML. Two new files surfaced by the churn and reviewed in
full because they sit directly on this feature's send path:
`email_policy.py` (452 L — the member email opt-out/required-kind matrix
behind the new `/member-email-policy` endpoints) and `email_test_records.py`
(262 L — fills a test email from the department's own next event/shift
instead of sample data). `equipment_request_notifications.py` (280 L) was
also read in full: it is formally Inventory's file, not this feature's, but
it is a brand-new caller into this feature's shared `push_service`/
`notification_rules` machinery and the obvious place for a newly-wired
trigger to get org-scoping wrong.

**Frontend:** `modules/communications`, `modules/notifications`,
`pages/NotificationsPage.tsx`, `components/NotificationCard.tsx`,
`services/communicationsServices.ts`, `hooks/usePushNotifications.ts` swept
for every pattern pass 2's "Frontend — verified good" section asserted
(`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
date-formatting methods, direct `fetch(`) — all still absent under 30+ commits
of churn (`grep -rn` across all six paths, zero matches for any pattern).
Not re-read line-by-line beyond that targeted sweep; no finding in this pass
depends on frontend logic beyond what the sweep covers.

**Migrations:** three landed since pass 4, all reviewed:
`20260925_1251_1ae1ffbc445e` (widens `NotificationTrigger` and
`EmailTemplateType` for `suggestion_submitted`, creates
`suggestion_box_watchers`), `20260928_1355_fb7da5b05833` (same two enum
widenings for `equipment_request_update`), and
`20260927_1945_15c5bc7700aa` (the email redesign: resets every template of a
type with a frozen default to the new design, backing up the previous
content to a new `email_template_backups` table first). `validate_migrations.py
--strict` reports 508 revisions, one head — up from pass 4's 443, mostly from
other features' work.

### Re-verified still intact, not re-derived

Every fix from passes 1–4 (MSG-4 through MSG-9, MSG-13 through MSG-16, the
Codex-round `cc_emails` legacy-read fix, the MSG-11 migration-detector
ratchet) was checked directly against current source rather than trusted:

- **Header sanitization / attachment budgets / exception safety (MSG-6, MSG-7)** —
  `_sanitize_header` still applied to `To`/`Cc`/`Reply-To`/`List-Unsubscribe`
  at both header-construction sites; `_CLOUDFLARE_ATTACHMENT_BUDGET` and
  `_SMTP_ATTACHMENT_BUDGET` both present and enforced; both the Cloudflare and
  batch SMTP branches still wrap their send in `try/except` →
  `[False] * len(...)`.
- **`build_shell` cache split / subtitle escaping (MSG-8, MSG-14)** —
  `wrap_email_body` still calls `build_shell(..., cache=False)`; `subtitle` is
  still `_html.escape`d inside `build_shell` itself, at both the teaser and
  heading sites.
- **Push subscription cap, lock ordering, deadlock retry (MSG-13)** —
  `_MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20`, the sorted-lock-then-peek sequence,
  and the newest-first delivery cap are all present exactly as pass 3 left
  them; `push_service.py` has had no commit since pass 4 beyond the
  unrelated metadata change noted above.
- **Self-scoped `unsubscribe` (MSG-16)**, **`get_message_stats` org-scoping
  (MSG-9)**, **`update_rule`/`apply_updates` (MSG-5)**, **the reschedule
  normalization (MSG-4)** — all re-read directly, unchanged.
- **SMS allowlist (Pitfall #18)** — `SmsAlert` still has exactly one member
  (`URGENT_DEPARTMENT_MESSAGE`); `resolve_sms_targets`/`resolve_sms_recipients`
  remain the only path to `SMSService` for a routine notification. The new
  suggestion-box and equipment-request notices (below) send email + in-app +
  push only — neither adds an `SmsAlert` member, correctly: neither is the
  kind of time-critical, act-immediately notice the allowlist is reserved for.
- **`_RAW_HTML_VARIABLES` allowlist** — every new raw-HTML variable this
  pass's new code touches (`apparatus_html`, `details_html`, `notes_html` in
  `equipment_request_notifications.py`) is escaped at its own construction
  site, matching the established pattern; no new variable was added to the
  allowlist itself.

### New code reviewed: two newly-wired notification triggers (Pitfall #19)

`SUGGESTION_SUBMITTED` and `EQUIPMENT_REQUEST_UPDATE` were added to
`NotificationTrigger` and to `ENFORCED_TRIGGERS` in
`app/models/notification.py`. Both are correctly wired with a real reader —
the exact gap Pitfall #19 exists to catch — confirmed by tracing each to its
sender: `suggestions.py:194` and `equipment_request_notifications.py:169`
each call `NotificationRuleResolver(db).is_enabled(organization_id, trigger)`
before doing any work, so a department that switches either off actually
stops the notice rather than getting a UI toggle that does nothing.
`equipment_request_notifications.py`'s delivery path (`_deliver`) was read in
full: the request and the requesting member are each re-fetched by id with
an explicit `organization_id` filter (not merely inherited from an earlier
query), the member is additionally filtered `is_active`, and every
user-controlled value reaching the HTML email context (`item_name`,
`review_notes`) is `html.escape`d at construction before being placed into a
`*_html` context key. No cross-tenant or injection gap found in either new
path.

### Doc correction — MAIL-22 (app-review, `email_templates.py`) belongs in this feature's scope and is still open

Not a new finding. `docs/app-review/email-templates.md`'s MAIL-22 (pass 5,
2026-09-09) — `upload_attachment` sniffs the real MIME with
`detect_mime_type`, uses it to accept/reject the upload, and then persists
`content_type=file.content_type` (the client's unchecked claim) rather than
the detected value — is squarely inside this rotation feature's file list
(`email_templates.py`) but was never cross-referenced from this document.
Re-verified still open against current code: `email_templates.py:790` rejects
on a detected-MIME mismatch, but `email_templates.py:832` still writes
`content_type=file.content_type or "application/octet-stream"` onto the
stored `EmailAttachment` row — the client's claim, unchanged since that
app-review pass. Already mirrored in `docs/KNOWN_LIMITATIONS.md` ("Email
attachments: the detected MIME type is validated, then discarded"); not
re-flagged as a new `MSG-N` id to avoid a second, divergent record of the
same defect — this note exists so a reader of this file does not conclude
the email-templates surface has no other open item.

### Confirmed still open — unchanged, no new product-decision items

MSG-3 (test-email arbitrary destination, by design), MSG-12's `failed` and
throttled sub-cases (stranded-`pending` fixed pass 4; both remaining
sub-cases still need the product decision passes 2–4 described), MSG-15
(Web Push send-time DNS-rebinding pin skipped outside
`production`/`staging`), MAIL-4 (arbitrary scheduled-email recipients),
`email_service.py`'s F4 (no SSRF guard on an org-configured SMTP host —
deliberate policy), and the informational `NotificationRuleCreate`/
`Update.config` unbounded-JSON note are all re-verified unchanged and not
re-flagged.

### Route inventory — re-enumerated, 51 routes (48 at pass 4, +3)

All 51 routes across the four endpoint files carry an auth dependency;
re-confirmed by grepping every `@router.*` decorator against its
`Depends(...)` in the same file (not sampled) for all four files. The 48
rows pass 4 already enumerated are unchanged (re-checked, not re-printed
here — see pass 4's table above). The three new rows:

| Method | Path                                   | Auth dependency      | Permission                                                                | Org/self-scoped                             | Notes                                                                                   |
| ------ | -------------------------------------- | -------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/email-templates/member-email-policy` | `require_permission` | `settings.manage`\|`organization.update_settings`\|`notifications.manage` | org                                         | read-only; `can_edit` flag computed from the narrower set below                         |
| PUT    | `/email-templates/member-email-policy` | `require_permission` | `settings.manage`\|`organization.update_settings`                         | org                                         | only optional kinds accepted; deep-copies `Organization.settings` (Pitfall #12)         |
| GET    | `/email-templates/{id}/backups`        | `require_permission` | `settings.manage`\|`organization.update_settings`                         | org (template **and** backup both filtered) | returns `None`→404 rather than an empty list, so a foreign id doesn't confirm existence |

(`/notifications/my/unread-by-category` and `/notifications/my/read-category`
were already present in pass 4's table — re-verified unchanged, both still
filtered to `recipient_id == current_user.id` and
`organization_id == current_user.organization_id` via the shared
`_stackable_unread_filters` helper, which both the count read and the
mark-read write use, so a stack's badge and its clear button cannot disagree.)

### Schema & migration notes

- `email_template_backups.template_id` is `ForeignKey(..., ondelete="SET
NULL")` with `nullable=True` (Pitfall #2 — correct); `organization_id`
  cascades, matching the model docstring's stated reasoning (a backup has no
  meaning once its department is gone).
- `15c5bc7700aa`'s table creation is guarded on `has_table`, and its
  `upgrade()`/`downgrade()` are symmetric: downgrade restores every backed-up
  column from a row tagged with this revision's id before dropping the
  backup table, so a revert does not lose the department's pre-redesign
  wording.
- Both enum-widening migrations (`1ae1ffbc445e`, `fb7da5b05833`) snapshot the
  enum's prior value set as a literal tuple rather than importing the live
  model — the established pattern in this codebase for enum widenings, which
  keeps a later edit to the Python enum from silently rewriting what an old
  migration asserted. `suggestion_box_watchers`'s own creation is guarded on
  `has_table` for a fresh install's `create_all` path (Pitfall #26); its FKs
  (`organization_id`/`box_id`/`position_id`/`user_id`, all CASCADE) reference
  tables that are guaranteed to already exist at this point in the chain.

## Guard tests added (pass 5)

None — no code fix was made this pass (0 new findings; see "Confirmed still
open" and the MAIL-22 doc correction above).

## Completion gate (pass 5)

| Check                                                                          | Result                              |
| ------------------------------------------------------------------------------ | ----------------------------------- |
| `flake8 app/ tests/ alembic/`                                                  | clean (0 violations)                |
| `black --check app/ tests/ alembic/`                                           | clean — 1849 files unchanged        |
| `isort --check-only app/ tests/ alembic/` (installed 9.0.1, matching CI's pin) | clean                               |
| `python3 scripts/validate_migrations.py --strict`                              | PASSED — 508 revisions, single head |
| backend tests, scope (`-k "message or notification or email_template"`)        | 916 passed, 1 skipped               |
| `npm run typecheck` (frontend)                                                 | 0 errors                            |
| `npm run lint` (frontend, `eslint --max-warnings 10`)                          | exit 0                              |

No code was changed this pass, so the gate is a confirmation that current
`main` is clean, not a verification of a diff — per CLAUDE.md's "match the
verification to the change," the full ~12,900-test backend suite (last
measured at 12,447 passed, pass 4) was also started for extra confidence but
was not awaited: at 6+ CPU-minutes and climbing with no sign of finishing, it
would have cost more wall-clock time than the rest of this pass combined for
a signal the scoped run (which covers every file this pass actually read)
already gives for this feature's own surface. A failure in it would be a
pre-existing or cross-feature issue, not something this pass's docs-only
diff could cause.

## Pass 6 (2026-10-07) — watchdog pickup, near-zero-delta re-verification, 0 fixed, 0 new findings

Picked up by the scheduled `/loop 30m` watchdog, not the dedicated
security-review session directly: at the time this pass began, over an hour
had elapsed since PR #2983 (Feature 24, Meetings & minutes, pass 6) merged
(14:37 UTC) with no new `claude/security-review-*` branch or PR opened for
Feature 25, confirmed via `list_pull_requests` (state=open, no match) both
before this pass started and again immediately before this PR was opened.
`PROGRESS.md`'s own Log section (append-ordered newest-first) and Rotation
table were already current through Feature 24 ✅ once read in full — the
apparent staleness on a first look (its last chronological `### ` entry read
"Next: Feature 19" because that is pass 7's oldest, not newest, log line)
was a misreading, not a tracker defect; corrected before relying on it
further.

**Backend:** diffed every file this feature's scope covers against pass 5's
merge commit (`cfeb21e34`) rather than re-read cold, per CLAUDE.md's "match
the verification to the change" — the four endpoint files
(`messages.py`/`message_history.py`/`notifications.py`/`email_templates.py`),
all eleven service/integration files, `schemas/notifications.py`, and
`models/notification.py` (not in the feature's own file list, but its
`NotificationLog.recipient_name` property is read by this surface). Real
delta since pass 5: one feature (`914594940`, W50-23 — proxy-aware ballot
mail notice) plus a handful of incidental "preferred name" display-helper
swaps (`format_display_name`/`format_legal_name` from `app/utils/member_names.py`
replacing hand-rolled `f"{first} {last}".strip()` in `messaging_service.py`
and `models/notification.py`) and one copy-only change (`email_policy.py`'s
digest label text). `notifications.py`, `message_history.py`,
`messaging_service.py`'s remainder, `message_delivery_service.py`,
`notifications_service.py`, `push_service.py`, `notification_rules.py`,
`notification_channels.py`, `integration_services/notification_dispatch.py`,
`email_templates_storefront.py`, `email_footers.py`, `email_policy.py`
(beyond the one label string), and `email_test_records.py` are byte-identical
to pass 5 — confirmed by `git diff cfeb21e34..HEAD` returning no hunks for
each, not inferred from the commit list.

**W50-23 (proxy-aware ballot mail) reviewed against all seven dimensions,
found clean:** `EmailService.render_ballot_notification` gains an optional
`proxy_holder_name` parameter; when set, both the voter's and the holder's
names are `_html.escape`d (`email_service.py`) before being interpolated
into the new `ballot_link_notice_html`/`_text` card, matching the existing
escape-then-interpolate pattern this file uses everywhere else (MSG-6/MSG-7's
citation). The new variable is added to `EmailTemplateService`'s
`_RAW_HTML_VARIABLES` allowlist (`email_template_service.py:3672`) — correct,
since it is a pre-built, pre-escaped HTML fragment the same way
`custom_message_html`/`footer_html` already are, not raw user input reaching
the allowlist unescaped. The companion migration
(`20261005_1830_24f56e4fc320`) only rewrites `email_templates.html_body`/
`text_body` text columns — no new table or column, so Pitfall #2/#26 don't
apply — is guarded on `_has_table`, and its `upgrade()`/`downgrade()` call the
same `_swap()` helper with swapped arguments, so a revert is exact. No
tenant-isolation concern: the migration operates on rows already scoped to
their own `organization_id` by virtue of updating in place, and the sender
(`send_ballot_emails`, unchanged) is what decides whether a given send
carries a `proxy_holder_name` — this pass re-read that call site and
confirmed it is still gated on the existing proxy-holder lookup, not newly
introduced trust in client input.

**Preferred-name display-helper swaps reviewed, no behavior-relevant change
for this feature:** `MessagingService._message_to_response`'s author-name
map and the removed-from-audience audit entry now go through
`format_display_name`/`User.display_name` instead of a hand-rolled
`f"{first} {last}".strip()```; `NotificationLog.recipient_name`likewise.
Neither reaches raw HTML output in this feature's own send paths (both are
plain-text display/audit fields), so the escape-boundary findings from
earlier passes (MSG-6/MSG-7/MAIL-1/MAIL-2) are unaffected.`email_templates.py`'s
`preview_email_template`endpoint was more substantially touched — it now
picks between the member's preferred name and their legal name per`TEST_RECIPIENT_FIELDS`'s per-template-type `legal_*`markers (election and
storefront-billing templates use the legal name; everyday templates use the
preferred one) — but this is preview-only sample-data selection, not a new
user-facing write or a new permission surface; the endpoint's existing`require_permission` gate (unchanged) and org-scoped member lookup (unchanged)
were re-checked directly and still apply before this logic runs.

**Frontend:** no commit since pass 5 touched any of the six swept paths
(`modules/communications`, `modules/notifications`, `pages/NotificationsPage.tsx`,
`components/NotificationCard.tsx`, `services/communicationsServices.ts`,
`hooks/usePushNotifications.ts`) — confirmed by `git log` path-filtered
against pass 5's commit, zero results. The one frontend commit touching this
feature's surface since pass 5 (`54e163ffa`, the Templates banner wording
fix) only edits `EmailTemplatesPage.tsx`'s static copy and its own test; no
security-relevant surface.

### Re-verified still intact, not re-derived

Every standing fix (MSG-4 through MSG-9, MSG-13 through MSG-16, the
`cc_emails` legacy-read fix, MSG-11's migration-detector ratchet, the W50-23
escape/allowlist pattern above) re-confirmed by `git diff` showing zero
change at each citation since pass 5 re-read them directly — none of this
pass's own delta touches any of those call sites.

### Confirmed still open — unchanged

MSG-3 (test-email arbitrary destination, by design), MSG-12's `failed`/
throttled sub-cases (product decision pending), MSG-15 (Web Push send-time
DNS-rebinding pin skipped outside `production`/`staging`), MAIL-4 (arbitrary
scheduled-email recipients), `email_service.py`'s F4 (no SSRF guard on an
org-configured SMTP host — deliberate policy), the informational
`NotificationRuleCreate`/`Update.config` unbounded-JSON note, and MAIL-22 /
`docs/KNOWN_LIMITATIONS.md`'s "Email attachments: the detected MIME type is
validated, then discarded" (`email_templates.py:832`, unchanged this pass) —
all re-verified against current code, none re-flagged as new ids.

### Route inventory — re-enumerated, 51 routes (unchanged since pass 5)

`grep -c '@router\.\(get\|post\|put\|patch\|delete\)'` against all four
endpoint files: 13 + 2 + 20 + 16 = 51, matching pass 5 exactly; `git diff`
against each file shows no added or removed `@router.` decorator, so this is
confirmed rather than merely re-counted.

### Schema & migration notes

`validate_migrations.py --strict`: 538 revisions, single head
(`8c4f2a6e1d93`), up from pass 5's 508 — the growth is other features' work;
this feature's own migration since pass 5 is the one `24f56e4fc320` already
covered above.

## Guard tests added (pass 6)

None — no code fix was made this pass (0 new findings).

## Completion gate (pass 6)

| Check                                                                             | Result                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                     | clean (0 violations)                                    |
| `black --check app/ tests/ alembic/`                                              | clean — 2027 files unchanged                            |
| `isort --check-only app/ tests/ alembic/`                                         | clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                 | PASSED — 538 revisions, single head                     |
| backend tests, scope (`-k "message or notification or email_template or ballot"`) | 1197 passed, 1 skipped (environment-only — `pywebpush`) |
| `npm run typecheck` (frontend)                                                    | 0 errors                                                |
| `npm run lint` (frontend, `eslint --max-warnings 10`)                             | clean, exit 0                                           |

No code was changed this pass, so the gate confirms current `main` is clean
rather than verifying a diff this pass produced, matching pass 5's own
rationale. `alembic upgrade head` was also re-verified to build cleanly
end-to-end on a fresh database (538 revisions, single head reached) before
the scoped test run, since the session's own startup hook had failed with
`python3 -m alembic` (no `__main__.py` in this alembic version) — the
console-script entry point (`alembic upgrade head`) is unaffected and is
what CI and `npm run db:migrate` actually invoke, so this is an environment
note, not an application defect, and is out of this feature's scope to fix.

## Pass 7 (2026-10-17) — two standing findings closed by other work, 0 new findings

Picked up as the next unstarted row in the rotation (Feature 24, Meetings &
minutes, pass 7, had just merged as PR #3365; no open
`claude/security-review-*` PR existed for Feature 25, confirmed via
`list_pull_requests`, state=open, before this pass started).

**Backend:** diffed every file this feature's scope covers against pass 6's
merge (PR #2984) rather than re-read cold, per CLAUDE.md's "match the
verification to the change." Real delta since pass 6, all reviewed in full:

- **`607e1ef4` / `51f26550` — MSG-12's remaining two sub-cases (the ordinary
  `failed` path and the throttled-with-no-row path) are fixed.** This is
  regular feature work, not a security-review commit, but it closes a
  finding this file has carried as open-pending-a-product-decision since
  pass 2. The owner's decision: both paths now write (or convert to) a
  `retrying` `DepartmentMessageDelivery` row with `attempt_count` and
  `next_attempt_at` (migration `b834afdaffdf`, guarded on the table/columns/
  index per Pitfall #26, symmetric downgrade); backoff is 5, 10, 20, 40 then
  80 minutes (`MAX_DELIVERY_RETRIES = 5`, `_RETRY_BASE_DELAY`,
  `retry_delay()`); a sixth failure is final (`failed`). A throttled
  email/SMS batch, which used to return before claiming a single recipient
  and leave no row for anything to find, now calls `_record_throttled` to
  claim and record one `retrying` row per held-back member
  (`message_delivery_service.py:268`). A new scheduled task,
  `run_retry_message_deliveries` (`scheduled_tasks.py:4626`, registered in
  `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS` at 300s, all three
  checked directly — Pitfall #30a's registry pattern, here for a scheduled
  task rather than a route), re-delivers due rows through
  `MessageDeliveryService.deliver()`, which reclaims the row via the
  existing `_reclaim_stale_delivery` idempotency path rather than
  duplicating it; a due row whose message was deactivated/deleted/expired or
  whose org is off is retired as `failed` with a reason instead of being
  left to fill the bounded scan window on every pass, matching the
  stranded-`pending` sweep's own design. The task resolves its message's
  audience through `MessagingService._targeted_users(message,
message.organization_id)` — i.e. every by-id lookup is scoped to the
  message's own organization, not a caller-supplied one — and
  `51f26550` added it to `org_scoping_baseline.txt` with the same
  "system-wide scheduled task, no caller org" reasoning already accepted
  for `run_recover_stranded_message_deliveries`. The client-facing error
  string stays on the existing allowlist
  (`messaging_service.py:_PLAIN_DELIVERY_REASONS`): a provider exception's
  raw text is still replaced with a generic reason before reaching
  `GET /messages/{id}/acknowledgments`, so the MSG-6/MSG-7 "no internals in
  an error string" invariant holds for the new states too. Guard tests:
  `tests/test_message_delivery_retries.py`,
  `tests/test_message_delivery_retries_migration.py`, plus updates to
  `tests/test_message_delivery_service.py` and
  `tests/test_messaging_service.py` for the new "first failure is retrying,
  not failed" transition. `docs/KNOWN_LIMITATIONS.md`'s MSG-12 entry already
  carried the correct ✅ Resolved note (dated 2026-10-11) describing this
  exact fix — verified against current code rather than trusted, and found
  accurate; no doc correction needed here.
- **`d05421bd` — MSG-15 (the environment-string DNS-rebinding gate) is
  fixed.** `PushService._send_one` now pins every send regardless of
  `settings.ENVIRONMENT`; the only bypass is the module attribute
  `push_service._UNPINNED_SENDS_FOR_TESTS` (`push_service.py:208`), which is
  not a setting — no deployment configuration can reach it, and
  production/staging pin even if a test process somehow left it set, since
  `_pin_this_send()` checks `ENVIRONMENT in ("production", "staging")`
  first and only consults the flag for every other value. Guard test:
  `tests/test_push_rebinding_guard.py`. `docs/KNOWN_LIMITATIONS.md`'s MSG-15
  entry already carried the matching ✅ Resolved note — verified accurate.
- **`a979d14b` (app-review B11, not a security-review commit) —
  `NotificationRuleUpdate.enabled` now refuses an explicit `null`.**
  Reviewed because it touches `schemas/notifications.py` and
  `notification_rules.py`, both in this feature's scope. Before this fix,
  `PATCH /notifications/rules/{id}` with `enabled: null` stored `NULL` in a
  nullable column and then raised serializing the response (`enabled` is a
  plain `bool` on `NotificationRuleResponse`), a 500 that also broke every
  later `GET` of that organization's rule list. A new `field_validator`
  rejects an explicit `null` with a 422 and leaves an omitted key alone
  (`model_dump(exclude_unset=True)`/`apply_updates` semantics, Pitfall #1,
  are unaffected: the omitted-key path was never the bug). This is a
  reliability/correctness fix, not a new access-control finding — no
  permission check was bypassed, and an org could already enable/disable
  its own rules. The same commit removed an unused `# noqa: F401`
  re-export of `ENFORCED_TRIGGERS`/`is_enforced`/`NotificationRule`/
  `NotificationTrigger` from `notification_rules.py`; grepped for any
  remaining importer of that re-export path and found none, so no dangling
  import was left behind.
- **New `EmailKind` members wired through `email_policy.py`
  (`MINUTES_ACTION_ITEMS`, `MINUTES_CIRCULATED`, `MINUTES_DUTIES`,
  `DOCUMENT_DUTIES`, `FUNDRAISING_DUTIES`, plus `EVENT_WAITLIST`/
  `EVENT_CHANGES` from an earlier pass's churn) — checked against Pitfall
  #19's exact failure mode: a switch with no reader.** Each new kind is
  correctly classified `required=False` (none are the record-of-notice or
  account-security class that must stay mandatory), and each has a real
  caller consulting it through `member_receives_email`/`recipients_for`/
  `is_required`, confirmed by grep rather than assumed: `MINUTES_ACTION_ITEMS`
  in `minutes_reminder_service.py` and `minutes_notifications.py`;
  `MINUTES_CIRCULATED` and `MINUTES_DUTIES` in `minutes_notifications.py`/
  `minutes_reminder_service.py`; `DOCUMENT_DUTIES` in
  `admin_only_folder_digest.py`; `FUNDRAISING_DUTIES` in
  `grant_reminder_notifications.py`; `EVENT_WAITLIST`/`EVENT_CHANGES` in
  `event_service.py`. None of the new kinds touches `SmsAlert` — correctly,
  since none is the time-critical, act-immediately class that allowlist is
  reserved for (confirmed `SmsAlert` still has exactly one member,
  `URGENT_DEPARTMENT_MESSAGE`, unchanged). `email_policy.py` itself (in this
  feature's own file set) needed no fix — the module's existing
  required/optional/master-switch/legacy-preference resolution order
  already covers every new kind without a special case.
- **New sender into the shared `email_service.py`/`email_template_service.py`
  machinery, reviewed for the same injection/escaping invariants MSG-6/
  MSG-7/MSG-14 established:** `ffbdaa09`'s
  `EmailService.send_event_cancellation_email` and the inline "Event
  Updated" email both go through `_render_with_fallback`
  (`email_service.py:511`) or the primary `render()` path, both of which
  HTML-escape every context variable by default and only skip escaping for
  names on the `_RAW_HTML_VARIABLES` allowlist
  (`email_template_service.py:3985`) — checked that allowlist directly and
  confirmed no new unescaped variable was added to it this pass.
  `event_title`, `recipient_name` and `reason` (the only user-influenceable
  values in the new context) are not on that list, so they are escaped.
  The sender (`event_service.py:_email_event_cancellation`/
  `_event_email_recipients`) loads recipients in one query filtered to
  `User.organization_id == organization_id` and `User.id.in_(ids)`, so a
  cross-tenant id in `notify_ids` cannot pull in another org's member.
  `90b69e62`'s Google Workspace welcome-email addition
  (`append_to_email_html`, `EmailService.send_welcome_email`'s new
  `appended_html`/`appended_text` parameters) carries a pre-escaped block
  built by `google_workspace_provisioning_service.google_credentials_html`,
  which `html.escape()`s both the address and the temporary password before
  interpolating them — checked directly, not assumed from the docstring's
  claim of "already escaped."
- **Mypy-cleanup batches (`265a26be`, `7879398d`, `c926b687`, `51c77a9c`,
  `0d4d7c5a`, `62828a9e`) touching this feature's files** — read every hunk
  touching a file in scope, not merely trusted the commit message's
  "behaviour unchanged" claim. All are type annotations
  (`UUID` → `UUID | str` on functions already called with `str` ids,
  `Optional` narrowing behind a filter that already excludes `None`) or a
  `.rowcount` → `rows_affected()` swap that only changes which exception
  type is raised on an unexpected `Result`. The one real behavior note —
  `retry_delay()` keeping its annotated return — matches the already-
  reviewed MSG-12 fix above; no site in this feature's files changed what
  it returns on any input it is actually called with.
- **Frontend:** `git log` path-filtered against pass 6's merge for the six
  swept paths (`modules/communications`, `modules/notifications`,
  `pages/NotificationsPage.tsx`, `components/NotificationCard.tsx`,
  `services/communicationsServices.ts`, `hooks/usePushNotifications.ts`)
  shows real churn, almost all of it the suggestion-box feature inside
  `modules/communications` (branching intake questions, rating/time/member/
  vehicle answer types, routing logic, dialog-scroll and dialog-semantics
  accessibility fixes) plus two unrelated features whose types happen to
  live in `communicationsServices.ts` (Locations' `LocationCreate` null-
  widening for Pitfall #1, and the Department-pulse dashboard-widget
  layout). Re-ran the same pattern sweep pass 5/6 used
  (`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
  date-formatting methods, direct `fetch(`) across all six paths — zero
  matches. Neither of the two misfiled-type commits touches messaging
  behavior: the Locations change is a type-only widening already following
  the correct `blankToNull` pattern, and the dashboard-pulse response is
  explicitly gated by `GET /dashboard/widgets`'s existing access check per
  its own commit message, not by anything this feature owns. All module
  axios usage still goes through the shared `apiClient` (`import api from
'./apiClient'`), not a local instance, so Pitfall #7 does not apply here.

### Re-verified still intact, not re-derived

Every other standing fix (MSG-1 through MSG-9, MSG-13, MSG-14, MSG-16, the
`cc_emails` legacy-read fix, MSG-11's migration-detector ratchet, W50-23's
escape/allowlist pattern) — re-confirmed by `git diff` showing zero change at
each citation since pass 6.

### Confirmed still open — unchanged, by design or pending a product decision

- **MSG-3** — `POST /message-history/test-email` sends to an admin-typed
  `to_email`, by design (an admin testing deliverability, not a member
  notification).
- **MAIL-4** — `POST /email-templates/schedule`'s `to/cc/bcc_emails` accept
  arbitrary addresses, by design (an admin composing a one-off scheduled
  send, same trust boundary as MSG-3).
- **`email_service.py`'s F4** — no SSRF-style validation on an
  org-configured SMTP host, a deliberate policy decision (an org's own
  admin configures its own outbound mail host).
- **The `NotificationRuleCreate`/`Update.config` unbounded-JSON note** —
  informational; `config: Optional[Any]` with no size guard, low severity
  (same-org, admin-only write), not re-flagged as a bug.

### Route inventory — re-enumerated, 51 routes (unchanged since pass 5)

`grep -c '@router\.\(get\|post\|put\|patch\|delete\)'` against all four
endpoint files: 13 + 2 + 20 + 16 = 51, matching pass 5/6 exactly. Spot-checked
every route's auth dependency directly (not merely counted) — all 51 carry
`Depends(get_current_user)` or `Depends(require_permission(...))`; no route
without an auth dependency was found. No permission string changed since
pass 6.

### Schema & migration notes

`validate_migrations.py --strict`: 612 revisions, single head (`c87efd81c5aa`),
up from pass 6's 538 — the growth is other features' work plus this pass's
own already-landed `b834afdaffdf` (MSG-12 retry columns, reviewed above:
guarded on table/column/index existence per Pitfall #26, `nullable=True` on
the one nullable column (`next_attempt_at`), symmetric downgrade that writes
`retrying` rows down to `failed` before dropping the columns it depends on).
No migration was added by this pass itself — every fix reviewed above had
already landed on `main` before this pass began; this pass's own commit is
documentation only (this file, `PROGRESS.md`, and the header/log entries).

## Guard tests added (pass 7)

None added by this pass. The guard tests for both closed findings
(`tests/test_message_delivery_retries.py`,
`tests/test_message_delivery_retries_migration.py`,
`tests/test_push_rebinding_guard.py`) were added by the commits that fixed
them, outside this review loop; re-run as part of this pass's scoped test
run (below) and confirmed passing.

## Completion gate (pass 7)

| Check                                                                                           | Result                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                   | clean (0 violations)                                                                       |
| `black --check app/ tests/ alembic/`                                                            | clean                                                                                      |
| `isort --check-only app/ tests/ alembic/` (installed 9.0.1, matching CI's pin)                  | clean                                                                                      |
| `python3 scripts/validate_migrations.py --strict`                                               | PASSED — 612 revisions, single head                                                        |
| backend tests, scope (`-k "message or notification or email_template or push or email_policy"`) | 1162 passed, 1 skipped (environment-only — `pywebpush`)                                    |
| `npm run typecheck` (frontend)                                                                  | 0 errors (after `npm ci` synced `node_modules` to the committed lockfile — see note below) |
| `npm run lint` (frontend, `eslint --max-warnings 10`)                                           | clean, exit 0                                                                              |

No code was changed by this pass, so the gate confirms current `main` is
clean rather than verifying a diff this pass produced, matching passes 5
and 6's own rationale. `npm run typecheck` initially failed with
`TS2307: Cannot find module '@tiptap/react'`/`'@tiptap/starter-kit'` —
`node_modules/@tiptap` was simply absent although both packages are
declared in `frontend/package.json` and already resolved in the committed
`package-lock.json` (added by an unrelated Minutes rich-text-editor
commit). This is an environment-sync gap, not an application or lockfile
defect: `npm ci` (never `npm install`, per CLAUDE.md's lockfile-safety
section) from the repo root installed exactly what the lockfile already
specified, and `npm run typecheck` was clean immediately after. No
`package.json`/`package-lock.json` edit was made.

## Pass 8 (2026-10-20) — watchdog pickup, 0 fixed, 0 new findings

**Step 0.** `search_pull_requests` (`is:open head:claude/security-review-`)
returned 0 results immediately before this pass started, and again
immediately before branching — no open security-review PR either time.
Row 25 (Messaging & notifications) was confirmed the first `⬜` row in the
rotation table on `main` (row 24, Meetings & minutes, had just merged as
PR #3456).

**Scope check.** Pass 7 landed as `5a12a331` (merge of PR #3373). Diffed
every file this feature's scope covers — the four endpoint files, both
models, both schemas, and the nine service/util files pass 7 enumerated —
against that merge commit rather than re-reading cold, per CLAUDE.md's
"match the verification to the change." `git log 5a12a331..HEAD` restricted
to those files surfaced five real commits (the rest of the range is merge
noise):

- **`51e2e9d7` — "Match probationary and retired message audiences on the
  membership ladder."** `messaging_service.py`'s `_is_targeted` now matches
  a `statuses`-targeted message on either the account status or, for
  `probationary`/`retired` only, the membership-ladder status
  (`LADDER_TARGETABLE_STATUSES`). Read in full: this is a correctness fix
  to who a message reaches, not an access-control change — the caller
  (`_targeted_users`, `messaging_service.py:1015`) still loads only
  `User.organization_id == organization_id` before matching, so the new
  second status field cannot pull in another org's member or widen the
  set beyond the message's own organization. No finding.
- **`c2aff901` — "Add weekly security and audit report emailed to the IT
  Manager."** Touches this feature's scope only through a new
  `EmailKind.SECURITY_REPORT` added to `email_policy.py`. Checked against
  Pitfall #19's exact failure mode (a switch with no reader): the sender,
  `app/services/security_weekly_report.py` (new file, outside this
  feature's own scope but read in full since it is the kind's only
  caller), resolves recipients through `recipients_for(candidates,
EmailKind.SECURITY_REPORT, department_required_kinds(organization))`
  (`security_weekly_report.py:372`) — a real, wired reader, not merely a
  stored config. Recipients are IT Manager position holders filtered
  `User.organization_id == org_id` / `Position.organization_id == org_id`
  (`:349-360`, both sides of the join scoped, closing the kind of gap
  Pitfall #14c warns about), falling back to
  `DocumentsService.active_full_administrators(org_id)` only when no
  holder exists. Every dynamic value in the email body goes through
  `html.escape()` (`_row()`, `build_subject()`, `build_body()`'s two
  `action()` calls) — no member name, username or event detail is
  included by design, only counts and a link, so there is no untrusted
  text surface beyond the organization's own name. The schedule/toggle is
  stored in `Organization.settings["security"]["weekly_report"]` and
  written back through a full `copy.deepcopy()` + whole-dict reassignment
  (`write_schedule()`/`_record_sent()`, `security_weekly_report.py:160-196`),
  not a shallow `dict()` copy, so Pitfall #12 does not apply. `read_schedule()`
  degrades every malformed stored field (non-bool `enabled`, out-of-range
  `weekday`/`hour`, unparseable `last_sent_at`) to its default rather than
  raising, matching Pitfall #19's "read free-form JSON defensively"
  corollary. The `GET`/`PUT /security/weekly-report` endpoint itself lives
  in `security.py`, which belongs to Feature 28 (Security, audit & IP) —
  noted here for completeness but not re-reviewed under this feature's PR,
  since `email_policy.py` is the only file in this feature's own scope the
  commit touched. No finding.
- **`d918810e` (workflow-review W57) — `message_history.py`'s
  `send_test_email`.** Before this fix, calling the test-send endpoint with
  email disabled server-side fell through to the success path and then
  raised writing a history row for an email that silently never went out,
  surfacing as a misleading 500. It now checks `email_svc.can_send` first
  and returns 400 with the reason. Pure reliability fix — the endpoint's
  existing `settings.manage` gate and MSG-3's by-design arbitrary-`to_email`
  behavior are unchanged; checked directly, not merely cited. No finding.
- **`14c8fd32` (workflow-review W55) — `messaging_service.py`'s
  `_validate_expiry` error strings reworded** ("The expiry time must be
  later than the scheduled time" / "...must be in the future"), same two
  `ValueError` sites, no behavior change. No finding.
- **`3e4deb06` (security-review AUTH pass 10) — `security_notifications.py`,
  AUTH-22.** `notify_security_event`'s inline (no-`background_tasks`)
  fallback now `html_escape()`s the member-facing message before
  interpolating it into `wrap_email_body`, closing a stored-XSS trap this
  feature's own file carried (no caller reached it with attacker text, per
  AUTH-22's own write-up, so it was not exploitable as shipped). Verified
  directly against current `security_notifications.py:80` and `:148` —
  both call sites now escape. Already fixed and documented under
  `AUTH-01-auth-session.md`'s own Pass 10 section; re-confirmed here because
  the file is in this feature's scope, not re-litigated as a new finding.

**Frontend:** `git log` path-filtered against `5a12a331` for the six paths
pass 5-7 swept (`modules/communications`, `modules/notifications`,
`pages/NotificationsPage.tsx`, `components/NotificationCard.tsx`,
`services/communicationsServices.ts`, `hooks/usePushNotifications.ts`) shows
four workflow-review accessibility passes (W55 messages, W56 notifications,
W57 email templates, W59 photo-use consent — the last sharing
`modules/communications`'s directory but not this feature's own
sub-feature). Read every diff in full rather than trusting the commit
summaries: all are `aria-label`/`touch:min-h-11`/focus-order/announcement
fixes, one `getErrorMessage()` swap so a compose-form failure shows the
server's actual reason instead of a generic retry prompt, and one
`useConfirm()`-based unsaved-changes guard on the email-template picker
(`EmailTemplatesPage.tsx`) — correctly the hook, not `window.confirm`.
Re-ran the same pattern sweep prior passes used (`window.confirm`/`alert`/
`prompt`, `dangerouslySetInnerHTML`, banned date-formatting methods, direct
`fetch(`, bare `??` on a form value) across all six paths plus the four
changed files specifically — zero matches. `aria-label={`Edit ${m.title}`}`
in `MessagesAdminPage.tsx` is set as a DOM attribute by React, not parsed as
markup, so a message title with HTML-looking characters cannot inject
through it.

### Specifically re-verified (per this pass's own instructions)

- **Pitfall #18 (SMS behind an allowlist):** `grep -rn "SMSService("` across
  `backend/app` finds exactly two call sites, both already gated —
  `notification_channels.py:126` (inside `resolve_sms_recipients` itself)
  and `message_delivery_service.py:582`, which only runs after
  `resolve_sms_targets(self.db, recipients, SmsAlert.URGENT_DEPARTMENT_MESSAGE)`
  (`:549`) has already filtered the audience. `SmsAlert` still has exactly
  one member. No new direct call bypasses the allowlist.
- **Pitfall #19 (config switch needs a reader):** `NotificationRuleResolver`
  (`notification_rules.py`) is unchanged since pass 7; its `_cache` is a
  per-instance dict scoped to one resolver's lifetime (constructed fresh per
  task run), not a module-level singleton, so it is not a Pitfall #9
  unbounded tracking dict. The new `SECURITY_REPORT` email kind (reviewed
  above) is the only new switch introduced since pass 7, and it has a real
  reader.
- **LIKE-pattern search:** every `.ilike(`/`.like(` in this feature's scope
  (`message_history.py:83-84`, `messaging_service.py:203-204`,
  `notifications_service.py:91-92`) still passes
  `escape=LIKE_ESCAPE_CHAR` with a `like_pattern()`-built pattern. No new
  site added since pass 7.
- **CSV exports:** this feature's scope contains no CSV export endpoint
  (`grep -rln "csv\."` across the four endpoint files and nine service
  files returns nothing); n/a, unchanged from prior passes.
- **JSON column mutations:** the one new nested-JSON writer this pass found
  (`security_weekly_report.py`'s `write_schedule`/`_record_sent`, reviewed
  above) uses `copy.deepcopy()` + whole-value reassignment, not a shallow
  `dict()` copy. `NotificationRule.config` is read-only in this feature's
  own code (merged into a fresh dict via `{**config, **rule.config}`,
  `notification_rules.py:105`); nothing in scope mutates a JSON column's
  nested keys in place without `flag_modified()`.
- **Unbounded in-memory tracking dicts:** `message_delivery_service.py`'s
  rate limiting (`_EMAIL_ESCALATION_LIMIT`/`_SMS_ESCALATION_LIMIT`) goes
  through `is_rate_limited()` (Redis-backed, reviewed under SEC-00), not a
  local dict. No module-level `Dict`/`{}` tracking structure exists in
  `push_service.py`, `notification_channels.py`, or
  `message_delivery_service.py` beyond the per-instance resolver cache
  above.
- **Frontend `||` vs `??`:** no new optional-string form field was added in
  this pass's frontend delta (all four real commits are accessibility/copy/
  error-display changes to existing fields); nothing to check.
- **Email template rendering / SSTI:** `email_template_service.py`'s
  `_replace_variables` (`:4023`) is a bounded regex substitution
  (`r"\{\{(\s*\w+\s*)\}\}"`) against a fixed `context` dict — there is no
  Jinja2 `Environment`/`Template`/`from_string` anywhere in
  `backend/app` (confirmed by `grep -rn "jinja2" backend/app`, zero hits),
  so there is no expression-evaluation surface for SSTI, only the existing
  HTML-escaping question MSG-6/7/14 already settled. An unknown `{{name}}`
  placeholder (one not in `context`) renders as empty string, not
  verbatim, so a crafted variable name cannot leak internals either.

### Re-verified still intact, not re-derived

Every standing fix (MSG-1 through MSG-9, MSG-11 through MSG-16, the
`cc_emails` legacy-read fix, W50-23's escape/allowlist pattern) — re-confirmed
by `git diff` showing zero change at each citation since pass 7.

### Confirmed still open — unchanged, by design or pending a product decision

- **MSG-3** — `POST /message-history/test-email` sends to an admin-typed
  `to_email`, by design.
- **MAIL-4** — `POST /email-templates/schedule`'s `to/cc/bcc_emails` accept
  arbitrary addresses, by design, same trust boundary as MSG-3.
- **`email_service.py`'s F4** — no SSRF-style validation on an
  org-configured SMTP host, a deliberate policy decision.
- **The `NotificationRuleCreate`/`Update.config` unbounded-JSON note** —
  informational, low severity, unchanged.

### Route inventory — re-enumerated, 51 routes (unchanged since pass 5)

`grep -c '@router\.\(get\|post\|put\|patch\|delete\)'` against all four
endpoint files: 13 + 2 + 20 + 16 = 51, matching every prior pass since pass 5
exactly. Every route's body was scanned programmatically (not merely
counted) for `get_current_user`/`require_permission`/
`require_all_permissions` within its own definition — all 51 carry one. No
permission string changed since pass 7.

### Schema & migration notes

`validate_migrations.py --strict`: 631 revisions, single head
(`ca0c2111466f`), up from pass 7's 612 — growth is other features' work; no
migration touching this feature's tables was added since pass 7's own
`b834afdaffdf`.

## Guard tests added (pass 8)

None added. This pass found no new finding to guard; the guard tests added
by `51e2e9d7`, `c2aff901` and `3e4deb06`'s own commits
(`tests/test_messaging_service.py` audience-matching cases,
`security_weekly_report`'s own test module, and AUTH-01's push-rebinding/
escaping guard) were re-run as part of this pass's scoped test run below and
confirmed passing.

## Completion gate (pass 8)

| Check                                                                        | Result                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                | clean (0 violations)                                    |
| `black --check app/ tests/ alembic/`                                         | clean                                                   |
| `isort --check-only app/ tests/ alembic/` (reinstalled to CI's pinned 9.0.1) | clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                            | PASSED — 631 revisions, single head `ca0c2111466f`      |
| backend tests, scope (`-k "message or notification or email_template"`)      | 1064 passed, 1 skipped (environment-only — `pywebpush`) |
| `npm run typecheck` (frontend)                                               | 0 errors                                                |
| `npm run lint` (frontend, `eslint --max-warnings 10`)                        | clean, exit 0                                           |

No code was changed by this pass, so the gate confirms current `main` is
clean rather than verifying a diff this pass produced, matching passes 5-7's
own rationale.

## Pass 9 (2026-10-24) — watchdog pickup, 0 fixed, 0 new findings

Scheduled watchdog check-in: the dedicated loop session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was not reachable (`ListAgents`). PR
#3636 (Feature 24, Meetings & minutes, pass 9) was found open, green on
every CI check and `mergeable_state: clean`, with no unresolved review
comment (the only review activity was a Codex bot run that failed outright
from hitting its own usage limit — an external tool error, not a finding)
— merged by this same watchdog run. `search_pull_requests`
(`head:claude/security-review-`) returned 0 immediately after. Row 25
(Messaging & notifications) was confirmed the next `⬜` row in
`docs/security-review/PROGRESS.md`'s rotation table on a freshly fetched
`main` (head `53779a30`, carrying PR #3636's merge).

Baseline `cd58d784` (PR #3457's squash, pass 8). Five non-merge commits
touch this feature's declared scope since then, all read in full:

- **Explicit-null tightening** (`609e04d21`) — `NotificationLog.pinned` and
  `DepartmentMessage.is_persistent` moved from `Optional[bool]` to
  `nullable=False` with a server default, matching the upgraded schema;
  `MessagingService`'s own update path now calls
  `reject_null_for_required` before applying `updates`, so an explicit
  `null` aimed at either column is refused with a clear `ValueError` (→ 400
  via the existing `except Exception` → `safe_error_detail` wrapper) instead
  of reaching MySQL as error 1048.
- **Shared file-storage interface** (`b92da7f3a`) — `email_templates.py`'s
  attachment delete and `email_service.py`'s Cloudflare/SMTP attachment
  paths now call `file_storage_service.exists/read_bytes/plaintext_size/
delete` instead of bare `os.path.isfile`/`file_encryption.read_plaintext`/
  `os.remove`. Behaviour is unchanged (the only backend is still the local
  volume); the attachment-delete path's org-scoped path confinement
  (`email_attachment_paths.resolve_email_attachment_path`) runs exactly as
  before, upstream of the new `file_storage.delete()` call — re-verified by
  reading the full diff, not merely the import swap.
- **Role deletion untargets messages** (`128147e72`,
  `release_role_from_messages` in `messaging_service.py`) — new function,
  called from `RoleService.delete_role` (`role_service.py:497`) after the
  role has already been resolved through an org-scoped `get_role(db,
role_id, organization_id)`. Its own query additionally filters
  `DepartmentMessage.organization_id == str(organization_id)`, so it cannot
  touch another org's messages even if called with a wrong id (it isn't —
  the id and name come from the already-resolved `role`). Mutates
  `target_roles` by reassigning a new filtered list (`kept = [...]`), not an
  in-place `.remove()`, so the JSON-column change is seen and written
  (Pitfall #12 — no `flag_modified` needed because this is a full
  reassignment). Row selection takes `.with_for_update()`, serializing
  against a concurrent audience edit.
- **Same commit, `_drop_vanished_stored_targets`** — on message update, an
  audience id/role already stored on the message is dropped if it no longer
  resolves (a member hard-deleted, a role deleted after the message was
  written), so editing an unrelated field no longer fails validation over a
  stale reference the editor can't see or fix. Traced the boundary this
  creates deliberately: the filter keeps an entry when `str(m) in existing`
  **or** `str(m) not in stored` — i.e. an entry already on the message is
  kept only if it still resolves, but an entry _not_ previously stored (a
  genuinely new id the caller is adding) is left untouched by this
  function and still has to pass the unchanged `_validate_targeting` check
  immediately after, which raises `ValueError` on any id that doesn't
  resolve in-org. Confirmed by reading both call sites together — this
  cannot be used to plant an unresolvable or cross-org id, only to stop a
  vanished one from blocking an otherwise-valid save.
- **Scheduled-email cancel: row lock + audit + soft state** (`128147e72`,
  `email_templates.py`) — `cancel_scheduled_email` and
  `update_scheduled_email`'s cancel branch both now take
  `.with_for_update()` on the same org-scoped `ScheduledEmail` row the
  background sender locks before sending, so a cancel can no longer race a
  send already in flight (the sender finds the row `CANCELLED`, not
  `PENDING`, under the same lock). Cancel now sets `CANCELLED` instead of
  deleting the row (history/audit preserved) and logs
  `scheduled_email_cancelled` with `recipient_count` rather than the actual
  addresses — no PII in the audit payload. A second cancel of an
  already-cancelled row is now a no-op (`return` before any write) rather
  than hitting the `SENT`-only guard it fell through to before.
- **Timezone correctness pair** (`29064e36b`, `45f8d92b1`) — net effect on
  current `main`: `schedule_email`/`update_scheduled_email` still refuse a
  naive `scheduled_at` with a 400 (the guard was removed by the first
  commit assuming a schema-level `UTCDateTime` annotation, then restored by
  the second alongside an explicit `as_utc()` conversion before storage).
  Comparison against `datetime.now(timezone.utc)` is therefore always
  tz-aware on both sides; no TypeError path. Correctness-only, no
  authorization or tenancy surface.

**0 new findings.** All five commits reviewed against every applicable
`CHECKLIST.md` dimension; none introduce a new route, change a permission
string, or touch SMS/CSV/LIKE-pattern/JSON-shape code (confirmed by `grep`
re-sweeps below).

### Re-swept, unchanged since pass 8

- `grep -rn "SMSService("` across `backend/app`: still exactly the same two
  gated call sites (Pitfall #18); no direct call added.
- `.ilike(`/`.like(` sites in this feature's scope
  (`message_history.py:83-84`, `messaging_service.py:203-204`,
  `notifications_service.py:91-92`): unchanged, still pass
  `escape=LIKE_ESCAPE_CHAR` with a `like_pattern()`-built pattern.
- CSV export: still none in this feature's scope.
- `jinja2` in `backend/app`: still zero hits — no new template-evaluation
  surface for the email-template `{{var}}` substitution.

### Standing findings — re-confirmed open/unchanged

- **MSG-3** — `POST /message-history/test-email` sends to an admin-typed
  `to_email`, by design. Unchanged.
- **MAIL-4** — `POST /email-templates/schedule`'s `to/cc/bcc_emails` accept
  arbitrary addresses, by design, same trust boundary as MSG-3. Unchanged.
- **`email_service.py`'s F4** — no SSRF-style validation on an
  org-configured SMTP host, a deliberate policy decision. Unchanged.
- **`NotificationRuleCreate`/`Update.config` unbounded-JSON note** —
  informational, low severity, unchanged.

### Route inventory — re-enumerated by AST, 51 routes (unchanged since pass 5)

Walked all four endpoint files' decorators by AST rather than trusting the
prior count: 13 (`messages.py`) + 2 (`message_history.py`) + 20
(`notifications.py`) + 16 (`email_templates.py`) = **51**, matching pass 8
exactly. Every route body carries `require_permission`,
`require_all_permissions`, or `get_current_user`/`get_current_active_user`
with the narrower check made in the handler.

### Schema & migration notes

`validate_migrations.py --strict`: 649 revisions, single head
`a0195b397bf3`, up from pass 8's 631 — growth is other features' work.
Migration `6dce1364ff7e` (part of `609e04d21`, the explicit-null-tightening
commit) touches `notification_log.pinned`/`department_messages.
is_persistent` among its 99 columns across 36 tables; re-read in full —
guarded by existence checks per CLAUDE.md Pitfall #26/#35 (skips an absent
table, sets stored NULLs to the column's default before adding `NOT NULL`),
consistent with the rest of that migration's handling of the other 97
columns it touches outside this feature's scope.

## Guard tests added (pass 9)

None added — no new finding. `tests/test_explicit_null_writes.py`'s
coverage of `NotificationLog.pinned`/`DepartmentMessage.is_persistent` and
`tests/test_storage_operations.py`'s coverage of the attachment
read/delete paths (both added by other work, not this pass) were exercised
by this pass's scoped test run below and confirmed passing.

## Completion gate (pass 9)

| Check                                                                   | Result                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | clean (0 violations)                                     |
| `black --check app/ tests/ alembic/`                                    | clean — 2,606 files unchanged                            |
| `isort --check-only app/ tests/ alembic/`                               | clean                                                    |
| `python3 scripts/validate_migrations.py --strict`                       | PASSED — 649 revisions, single head `a0195b397bf3`       |
| `python3 scripts/check_route_permissions.py --strict`                   | 273 routes, 0 errors, 0 warnings                         |
| backend tests, scope (`-k "message or notification or email_template"`) | 1,084 passed, 1 skipped (environment-only — `pywebpush`) |
| `npm run typecheck` (frontend)                                          | 0 errors                                                 |
| `npm run lint` (frontend, `eslint --max-warnings 10`)                   | clean, exit 0                                            |

No source file was changed by this pass — every behavioral delta since
pass 8 was landed by other, non-rotation work and independently
re-verified here against all seven `CHECKLIST.md` dimensions.

## Pass 10 (2026-10-27) — watchdog pickup, real delta (Gmail delegated sending + SMTP batch hardening), 1 new finding fixed

Scheduled watchdog check-in (dedicated `/loop 30m /security-review` session
`session_011T1ZyyLrD5HagusgK9uDw2` unreachable via `ListAgents`). PR #3767
(Feature 24, Meetings & minutes, pass 10) was found open, `mergeable_state:
clean`, every one of its 24 checks `success` — the one non-green comment on
the thread was this same watchdog's own, explaining a `Backend Integration
Tests (MySQL 8.0)` cancellation at the 30-minute job timeout as margin, not
a real failure, and recording the one standing re-run, which came back
green. Merged. `search_pull_requests` (`head:claude/security-review-`)
returned 0 immediately after. Row 25 (Messaging & notifications) confirmed
the next `⬜` row in `docs/security-review/PROGRESS.md`'s rotation table on
`main` at `d975bc61`.

Baseline: pass 9's merge, `5fc3f60c` (PR #3638). `git log
5fc3f60c..HEAD` against every file this feature's pass 1 scope declares
surfaced five non-merge commits, all outside this rotation, all read in
full:

- **SMTP batch sender: resend-once on a transient reply, stop on quota,
  never log a recipient address** (`14a8d447`, `680d6c4d`,
  `email_service.py`) — a 421/451/452 reply now resends the same message
  once after reconnecting instead of recording it failed outright; a
  sending-quota reply (Gmail's `5.4.5`, Exchange Online's
  `SubmissionQuotaExceededException`, and its `432` concurrent-connections
  throttle) stops the batch and reports the untried remainder failed rather
  than retrying every later message into the same refusal; a failed
  reconnect now ends the batch keeping the results already collected,
  instead of raising past messages already delivered as failed.
  `SMTPRecipientsRefused`'s per-recipient replies are now read for the
  quota/rate-limit check too, with the recipient addresses themselves
  dropped before anything is logged (`_smtp_replies` strips them) — matches
  Pitfall #33's "an id rather than user-supplied text" and the pre-existing
  `_redact_email` convention elsewhere in this file. At most one resend per
  message (`for attempt in range(2)`), so this cannot turn into a retry
  storm; a message already accepted by the server before a drop is a risk
  inherent to SMTP itself, not something this change could introduce or
  fix. `test_smtp_batch_send.py` (161 + 42 new lines) exercises all three
  fixes plus the pre-existing reconnect/pacing behavior.
- **Gmail delegated service-account sending** (`097883d8`,
  `google_oauth.py` new, `gmail_api_sender.py` new, `email_providers.py`,
  `email_service.py`, `email_test_helper.py`, plus
  `organizations.py`/`organization_service.py`/`schemas/organization.py`,
  which are Feature 07's files, read here only to verify this feature's own
  trust boundary) — a Workspace department can now send as a domain-wide
  delegated service account instead of an App Password, through the Gmail
  API (`gmail.send` scope only — the docstring explains why SMTP's
  `https://mail.google.com/` scope was rejected: full mailbox read/delete,
  which delegation cannot narrow to one mailbox) rather than SMTP.
  Reviewed end to end against this feature's trust boundary:
  - `google_oauth.py`'s credential cache is capped at 32 entries with LRU
    eviction (Pitfall #9), keyed on a SHA-256 of the key material and
    subject, not the raw key; the google-auth transport is wrapped with an
    explicit 10 s timeout (`_TimedRequest`) rather than the library's
    120 s default, so an unreachable token endpoint cannot hold a worker
    thread that long per message; a key that fails to parse raises through
    a message that never echoes key material.
  - **MSG-17 — MEDIUM — FIXED, found in this same pass's own re-reading of
    this bullet's file.** `parse_service_account_key` validated that
    `token_uri` was present and non-empty, but never that it was Google's
    own token endpoint. `google.oauth2.service_account.Credentials
.refresh()` POSTs the signed JWT assertion to exactly the URL the parsed
    key names — so an org admin (the only caller who can reach this, via
    the `settings.manage`/`admin.access`-gated email-settings save/test
    endpoints described in the next two bullets) could submit a key with
    `token_uri` pointed at an internal address (cloud metadata, an
    internal admin API) and the backend would POST to it on every send or
    "Test connection" click. This is a different URL than the "Fixed
    Google endpoint URL (no SSRF surface)" the `gmail_api_sender.py` bullet
    below correctly describes — that one is the fixed send endpoint; this
    one is the _token_ endpoint, read from the submitted key itself, and it
    had no equivalent fixed-value check. It is the same SSRF shape
    `microsoft_oauth.py`'s sibling module already guards against for its
    own interpolated `tenant_id` (`validate_tenant_id`'s GUID/domain regex,
    with the comment "a value carrying a slash or an @ would redirect the
    token request to a host the department never named") — this module
    simply never added the equivalent check for its own admin-controlled
    URL field. Every real Google Cloud service-account key has `token_uri`
    fixed at `https://oauth2.googleapis.com/token`, so there is no
    legitimate value to allow other than that one — unlike `smtp_host`
    (F4, below), where a department may legitimately want an internal
    relay. **Fixed** by rejecting any `token_uri` other than Google's own
    endpoint in `parse_service_account_key` — the single choke point every
    caller (write-time validation, the client-id shown on every settings
    read, and send/test-time token acquisition) already goes through, so
    one change closes it everywhere with no other call site to update, and
    no behavior change for any legitimate key. Guard test added:
    `tests/test_google_oauth.py::TestParseKey::
test_rejects_a_token_uri_pointed_elsewhere` (submits a key with `token_uri`
    pointed at `169.254.169.254`, the common cloud-metadata address, and
    asserts `GoogleOAuthError`) — verified to fail against the pre-fix code
    (reproduced by reverting just this check and re-running the test: `DID
NOT RAISE GoogleOAuthError`) and to pass with the fix restored,
    alongside the rest of `test_google_oauth.py` (19/19, up from 18) and
    `test_gmail_api_sender.py` (unaffected, still 23/23).
  - The new `google_service_account_key` settings field was added to the
    pre-existing `EMAIL_SECRET_FIELDS` tuple in `email_providers.py`
    (alongside `smtp_password`/`google_app_password`, which already rode
    `organization_service.py`'s `encrypt_settings_secrets`/
    `decrypt_settings_secrets` and `_redact` round trip) — it is encrypted
    at rest and redacted on read by the existing generic mechanism, not a
    new one. Confirmed by reading `update_organization_settings`
    (`organization_service.py:440-585`) in full rather than trusting the
    docstring: identity-change clearing, the `REDACTED_SECRET` marker
    round-trip, and the deep-merge-before-encrypt ordering all apply to it
    exactly as they do to the fields that predate it.
  - **Permission level matches sensitivity (CHECKLIST §2, the XC-2
    pattern this rotation watches for):** because a delegated key can send
    as any user in the domain, choosing it, changing the From address
    while using it, or replacing the key is gated on `admin.access` — read
    server-side via `user_has_permission(current_user, "admin.access")` at
    the endpoint and passed into the service as `may_configure_delegated_
email`, never trusted from the client — while every other
    settings change (toggling email off, a new display name, switching
    away from the service account) stays open to the pre-existing
    `settings.manage`. The test-connection endpoint
    (`POST /settings/email/test`) itself stays gated at `settings.manage`
    (unchanged — it predates this commit): it acquires a token for a
    caller-supplied key without saving anything, so it is not a privilege
    bypass of the admin-only save path — the caller already holds whatever
    key they're testing, redacted-marker resolution against the stored key
    included, and that round-trip already existed for every other
    provider's secret before this commit.
  - `gmail_api_sender.py`: recipients not already in `To`/`Cc` are added as
    a `Bcc` header (the Gmail API has no SMTP envelope); each address has
    `\r`/`\n` stripped before being placed in that header — a header-
    injection guard, not merely a formatting one. Fixed Google endpoint URL
    (no SSRF surface — not caller-configurable). A `429` or Gmail's
    rate-limit `reason` codes retry once with a bounded wait
    (`GMAIL_MAX_RETRY_WAIT_SECONDS = 60`); anything larger stops the batch,
    mirroring the SMTP sender's own quota-stop logic above.
  - `email_test_helper.py`'s new `_test_google_service_account_connection`
    sends nothing — acquiring the token is the whole test — matching the
    settings screen's existing "test doesn't send mail" contract for every
    other provider.
  - Migration `08e6220f2dce`: widens `EmailTemplateType` by two new values
    only (no row writes), guarded by `_has_table` and an idempotent
    re-entry check per Pitfall #26/#35; re-read in full. (This migration
    was one of three parallel heads at the time it was written; a
    different pass's own completion gate already resolved that fork with
    merge revision `f5426e40b955` — confirmed by `alembic heads` showing a
    single head, `c616fa1bd492`, with `08e6220f2dce` on the path to it.)
- **Pipeline stage email now sends its linked custom template**
  (`c91b309d`, `04af8b97`) — an automated-email pipeline stage's optional
  linked template is now actually read at send time and rendered with
  `first_name`/`last_name`/`prospect_name`/`stage_name`/`status_url`,
  falling back to the old section-built email when the link is off,
  missing, or not a custom template. The stage's own enabled sections
  (welcome message, FAQ link, next-meeting block, status-tracker link,
  custom sections) are appended after the template body via `render()`'s
  new `appendix_html`/`appendix_text` parameters. Traced every value that
  reaches `appendix_html` (`membership_pipeline_service.py:5120-5257`):
  `welcome_message`, `faq_url`, `meeting_lines`, `status_url`, and each
  custom section's `title`/`content` are individually `html.escape()`d
  before being concatenated into the appendix string, and `render()`
  substitutes that pre-escaped string as a single `{{_appendix_html}}`
  variable value rather than splicing it into the template source — so
  `{{...}}` typed inside an admin's own custom-section content can never
  be re-expanded against the render context (no second-order template
  injection). `first_name`/`last_name`/`prospect_name`/`stage_name` travel
  through the template's own `context` dict and get the template engine's
  normal variable-substitution escaping, same as every other template
  variable. New template types' default wording carries the exact text
  the hardcoded emails had, so no applicant-facing copy changed under this
  rewrite. Two full new test files
  (`test_pipeline_stage_email_template.py`, 313 lines;
  `test_prospect_email_templates.py`, 196 lines) exercise the fallback
  paths and the escaping.

**One new finding (MSG-17, above), fixed.** None of the five commits add a
route, change a permission string on this feature's own four endpoint
files, or touch SMS/CSV/LIKE-pattern code in this feature's scope.

### Frontend — two commits since pass 9, both reviewed

Missed by this pass's first pushed revision (caught and added before merge,
since the backend-only `git log` restricted to this feature's pass-1-scoped
_backend_ files does not surface a frontend-only commit): `git log
5fc3f60c..HEAD` against `modules/communications`, `modules/notifications`,
`pages/NotificationsPage.tsx`, `hooks/usePushNotifications.ts`,
`components/NotificationCard.tsx`, and `services/communicationsServices.ts`
surfaces two real commits, both read in full.

- **`NotificationsPage.tsx` gained Edit and Delete on the Rules screen**
  (`bd15c709`) — PATCH and DELETE already existed; the screen could only
  create and toggle. Both actions are gated on `canManage` =
  `checkPermission('notifications.manage')`, matching the backend's
  `update_rule`/`delete_rule` permission exactly (re-confirmed at
  `notifications.py:111-134`, unchanged). Delete goes through `useConfirm()`
  — no `window.confirm` (Pitfall #16) — with a warning naming the concrete
  effect (a trigger's notifications switching on or off department-wide)
  when the rule being removed or re-pointed is the one keeping a trigger's
  default behavior from applying; that effect is computed client-side
  (`effectOfRemoving`/`triggerSends`) purely for the confirmation copy, not
  trusted for anything the backend decides. The edit payload sends a
  cleared description as an explicit `null` via `blankToNull` (Pitfall #1,
  update side — every field the dialog owns is sent, matching the backend's
  `exclude_unset`/`apply_updates` contract already re-verified at MSG-5).
- **`TemplateList.tsx` gained a "Prospective Members" category**
  (`e004da9a`) — three existing template-type ids moved from the "Members &
  Accounts" group into a new group label. Pure UI regrouping of an existing,
  already-permission-gated list; no new data reaches the screen and no
  security surface.

### Re-swept, unchanged since pass 9

- `grep -rn "SMSService("` across `backend/app`: still exactly the two
  gated call sites from Pitfall #18; no direct call added by the Gmail or
  SMTP-batch work.
- `.ilike(`/`.like(` sites in this feature's scope
  (`message_history.py:83-84`, `messaging_service.py:245-246`,
  `notifications_service.py:91-92`): unchanged, still pass
  `escape=LIKE_ESCAPE_CHAR` with a `like_pattern()`-built pattern.
- CSV export: still none in this feature's scope.

### Standing findings — re-confirmed open/unchanged

- **MSG-3** — `POST /message-history/test-email` sends to an admin-typed
  `to_email`, by design. Unchanged.
- **MAIL-4** — `POST /email-templates/schedule`'s `to/cc/bcc_emails` accept
  arbitrary addresses, by design, same trust boundary as MSG-3. Unchanged.
- **`email_service.py`'s F4** — no SSRF-style validation on an
  org-configured SMTP host, a deliberate policy decision. Unchanged.
- **`NotificationRuleCreate`/`Update.config` unbounded-JSON note** —
  informational, low severity, unchanged.

### Route inventory — re-enumerated by AST, 51 routes (unchanged since pass 5)

Walked all four endpoint files' decorators by AST rather than trusting the
prior count: 13 (`messages.py`) + 2 (`message_history.py`) + 20
(`notifications.py`) + 16 (`email_templates.py`) = **51**, matching pass 9
exactly. No new route in this feature's four declared endpoint files.

### Schema & migration notes

`validate_migrations.py --strict`: 663 revisions, single head
`c616fa1bd492`, up from pass 9's 649 — growth is other features' work,
including the three-way fork-and-merge noted above.

## Guard tests added (pass 10)

- `tests/test_google_oauth.py::TestParseKey::test_rejects_a_token_uri_pointed_elsewhere`
  (MSG-17) — the one test this pass added itself. Verified to fail against
  the pre-fix code and pass with it.

The five reviewed commits' own new test files (`test_smtp_batch_send.py`'s
additions, `test_pipeline_stage_email_template.py`,
`test_prospect_email_templates.py`) and the pre-existing
`test_gmail_api_sender.py`, `test_gmail_service_account_settings.py` were
exercised by this pass's scoped test run below and confirmed passing.

## Completion gate (pass 10)

| Check                                                                                                                                                   | Result                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                           | clean (0 violations)                                     |
| `black --check app/ tests/ alembic/`                                                                                                                    | clean — 2,695 files unchanged                            |
| `isort --check-only app/ tests/ alembic/`                                                                                                               | clean                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                                                       | PASSED — 663 revisions, single head `c616fa1bd492`       |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                   | 279 routes, 0 errors, 0 warnings                         |
| Backend tests, scope (`-k "message or notification or email_template or smtp_batch or gmail or google_oauth or pipeline_stage_email"`)                  | 1,240 passed, 1 skipped (environment-only — `pywebpush`) |
| `cd frontend && npm run typecheck` (after `npm ci` from the repo root — sandbox predated `@simplewebauthn/browser`; environment gap, not a code defect) | 0 errors                                                 |
| `cd frontend && npm run lint` (`eslint --max-warnings 10`)                                                                                              | clean, exit 0                                            |
| Scoped frontend suite (`src/modules/prospective-members`, 35 files)                                                                                     | 316 passed                                               |
| Scoped frontend suite (`src/modules/communications`, 37 files)                                                                                          | 271 passed                                               |

One source file was changed by this pass: `app/utils/google_oauth.py`
(MSG-17's fix, 10 lines). Every other behavioral delta since pass 9 was
landed by other, non-rotation work and is reviewed/recorded, not authored,
here.

## Pass 11 (2026-10-30) — watchdog pickup, real delta (template on/off switch, generic-webhook dispatch), 0 fixed, 0 new findings

Scheduled watchdog check-in (dedicated `/loop 30m /security-review` session
`session_011T1ZyyLrD5HagusgK9uDw2` unreachable via `ListAgents`, "No
reachable agents"). PR #3849 (Feature 24, Meetings & minutes, pass 11) had
already merged (`52bb15d5`) before this iteration started;
`search_pull_requests` (`head:claude/security-review-`) returned 0 open
results both then and again right before this push. Row 25 (Messaging &
notifications) confirmed the next `⬜` row in `PROGRESS.md`'s rotation table.

Baseline: pass 10's merge, `02bdfb59` (PR #3768). `git log 02bdfb59..HEAD`
against every file this feature's pass-1 scope declares surfaced **8**
non-merge commits, all outside this rotation, all read in full (not cited
from their own commit messages):

- **Stop sending an email whose template is switched off** (`0a7e2a9e`) —
  until now, switching a template Off in Communications → Email Templates
  only made its sender fall back to the built-in default; the email kept
  going out regardless. `EmailTemplateService.is_switched_off(org, type)`
  now answers true only when the department has a stored row of that type
  and none of them is active — read directly: a department that never
  opened the screen has zero rows and `bool(states) and not any(states)`
  is `False`, so every existing installation keeps sending exactly as
  before until an admin explicitly switches something off (no silent
  behavior change on upgrade, the Pitfall #19 shape handled correctly this
  time). `ALWAYS_SENT_TYPES` (password reset, IT password notification,
  welcome, ballot notification, application status link, plus the two
  types two other commits below add to it) cannot be switched off:
  `update_template` raises `ValueError` — correctly caught by the endpoint
  and turned into a 400 via `safe_error_detail()`, not a 500 — before the
  allowlisted-field `apply_updates` call ever runs, and the by-id lookup
  backing it is `WHERE id = :template_id AND organization_id =
:organization_id` (XC-3 — re-read at `email_template_service.py:3993-4008`,
  unchanged). `EmailService._render_unless_switched_off` wraps all 16
  template-backed `send_*` methods (re-counted, not trusted from the
  commit message) and **fails open** on a lookup error — deliberate and
  correctly scoped: the comment at `email_service.py` names the tradeoff
  explicitly ("an email the department wants must not be lost to a lookup
  error, and an unwanted one is a nuisance"), and a transient failure to
  read one org's own on/off flag is not a tenant-isolation or
  authentication control, so fail-open here does not fall under the
  CLAUDE.md Attack Protection table's fail-closed list (CAPTCHA,
  suspicious-IP block). Frontend (`51d23961`): the toggle now asks before
  switching an email off (`useConfirm()` — not `window.confirm`, Pitfall
  #16) and disables itself for an `always_sent` template with a tooltip
  naming why, matching the backend's own refusal — client-side convenience
  only, the 400 above is the actual control.
- **Welcome email: load its template through the standard render path**
  (`0466a78e`) — `send_welcome_email` used to load the Welcome template
  itself just to read its stored attachments, bypassing
  `_render_unless_switched_off`'s path (harmless in practice, since Welcome
  is `ALWAYS_SENT_TYPES` and the old path never skipped it either, but a
  second, divergent lookup path for one email type is exactly the shape
  that drifts). Now goes through `_render_unless_switched_off` →
  `_render_with_fallback` like every other sender; attachments travel out
  through a new `attachments_out` list parameter, confined to
  `self.organization` (re-read: the attachment query already filtered by
  the template's own organization before this commit, unchanged).
- **Add the Follow-up Form pipeline stage** (`27a363f1`) and **Add
  follow-up form reminders, coordinator notice and answer display**
  (`a36d27f1`) — Feature 08's (Membership pipeline) own feature, read here
  only for the two new `EmailService` senders
  (`send_follow_up_form_email`, `send_contact_changed_email`,
  `send_follow_up_reminder_email`) and two new `EmailTemplateType`s they
  add to this feature's shared registry. Traced every context value by
  hand: `custom_message` (admin-typed) is the only one not carried through
  the template engine's own `{{var}}` substitution, and it is
  `_html.escape()`d into `custom_message_html` before being handed in —
  the resulting pre-escaped string is then correctly listed in
  `_RAW_HTML_VARIABLES` (`email_template_service.py:4614`) so the renderer
  does not escape it a second time (which would show literal `&lt;p&gt;`
  tags, a correctness bug, not a security one, had it been forgotten in
  the other direction). `draft_note_html` (`a36d27f1`) is a hardcoded
  constant, no user input, correctly listed in the same allowlist. Every
  other context value (`first_name`, `applicant_name`, `form_name`,
  `form_url`, `changed_details`) is **not** in the allowlist, so it gets
  the template engine's default `html.escape()` — confirmed by reading
  `_replace_variables` directly (`email_template_service.py:4629-4661`)
  rather than trusting the docstring. `send_contact_changed_email` is
  deliberately told only a changed-field label, never the new value
  (per its own docstring, verified against its one caller in Feature 08's
  service) — an old-address notice that echoed the new email/phone would
  be a disclosure to whoever controls the old mailbox if it had been
  taken over, which is exactly the scenario the email exists to warn
  about.
- **Email coordinators and applicants when an application goes stale**
  (`1a9810fc`) — Feature 08's feature (an unread settings toggle finally
  wired to a sender, the Pitfall #19 shape, already fixed correctly here);
  read for its two new `EmailService` senders
  (`send_inactivity_warning_email`, `send_application_going_inactive_email`).
  Same pattern: every context value passes through the template engine's
  default escaping, nothing added to `_RAW_HTML_VARIABLES`.
- **Send four emails through the templates that describe them**
  (`1ff282b9`) — Cert Expiration, Post-Event Validation, Post-Shift
  Validation and Member Archived now render through
  `EmailTemplateService.render_stored_or_default` (new) instead of
  building their own strings; this feature's own file gained the method.
  `render_stored_or_default(organization, ...)` resolves the template via
  `get_template(str(organization.id), template_type)` — org-scoped,
  re-read at the call site, unchanged shape from the pre-existing
  `get_template`. No new escaping surface: it delegates to
  `render_static`/`render_default`, which already go through
  `_replace_variables`.
- **Match emails by fingerprint and keep addresses out of new audit
  entries** (`43c11090`) — a repo-wide sweep's share of this feature:
  `message_history.py`'s search now matches a complete recipient address
  through `email_fingerprints(search)` against a new
  `MessageHistory.recipient_fingerprints` JSON column
  (`func.json_contains(...) == 1`, OR'd onto the existing subject
  `ilike`), rather than the old plaintext `to_email.ilike(...)`. Verified
  by hand, not assumed: (1) **tenant isolation** — this OR clause is
  appended to a query already filtered by
  `MessageHistory.organization_id == current_user.organization_id` at
  `list_message_history`'s very first `select()`
  (`message_history.py:67-69`, unchanged), so it can only ever narrow
  which of the caller's own org's rows match, never reach another org's;
  (2) **correctness of the match, read for a security angle (does a
  mismatch leak nothing, fail open, or scan the wrong rows?)** —
  `_fingerprint_with` normalizes via `normalize_email()` (strip + lower)
  _before_ hashing at both write time (`email_fingerprint`, used when a
  `MessageHistory` row is created) and this read path
  (`email_fingerprints`), so case/whitespace differences cannot cause a
  false negative that would otherwise tempt a looser query later; (3) a
  non-email search string fingerprints to a value that simply will not be
  `json_contains`-equal to any stored fingerprint — `or_(false(), *())`
  degrades to `false()` when `email_fingerprints(search)` returns `[]`
  (empty/whitespace search), so the clause never silently becomes
  "match everything." `email_fingerprints()` includes legacy-key
  fingerprints (post key-rotation rows keep matching) — read, not
  rotation-tested in this pass, since no rotation ran in this window.
- **Integrations: Generic Webhooks are sent the events chat integrations
  get** (`e392f355`) — the one commit touching this feature's declared
  `integration_services/notification_dispatch.py` directly. New
  `dispatch_generic_webhooks(db, organization_id, kind, payload)`:
  queries `Integration` filtered on
  `organization_id == str(organization_id)` **and**
  `integration_type == "generic-webhook"` **and** `enabled.is_(True)`
  (re-read, all three conditions present) — org-scoped, and the org id it
  filters on is the caller's own (passed down from
  `notify_entity_created`, itself called from request-scoped code with
  the authenticated user's org, never client-supplied). The delivery URL
  is the org's **own** previously-configured webhook endpoint
  (`integration.get_secret("url")`), not external input reaching this
  call fresh, and delivery goes through the pre-existing `send_webhook`
  (`webhook_service.py`, outside this feature's declared scope but
  checked here since it is the new call's whole reason for being safe),
  which still calls `assert_outbound_url_safe(url)` immediately before
  the HTTP request (confirmed at `webhook_service.py:98`, unchanged) —
  the CHECKLIST §4 "stored outbound URLs are re-validated at send time"
  item, already satisfied by code that predates this commit and is simply
  invoked from a new call site. `logger.warning("Generic webhook delivery
failed: {}", exc)` passes `exc` as a positional arg rather than
  f-string-interpolating it into the message (Pitfall #33 — no
  double-formatting hazard). Never raises past `notify_entity_created`
  (wrapped in its own `try`/`except Exception`), so a broken webhook
  cannot take down the chat-notification path running beside it.

**0 new findings.** None of the eight commits add a route, change a
permission string on this feature's own four endpoint files (confirmed
by the AST re-enumeration below), or touch SMS send logic directly.

### Re-swept, unchanged since pass 10

- `grep -rn "SMSService("` across `backend/app`: still exactly the two
  gated call sites (`notification_channels.py` — the allowlist resolver
  itself; `message_delivery_service.py:582` — re-read in full, confirmed
  its `targets` list is built by `resolve_sms_targets(self.db, recipients,
SmsAlert.URGENT_DEPARTMENT_MESSAGE)` a few lines above the send, not a
  bypass).
- `.ilike(`/`.like(` sites in this feature's scope
  (`message_history.py:85`, `messaging_service.py:245-246`,
  `notifications_service.py:91-92`): unchanged, still pass
  `escape=LIKE_ESCAPE_CHAR` with a `like_pattern()`-built pattern (the one
  new comparison this pass reviewed, the fingerprint `json_contains` OR
  clause, is not a `LIKE` and needs no escaping — it is an exact-match
  equality check against a hash).
- CSV export: still none in this feature's scope.

### Standing findings — re-confirmed open/unchanged

- **MSG-3** — `POST /message-history/test-email` (still present,
  `message_history.py:123`) sends to an admin-typed `to_email`, by design.
  Unchanged.
- **MAIL-4** — `POST /email-templates/schedule` (still present,
  `email_templates.py:943`) `to/cc/bcc_emails` accept arbitrary addresses,
  by design, same trust boundary as MSG-3. Unchanged.
- **`email_service.py`'s F4** — no SSRF-style validation on an
  org-configured SMTP host, a deliberate policy decision. Unchanged.
- **`NotificationRuleCreate`/`Update.config` unbounded-JSON note** —
  informational, low severity, unchanged.

### Route inventory — re-enumerated by AST, 51 routes (unchanged since pass 5)

Walked all four endpoint files' decorators by AST rather than trusting the
prior count: 13 (`messages.py`) + 2 (`message_history.py`) + 20
(`notifications.py`) + 16 (`email_templates.py`) = **51**, matching pass 10
exactly. No new route in this feature's four declared endpoint files.

### Frontend — four commits since pass 10, three reviewed above or trivial

- `51d23961` (Template editor confirm-before-off, `always_sent` disabled
  state) — reviewed above alongside the backend switch-off work.
- `9af732d9` (`alert-error` → `alert-danger` CSS class fix in two
  Communications components) — pure styling, no security surface.
- `a36d27f1`/`27a363f1` also touch
  `frontend/src/services/communicationsServices.ts`/related files as part
  of Feature 08's own frontend; no separate finding beyond the backend
  review above.
- `4e6c1c81` (training compliance matrix member-class filter) matched this
  feature's frontend scope glob only because it touches
  `communicationsServices.ts` incidentally (a shared service file); the
  actual change is Feature 17's training compliance matrix and carries no
  messaging/notification surface.

### Schema & migration notes

No migration landed in this feature's own declared scope this pass (the
fingerprint/encryption migrations were authored and reviewed under the
repo-wide encryption sweep, outside this rotation's authorship). See the
completion gate below for the current revision count and head.

## Guard tests added (pass 11)

None — every reviewed commit's own test suite (listed in each bullet
above, e.g. `EmailTemplatesPage.switch.test.tsx`, the cert/post-event/
post-shift/member-archive test updates) already covers its change, and
this pass found no new finding requiring its own guard test.

## Completion gate (pass 11)
