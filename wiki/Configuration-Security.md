# Security Configuration

Configure security settings for The Logbook, including authentication, encryption, session management, and security features aligned with HIPAA requirements.

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

| Setting            | Default       | Description                          |
| ------------------ | ------------- | ------------------------------------ |
| Minimum length     | 12 characters | Configurable                         |
| Requires uppercase | Yes           | At least one uppercase letter        |
| Requires lowercase | Yes           | At least one lowercase letter        |
| Requires number    | Yes           | At least one digit                   |
| Requires special   | Yes           | At least one special character       |
| Password history   | 12            | Cannot reuse last 12 passwords       |
| Max password age   | 90 days       | Forced change after 90 days          |
| Lockout threshold  | 5 attempts    | Account locked after 5 failed logins |
| Lockout duration   | 30 minutes    | Auto-unlock after 30 minutes         |

---

## Attack Protection _(2026-08-16 → 08-17)_

Four brute-force controls layer on top of each other. When changing one, know
which gap it covers so you do not collapse two into one.

| Control                | Counts                           | Keyed on             | On provider/Redis failure |
| ---------------------- | -------------------------------- | -------------------- | ------------------------- |
| `check_rate_limit`     | all attempts, short window       | IP + scope           | falls back to in-memory   |
| Account lockout        | consecutive failures             | user                 | n/a (database)            |
| Suspicious-IP throttle | **failed** attempts, long window | IP, **all** accounts | falls back to in-memory   |
| Breached password      | breach-corpus appearances        | password hash prefix | **fails open**            |
| CAPTCHA                | human challenge                  | request              | **fails closed**          |

**The two failure directions are deliberate and opposite.** Breached-password
detection is supplementary — complexity rules, password history, MFA and
lockout all still apply if the lookup is skipped — so an outage must not block
password changes. CAPTCHA has no fallback control behind it, so accepting
unverified traffic during an outage is the state an attacker wants; it rejects
instead. Preserve both directions when touching either.

### Breached-password rejection

| Variable                            | Default                                | Description                                                                                                                            |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `BREACHED_PASSWORD_CHECK_ENABLED`   | `false`                                | Off by default: it makes an outbound request on password set/change, which some deployments cannot allow                               |
| `BREACHED_PASSWORD_MIN_COUNT`       | `1`                                    | Appearances before rejecting. `1` rejects anything ever seen; a higher value tolerates rare appearances more likely to be corpus noise |
| `BREACHED_PASSWORD_API_URL`         | `https://api.pwnedpasswords.com/range` |                                                                                                                                        |
| `BREACHED_PASSWORD_TIMEOUT_SECONDS` | `3.0`                                  |                                                                                                                                        |

**Only the first 5 characters of the SHA-1 hash are ever sent** (k-anonymity).
The password and its full hash never leave the server. The hash is marked
not-for-security in code — it is a corpus lookup key, not a credential store.

### Suspicious-IP throttle

| Variable                         | Default | Description                                                              |
| -------------------------------- | ------- | ------------------------------------------------------------------------ |
| `SUSPICIOUS_IP_THROTTLE_ENABLED` | `true`  | Counts **failed** authentication attempts per IP across **all** accounts |
| `SUSPICIOUS_IP_MAX_FAILURES`     | `50`    | Failures per window before blocking                                      |
| `SUSPICIOUS_IP_WINDOW_SECONDS`   | `3600`  |                                                                          |
| `SUSPICIOUS_IP_BLOCK_SECONDS`    | `900`   |                                                                          |

Two invariants in `app/core/suspicious_ip.py` are load-bearing:

1. **A successful sign-in clears an IP's counter only after _full_
   authentication** — never on a correct password alone. Otherwise an attacker
   holding one leaked password for an MFA-protected account could zero the
   tally at will.
2. **Clearing never lifts an active block.**

This is the control that covers the gap account lockout leaves: lockout is
per-user, so spraying one password across a thousand accounts never trips it.

### CAPTCHA

| Variable                  | Default     | Description                                                                                            |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `CAPTCHA_ENABLED`         | `false`     |                                                                                                        |
| `CAPTCHA_PROVIDER`        | `turnstile` | `turnstile` \| `hcaptcha` \| `recaptcha`                                                               |
| `CAPTCHA_SECRET_KEY`      | —           | Enabling without this logs an error and enforces **nothing**                                           |
| `CAPTCHA_SITE_KEY`        | —           | Public; served to the browser                                                                          |
| `CAPTCHA_TIMEOUT_SECONDS` | `5.0`       |                                                                                                        |
| `CAPTCHA_MIN_SCORE`       | `0.5`       | reCAPTCHA v3 only — it returns a 0.0–1.0 score instead of pass/fail. Ignored by Turnstile and hCaptcha |

Applied to the two internet-exposed forms: public form submission and public
event-request intake.

> **Enabling CAPTCHA widens the CSP.** `SecurityHeadersMiddleware` adds the
> configured provider's widget origins. A hardcoded `script-src 'self'`
> silently blocks the widget, which presents as _"the challenge never appears"_
> rather than as a CSP error. A new provider needs an entry in **both**
> `_VERIFY_URLS` and `_WIDGET_ORIGINS` in `app/core/captcha.py`.

> **`X-Captcha-Token` is allowed in CORS** _(2026-08-17)_. Without it, a
> cross-origin frontend's preflight rejects the header and the challenge can
> never be submitted.

---

## Session Management

| Setting                | Default    | Description                                     |
| ---------------------- | ---------- | ----------------------------------------------- |
| Access token lifetime  | 8 hours    | JWT access token expiration                     |
| Refresh token lifetime | 7 days     | JWT refresh token expiration                    |
| Inactivity timeout     | 30 minutes | Auto-logout on no mouse/keyboard/touch activity |
| Concurrent sessions    | 3 max      | Per user                                        |
| Session IP validation  | Enabled    | Alerts on IP change during session              |

---

## Authentication Methods

The Logbook supports multiple authentication methods:

| Method                          | Description                                                                                                                        | Configuration                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Local**                       | Username/password with Argon2id hashing                                                                                            | Default, always available          |
| **OAuth (Google / Microsoft)**  | "Sign in with Google" and "Sign in with Microsoft" (Azure AD, single-tenant); link-existing-only, domain-restricted _(2026-05-29)_ | `GOOGLE_*` / `AZURE_AD_*` env vars |
| ~~**SAML**~~                    | **Not implemented.** Previously documented in error                                                                                | —                                  |
| ~~**LDAP / Active Directory**~~ | **Not implemented.** The `LDAP_*` settings exist in config but gate nothing _(clarified 2026-07-31)_                               | —                                  |
| **TOTP MFA**                    | Time-based one-time passwords (Google Authenticator, etc.)                                                                         | Per-user opt-in or admin-enforced  |

---

## Encryption

| Layer               | Algorithm                    | Details                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Passwords**       | Argon2id                     | OWASP-recommended, memory-hard                                                                                                                                                                                                                                                                                           |
| **Data at rest**    | AES-256-GCM                  | Authenticated encryption of sensitive fields; a tampered value fails to decrypt (fails closed). Values written under the legacy Fernet (AES-128-CBC) scheme still decrypt; `backend/scripts/reencrypt_to_aesgcm.py` backfills them (see [`docs/AES256_GCM_BACKFILL_RUNBOOK.md`](../docs/AES256_GCM_BACKFILL_RUNBOOK.md)) |
| **Data in transit** | TLS 1.3                      | HTTPS required in production                                                                                                                                                                                                                                                                                             |
| **Audit logs**      | Keyed HMAC-SHA256 hash chain | Tamper-evident chain keyed with the signing key, so forging it requires the key, not just DB write access (legacy pre-upgrade rows remain unkeyed SHA-256 for verification)                                                                                                                                              |

---

## Rate Limiting

| Endpoint              | Limit     | Description            |
| --------------------- | --------- | ---------------------- |
| Login                 | 5/minute  | Per IP address         |
| API (general)         | 60/minute | Per authenticated user |
| Public forms (view)   | 60/minute | Per IP                 |
| Public forms (submit) | 10/minute | Per IP                 |

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

## Client IP Resolution & GeoIP _(2026-05-29)_

### Spoof-Proof Client IP

`get_client_ip()` in `core/security_middleware.py` was rewritten so forwarded
headers can no longer be spoofed:

- Forwarded headers (`X-Forwarded-For`, `X-Real-IP`) are **only trusted when the
  direct peer is listed in `TRUSTED_PROXY_IPS`** (exact IPs or CIDR ranges such
  as `172.16.0.0/12`). When the list is empty (default), forwarded headers are
  ignored entirely and the socket peer address is used. If unset behind a proxy,
  every request appears to come from the proxy IP: geo-blocking silently does
  nothing and all clients share one per-client rate-limit bucket. The production
  Docker override defaults `TRUSTED_PROXY_IPS` to
  `172.16.0.0/12,192.168.0.0/16,10.0.0.0/8` so the bundled proxy is trusted
- The real client is the **right-most** `X-Forwarded-For` hop that is not itself
  a trusted proxy (previously the left-most, spoofable entry). If `X-Forwarded-For`
  is absent or entirely trusted proxies, it falls back to `X-Real-IP`, then the
  peer
- **Startup warning:** in `production`/`staging`, the app warns if `GEOIP_ENABLED`
  is true but `TRUSTED_PROXY_IPS` is empty

> **Behind a reverse proxy (nginx, Docker, load balancer) you MUST set
> `TRUSTED_PROXY_IPS`** to the proxy's address(es), or every client will appear
> to come from the proxy's IP.

### GeoIP Country Blocking

Country blocking is a **platform-edge control**: it runs in middleware before any
tenant/authentication context exists, against one shared MaxMind database and one
global blocked-country set, so it applies to the whole deployment rather than to a
single organization.

- **Deploy-time source of truth:** the blocked-country list is normally set once
  at deploy via `BLOCKED_COUNTRIES`. Runtime management via the API
  (`POST`/`DELETE /api/v1/ip-security/blocked-countries`) is **disabled by
  default** and only available when the operator sets
  `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT=true` — because a runtime change affects
  every tenant, not just the admin's own org
- When runtime management is enabled, `CountryBlockRule` rows overlay the config
  defaults; `sync_blocked_countries_to_geoip()` reconciles them into the running
  GeoIP service at startup and on every rule change
- **Multi-worker sync:** `core/geoip_sync.py` publishes a Redis `geoip:invalidate`
  message on rule changes; each worker's `GeoIPInvalidationListener` re-syncs from
  the DB. If Redis is down, the publish is a no-op and changes apply on the next
  restart
- **Fail-open vs fail-closed (configurable):** by default, if a request's country
  cannot be determined it is **allowed** (fail-open). Set `GEOIP_FAIL_CLOSED=true`
  to instead **block** any unresolved-country IP — including when the MaxMind DB
  is missing or corrupt, which otherwise silently disables geo-blocking.
  Private/reserved and allowlisted IPs are always allowed regardless, so an
  internal or allowlisted operator can still recover if a missing DB would
  otherwise lock everyone out

---

## Host Header Allowlist _(2026-07)_

`TrustedHostMiddleware` rejects any request whose `Host` header is not in the
allowlist with an HTTP 400, so Host-derived values (emailed links, OAuth
callbacks) can be trusted rather than reflected from an attacker-controlled
header.

- **`TRUSTED_HOSTS`** — comma-separated hostnames. Starlette subdomain wildcards
  such as `*.example.com` are allowed.
- **Enabled automatically** in `production`/`staging`, or in any environment when
  `TRUSTED_HOSTS` is set explicitly.
- **When left empty**, the effective allowlist is derived from the
  `ALLOWED_ORIGINS` hostnames plus `localhost`/`127.0.0.1` (so health checks keep
  working).

---

## Database & Redis TLS Verification _(updated 2026-08)_

`DB_SSL` / `REDIS_SSL` enable TLS for the database and Redis connections. If they
are enabled **without** the corresponding CA path set, the connection is
encrypted but the server certificate is **not verified** (`CERT_NONE`) — which
offers no protection against an active man-in-the-middle.

**This blocks startup in production and staging.** It used to be a warning.
The reasoning: a channel that looks encrypted but authenticates nobody is
_worse_ than honest plaintext on a private network, because it is
indistinguishable from a correct configuration — nobody goes looking for a
problem the dashboard says you do not have.

- Set **`DB_SSL_CA`** / **`REDIS_SSL_CA`** to the CA certificate path for full
  MITM protection (certificate verification). This is the fix.
- Or set **`SECURITY_ALLOW_UNVERIFIED_TLS=true`** to accept the risk. It is
  logged loudly on every boot, so the acceptance does not quietly outlive the
  person who made it. Clear the flag once a CA is configured.

Plaintext DB/Redis (`DB_SSL` unset) **blocks startup in production and
staging** unless the deployment opts out: `SECURITY_REQUIRE_TLS` defaults to
`true`, and without `DB_SSL`/`REDIS_SSL` configured the backend refuses to
start. A container-internal network is still a legitimate deployment — the
bundled installers (`install.sh`, `scripts/universal-install.sh`, the Unraid
setup) write an explicit `SECURITY_REQUIRE_TLS=false` risk acceptance into the
generated `.env` because their bundled MySQL/Redis do not terminate TLS. Set
the flag `false` yourself only when a trusted topology (private VPC, service
mesh, sidecar) provides equivalent transport protection.

### Rate limiting is now a real switch

`RATE_LIMIT_ENABLED` was declared in config and documented, but read by no
limiter — an operator who set it `false` got rate limiting anyway, and no
warning. As of 2026-08-01 it genuinely gates `check_rate_limit`,
`public_rate_limit`, and the public-portal IP limiter.

Production and staging **refuse to start** with it disabled: turning it off
removes brute-force and abuse protection from every authentication and public
endpoint at once. The switch exists for load testing and fuzzing, where the
limiter masks the behaviour under test.

---

## Monitoring & Alerts

```bash
# Check security status
curl http://YOUR-IP:3001/api/v1/security/status

# View security alerts (scoped to the caller's organization — an org admin
# only sees, acknowledges, and resolves their own org's alerts)
curl http://YOUR-IP:3001/api/v1/security/alerts

# Verify audit log integrity
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Check intrusion detection
curl http://YOUR-IP:3001/api/v1/security/intrusion-detection/status
```

---

**See also:** [Security Overview](Security-Overview) | [Authentication](Security-Authentication) | [Environment Variables](Configuration-Environment)
