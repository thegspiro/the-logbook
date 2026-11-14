# PayPal Integration

_(Added 2026-10-25; Settings button 2026-11-14)_

The PayPal integration reconciles [Department Store](https://github.com/thegspiro/the-logbook/blob/main/docs/training/18-storefront.md)
orders against the department's own PayPal **Business** account. PayPal tells
The Logbook what the account received, and an order whose number appears in
the payment's reference settles itself. **The Logbook never takes a payment**:
there is no checkout, and no money passes through it.

The full operator reference is
[`docs/STOREFRONT_PAYPAL.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/STOREFRONT_PAYPAL.md).

---

## Key Features

- **Exact matching only.** A payment settles an order by itself only when its
  reference names exactly one order number (`ORD-YYYY-NNNN`) and the amount
  equals that order's balance exactly. There is no guessing by payer name or
  amount.
- **Every payment recorded.** Anything that does not settle itself waits under
  **Store → Admin → Payments** to be applied to an order or dismissed.
- **Automatic settlement is optional.** With it off, matches are recorded but
  never applied, for a department that wants a person to confirm each one.
- **Daily backfill.** Once a day The Logbook asks PayPal for the last seven
  days of payments and records any the webhook missed.
- **Settings on a connected card.** The environment, credentials, Webhook ID
  and automatic settlement can be changed without disconnecting.

---

## Pages

| URL                      | Page                                                            | Permission            |
| ------------------------ | --------------------------------------------------------------- | --------------------- |
| `/integrations`          | Integrations Hub: the PayPal card, **Connect** and **Settings** | `integrations.manage` |
| Store → Admin → Payments | The review queue: apply to an order, or dismiss                 | `storefront.manage`   |

---

## Setting It Up

1. **Create a REST app** at <https://developer.paypal.com> → **Apps &
   Credentials**, in **Sandbox** or **Live**, signed in with the department's
   PayPal Business account. Copy the **Client ID** and **Secret**.
2. **Add a webhook** on that app at the address the connect window shows,
   subscribed to **Payment capture completed** only. Copy the **Webhook ID**.
3. **Connect it** on **Integrations → PayPal → Connect**: environment, Client
   ID, Client Secret, Webhook ID, and whether to settle orders automatically.
   **Test** checks the credentials, and warns if the Webhook ID is missing.

To change any of these later, use **Settings** on the connected card. Blank
Client ID and Client Secret boxes keep the saved ones. **Switching between
sandbox and live needs the Client ID and Client Secret of that environment's
app in the same save**: sandbox and live credentials belong to different apps,
and keeping the old pair under the new environment would make PayPal reject
every webhook verification. The API refuses such a save with 422, on Settings
and on a reconnect.

---

## API Endpoints

### Authenticated (`/api/v1/`)

```
POST   /api/v1/integrations/{id}/connect           # Store credentials and settings, enable
PATCH  /api/v1/integrations/{id}                   # Settings: store only the fields sent
POST   /api/v1/integrations/{id}/disconnect        # Disconnect (credentials are kept)
POST   /api/v1/integrations/{id}/test-connection   # Check the credentials

GET    /api/v1/store/payments                      # The payments PayPal reported
POST   /api/v1/store/payments/{event_id}/apply     # Settle an order with one
POST   /api/v1/store/payments/{event_id}/ignore    # Dismiss one that is not a store payment
```

The `/integrations` endpoints require `integrations.manage`; the
`/store/payments` endpoints require `storefront.manage`.

### Public Webhook

```
POST   /api/public/v1/webhooks/paypal/{integration_id}
```

Unauthenticated by design. Rate limited to 60 requests a minute per IP. Every
delivery is checked through PayPal's own
`/v1/notifications/verify-webhook-signature`, keyed on the configured Webhook
ID, so an integration with no Webhook ID rejects every delivery. The PayPal
capture ID is unique per department, so a redelivered notification can never
pay an order twice.

---

## Configuration

Stored in the `integrations` table with `integration_type = 'paypal'`.

| Field                 | Where              | Description                                        |
| --------------------- | ------------------ | -------------------------------------------------- |
| `environment`         | `config`           | `sandbox` (default) or `live`                      |
| `client_id`           | `encrypted_config` | REST app Client ID. Never returned by the API      |
| `client_secret`       | `encrypted_config` | REST app Secret. Never returned by the API         |
| `webhook_id`          | `config`           | Required to verify deliveries                      |
| `auto_apply_payments` | `config`           | Settle exact matches automatically (on by default) |

Payments are kept in `store_payment_events`, unique per department and
provider on PayPal's capture ID.

---

## Payment Outcomes

| Outcome               | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| Applied               | Matched and settled                                                  |
| Matched — not applied | Would have settled, but automatic settlement is off                  |
| No order found        | The reference had no order number                                    |
| Needs a decision      | The amount does not match, or the order is cancelled or already paid |
| Dismissed             | An administrator decided it was not a store payment                  |

---

## Limits

- **Only PayPal reports back.** Venmo, Cash App and Zelle have no way to tell
  The Logbook a payment arrived; those orders are still marked paid by hand.
- **The backfill needs Transaction Search** turned on for the PayPal account,
  and PayPal's search runs a few hours behind.
- **The order number has to reach the payment.** PayPal invoices with the
  order number in the reference are the most reliable route; a plain "send
  money" depends on the member typing it in the note.

---

## See Also

- [Training: Integrations → PayPal](https://github.com/thegspiro/the-logbook/blob/main/docs/training/16-integrations.md#paypal--store-payment-reconciliation)
- [Training: Department Store](https://github.com/thegspiro/the-logbook/blob/main/docs/training/18-storefront.md)
- [Zeffy Integration](Integration-Zeffy), the fundraising counterpart
