# Authentication

The Logbook supports multiple authentication methods to integrate with your organization's identity infrastructure.

---

## Local Authentication (Default)

Username and password authentication with Argon2id password hashing.

### How It Works

1. User submits username and password
2. Backend verifies password against Argon2id hash
3. On success, issues JWT access token (8-hour lifetime) and refresh token (7-day lifetime)
4. Tokens are set as **httpOnly cookies** (not stored in localStorage) for all API requests
5. Refresh token used to obtain new access tokens without re-authentication
6. CSRF protection is enforced globally via middleware on all state-changing requests

> **Security Note (2026-02-24):** JWT tokens were previously stored in `localStorage` and sent via `Authorization: Bearer` headers. This has been changed to httpOnly cookies to prevent XSS-based token theft. If you have custom integrations using Bearer tokens, update them to use cookie-based authentication.

> **Auth Flow Update (2026-03-06):** The login response now includes user data directly (eliminating a separate `GET /auth/me` call), and a temporary Bearer token bridge stores the access token in memory for 30 minutes as a fallback for environments where httpOnly cookies are not immediately available (e.g., due to nginx proxy buffering). The backend's `get_current_user` accepts both cookie-based and Bearer token authentication. Security middleware (SecurityHeaders, IPLogging) was converted from Starlette `BaseHTTPMiddleware` to pure ASGI to prevent Set-Cookie header stripping.

### Password Requirements

- Minimum 12 characters
- At least one uppercase, one lowercase, one number, one special character
- Cannot reuse last 12 passwords
- Must change every 90 days
- Account locks after 5 failed attempts (30-minute lockout)

---

## OAuth

Connect external identity providers for single sign-on. *(2026-05-29)* "Sign in
with Google" and "Sign in with Microsoft" (Azure AD, single-tenant) are
implemented via the OpenID Connect authorization-code flow in
`services/oauth_service.py`.

### How It Works

1. The login page calls `GET /api/v1/auth/oauth-config` to discover which
   providers are enabled, then the user clicks "Sign in with Google" or
   "Sign in with Microsoft"
2. `GET /api/v1/auth/oauth/{provider}` builds the provider consent URL and sets
   a short-lived, httpOnly `oauth_state` cookie (CSRF protection — compared
   against the `state` query param on callback). Returns `404` if the provider
   is not configured
3. The provider redirects back to `GET /api/v1/auth/oauth/{provider}/callback`,
   which exchanges the code and **cryptographically verifies the ID token**:
   - **Google** — verified via `google.oauth2.id_token` with the configured
     `GOOGLE_CLIENT_ID` as audience; issuer must be `accounts.google.com`
   - **Microsoft** — verified RS256 against the tenant JWKS, with
     `audience=AZURE_AD_CLIENT_ID`, issuer `{authority}/v2.0`, and the token's
     `tid` claim required to equal `AZURE_AD_TENANT_ID` (single-tenant lock —
     only accounts in the configured directory can sign in)
4. **Link-existing-only policy:** OAuth never auto-creates an account. The
   verified IdP email must match an existing, **active** local user in the
   organization. On first use the provider/subject is bound to that user
   (`users.oauth_provider`, `users.oauth_subject`); later logins reject a
   subject or provider mismatch (identity-takeover guard)
5. On success the backend issues the normal session cookies, logs an
   `oauth_login` audit event (category `authentication`), and redirects to the
   SPA landing page `/auth/callback` (`OAUTH_SUCCESS_REDIRECT`). On failure it
   redirects to `OAUTH_FAILURE_REDIRECT` (default `/login`) with an `error=`
   query param

### Supported Providers

- **Google Workspace** — "Sign in with Google" (OpenID Connect)
- **Microsoft 365 / Azure AD** — "Sign in with Microsoft" (single-tenant)

### Domain Restriction

Set `GOOGLE_ALLOWED_DOMAINS` / `AZURE_AD_ALLOWED_DOMAINS` (comma-separated) to
restrict which email domains may sign in. Empty (default) means no domain
restriction. Enforced server-side after token verification; when exactly one
Google domain is configured, the consent screen is hinted via the `hd`
parameter (the allowlist is still re-validated on the server).

### Configuration

Set the relevant variables in `.env` (see
[Environment Variables](Configuration-Environment#oauth-sign-in)):

```bash
# Google
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/v1/auth/oauth/google/callback
GOOGLE_ALLOWED_DOMAINS=yourdept.org

# Microsoft (Azure AD, single-tenant)
AZURE_AD_ENABLED=true
AZURE_AD_TENANT_ID=your-tenant-guid
AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_REDIRECT_URI=https://your-domain.com/api/v1/auth/oauth/microsoft/callback
AZURE_AD_ALLOWED_DOMAINS=yourdept.org
```

### Callback Error Codes *(2026-05-29)*

The callback redirects to `OAUTH_FAILURE_REDIRECT?error=<code>` for these
recoverable failures:

| Code | Meaning |
|------|---------|
| `access_denied` | The provider returned an error (e.g. user cancelled consent) |
| `invalid_state` | Missing/mismatched `state` vs. the `oauth_state` cookie (CSRF guard) |
| `token_exchange_failed` | Authorization-code exchange with the provider failed |
| `missing_id_token` | Provider response contained no ID token |
| `invalid_id_token` | ID token failed cryptographic verification (signature/audience/expiry) |
| `invalid_issuer` | ID token issuer is not the expected provider |
| `invalid_tenant` | Microsoft `tid` claim does not match `AZURE_AD_TENANT_ID` |
| `unverified_email` | IdP did not mark the email as verified |
| `no_email` | No email present in the verified claims |
| `domain_not_allowed` | Email domain not in the configured allowlist |
| `no_account` | No matching active local user for the verified email |
| `inactive` | Matched local user is not active |
| `account_conflict` | Email already bound to a different IdP subject/provider |

---

## SAML (Enterprise SSO)

SAML 2.0 integration for enterprise Single Sign-On.

### Configuration

1. Navigate to **Settings > Authentication > SAML**
2. Upload your Identity Provider (IdP) metadata XML
3. Configure attribute mapping (email, first name, last name)
4. Test the SAML flow

---

## LDAP / Active Directory

Authenticate against your organization's LDAP or Active Directory server.

### Configuration

```bash
LDAP_ENABLED=true
LDAP_SERVER_URL=ldap://your-ad-server:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=your-bind-password
LDAP_SEARCH_BASE=ou=users,dc=example,dc=com
LDAP_USER_FILTER=(sAMAccountName={username})
```

---

## Multi-Factor Authentication (MFA) *(2026-06-19)*

App-based **TOTP** two-factor authentication using apps like Google
Authenticator, Authy, or 1Password. MFA is self-enrolled by default and can be
required org-wide by an administrator. See [MFA](../docs/MFA.md) for full
implementation detail.

### Enrolling (per-user, opt-in)

1. Navigate to **Settings → Security**
2. Start **Two-Factor Authentication** setup
3. Scan the QR code with your authenticator app
4. Enter the 6-digit code to confirm and enable MFA
5. **Save the recovery codes** — they are shown exactly once

### Login Challenge

When an account has MFA enabled, the password step (`POST /auth/login`) does
**not** issue a session. It returns `{ mfa_required: true, mfa_token }`, and the
client completes `POST /auth/mfa/login` with that token plus either a 6-digit
TOTP code or a single-use recovery code before session cookies are issued. TOTP
verification tolerates ±30 s of clock drift.

### Admin-enforced (org-wide)

1. Navigate to **Settings → Authentication**
2. Toggle **Require two-factor authentication**
3. Members who have not enrolled are forced into MFA setup before they can use
   the rest of the app (enforced server-side in `get_current_user`); the
   requirement is stored at `org.settings["security"]["mfa_required"]`

Recovery codes are single-use and stored hashed; the MFA secret is encrypted at
rest. A member who loses their authenticator and exhausts their recovery codes
can have MFA reset by an administrator (Members admin → **Reset MFA**, or
`POST /users/{user_id}/reset-mfa`), then re-enroll from Settings → Security.

---

## Session Management

| Feature | Details |
|---------|---------|
| Access token lifetime | 8 hours (configurable) |
| Refresh token lifetime | 7 days (configurable) |
| Inactivity timeout | 30 minutes (no mouse/keyboard/touch) |
| Concurrent sessions | 3 per user (configurable) |
| Session IP monitoring | Alerts on IP change during session |

---

## API Endpoints

```
POST   /api/v1/auth/login                   # Username/password login
POST   /api/v1/auth/refresh                  # Refresh access token
POST   /api/v1/auth/logout                   # Invalidate session
POST   /api/v1/auth/forgot-password          # Request password reset
POST   /api/v1/auth/reset-password           # Reset password with token
POST   /api/v1/auth/mfa/setup                # Begin MFA enrollment (secret + QR URI)
POST   /api/v1/auth/mfa/verify-setup         # Confirm code, enable MFA, return recovery codes
POST   /api/v1/auth/mfa/login                # Complete login second factor
POST   /api/v1/auth/mfa/disable              # Disable MFA (verifies a code)
GET    /api/v1/auth/mfa/status               # Enrollment status + recovery codes remaining
GET    /api/v1/auth/mfa/policy               # Read org-wide MFA requirement (admin)
PUT    /api/v1/auth/mfa/policy               # Set org-wide MFA requirement (admin)
POST   /api/v1/users/{user_id}/reset-mfa     # Admin: reset a member's MFA (lost device)
GET    /api/v1/auth/oauth-config             # Which OAuth providers are enabled (for login page)
GET    /api/v1/auth/oauth/google             # Initiate Google sign-in (404 if not configured)
GET    /api/v1/auth/oauth/google/callback    # Google OAuth callback
GET    /api/v1/auth/oauth/microsoft          # Initiate Microsoft sign-in (404 if not configured)
GET    /api/v1/auth/oauth/microsoft/callback # Microsoft OAuth callback
```

---

**See also:** [Security Overview](Security-Overview) | [Security Configuration](Configuration-Security) | [Encryption](Security-Encryption)
