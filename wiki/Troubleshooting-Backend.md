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

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Database Issues](Troubleshooting-Database)
