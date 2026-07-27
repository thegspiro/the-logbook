# Module Audit — Messaging / Communications

**Files:** `app/api/v1/endpoints/messages.py` (445 L, 12 endpoints),
`app/api/v1/endpoints/message_history.py` (230 L, 2 endpoints),
`app/services/messaging_service.py` (768 L),
`app/services/message_delivery_service.py` (278 L), models
`app/models/notification.py` / `email_template.py`. Frontend
`modules/communications`.
**Audited:** iteration 10.

## Verified good ✅
- **Auth coverage:** all 14 endpoints authenticated. Broadcast/create/update/
  delete/stats/ack-report all require `notifications.manage` — a plain member
  cannot broadcast.
- **Tenant isolation is SOLID.** Every by-id read/update/delete routes through
  `get_message_by_id(message_id, organization_id)` (filters id AND org);
  mark-read/acknowledge go through `_visible_message_or_none`; message-history and
  template lookups filter `organization_id`. No IDOR. **XC-3 clean.**
- **Audience targeting CANNOT cross org boundaries** (the crux of this module).
  The single choke point `_targeted_users` loads candidates with
  `User.organization_id == message.organization_id`, so client-supplied
  `target_member_ids` / `target_roles` only ever match same-org users — a foreign
  id/role matches nobody. No cross-org delivery or recipient-row creation.
- **Delivery is not a spam/phishing relay:** all `_send_email`/`_send_sms`
  destinations come from org-scoped user records (`u.email`/`u.mobile`/`u.phone`),
  never client-supplied (except the admin test-email, L3 below). No SSRF (no
  webhook/callback URLs in this module).
- **A member cannot read messages not addressed to them** (`_is_targeted` + org
  filter on inbox/unread/mark-read/acknowledge).
- **Model attributes all verified; search LIKE parameterized; flake8 clean; no
  TODO/FIXME; no dead code.**

## Findings

### MSG-1 — LOW — Unescaped org name in test-email HTML — ✅ FIXED
`_build_test_html` interpolated `organization.name` directly into the email
HTML (twice) with no escaping, unlike the department-message path which escapes
both title (`email_service._html.escape`) and body
(`message_delivery_service._text_to_html`). Impact is limited (org name is
admin-controlled; endpoint requires `settings.manage`), but it was the one
inconsistency with the module's otherwise-correct escaping discipline.
**Fix:** `html.escape` the org name at the source in `_build_test_html`.

### MSG-2 — LOW — Targeting lists not org-validated on create/update (XC-1, defense-in-depth)
`create_message` / `update_message` store client-supplied `target_member_ids`
and `target_roles` verbatim with no in-org check. **Not exploitable** for
cross-org delivery (the org-scoped `_targeted_users` neutralizes foreign ids),
but it persists garbage/foreign ids. **Status:** flagged (XC-1) — validate
membership/role ids against the org on write for data hygiene.

### MSG-3 — LOW / informational — Test-email sends to an arbitrary client address
`POST /message-history/test-email` sends to a fully client-supplied `to_email`
using org SMTP credentials. Gated behind `settings.manage`/
`organization.update_settings` and logged with `sent_by`, so it's an org-admin
capability by design — but it's the one destination in the module not derived
from an org-scoped user record. **Status:** noted (by design); a rate-limit /
same-domain restriction could harden it if abuse is a concern.

## Notes
- Non-security nuance: `get_inbox` applies `skip:skip+limit` in Python after
  building the full enriched list and returns no total — a pagination/perf smell,
  not a security issue. Flagged for future cleanup.
