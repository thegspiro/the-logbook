# Troubleshooting: Backend

Solutions for backend API, startup, and service issues in The Logbook.

---

## Backend Won't Start

### "SECURITY FAILURE" Error

**Cause:** Default or missing security configuration in production mode.

**Fix:** Generate required secrets:
```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_SALT=$(openssl rand -hex 16)"
```
Add to `.env` and restart: `docker-compose restart backend`

### "Database not initialized" Error

**Cause:** Backend started before MySQL was ready.

**Fix:**
```bash
docker-compose down
docker-compose up -d mysql
# Wait for MySQL to be healthy
docker-compose up -d backend frontend
```

### "Can't connect to MySQL server" Error

**Cause:** `DB_HOST` doesn't match Docker service name.

**Fix:** Set `DB_HOST=mysql` in `.env` (not `db`).

---

## API Errors

### Health Check

```bash
# Backend health
curl http://YOUR-IP:3001/health
# Expected: {"status":"healthy","timestamp":"..."}

# Database health
curl http://YOUR-IP:3001/health/db

# Redis health
curl http://YOUR-IP:3001/health/redis
```

### Common API Errors

| Status | Meaning | Common Cause |
|--------|---------|-------------|
| 400 | Bad Request | Invalid input, missing required fields |
| 401 | Unauthorized | Expired or missing JWT token |
| 403 | Forbidden | Insufficient permissions for this action |
| 404 | Not Found | Invalid ID or endpoint |
| 409 | Conflict | Duplicate entry (email, barcode, etc.) |
| 422 | Validation Error | Request body fails schema validation |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Check backend logs for stack trace |

### Viewing Detailed Error Logs

```bash
# Recent backend logs
docker-compose logs --tail=100 backend

# Follow logs in real-time
docker-compose logs -f backend

# Search for specific errors
docker-compose logs backend | grep "ERROR"
docker-compose logs backend | grep "Traceback"
```

---

## Database Migration Issues

### "Multiple heads detected"
```bash
# Check migration chain
docker-compose exec backend alembic heads
docker-compose exec backend alembic history --verbose
```

### Migration version mismatch
```bash
# Check current version
docker-compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD the_logbook -e "SELECT * FROM alembic_version;"

# Run all pending migrations
docker-compose exec backend alembic upgrade head
```

---

## Performance Issues

### Slow API Responses

1. Check database query performance:
```bash
docker-compose exec mysql mysql -u root -p -e "SHOW PROCESSLIST;"
```

2. Check Redis is running and caching:
```bash
docker-compose exec redis redis-cli --no-auth-warning -a $REDIS_PASSWORD INFO stats
```

3. Check backend resource usage:
```bash
docker stats logbook-backend
```

---

## MissingGreenlet Errors

**Symptom:** `MissingGreenlet: greenlet_spawn has not been called` in logs

**Cause:** Accessing lazy-loaded SQLAlchemy relationships in an async context without eager loading.

**Fix:** Use `selectinload()` for relationships accessed after `await`:
```python
result = await db.execute(
    select(User).options(selectinload(User.roles)).where(User.id == user_id)
)
```

This was a common issue fixed across multiple modules in February 2026.

---

## DateTime Warnings

**Symptom:** `DeprecationWarning: datetime.datetime.utcnow()` in logs

**Status:** Fixed across the entire backend in February 2026. All `datetime.utcnow()` calls replaced with `datetime.now(timezone.utc)`.

---

## API Documentation

The backend automatically generates API documentation:

| URL | Format |
|-----|--------|
| `http://YOUR-IP:3001/docs` | Swagger UI (interactive) |
| `http://YOUR-IP:3001/redoc` | ReDoc (read-only) |
| `http://YOUR-IP:3001/openapi.json` | OpenAPI JSON spec |

---

## Migration Issues on Unraid (2026-02-24)

### Alembic Revision KeyError on Startup

**Error:** `KeyError: '20260223_0200'` or `Revision X is not present`

**Cause:** Unraid's union filesystem (shfs) can make Docker bind-mounted migration files transiently invisible. Stale `__pycache__` from a different Python version also confuses module loading.

**Status:** Fixed with multiple resilience improvements:
- Automatic `__pycache__` cleanup before Alembic loads
- Retry with backoff (up to 3 attempts with 1s/2s delays)
- SQL-based stamp fallback when graph resolution fails
- Model-based `create_all` fallback when upgrade fails

```bash
git pull origin main
docker-compose build --no-cache backend
docker-compose up -d
```

---

## Security Updates (2026-02-24)

### Authentication Now Uses httpOnly Cookies

JWT tokens are no longer stored in `localStorage`. Authentication uses httpOnly cookies exclusively. WebSocket connections use cookies instead of URL tokens.

**Impact:** If you have custom API integrations using `Authorization: Bearer` headers, update them to handle cookie-based authentication.

### Rate Limiting Added

Application-level rate limiting (slowapi + Redis) has been added. If you see 429 errors, reduce request frequency or adjust rate limit settings.

---

## Dependency Updates (2026-02-24)

Backend dependencies updated for Python 3.13 compatibility:
- cryptography 44.0.0, Pillow 11.3.0, argon2-cffi 25.1.0, psutil 7.0.0, reportlab 4.3.0
- See CHANGELOG for full list

---

## Centralized Logging (2026-02-27)

Backend logging has been centralized through Loguru with Sentry integration. All log output (including uvicorn, sqlalchemy, and alembic) is routed through a single configuration.

### Request Correlation IDs

Every HTTP request is assigned a UUID4 correlation ID. All log entries within that request include the ID, making it easy to trace a single request across all services.

```bash
# Trace a specific request through all log entries
docker-compose logs backend | grep "req_id=<UUID>"

# Find slow requests (>1000ms)
docker-compose logs backend | grep "duration=" | awk -F'duration=' '{if ($2+0 > 1000) print}'
```

### Log Output Formats

- **Development**: Human-readable text format with colors
- **Production**: Structured JSON format (set `LOG_FORMAT=json` in `.env`)
- **File rotation**: Logs rotate at 10MB with 7-day retention

### Sentry Integration

Error tracking with Sentry is enabled when `SENTRY_ENABLED=true` and `SENTRY_DSN` is configured. Verify:
```bash
docker-compose exec backend python -c "import sentry_sdk; print(sentry_sdk.is_initialized())"
```

### Duplicate Log Entries

If you see duplicate log lines, remove any custom `logging.basicConfig()` or `logging.getLogger()` calls. All logging should use Loguru via `from loguru import logger`.

---

## Auth Token Persistence (2026-02-27)

### Problem: User logged out on page refresh

**Status (Fixed):** Auth tokens are now properly persisted in `localStorage`. Previously, a race condition could clear tokens during page refresh. If users still experience this, clear browser storage and re-login.

---

## Platform Analytics API Errors (2026-02-28)

### Problem: Platform Analytics returns snake_case fields

**Status (Fixed):** Platform analytics response schemas were missing `alias_generator=to_camel` configuration. The frontend expected camelCase field names but received snake_case, causing empty/error state on the dashboard. Pull latest changes.

### Problem: Analytics crashes on empty data

**Status (Fixed):** The analytics service now handles null values from empty database tables safely, returning zero counts instead of throwing errors.

---

## ResponseValidationError on Create (2026-02-28)

### Problem: `ResponseValidationError` after creating a resource

**Cause:** After `db.flush()`, SQLAlchemy may not populate server-side computed columns (defaults, triggers). When Pydantic tries to serialize the response, required fields are `None`.

**Status (Fixed):** Added `db.refresh()` after `db.flush()` to ensure all computed columns are populated before Pydantic serialization.

---

## Brute-Force Protection & Rate Limiting (2026-02-28)

### Progressive Rate Limiting on Login

The login endpoint now applies progressive rate limiting:
- IP-based tracking of failed login attempts
- Per-user tracking of failed login attempts
- Exponential backoff delays after repeated failures
- 30-minute lockout after exceeding configurable threshold

**If legitimate users are locked out**: Wait for the lockout period to expire (30 minutes). Administrators can review security alerts in the Security Monitoring dashboard.

### Security Middleware Hardening

The security middleware has been hardened with:
- CSRF validation on all state-changing requests
- Improved rate limit tracking via Redis
- Better error response sanitization

---

## Security Alert Persistence (2026-02-28)

### Security Alerts Now Stored in Database

Security alerts are now persisted to a `security_alerts` table (migration `20260228_0100`). This enables:
- Historical alert review
- Alert acknowledgement and resolution workflow
- Integration with the Security Monitoring dashboard

**If alerts are missing**: Run `alembic upgrade head` to create the new table.

### Audit Log Export

A new endpoint allows exporting audit logs with date range filters:
```
GET /api/v1/security/audit-log/export?start_date=2026-01-01&end_date=2026-02-28
```
Requires `security.manage` permission.

### Audit Archival

A scheduled task archives old audit log entries to cold storage while maintaining hash chain integrity. After archival, use the `rehash_chain` endpoint to rebuild the hash chain.

### Audit Deletion Logging

All audit log deletion operations are themselves logged for accountability — you cannot silently delete audit entries.

### Hardened File Logs

File-based log rotation now uses secure permissions and restricted access paths. Log files are rotated at 10MB with 7-day retention.

---

## IDOR & Authorization Fixes (2026-02-28)

### Documents Endpoint

**Status (Fixed):** Added organization-scoped validation to prevent cross-org document access.

### Training Endpoints

**Status (Fixed):** Added authorization checks ensuring users can only access training data within their organization.

---

## Backend Formatting (2026-02-28)

Black formatting has been applied across 35 backend files. If you see formatting-related merge conflicts after pulling, accept the Black-formatted version.

---

## Session Idle Timeout Blocking Logins (2026-03-01)

### Problem: All users unable to log in — sessions immediately expire

**Cause:** MySQL timezone mismatch between application and database caused idle timeout checks to compare UTC timestamps against local timestamps, making all sessions appear expired.

**Status (Fixed):** Session idle timeout queries now explicitly use UTC for all timestamp comparisons.

**If on older version:** Set `DB_TIMEZONE=+00:00` in `.env` or update to latest.

---

## Login 500 on Transient DB Failures (2026-03-01)

### Problem: Login returns HTTP 500 during database reconnection

**Cause:** Transient connection failures caused unhandled exceptions in the login endpoint.

**Status (Fixed):** Login endpoint now returns HTTP 503 with user-friendly message. Automatic retry recommended.

---

## MySQL Outage Resilience (2026-03-01)

### Problem: API errors during brief MySQL outages

**Status (Improved):** Database connection pool now includes:
- `pool_pre_ping=True` for dead connection detection
- Automatic reconnection on stale connections
- Health check queries before reusing connections

---

## Organization Settings Crash (2026-03-01)

### Problem: `AttributeError` in OrganizationSettings.redacted()

**Status (Fixed):** The `redacted()` method crash has been resolved. An associated auth secret leak that could expose sensitive configuration has also been closed.

---

## MissingGreenlet in Admin Hours (2026-03-01)

### Problem: `MissingGreenlet: greenlet_spawn has not been called` in admin hours

**Cause:** Lazy-loaded SQLAlchemy relationships in admin hours service accessed without eager loading.

**Status (Fixed):** Added `selectinload()` for all relationship accesses in admin hours queries.

---

## Email Template ENUM Mismatch (2026-03-01)

### Problem: `Data truncated for column 'template_type'` when creating email templates

**Cause:** MySQL ENUM column doesn't include the 10 newly added template types.

**Fix:**
```bash
docker-compose exec backend alembic upgrade head
docker-compose restart backend
```

---

## Backend Formatting (2026-03-01)

Black formatting has been applied to 9 additional backend files. If you see formatting-related merge conflicts after pulling, accept the Black-formatted version.

---

## Python Typing Modernization (2026-03-02)

### Backend type errors after updating

**Cause:** Python typing modernized across 56 files using `pyupgrade --py313-plus`. All `Optional[X]` → `X | None`, `List[X]` → `list[X]`, etc.

**Requirement:** Python 3.10+ (project requires 3.13+). Older Python versions will raise `TypeError` at import time.

---

## IP Spoofing Fix (2026-03-02)

### User IP addresses incorrect in audit logs

**Status (Fixed):** Security middleware hardened to use only the rightmost untrusted IP from `X-Forwarded-For`. If using a reverse proxy, ensure it is configured as trusted.

### Deprecated startup warnings in logs

**Status (Fixed):** `on_event("startup")`/`on_event("shutdown")` replaced with FastAPI lifespan context manager.

---

## MissingGreenlet — Remaining Services (2026-03-02)

### Problem: MissingGreenlet errors on email template or other service endpoints

**Status (Fixed):** Added `selectinload()` eager loading across all remaining backend services. Template `create_template` now refreshes timestamps explicitly to prevent MissingGreenlet during response serialization.

---

## Pipeline Stage Reorder 500 Error (2026-03-02)

### Problem: Intermittent 500 error when reordering pipeline stages

**Cause:** Race condition in sort order calculation — concurrent requests could produce duplicate sort order values.

**Status (Fixed):** Endpoint now uses database-level locking to prevent concurrent reorder conflicts. The 422 error on step reorder was also fixed by correcting the request body schema.

---

## Events Settings 422 Error (2026-03-02)

### Problem: Events settings page fails to load with 422 validation errors

**Cause:** Incorrect request/response handling in the events settings API endpoint.

**Status (Fixed):** Endpoint refactored to fix validation handling. Pull latest changes and restart backend.

---

## Inventory CSV Import Validation (2026-03-02)

### Problem: CSV import endpoint returns validation errors

**Cause:** The new inventory CSV import endpoint (`POST /api/v1/inventory/import`) validates headers, data types, category references, and duplicate serial numbers.

**Fix:** Ensure your CSV follows the expected format:
- Required columns: `name`, `category`
- Category names must match existing categories in your organization
- Serial numbers must be unique within the organization
- Download the sample template from the import page for reference

---

## Onboarding Auth Cookie Missing (2026-03-04)

### Problem: Onboarding Step 7 returns tokens in body but no httpOnly cookies

**Status (Fixed):** `backend/app/api/v1/onboarding.py` now returns `JSONResponse` with `_set_auth_cookies()`, matching the login endpoint pattern.

**Symptoms:** Steps 8–10 fail with 401; redirect to `/login` instead of continuing onboarding.

---

## WebSocket CSRF Dependency Error (2026-03-04)

### Problem: 500 error on `/api/v1/inventory/ws` WebSocket endpoint

**Status (Fixed):** `verify_csrf_token` changed to accept `HTTPConnection` (base class of `Request` and `WebSocket`). Early return for WebSocket scope — CSRF is HTTP-specific; WebSocket already uses JWT.

---

## ProspectResponse Metadata Serialization (2026-03-04)

### Problem: ResponseValidationError — metadata field returns SQLAlchemy MetaData object

**Status (Fixed):** Changed from `alias="metadata"` to `serialization_alias="metadata"` in `ProspectResponse` schema. Pydantic now reads `metadata_` attribute (JSON column) instead of `metadata` (SQLAlchemy MetaData).

**Edge Case:** Custom queries accessing `Prospect.metadata` directly should use `prospect.metadata_`.

---

## SQLAlchemy Relationship Overlap Warnings (2026-03-04)

### Problem: SAWarning about overlapping column writes at startup

**Status (Fixed):** Added missing `back_populates` on:
- `Event.recurrence_children` / `recurrence_parent`
- `StorageArea.parent` / `children` (self-referential)

---

## Email Template Enum Drift (2026-03-04)

### Problem: 500 error on email templates — missing `duplicate_application` enum value

**Status (Fixed):** DB ALEMBIC migration adds missing enum value. Sync test prevents future drift.

**Fix:** `docker exec logbook-backend alembic upgrade head`

### CC/BCC support added

Each email template now supports default CC/BCC. BCC also available for scheduled emails.

---

## Form-to-Pipeline Integration Hardening (2026-03-04)

### Problem: Form submissions not flowing to prospective members pipeline

**Status (Fixed):** 13 improvements — label-based fallback, server-side validation, reprocessing fix, O(N) cleanup query optimization, field compatibility checks.

### Problem: Duplicate prospects not detected

**Status (Fixed):** Duplicate detection by email with coordinator notification added.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Database Issues](Troubleshooting-Database)
