# The Logbook Public API Documentation

Version 1.0.0

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

## Support

For API support:
- Contact your organization administrator
- Report issues to: [support link]
- API Status: Check `/health` endpoint

## Changelog

### Version 1.0.0 (2026-02-07)
- Initial release
- Organization info endpoint
- Organization stats endpoint
- Public events endpoint
- Health check endpoint
