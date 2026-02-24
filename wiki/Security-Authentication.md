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

### Password Requirements

- Minimum 12 characters
- At least one uppercase, one lowercase, one number, one special character
- Cannot reuse last 12 passwords
- Must change every 90 days
- Account locks after 5 failed attempts (30-minute lockout)

---

## OAuth 2.0

Connect external identity providers for single sign-on.

### Supported Providers

- **Google Workspace** — Google OAuth 2.0
- **Microsoft 365** — Azure AD OAuth 2.0
- **Custom** — Any OAuth 2.0 compliant provider

### Configuration

Navigate to **Settings > Authentication** or set in `.env`:

```bash
OAUTH_GOOGLE_CLIENT_ID=your-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_MICROSOFT_CLIENT_ID=your-client-id
OAUTH_MICROSOFT_CLIENT_SECRET=your-client-secret
OAUTH_MICROSOFT_TENANT_ID=your-tenant-id
```

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

## Multi-Factor Authentication (MFA)

TOTP-based two-factor authentication using apps like Google Authenticator, Authy, or 1Password.

### Enabling MFA

**Per-user (opt-in):**
1. Navigate to **Account Settings > Security**
2. Click **Enable Two-Factor Authentication**
3. Scan the QR code with your authenticator app
4. Enter the 6-digit code to verify
5. Save backup codes securely

**Admin-enforced:**
1. Navigate to **Settings > Security**
2. Enable **Require MFA for all users** or **Require MFA for admin roles**
3. Users will be prompted to set up MFA on their next login

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
POST   /api/v1/auth/mfa/setup               # Initialize MFA setup
POST   /api/v1/auth/mfa/verify              # Verify MFA code
GET    /api/v1/auth/oauth/{provider}         # Initiate OAuth flow
GET    /api/v1/auth/oauth/{provider}/callback # OAuth callback
```

---

**See also:** [Security Overview](Security-Overview) | [Security Configuration](Configuration-Security) | [Encryption](Security-Encryption)
