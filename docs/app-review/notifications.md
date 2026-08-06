# Application Review — Notifications (Tier B, 2nd pass)

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
