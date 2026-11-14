# Zeffy Integration

_(Added 2026-11-01; Settings button 2026-11-13)_

[Zeffy](https://www.zeffy.com) is a zero-fee fundraising platform for US and
Canadian nonprofits: donation forms, event ticketing and membership sales. The
department keeps selling through Zeffy, and Zeffy keeps issuing the tax
receipts. The Logbook **reads** what Zeffy received and records each payment
where the department keeps its own books. Nothing is ever written to Zeffy, and
no card details reach The Logbook.

The full operator reference is
[`docs/ZEFFY_INTEGRATION.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/ZEFFY_INTEGRATION.md).

---

## Key Features

- **Three kinds of record.** A Zeffy campaign is linked to a fundraising
  campaign (each payment becomes a **donation**), a fundraising event (each
  payment adds to **revenue**, and each ticket to **attendance**) or a dues
  schedule (each payment is credited to the paying member's oldest open
  **dues**, matched by email).
- **Webhook and hourly sync.** With the signed webhook, payments and refunds
  arrive within seconds. The hourly sync records anything the webhook missed.
- **One payment, one effect.** A payment is recorded once however many times
  the webhook and the sync report it. A later change, such as a refund, applies
  only the difference.
- **Refunds followed.** A donation is lowered or marked refunded, and event
  revenue is taken back. A refunded dues payment is left for the treasurer and
  marked **Needs review**.
- **Settings on a connected card.** The API key and signing secret can be
  changed without disconnecting. A box left blank keeps what is saved.

---

## Pages

| URL             | Page                                                                 | Permission            |
| --------------- | -------------------------------------------------------------------- | --------------------- |
| `/integrations` | Integrations Hub: the Zeffy card, its **Connect** and **Settings**   | `integrations.manage` |
| `/grants/zeffy` | **Grants & Fundraising → Zeffy**: connection, campaigns and payments | `fundraising.view`    |

Linking, unlinking and **Sync now** on `/grants/zeffy` need
`fundraising.manage`. A link to a dues schedule also needs `finance.manage`
**and** `finance.view`.

---

## Setting It Up

1. **Generate the API key in Zeffy.** The Zeffy organization owner opens
   **Settings → Integrations** in Zeffy.
2. **Connect it.** On **Integrations → Zeffy → Connect**, paste the key and
   save. **Test** reads one campaign to prove it works.
3. **Add the webhook (recommended).** Copy the address shown in the connect
   window into Zeffy's **Settings → Integrations → Webhook**, subscribe it to
   `payment.created`, `payment.completed`, `payment.updated` and
   `payment.deleted`, and paste the `whsec_` signing secret Zeffy shows into
   **Webhook Signing Secret**.
4. **Link each campaign** on **Grants & Fundraising → Zeffy**. Leave **Apply
   payments made on or after** blank unless the campaign's earlier payments
   were never entered by hand, or they will be counted twice.

To change the key or the signing secret later, use **Settings** on the
connected card. Zeffy stays connected, and the linked campaigns and the
webhook address do not change. If the secret is regenerated in Zeffy, enter
the new one at once: Zeffy's old secret stops working immediately, and
deliveries are refused until The Logbook has the new one.

---

## API Endpoints

### Authenticated (`/api/v1/`)

```
POST   /api/v1/integrations/{id}/connect           # Store the key and signing secret, enable
PATCH  /api/v1/integrations/{id}                   # Settings: store only the fields sent
POST   /api/v1/integrations/{id}/disconnect        # Disconnect (key, secret and links are kept)
POST   /api/v1/integrations/{id}/test-connection   # Read one campaign from Zeffy

GET    /api/v1/grants/zeffy/status                 # Connected, webhook set, last sync, counts by status
GET    /api/v1/grants/zeffy/campaigns              # Zeffy's campaigns, read live, each with its link
GET    /api/v1/grants/zeffy/links                  # The department's links
PUT    /api/v1/grants/zeffy/links/{zeffy_campaign_id}
DELETE /api/v1/grants/zeffy/links/{zeffy_campaign_id}
GET    /api/v1/grants/zeffy/payments               # Payments, newest first; ?state= filters
POST   /api/v1/grants/zeffy/sync                   # Run the hourly sync now
```

The `/integrations` endpoints require `integrations.manage`. Of the
`/grants/zeffy` endpoints, `status`, `links` and `payments` require
`fundraising.view`; `campaigns`, the link changes and `sync` require
`fundraising.manage`.

### Public Webhook

```
POST   /api/public/v1/webhooks/zeffy/{integration_id}
```

Unauthenticated by design. Rate limited to 60 requests a minute per IP. Every
delivery must carry a valid `Zeffy-Signature` made with the signing secret in
the last five minutes, or it is refused with 401. After the signature
verifies, the payment is read again from Zeffy's API with the department's key
rather than trusted from the message. An event type that is not acted on
answers 200, so Zeffy does not retry it. A failure to reach Zeffy answers 503,
so Zeffy retries it. While the integration is disconnected, the webhook
answers 404.

---

## Configuration

Stored in the `integrations` table with `integration_type = 'zeffy'`. Both
values are secrets, kept encrypted in `encrypted_config` and never returned by
the API:

| Field            | Description                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `api_key`        | Required to connect. Generated by the Zeffy organization owner. Used only to read.             |
| `webhook_secret` | Optional. The `whsec_` secret Zeffy shows for the webhook. Without it, payments arrive hourly. |

Payments are kept in `zeffy_payments`, unique per department on Zeffy's payment
id. Links are kept in `zeffy_campaign_links`. The payer's email is stored
encrypted and is not returned by the payments list.

---

## Payment Statuses

| Status              | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| Applied             | Recorded on the linked record                                                          |
| Processing          | Zeffy has not finished the payment                                                     |
| Campaign not linked | Its campaign has no link, or the linked record was deleted                             |
| Before link start   | Made before the link's start date                                                      |
| No member match     | A dues payment whose payer's email matches no member, or whose member has no open dues |
| Not counted         | Failed, deleted, or refunded before it was applied                                     |
| Reversed            | Applied, then refunded, deleted or lost to a dispute, and taken back                   |
| Needs review        | Changed in Zeffy after it was applied in a way The Logbook will not undo by itself     |

---

## Limits

- A refund made more than seven days after the sale reaches The Logbook only
  through the webhook: the sync re-reads the last seven days, and Zeffy offers
  no "changed since" filter for payments.
- Payments entered in Zeffy by hand (`manual` and `imported`) are read like any
  other. Leave them out with the link's start date if the treasurer also typed
  them in.
- Zeffy supports USD and CAD. Nothing is converted.

More in
[KNOWN_LIMITATIONS.md](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md#zeffy--what-the-integration-leaves-to-the-treasurer-2026-10-31).

---

## See Also

- [Grants & Fundraising Module](Module-Grants-Fundraising)
- [PayPal Integration](Integration-PayPal), the store counterpart
- [Training: Integrations → Zeffy](https://github.com/thegspiro/the-logbook/blob/main/docs/training/16-integrations.md#zeffy--fundraising-payments)
- [Training: Grants & Fundraising → Zeffy](https://github.com/thegspiro/the-logbook/blob/main/docs/training/12-grants-fundraising.md#zeffy--online-donations-tickets-and-memberships)
