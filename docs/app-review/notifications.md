# Application Review — Notifications (Tier B)

**Prefix:** `NOTIF2` · **Iteration:** B11 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3)

---

## Pass 3 (2026-08-09) — latent-500 on rule enums; push SSRF re-verified

Re-verified NOTIF2-3 (`validate_push_endpoint` at the API boundary, `push_service.py`
+ `notifications.py:380`) and the push scoping/fail-safe delivery hold. The B1
latent-500 lens surfaced a genuine recurrence on the rule schemas.

### NOTIF2-4 — LOW/MED — Rule `trigger`/`category`/`channel` 500 on a bad value — ✅ FIXED

**What:** `trigger`, `category`, and `channel` on `NotificationRuleCreate`/`Update`
were typed as free `str` but map to **strict MySQL ENUM** columns
(`NotificationTrigger` / `NotificationCategory` / `NotificationChannel`), and are
stored **raw** — `create_rule` via `**rule_data`, `update_rule` via its `setattr`
loop. So an out-of-set value passed Pydantic, reached MySQL, and 500'd. The B1 class
(pass 1's "mass-assignment not reachable" note confirmed these fields flow straight
into the row, which is exactly the raw-insert path).

**Fix:** `@field_validator`s on all three fields on both request classes, each
deriving its value set from the model enum, lowercase-normalizing and rejecting
unknowns → 422. Request-only, so `NotificationRuleResponse` (built from the ORM enum)
is untouched; the rule editor sends only valid values. **7 tests added.**

### NOTIF2-3 residual (DNS rebinding) — 🚩 STILL FLAGGED (deliberately)

The push-endpoint validator blocks IP-literal/localhost/private-suffix hosts at
subscribe time, but a public hostname that *resolves* to a private IP still isn't
caught. A shared `assert_outbound_url_safe` (with `_assert_hostname_resolves_public`)
exists in `app/utils/url_validator.py` and would close it — **but** pass 2 put the
validator at the API boundary precisely because the delivery integration tests call
`service.subscribe` directly with a `127.0.0.1` endpoint, and the 17 endpoint-validation
unit tests use non-resolving fake hosts. Adding real DNS resolution (subscribe-time
vs the send-time rebinding window, plus the test-harness interaction) is a careful
change, not a batch drive-by; kept as the recorded hardening follow-up.

### Still flagged (unchanged)

- Unused frontend `markLogRead` (frontend-shared cleanup); `get_logs` pagination
  (build-query-then-subquery-count pattern, fine at scale).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · new rule-enum tests **7 passed** + notification-service
tests pass (DB-free).

---

## Pass 2 (2026-08-08, against freshly-merged main)

Run after merging 144 commits of `main`, which brought **new notification code**
this pass had to review: a parallel session's NOTIF-2 fix (`a604016`, same as
pass 1 — converged), the BXC `rule_name` `lazy="joined"` fix (now merged), and —
the substantive new surface — a **Web Push feature** (`ccea8c0`: `push_service.py`,
`PushSubscription` model, `/push/*` endpoints, a migration, a frontend hook).

Re-verified the standing fixes hold on the merged tree: `rule_name`/`recipient_name`
relationships are both `lazy="joined"` (no `MissingGreenlet`), all six mutating
methods route errors through `safe_error_detail`, and `update_rule`'s
`NotificationRuleUpdate` still exposes no FK (BXC update-bypass clean). Then
reviewed the new push code.

### NOTIF2-3 — MED — Web Push endpoint URL unvalidated → blind SSRF — ✅ FIXED

`POST /push/subscribe` (`get_current_user` — any member) accepts a
`PushSubscriptionCreate.endpoint` that is a **bare string** (`Field(max_length=2048)`,
no URL/host check), stores it, and `PushService._send_one` later hands it to
`webpush`, which **POSTs to that URL** whenever the user is notified. So an
authenticated member could register `endpoint=https://169.254.169.254/…` (cloud
metadata), `https://127.0.0.1:<port>/…`, or an intranet host, and turn every push
to themselves into a server-side request to an internal target — a **blind SSRF**
(the response isn't returned, but the request fires). New code, merged without a
security pass on this surface.

**Fix:** a `validate_push_endpoint` helper rejects anything a real browser push
service never is — non-HTTPS scheme, an **IP-literal host** (v4/v6, so 169.254.x /
127.x / 10.x / ::1 and even bare public IPs), `localhost`, and `.localhost` /
`.local` / `.internal` suffixes — raising `ValueError → 400`. Called at the **API
boundary** (`subscribe_to_push`), where the untrusted value enters, not inside
`service.subscribe` (which the delivery integration tests call directly with a
`127.0.0.1` test-server endpoint — validating there would have broken the harness
that verifies real push send). Legitimate endpoints (always HTTPS on a public DNS
host) pass unchanged. 17 unit tests added (`test_push_endpoint_validation.py`,
DB-free so they run in the unit job). **Residual flagged:** a public hostname that
*resolves* to a private IP (DNS rebinding) isn't caught without a resolve-time IP
check — recorded as a hardening follow-up.

### Web push — verified good ✅

- **Subscribe/unsubscribe scoping:** `send_to_user` selects `WHERE organization_id
  AND user_id` (a member's pushes go only to their own devices); `unsubscribe` is
  org-scoped so a known endpoint can't be deleted cross-tenant. `subscribe`
  re-points an existing endpoint_hash to the current user (device-handoff design,
  documented) — the endpoint is a browser secret so this isn't a takeover vector.
- **Delivery is fail-safe:** `send_to_user` never raises (a push outage can't fail
  or roll back the triggering action), runs the blocking `webpush` off the loop via
  `asyncio.to_thread`, and prunes 404/410 (browser-dropped) subscriptions on send.
- **Secrets:** the VAPID **private** key is only read server-side for signing; the
  `/push/vapid-public-key` endpoint and `PushSubscriptionResponse` expose only the
  public key / endpoint id — no private material leaks.

---

## Pass 1 (2026-08-06)

**Prefix:** `NOTIF2` · **Iteration:** B11 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/notifications.py` (325 L, 15 endpoints),
`services/notifications_service.py` (414 L), `schemas/notifications.py`,
model `models/notification.py`
**Prior audit:** `docs/module-audit/notifications.md` (iteration 11) — NOTIF-1
fixed; **no open findings.** The audit rated user-scoping/IDOR prevention
"exemplary" and tenant isolation solid.

---

## Scope

With no open security findings, this pass re-verified a sample of the audit's
conclusions and applied the broader Tier B lens (correctness beyond isolation,
error-handling standard, dead code, duplication). One new LOW finding surfaced
from the error-handling lens.

## Findings

### NOTIF-2 — LOW — Raw exception text returned to the client (and swallowed, unlogged) — ✅ FIXED

All six mutating service methods (`create_rule`, `update_rule`, `delete_rule`,
`log_notification`, `mark_as_read`, `toggle_pin`) caught `Exception` and returned
`str(e)` as the error, which every endpoint then interpolated into its response
detail (`detail=f"Unable to create notification rule. {error}"`). A DB-layer
failure — an `IntegrityError` or `OperationalError` — therefore returned raw SQL
fragments, driver text, and column names to the client, and the real exception
was **never logged** (it was swallowed into the return value). This is the
project's `safe_error_detail()` standard being bypassed (the same class as SF-2,
the PayPal webhook's raw `str(exc)`).

**Fix:** all six methods now return `safe_error_detail(e)`, which returns a
generic message for non-validation exceptions (so no internals leak) **and** logs
the real error at ERROR level for ops — closing both the disclosure and the
silent-swallow. Behavior for the success path is unchanged. **2 regression tests
added** (`TestErrorSanitization`): a raw `pymysql` INSERT error in `create_rule`
and in `log_notification` both come back as the generic message with the SQL
stripped, and `rollback` still runs.

### NOTIF-1 — LOW — `/logs/{id}/read` gate — ✅ FIXED (prior, re-verified)

Re-confirmed the fix holds: `mark_notification_read` (org-wide log write) requires
`notifications.manage`, matching `/logs/read-all`, and its docstring points members
to the recipient-scoped `/my/{id}/read`.

## Verified good ✅ (re-confirmed, not re-derived)

- **IDOR prevention:** every `/my/*` path filters `recipient_id == current_user.id`
  alongside `organization_id`; `mark_as_read` takes an optional `user_id` and the
  `/my/{id}/read` route passes it (recipient-scoped) while the privileged admin
  route omits it — the documented, intentional split. `toggle_pin` is
  recipient-scoped and IN_APP-only.
- **Mass-assignment is not reachable:** `create_rule`'s `**rule_data` and
  `update_rule`'s `setattr` loop are fed only by `NotificationRuleCreate`/`Update`,
  whose fields are `name/description/trigger/category/channel/enabled/config` — no
  `id`/`organization_id`/`created_by` is exposed, and the service passes org/creator
  as explicit kwargs. So a client cannot set a protected column.
- Rule mutations route through the org-scoped `get_rule_by_id`; every log/summary
  query filters `organization_id`; search LIKE is escaped.

## Duplication / cleanup applied

- Removed five `== True`/`== False  # noqa: E712` suppressions (in
  `get_user_notifications`, `get_user_unread_count`,
  `mark_all_user_notifications_read`, `mark_all_logs_read`, `get_summary`) in favor
  of `.is_(True)`/`.is_(False)` — the AP-2 cleanup, honoring Pitfall #10.

## Dead code

`NotificationsService.markLogRead` (frontend service method for `/logs/{id}/read`)
remains effectively unused — the UI's single mark-read uses the recipient-scoped
`/my/{id}/read`. The endpoint itself is a legitimate admin capability, so this is a
frontend-only cleanup candidate; recorded for the future frontend-shared
iteration, not removed here (prior audit's note stands).

## Documentation

`docs/module-audit/notifications.md` updated with NOTIF-2.

## Future development

1. **Remove the unused frontend `markLogRead`** in the frontend-shared pass.
2. **`get_logs` pagination** counts via `select(count()).select_from(query.subquery())`
   — correct, but the same "build full query then subquery-count" pattern as other
   list endpoints; fine at scale here.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| `eslint` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_notification_dispatch` + `test_notifications_service` + `test_security_notifications`: **17 passed** (2 new `TestErrorSanitization`). No DB needed for these files. |
