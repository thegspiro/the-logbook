# Documenso Integration

*(Added 2026-07-13)*

The Documenso integration lets a department send documents out for electronic
signature — an open-source [DocuSign](https://documenso.com) alternative. It
works with Documenso Cloud (`app.documenso.com`) or a self-hosted instance, and
ties into the membership pipeline so a signed document can automatically advance
a prospective member's stage.

---

## Key Features

- **Connect & Test** — Store a Documenso API token (encrypted) and verify it with a one-click connection test
- **Self-Hostable** — Point the integration at Documenso Cloud or your own `https://<host>/api/v1`
- **Pipeline E-Signature Stage** — A **Document Upload** pipeline stage can collect a signature via Documenso instead of a file upload; applicants see a "Documents sent for signature" note on their public status page
- **Auto-Advance on Completion** — With a webhook secret configured, a completed signature advances the matching prospect's stage automatically, correlated by the signer's email
- **Secure Inbound Webhook** — Rate-limited, secret/signature-verified, audit-logged receiver mirroring the Salesforce webhook

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations Hub (Documenso card) | `integrations.manage` |

Documenso is configured from the **Integrations** page. The connect dialog
collects the API token, optional base URL, and an optional webhook secret, and
displays the inbound callback URL to paste into Documenso.

---

## API Endpoints

### Authenticated (`/api/v1/`)

```
POST   /api/v1/integrations/{id}/connect            # Store token/base URL/webhook secret, enable
POST   /api/v1/integrations/{id}/disconnect         # Disconnect
PATCH  /api/v1/integrations/{id}                     # Update config
POST   /api/v1/integrations/{id}/test-connection     # Verify the API token
```

All require `integrations.manage`.

### Public Webhook

```
POST   /api/public/v1/webhooks/documenso/{integration_id}   # Signing-event receiver
```

Unauthenticated by design. Rate limited (30 requests/minute per IP) and
verified against the per-integration `webhook_secret` — either a shared-secret
header (`X-Documenso-Secret`) or an HMAC-SHA256 body signature
(`X-Documenso-Signature`). An integration with **no** webhook secret rejects all
inbound payloads. Only `DOCUMENT_COMPLETED` events advance a stage; other events
are acknowledged and ignored.

---

## How Auto-Advance Works

1. A coordinator sets a **Document Upload** stage's collection method to
   *Documenso e-signature* and (optionally) enters a template ID.
2. The applicant signs their document in Documenso using the email they applied
   with.
3. Documenso posts a `DOCUMENT_COMPLETED` event to the callback URL.
4. The Logbook verifies the secret/signature, then matches the signer's email to
   an **active** prospect whose **current** stage is a Documenso-backed document
   stage, and completes that stage — advancing the applicant.

No live Documenso API call is required to close the loop; correlation is by
recipient email.

---

## Configuration

Configuration is stored in the `integrations` table with
`integration_type = 'documenso'`. The `config` JSON column holds:

```json
{
  "api_base_url": "https://app.documenso.com/api/v1"
}
```

Secret values (`api_token`, `webhook_secret`) are stored in the encrypted
`encrypted_config` column, never in plaintext `config`.

| Field | Description |
|-------|-------------|
| `api_token` | Documenso API token (**Settings → API**). Sent in the `Authorization` header. Encrypted. |
| `api_base_url` | Cloud default `https://app.documenso.com/api/v1`; self-hosted uses `https://<host>/api/v1`. SSRF-validated. |
| `webhook_secret` | Optional shared secret enabling inbound webhook auto-advance. Encrypted. |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Webhook received with no secret configured | Rejected with 401 — the endpoint never trusts unverified payloads |
| Signature/secret mismatch | Rejected with 401; logged |
| `DOCUMENT_COMPLETED` for an email with no matching active prospect | Acknowledged; no stage advanced (normal, non-error) |
| Matching prospect's current stage isn't a Documenso document stage | Acknowledged; not advanced |
| Non-completion event (opened, sent, rejected) | Acknowledged and ignored |
| Self-hosted base URL points at a private/internal address | Rejected at save time by SSRF URL validation |

---

## Permissions

| Permission | Required For |
|------------|-------------|
| `integrations.manage` | Connect/disconnect, configure, test connection |
| `settings.manage` | Access the Integrations page |

---

## See Also

- [Prospective Members Pipeline](../docs/PROSPECTIVE_MEMBERS_MODULE.md)
- [Training: Integrations → Documenso](../docs/training/16-integrations.md#documenso--document-e-signatures)
