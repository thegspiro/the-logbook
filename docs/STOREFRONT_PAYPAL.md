# Storefront — PayPal Payment Reconciliation

## What this is, and what it is not

The Logbook **never takes a payment**. There is no checkout, no card form, and
no money moves through this application. What the PayPal integration does is
the opposite direction: once a department connects its own PayPal **Business**
account, PayPal tells the Logbook what it received, and the Logbook matches
those payments to store orders so nobody has to tick "mark paid" by hand.

The manual controls stay exactly where they were. Marking an order paid,
recording a partial payment, and waiving a balance all still work, and they are
still the only option for Venmo, cash, and checks. This integration removes work
from the PayPal cases only.

> **Why PayPal and not Venmo?** Venmo publishes no API for personal or
> peer-to-peer transfers — there is nothing to connect to. PayPal exposes
> capture webhooks on Business accounts, which is what makes this possible.

## Setting it up

### 1. Create a REST app in PayPal

1. Sign in at <https://developer.paypal.com> with the department's PayPal
   Business account.
2. **Apps & Credentials** → choose **Sandbox** or **Live** → **Create App**.
3. Copy the **Client ID** and **Secret**. Sandbox and live credentials are not
   interchangeable.

### 2. Add the webhook

Still on the app's page, under **Webhooks**, add a webhook pointing at:

```
https://<your-logbook-host>/api/public/v1/webhooks/paypal/<integration-id>
```

The exact URL, with the integration id filled in, is shown in the connect form
once the integration exists — copy it from there rather than assembling it.

Subscribe it to **Payment capture completed**
(`PAYMENT.CAPTURE.COMPLETED`) and nothing else. Other event types are
acknowledged and discarded, so subscribing to more just adds noise.

Copy the **Webhook ID** PayPal assigns.

### 3. Connect it in the Logbook

**Settings → Integrations → PayPal → Connect**, then fill in:

| Field | Notes |
|-------|-------|
| Environment | Must match which credentials you copied. Defaults to sandbox. |
| Client ID / Secret | Stored encrypted; never echoed back. Leave blank on a later edit to keep what is stored. |
| Webhook ID | **Required.** Without it, deliveries cannot be verified and are rejected. |
| Settle orders automatically | On by default. See the matching rules below. |

**Test Connection** confirms the credentials work. It deliberately reports a
warning rather than a plain success when the webhook ID is missing, because
credentials alone reconcile nothing.

## How a payment is matched

A payment is applied automatically only when **both** hold:

1. The payment reference contains exactly one order number in `ORD-YYYY-NNNN`
   form — read from PayPal's `invoice_id`, `custom_id`, or note, in that order.
2. The amount equals that order's outstanding balance **exactly**.

Anything else is recorded and left for a person, under
**Store → Admin → Payments**:

| Outcome | Meaning |
|---------|---------|
| Applied | Matched and settled. |
| Matched — not applied | Would have settled, but automatic settlement is off. |
| No order found | The reference carried no order number. |
| Needs a decision | The order is cancelled, already has no balance, or the amount does not equal the balance. |
| Dismissed | An administrator decided it was not a store payment. |

Fuzzy matching on payer name or amount alone was considered and rejected. Two
members can easily owe the same amount in the same order window, and crediting
the wrong member's order is worse than leaving the payment in a queue for a
few hours.

The order-number pattern is matched as a whole token, so a payer who types
their phone number into the note does not accidentally name an order.

Every inbound payment is recorded whether or not it matched — including the
ones that matched nothing. That is the case that most needs a human: the money
has already left the member's account, so dropping the notification would leave
them chasing an order that still reads unpaid.

## Getting the order number onto the payment

The matcher reads what the payer or the department put in the reference. In
practice:

- **PayPal invoices** — put the order number in the invoice's reference field.
  This is the most reliable route, and the one to prefer.
- **Payment links / checkout** — set `custom_id` to the order number.
- **Plain "send money"** — ask the member to put the order number in the note.
  This works, but it depends on the member typing it, so expect some payments
  to land in the review queue.

## Working the review queue

**Store → Admin → Payments** lists everything that has not resolved itself.
Each entry offers:

- **Apply to order** — settles the order. For an unmatched payment, enter the
  order to credit first. Applying writes through the normal payment path, so
  the order timeline, the member's receipt email, and the window rollups all
  behave as if it had been marked paid by hand.
- **Dismiss** — for payments that are not store orders at all (a donation, a
  dues payment, a refund). An applied payment cannot be dismissed.

## Security notes

- Every delivery is verified through PayPal's own
  `/v1/notifications/verify-webhook-signature` endpoint. Local certificate-chain
  validation was avoided deliberately: a hand-rolled verifier can be fooled by a
  forged `PAYPAL-CERT-URL` header, and PayPal's endpoint keys the check on the
  webhook ID the department configured.
- An integration with no webhook ID rejects every delivery. This endpoint
  mutates payment state, so an unverifiable delivery is worth nothing.
- Deliveries are replay-protected, and the PayPal capture ID is unique per
  organization, so a redelivered notification can never pay an order twice.
- The endpoint is rate limited per IP and every delivery is audit-logged.
- Matching, listing, applying, and dismissing are all scoped to the paying
  organization. A payment reported by one department's PayPal account cannot
  settle another department's order, even if the reference names it.
