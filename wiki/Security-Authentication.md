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
- **Minimum password age of 1 day** (prevents rapidly cycling through the history to return to an old password)
- Account locks after 5 failed attempts (30-minute lockout)

> **Forced-change exemption (2026-06-25):** When an account is flagged
> `must_change_password` — a new admin-created user, a self-registration, or an
> admin password reset with *force change* — the user must change their password
> on first login. That mandatory change is **exempt from the 1-day minimum
> password age**, because the temporary password was just issued (its
> `password_changed_at` is fresh) and would otherwise block the very change
> being demanded. The exemption applies only while `must_change_password` is set;
> once cleared, the minimum-age rule resumes for ordinary voluntary changes.

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
6. **MFA is enforced on the OAuth path too** *(2026-08-12)*. If the matched
   account has TOTP enabled, step 5 does **not** happen: no session cookies are
   issued and no session row is created. The callback instead redirects to
   `/auth/callback#mfa_token=<jwt>` — a 5-minute `mfa_pending` token carried in
   the **URL fragment**, which browsers never send to a server. The SPA strips
   the fragment from history immediately (`history.replaceState`), stores the
   challenge in the auth store, and routes to `/login`, where the standard
   two-factor form completes `POST /auth/mfa/login`. Previously OAuth verified
   only the primary credential, so a compromised Google/Microsoft account
   bypassed the app's second factor entirely. Audit event:
   `oauth_mfa_challenge` (category `authentication`)

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

## SAML and LDAP — Not Implemented *(clarified 2026-07-31)*

Earlier revisions of this page described SAML 2.0 and LDAP/Active Directory
sign-in with configuration steps. **Neither is implemented.** The
`pysaml2` and `python-ldap` dependencies were declared but never imported by
any application code, and were removed on 2026-07-31 to shrink the
vulnerability surface. The `LDAP_*` settings still present in
`.env.example.full` are inert placeholders that gate nothing.

Federated sign-in today means **OAuth 2.0 / OIDC via Google Workspace or
Microsoft Azure AD** (documented above). If your department needs SAML or
LDAP, please open an issue — the placeholders exist because it is a plausible
future addition, not because it half-works today.

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

**Privilege ceiling on admin resets** *(2026-08-12)*: the admin
password-reset and MFA-reset endpoints now refuse to touch an account whose
effective permissions exceed the caller's own. A `members.manage` holder can
no longer reset the password or strip the second factor of a `security.manage`
admin and log in as them — the classic reset-to-escalate path. Every
permission the target holds must be within the caller's set (wildcards
honored, so `*` clears anyone); a violation returns 403
("You cannot reset the account of a user with privileges beyond your own")
and files a privilege-escalation report. Equal-privilege peers remain
resettable, and both endpoints stay rate-limited and org-scoped.

---

## Public Portal API Keys

Read-only public-portal endpoints (`/api/public/portal/*`) authenticate with an
API key sent in the `X-API-Key` header (not the session cookie / JWT used for
the app):

- **IP rate limit before bcrypt.** Key verification uses bcrypt (deliberately
  slow); the per-IP rate limit now runs *before* the database lookup and bcrypt
  step, so an unauthenticated flood of well-formed keys can't burn CPU.
- **Selective lookup prefix.** Keys are `logbook_<random>`; the stored lookup
  prefix is the first 16 chars (`logbook_` + 8 key chars), so a lookup returns a
  single candidate to verify instead of every key in the system. Keys issued
  before this change stored only the constant `logbook_` prefix and **self-heal**
  to the selective prefix on their next successful use — no re-issue needed.
- Keys are hashed (bcrypt) at rest; only the short prefix is stored in plaintext,
  for identification.

---

## Session Management

| Feature | Details |
|---------|---------|
| Access token lifetime | 8 hours (configurable) |
| Refresh token lifetime | 7 days (configurable) |
| Inactivity timeout | 30 minutes (no mouse/keyboard/touch) |
| Concurrent sessions | 3 per user (configurable) |
| Session IP monitoring | Alerts on IP change during session |

### Refresh Rotation Is Strict — No Replay Grace *(2026-08-12)*

Refresh tokens rotate on every use, and a **used token is dead immediately**.
The former 30-second "rotation grace window" — which handed the session's
*current* token pair to anyone presenting the just-rotated previous token, to
tolerate multi-tab and app-boot races — is removed: it let a token thief take
over a session for 30 seconds after every legitimate refresh. Presenting any
stale refresh token is now treated as replay/theft and **revokes all of that
user's sessions** (logout everywhere). Concurrent refreshes from multiple tabs
that previously slid through the grace window will now trip this — an accepted
trade. The `REFRESH_ROTATION_GRACE_SECONDS` setting and the
`user_sessions.previous_refresh_token` column still exist but are no longer
consulted; the column is actively nulled on each rotation.

### Deactivated Organizations Cannot Log In *(2026-08-12)*

Password login now joins on the organization and requires
`organizations.active IS TRUE` — both when resolving the canonical org and in
the cross-org username fallback. Previously a member of a **deactivated**
organization could still authenticate. The rejection is indistinguishable from
a wrong password ("Incorrect username or password", with the usual dummy-hash
timing defense), so org status is not enumerable. Two boundaries to know:
the check runs at authentication time (existing sessions are not revoked when
an org is deactivated, and expire naturally), and the **OAuth path does not
yet perform an org-active check** — it rejects only inactive *users* (tracked
in KNOWN_LIMITATIONS).

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
