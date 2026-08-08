# Environment Variables

Complete reference for all `.env` configuration variables in The Logbook.

---

## Required Variables

These must be set before the application will start in production mode.

| Variable          | Description                           | Example                     |
| ----------------- | ------------------------------------- | --------------------------- |
| `SECRET_KEY`      | Application secret key (min 32 chars) | `openssl rand -hex 32`      |
| `ENCRYPTION_KEY`  | AES-256 encryption key (64 hex chars) | `openssl rand -hex 32`      |
| `ENCRYPTION_SALT` | Encryption salt (32 hex chars)        | `openssl rand -hex 16`      |
| `DB_PASSWORD`     | MySQL database password               | Strong random password      |
| `REDIS_PASSWORD`  | Redis cache password                  | Strong random password      |
| `ALLOWED_ORIGINS` | CORS allowed origins (JSON array)     | `["http://localhost:3000"]` |

### Generate All Secrets at Once

```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_SALT=$(openssl rand -hex 16)"
echo "DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
```

---

## Application Settings

| Variable      | Description         | Default            |
| ------------- | ------------------- | ------------------ |
| `ENVIRONMENT` | Runtime environment | `development`      |
| `DEBUG`       | Enable debug mode   | `false`            |
| `TZ`          | Timezone            | `America/New_York` |
| `LOG_LEVEL`   | Logging verbosity   | `INFO`             |

> **`COMPOSE_FILE`** _(2026-07)_: production installs (via `install.sh`) pin
> `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` in `.env` so that
> bare `docker compose` commands automatically layer the production override
> (which forces `ENVIRONMENT: production`). The base `docker-compose.yml` is a
> development configuration, so `.env.example` defaults `ENVIRONMENT=development`.

---

## Port Configuration

| Variable        | Description        | Default                 |
| --------------- | ------------------ | ----------------------- |
| `FRONTEND_PORT` | Frontend HTTP port | `3000` (Unraid: `7880`) |
| `BACKEND_PORT`  | Backend API port   | `3001` (Unraid: `7881`) |

### Ports by Deployment Type

| Deployment         | Frontend    | Backend     |
| ------------------ | ----------- | ----------- |
| Docker Compose     | 3000        | 3001        |
| Unraid             | 7880        | 7881        |
| Native Dev         | 5173 (Vite) | 3001        |
| Production (Nginx) | 443 (HTTPS) | 443 (HTTPS) |

---

## Database

| Variable              | Description         | Default             |
| --------------------- | ------------------- | ------------------- |
| `DB_HOST`             | Database hostname   | `mysql`             |
| `DB_PORT`             | Database port       | `3306`              |
| `DB_NAME`             | Database name       | `the_logbook`       |
| `DB_USER`             | Database user       | `logbook_user`      |
| `DB_PASSWORD`         | Database password   | (required)          |
| `MYSQL_ROOT_PASSWORD` | MySQL root password | (required for init) |

> **Important:** The DB_HOST must match the Docker service name. In docker-compose.yml, the service is named `mysql`, not `db`.

---

## Redis

| Variable         | Description    | Default                  |
| ---------------- | -------------- | ------------------------ |
| `REDIS_HOST`     | Redis hostname | `redis`                  |
| `REDIS_PORT`     | Redis port     | `6379`                   |
| `REDIS_PASSWORD` | Redis password | (required in production) |

---

## Email / SMTP

| Variable             | Description                                  | Default                     |
| -------------------- | -------------------------------------------- | --------------------------- |
| `EMAIL_ENABLED`      | Enable email sending (SMTP)                  | `false`                     |
| `SMTP_HOST`          | SMTP server hostname                         | —                           |
| `SMTP_PORT`          | SMTP server port                             | `587`                       |
| `SMTP_USER`          | SMTP username                                | —                           |
| `SMTP_PASSWORD`      | SMTP password                                | —                           |
| `SMTP_FROM_EMAIL`    | Sender email address                         | —                           |
| `SMTP_FROM_NAME`     | Sender display name                          | `The Logbook`               |
| `SMTP_ENCRYPTION`    | Encryption mode: `tls`, `ssl`, or `none`     | `tls`                       |
| `SMTP_EHLO_HOSTNAME` | Explicit EHLO hostname (must resolve in DNS) | domain of `SMTP_FROM_EMAIL` |

### Cloudflare Email Service (Alternative to SMTP)

Use these variables instead of the SMTP variables above to send email via Cloudflare's REST API. Requires your domain's DNS to be managed by Cloudflare. Cloudflare handles SPF/DKIM/DMARC automatically.

| Variable                   | Description                                                 | Default |
| -------------------------- | ----------------------------------------------------------- | ------- |
| `CLOUDFLARE_EMAIL_ENABLED` | Enable Cloudflare Email Service                             | `false` |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare account ID (32-char hex, from dashboard sidebar) | —       |
| `CLOUDFLARE_API_TOKEN`     | API token with email sending permission                     | —       |

> **Note:** Set either SMTP variables or Cloudflare variables — not both. If both are configured, org-level settings take priority, then Cloudflare, then SMTP. The `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` variables are still used for the sender address when Cloudflare is the active backend at the global level.

---

## Web Push Notifications _(2026-08-07)_

Push delivers notifications to a member's **lock screen** while the app is
closed — the channel an installed PWA exists for. It hooks in where notifications
are recorded, so **every** existing source (event reminders, training expiry,
schedule changes, maintenance due, elections) is covered with no per-source
configuration.

| Variable            | Description                                                                            | Default |
| ------------------- | -------------------------------------------------------------------------------------- | ------- |
| `PUSH_ENABLED`      | Enable Web Push delivery                                                               | `false` |
| `VAPID_PUBLIC_KEY`  | VAPID public key (application server key)                                              | —       |
| `VAPID_PRIVATE_KEY` | VAPID private key                                                                      | —       |
| `VAPID_SUBJECT`     | Contact URI the push services can reach you at, e.g. `mailto:admin@yourdepartment.org` | —       |

Generate the keypair **once per deployment** and keep it stable — rotating it
invalidates every existing device subscription:

```bash
python3 -c "from py_vapid import Vapid01; v=Vapid01(); v.generate_keys(); print(v.public_key, v.private_key)"
```

**Operational notes:**

- The optional `pywebpush` dependency is imported **behind a guard**, so a
  deployment that does not want push need not install it. With it absent, or with
  `PUSH_ENABLED=false`, the service reports itself unconfigured and **the client
  hides the toggle** rather than offering a control that would fail on tap.
- **Subscriptions are per device**, not per user — a member with the app on a
  phone and a station tablet is reached on both.
- Browsers provide no unsubscribe callback, so a subscription is pruned when the
  push service answers `404`/`410` on a send. That is the only signal that an app
  was uninstalled or its site data cleared.
- Delivery **swallows every error**. The notification is already durably
  recorded, so a push-service outage must never fail the action that produced it
  or roll back its transaction.
- **iOS requires the app to be installed** to the home screen (16.4+). The push
  API does not exist while browsing in Safari, so no toggle appears there — this is
  correct behaviour, not a misconfiguration.

---

## Frontend (Build-Time)

These variables are baked into the frontend at build time via Vite.

| Variable       | Description  | Default   |
| -------------- | ------------ | --------- |
| `VITE_API_URL` | API base URL | `/api/v1` |

> **Critical:** Vite replaces `import.meta.env.VITE_*` at build time. Changing these after build has no effect — you must rebuild the frontend.

---

## Module Toggles

There are **no** deployment-level `MODULE_*_ENABLED` environment variables. The
backend never reads them and all API routers register unconditionally. Module
availability is controlled **per organization** at runtime via the
organization's settings (`enabled_modules`), configured inside the app
(Organization/Admin Settings → Modules). See [Module Configuration](Configuration-Modules).

---

## Security

| Variable                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Default               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `SESSION_TIMEOUT_MINUTES`             | Inactivity timeout                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `30`                  |
| `MAX_LOGIN_ATTEMPTS`                  | Attempts before lockout                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `5`                   |
| `LOCKOUT_DURATION_MINUTES`            | Lockout duration                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `30`                  |
| `PASSWORD_MIN_LENGTH`                 | Minimum password length                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `12`                  |
| `ENCRYPTION_KEYS_LEGACY`              | Comma-separated **previous** `ENCRYPTION_KEY` values, kept readable during a key rotation. See [docs/KEY_ROTATION.md](../docs/KEY_ROTATION.md) _(2026-07-31)_                                                                                                                                                                                                                                                                                                                         | `""`                  |
| `SECURITY_TXT_CONTACT`                | Security contact published at `/.well-known/security.txt` — an email address (a `mailto:` prefix is added) or a reporting URL. Unset falls back to the project's GitHub advisory intake _(2026-07-31)_                                                                                                                                                                                                                                                                                | `""`                  |
| `SECURITY_TXT_POLICY_URL`             | Policy URL advertised in `security.txt` _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                                                                                | Project `SECURITY.md` |
| `HIPAA_AUDIT_RETENTION_DAYS`          | Audit-log retention; **enforced** by the weekly archival job                                                                                                                                                                                                                                                                                                                                                                                                                          | `2555` (7 years)      |
| `AUDIT_ARCHIVE_DIR`                   | Where purged audit rows are exported as gzipped JSONL. **Back this directory up** — after a purge it is the only copy of the oldest audit history _(2026-07-31)_                                                                                                                                                                                                                                                                                                                      | `./audit_archives`    |
| `AUDIT_SHIP_WEBHOOK_URL`              | Collector/SIEM endpoint for off-host audit shipping (HMAC-signed NDJSON). Unset disables shipping _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                      | —                     |
| `AUDIT_SHIP_BATCH_SIZE`               | Rows per shipping batch _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                                                                                                | `500`                 |
| `RETENTION_BLOCKED_ATTEMPTS_DAYS`     | Platform-level retention for blocked-access telemetry (IP + user agent); `0` disables. Org-scoped record classes are configured per organization instead _(2026-07-31)_                                                                                                                                                                                                                                                                                                               | `365`                 |
| `BACKUP_TIME`                         | Backup sidecar run time, UTC `HH:MM` _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                                                                                   | `02:00`               |
| `BACKUP_RETENTION_DAYS`               | Days of backup archives to keep _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                                                                                        | `30`                  |
| `VERIFY_EVERY_N_BACKUPS`              | Automated restore-drill cadence; `0` disables _(2026-07-31)_                                                                                                                                                                                                                                                                                                                                                                                                                          | `7`                   |
| `JWT_ACCESS_TOKEN_EXPIRE`             | Access token lifetime (hours)                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `8`                   |
| `JWT_REFRESH_TOKEN_EXPIRE`            | Refresh token lifetime (days)                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `7`                   |
| `RATE_LIMIT_PER_MINUTE`               | API rate limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `60`                  |
| `IP_LOGGING_ENABLED`                  | Log client IPs for security monitoring                                                                                                                                                                                                                                                                                                                                                                                                                                                | `true`                |
| `TRUSTED_HOSTS`                       | Comma-separated allowlist of `Host` header values enforced by `TrustedHostMiddleware`; a spoofed `Host` is rejected with HTTP 400, making Host-derived values (emailed links, OAuth callbacks) safe to trust. Starlette subdomain wildcards (`*.example.com`) are allowed. Enabled automatically in production/staging, or in any environment when set explicitly. When empty, the allowlist is derived from the `ALLOWED_ORIGINS` hostnames plus `localhost`/`127.0.0.1` _(2026-07)_ | `""`                  |
| `TRUSTED_PROXY_IPS`                   | Comma-separated proxy IPs (or CIDR ranges, e.g. `172.16.0.0/12`) whose forwarded headers are trusted. **Critical when running behind a reverse proxy** _(2026-05-29)_                                                                                                                                                                                                                                                                                                                 | `""`                  |
| `GEOIP_ENABLED`                       | Enable GeoIP country-based access control                                                                                                                                                                                                                                                                                                                                                                                                                                             | `false`               |
| `GEOIP_DATABASE_PATH`                 | Path to the MaxMind GeoLite2 country database                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                     |
| `BLOCKED_COUNTRIES`                   | Comma-separated ISO country codes to block. This is the deploy-time source of truth for the platform-wide blocklist _(2026-07)_                                                                                                                                                                                                                                                                                                                                                       | `""`                  |
| `GEOIP_FAIL_CLOSED`                   | When `true`, block any IP whose country cannot be resolved (including a missing/corrupt MaxMind DB). Private/reserved and allowlisted IPs are always allowed, so an internal/allowlisted operator can still recover. Default `false` preserves fail-open _(2026-07)_                                                                                                                                                                                                                  | `false`               |
| `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` | Gate for runtime country block/unblock via the API (`POST`/`DELETE /api/v1/ip-security/blocked-countries`). Off by default because the blocklist is a platform-edge control affecting every tenant — set it at deploy time via `BLOCKED_COUNTRIES`, or enable this to manage it at runtime _(2026-07)_                                                                                                                                                                                | `false`               |
| `AUDIT_ALLOW_CHAIN_REHASH`            | Break-glass gate for the audit-log rehash recovery operation, which rewrites the single cross-organization audit hash chain. Kept off so an ordinary admin cannot trigger it; a server operator enables it only for a one-time legacy-hash repair _(2026-07)_                                                                                                                                                                                                                         | `false`               |
| `SECURITY_REQUIRE_TLS`                | Promote **absent** `DB_SSL`/`REDIS_SSL` in production/staging from a boot **warning** to a **CRITICAL** finding, which the application refuses to start on. Without it, PHI, sessions and cached queries can cross the network in cleartext and nothing blocks the deployment _(2026-08-07)_                                                                                                                                                                                          | `false`               |

> **Turn `SECURITY_REQUIRE_TLS` on unless something else terminates TLS**
> _(2026-08-07)_. It defaults to `false` **only** so that upgrading cannot refuse
> to boot an existing deployment that terminates TLS elsewhere — a private VPC, a
> service mesh, a sidecar proxy. If your database and Redis traffic crosses any
> network the application does not control, this should be `true`. The decision is
> the deployment owner's, which is exactly why it is not made for you.
>
> The distinct **"TLS on but peer unverified"** case (`DB_SSL`/`REDIS_SSL` set
> with no CA, giving `CERT_NONE`) remains CRITICAL **regardless** of this flag,
> waivable only via `SECURITY_ALLOW_UNVERIFIED_TLS`. That configuration looks
> secure and is not, which is worse than honest plaintext.

> **`TRUSTED_PROXY_IPS` is security-critical** _(2026-05-29)_: forwarded
> `X-Forwarded-For` / `X-Real-IP` headers are only trusted when the direct peer
> is in this list. If left empty behind a proxy, all clients appear to share the
> proxy's IP. See [Security Configuration](Configuration-Security#client-ip-resolution--geoip-2026-05-29).

---

## OAuth Sign-In

_(2026-05-29)_ "Sign in with Google" and "Sign in with Microsoft" (Azure AD,
single-tenant). Each provider is fully disabled until its `*_ENABLED` flag is
`true` and all of its required fields are set — otherwise the
`/api/v1/auth/oauth/{provider}` routes return `404`. See
[Authentication > OAuth](Security-Authentication#oauth).

| Variable                   | Description                                                     | Default          |
| -------------------------- | --------------------------------------------------------------- | ---------------- |
| `GOOGLE_OAUTH_ENABLED`     | Enable "Sign in with Google"                                    | `false`          |
| `GOOGLE_CLIENT_ID`         | Google OAuth client ID                                          | —                |
| `GOOGLE_CLIENT_SECRET`     | Google OAuth client secret                                      | —                |
| `GOOGLE_REDIRECT_URI`      | Callback URL (`.../api/v1/auth/oauth/google/callback`)          | —                |
| `GOOGLE_ALLOWED_DOMAINS`   | Comma-separated email domain allowlist (empty = no restriction) | `""`             |
| `AZURE_AD_ENABLED`         | Enable "Sign in with Microsoft" (Azure AD)                      | `false`          |
| `AZURE_AD_TENANT_ID`       | Azure AD tenant GUID (single-tenant lock)                       | —                |
| `AZURE_AD_CLIENT_ID`       | Azure AD application (client) ID                                | —                |
| `AZURE_AD_CLIENT_SECRET`   | Azure AD client secret                                          | —                |
| `AZURE_AD_REDIRECT_URI`    | Callback URL (`.../api/v1/auth/oauth/microsoft/callback`)       | —                |
| `AZURE_AD_ALLOWED_DOMAINS` | Comma-separated email domain allowlist (empty = no restriction) | `""`             |
| `OAUTH_SUCCESS_REDIRECT`   | SPA landing page after successful sign-in                       | `/auth/callback` |
| `OAUTH_FAILURE_REDIRECT`   | Redirect (with `?error=<code>`) on sign-in failure              | `/login`         |

> **Link-existing-only:** OAuth never creates accounts. The verified IdP email
> must match an existing, active local user.

---

## File Storage

| Variable              | Description              | Default                |
| --------------------- | ------------------------ | ---------------------- |
| `UPLOAD_DIR`          | Upload directory path    | `/app/uploads`         |
| `MAX_UPLOAD_SIZE_MB`  | Maximum file upload size | `10`                   |
| `ALLOWED_IMAGE_TYPES` | Allowed image MIME types | `image/png,image/jpeg` |

---

## Logging & Observability

| Variable         | Description                                     | Default |
| ---------------- | ----------------------------------------------- | ------- |
| `LOG_LEVEL`      | Logging verbosity (DEBUG, INFO, WARNING, ERROR) | `INFO`  |
| `LOG_FORMAT`     | Log output format (`text` or `json`)            | `text`  |
| `SENTRY_ENABLED` | Enable Sentry error tracking                    | `false` |
| `SENTRY_DSN`     | Sentry Data Source Name URL                     | —       |

---

**See also:** [Installation Guide](Installation) | [Security Configuration](Configuration-Security) | [Module Configuration](Configuration-Modules)
