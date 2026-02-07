# Public Portal Module - Architecture & Security Design

## Overview
The Public Portal module enables fire departments to expose selected data to a public-facing website. This module is designed with security as the top priority, as it creates a bridge between internal systems and the public internet.

## Use Cases
- Display volunteer hours contributed
- Show upcoming public events (community events, open houses)
- Display department statistics (calls responded to, stations, apparatus)
- Show department history, mission statement, and contact information
- Display current personnel roster (with privacy controls)
- Show training certifications available

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
- Configure allowed origins (CORS)
- Set cache TTL for different data types

#### 2. Public Portal API (Backend)
Located in: `/backend/app/api/public/portal.py`

Read-only API endpoints that:
- Serve data to authorized public websites
- Enforce rate limiting per API key
- Log all access attempts
- Return only explicitly whitelisted data
- Use aggressive caching

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
- **Global Limit**: 1000 requests/hour per API key (configurable)
- **Per-Endpoint Limit**: Stricter limits on expensive queries
- **IP-based Limit**: Secondary limit per IP address (100 req/min)
- **Exponential Backoff**: Temporary blocks for repeated violations

### 3. Data Access Control
- **Whitelist-Only**: Only explicitly enabled data fields are returned
- **Read-Only**: No write operations allowed on public API
- **PII Protection**: Personal information is never exposed
- **Sanitization**: All data is sanitized before returning

### 4. Traffic Scrutiny
- **Request Logging**: Every request is logged with:
  - Timestamp
  - API key used
  - IP address
  - Endpoint accessed
  - Response status
  - Response time
- **Anomaly Detection**: Flag suspicious patterns:
  - Rapid requests from single IP
  - Failed authentication attempts
  - Unusual access patterns
- **Alerting**: Notify admins of suspicious activity

### 5. Network Security
- **CORS**: Strict CORS policy (only allowed origins)
- **HTTPS Only**: Enforce TLS 1.2+ for all connections
- **Request Validation**: Strict input validation
- **SQL Injection Prevention**: Use parameterized queries only
- **No Debug Info**: Never leak stack traces or internal errors

### 6. Caching Strategy
- **Aggressive Caching**: Cache responses for 5-60 minutes
- **CDN-Friendly**: Support Cache-Control headers
- **Cache Invalidation**: Manual cache clearing when data changes
- **Reduces Load**: Prevents database hammering

### 7. Monitoring & Auditing
- **Access Logs**: Permanent audit trail of all access
- **Usage Dashboard**: Show request volume, popular endpoints
- **Security Events**: Track and alert on security issues
- **Compliance**: Logs retained for compliance requirements

## API Endpoints

All endpoints under `/api/public/v1/`

### Public Endpoints (Read-Only)

```
GET /api/public/v1/organization/info
- Returns basic org info (name, type, logo, description, public contact)
- Rate limit: 100/hour per key

GET /api/public/v1/organization/stats
- Returns public statistics (volunteer hours, calls, etc.)
- Rate limit: 100/hour per key

GET /api/public/v1/events/public
- Returns public events only (community events, open houses)
- Rate limit: 200/hour per key
- Pagination required

GET /api/public/v1/personnel/public-roster
- Returns public personnel list (if enabled)
- Only shows: name, rank, years of service
- PII excluded: contact info, DOB, address, etc.
- Rate limit: 50/hour per key

GET /api/public/v1/training/certifications
- Returns available training certifications
- Rate limit: 100/hour per key

GET /api/public/v1/stats/volunteer-hours
- Returns aggregate volunteer hours
- Grouped by month/year
- Rate limit: 100/hour per key
```

### Admin Endpoints (Internal Only)

```
POST /api/v1/public-portal/enable
- Enable public portal

POST /api/v1/public-portal/disable
- Disable public portal

POST /api/v1/public-portal/api-keys
- Generate new API key

DELETE /api/v1/public-portal/api-keys/{key_id}
- Revoke API key

GET /api/v1/public-portal/access-logs
- View access logs (with filtering)

PATCH /api/v1/public-portal/config
- Update portal configuration

GET /api/v1/public-portal/usage-stats
- View API usage statistics
```

## Database Schema

### public_portal_config
```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- enabled: BOOLEAN
- allowed_origins: JSON (list of allowed CORS origins)
- default_rate_limit: INTEGER (requests per hour)
- cache_ttl_seconds: INTEGER
- settings: JSON (additional settings)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

### public_portal_api_keys
```sql
- id: UUID (PK)
- organization_id: UUID (FK)
- key_hash: VARCHAR(255) (hashed API key)
- key_prefix: VARCHAR(8) (first 8 chars for identification)
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

## Implementation Phases

### Phase 1: Backend Foundation
1. Create database models
2. Create API key generation and management
3. Implement authentication middleware
4. Create basic public API endpoints
5. Add request logging

### Phase 2: Security Layer
1. Implement rate limiting
2. Add IP-based limits
3. Create anomaly detection
4. Add alerting system
5. Implement CORS controls

### Phase 3: Frontend Admin UI
1. Create module configuration page
2. Build API key management interface
3. Create access log viewer
4. Add usage statistics dashboard
5. Build data whitelist configurator

### Phase 4: Testing & Documentation
1. Security testing (penetration testing)
2. Load testing (rate limit validation)
3. Create public API documentation
4. Create integration examples
5. Admin user guide

## Security Considerations

### Threat Model
1. **DDoS Attacks**: Mitigated by rate limiting and IP blocking
2. **Data Scraping**: Mitigated by aggressive rate limits
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
const API_KEY = 'your-api-key-here';
const BASE_URL = 'https://your-logbook-instance.com/api/public/v1';

async function fetchOrgInfo() {
  const response = await fetch(`${BASE_URL}/organization/info`, {
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch organization info');
  }

  return response.json();
}

async function fetchPublicEvents() {
  const response = await fetch(`${BASE_URL}/events/public?limit=10`, {
    headers: {
      'X-API-Key': API_KEY
    }
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

---

**Status**: Design Complete - Ready for Implementation
**Author**: Claude AI Assistant
**Date**: 2026-02-07
**Version**: 1.0
