# API Reference

The Logbook provides a RESTful API built with FastAPI. Interactive documentation is available at runtime.

---

## Interactive Documentation

| URL | Format | Description |
|-----|--------|-------------|
| `/docs` | Swagger UI | Interactive API explorer — try endpoints directly |
| `/redoc` | ReDoc | Clean, readable API documentation |
| `/openapi.json` | OpenAPI 3.0 | Machine-readable JSON spec |

> Access these at `http://YOUR-IP:3001/docs` (or your configured backend port).

---

## Authentication

All authenticated endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Obtaining a Token

```bash
curl -X POST http://YOUR-IP:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password"}'
```

Response:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer"
}
```

---

## API Modules

### Core Endpoints

| Prefix | Module | Description |
|--------|--------|-------------|
| `/api/v1/auth` | Authentication | Login, logout, refresh, password reset, MFA |
| `/api/v1/users` | Members | User CRUD, profiles, leaves, rank validation |
| `/api/v1/onboarding` | Onboarding | Organization setup wizard |
| `/api/v1/settings` | Settings | Organization and module configuration |
| `/api/v1/notifications` | Notifications | Notification rules, logs, user inbox, and department messages |

### Module Endpoints

| Prefix | Module | Permission |
|--------|--------|------------|
| `/api/v1/training` | Training | `training.manage` (admin) |
| `/api/v1/scheduling` | Scheduling | `scheduling.manage` (admin) |
| `/api/v1/events` | Events | `events.manage` (admin) |
| `/api/v1/elections` | Elections | `elections.manage` (admin) |
| `/api/v1/inventory` | Inventory | `inventory.manage` (admin) |
| `/api/v1/equipment-checks` | Equipment Checks | `equipment_check.manage` (admin) |
| `/api/v1/facilities` | Facilities | `facilities.manage` (admin) |
| `/api/v1/apparatus` | Apparatus | Authenticated |
| `/api/v1/forms` | Forms | Authenticated |
| `/api/v1/minutes` | Meeting Minutes | Authenticated |
| `/api/v1/documents` | Documents | Authenticated |
| `/api/v1/pipelines` | Prospective Members | `prospective_members.manage` |
| `/api/v1/reports` | Reports | `reports.view` |

### Public Endpoints (No Auth Required)

| Prefix | Description |
|--------|-------------|
| `/api/public/v1/forms/{slug}` | Public form access |
| `/api/public/v1/forms/{slug}/submit` | Public form submission (rate-limited) |
| `/api/public/portal/*` | Public portal endpoints (API key required) |
| `/health` | Health check |
| `/health/db` | Database health |
| `/health/redis` | Redis health |

### Security & Monitoring

| Prefix | Description |
|--------|-------------|
| `/api/v1/security/status` | Security dashboard |
| `/api/v1/security/alerts` | Security alerts |
| `/api/v1/security/audit-log/integrity` | Audit log verification |
| `/api/v1/security/intrusion-detection/status` | IDS status |

---

## Notification Endpoints *(2026-03-23)*

```
GET    /api/v1/notifications/rules                       # List notification rules
POST   /api/v1/notifications/rules                       # Create notification rule
GET    /api/v1/notifications/rules/{id}                  # Get rule
PATCH  /api/v1/notifications/rules/{id}                  # Update rule
DELETE /api/v1/notifications/rules/{id}                  # Delete rule
POST   /api/v1/notifications/rules/{id}/toggle           # Toggle rule enabled/disabled
GET    /api/v1/notifications/logs                        # List notification logs
POST   /api/v1/notifications/logs/{id}/read              # Mark log as read
GET    /api/v1/notifications/my                          # User's in-app notifications
GET    /api/v1/notifications/my/unread-count             # User's unread count
POST   /api/v1/notifications/my/read-all                 # Bulk mark all as read
POST   /api/v1/notifications/my/{log_id}/read            # Mark own notification as read
GET    /api/v1/notifications/summary                     # Rule and send statistics
```

## Equipment Check Endpoints *(2026-03-19)*

```
POST   /api/v1/equipment-checks/templates                    # Create template
GET    /api/v1/equipment-checks/templates                    # List templates
GET    /api/v1/equipment-checks/templates/{id}               # Get template
PATCH  /api/v1/equipment-checks/templates/{id}               # Update template
DELETE /api/v1/equipment-checks/templates/{id}               # Delete template
POST   /api/v1/equipment-checks/templates/{id}/compartments  # Add compartment
PATCH  /api/v1/equipment-checks/compartments/{id}            # Update compartment
DELETE /api/v1/equipment-checks/compartments/{id}            # Delete compartment
POST   /api/v1/equipment-checks/compartments/{id}/items      # Add item
PATCH  /api/v1/equipment-checks/items/{id}                   # Update item
DELETE /api/v1/equipment-checks/items/{id}                   # Delete item
GET    /api/v1/equipment-checks/shifts/{shift_id}/checklists # Applicable checklists for shift
POST   /api/v1/equipment-checks/shifts/{shift_id}/checks     # Submit equipment check
GET    /api/v1/equipment-checks/my-checklists                # Member's pending/recent checks
POST   /api/v1/equipment-checks/checks/{id}/items/{item_id}/photos  # Upload check photos
GET    /api/v1/equipment-checks/reports/compliance           # Compliance dashboard
GET    /api/v1/equipment-checks/reports/failures             # Failure/deficiency log
GET    /api/v1/equipment-checks/reports/trends               # Item trend history
GET    /api/v1/equipment-checks/reports/export               # CSV/PDF export
```

## Shift Completion Reports *(2026-03-28)*

```
POST   /api/v1/training/shift-reports                                  # Create shift completion report
GET    /api/v1/training/shift-reports/my-reports                       # Trainee's approved reports
GET    /api/v1/training/shift-reports/my-stats                         # Trainee's aggregate statistics
GET    /api/v1/training/shift-reports/officer-analytics                # Org-wide officer analytics
GET    /api/v1/training/shift-reports/by-officer                       # Reports filed by current officer
GET    /api/v1/training/shift-reports/pending-review                   # Reports awaiting review
GET    /api/v1/training/shift-reports/drafts                           # Auto-created drafts from finalization
GET    /api/v1/training/shift-reports/all                              # All org reports (filtered, paginated)
GET    /api/v1/training/shift-reports/trainee/{trainee_id}             # Reports for specific trainee
GET    /api/v1/training/shift-reports/trainee/{trainee_id}/stats       # Stats for specific trainee
GET    /api/v1/training/shift-reports/shift-preview/{shift_id}/{trainee_id}  # Auto-populate preview
GET    /api/v1/training/shift-reports/{report_id}                      # Get specific report
PUT    /api/v1/training/shift-reports/{report_id}                      # Update draft report
POST   /api/v1/training/shift-reports/{report_id}/acknowledge          # Trainee acknowledges report
POST   /api/v1/training/shift-reports/{report_id}/review               # Officer reviews (approve/flag/redact)
```

## Shift Finalization *(2026-03-28)*

```
POST   /api/v1/scheduling/shifts/{id}/finalize                         # Finalize shift (snapshot data, create draft reports)
```

## Election Results & Verification *(2026-03-29)*

```
POST   /api/v1/elections/{id}/send-report                              # Email election results to voters
GET    /api/v1/elections/{id}/verify-receipt                            # Public vote receipt verification (rate-limited)
```

## Department Messages *(2026-03-23)*

```
GET    /api/v1/messages                                  # List department messages
POST   /api/v1/messages                                  # Create department message
GET    /api/v1/messages/{id}                             # Get message
PATCH  /api/v1/messages/{id}                             # Update message
DELETE /api/v1/messages/{id}                             # Delete message
POST   /api/v1/messages/{id}/read                        # Mark message as read
POST   /api/v1/messages/{id}/clear                       # Admin clear persistent message
```

---

## Common Response Patterns

### Success (200/201)
```json
{
  "id": "uuid",
  "field": "value",
  "created_at": "2026-02-23T12:00:00Z"
}
```

### Validation Error (422)
```json
{
  "detail": [
    {
      "loc": ["body", "field_name"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

### Permission Error (403)
```json
{
  "detail": "Insufficient permissions. Required: training.manage"
}
```

---

## Rate Limiting

| Endpoint Type | Limit |
|--------------|-------|
| Login | 5 requests/minute per IP |
| General API | 60 requests/minute per user |
| Public form view | 60 requests/minute per IP |
| Public form submit | 10 requests/minute per IP |

---

## Pagination

List endpoints support pagination:

```
GET /api/v1/users?page=1&per_page=25&sort=last_name&order=asc
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 1 | Page number |
| `per_page` | 25 | Items per page (max 100) |
| `sort` | varies | Sort field |
| `order` | `asc` | Sort direction (`asc` or `desc`) |

---

**See also:** [Backend Development](Development-Backend) | [Technology Stack](Technology-Stack)
