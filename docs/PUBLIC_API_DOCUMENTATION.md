# The Logbook Public API Documentation

Version 1.2.0

## Introduction

The Logbook Public API provides read-only access to selected organization data for integration with public-facing websites. This API allows you to display information such as volunteer hours, public events, and organization details on your website.

**Base URL:** `https://your-logbook-instance.com/api/public/v1`

## Authentication

All API requests require authentication using an API key. Include your API key in the `X-API-Key` header:

```
X-API-Key: your-api-key-here
```

### Getting an API Key

Contact your organization's administrator to obtain an API key. API keys are managed through the Public Portal admin interface.

## Rate Limiting

- Default limit: **1000 requests per hour** per API key
- IP-based limit: **100 requests per minute** per IP address
- Rate limit headers are included in responses:
  - `X-RateLimit-Limit`: Your rate limit
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

When you exceed the rate limit, you'll receive a `429 Too Many Requests` response.

## Response Format

All responses are in JSON format with appropriate HTTP status codes.

### Success Response (200 OK)
```json
{
  "field1": "value1",
  "field2": "value2"
}
```

### Error Response (4xx, 5xx)
```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "details": {}
}
```

## Common Error Codes

| Status Code | Description |
|-------------|-------------|
| 401 | Invalid or missing API key |
| 403 | Portal disabled or insufficient permissions |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 503 | Public portal is disabled |

---

## Endpoints

### 1. Get Organization Information

Retrieve basic information about the organization.

**Endpoint:** `GET /organization/info`

**Rate Limit:** 100 requests/hour

**Example Request:**
```bash
curl -H "X-API-Key: your-api-key" \
  https://your-logbook-instance.com/api/public/v1/organization/info
```

**Example Response:**
```json
{
  "name": "Springfield Volunteer Fire Department",
  "organization_type": "fire_department",
  "logo": "https://...",
  "description": "Serving the Springfield community since 1920",
  "phone": "(555) 123-4567",
  "email": "contact@springfieldvfd.org",
  "website": "https://springfieldvfd.org",
  "mailing_address": {
    "line1": "123 Main Street",
    "city": "Springfield",
    "state": "IL",
    "zip_code": "62701",
    "country": "USA"
  }
}
```

**Notes:**
- Only whitelisted fields are returned
- Some fields may be null if not configured

---

### 2. Get Organization Statistics

Retrieve aggregate statistics about the organization.

**Endpoint:** `GET /organization/stats`

**Rate Limit:** 100 requests/hour

**Example Request:**
```bash
curl -H "X-API-Key: your-api-key" \
  https://your-logbook-instance.com/api/public/v1/organization/stats
```

**Example Response:**
```json
{
  "total_volunteer_hours": 12500,
  "total_calls_ytd": 342,
  "total_members": 45,
  "stations": 2,
  "apparatus": 8,
  "founded_year": 1920
}
```

**Notes:**
- Statistics are aggregated for privacy
- Only enabled fields are returned
- Some fields may be null if not available

---

### 3. Get Public Events

Retrieve upcoming public events (community events, open houses, etc.).

**Endpoint:** `GET /events/public`

**Rate Limit:** 200 requests/hour

**Query Parameters:**
- `limit` (integer, 1-100): Number of events to return (default: 10)
- `offset` (integer, ≥0): Pagination offset (default: 0)

**Example Request:**
```bash
curl -H "X-API-Key: your-api-key" \
  "https://your-logbook-instance.com/api/public/v1/events/public?limit=5"
```

**Example Response:**
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Community Open House",
    "description": "Join us for a tour of the fire station",
    "event_type": "community_event",
    "start_time": "2026-03-15T14:00:00Z",
    "end_time": "2026-03-15T17:00:00Z",
    "location": "Station 1",
    "is_public": true
  }
]
```

**Notes:**
- Only events marked as public are returned
- Events are ordered by start_time (ascending)
- Use pagination for large result sets

---

### 4. Health Check

Check if the public API is operational.

**Endpoint:** `GET /health`

**Authentication:** Not required

**Example Request:**
```bash
curl https://your-logbook-instance.com/api/public/v1/health
```

**Example Response:**
```json
{
  "status": "healthy",
  "service": "public-portal-api",
  "version": "1.0.0",
  "timestamp": "2026-02-07T20:00:00Z"
}
```

---

### 5. Get Public Form

Retrieve a public form by its URL slug. Returns the form definition with all fields for rendering.

**Endpoint:** `GET /forms/{slug}`

**Authentication:** Not required

**Rate Limit:** 60 requests/minute per IP

**Example Request:**
```bash
curl https://your-logbook-instance.com/api/public/v1/forms/a1b2c3d4e5f6
```

**Example Response:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "Membership Interest Form",
  "description": "Interested in joining? Fill out this form and we'll be in touch.",
  "category": "membership",
  "allow_multiple_submissions": true,
  "organization_name": "Springfield Volunteer Fire Department",
  "fields": [
    {
      "id": "field-uuid-1",
      "label": "Full Name",
      "field_type": "text",
      "placeholder": "Your full name",
      "required": true,
      "min_length": 2,
      "max_length": 100,
      "sort_order": 0,
      "width": "full"
    },
    {
      "id": "field-uuid-2",
      "label": "Email Address",
      "field_type": "email",
      "placeholder": "your@email.com",
      "required": true,
      "sort_order": 1,
      "width": "half"
    },
    {
      "id": "field-uuid-3",
      "label": "Experience Level",
      "field_type": "select",
      "required": true,
      "options": [
        { "value": "none", "label": "No experience" },
        { "value": "some", "label": "Some training" },
        { "value": "experienced", "label": "Active/former firefighter" }
      ],
      "sort_order": 2,
      "width": "full"
    }
  ]
}
```

**Notes:**
- Only published forms with `is_public = true` are accessible
- `member_lookup` field types are excluded from public responses
- Slugs are 12-character hex strings (e.g., `a1b2c3d4e5f6`)
- Returns 404 if the form is not found, not published, or not public

---

### 6. Submit Public Form

Submit data to a public form. No authentication required.

**Endpoint:** `POST /forms/{slug}/submit`

**Authentication:** Not required

**Rate Limit:** 10 submissions/minute per IP (10-minute lockout if exceeded)

**Request Body:**
```json
{
  "data": {
    "field-uuid-1": "John Smith",
    "field-uuid-2": "john@example.com",
    "field-uuid-3": "some"
  },
  "submitter_name": "John Smith",
  "submitter_email": "john@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | Key-value pairs of field ID to submitted value |
| `submitter_name` | string | No | Name of the person submitting (max 255 chars) |
| `submitter_email` | string | No | Email of the person submitting (max 255 chars) |

**Example Request:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"data": {"field-uuid-1": "John Smith", "field-uuid-2": "john@example.com"}, "submitter_name": "John Smith"}' \
  https://your-logbook-instance.com/api/public/v1/forms/a1b2c3d4e5f6/submit
```

**Example Response (201 Created):**
```json
{
  "id": "submission-uuid",
  "form_name": "Membership Interest Form",
  "submitted_at": "2026-02-12T15:30:00Z",
  "message": "Thank you for your submission!"
}
```

**Security Notes:**
- All submitted values are HTML-escaped and sanitized before storage
- Required field validation is enforced server-side
- Email fields are validated for format and header injection
- Select/radio/checkbox values are validated against allowed options
- A honeypot field is used for bot detection (see [Security](#security-notes) below)
- IP address and user agent are captured for audit purposes

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Validation error (missing required field, invalid format) |
| 404 | Form not found or not available |
| 429 | Rate limit exceeded (try again in 10 minutes) |

---

### Security Notes

#### Public Form Protection

Public form endpoints include multiple layers of protection:

1. **Rate Limiting**: Separate rate limits for viewing (60/min) and submitting (10/min) per IP address, with automatic lockout periods
2. **Input Sanitization**: All submitted data is HTML-escaped, null bytes removed, and length-limited per field type
3. **Type Validation**: Server-side validation of email formats, phone numbers, numeric ranges, and allowed options for select/radio/checkbox fields
4. **Honeypot Detection**: A hidden `website` field is included in the form. Bots that fill it in are silently rejected with a fake success response
5. **Slug Validation**: Form slugs are validated against a strict 12-character hex pattern before any database query

---

## Integration Examples

### JavaScript / Fetch API

```javascript
const API_KEY = 'your-api-key-here';
const BASE_URL = 'https://your-logbook-instance.com/api/public/v1';

async function getOrganizationInfo() {
  try {
    const response = await fetch(`${BASE_URL}/organization/info`, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching organization info:', error);
    throw error;
  }
}

// Usage
getOrganizationInfo()
  .then(org => {
    console.log('Organization:', org.name);
    document.getElementById('org-name').textContent = org.name;
  })
  .catch(err => console.error(err));
```

### React Example

```jsx
import { useState, useEffect } from 'react';

const API_KEY = 'your-api-key-here';
const BASE_URL = 'https://your-logbook-instance.com/api/public/v1';

function OrganizationInfo() {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${BASE_URL}/organization/info`, {
      headers: {
        'X-API-Key': API_KEY
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(data => {
        setOrg(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h1>{org.name}</h1>
      <p>{org.description}</p>
      {org.logo && <img src={org.logo} alt={org.name} />}
      <p>Phone: {org.phone}</p>
      <p>Email: {org.email}</p>
    </div>
  );
}
```

### Python Example

```python
import requests

API_KEY = 'your-api-key-here'
BASE_URL = 'https://your-logbook-instance.com/api/public/v1'

def get_organization_info():
    headers = {
        'X-API-Key': API_KEY
    }

    response = requests.get(
        f'{BASE_URL}/organization/info',
        headers=headers
    )

    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f'API error: {response.status_code}')

# Usage
try:
    org = get_organization_info()
    print(f"Organization: {org['name']}")
    print(f"Type: {org['organization_type']}")
except Exception as e:
    print(f"Error: {e}")
```

### PHP Example

```php
<?php

$apiKey = 'your-api-key-here';
$baseUrl = 'https://your-logbook-instance.com/api/public/v1';

function getOrganizationInfo($apiKey, $baseUrl) {
    $options = [
        'http' => [
            'header' => "X-API-Key: $apiKey\r\n"
        ]
    ];

    $context = stream_context_create($options);
    $response = file_get_contents("$baseUrl/organization/info", false, $context);

    if ($response === FALSE) {
        throw new Exception('Failed to fetch organization info');
    }

    return json_decode($response, true);
}

// Usage
try {
    $org = getOrganizationInfo($apiKey, $baseUrl);
    echo "Organization: " . $org['name'] . "\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
?>
```

---

## Best Practices

### 1. Cache Responses
Cache API responses on your server to reduce requests and improve performance:
```javascript
// Cache for 5 minutes
const CACHE_TTL = 5 * 60 * 1000;
let cache = { data: null, timestamp: 0 };

async function getCachedOrgInfo() {
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
    return cache.data;
  }

  const data = await getOrganizationInfo();
  cache = { data, timestamp: now };
  return data;
}
```

### 2. Handle Rate Limits
Implement exponential backoff for rate limit errors:
```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || 60;
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    return response;
  }
  throw new Error('Max retries exceeded');
}
```

### 3. Error Handling
Always handle errors gracefully:
```javascript
async function safeAPICall() {
  try {
    return await getOrganizationInfo();
  } catch (error) {
    if (error.response?.status === 503) {
      return { message: 'Portal temporarily unavailable' };
    }
    // Fallback data or error message
    return null;
  }
}
```

### 4. Security
- Never expose your API key in client-side code
- Make API calls from your server, not directly from browsers
- Use environment variables to store API keys

```javascript
// ❌ BAD - API key exposed in browser
const API_KEY = 'logbook_abc123...';

// ✅ GOOD - API call from server
// server.js
app.get('/api/org-info', async (req, res) => {
  const data = await getOrganizationInfo(process.env.LOGBOOK_API_KEY);
  res.json(data);
});
```

---

## Location Kiosk Display Endpoint

The display endpoint is a special public endpoint designed for tablets left in rooms. Unlike the other public API endpoints above, it does **not** require an API key — it uses a non-guessable display code instead.

**Base URL:** `https://your-logbook-instance.com/api/public/v1/display`

### Get Location Display

Retrieve current event information for a location kiosk display.

**Endpoint:** `GET /display/{display_code}`

**Authentication:** None required. The display code itself serves as the access token.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `display_code` | string (path) | 8-character alphanumeric display code assigned to the location |

**Example Request:**
```bash
curl https://your-logbook-instance.com/api/public/v1/display/x7k9m2p3
```

**Example Response (active event):**
```json
{
  "location_id": "uuid-string",
  "location_name": "Station 1 — Training Room A",
  "current_events": [
    {
      "event_id": "uuid-string",
      "event_name": "Monthly Business Meeting",
      "event_type": "meeting",
      "start_datetime": "2026-02-18T19:00:00",
      "end_datetime": "2026-02-18T21:00:00",
      "check_in_start": "2026-02-18T18:00:00",
      "check_in_end": "2026-02-18T21:00:00",
      "is_valid": true,
      "location_name": "Station 1 — Training Room A",
      "require_checkout": false
    }
  ],
  "has_overlap": false
}
```

**Example Response (no active events):**
```json
{
  "location_id": "uuid-string",
  "location_name": "Station 1 — Training Room A",
  "current_events": [],
  "has_overlap": false
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 404 | Display code not found or location inactive |

**Notes:**
- Events appear in `current_events` when they are within the check-in window (1 hour before start until event end)
- Event descriptions are intentionally excluded from the public response
- The frontend kiosk page at `/display/{code}` polls this endpoint every 30 seconds
- Display codes are generated automatically when locations are created and can be found on the Locations management page

**Finding Display Codes:**
- Navigate to **Locations** (or **Facilities**) in the admin interface
- Each room card shows its display code and kiosk URL
- Click the URL to copy it to clipboard, then bookmark it on the room's tablet

---

## Support

For API support:
- Contact your organization administrator
- Report issues to: [support link]
- API Status: Check `/health` endpoint

## Changelog

### Version 1.2.0 (2026-02-18)
- Added location kiosk display endpoint (`GET /display/{code}`) — no API key required
- Returns current events with QR check-in data for tablet displays in rooms
- Display codes auto-generated for all locations (8-char, non-guessable)

### Version 1.1.0 (2026-02-12)
- Added public form retrieval endpoint (`GET /forms/{slug}`)
- Added public form submission endpoint (`POST /forms/{slug}/submit`)
- Rate limiting for public form endpoints (60 views/min, 10 submits/min per IP)
- Honeypot bot detection for form submissions
- Input sanitization and type validation on all submitted data

### Version 1.0.0 (2026-02-07)
- Initial release
- Organization info endpoint
- Organization stats endpoint
- Public events endpoint
- Health check endpoint
