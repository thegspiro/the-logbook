# Cal.com Integration

*(Added 2026-07-13)*

The Cal.com integration lets a department pull scheduled bookings and offer
self-scheduling links — an open-source [Calendly](https://cal.com) alternative.
It works with Cal.com Cloud (`cal.com`) or a self-hosted instance, and ties into
the membership pipeline so a booked interview can automatically advance a
prospective member's stage.

---

## Key Features

- **Connect & Test** — Store a Cal.com API key (encrypted) and verify it with a one-click connection test
- **Self-Hostable** — Point the integration at Cal.com Cloud or your own `https://<host>/api/v1`
- **View Bookings** — A **Bookings** panel on the Cal.com card lists upcoming bookings (title, attendee, time, status) pulled from the connected account
- **Pipeline Self-Scheduling Stage** — A **Meeting** pipeline stage can present a Cal.com booking link; applicants see a **Schedule** button on their public status page
- **Auto-Advance on Booking** — With a webhook secret configured, a new booking advances the matching prospect's stage automatically, correlated by the attendee's email
- **Secure Inbound Webhook** — Rate-limited, HMAC-verified, audit-logged receiver mirroring the Salesforce webhook

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations Hub (Cal.com card + Bookings panel) | `integrations.manage` |

Cal.com is configured from the **Integrations** page. The connect dialog collects
the API key, optional base URL, and an optional webhook secret, and displays the
inbound callback URL to paste into Cal.com.

---

## API Endpoints

### Authenticated (`/api/v1/`)

```
POST   /api/v1/integrations/{id}/connect            # Store key/base URL/webhook secret, enable
POST   /api/v1/integrations/{id}/disconnect         # Disconnect
PATCH  /api/v1/integrations/{id}                     # Update config
POST   /api/v1/integrations/{id}/test-connection     # Verify the API key
GET    /api/v1/integrations/calcom/bookings          # Upcoming bookings (mapped to event shape)
```

All require `integrations.manage`.

### Public Webhook

```
POST   /api/public/v1/webhooks/calcom/{integration_id}   # Booking-event receiver
```

Unauthenticated by design. Rate limited (30 requests/minute per IP) and verified
against the per-integration `webhook_secret` via an HMAC-SHA256 body signature in
the `X-Cal-Signature-256` header. An integration with **no** webhook secret
rejects all inbound payloads. Only `BOOKING_CREATED` events advance a stage;
other triggers are acknowledged and ignored.

---

## How Auto-Advance Works

1. A coordinator sets a **Meeting** stage's scheduling method to *Cal.com* and
   pastes the booking link.
2. The applicant books a time via that link using the email they applied with.
3. Cal.com posts a `BOOKING_CREATED` event to the callback URL.
4. The Logbook verifies the HMAC signature, then matches the attendee's email to
   an **active** prospect whose **current** stage is a Cal.com-backed meeting
   stage, and completes that stage — advancing the applicant.

Correlation is by attendee email; no live Cal.com API call is required to close
the loop.

---

## Configuration

Configuration is stored in the `integrations` table with
`integration_type = 'calcom'`. The `config` JSON column holds:

```json
{
  "api_base_url": "https://api.cal.com/v1"
}
```

Secret values (`api_key`, `webhook_secret`) are stored in the encrypted
`encrypted_config` column, never in plaintext `config`.

| Field | Description |
|-------|-------------|
| `api_key` | Cal.com API key (**Settings → Developer → API keys**). Sent as the `apiKey` query parameter. Encrypted. |
| `api_base_url` | Cloud default `https://api.cal.com/v1`; self-hosted uses `https://<host>/api/v1`. SSRF-validated. |
| `webhook_secret` | Optional signing secret enabling inbound webhook auto-advance. Encrypted. |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Webhook received with no secret configured | Rejected with 401 — the endpoint never trusts unverified payloads |
| Signature mismatch | Rejected with 401; logged |
| `BOOKING_CREATED` for an email with no matching active prospect | Acknowledged; no stage advanced (normal, non-error) |
| Matching prospect's current stage isn't a Cal.com meeting stage | Acknowledged; not advanced |
| Non-creation trigger (cancelled, rescheduled) | Acknowledged and ignored |
| Bookings fetch fails upstream | `GET /integrations/calcom/bookings` returns 502 with a sanitized error |
| Self-hosted base URL points at a private/internal address | Rejected at save time by SSRF URL validation |

---

## Permissions

| Permission | Required For |
|------------|-------------|
| `integrations.manage` | Connect/disconnect, configure, test connection, view bookings |
| `settings.manage` | Access the Integrations page |

---

## See Also

- [Prospective Members Pipeline](../docs/PROSPECTIVE_MEMBERS_MODULE.md)
- [Training: Integrations → Cal.com](../docs/training/16-integrations.md#calcom--interview-scheduling)
