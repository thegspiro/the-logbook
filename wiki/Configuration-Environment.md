# Environment Variables

Complete reference for all `.env` configuration variables in The Logbook.

---

## Required Variables

These must be set before the application will start in production mode.

| Variable | Description | Example |
|----------|-------------|---------|
| `SECRET_KEY` | Application secret key (min 32 chars) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | AES-256 encryption key (64 hex chars) | `openssl rand -hex 32` |
| `ENCRYPTION_SALT` | Encryption salt (32 hex chars) | `openssl rand -hex 16` |
| `DB_PASSWORD` | MySQL database password | Strong random password |
| `REDIS_PASSWORD` | Redis cache password | Strong random password |
| `ALLOWED_ORIGINS` | CORS allowed origins (JSON array) | `["http://localhost:3000"]` |

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

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Runtime environment | `development` |
| `DEBUG` | Enable debug mode | `false` |
| `TZ` | Timezone | `America/New_York` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |

---

## Port Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FRONTEND_PORT` | Frontend HTTP port | `3000` (Unraid: `7880`) |
| `BACKEND_PORT` | Backend API port | `3001` (Unraid: `7881`) |

### Ports by Deployment Type

| Deployment | Frontend | Backend |
|-----------|----------|---------|
| Docker Compose | 3000 | 3001 |
| Unraid | 7880 | 7881 |
| Native Dev | 5173 (Vite) | 3001 |
| Production (Nginx) | 443 (HTTPS) | 443 (HTTPS) |

---

## Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database hostname | `mysql` |
| `DB_PORT` | Database port | `3306` |
| `DB_NAME` | Database name | `the_logbook` |
| `DB_USER` | Database user | `logbook_user` |
| `DB_PASSWORD` | Database password | (required) |
| `MYSQL_ROOT_PASSWORD` | MySQL root password | (required for init) |

> **Important:** The DB_HOST must match the Docker service name. In docker-compose.yml, the service is named `mysql`, not `db`.

---

## Redis

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_HOST` | Redis hostname | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | (required in production) |

---

## Email / SMTP

| Variable | Description | Default |
|----------|-------------|---------|
| `EMAIL_ENABLED` | Enable email sending (SMTP) | `false` |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASSWORD` | SMTP password | — |
| `SMTP_FROM_EMAIL` | Sender email address | — |
| `SMTP_FROM_NAME` | Sender display name | `The Logbook` |
| `SMTP_ENCRYPTION` | Encryption mode: `tls`, `ssl`, or `none` | `tls` |
| `SMTP_EHLO_HOSTNAME` | Explicit EHLO hostname (must resolve in DNS) | domain of `SMTP_FROM_EMAIL` |

### Cloudflare Email Service (Alternative to SMTP)

Use these variables instead of the SMTP variables above to send email via Cloudflare's REST API. Requires your domain's DNS to be managed by Cloudflare. Cloudflare handles SPF/DKIM/DMARC automatically.

| Variable | Description | Default |
|----------|-------------|---------|
| `CLOUDFLARE_EMAIL_ENABLED` | Enable Cloudflare Email Service | `false` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (32-char hex, from dashboard sidebar) | — |
| `CLOUDFLARE_API_TOKEN` | API token with email sending permission | — |

> **Note:** Set either SMTP variables or Cloudflare variables — not both. If both are configured, org-level settings take priority, then Cloudflare, then SMTP. The `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` variables are still used for the sender address when Cloudflare is the active backend at the global level.

---

## Frontend (Build-Time)

These variables are baked into the frontend at build time via Vite.

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | API base URL | `/api/v1` |
| `VITE_WS_URL` | WebSocket URL | `ws://localhost:3001` |
| `VITE_ENV` | Frontend environment | `production` |
| `VITE_ENABLE_PWA` | Enable PWA features | `true` |
| `VITE_ENABLE_ANALYTICS` | Enable analytics | `false` |

> **Critical:** Vite replaces `import.meta.env.VITE_*` at build time. Changing these after build has no effect — you must rebuild the frontend.

---

## Module Toggles

| Variable | Description | Default |
|----------|-------------|---------|
| `MODULE_TRAINING_ENABLED` | Training module | `true` |
| `MODULE_COMPLIANCE_ENABLED` | Compliance module | `true` |
| `MODULE_SCHEDULING_ENABLED` | Scheduling module | `true` |
| `MODULE_ELECTIONS_ENABLED` | Elections module | `true` |
| `MODULE_EVENTS_ENABLED` | Events module | `true` |
| `MODULE_INVENTORY_ENABLED` | Inventory module | `true` |
| `MODULE_FACILITIES_ENABLED` | Facilities module | `false` |
| `MODULE_APPARATUS_ENABLED` | Apparatus module | `false` |
| `MODULE_ADMIN_HOURS_ENABLED` | Admin hours tracking module | `false` |

---

## Security

| Variable | Description | Default |
|----------|-------------|---------|
| `SESSION_TIMEOUT_MINUTES` | Inactivity timeout | `30` |
| `MAX_LOGIN_ATTEMPTS` | Attempts before lockout | `5` |
| `LOCKOUT_DURATION_MINUTES` | Lockout duration | `30` |
| `PASSWORD_MIN_LENGTH` | Minimum password length | `12` |
| `JWT_ACCESS_TOKEN_EXPIRE` | Access token lifetime (hours) | `8` |
| `JWT_REFRESH_TOKEN_EXPIRE` | Refresh token lifetime (days) | `7` |
| `RATE_LIMIT_PER_MINUTE` | API rate limit | `60` |
| `IP_LOGGING_ENABLED` | Log client IPs for security monitoring | `true` |
| `TRUSTED_PROXY_IPS` | Comma-separated proxy IPs whose forwarded headers are trusted. **Critical when running behind a reverse proxy** *(2026-05-29)* | `""` |
| `GEOIP_ENABLED` | Enable GeoIP country-based access control | `false` |
| `GEOIP_DATABASE_PATH` | Path to the MaxMind GeoLite2 country database | — |
| `BLOCKED_COUNTRIES` | Comma-separated ISO country codes to block (config default; DB `CountryBlockRule` rows override) *(2026-05-29)* | `""` |

> **`TRUSTED_PROXY_IPS` is security-critical** *(2026-05-29)*: forwarded
> `X-Forwarded-For` / `X-Real-IP` headers are only trusted when the direct peer
> is in this list. If left empty behind a proxy, all clients appear to share the
> proxy's IP. See [Security Configuration](Configuration-Security#client-ip-resolution--geoip-2026-05-29).

---

## OAuth Sign-In

*(2026-05-29)* "Sign in with Google" and "Sign in with Microsoft" (Azure AD,
single-tenant). Each provider is fully disabled until its `*_ENABLED` flag is
`true` and all of its required fields are set — otherwise the
`/api/v1/auth/oauth/{provider}` routes return `404`. See
[Authentication > OAuth](Security-Authentication#oauth).

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_OAUTH_ENABLED` | Enable "Sign in with Google" | `false` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `GOOGLE_REDIRECT_URI` | Callback URL (`.../api/v1/auth/oauth/google/callback`) | — |
| `GOOGLE_ALLOWED_DOMAINS` | Comma-separated email domain allowlist (empty = no restriction) | `""` |
| `AZURE_AD_ENABLED` | Enable "Sign in with Microsoft" (Azure AD) | `false` |
| `AZURE_AD_TENANT_ID` | Azure AD tenant GUID (single-tenant lock) | — |
| `AZURE_AD_CLIENT_ID` | Azure AD application (client) ID | — |
| `AZURE_AD_CLIENT_SECRET` | Azure AD client secret | — |
| `AZURE_AD_REDIRECT_URI` | Callback URL (`.../api/v1/auth/oauth/microsoft/callback`) | — |
| `AZURE_AD_ALLOWED_DOMAINS` | Comma-separated email domain allowlist (empty = no restriction) | `""` |
| `OAUTH_SUCCESS_REDIRECT` | SPA landing page after successful sign-in | `/auth/callback` |
| `OAUTH_FAILURE_REDIRECT` | Redirect (with `?error=<code>`) on sign-in failure | `/login` |

> **Link-existing-only:** OAuth never creates accounts. The verified IdP email
> must match an existing, active local user.

---

## File Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `UPLOAD_DIR` | Upload directory path | `/app/uploads` |
| `MAX_UPLOAD_SIZE_MB` | Maximum file upload size | `10` |
| `ALLOWED_IMAGE_TYPES` | Allowed image MIME types | `image/png,image/jpeg` |

---

## Logging & Observability

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity (DEBUG, INFO, WARNING, ERROR) | `INFO` |
| `LOG_FORMAT` | Log output format (`text` or `json`) | `text` |
| `SENTRY_ENABLED` | Enable Sentry error tracking | `false` |
| `SENTRY_DSN` | Sentry Data Source Name URL | — |

---

**See also:** [Installation Guide](Installation) | [Security Configuration](Configuration-Security) | [Module Configuration](Configuration-Modules)
