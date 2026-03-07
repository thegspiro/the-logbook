# Security Audit Report

**Date:** 2026-03-07
**Scope:** Full-stack security review of The Logbook application
**Auditor:** Automated analysis via Claude Code

---

## Summary

25 security issues identified across backend, frontend, infrastructure, and configuration layers. Issues are categorized by severity (Critical, High, Medium, Low) and include file locations, descriptions, and recommended remediations.

---

## Critical Issues

### 1. Database Connection Not Encrypted by Default (MITM Risk)

**File:** `backend/app/core/config.py:42`
**Issue:** `DB_SSL: bool = False` — database connections use plaintext by default. The `DATABASE_URL` property (line 61) does not append any SSL parameters even when `DB_SSL` is `True`. All SQL traffic between the application and MySQL traverses the Docker network unencrypted, exposing credentials and PHI to network-level MITM attacks.
**Severity:** Critical
**Remediation:** When `DB_SSL=True`, append `?ssl=true&ssl_ca=/path/to/ca.pem` (or equivalent `connect_args` with SSL context) to the database URL. Enforce `DB_SSL=True` in production configuration validation.

### 2. Redis Connection Unencrypted (MITM Risk)

**File:** `backend/app/core/config.py:80-85`
**Issue:** The `REDIS_URL` property constructs `redis://` URLs (unencrypted) with no option for TLS (`rediss://`). Session data, rate-limiting state, and cached tokens traverse the network in cleartext. An attacker with network access can intercept or modify Redis traffic.
**Severity:** Critical
**Remediation:** Add a `REDIS_SSL: bool` setting. When enabled, use the `rediss://` scheme and configure TLS certificates for Redis connections.

### 3. Insecure Default Secrets Ship in Source Code

**File:** `backend/app/core/config.py:41,92,128`
**Issue:** Default values for `DB_PASSWORD` ("change_me_in_production"), `SECRET_KEY` ("INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION"), and `ENCRYPTION_KEY` ("INSECURE_DEFAULT_KEY_CHANGE_ME") are hardcoded in source. While `validate_security_config()` warns about these, it only **blocks startup** when `SECURITY_BLOCK_INSECURE_DEFAULTS` is True AND `ENVIRONMENT=production`. A staging or development deployment with default secrets would start without any blocking error, and if accidentally exposed, these values are publicly known from the source repository.
**Severity:** Critical
**Remediation:** Remove default values for all secret fields (use `...` or no default to force env-var-based configuration). Block startup in any non-development environment when insecure defaults are detected.

### 4. JWT Algorithm Confusion / Weak Algorithm

**File:** `backend/app/core/config.py:93`, `backend/app/core/security.py:484-528`
**Issue:** The JWT algorithm is configurable via `ALGORITHM: str = "HS256"`. The `decode_token()` function uses `algorithms=[settings.ALGORITHM]` which follows whatever is configured. If an attacker can influence this setting (e.g., through environment variable injection), they could force `"none"` or a weaker algorithm. Additionally, HS256 uses symmetric signing — the same `SECRET_KEY` used for signing is also needed for verification, meaning any service that can verify tokens can also forge them.
**Severity:** High
**Remediation:** Hardcode the algorithm list in `decode_token()` to only accept `["HS256"]` (or better, migrate to RS256 asymmetric signing). Add explicit validation that rejects `"none"` and other weak algorithms regardless of configuration.

---

## High Issues

### 5. Cookies Not Marked `Secure` Outside Production

**File:** `backend/app/api/v1/endpoints/auth.py:60-88`
**Issue:** `secure=is_production` means auth cookies (`access_token`, `refresh_token`, `csrf_token`) are sent over HTTP in non-production environments. Any staging or QA environment running over HTTP (or HTTPS with misconfigured proxy) will transmit authentication cookies in plaintext, enabling session hijacking via MITM.
**Severity:** High
**Remediation:** Default `secure=True` for all environments. Only relax to `secure=False` when explicitly running `localhost` development with a specific configuration flag (e.g., `COOKIE_SECURE_OVERRIDE=False`).

### 6. Frontend Nginx Exposes API Docs and OpenAPI Schema in Production

**File:** `frontend/nginx.conf:60-92`
**Issue:** The frontend nginx configuration proxies `/docs`, `/redoc`, and `/openapi.json` to the backend without restriction. Unlike the infrastructure nginx config (which blocks these with a 404), the frontend container — which is the default entry point in docker-compose — exposes the full API schema to unauthenticated users. This enables enumeration of all endpoints, request/response schemas, and permission requirements.
**Severity:** High
**Remediation:** Add deny rules for `/docs`, `/redoc`, and `/openapi.json` in `frontend/nginx.conf`, matching the approach in `infrastructure/nginx/nginx.conf:122-124`. Alternatively, disable docs at the backend level in non-development environments (`ENABLE_DOCS=False`).

### 7. Elasticsearch Default Password in Docker Compose

**File:** `docker-compose.yml:256`
**Issue:** `ELASTIC_PASSWORD=${ELASTIC_PASSWORD:-changeme}` — the Elasticsearch password defaults to the well-known "changeme" value. While on an internal Docker network, if the profile is activated, this provides unauthenticated-equivalent access to the search index which may contain indexed PHI.
**Severity:** High
**Remediation:** Remove the default value and require `ELASTIC_PASSWORD` to be set explicitly (use `${ELASTIC_PASSWORD:?ELASTIC_PASSWORD must be set}`), matching the pattern used for MySQL and Redis passwords.

### 8. MinIO Default Credentials in Docker Compose

**File:** `docker-compose.yml:285-286`
**Issue:** `MINIO_ROOT_USER:-minioadmin` and `MINIO_ROOT_PASSWORD:-minioadmin` — the S3-compatible storage uses default credentials. Any uploaded documents (which may contain PHI) stored in MinIO are accessible with these well-known credentials from within the Docker network.
**Severity:** High
**Remediation:** Remove default values and require explicit credential configuration (`${MINIO_ROOT_USER:?...}`).

### 9. Login Response Leaks Access and Refresh Tokens in JSON Body

**File:** `backend/app/api/v1/endpoints/auth.py:370-375`
**Issue:** The login endpoint returns both `access_token` and `refresh_token` in the JSON response body, in addition to setting them as httpOnly cookies. This contradicts the HIPAA-aligned architecture of cookie-only authentication. The tokens in the JSON body are accessible via JavaScript (`response.data.access_token`) and stored in the frontend's in-memory `tempAccessToken`/`tempRefreshToken` variables (`frontend/src/services/apiClient.ts:138-139`). If any XSS vulnerability exists, these tokens can be exfiltrated — negating the httpOnly cookie protection.
**Severity:** High
**Remediation:** Stop returning tokens in the response body. Use only httpOnly cookies for token transport. If a "bridge" mechanism is needed for the brief cookie-establishment window, use a shorter-lived, scoped token.

### 10. Token Refresh Response Also Leaks Tokens in Body

**File:** `backend/app/api/v1/endpoints/auth.py:436-444`
**Issue:** Same as issue #9 — the `/auth/refresh` endpoint returns `access_token` and `refresh_token` in the JSON body alongside setting cookies, providing an additional exfiltration vector.
**Severity:** High
**Remediation:** Return only a success indicator; rely on cookies for token storage.

---

## Medium Issues

### 11. HTTPS Not Enforced by Default

**File:** `backend/app/core/config.py:148`
**Issue:** `SECURITY_ENFORCE_HTTPS: bool = False` — HTTPS enforcement is off by default and only warned about (not blocked) in production validation. Without enforcement, the backend will accept HTTP connections, and cookies marked `secure=False` in non-production will transmit over plaintext.
**Severity:** Medium
**Remediation:** Default to `True` in production. Add middleware that redirects HTTP to HTTPS when enforcement is enabled, or reject non-HTTPS requests entirely.

### 12. Nginx Server Version Disclosure

**File:** `infrastructure/nginx/nginx.conf`, `frontend/nginx.conf`
**Issue:** Neither nginx configuration includes `server_tokens off;`. By default, nginx reveals its version in response headers (`Server: nginx/1.x.x`) and error pages. This helps attackers fingerprint the server and target known vulnerabilities for the specific version.
**Severity:** Medium
**Remediation:** Add `server_tokens off;` to the `http` block (or server blocks) in both nginx configurations.

### 13. Missing `Permissions-Policy` Header in Frontend Nginx

**File:** `frontend/nginx.conf`
**Issue:** The frontend nginx configuration lacks the `Permissions-Policy` header that the infrastructure nginx config includes (`geolocation=(), microphone=(), camera=()`). This means the frontend container serves responses without restricting browser feature access, potentially allowing embedded content to access device features.
**Severity:** Medium
**Remediation:** Add `add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;` to the frontend nginx configuration.

### 14. Missing HSTS Header in Frontend Nginx

**File:** `frontend/nginx.conf`
**Issue:** The frontend nginx configuration does not set `Strict-Transport-Security`. While the infrastructure nginx sets `max-age=31536000; includeSubDomains; preload`, the frontend container (which is the primary entry point) omits it entirely. Without HSTS, browsers will not enforce HTTPS on subsequent visits.
**Severity:** Medium
**Remediation:** Add `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;` to the frontend nginx configuration.

### 15. Module Axios Instances Missing Auth Configuration

**File:** `frontend/src/modules/scheduling/services/api.ts:184`
**Issue:** The scheduling module creates its own axios instance with manual `withCredentials` and CSRF configuration instead of using the shared `createApiClient()` factory. While this module happens to include the necessary config, it represents a maintenance risk — any drift from the global auth setup won't be caught. Additionally, the scheduling module includes a raw `axios` import alongside the custom instance, which could lead to unauthenticated requests if the wrong client is used.
**Severity:** Medium
**Remediation:** Migrate the scheduling module to use `createApiClient()` like other modules. Audit for any direct `axios` calls (not through the configured instance) that bypass auth interceptors.

### 16. Onboarding Module Stores CSRF Token in localStorage

**File:** `frontend/src/modules/onboarding/services/api-client.ts:78,92`
**Issue:** The onboarding module's `SecureApiClient` stores an obfuscated CSRF token in `localStorage`. While the obfuscation prevents casual inspection, `localStorage` is accessible to any JavaScript running on the same origin. If XSS is present, the obfuscation (which uses a key also stored in `sessionStorage` per `frontend/src/modules/onboarding/utils/security.ts:107`) provides no real protection.
**Severity:** Medium
**Remediation:** Store the CSRF token in a httpOnly cookie (set by the backend) rather than localStorage. If client-side storage is necessary, use a cookie with `SameSite=Strict` rather than localStorage.

### 17. Sensitive Data in sessionStorage During Onboarding

**File:** `frontend/src/modules/onboarding/utils/storage.ts`
**Issue:** The onboarding flow stores configuration data in `sessionStorage` including department names, email platform selections, auth platform choices, and file storage platform selections. While the module includes a `security-init.ts` that warns about sensitive data in sessionStorage, it only logs warnings and does not prevent the storage. Data in sessionStorage persists for the tab's lifetime and is accessible via JavaScript.
**Severity:** Medium
**Remediation:** Minimize what is stored client-side. Move sensitive configuration to server-side sessions only (the onboarding session mechanism already exists). Use the existing `security-init.ts` to actively clear — not just warn about — sensitive keys.

### 18. SQL Injection Risk in Migration Scripts

**File:** `backend/main.py:681`
**Issue:** `conn.execute(text(f"DROP TABLE IF EXISTS \`{safe_name}\`"))` — while the variable is named `safe_name`, it is constructed via string formatting into a raw SQL statement using `text()`. If the table name is derived from user input or configuration without proper validation, this could enable SQL injection. Similar patterns exist in `backend/scripts/verify_all_enums.py:51` and migration files.
**Severity:** Medium
**Remediation:** Validate `safe_name` against a strict allowlist of known table names. Use parameterized queries where possible, or at minimum validate that the name matches `^[a-z_]+$` before interpolation.

### 19. Health Endpoint Exposes Internal Service State

**File:** `backend/main.py` (health endpoint), `frontend/nginx.conf:76-83`
**Issue:** The health check endpoint returns detailed internal state including database connectivity status, Redis connectivity, configuration warnings, schema errors, migration progress, uptime, and environment name. This endpoint is proxied without authentication by both nginx configurations. The information disclosed helps an attacker enumerate the technology stack, identify connectivity issues, and time attacks during maintenance windows.
**Severity:** Medium
**Remediation:** Split into two endpoints: a minimal `/health` (returns only `200 OK` or `503`, used by load balancers) and a detailed `/health/details` that requires authentication and `admin` or `audit.view` permissions.

### 20. `DB_ECHO` Can Log Full SQL Queries Including Sensitive Data

**File:** `backend/app/core/config.py:45`
**Issue:** `DB_ECHO: bool = False` controls SQLAlchemy's SQL logging. When enabled (common during debugging), all SQL queries including those containing PII/PHI are logged to stdout/stderr. In containerized deployments, these logs are captured by Docker's logging driver and may be persisted to disk or forwarded to log aggregators without redaction.
**Severity:** Medium
**Remediation:** Add validation that prevents `DB_ECHO=True` when `ENVIRONMENT=production`. Add a warning when `DB_ECHO` is enabled in any environment. Consider a filtered SQL logger that redacts `WHERE` clause values.

---

## Low Issues

### 21. VOTE_SIGNING_KEY Falls Back to SECRET_KEY

**File:** `backend/app/core/config.py:125`
**Issue:** `VOTE_SIGNING_KEY: str = ""` with a comment stating it falls back to `SECRET_KEY`. This means vote integrity signatures use the same key as JWT signing. If `SECRET_KEY` is rotated for any reason (security incident, scheduled rotation), all existing vote signatures become unverifiable, potentially casting doubt on election integrity.
**Severity:** Low
**Remediation:** Require `VOTE_SIGNING_KEY` to be set when the elections module is enabled (`MODULE_ELECTIONS_ENABLED=True`). Add startup validation for this.

### 22. Rate Limiter Falls Back to In-Memory When Redis Unavailable

**File:** `backend/main.py:35-42`
**Issue:** The global rate limiter uses `memory://` as fallback when Redis password is not configured. In-memory rate limiting is per-process — with multiple uvicorn workers (line 104 uses `--workers 4`), each worker has independent rate limit counters. An attacker can effectively get 4x the rate limit by distributing requests across workers.
**Severity:** Low
**Remediation:** Require Redis for rate limiting in production. Log a security warning when falling back to in-memory storage in any environment. Consider sticky sessions or a shared backend for in-memory fallback.

### 23. Idle Timer Clears sessionStorage But Not API Cache on Timeout

**File:** `frontend/src/hooks/useIdleTimer.ts:47`
**Issue:** On session timeout, `sessionStorage.clear()` is called but the in-memory API cache (`utils/apiCache.ts`) may still hold cached responses containing non-PII but still organization-internal data. While `clearCache()` exists and is exported, it is not called during the idle timeout logout flow.
**Severity:** Low
**Remediation:** Call `clearCache()` from `apiCache.ts` in the `performLogout` function alongside `sessionStorage.clear()`.

### 24. Google DNS Resolver Hardcoded in Production Nginx

**File:** `infrastructure/nginx/nginx.conf:80`
**Issue:** `resolver 8.8.8.8 8.8.4.4 valid=300s;` — OCSP stapling resolver is hardcoded to Google's public DNS. In environments with strict network policies (air-gapped, government), this will fail silently, causing OCSP stapling to stop working. This also sends DNS queries to an external service, which may violate data residency requirements.
**Severity:** Low
**Remediation:** Make the resolver configurable or document that it should be changed for restricted environments. Consider using the system/container resolver by default.

### 25. Mailhog Exposes SMTP and Web UI Ports to Host

**File:** `docker-compose.yml:305-306`
**Issue:** The Mailhog development service exposes ports `1025` (SMTP) and `8025` (Web UI) directly to the host without authentication. While it's under a `development` profile, if the development profile is accidentally activated in a non-local environment, any test emails (which may contain password reset links with valid tokens, user PII, etc.) are viewable by anyone who can reach port 8025.
**Severity:** Low
**Remediation:** Bind Mailhog ports to `127.0.0.1` only (`"127.0.0.1:${MAILHOG_UI_PORT:-8025}:8025"`). Add a startup check that prevents the `development` profile from being activated when `ENVIRONMENT=production`.

---

## Summary Table

| # | Severity | Category | Issue |
|---|----------|----------|-------|
| 1 | Critical | MITM | Database connection unencrypted by default |
| 2 | Critical | MITM | Redis connection unencrypted |
| 3 | Critical | Secrets | Insecure default secrets in source code |
| 4 | High | Auth | JWT algorithm confusion / weak symmetric signing |
| 5 | High | MITM | Cookies not `Secure` outside production |
| 6 | High | Data Leak | Frontend nginx exposes API docs/schema |
| 7 | High | Secrets | Elasticsearch default password |
| 8 | High | Secrets | MinIO default credentials |
| 9 | High | Data Leak | Login response leaks tokens in JSON body |
| 10 | High | Data Leak | Refresh response leaks tokens in JSON body |
| 11 | Medium | MITM | HTTPS not enforced by default |
| 12 | Medium | Info Leak | Nginx server version disclosure |
| 13 | Medium | Headers | Missing Permissions-Policy in frontend nginx |
| 14 | Medium | Headers | Missing HSTS in frontend nginx |
| 15 | Medium | Auth | Module axios instance not using shared factory |
| 16 | Medium | Secrets | CSRF token stored in localStorage |
| 17 | Medium | Data Leak | Sensitive data in sessionStorage during onboarding |
| 18 | Medium | Injection | SQL injection risk in migration/startup scripts |
| 19 | Medium | Info Leak | Health endpoint exposes internal service state |
| 20 | Medium | Logging | DB_ECHO can log sensitive SQL queries |
| 21 | Low | Secrets | Vote signing key falls back to SECRET_KEY |
| 22 | Low | Auth | Rate limiter per-process bypass with workers |
| 23 | Low | Data Leak | API cache not cleared on idle timeout |
| 24 | Low | Config | Hardcoded Google DNS in nginx resolver |
| 25 | Low | Data Leak | Mailhog exposes ports to host network |
