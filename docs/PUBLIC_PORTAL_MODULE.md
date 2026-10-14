# Public Portal Module - Architecture & Security Design

## Overview

The Public Portal module enables fire departments to expose selected data to a public-facing website. This module is designed with security as the top priority, as it creates a bridge between internal systems and the public internet.

## Use Cases

- Show upcoming public education events
- Display department statistics (member and apparatus counts)
- Show the department's description, logo and contact information

A personnel roster, training certifications and volunteer-hour figures are not
served: there are no endpoints for them, and the stats response returns
`total_volunteer_hours`, `total_calls_ytd` and `stations` as `null`.

## Architecture

### Components

#### 1. Public Portal Configuration (Admin UI)

Located in: `/frontend/src/modules/public-portal/`

Allows administrators to:

- Enable/disable the public portal
- Generate and manage API keys
- Configure what data is exposed (whitelist approach)
- Set rate limits per API key
- Monitor API usage and traffic

The config's `allowed_origins` and `cache_ttl_seconds` columns are stored but
not read by anything, so the admin screen offers no control for them. Browser
access to the API is governed by the server-wide `ALLOWED_ORIGINS` setting,
and the public API does not cache responses.

#### 2. Public Portal API (Backend)

Located in: `/backend/app/api/public/portal.py`

Read-only API endpoints that:

- Serve data to authorized public websites
- Enforce rate limiting per API key
- Log all access attempts
- Return only explicitly whitelisted data
- _(Planned, not built: response caching — the public API does not cache)_

#### 3. Database Models

Located in: `/backend/app/models/public_portal.py`

Tables:

- `public_portal_config` - Configuration and settings
- `public_portal_api_keys` - API keys for accessing public data
- `public_portal_access_log` - Audit log of all API access
- `public_portal_data_whitelist` - What data fields can be exposed

## Security Requirements

### 1. Authentication

- **API Key Authentication**: Every request must include a valid API key
- **No User Sessions**: Public API is completely stateless
- **Key Rotation**: API keys can be rotated/revoked at any time
- **Key Expiration**: Optional expiration dates for API keys

### 2. Rate Limiting

- **Per-key limit**: one hourly limit per API key — the key's
  `rate_limit_override`, or else the portal's `default_rate_limit` (default
  **1000** requests/hour). It covers every endpoint the key calls; there are no
  per-endpoint limits. A refusal is a 429 with `X-RateLimit-Limit`,
  `X-RateLimit-Remaining` and `X-RateLimit-Reset`, and is written to the access
  log.
- **Per-IP limit**: 100 requests/minute per client IP, checked before the key
  is looked up, so a flood of invalid keys cannot spend bcrypt time.
- Counters are shared through Redis when it is available and fall back to
  per-process memory otherwise. There is no exponential backoff or temporary
  block beyond the windows above.

### 3. Data Access Control

- **Whitelist-Only**: Only explicitly enabled data fields are returned
- **Read-Only**: No write operations allowed on public API
- **PII Protection**: Fields carrying personal information are marked and default to disabled; exposing one is an explicit, badged opt-in
- **Sanitization**: All data is sanitized before returning

### 4. Traffic Scrutiny

- **Request Logging**: Every request is logged with:
  - Timestamp
  - API key used
  - IP address
  - Endpoint accessed
  - Response status
  - Response time
- **Anomaly Detection**: `detect_anomalies` sets `flagged_suspicious` on the
  access-log row for:
  - more than 60 requests from one IP in a minute
  - more than 5 failed authentications from one IP in 5 minutes
  - more than 10 distinct endpoints from one IP in a minute
- **Alerting**: no message is sent. Flagged requests surface on the admin
  screen's **Statistics** tab, whose **Attention Required** banner reads the
  error rate, suspicious requests and rate-limit hits

### 5. Network Security

- **CORS**: the server-wide `ALLOWED_ORIGINS` setting; there is no per-portal origin list
- **HTTPS Only**: Enforce TLS 1.2+ for all connections
- **Request Validation**: Strict input validation
- **SQL Injection Prevention**: Use parameterized queries only
- **No Debug Info**: Never leak stack traces or internal errors

### 6. Caching Strategy

_Planned, not built._ The public API does not cache responses, and the
config's `cache_ttl_seconds` is not read.

### 7. Monitoring & Auditing

- **Access Logs**: Permanent audit trail of all access
- **Usage Dashboard**: Show request volume, popular endpoints
- **Security Events**: Track and alert on security issues
- **Compliance**: Logs retained for compliance requirements

## API Endpoints

### Public Endpoints (Read-Only)

Served from `backend/app/api/public/portal.py` under `/api/public/v1/`. Each
requires an `X-API-Key` header, the portal switched on (`config.enabled`) and
the Public Information module enabled, and returns only whitelisted fields.
All three share the key's single hourly limit (see
[Rate Limiting](#2-rate-limiting)).

```
GET /api/public/v1/organization/info
- Name, organization type, logo, description, phone, email, website,
  mailing and physical address — each subject to the whitelist

GET /api/public/v1/organization/stats
- total_members and apparatus counts; total_volunteer_hours,
  total_calls_ytd and stations are always null

GET /api/public/v1/events/public
- Upcoming, non-cancelled public education events
- limit (1–100, default 10) and offset
```

The same router also serves `GET /api/public/v1/application-status/{token}`,
`POST /api/public/v1/application-status/{token}/withdraw` (the prospective
member's status page, authenticated by the emailed token and limited per IP,
not by API key) and `GET /api/public/v1/health`.

### Admin Endpoints (Internal Only)

Served from `backend/app/api/v1/public_portal_admin.py`. **All of them require
`settings.manage`**, and the router sits behind `module_gate`, which checks that
the Public Information module is on. Queries are org-scoped.
`tests/test_public_portal_admin_permissions.py` pins all 13 handlers.

```
GET   /api/v1/public-portal/config
POST  /api/v1/public-portal/config
PATCH /api/v1/public-portal/config
- Read, create and update the portal configuration. The portal is switched
  on and off by setting `enabled` here; there is no separate enable/disable
  endpoint

GET    /api/v1/public-portal/api-keys
POST   /api/v1/public-portal/api-keys
PATCH  /api/v1/public-portal/api-keys/{key_id}
DELETE /api/v1/public-portal/api-keys/{key_id}
- List, generate, update and revoke API keys

GET   /api/v1/public-portal/whitelist
POST  /api/v1/public-portal/whitelist
PATCH /api/v1/public-portal/whitelist/{whitelist_id}
POST  /api/v1/public-portal/whitelist/bulk-update
- Choose which fields the public API may return

GET /api/v1/public-portal/access-logs
- View access logs (with filtering)

GET /api/v1/public-portal/usage-stats
- View API usage statistics
```

## Database Schema

### public_portal_config

```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- enabled: BOOLEAN
- allowed_origins: JSON (stored; not read — see above)
- default_rate_limit: INTEGER (requests per hour per key; default 1000)
- cache_ttl_seconds: INTEGER (stored; not read — see above)
- settings: JSON (additional settings)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

### public_portal_api_keys

```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- key_hash: VARCHAR(255) (bcrypt-hashed API key)
- key_prefix: VARCHAR(20) (selective lookup prefix: first 16 chars, "logbook_" + 8 key chars, so a lookup returns a single candidate; legacy 8-char "logbook_" prefixes self-heal on next use — migration 20260729_0001)
- name: VARCHAR(100) (friendly name)
- rate_limit_override: INTEGER (NULL for default)
- expires_at: TIMESTAMP (NULL for no expiration)
- last_used_at: TIMESTAMP
- is_active: BOOLEAN
- created_at: TIMESTAMP
- created_by: UUID (FK to users)
```

### public_portal_access_log

```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- api_key_id: UUID (FK, NULL if invalid key)
- ip_address: VARCHAR(45) (IPv4/IPv6)
- endpoint: VARCHAR(255)
- method: VARCHAR(10)
- status_code: INTEGER
- response_time_ms: INTEGER
- user_agent: TEXT
- timestamp: TIMESTAMP
- flagged_suspicious: BOOLEAN
```

### public_portal_data_whitelist

```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- data_category: VARCHAR(50) (e.g., 'organization', 'events', 'personnel')
- field_name: VARCHAR(100)
- is_enabled: BOOLEAN
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

### Which fields exist, and which are marked PII

The rows in `public_portal_data_whitelist` record one department's decisions.
What the fields _are_ — their descriptions, and whether a value identifies a
person — is held in code, in `backend/app/core/public_portal_fields.py`, and
served on the whitelist response as `description` and `is_sensitive`.

It is deliberately not a column. Whether `organization.email` identifies a
person is a property of the field and not of a configuration: making it
editable per organization would let an administrator clear the PII badge that
exists to give them pause, and a field added by a later release has to arrive
already classified rather than waiting for a data migration.

A field is marked sensitive when its value routinely belongs to a person
rather than to the organization — a volunteer department with no premises
publishes an officer's mobile, a personal inbox and somebody's home address.
Aggregate statistics and public-education event listings are not marked.
`backend/tests/test_public_portal_whitelist_catalogue.py` holds the catalogue
to the fields `api/public/portal.py` can actually serve, in both directions,
and asserts the classification by name.

`GET /api/v1/public-portal/whitelist` fills in any catalogue field the
organization has no row for, **disabled**. Nothing seeded the table before, so
the Data Exposure Control screen was empty on every installation. A disabled
row and a missing one are identical to `filter_data_by_whitelist`, so this
changes nothing about what the public API returns.

### Usage statistics _(2026-09-24)_

`GET /api/v1/public-portal/usage-stats` feeds the admin screen's **Statistics**
tab ("Traffic to the public API"). Until 2026-09-24 the tab read twenty-two
field names and the endpoint sent nine: the rest rendered as `0`, a
response-time tile printed `undefinedms`, and the **Attention Required** banner
— driven by error rate, suspicious requests and rate-limit hits, each coalesced
to 0 — could never appear. A dashboard that cannot report a problem looks
exactly like one with no problem to report.

What it reports now:

- **Rolling windows** — **Last 24 Hours** and **Last 7 Days** request counts,
  **Unique IPs (24h)**, and **Responses & Errors (last 24h)** — computed as
  rolling windows, alongside the calendar `requests_today` / `_this_week` /
  `_this_month` counts the endpoint already had.
- **Error rate** is `null` when no request arrived in 24 hours, and the tile
  shows "—" with _"No requests in 24h"_ rather than a reassuring 0.00%.
- **Rate-limit hits** have a producer. A 429 is raised by the
  `authenticate_api_key` dependency, which runs before the handler body that
  calls `log_access`, so no 429 row had ever been written; `_log_refusal` now
  commits one (best-effort — a logging failure never replaces the 429). The
  401 half (an unknown key, which cannot be attributed to an organization) is
  still unlogged — PUB-8 in `docs/security-review/PUB-03-public-surface-webhooks.md`.
- **Top Endpoints (last 7 days)** measures each endpoint against the week's
  total, not against the ten shown; the average response time is the all-time
  mean and is no longer shown under a "(24h)" heading.

No schema change or migration. `tests/test_public_portal_usage_stats.py`.

### Admin screen wording _(2026-09-29)_

The Configuration tab offers **Rate Limiting** only — the Allowed Origins and
Caching controls were removed, since nothing reads them (above). The disabled
banner names all three steps to publish anything: enable the portal, create an
API key, and turn on the fields to share under **Data Control**. The key dialog
is titled **API Key Created** (_"Copy this key now and store it somewhere safe.
This is the only time it is shown; you can't view it again."_), and revoking
asks with **Keep Key** as the cancel button. The access log's timing column is
**Response Time**.

## Implementation Status

**Built:**

- Database models for the config, API keys, access log and whitelist
- API key generation, bcrypt-hashed storage, expiry and revocation
- API-key authentication on the public endpoints (`authenticate_api_key`)
- The per-key hourly limit and the per-IP limit, with refusals logged
- Access logging and anomaly flagging
- The field whitelist and its PII catalogue
- The admin screen (`frontend/src/modules/public-portal/`): Configuration,
  API Keys, Access Logs, Statistics and Data Control tabs

**Not built:**

- The roster, training-certification and volunteer-hour endpoints
- Per-portal CORS (`allowed_origins` is stored, not read)
- Response caching (`cache_ttl_seconds` is stored, not read)
- Alerting on suspicious activity
- Exponential backoff or temporary IP blocks

## Security Considerations

### Threat Model

1. **DDoS Attacks**: Mitigated by the per-IP and per-key rate limits
2. **Data Scraping**: Mitigated by the per-key hourly limit and the whitelist
3. **API Key Theft**: Keys can be revoked instantly
4. **SQL Injection**: Prevented by parameterized queries
5. **XSS**: Not applicable (API-only, no HTML)
6. **CSRF**: Not applicable (stateless API)
7. **Unauthorized Access**: Prevented by API key requirement

### Best Practices

- Never expose PII without explicit opt-in
- Log everything for forensics
- Make revocation easy and instant
- Use principle of least privilege (whitelist)
- Regular security audits
- Monitor for anomalies 24/7
- Have incident response plan

## Integration Example

Example public website integration:

```javascript
// Public website code
const API_KEY = "your-api-key-here";
const BASE_URL = "https://your-logbook-instance.com/api/public/v1";

async function fetchOrgInfo() {
  const response = await fetch(`${BASE_URL}/organization/info`, {
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch organization info");
  }

  return response.json();
}

async function fetchPublicEvents() {
  const response = await fetch(`${BASE_URL}/events/public?limit=10`, {
    headers: {
      "X-API-Key": API_KEY,
    },
  });

  return response.json();
}
```

## Future Enhancements

- Webhook support for data updates
- GraphQL API option
- OAuth 2.0 support for advanced integrations
- Real-time data via WebSocket (with strict auth)
- Public dashboard embeds (iframe widgets)
- Analytics for public site traffic

## Success Metrics

- Zero security incidents
- < 100ms average response time
- 99.9% uptime
- Successful rate limit enforcement
- No PII leaks
- Positive user feedback
