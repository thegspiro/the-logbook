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

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Database Issues](Troubleshooting-Database)
