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
| `/api/v1/notifications` | Notifications | In-app notification management |

### Module Endpoints

| Prefix | Module | Permission |
|--------|--------|------------|
| `/api/v1/training` | Training | `training.manage` (admin) |
| `/api/v1/scheduling` | Scheduling | `scheduling.manage` (admin) |
| `/api/v1/events` | Events | `events.manage` (admin) |
| `/api/v1/elections` | Elections | `elections.manage` (admin) |
| `/api/v1/inventory` | Inventory | `inventory.manage` (admin) |
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
