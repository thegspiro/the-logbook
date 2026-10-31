# Zeffy — Fundraising Payments Read Into the Logbook

## What this is, and what it is not

[Zeffy](https://www.zeffy.com) is a zero-fee fundraising platform for US and
Canadian nonprofits: donation forms, event ticketing and membership sales. A
department keeps selling through Zeffy, and Zeffy keeps issuing the tax
receipts. The Logbook **reads** what Zeffy received and records it where the
department keeps its own books:

| A Zeffy campaign linked to… | Each payment becomes…                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a fundraising campaign      | a **donation** on that campaign, from a donor matched (or created) by the payer's email. Campaign and donor totals recompute as for a gift entered by hand.    |
| a fundraising event         | an addition to the event's **revenue**, and one **attendee** per ticket. The hand-kept figures stay editable; Zeffy adds to them rather than overwriting them. |
| a dues schedule             | a **dues payment** on the paying member's oldest open dues on that schedule, matched by email. Anything over the balance is recorded as a donation.            |

Nothing is ever written to Zeffy — its API key is used only to read. No card
data reaches the Logbook; the payment method is stored as a type (`card`) only.

Eligibility is Zeffy's to decide: it serves registered nonprofits (US 501(c)(3)
and Canadian charities and nonprofits). A volunteer fire company organized as a
nonprofit usually qualifies; a municipal department may not.

## Setting it up

### 1. Generate the API key in Zeffy

The Zeffy organization **owner** opens **Settings → Integrations** in Zeffy and
generates an API key.

### 2. Connect it in the Logbook

**Integrations → Zeffy → Connect**, paste the API key, and save. **Test** reads
one campaign to prove the key works. The key is stored encrypted and never shown
again; leave the field blank on a later edit to keep it.

### 3. (Recommended) Add the webhook

Without a webhook, payments arrive on the hourly sync. With one, they arrive
within seconds, and so do refunds made long after the sale.

1. Copy the webhook URL shown in the Zeffy connect form. It looks like
   `https://<your-logbook-host>/api/public/v1/webhooks/zeffy/<integration-id>`.
2. In Zeffy's **Settings → Integrations → Webhook**, add that URL and subscribe
   it to `payment.created`, `payment.completed`, `payment.updated` and
   `payment.deleted`. Contact events are accepted and ignored.
3. Paste the signing secret Zeffy shows (it starts with `whsec_`) into the
   **Webhook Signing Secret** field in the Logbook and save.

Every delivery must carry a valid `Zeffy-Signature` signed with that secret in
the last five minutes; anything else is refused with 401. If the secret is ever
regenerated in Zeffy, paste the new one here first: Zeffy's old secret stops
working immediately.

### 4. Link each campaign

**Grants & Fundraising → Zeffy** lists the department's Zeffy campaigns. For
each one, choose **Link**, pick what its payments are recorded as, and pick the
record.

**Apply payments made on or after** decides which payments count:

- **Blank (the default)** — only payments from now on. Use this if the
  treasurer has been typing Zeffy gifts in by hand, or they will be counted
  twice.
- **An earlier date** — imports that campaign's history from that date. Use it
  only for payments nobody has entered by hand.

Linking a campaign to **member dues** also needs `finance.manage`, because it
credits members' dues.

## Permissions

| Action                                                       | Permission                                    |
| ------------------------------------------------------------ | --------------------------------------------- |
| Connect Zeffy, set the key and signing secret                | `integrations.manage` (Integrations page)     |
| See linked campaigns and the payments list                   | `fundraising.view`                            |
| List Zeffy's campaigns, link or unlink one, run **Sync now** | `fundraising.manage`                          |
| Link a campaign to a dues schedule                           | `fundraising.manage` **and** `finance.manage` |

The payer's email is stored encrypted and never returned by the payments list.
Their mailing address and checkout answers are not stored at all.

## What happens to each payment

Every payment Zeffy reports is recorded in the **Payments** list on the Zeffy
page, with what became of it:

| Status              | Meaning                                                                                                                         | What to do                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Applied             | Recorded on the linked record.                                                                                                  | Nothing.                                                                                       |
| Processing          | Zeffy has not finished it yet.                                                                                                  | Nothing — it applies when Zeffy reports it succeeded.                                          |
| Campaign not linked | Its Zeffy campaign has no link, or the linked record was deleted.                                                               | Link the campaign; waiting payments apply at once.                                             |
| Before link start   | Made before the link's start date.                                                                                              | Nothing, unless it should count — then move the link's start date earlier.                     |
| No member match     | A dues payment whose payer's email matches no member, or whose member has no open dues on the schedule.                         | Fix the member's email or generate their dues; it is retried every hour. Or record it by hand. |
| Not counted         | Failed, deleted, or refunded before it was ever applied.                                                                        | Nothing.                                                                                       |
| Reversed            | Applied, then refunded, deleted in Zeffy, or lost to a dispute — the donation is marked refunded, the event revenue taken back. | Nothing.                                                                                       |
| Needs review        | Changed in Zeffy after it was applied in a way the Logbook will not undo by itself (see below).                                 | Adjust the record by hand.                                                                     |

**A refund is followed automatically** for donations (a partial refund lowers
the donation; a full refund marks it refunded) and for event revenue (exactly
what was added is taken back). **A refund of dues is not**: the dues ledger has
no reversal, and undoing a payment a member was told was received is a decision
for the treasurer. The payment shows **Needs review** with the amounts.

A payment stays on the record it was first applied to even if its campaign's
link is later pointed somewhere else. Moving money between records is a
decision for the treasurer, not a side effect of editing a link.

## How it stays correct

- **One payment, one effect.** `zeffy_payments` is unique per department on
  Zeffy's payment id, and every change runs under a lock on that row. The row
  records what was applied and where, and a later change applies only the
  difference. The webhook and the sync can report the same payment any number
  of times, in any order.
- **The webhook body is never trusted as data.** After the signature verifies,
  the payment is re-read from Zeffy's API with the department's key — Zeffy's
  `payment.updated` and `payment.deleted` events carry only an id anyway.
- **Amounts are converted from cents once**, in `zeffy_service.parse_payment`.
- **The hourly sync** (`zeffy_payment_sync`, also runnable with `POST
/scheduled/run-task?task=zeffy_payment_sync` or **Sync now**) reads each
  linked campaign's payments in 30-day windows from where it last got to,
  re-reading the last 7 days so payments that settle or are partly refunded
  shortly after the sale are seen again. A run stays under 60 Zeffy requests
  (Zeffy allows 100 a minute per organization); a long history is finished over
  the following runs.

## Limits

- **A refund made more than 7 days after the sale reaches the Logbook only
  through the webhook.** The sync reads payments by creation date, and Zeffy
  offers no "changed since" filter for payments. Departments that rely on
  refunds being followed should set up the webhook.
- **Peer-to-peer team and participant pages** are matched to a link on the main
  campaign when the webhook reports them. The sync asks Zeffy for the linked
  campaign's own payments, and Zeffy does not document whether that includes
  its sub-pages.
- **Payments entered in Zeffy by hand** (`manual` and `imported` types) are
  read like any other. If the treasurer also entered them in the Logbook,
  they will be counted twice; use the link start date to leave them out.
- Zeffy supports USD and CAD. A donation keeps Zeffy's currency; event revenue
  and dues are added as amounts, with no conversion.
