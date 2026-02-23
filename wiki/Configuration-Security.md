# Security Configuration

Configure security settings for The Logbook, including authentication, encryption, session management, and HIPAA compliance.

---

## Quick Security Checklist

- [ ] `SECRET_KEY` is set (min 32 characters, not default)
- [ ] `ENCRYPTION_KEY` is set (64 hex characters, not default)
- [ ] `ENCRYPTION_SALT` is set (32 hex characters, unique per installation)
- [ ] `DB_PASSWORD` is not `change_me_in_production`
- [ ] `REDIS_PASSWORD` is set
- [ ] HTTPS enabled for production
- [ ] CORS configured for your domain only
- [ ] Rate limiting enabled
- [ ] Audit logging verified working

---

## Password Policy

| Setting | Default | Description |
|---------|---------|-------------|
| Minimum length | 12 characters | Configurable |
| Requires uppercase | Yes | At least one uppercase letter |
| Requires lowercase | Yes | At least one lowercase letter |
| Requires number | Yes | At least one digit |
| Requires special | Yes | At least one special character |
| Password history | 12 | Cannot reuse last 12 passwords |
| Max password age | 90 days | Forced change after 90 days |
| Lockout threshold | 5 attempts | Account locked after 5 failed logins |
| Lockout duration | 30 minutes | Auto-unlock after 30 minutes |

---

## Session Management

| Setting | Default | Description |
|---------|---------|-------------|
| Access token lifetime | 8 hours | JWT access token expiration |
| Refresh token lifetime | 7 days | JWT refresh token expiration |
| Inactivity timeout | 30 minutes | Auto-logout on no mouse/keyboard/touch activity |
| Concurrent sessions | 3 max | Per user |
| Session IP validation | Enabled | Alerts on IP change during session |

---

## Authentication Methods

The Logbook supports multiple authentication methods:

| Method | Description | Configuration |
|--------|-------------|---------------|
| **Local** | Username/password with Argon2id hashing | Default, always available |
| **OAuth 2.0** | Google, Microsoft, custom providers | Configure in Settings > Authentication |
| **SAML** | Enterprise SSO integration | SAML metadata configuration |
| **LDAP** | Active Directory / LDAP authentication | Server URL, bind DN, search base |
| **TOTP MFA** | Time-based one-time passwords (Google Authenticator, etc.) | Per-user opt-in or admin-enforced |

---

## Encryption

| Layer | Algorithm | Details |
|-------|-----------|---------|
| **Passwords** | Argon2id | OWASP-recommended, memory-hard |
| **Data at rest** | AES-256 | Sensitive fields encrypted in database |
| **Data in transit** | TLS 1.3 | HTTPS required in production |
| **Audit logs** | SHA-256 hash chain | Tamper-proof blockchain-inspired chain |

---

## Rate Limiting

| Endpoint | Limit | Description |
|----------|-------|-------------|
| Login | 5/minute | Per IP address |
| API (general) | 60/minute | Per authenticated user |
| Public forms (view) | 60/minute | Per IP |
| Public forms (submit) | 10/minute | Per IP |

---

## CORS Configuration

Set `ALLOWED_ORIGINS` in your `.env` file as a JSON array:

```bash
# Single origin
ALLOWED_ORIGINS=["https://your-domain.com"]

# Multiple origins
ALLOWED_ORIGINS=["https://your-domain.com","https://admin.your-domain.com"]
```

---

## Security Headers

The application automatically sets these security headers in production:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Monitoring & Alerts

```bash
# Check security status
curl http://YOUR-IP:3001/api/v1/security/status

# View security alerts
curl http://YOUR-IP:3001/api/v1/security/alerts

# Verify audit log integrity
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Check intrusion detection
curl http://YOUR-IP:3001/api/v1/security/intrusion-detection/status
```

---

**See also:** [Security Overview](Security-Overview) | [Authentication](Security-Authentication) | [Environment Variables](Configuration-Environment)
