# Insider Threat Analysis Report

**Application:** The Logbook
**Date:** 2026-02-24
**Scope:** Full-stack insider threat assessment (FastAPI backend, React frontend, MySQL database, Redis cache, Docker infrastructure)
**Threat Model:** Authenticated insider with varying privilege levels attempting to access unauthorized data, escalate privileges, or exfiltrate information

---

## Executive Summary

The Logbook demonstrates a strong security posture overall with proper authentication, role-based access control, organization isolation, and comprehensive audit logging. However, the analysis identified **14 findings** across varying severity levels that an insider could exploit. The most critical findings involve JWT tokens stored in localStorage (XSS-accessible), a WebSocket endpoint that skips session validation, and several endpoints with missing or insufficient permission checks that allow information leakage.

---

## Findings

### FINDING 1 — JWT Tokens Stored in localStorage (HIGH)

**File:** `frontend/src/stores/authStore.ts:43-44`, `frontend/src/services/api.ts:123,171-172`

**Description:** While the backend correctly sets httpOnly cookies for authentication, the login/register endpoints also return tokens in the JSON response body, and the frontend stores them in `localStorage`:

```typescript
// authStore.ts:43-44
localStorage.setItem('access_token', response.access_token);
localStorage.setItem('refresh_token', response.refresh_token);
```

The API interceptor reads from localStorage for the `Authorization` header:
```typescript
// api.ts:123
const token = localStorage.getItem('access_token');
```

**Insider Attack:** Any XSS vulnerability (even a reflected one injected by an insider via crafted content in forms, documents, or event descriptions) can steal both access and refresh tokens via `document.cookie` being blocked (httpOnly) but `localStorage.getItem('access_token')` succeeding. An insider with `documents.manage` permission could upload an HTML file or inject script through user-controlled fields.

**Fix:**
1. Stop returning tokens in the JSON response body — rely solely on httpOnly cookies for authentication.
2. Remove all `localStorage.setItem/getItem` calls for tokens from the frontend.
3. Let the browser automatically send httpOnly cookies with API requests (already configured with `withCredentials`).
4. If Bearer header auth must be kept for non-browser clients (mobile apps), use a separate API key mechanism rather than exposing JWT tokens to JavaScript.

---

### FINDING 2 — WebSocket Endpoint Skips Session Validation (HIGH)

**File:** `backend/app/api/v1/endpoints/inventory.py:2222-2264`

**Description:** The WebSocket endpoint validates the JWT token's signature and extracts `org_id`, but it does **not** verify that a valid session exists in the database:

```python
payload = decode_token(token)
org_id = payload.get("org_id")
# ... connects immediately without session check
await ws_manager.connect(websocket, org_id)
```

**Insider Attack:** A user who has been logged out, deactivated, or had their sessions revoked (e.g., after termination) can still connect to the WebSocket if they saved their JWT token before logout. The token remains cryptographically valid until it expires (30 minutes). They would receive real-time inventory change notifications for their organization, which may contain sensitive operational data.

**Fix:**
```python
# After decode_token, add session validation:
from app.services.auth_service import AuthService
auth_service = AuthService(db)
user = await auth_service.get_user_from_token(token)
if not user:
    await websocket.close(code=4001, reason="Invalid or revoked session")
    return
```

---

### FINDING 3 — User List Endpoint Has No Permission Check (MEDIUM)

**File:** `backend/app/api/v1/endpoints/users.py:44-89`

**Description:** The `GET /api/v1/users` endpoint only requires `get_current_user` (basic authentication), not any specific permission like `users.view`:

```python
@router.get("", response_model=List[UserListResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),  # No permission check
):
```

Meanwhile, `GET /api/v1/users/with-roles` correctly requires `users.view` or `members.manage`.

**Insider Attack:** Any authenticated user — even a brand-new member with zero permissions — can enumerate all members in the organization, including their usernames, names, membership numbers, ranks, stations, hire dates, and status. If contact info visibility is enabled in org settings, they also get email, phone, and mobile numbers.

**Fix:**
```python
current_user: User = Depends(require_permission("users.view", "members.manage")),
```

---

### FINDING 4 — User Role Query Has No Permission Check (MEDIUM)

**File:** `backend/app/api/v1/endpoints/users.py:371-402`

**Description:** The `GET /api/v1/users/{user_id}/roles` endpoint only requires basic authentication:

```python
@router.get("/{user_id}/roles", response_model=UserRoleResponse)
async def get_user_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),  # No permission check
):
```

**Insider Attack:** Any authenticated member can query the roles and permissions of any other member in the organization. This reveals the complete authorization structure — which users are admins, who has `members.manage`, who has `elections.manage`, etc. This is reconnaissance gold for planning further attacks.

**Fix:**
```python
current_user: User = Depends(require_permission("users.view", "members.manage")),
```

---

### FINDING 5 — User Profile View Has No Permission Check (MEDIUM)

**File:** `backend/app/api/v1/endpoints/users.py:664-706`

**Description:** The `GET /api/v1/users/{user_id}/with-roles` endpoint only requires `get_current_user`:

```python
@router.get("/{user_id}/with-roles", response_model=UserProfileResponse)
async def get_user_with_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),  # No permission check
):
```

This returns a `UserProfileResponse` which likely includes address, emergency contacts, date of birth, personal email, and other sensitive PII fields — significantly more data than the list endpoint.

**Insider Attack:** Any authenticated user can view the full profile of any other member, including home address, emergency contacts, date of birth, and personal email. This is a significant privacy violation and potential HIPAA concern.

**Fix:** Either require `users.view` permission, or filter the response fields to only include non-sensitive data when the requester is not an admin and is not viewing their own profile.

---

### FINDING 6 — Error Log Injection for Data Storage Abuse (MEDIUM)

**File:** `backend/app/api/v1/endpoints/error_logs.py:20-39`

**Description:** The `POST /api/v1/errors/log` endpoint accepts arbitrary JSON in the `context` field with only basic authentication:

```python
@router.post("/log")
async def log_error(
    data: dict,  # Completely unvalidated dict
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    error = ErrorLog(
        ...
        context=data.get("context", {}),  # Arbitrary JSON stored
        ...
    )
```

**Insider Attack:**
1. **Data exfiltration channel:** An insider could use this endpoint to covertly store stolen data (e.g., member records, documents) in the error log context field, then have an accomplice with `audit.view` permission retrieve it.
2. **Storage exhaustion:** No size limit on the `context` field — an insider could flood the error log table with large payloads.
3. **Log poisoning:** Inject misleading error records that could confuse incident response or frame other users (the `user_id` is auto-set, but the `error_type` and `error_message` are attacker-controlled).

**Fix:**
1. Add a Pydantic schema with field validation instead of accepting raw `dict`.
2. Limit `context` field size (e.g., max 4KB).
3. Rate-limit the endpoint per user.
4. Consider requiring a permission like `errors.report`.

---

### FINDING 7 — Authentication Query Does Not Filter by Organization (MEDIUM)

**File:** `backend/app/services/auth_service.py:89-97`

**Description:** The `authenticate_user` method searches for users by username or email across **all organizations** (no `organization_id` filter):

```python
result = await self.db.execute(
    select(User)
    .where(
        (User.username == username) | (User.email == username)
    )
    .where(User.deleted_at.is_(None))
    .options(selectinload(User.roles))
)
```

**Insider Attack:** While this is described as a "single-org system," the database schema supports multiple organizations. If a second organization is ever created (even accidentally via the onboarding endpoint), a user in Org A could authenticate as a user in Org B if they share the same username. The returned JWT would contain `org_id` from Org B, granting cross-organization access.

**Fix:**
Since this is a single-org system, add organization_id filtering to the login query, or verify at the endpoint level that the authenticated user belongs to the expected organization. At minimum, if `scalar_one_or_none` returns a result, verify it matches the expected org.

---

### FINDING 8 — CSRF Token Not Validated on State-Changing Endpoints (MEDIUM)

**File:** `backend/app/core/security_middleware.py:348-359`, `backend/app/api/v1/endpoints/auth.py:62-71`

**Description:** The CSRF protection system generates a `csrf_token` cookie and has a `verify_csrf_token` dependency, but a search of the route definitions shows that `verify_csrf_token` is **not actually used as a dependency on any state-changing endpoint**. The SameSite=Strict cookie is the primary defense, but the double-submit token is generated and never validated.

**Insider Attack:** While SameSite=Strict provides strong CSRF protection in modern browsers, this is a defense-in-depth failure. An insider who discovers a browser bug or subdomain takeover could bypass SameSite restrictions. The CSRF token infrastructure exists but is dead code.

**Fix:** Either:
1. Add `Depends(verify_csrf_token)` to all POST/PATCH/PUT/DELETE endpoints, or
2. Add it as global middleware for state-changing HTTP methods, or
3. Remove the dead CSRF token generation code to avoid a false sense of security.

---

### FINDING 9 — Onboarding Endpoint Accessible After Setup (LOW-MEDIUM)

**File:** `backend/app/api/v1/onboarding.py:352-403`

**Description:** The onboarding session creation (`get_or_create_session`) does not check whether onboarding has already been completed. While individual steps check `needs_onboarding()`, the session creation itself is unauthenticated and allows anyone to create onboarding sessions.

Several onboarding endpoints do check `needs_onboarding()`, but the `/onboarding/start-session` and `/onboarding/status` endpoints are fully unauthenticated. If the `needs_onboarding` check has a race condition or logic error, the organization setup could be overwritten.

**Insider Attack:** An insider who knows the API structure could attempt to race a system restart or DB reset to re-trigger onboarding and create a new admin account.

**Fix:** Add an early-exit guard at the router level that returns 403 if an organization already exists, before allowing session creation.

---

### FINDING 10 — Tokens Returned in Login/Register Response Body (LOW-MEDIUM)

**File:** `backend/app/api/v1/endpoints/auth.py:215-224, 269-278`

**Description:** Both login and register endpoints return tokens in the response body AND set httpOnly cookies:

```python
body = TokenResponse(
    access_token=access_token,
    refresh_token=refresh_token,
    ...
).model_dump()
response = JSONResponse(content=body)
_set_auth_cookies(response, access_token, refresh_token)
```

**Insider Attack:** The response body tokens can be:
1. Logged by proxy servers, WAFs, or API gateways in the response body
2. Cached by CDNs or browser caches
3. Captured by browser extensions
4. Visible in browser DevTools Network tab and potentially stored in browser history for debugging
5. Combined with Finding 1 to persist tokens in localStorage

**Fix:** Return only a success indicator in the response body. Let the httpOnly cookies handle token transport:
```python
body = {"status": "authenticated", "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60}
```

---

### FINDING 11 — Default Credentials in Docker Compose (LOW)

**File:** `docker-compose.yml:10-11, 58, 110-112`

**Description:** Default passwords are set in docker-compose.yml:
```yaml
MYSQL_PASSWORD: ${DB_PASSWORD:-change_me_in_production}
MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-change_me_in_production}
REDIS_PASSWORD: ${REDIS_PASSWORD:-change_me_in_production}
SECRET_KEY: ${SECRET_KEY:-change_me_in_production}
ENCRYPTION_KEY: ${ENCRYPTION_KEY:-change_me_in_production}
```

While the config.py `validate_security_config()` detects these, it only logs warnings — it doesn't actually block startup in development mode.

**Insider Attack:** An insider with access to the Docker host can connect directly to MySQL/Redis using default credentials. The `SECRET_KEY` default would allow JWT forgery.

**Fix:** The application does have `SECURITY_BLOCK_INSECURE_DEFAULTS` but it appears to only warn. In production mode, enforce startup failure when insecure defaults are detected. Consider removing default values entirely from docker-compose.yml and requiring an `.env` file.

---

### FINDING 12 — MinIO Default Credentials Exposed (LOW)

**File:** `docker-compose.yml:219`

**Description:**
```yaml
MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
```

MinIO ports (9000, 9001) are exposed to the host, unlike MySQL and Redis which have their ports commented out.

**Insider Attack:** If the `with-s3` profile is active, anyone on the local network can access the MinIO console with `minioadmin/minioadmin` and read/modify all stored files.

**Fix:** Comment out the MinIO port mappings by default (matching the pattern used for MySQL and Redis), and remove the hardcoded default credentials.

---

### FINDING 13 — Election Voting Token in URL Query Parameter (LOW)

**File:** `backend/app/api/v1/endpoints/elections.py:261-267`

**Description:** Voting tokens are passed as query parameters:
```python
@router.post("/ballot/vote", ...)
async def cast_vote_with_token(
    vote_data: VoteCreate,
    token: str,  # Query parameter
    ...
):
```

**Insider Attack:** Query parameters are logged in server access logs, proxy logs, browser history, and referer headers. An insider with access to server logs could extract voting tokens and cast votes on behalf of other members, compromising election integrity.

**Fix:** Accept the token in the request body or as a custom header instead of a query parameter.

---

### FINDING 14 — Document File Extension Not Sanitized (LOW)

**File:** `backend/app/api/v1/endpoints/documents.py:234-236`

**Description:**
```python
ext = os.path.splitext(file.filename or "")[1]
unique_name = f"{uuid_lib.uuid4().hex}{ext}"
file_path = os.path.join(org_dir, unique_name)
```

While the MIME type is validated via magic bytes, the original file extension is preserved. An insider could upload a file with a double extension (e.g., `report.pdf.exe`) and while the MIME check would catch truly wrong content, certain edge cases with polyglot files could slip through.

**Fix:** Derive the extension from the detected MIME type rather than the user-supplied filename:
```python
MIME_TO_EXT = {"application/pdf": ".pdf", "image/jpeg": ".jpg", ...}
ext = MIME_TO_EXT.get(detected_mime, "")
```

---

## Positive Security Controls Observed

The following security measures are well-implemented and represent strong insider threat defenses:

1. **Organization Isolation:** All database queries filter by `organization_id`, preventing cross-org data access.
2. **Role-Based Access Control:** Comprehensive permission system with per-endpoint checks on most sensitive operations.
3. **Mass Assignment Protection:** The user profile update endpoint uses an explicit `ALLOWED_PROFILE_FIELDS` allowlist (`users.py:888-892`), preventing an insider from setting fields like `is_active`, `password_hash`, or `organization_id`.
4. **Audit Logging:** Comprehensive `log_audit_event()` calls on all administrative actions with user attribution.
5. **Password Security:** Argon2id with strong parameters, HIPAA-compliant password policy (history, age, complexity).
6. **Token Rotation:** Refresh token rotation with replay detection that revokes all sessions on suspicious reuse.
7. **Session Validation:** Access tokens are validated against the sessions table, so logout/revocation is effective (except for WebSocket — see Finding 2).
8. **Account Lockout:** 5 failed attempts triggers a 30-minute lockout.
9. **Rate Limiting:** Applied to authentication endpoints, public forms, and public portal.
10. **Image Upload Security:** Multi-layer validation (magic bytes, Pillow verification, metadata stripping, decompression bomb detection).
11. **Election Integrity:** Database-level unique constraints prevent double-voting even under race conditions, plus vote signing for tampering detection.
12. **Self-Registration Disabled by Default:** New accounts must be created by admins.
13. **Soft Delete:** Users are soft-deleted (`deleted_at`) and filtered from queries, preventing accidental data loss while maintaining audit trails.
14. **Anti-Enumeration:** Registration uses generic error messages to prevent username/email enumeration.

---

## Severity Summary

| Severity | Count | Findings |
|----------|-------|----------|
| HIGH     | 2     | #1 (localStorage tokens), #2 (WebSocket session bypass) |
| MEDIUM   | 6     | #3 (user list no perms), #4 (role query no perms), #5 (profile no perms), #6 (error log injection), #7 (cross-org auth), #8 (CSRF dead code) |
| LOW-MED  | 2     | #9 (onboarding re-access), #10 (tokens in response body) |
| LOW      | 4     | #11 (default creds), #12 (MinIO creds), #13 (voting token in URL), #14 (file extension) |

---

## Recommended Prioritization

1. **Immediate:** Fix Finding 2 (WebSocket session validation) — active exploit path for revoked users.
2. **Immediate:** Fix Findings 3, 4, 5 (missing permission checks) — any authenticated user can enumerate all members and their roles/PII.
3. **Short-term:** Address Finding 1 and 10 (stop exposing tokens to JavaScript) — requires frontend refactor.
4. **Short-term:** Fix Finding 6 (validate error log input) and Finding 7 (org-scoped authentication).
5. **Medium-term:** Address Findings 8, 9, 11, 12, 13, 14 — defense-in-depth improvements.
