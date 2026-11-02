# Authentication

The Logbook supports multiple authentication methods to integrate with your organization's identity infrastructure.

---

## Local Authentication (Default)

Username and password authentication with Argon2id password hashing.

### How It Works

1. User submits username and password
2. Backend verifies password against Argon2id hash
3. On success, issues a JWT access token (30 minutes by default, `ACCESS_TOKEN_EXPIRE_MINUTES`) and a refresh token (7 days, `REFRESH_TOKEN_EXPIRE_DAYS`); the login response also carries the user, so no separate `GET /auth/me` is needed
4. Tokens are set as **httpOnly cookies** — never stored in `localStorage` or readable by JavaScript, so an XSS bug cannot steal them
5. The refresh token obtains new access tokens without re-authentication
6. CSRF protection is enforced globally via middleware on all state-changing requests

The browser app never sends an `Authorization` header. `get_current_user`
also accepts `Authorization: Bearer <token>` for API and non-browser clients.
Security middleware is pure ASGI rather than Starlette's `BaseHTTPMiddleware`,
which can strip `Set-Cookie` headers when layers are stacked.

### Password Requirements

- Minimum 12 characters
- At least one uppercase, one lowercase, one number, one special character
- Cannot reuse last 12 passwords
- Must change every 90 days
- **Minimum password age of 1 day** (prevents rapidly cycling through the history to return to an old password)
- Account locks after 5 consecutive failed attempts (15-minute lockout — see
  [Account Lockout](#account-lockout-unlock-and-the-sign-in-audit-trail))
- **Optionally rejected if the password appears in a known breach corpus** —
  off by default (`BREACHED_PASSWORD_CHECK_ENABLED`), and only
  the first 5 characters of the SHA-1 hash are ever sent (k-anonymity). The
  lookup **fails open**: it is supplementary, and an outage must not block a
  password change while complexity, history, MFA and lockout all still apply.

> **Lockout responses are generic by default.** A message that distinguishes
> "locked" from "wrong password" confirms the account exists and tells an
> attacker their spray is landing. The lock is visible to administrators on
> the Members page and in the audit log (`account_locked`), not to the sign-in
> form, unless `ACCOUNT_LOCKOUT_REVEAL` is enabled.

> **Account lockout is per-user, so it does not cover password spraying.** One
> password tried against a thousand accounts never reaches five failures on any
> of them. The **suspicious-IP throttle** — failed attempts per IP across _all_
> accounts — is the control that covers that gap. See
> [Configuration → Security → Attack Protection](Configuration-Security#attack-protection-2026-08-16--08-17).

> **Forced-change exemption:** When an account is flagged
> `must_change_password` — a new admin-created user, a self-registration, or an
> admin password reset with _force change_ — the user must change their password
> on first login. That mandatory change is **exempt from the 1-day minimum
> password age**, because the temporary password was just issued (its
> `password_changed_at` is fresh) and would otherwise block the very change
> being demanded. The exemption applies only while `must_change_password` is set;
> once cleared, the minimum-age rule resumes for ordinary voluntary changes.

### Breached-Password Rejection (opt-in)

Complexity rules say nothing about whether a password has already leaked.
`Firetruck2024!` satisfies every rule above and appears in public breach
corpora — which is exactly what credential stuffing tries first. The built-in
common-password list covers a few dozen of the hundreds of millions that have
leaked.

When `BREACHED_PASSWORD_CHECK_ENABLED=true`, all five password-setting paths —
registration, self-service change, reset-by-token, admin user creation and
admin reset — additionally check the password against the Have I Been Pwned
range API.

**Privacy:** only the **first five hexadecimal characters** of the password's
SHA-1 hash are transmitted. The provider returns every hash suffix sharing that
prefix and the match is made in-process, so it never sees the password, its
full hash, or which suffix was requested. No member identifier is sent. That
SHA-1 is the corpus's lookup index, fixed by the provider's API — it is never
stored and never compared against a stored credential; password storage remains
bcrypt/Argon2.

**Failure behaviour — fails open.** An unreachable or slow provider, an HTTP
error, or an unparseable body all _accept_ the password, and the degradation is
logged. This check is supplementary; complexity rules, password history, MFA
and lockout are unaffected by the outage, and a third-party failure must not
stop a department setting passwords during an incident.

**The rejection does not say how many times the password was seen.** A precise
count is a free oracle over the breach corpus for anyone who can reach a
password form, and it tells the member nothing actionable — they need a
different password either way.

See [Configuration → Security](Configuration-Security#breached-password-detection)
for the settings.

### Suspicious-IP Throttling (on by default)

The per-IP rate limit caps burst speed and the account lockout caps guesses
against one user. Neither stops a **password spray**: one IP trying two
passwords each against a thousand usernames stays under 5/minute and never
reaches the 5-attempt lockout on any single account.

Suspicious-IP throttling counts **failed** authentication attempts per IP
across **all** accounts over a long window (default: 50 failures per hour) and
blocks the IP for 15 minutes once the total crosses the threshold. It applies
to `/auth/login`, `/auth/mfa/login`, and the pre-verification challenge
rejections — those resolve no account, and would otherwise be the one unmetered
door into the authentication surface.

Two invariants that must survive any refactor:

- A **fully** successful sign-in clears the IP's counter — never a correct
  password alone. Otherwise an attacker holding one leaked password for an
  MFA-protected account could zero the tally at will.
- Clearing the counter **never lifts an active block**.

The ledger is keyed on IP address only and holds no account or member data.
Redis-backed and shared across workers, with a capped, evicted per-process
fallback.

### Account Lockout, Unlock and the Sign-In Audit Trail

After `MAX_LOGIN_ATTEMPTS` (5) consecutive failures, password or second
factor, an account is locked for `ACCOUNT_LOCKOUT_DURATION_MINUTES` (15). With
`ACCOUNT_LOCKOUT_REVEAL=False` (the default) the sign-in screen still answers
"Incorrect username or password", so it never confirms that an account exists.
The lock is visible instead to the people who can lift it: the **Members**
admin page shows "Sign-in locked until …" to `members.manage` holders, with an
**Unlock** action (`POST /users/{id}/unlock`). Unlocking clears the failure
count and is audited as `account_unlocked`. Resetting the password also clears
the lock.

For an account with MFA, a correct password does not reset the failure count
or lift the lock — only a successful second factor does — so wrong
authenticator codes accumulate to a lockout like wrong passwords. A
rate-limited sign-in shows the server's `Retry-After` wait ("Too many failed
attempts. Try again in N seconds.").

Every sign-in event is written to the tamper-evident audit log under category
`authentication`: `login` (with `method`: `password`, `password+totp`,
`password+passkey` or `password+recovery_code`), `login_failed` (with `reason` and `stage`),
`account_locked` on the attempt that sets the lock, and `logout`. A failure
against an identifier that matches no account is recorded with no member and
no organization, and the identifier itself is not stored, because members
type passwords into that box. The security dashboard's "failed logins in the
last hour" counts the organization's `login_failed` rows.

---

## OAuth

Connect external identity providers for single sign-on. "Sign in with Google",
"Sign in with Microsoft" (Azure AD, single-tenant) and "Authentik SSO" are
implemented via the OpenID Connect
authorization-code flow in `services/oauth_service.py`.

**The credentials come from the server's environment, not the Settings
screen.** Settings → Authentication chooses which provider the login page
offers; the client ID, secret and server URL fields there are kept for the
department's records and read by nothing. A provider shows a button only when
the department chose it **and** the server is configured for it. Until then,
members keep signing in with passwords and can reset them: forgot-password
refers people to a provider only when that provider is actually live.

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
   - **Authentik** — endpoints come from the issuer's discovery document
     (`<AUTHENTIK_ISSUER_URL>.well-known/openid-configuration`, cached for an
     hour), which must name the configured issuer and keep every endpoint on
     the issuer's origin. The token is verified against the provider's JWKS
     with `audience=AUTHENTIK_CLIENT_ID` and the configured issuer, using an
     asymmetric algorithm only: give the Authentik provider a **signing key**,
     because a client-secret (HS256) token is refused. The email links an
     account only when `email_verified` is `true` — make sure the provider's
     email scope mapping sets it, or every sign-in fails with
     `unverified_email`
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
6. **MFA is enforced on the OAuth path too.** If the matched
   account has TOTP enabled, step 5 does **not** happen: no session cookies are
   issued and no session row is created. The callback instead redirects to
   `/auth/callback#mfa_token=<jwt>` — a 5-minute `mfa_pending` token carried in
   the **URL fragment**, which browsers never send to a server. The SPA strips
   the fragment from history immediately (`history.replaceState`), stores the
   challenge in the auth store, and routes to `/login`, where the standard
   two-factor form completes `POST /auth/mfa/login`, so a compromised
   Google/Microsoft account does not bypass the app's second factor. Audit
   event:
   `oauth_mfa_challenge` (category `authentication`)

### Supported Providers

- **Google Workspace** — "Sign in with Google" (OpenID Connect)
- **Microsoft 365 / Azure AD** — "Sign in with Microsoft" (single-tenant)
- **Authentik** — "Authentik SSO" (self-hosted OpenID Connect)

### Domain Restriction

Set `GOOGLE_ALLOWED_DOMAINS` / `AZURE_AD_ALLOWED_DOMAINS` /
`AUTHENTIK_ALLOWED_DOMAINS` (comma-separated) to
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

# Authentik (OpenID Connect provider with a signing key)
AUTHENTIK_ENABLED=true
AUTHENTIK_ISSUER_URL=https://auth.your-domain.com/application/o/the-logbook/
AUTHENTIK_CLIENT_ID=your-client-id
AUTHENTIK_CLIENT_SECRET=your-client-secret
AUTHENTIK_REDIRECT_URI=https://your-domain.com/api/v1/auth/oauth/authentik/callback
AUTHENTIK_ALLOWED_DOMAINS=yourdept.org
```

### Callback Error Codes

The callback redirects to `OAUTH_FAILURE_REDIRECT?error=<code>` for these
recoverable failures:

| Code                     | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `access_denied`          | The provider returned an error (e.g. user cancelled consent)           |
| `invalid_state`          | Missing/mismatched `state` vs. the `oauth_state` cookie (CSRF guard)   |
| `token_exchange_failed`  | Authorization-code exchange with the provider failed                   |
| `missing_id_token`       | Provider response contained no ID token                                |
| `invalid_id_token`       | ID token failed cryptographic verification (signature/audience/expiry) |
| `invalid_issuer`         | ID token issuer is not the expected provider                           |
| `invalid_tenant`         | Microsoft `tid` claim does not match `AZURE_AD_TENANT_ID`              |
| `unverified_email`       | IdP did not mark the email as verified (Google, Authentik)             |
| `provider_unavailable`   | Authentik discovery could not be fetched                               |
| `provider_misconfigured` | Authentik discovery names another issuer or an off-origin endpoint     |
| `no_email`               | No email present in the verified claims                                |
| `domain_not_allowed`     | Email domain not in the configured allowlist                           |
| `no_account`             | No matching active local user for the verified email                   |
| `inactive`               | Matched local user is not active                                       |
| `account_conflict`       | Email already bound to a different IdP subject/provider                |

---

## SAML and LDAP — Not Implemented

**Neither SAML 2.0 nor LDAP/Active Directory sign-in is implemented**, and no
SAML or LDAP library is installed. The `LDAP_*` settings in
`.env.example.full` are inert placeholders that gate nothing.

Federated sign-in means **OAuth 2.0 / OIDC via Google Workspace, Microsoft
Azure AD or Authentik** (documented above). If your department needs SAML or
LDAP, please open an issue — the placeholders exist because it is a plausible
future addition, not because it half-works today.

---

## Multi-Factor Authentication (MFA)

Two second factors, either of which is enough: a **passkey** on the member's
phone or computer (Face ID, a fingerprint or the device PIN), or app-based
**TOTP** with apps like Google Authenticator, Authy, or 1Password. Both come
after the password or SSO sign-in. MFA is self-enrolled by default and can be
required org-wide by an administrator. See [MFA](https://github.com/thegspiro/the-logbook/blob/main/docs/MFA.md) for full
implementation detail.

### Adding a passkey

1. Navigate to **Settings → Security → Passkeys** and choose **Add a passkey**
2. Name it, choose **Create passkey**, and confirm on the device
3. If it is your first second factor, **save the recovery codes** shown once

Up to three passkeys per member. Passkeys need the site on HTTPS at its domain
name (`FRONTEND_URL`); elsewhere only the authenticator app is offered.

### Enrolling (per-user, opt-in)

1. Navigate to **Settings → Security**
2. Start **Two-Factor Authentication** setup
3. Scan the QR code with your authenticator app
4. Enter the 6-digit code to confirm and enable MFA
5. **Save the recovery codes** — they are shown exactly once, and stay on
   screen until you choose **Done**

### Login Challenge

When an account has MFA enabled, the password step (`POST /auth/login`) does
**not** issue a session. It returns `{ mfa_required: true, mfa_token }`, and the
client completes `POST /auth/mfa/login` with that token plus a 6-digit TOTP
code, a single-use recovery code, or a passkey response (challenge from
`POST /auth/mfa/challenge`) before session cookies are issued. TOTP
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

**Privilege ceiling on admin resets:** the admin password-reset and MFA-reset
endpoints refuse to touch an account whose effective permissions exceed the
caller's own. A `members.manage` holder cannot reset the password or strip the second factor of a `security.manage`
admin and log in as them — the classic reset-to-escalate path. Every
permission the target holds must be within the caller's set (wildcards
honored, so `*` clears anyone); a violation returns 403
("You cannot reset the account of a user with privileges beyond your own")
and files a privilege-escalation report. Equal-privilege peers remain
resettable, and both endpoints stay rate-limited and org-scoped.

---

## Public Portal API Keys

Read-only public-portal endpoints (`/api/public/v1/*`) authenticate with an
API key sent in the `X-API-Key` header (not the session cookie / JWT used for
the app):

- **IP rate limit before bcrypt.** Key verification uses bcrypt (deliberately
  slow); the per-IP rate limit runs _before_ the database lookup and bcrypt
  step, so an unauthenticated flood of well-formed keys can't burn CPU.
- **Selective lookup prefix.** Keys are `logbook_<random>`; the stored lookup
  prefix is the first 16 chars (`logbook_` + 8 key chars), so a lookup returns a
  single candidate to verify instead of every key in the system. A key stored
  with only the constant `logbook_` prefix **self-heals** to the selective
  prefix on its next successful use — no re-issue needed.
- Keys are hashed (bcrypt) at rest; only the short prefix is stored in plaintext,
  for identification.

---

## Session Management

| Feature                | Details                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime  | 30 minutes by default (`ACCESS_TOKEN_EXPIRE_MINUTES`), renewed silently by the refresh flow                                                                                                                                                  |
| Refresh token lifetime | 7 days by default (`REFRESH_TOKEN_EXPIRE_DAYS`)                                                                                                                                                                                              |
| Inactivity timeout     | 15 minutes by default (`HIPAA_SESSION_TIMEOUT_MINUTES`), enforced server-side; the app warns 60 seconds before sign-out                                                                                                                      |
| Absolute lifetime      | 12 hours by default (`SESSION_ABSOLUTE_MAX_HOURS`), however active the session is; the member then signs in again                                                                                                                            |
| Kiosk sessions         | Members with `security.kiosk_session` can switch their own session to a 12-hour idle timeout and 7-day lifetime (`SESSION_KIOSK_IDLE_TIMEOUT_MINUTES`, `SESSION_KIOSK_ABSOLUTE_MAX_HOURS`); the app warns 5 minutes before the lifetime ends |
| Session IP monitoring  | Alerts on IP change during session                                                                                                                                                                                                           |
| Password change        | Signs the member out of every session                                                                                                                                                                                                        |

### Refresh Rotation Is Strict — No Replay Grace

Refresh tokens rotate on every use, and a **used token is dead immediately**.
There is no grace window: handing the session's current token pair to anyone
presenting the just-rotated previous token would let a token thief take over a
session after every legitimate refresh. Presenting any stale refresh token is
treated as replay/theft and **revokes all of that user's sessions** (logout
everywhere). `REFRESH_ROTATION_GRACE_SECONDS` is not a setting; a `.env` that
still sets it boots and logs that the setting has no effect.

**Two refreshes at the same instant revoke nothing.** Two tabs sharing one
cookie jar can refresh the same valid token at once. The rotation is an
`UPDATE` conditional on the presented token, so of
two overlapping refreshes exactly one wins; the other is answered with **409
`LB-AUTH-012`** and revokes nothing. The client treats that answer as success —
the shared cookie jar already holds the winner's tokens — and retries the
original request. A refresh that starts _after_ the first has committed still
reads as replay, as above: telling it from theft would need the previous token
on record, which is not kept. See
[Error codes](https://github.com/thegspiro/the-logbook/blob/main/docs/ERROR_CODES.md).

### Sign-Out Is Confirmed, Not Assumed

The server clears the httpOnly auth cookies only on a successful
`POST /auth/logout`, so a sign-out that failed on a shared station computer
would leave the previous member's session live behind a login screen.
`logout()` asks
the server up to three times (pauses of 0.5 s and 1.5 s); a 401 counts as
confirmed, since the server holds no live session for those cookies. The local
session is torn down either way. If no attempt is confirmed, the app blocks the
screen with a notice that has no dismiss — it tells the member to close every
browser window and offers **Try signing out again**, which clears the block once
the server confirms. The block is stored in `localStorage`, so a reload cannot
bring back a plain login screen.

### Offline Queues Belong to the Member Who Queued Them

Equipment checks, shift reports and generic submissions queued while offline
record the owning member (`ownerId`) when they are written, and nothing is
written with nobody signed in. Every drain sends only the signed-in member's own
entries and leaves another member's in place. Entries with no owner (written by
an older version of the app) are **held**: a notice in the app shell lists how many and of
what kind, with **Send as me** and **Discard**, each behind a confirmation that
states the consequence. Until one is chosen they are not sent under anyone's
cookies.

### Deactivated Organizations Cannot Log In

Password login joins on the organization and requires
`organizations.active IS TRUE` — both when resolving the canonical org and in
the cross-org username fallback — so a member of a **deactivated**
organization cannot authenticate. The rejection is indistinguishable from a
wrong password ("Incorrect username or password", with the usual dummy-hash
timing defense), so org status is not enumerable. OAuth sign-in resolves only
an active organization too, and fails with `no_account` otherwise. The check
runs at authentication time: existing sessions are not revoked when an org is
deactivated, and expire naturally.

### Password Reset and Deep Links

- **Forgot password** reports the link lifetime the server returns
  (`expires_in_minutes`, 30), and shows **No Reset Link Was Sent** with the
  server's message when the organization uses an SSO provider, instead of
  "Check Your Email". A rate-limited reset link reads **Too Many Attempts**
  with the wait, rather than "invalid".
- **Both password checklists list every server rule** — length, the four
  classes, no runs (123, abc), no character three times in a row — from the
  moment the form opens.
- **Deep links survive sign-in** with their query and anchor, through one
  `postLoginRedirect` helper that keeps the open-redirect guard (a single
  leading `/`, never `//host` or a full URL).

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
GET    /api/v1/auth/oauth/authentik          # Initiate Authentik sign-in (404 if not configured)
GET    /api/v1/auth/oauth/authentik/callback # Authentik OAuth callback
```

---

**See also:** [Security Overview](Security-Overview) | [Security Configuration](Configuration-Security) | [Encryption](Security-Encryption)

### Station kiosks

A wall-mounted Check-In Station or inventory kiosk has to stay signed in
between shifts, which the 15-minute idle timeout and 12-hour lifetime do not
allow. Rather than weakening those for everyone, a member holding
`security.kiosk_session` (seeded to no position) can switch **their own
session** to the kiosk limits from the station or kiosk page, and switch it
back at any time.

- The kiosk limits apply only while the member still holds the permission;
  revoke it and the session returns to the standard limits on its next request.
- Turning it on is recorded in the audit log as a warning.
- **Recommendation:** sign a station in with a dedicated account that holds
  only the permissions that station needs (`members.check_in` or
  `inventory.kiosk`, plus `security.kiosk_session`), never a chief's or
  administrator's own account. A session left signed in on a shared tablet
  carries that account's full access.
- Every session, kiosk or not, shows a toast 5 minutes before its lifetime ends.

### Mandatory MFA for privileged members and step-up re-verification

Two controls sit on top of the organization-wide MFA switch (Organization
Settings > Security), which still works as before.

**Who must use MFA.** A member who holds any of these permissions (wildcards
count) must enroll in two-factor authentication whatever the organization
chose: `*`, `settings.manage`, `security.manage`, `integrations.manage`,
`users.create`, `users.edit`, `users.delete`, `users.update_positions`,
`audit.export`, `audit.manage`, `medical_screening.view`,
`medical_screening.manage`. The list is computed from permissions, so it
follows role changes. In the seeded positions that is the fire, deputy and
assistant chiefs, the president, the secretary, the membership coordinator and
the IT manager; it is defined in `app/services/mfa_policy.py`.

- **Grace period.** The first time the server sees a privileged member without
  MFA it starts a 14-day clock (`MFA_GRACE_DAYS`), emails them, and shows a
  banner counting down. After it ends they can reach only the enrollment
  screens, as under the org-wide switch.
- **Losing and regaining privilege.** The clock is cleared when a member stops
  being privileged, so a later promotion gets a fresh period.

**Step-up.** Some actions need the member to have re-verified on the current
session in the last 10 minutes (`STEPUP_WINDOW_MINUTES`): an authenticator
code, or the password for a member without MFA. The stamp is stored on the
session row, so it never carries to another device or tab. Without it the API
answers `403 LB-AUTH-013` and the app prompts and repeats the request. A
member who signs in only through a provider and has neither a password nor MFA
cannot step up; they are told to enroll in MFA.

| Group               | Actions                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exports             | audit log export, error log export                                                                                                                                                                                                         |
| Security and policy | MFA policy, organization auth and file-storage settings, audit chain re-hash, role create/edit/delete/clone, assigning or removing a member's positions, IP exceptions approve/revoke, country blocks, integration connect/disconnect/edit |
| Account recovery    | administrator password reset, administrator MFA reset                                                                                                                                                                                      |
| Destructive         | delete a member, anonymize a member                                                                                                                                                                                                        |
| Signatures          | signing a member performance evaluation (approvals, and the member's acknowledgement or refusal)                                                                                                                                           |
