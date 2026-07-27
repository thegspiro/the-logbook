# Module Audit — Notifications

**Files:** `app/api/v1/endpoints/notifications.py` (318 L, 15 endpoints),
`app/services/notifications_service.py` (415 L), model
`app/models/notification.py`. Rendered in-app (bell inbox, dashboard,
`NotificationsPage`, admin `MessagesAdminPage`).
**Audited:** iteration 11.

## Verified good ✅
- **Auth coverage:** all 15 endpoints authenticated. Rule CRUD requires
  `notifications.manage`; rule/log reads `notifications.view`; the personal
  inbox (`/my/*`) uses `get_current_user`.
- **User-scoping / IDOR prevention is exemplary.** The personal inbox paths
  (`get_user_notifications`, `get_user_unread_count`,
  `mark_all_user_notifications_read`, `toggle_pin`) all filter
  `recipient_id == current_user.id` in addition to `organization_id`.
  `mark_as_read` takes an optional `user_id` and **documents** the IDOR: the
  `/my/{id}/read` route passes it (recipient-scoped) so a member can't mark
  another member's notification read by guessing the id; the privileged
  org-management route omits it. The frontend inbox (Dashboard,
  NotificationsPage) uses only the recipient-scoped `/my/*` methods.
- **Tenant isolation:** rule mutations route through the org-scoped
  `get_rule_by_id`; every log/summary query filters `organization_id`.
- **No SQL injection, no PK-bypass, no cross-org FKs on create** (rules are
  org-config; logs are created internally by `log_notification`, not from a
  client-supplied recipient). flake8 clean; no TODO/FIXME.

## Findings

### NOTIF-1 — LOW — `/logs/{id}/read` was a `.view`-gated org-wide write — ✅ FIXED
`POST /logs/{log_id}/read` (`mark_notification_read`) marks **any** org
notification log read (org-wide, no recipient scoping) but required only
`notifications.view`, while the sibling `POST /logs/read-all` requires
`notifications.manage`. So a view-only admin could mark any single org
notification read (mild integrity issue — could clear another member's unread
flag) despite lacking manage. The endpoint has **no frontend caller** (the UI's
single mark-read goes through the recipient-scoped `/my/{id}/read`).
**Fix:** raised the gate to `notifications.manage`, matching `/logs/read-all`,
and documented that members use the `/my/` route. Safe — no caller to break.

## Notes
- `NotificationsService.markLogRead` (frontend service method for
  `/logs/{id}/read`) is now effectively unused by any component — a candidate
  for removal in a future frontend cleanup (left as-is; out of this iteration's
  scope).
- `NotificationsPage.handleMarkAllRead` calls the admin `markAllLogsRead`
  (`notifications.manage`) for its admin-logs section, while its inbox section
  uses `markAllMyNotificationsRead` (`/my/`) — correct separation; noted for
  clarity.
