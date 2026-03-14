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

## Facilities MissingGreenlet Error (2026-03-05)

### Problem: Creating/updating maintenance records returns 500

**Status (Fixed):** Lazy-loaded `Facility.maintenance_records` relationship accessed synchronously in async context causes `MissingGreenlet: greenlet_spawn has not been called`.

**Fix:** Pull latest. Queries now use `selectinload(Facility.maintenance_records)`.

**Edge Case:** Any lazy-loaded relationship in async SQLAlchemy will cause this error. Always use `selectinload()` or `joinedload()` in async queries when accessing relationships.

---

## GrantNote Metadata Attribute Conflict (2026-03-05)

### Problem: Backend crashes on import — `AttributeError` on GrantNote model

**Status (Fixed):** Column `metadata` renamed to `note_metadata` to avoid shadowing SQLAlchemy's `Base.metadata`. Pydantic schema uses `serialization_alias="metadata"` for API compatibility.

**Fix:** `docker exec logbook-backend alembic upgrade head`

---

## Grants Module Serialization (2026-03-05)

### Problem: Grant API returns snake_case field names

**Status (Fixed):** Several response schemas were missing `alias_generator=to_camel`. All grant schemas now have consistent camelCase output.

### Problem: N+1 queries on grant-donor relationships

**Status (Fixed):** Added `selectinload` for eager loading.

---

## Reports Rank Column (2026-03-05)

### Problem: Reports show rank codes (FF1, LT) instead of display names

**Status (Fixed):** Report query now joins ranks table. Members whose rank was deleted show the raw code as fallback.

---

## WebSocket Inventory 403 (2026-03-05)

### Problem: Inventory WebSocket connection rejected with 403

**Status (Fixed):** WebSocket upgrade request was missing auth cookie. The `withCredentials` flag is now set on the connection.

---

## Inventory 422 on Optional Fields (2026-03-05)

### Problem: Item create/update returns 422 Unprocessable Entity

**Status (Fixed):** Empty optional fields (notes, description) were sent as `""` instead of omitted. Pydantic's `Optional[str]` with `min_length=1` validators rejected empty strings. Frontend now omits empty optional fields.

---

## Login Cookie Delivery (2026-03-06)

### Problem: Login returns 200 but cookies not stored by browser

**Status (Fixed):** Multiple causes: (1) `_clear_auth_cookies()` before `_set_auth_cookies()` produced conflicting Set-Cookie headers, (2) Starlette `BaseHTTPMiddleware` stripped Set-Cookie when stacked, (3) stale cookies from previous sessions with different `SECRET_KEY`. SecurityHeaders and IPLogging middleware converted to pure ASGI. Login no longer clears cookies before setting. User data included directly in login response to eliminate race condition.

---

## Security Middleware Memory Growth (2026-03-06)

### Problem: Backend memory usage grows unbounded under sustained traffic

**Status (Fixed):** `SecurityMonitoringService` tracking dicts (`_api_calls`, `_login_attempts`, `_session_ips`, `_data_transfers`) and alerts list grew without limit. Added periodic eviction and trimming. Public portal rate-limit caches also capped.

**Monitor:** `docker stats logbook-backend` to verify memory stays stable.

---

## Facilities Startup Crash Chain (2026-03-06)

### Problem: Backend crashes on startup with facilities module enabled

**Status (Fixed):** Chain: FK reference to wrong table (`roles` vs `positions`), ~50 SET NULL FK columns missing `nullable=True`, duplicate migration, NOT NULL `organization_id` on system seed records, missing seed data. All resolved.

**Fix:** `docker exec logbook-backend alembic upgrade head`

---

## Facilities Route Ordering (2026-03-06)

### Problem: Static facility routes (maintenance, maintenance-types) return 404

**Status (Fixed):** `GET /{facility_id}` was defined before static routes. Moved to end of router.

---

## Auth Refresh 422 (2026-03-06)

### Problem: Token refresh returns 422 Unprocessable Entity

**Status (Fixed):** Frontend sent `{}` body which Pydantic rejected. Changed to `undefined`. `TokenRefresh.refresh_token` made optional. Cookie path fixed to `/api/v1/auth/` (with trailing slash).

---

## Onboarding 422 on Empty Optional Fields (2026-03-06)

### Problem: Creating organization during onboarding returns 422

**Status (Fixed):** Empty strings passed through `??` (nullish coalescing) to backend where Pydantic validators rejected them. Changed to `|| undefined`.

---

## Pydantic 422 Error Formatting (2026-03-06)

### Problem: 422 errors display as "[object Object]" in frontend

**Status (Fixed):** FastAPI returns validation errors as arrays. `toAppError()` now detects and formats them as "field: reason".

---

## SQLAlchemy JSON Column Silent Write Failures (2026-03-12)

### Problem: Organization/event settings changes not persisting after save

**Status (Fixed):** `dict()` shallow copy shares nested dict references with SQLAlchemy's committed state. Mutations appear to work in-memory but are silently skipped during flush because SQLAlchemy sees old == new.

**Fix:** Use `copy.deepcopy()` for independent copy, or `flag_modified()` after in-place mutation. Affected endpoints: event settings, election settings, organization settings.

**Edge Case:** `MutableDict.as_mutable(JSON)` detects top-level key changes but misses nested mutations.

---

## Minutes Module Table Name Mismatch (2026-03-12)

### Problem: Backend startup fails with "Table 'meeting_action_items' doesn't exist"

**Status (Fixed):** Alembic migration `20260312_0200` renames table to match SQLAlchemy model. Run `alembic upgrade head`.

---

## Auth Cookies on LAN HTTP (2026-03-12)

### Problem: Auth cookies not set on plain HTTP deployments

**Status (Fixed):** `Secure` flag was hardcoded `True`. Now auto-detects from `ALLOWED_ORIGINS` scheme. HTTP origins → `Secure=False`.

**New env var:** `NGINX_WORKER_PROCESSES` (default: `auto`) prevents excessive Nginx workers on high-core servers.

---

## Custom Event Categories Schema (2026-03-12)

### Problem: Saving custom categories returns 422

**Status (Fixed):** Pydantic schema expected strings but frontend sends objects (`{id, label, color}`). Schema updated.

---

## Flake8 Violations in Elections, Onboarding, Org Service (2026-03-12)

### Problem: Pre-existing flake8 violations (F401, E303, W291)

**Status (Fixed):** Unused imports removed, excess blank lines cleaned, trailing whitespace removed in `elections.py`, `onboarding.py`, `organization_service.py`, `ip_security.py`, `sms_service.py`, `scheduled_tasks.py`.

---

## Email Logo Duplication (2026-03-12)

### Improvement: DRY email logo utility

Duplicated org logo HTML building code across 7 service files extracted into shared `build_logo_html()` and `get_org_logo_url()` in `email_service.py`. All email notifications now consistently include org logo.

---

## SMTP Credential Decryption Failure (2026-03-13)

### Problem: Encrypted SMTP password sent as-is to mail server

**Symptoms:** All outbound emails fail with SMTP authentication error. Logs show `smtplib.SMTPAuthenticationError`.

**Root Cause:** The email service was reading SMTP credentials from organization settings without decrypting them. The encrypted string was sent as the password.

**Fix (Commit `831d72b`):** Email service now decrypts stored SMTP credentials before establishing the SMTP connection. Also guards against `None` settings to prevent `TypeError`.

---

## SMTP Provider Compatibility (2026-03-13)

### Problem: Email sending fails for Gmail, Office 365, or self-hosted SMTP

**Symptoms:** Emails fail with SSL/TLS handshake errors or connection timeouts depending on the SMTP provider.

**Root Cause:** The email service used a single connection strategy that didn't account for different SMTP providers' TLS requirements.

**Fix (Commit `d809426`):**
- **Gmail**: Uses STARTTLS on port 587 (not SSL). Set `EMAIL_USE_SSL=false`
- **Office 365**: Uses STARTTLS on port 587. Set `EMAIL_USE_SSL=false`
- **Self-hosted (SSL)**: Uses SSL on port 465. Set `EMAIL_USE_SSL=true`
- **Self-hosted (plain)**: Uses plain SMTP on port 25. Set `EMAIL_USE_SSL=false`

New `EMAIL_USE_SSL` environment variable added to `.env.example` and `.env.example.full`.

---

## Scheduled Email Pipeline Bugs (2026-03-13–14)

### Problem: Scheduled emails not being delivered

**Symptoms:** Emails configured in pipeline stages are not sent. Scheduled emails stay in `PENDING` status indefinitely.

**Root Cause:** Multiple cascading issues:

1. **Stale Redis claim** — Background email loop gave up permanently when finding a stale Redis claim from a crashed worker, instead of waiting for TTL expiry and reclaiming
2. **Missing org context** — Email template rendering failed because organization data (name, settings, logo) was not loaded before sending
3. **Route ordering** — `GET /api/v1/email-templates/{template_id}` was matching before `GET /api/v1/email-templates/scheduled`, treating "scheduled" as a template ID
4. **UTC future check** — Server rejected emails scheduled in the user's local timezone because it compared against UTC
5. **UTC time display** — Scheduled email times showed raw UTC instead of local timezone
6. **Date picker min** — Date picker used UTC date for minimum constraint, rejecting valid local dates

**Fixes:**
- `7810f32`: Redis claim recovery instead of permanent give-up
- `49defff`: Redis key cleanup on application shutdown
- `a76148d`: Polling interval reduced from 5 minutes to 60 seconds
- `b4f86e3`: Load org context before email template rendering
- `f1cce9e`: Route ordering fixed — `/scheduled` before `/{template_id}`
- `8eaf002`: Removed server-side UTC-based future check on `scheduled_at`
- `e7b5a3d`: Display scheduled times in user's local timezone
- `e4c6e5c`: Date picker uses local date for min constraint
- `4dc7ad2`: Message history cleanup, date filtering, email validation

---

## Automated Email Not Sending on Pipeline Advance (2026-03-14)

### Problem: Prospect advances to automated_email stage but no email is sent

**Root Cause:** The `advance_prospect()` method was not triggering the automated email logic when the target stage type was `AUTOMATED_EMAIL`.

**Fix (Commit `cbaec8b`):** Added email trigger in `advance_prospect()` — when the target stage is `automated_email`, the service now builds and sends the configured email using the stage's email configuration (subject, welcome message, FAQ link, custom sections, etc.).

---

## IntegrityError on Prospect Activity Log (2026-03-13)

### Problem: `IntegrityError` when system performs automated pipeline actions

**Symptoms:** Background operations (e.g., auto-advance after form submission) fail with `IntegrityError: foreign key constraint fails` on the `prospect_activity_log` table.

**Root Cause:** The `performed_by` column has a foreign key to the `users` table. Automated actions were setting `performed_by = 'system'`, which is not a valid user ID.

**Fix (Commit `addbbb0`):** Changed automated actions to use `performed_by = None` instead of `'system'`. The column is `nullable=True`, so `None` is valid.

---

## Custom Section Add/Edit in Pipeline Email Config (2026-03-13)

### Problem: Custom sections in pipeline email stage config not persisting

**Symptoms:** Adding or editing custom sections (title + content blocks) in the automated email stage configuration does not save correctly. Sections disappear on reload.

**Fix (Commit `49ba979`):** Fixed state management in the StageConfigModal for custom section CRUD operations. Sections now persist correctly.

---

## Email Config Not Persisting from Onboarding (2026-03-13)

### Problem: SMTP settings configured during onboarding don't carry over

**Symptoms:** Email works during onboarding but stops working after setup is complete. Organization settings show no SMTP configuration.

**Root Cause:** The onboarding flow configured email in a temporary context but did not persist the SMTP settings to the organization's settings record.

**Fix (Commit `b64cde7`):** Onboarding email configuration step now writes SMTP settings to the organization's persistent settings.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Database Issues](Troubleshooting-Database)
