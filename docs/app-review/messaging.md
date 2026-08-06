# Application Review — Messaging / Communications (Tier B, 2nd pass)

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

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| `eslint` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_messaging_service.py` **36 passed** (was 31; +5 new `TestValidateTargeting`). No DB needed for this file. |
