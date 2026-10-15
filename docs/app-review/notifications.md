# Application Review — Notifications (Tier B)

**Prefix:** `NOTIF2` · **Iteration:** B11 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-15 (pass 5)

---

## Pass 5 (2026-10-15) — a rule's `enabled` could be cleared to NULL, breaking its own listing (1 fixed, 1 noqa removed, 2 noted)

Lens for this pass: the update-payload discipline the B4–B9 passes applied
(`exclude_unset`, `apply_updates`, an explicit `null`), driven through the real
handler, plus CLAUDE.md #19 (does anything store a setting nothing reads) and an
AST dead-code scan that counts `tests/` as a reference source. The module here is
smaller than most of the rotation — 20 routes, a 660-line service, a 142-line rule
resolver, 169 lines of channel gating — and this pass read all of the rule path and
the log-scope routes.

### NOTIF2-5 — LOW/MED — `PATCH /rules/{id}` with `{"enabled": null}` stored NULL, then returned 500 — ✅ FIXED

`NotificationRuleUpdate.enabled` is `Optional[bool]`, the handler dumps with
`exclude_unset`, and the column is nullable (`Mapped[Optional[bool]]`), so
`apply_updates` — which refuses a null only against a NOT NULL column — wrote it.
The commit succeeded; building the response then failed, because
`NotificationRuleResponse.enabled` is a plain `bool`. Two things follow from a row
left with `enabled = NULL`:

- **every later `GET /rules` that includes it fails the same way**, so one bad
  PATCH takes the organization's rules screen down until the row is repaired in
  the database (the same shape as DOC-20 in the documents module, where a nullable
  column sat behind a non-Optional response field);
- the resolver reads `if rule.enabled` as false, so the notification that rule
  governs is silently **off**.

**Reproduced before fixing**, through the real handler against the real schema: the
PATCH was a 500, and a `GET /rules` issued right after it was a 500 too (2 of 9 new
cases failed on the unmodified schema; the other seven passed — `name`, `trigger`,
`category`, `channel` already come back 400, and `description` / `config` still
clear). Fixed in the request schema, not the handler: a `field_validator("enabled")`
on `NotificationRuleUpdate` answers 422 for an explicit null and does nothing when
the key is omitted. Reachability is low — the UI toggles through
`POST /rules/{id}/toggle`, which sends a real boolean — so it needs a direct API
client; the cost of one was an org-wide screen failure.

### NOTIF2-6 — LOW — the rules screen can create and toggle a rule, but not edit or delete one — 🚩 FLAGGED (owner decision)

`NotificationsPage` calls `getRules`, `createRule` and `toggleRule`.
`updateRule`, `deleteRule` and `getRule` exist in `communicationsServices.ts` and the
endpoints behind them are live, but nothing in the app calls them, so a rule made
with the wrong trigger can only be switched off. Because the resolver keeps a
notification on if **any** rule for it is enabled, "off" is a per-rule state the
admin has to remember to apply to every stray one. Not a defect in what is shipped
and not mine to design — mirrored to `docs/KNOWN_LIMITATIONS.md` (NOTIF2-6) with the
two options. The unused client wrappers are left in place for that reason.

### NOTIF2-7 — INFO — a `# noqa: F401` re-export that nothing imported — ✅ REMOVED

`services/notification_rules.py` re-exported `ENFORCED_TRIGGERS` and `is_enforced`
under `# noqa: F401  (re-exported for callers)`. No file imports either name from
that path (the tests import them from `app.models.notification`, where they live),
and pitfall #10 allows the narrow `# noqa: F401` for an `__init__.py` re-export, not
this. Removed the two names and the suppression; the module docstring now points at
the real home of `ENFORCED_TRIGGERS`.

### Observation, not changed — redundant `# noqa: E712 / E711` repo-wide

The same scan of `# noqa` comments found **67 `# noqa: E712` and 6 `# noqa: E711`**
in `backend/app`, 16 of them in `scheduled_tasks.py` (the notification senders).
`backend/.flake8` ignores E711 and E712 globally ("required by SQLAlchemy
filters"), so every one is a no-op: harmless, but it is exactly the suppression
pattern CLAUDE.md asks not to add, and earlier passes swept other files of it. Left
alone here because deleting 73 comments across a dozen unrelated modules is its own
mechanical change set and belongs in its own PR. (Also seen, not touched: four
`# noqa: F821` on string `httpx.Response` annotations in `salesforce_service.py`,
which a `TYPE_CHECKING` import would settle.)

### Verified good ✅ (this pass)

- **`#19` holds.** `ENFORCED_TRIGGERS` has four triggers (event reminder, training
  expiry, suggestion submitted, equipment request update); each has a caller of
  `NotificationRuleResolver` (`scheduled_tasks`, `cert_alert_service`,
  `suggestions`, `equipment_request_notifications`), the response reports
  `enforced` per rule, and the create form fixes `channel` to `in_app` and derives
  `category` from the trigger, so no stored-but-inert control is offered. An
  absent rule means on.
- **Log scope.** `GET /logs` and `POST /logs/read-all` default to the caller's own
  rows and require `notifications.manage` for `scope=organization`; the per-log
  admin read needs `notifications.manage`; every `/my/*` route filters
  `recipient_id`. A malformed pagination cursor is a 400, not a silent first page.
- **`resolve_sms_recipients`** is called only by tests. That is by design: it is the
  documented number-only wrapper over `resolve_sms_targets`, which the production
  send path uses precisely because a bare number cannot be matched back to a member
  when two share a handset. Kept.
- `/notifications` log and `/my` routes are in `UNCACHEABLE_PREFIXES`.
- Related suites: 607 backend tests (notification, push, SMS, message delivery,
  consent, org-scoping ratchet, CSV, LIKE) pass.

### Not read (scope, stated plainly)

The Web Push send path and its SSRF controls were covered by passes 2–4 and were not
re-read; the bell / inbox rendering in `NotificationsPage.tsx` was read only at its
rule and log calls. The individual senders behind the four enforced triggers were
checked for a resolver call, not for their own delivery logic.

### Completion gate (pass 5)

| Check                                                                                              | Result                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/`                                                                               | ✅ exit 0, no output                                                                                                     |
| `black --check app/ tests/`                                                                        | ✅ 1726 files unchanged                                                                                                  |
| `isort --check-only` (changed files)                                                               | ✅ clean                                                                                                                 |
| new backend file, mutation-checked                                                                 | ✅ 9 pass with the fix; **2 fail with the schema validator stashed** (`enabled` null → 500; the follow-up listing → 500) |
| marker routing                                                                                     | ✅ `-m "not integration and not slow and not docker"` selects 0 of 9; `-m integration` selects 9                         |
| backend tests (notification, push, SMS, message delivery, consent, org-scoping ratchet, CSV, LIKE) | ✅ **607 passed, 1 skipped** (optional `pywebpush`)                                                                      |
| `check_route_permissions.py --strict`                                                              | ✅ 0 errors, 0 warnings (no route added or removed)                                                                      |
| frontend                                                                                           | n/a — no frontend file changed, so `tsc` / `eslint` / `vitest` were not re-run                                           |

---

## Pass 4 (2026-08-09) — NOTIF2-3 DNS-rebinding residual closed at send time

The one substantive standing item on this module was the DNS-rebinding residual
on Web Push. Pass 4 closes it — in the place pass 3 identified as the right one
(send time, not subscribe time), which is also why it no longer collides with the
test harness pass 3 flagged as the blocker.

### NOTIF2-3 (residual) — MED — Public push host re-pointed at an internal IP after subscribe — ✅ FIXED

**What:** `validate_push_endpoint` blocks IP-literal / localhost / `.internal`
hosts at subscribe time, but a **public hostname that resolves to a private IP**
(DNS rebinding) slipped through — and `PushService._send_one` later hands the
stored endpoint to `webpush`, which POSTs to it. So a member could register a
public host, flip its DNS to `169.254.169.254` / `127.0.0.1` / an intranet host,
and turn each push to themselves into a blind SSRF.

**Why it stayed flagged until now:** pass 3 recorded that adding real DNS
resolution _at subscribe time_ would break the delivery integration tests (they
call `service.subscribe` directly with a `127.0.0.1` endpoint) and the 17
endpoint-validation unit tests (non-resolving fake hosts). The insight this pass:
the rebinding window is _between subscribe and send_, so the correct guard is at
**send time**, which sidesteps the subscribe-time harness entirely.

**Fix:** `_send_one` now calls the shared `assert_outbound_url_safe(endpoint)`
(the same send-time re-resolution the Slack/Discord/Teams/webhook integrations
use) immediately before `webpush`, and `send_to_user` gained an `except ValueError`
that **skips** an endpoint that now resolves non-public (logs a warning, keeps the
row — a transient mis-resolution shouldn't permanently drop a device). The check
runs inside the `asyncio.to_thread` worker, so the blocking `getaddrinfo` stays
off the event loop. It is **gated to `ENVIRONMENT in ("production", "staging")`**,
so the loopback push emulator the wire-format tests (and local dev) point at still
works — mirroring the `http`-in-development allowance already baked into the URL
validator. In prod/staging the rebinding window shrinks to the resolve→connect
interval, the same guarantee the outbound integrations already have. The
subscribe-time `validate_push_endpoint` (IP-literals/localhost/`.internal`) still
runs in **all** environments, so the obvious-internal endpoints are blocked
everywhere regardless.

**4 DB-free tests added** (`test_push_rebinding_guard.py`): production blocks a
private-resolving endpoint (webpush never called) and allows a public one; staging
also guards; development skips the guard so a loopback endpoint still dispatches.

### Still flagged (unchanged)

- Unused frontend `markLogRead` (frontend-shared cleanup); `get_logs` pagination
  (build-query-then-subquery-count, fine at scale).

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_push_rebinding_guard.py` **4 passed** +
`test_push_endpoint_validation.py` **17 passed** (all DB-free). The push
wire-format `TestSend` tests are DB-backed (`db_session`) and unaffected — they run
under the default `development` env, where the new guard is intentionally skipped.

---

## Pass 3 (2026-08-09) — latent-500 on rule enums; push SSRF re-verified

Re-verified NOTIF2-3 (`validate_push_endpoint` at the API boundary, `push_service.py`

- `notifications.py:380`) and the push scoping/fail-safe delivery hold. The B1
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
subscribe time, but a public hostname that _resolves_ to a private IP still isn't
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
_resolves_ to a private IP (DNS rebinding) isn't caught without a resolve-time IP
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

| Check                     | Result                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8` (service + test) | ✅ 0 violations                                                                                                                                                              |
| `black --check`           | ✅ unchanged                                                                                                                                                                 |
| `tsc --noEmit`            | ✅ n/a — no frontend change                                                                                                                                                  |
| `eslint`                  | ✅ n/a — no frontend change                                                                                                                                                  |
| backend tests             | ✅ `test_notification_dispatch` + `test_notifications_service` + `test_security_notifications`: **17 passed** (2 new `TestErrorSanitization`). No DB needed for these files. |
