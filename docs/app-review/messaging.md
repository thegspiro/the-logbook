# Application Review — Messaging / Communications (Tier B)

**Prefix:** `MSG2` · **Iteration:** B10 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4), 2026-08-13
(pass 5, owner-requested docs/screenshots verification)

---

## Pass 5 (2026-08-13) — owner-requested: verify in-app messaging works as documented and matches the screenshots

Scope differs from passes 1–4 (security): this pass verified the **user-facing
documentation** — `docs/COMMUNICATIONS_MODULE.md`,
`docs/training/07-documents-forms.md` § Department Messages,
`wiki/Module-Communications.md`, and the two training screenshots
(`07-11-new-message-form.png`, `07-12-acknowledgment-report.png`) — against the
actual frontend and backend behavior.

### Screenshots — ✅ both match the current UI

- **07-11 (compose form):** every element verified against
  `MessageComposeForm.tsx` / `MessagesAdminPage.tsx` — Title, Message, Priority
  (Normal/Important/Urgent, default Normal), Audience
  (Everyone/By role/By status/Specific members), the role-checkbox grid fed by
  `GET /messages/roles` (ordered by role priority), the Pin to top / Persistent
  / Require acknowledgment checkboxes, "Schedule for later (optional)" with the
  "Leave blank to publish immediately." helper, "Expires (optional)", Cancel(✕)
  / "Post message" (which becomes "Schedule message" when a schedule time is
  set — `MessageComposeForm.tsx:379`), and below it the admin list with the
  "Search messages…" box, "All priorities" filter, pin icon, priority badges,
  "Ack required" badge, "Everyone · <date>" audience line, and the
  bar-chart/pencil/trash action icons.
- **07-12 (acknowledgment report):** matches `MessagesAdminPage.tsx:324-385` —
  inline expansion under the message row, "Read: X/Y" + "Acknowledged: X/Y"
  (denominator = `total_targeted` from the org-scoped audience resolver),
  per-member rows with name + status chip and the amber clock "Not
  acknowledged" state, sorted so members who still owe an acknowledgment come
  first (`messaging_service.py:799`).

### Behavior claims verified against code — ✅ (all except the delivery matrix)

- Routes/permissions: `/messages` authenticated-only, `/communications/messages`
  behind `notifications.manage` (`routes.tsx`); all 12 `/api/v1/messages*`
  endpoints gated as documented; create/update/delete/acknowledge audit-logged.
- Sidebar megaphone entry, dashboard "Department Messages" card (unread badge
  from `/inbox/unread-count`, Persistent badge, Clear button rendered only for
  `notifications.manage` holders and implemented as an admin `PATCH
is_active=false`).
- Read/ack semantics: opening a message marks it read; an ack-required message
  stays in the pending count until acknowledged (opening is not enough) —
  `get_unread_count`'s `resolved` logic matches the doc exactly.
- Scheduling: future-only deferral, hidden from inbox/unread until due,
  "Scheduled · <time>" badge in the admin list, published by
  `publish_scheduled_messages` every 15 min (`TASK_INTERVALS_SECONDS: 900`),
  `scheduled_at` cleared **before** delivery, and `update_message` rejects
  moving an already-published message back to a future time.
- Soft delete preserves `department_message_reads` (compliance evidence);
  the admin delete confirm dialog says so.
- Edit does not re-send/re-escalate (only create and the publish task deliver).
- SMS: urgent-only + Twilio enabled + mobile on file + express consent
  (`granted_user_ids`, fail-closed) + `sms_notifications` preference; author
  excluded from all delivery; per-org email/SMS rate limits fail-open; in-app
  never rate-limited. Twilio-absent → SMS silently skipped, email/in-app still
  delivered.
- Targeting: role-id matching with legacy name fallback (rename-safe), statuses,
  hand-picked members; `_targeted_users` org-scoped choke point unchanged.
- `/messages` is in `UNCACHEABLE_PREFIXES` (inbox/read state never cached).

### MSG2-2 — MED (doc accuracy) — Delivery matrix said Normal/Important don't email; the code deliberately emails every message — ✅ FIXED (docs corrected)

The delivery matrices in `docs/COMMUNICATIONS_MODULE.md`,
`docs/training/07-documents-forms.md` and `wiki/Module-Communications.md` (and
narration in two YouTube scripts, `04-fire-chief` and `07-secretary`) claimed
email goes out only for ack-required/urgent (wiki bullet: important too), and
the wiki additionally claimed members can opt out of message email under
Settings → Notifications. The code sends email for **every** department message
at **every** priority, unconditionally per member — and this is the deliberate,
owner-directed design, not a bug: the AUTH-2 owner rule (2026-08-05, recorded in
`KNOWN_LIMITATIONS.md` "Consent enforcement") is _"messages always go to the
member's email"_; the delivery service's module docstring documents email as the
record-of-notice channel, and `test_message_delivery_service.py` asserts a
normal no-ack message still emails. An officer following the guide would post a
"Normal" FYI believing it stays in-app and unintentionally email the whole
department. All five documents corrected to match the code (matrix rows,
member-controls text, opt-out claim), plus the stale
"escalation for urgent/ack-required" comment at `endpoints/messages.py:241`.
If the owner ever wants the old matrix back, it is a priority gate in
`MessageDeliveryService.deliver()` — but the docs now describe what ships.

### MSG2-3 — NIT — residual `== True  # noqa: E712` in the publish task — ✅ FIXED

Pass 3 declared the module E712-free but only swept `messaging_service.py` /
`message_delivery_service.py`; the messaging query in
`scheduled_tasks.py` (`run_publish_scheduled_messages`) still carried one.
Converted to `.is_(True)` (AP-2 pattern, Pitfall #10).

### MSG2-4 — NIT — `apiCache.ts` mislabeled the `/messages` exclusion — ✅ FIXED

The comment said "private member-to-member messages"; the app has no
member-to-member messaging. Relabeled as department messages + per-member
inbox/read state. The exclusion itself was already correct.

### MSG2-5 — LOW (doc) — migration list cited a renumbered filename — ✅ FIXED

`COMMUNICATIONS_MODULE.md` listed `20260720_0001_add_department_message_deleted_at.py`;
the file was renumbered to `20260720_0004` (and re-parented after
`0003_scheduled_at`) in the 2026-08-05 duplicate-revision fix. List corrected to
match `ALEMBIC_MIGRATIONS.md` and the tree.

### MSG2-6 — LOW (UX) — persistent messages can fall off the dashboard card — 🚩 FLAGGED

`Dashboard.tsx` loads the card with `getInbox({ limit: 10 })`, leaving
`include_read` at its backend default (true). Consequences: (a) read
non-persistent messages never drop off the card, so the "persistent = stays
visible" contrast the guide describes is only observable on `/messages` with
"Show read" unchecked; (b) an **unpinned persistent** notice older than the 10
most recent messages disappears from the card entirely — contradicting the
guide's "stays on the dashboard until leadership takes it down". The backend
already exempts persistent messages from the `include_read=false` filter
(`get_inbox`'s `resolved`/`is_persistent` branch exists for exactly this), so
passing `include_read: false` from the dashboard would show pending + persistent
messages only — but that visibly changes every member's dashboard, so it is a
product call, not a drive-by. Mirrored to `KNOWN_LIMITATIONS.md`. Workaround
today: pin standing notices (pinned sort first and cannot be paged off).

### Completion gate (pass 5)

| Check                                | Result                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/`                 | ✅ 0 violations                                                                                                                                                                   |
| `black --check app/ tests/`          | ✅ 673 files unchanged                                                                                                                                                            |
| `npx tsc --noEmit` (via `typecheck`) | ✅ 0 errors                                                                                                                                                                       |
| `npx eslint .`                       | ✅ 0 errors                                                                                                                                                                       |
| backend messaging tests              | ✅ `test_messaging_service.py` + `test_message_delivery_service.py` + `test_message_history.py` **57 passed** (DB-free)                                                           |
| scheduled-task tests                 | ✅ 10 passed; 17 errors are the documented no-MySQL fixture failures (`pymysql` connect at setup), unrelated to the one-line E712 change                                          |
| frontend tests (touched areas)       | ✅ communications module + `communicationsServices` + `apiCache` — **187 passed** (13 files)                                                                                      |
| `tests/test_push_service.py`         | ⚠️ collection error in this sandbox only: optional `pywebpush`/`py_vapid` dep can't install (`http-ece` wheel build fails); pre-existing environment limitation, not a regression |

---

## Pass 4 (2026-08-09) — invariants re-verified; no code change

Pass 3 verified the module clean and swept the last E712. Pass 4 re-confirmed:

- **MSG-2 targeting validation intact** — `_validate_targeting` wired into
  `create_message` and `update_message` (3 refs); the org-scoped `_targeted_users`
  choke point still bounds audience selection to the message's own org.
- **E712-free** in both `messaging_service.py` and `message_delivery_service.py`.
- **Latent-500 clean** — `priority`/`target_type` are enum-typed in the request
  schemas (this module did the right thing before the lens existed).

Open items unchanged: **MSG-3** (test-email to a client-supplied address — an
org-admin `settings.manage` capability by design; optional rate-limit/same-domain
hardening is future dev) and the `get_inbox` in-Python pagination (a perf smell at
scale, a response-contract change orthogonal to security).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a · `test_messaging_service.py` **36 passed** (DB-free).

---

## Pass 3 (2026-08-09) — verified clean; latent-500 clean; 1 residual E712

Re-verified MSG-2 (`_validate_targeting` wired into both `create_message` and
`update_message`, service 59/195/640) and the org-scoped `_targeted_users` choke
point hold.

### Latent-500 lens (the B1 finding) — clean

`DepartmentMessage`'s enum columns are `priority` and `target_type`, and the inline
request schemas in `messages.py` already type them as `MessagePriority` /
`MessageTargetType` (with a comment: _"Typed as enums so an invalid
priority/target_type is rejected with a 422"_). No free-string→ENUM path — this
module was already doing the right thing before the lens existed.

### MSG2-1 — NIT — 1 residual `is_active == True  # noqa: E712` swept — ✅ FIXED

Pass 1 swept the 3 E712 suppressions in `messaging_service.py` but the sibling
`message_delivery_service.py:294` still carried one (`DepartmentMessage.is_active`
in the department-message delivery query); converted to `.is_(True)`. The module is
now E712-free.

### Still flagged (unchanged)

- **MSG-3** — test-email sends to a client-supplied address (org-admin capability by
  design, `settings.manage`-gated + logged); optional rate-limit/same-domain
  hardening remains future dev.
- **`get_inbox` pagination** — in-Python slice with no `total`; a perf smell at
  scale, orthogonal to security, response-contract change.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_messaging_service.py` **36 passed** (no DB needed).

---

## Pass 2 (2026-08-06) — clean-module verification, no code change

Messaging was pre-scanned in the BXC cross-cutting sweep and came back clean on
both root-cause patterns; this pass confirmed that and swept the surfaces BXC
didn't scope. Everything holds.

- **Update-bypass — clean.** `update_message` uses an explicit `allowed_fields`
  allow-list (no blind `setattr`), and the only client FKs (`target_member_ids`,
  `target_roles`) are re-validated in-org by MSG-2's `_validate_targeting`.
- **Projection read-leak — clean.** Audience targeting can't cross org
  boundaries: the single `_targeted_users` choke point loads candidates
  `WHERE organization_id == message.org`, so a foreign member id/role matches
  nobody (re-confirmed against `_is_targeted` / `_visible_message_or_none`).
- **MS2-4 — not a live defect.** `MessageResponse.author_name` is declared but the
  single-message endpoints' `_serialize_message` never fills it — however it is
  **not rendered**: only `MessagesInboxPage.tsx:152` renders `author_name`, fed by
  the inbox path whose `InboxMessage` schema **is** populated
  (`messaging_service.py:365/404`). The admin manage page (`getMessages`) doesn't
  render it. Cosmetic dead field, not a UI defect — flagged, not fixed.
  `MessageHistoryResponse` (the outbound log) exposes only `to_email`/`subject`/
  `sent_by` (a raw id), no `*_name` enrichment — nothing to populate.
- **Consent / delivery boundary (AUTH-2) — intact.** Department-message **email
  is the unconditional record-of-notice channel** (deliberately not filtered by
  `email_notifications` or consent, `message_delivery_service.py:170-171`); **SMS
  is consent-gated** via `ConsentService.granted_user_ids(SMS_NOTIFICATIONS)`
  (fails closed) + the `sms_notifications` preference (`:234-249`). Re-verified.
- **`message_history` (out of BXC scope) — clean.** Two endpoints, both
  `settings.manage`-gated; no update loops; MSG-3's test-email destination is the
  one client-supplied address, by design (unchanged).

**No code changed.** The verifications are the deliverable, same disposition as the
B5 elections / B26 public-portal clean passes.

---

## Pass 1 (2026-08-06)

**Prefix:** `MSG2` · **Iteration:** B10 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/messages.py` (445 L), `endpoints/message_history.py` (230 L),
`services/messaging_service.py` (768 L), `services/message_delivery_service.py`
**Frontend:** `modules/communications`
**Prior audit:** `docs/module-audit/messaging.md` (iteration 10) — MSG-1 fixed;
MSG-2 (targeting lists not org-validated on write, XC-1 defense-in-depth) and
MSG-3 (test-email to an arbitrary address, by design) left open, plus a
`get_inbox` pagination note.

---

## Scope

Tier B: the two open findings plus the broader lens. The security pass had already
established the crux of this module — **audience targeting cannot cross org
boundaries**, because the single delivery/stats choke point `_targeted_users`
loads candidates with `User.organization_id == message.organization_id`, so a
client-supplied foreign member id or role matches nobody. Re-verified against
`_is_targeted` and `_visible_message_or_none` (the read/ack gate): still true, not
re-derived.

## Findings

### MSG-2 — LOW — Targeting lists not org-validated on create/update (XC-1, defense-in-depth) — ✅ FIXED

`create_message` / `update_message` stored client-supplied `target_member_ids`
and `target_roles` verbatim. **Not exploitable** for cross-org delivery (the
org-scoped `_targeted_users` neutralizes foreign ids — confirmed), but it
persisted garbage/foreign ids on the row.

**Fix:** a new `_validate_targeting(org_id, target_member_ids, target_roles)`
helper rejects any supplied member id that isn't a user in the caller's org, and
any supplied role entry that isn't a role **id or name** in the org (matching
`_is_targeted`'s rename-safe semantics — `Role`/`Position.organization_id` is
`NOT NULL`, so there are no cross-org system roles to special-case). Called inside
both `create_message` and `update_message`; both already funnel a raised
`ValueError` through `safe_error_detail` → a clean 400. Only the values **supplied
in the request** are checked, so a legacy stored role name (retained for a
since-deleted role) is never re-validated on an unrelated edit.

The real UI never sends foreign ids (the compose form's role/member pickers list
only the org's own roles and members, and send role **ids**), so this is
data-hygiene hardening with no legitimate-flow impact. **5 unit tests added**
(`TestValidateTargeting`): in-org pass, foreign-member reject, role id + rename
pass, foreign-role reject, and empty lists issue no query.

### MSG-3 — LOW / informational — Test-email sends to an arbitrary client address — 🚩 NOTED (by design, unchanged)

`POST /message-history/test-email` still sends to a fully client-supplied
`to_email` using org SMTP credentials. Re-verified: gated behind
`settings.manage` / `organization.update_settings` and logged with the sender's
id — an org-admin capability by design, and the one destination in the module not
derived from an org-scoped user record. Left as-is; a rate-limit or same-domain
restriction is recorded as future development if abuse becomes a concern.

## Verified good ✅ (re-confirmed)

- MSG-1 (org name `html.escape`d in the test-email HTML) remains fixed.
- All 14 endpoints authenticated; broadcast/CRUD/stats/ack-report require
  `notifications.manage`. Every by-id path routes through
  `get_message_by_id(id, org)`; read/ack go through `_visible_message_or_none`
  (org filter + `_is_targeted`), so a member cannot ack another org's message or
  fake an ack on a message not aimed at them (acks are compliance evidence).
- Delivery is not a spam/phishing relay: `_send_email`/`_send_sms` destinations
  all come from org-scoped user records. No SSRF (no callback URLs here).

## Duplication / cleanup applied

- Removed three `DepartmentMessage.is_active == True  # noqa: E712` suppressions
  (in `get_messages`, `get_inbox`, `get_unread_count`) in favor of
  `.is_(True)` — same cleanup applied as AP-2, honoring Pitfall #10's
  "no `# noqa`" standard. Behavior-identical for a boolean column.

## Dead code

None. Model attributes all verified; no TODO/FIXME.

## Documentation

`docs/module-audit/messaging.md` updated: MSG-2 resolved, MSG-3 status clarified.

## Future development

1. **`get_inbox` pagination** — still slices `skip:skip+limit` in Python after
   building the full enriched list and returns no total (a perf smell noted in
   the prior audit). It walks every active message for the org and filters in
   Python; fine at department scale, but a DB-level targeting filter + count
   would scale better. Not changed — it's orthogonal to the security work and
   would alter the response contract (no `total` today).
2. **MSG-3 test-email hardening** — optional rate-limit / same-domain restriction.
3. **`_targeted_users` in-Python filter** — same "bounded by org size" pattern;
   acceptable for this admin-only path, noted for consistency.

## Completion gate

| Check                     | Result                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `flake8` (service + test) | ✅ 0 violations                                                                                                    |
| `black --check`           | ✅ unchanged                                                                                                       |
| `tsc --noEmit`            | ✅ n/a — no frontend change                                                                                        |
| `eslint`                  | ✅ n/a — no frontend change                                                                                        |
| backend tests             | ✅ `test_messaging_service.py` **36 passed** (was 31; +5 new `TestValidateTargeting`). No DB needed for this file. |
