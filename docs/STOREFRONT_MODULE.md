# Department Storefront Module

An optional store for department merchandise — job shirts, coins, patches,
Class B uniforms — with ordering windows, per-member limits, personalization,
and payment tracking.

The one thing to understand before anything else: **The Logbook never takes a
payment.** There is no checkout, no card form, and no money moves through this
application. The store records what members ordered and what they owe; the
money moves through whatever the department already uses — Venmo, PayPal, Cash
App, Zelle, cash, a check, or payroll deduction. The store's job is to make
that settlement fast to record and hard to lose track of.

This is a deliberate scope boundary, not a missing feature. Volunteer
departments generally cannot become card processors, and holding member card
data would drag the whole deployment into PCI scope for the sake of selling
forty job shirts a year.

---

## Contents

1. [Where it lives](#where-it-lives)
2. [Permissions](#permissions)
3. [Data model](#data-model)
4. [Order windows](#order-windows)
5. [Order lifecycle](#order-lifecycle)
6. [Payments](#payments)
7. [PayPal reconciliation](#paypal-reconciliation)
8. [Product photos](#product-photos)
9. [Personalization](#personalization)
10. [Notifications](#notifications)
11. [Exports](#exports)
12. [Design decisions worth knowing](#design-decisions-worth-knowing)

---

## Where it lives

| Path | Page | Permission |
|------|------|------------|
| `/store` | Member storefront — browse the open window, build a cart, order | `storefront.view` |
| `/store/orders` | My Orders — status, balance, payment buttons | `storefront.view` |
| `/store/admin` | Quartermaster console (6 tabs) | `storefront.manage` |

The admin console's tabs are Overview, Order Windows, Catalog, Orders,
Payments, and Settings.

**Backend:** `app/api/v1/endpoints/storefront.py` (routes),
`app/services/storefront_service.py` (business logic),
`app/services/storefront_notification_service.py` (email),
`app/utils/storefront_payments.py` (payment links and option building),
`app/models/storefront.py`, `app/schemas/storefront.py`.

**Frontend:** `frontend/src/modules/storefront/`.

Like every module, availability is per-organization via `enabled_modules` in
organization settings. Separately, `StoreSettings.is_enabled` takes the
member-facing store offline without hiding the admin screens — so a
quartermaster can close the shop for a rebuild while still working the orders
already placed.

---

## Permissions

| Permission | Grants |
|------------|--------|
| `storefront.view` | Browse the store, see your own orders |
| `storefront.order` | Place orders |
| `storefront.manage` | Catalog, windows, other members' orders, payments, settings |

`GET /api/v1/store/permissions` returns all three as booleans so the UI can
hide what the user cannot do rather than letting them discover it via a 403.

---

## Data model

Ten tables, all prefixed `store_`:

| Table | Holds |
|-------|-------|
| `store_settings` | One row per organization: identity, payment config, pricing, notification prefs |
| `store_products` | Catalog items |
| `store_product_variants` | Sizes/colours (the UI calls them **options**), each with its own price delta and stock |
| `store_product_images` | Uploaded photos (binary, `MEDIUMBLOB`) |
| `store_order_windows` | Ordering periods |
| `store_window_products` | Which products a window offers, when not "all" |
| `store_orders` | Member orders |
| `store_order_items` | Line items, with pricing snapshotted at order time |
| `store_order_events` | Per-order timeline (status changes, payments, messages) |
| `store_payment_events` | Payments a provider reported, and what we did about each |

Every table carries `organization_id` and every by-id query filters on it.

Line items **snapshot** product name, variant label, and unit price at order
time. Catalog rows get renamed and repriced between windows, and a receipt has
to keep saying what the member actually bought and paid.

Order numbers are `ORD-YYYY-NNNN`, allocated per organization. Allocation
retries on an `IntegrityError` inside a `SAVEPOINT`, so two members checking
out in the same second get distinct numbers rather than one of them getting a
500.

---

## Order windows

A window is an ordering period. Statuses: `draft` → `scheduled` → `open` →
`closed` → `fulfilled`, plus `cancelled`.

More than one window can be open at once. The member storefront opens on the
one closing soonest (undated windows sort last) and offers a switcher for the
rest, so a department can run "Fall Apparel" and "Class B Uniforms"
concurrently without either hiding the other.

A window either offers the whole active catalog (`include_all_products`) or an
explicit subset via `store_window_products` — which is how the "Class B
uniforms only" window works without archiving everything else.

Closing a window is what turns a pile of orders into a purchase order. The
window summary (`GET /store/windows/{id}/summary`) rolls up order count,
distinct members, gross sales, collected, and outstanding, plus **two**
separate breakdowns:

- `size_totals` — quantity per product and option, merged across members. This
  is the purchase order.
- `tallies` — the same lines split out by personalization text. This is the
  embroidery list.

They are separate because on a personalized product every line carries a
different name, so a single personalization-aware grouping degenerates into one
row per order and cannot answer "how many larges?" — the spreadsheet this
module exists to replace.

Those rollups are computed in SQL (`GROUP BY` with `func.sum` and `case`), not
by summing in Python over a page of results. An earlier version paged at 200
and silently under-reported any window larger than that.

---

## Order lifecycle

**Fulfillment status** (`store_orders.status`): `submitted`,
`awaiting_payment`, `paid`, `ordered`, `ready_for_pickup`, `fulfilled`,
`cancelled`.

**Payment status** (`store_orders.payment_status`): `unpaid`,
`pending_verification`, `partial`, `paid`, `refunded`, `waived`.

These are deliberately separate axes. A member can pay for a shirt that has not
been ordered from the vendor yet, and a shirt can be sitting on the shelf ready
for pickup while the member still owes for it. Collapsing them into one status
would force a false ordering on two independent things.

`pending_verification` exists because a member can *report* having sent
payment. That is a claim, not a receipt — it moves the order into a queue for
somebody to confirm, and never marks it paid on its own.

---

## Payments

A member with a balance due sees a button for every method the department both
**accepts** and **has configured**.

| Method | What the member gets | Carries the order number? |
|--------|---------------------|---------------------------|
| Venmo | Deep link prefilled with amount and the order number in the note | Yes |
| PayPal | PayPal.Me link with the amount | No — displayed to type |
| Cash App | `cash.app/$tag/<amount>` | No — Cash App has no note field |
| Zelle | The registered email or phone, tap to copy | No — displayed to type |
| Check | Payee and mailing address | No |
| Cash / payroll deduction / other | Free-text instructions | No |

A method appears only when it is in `accepted_payment_methods` **and** has
whatever it needs to work. For Venmo, PayPal, Cash App and Zelle that means a
usable handle — either condition alone hides it, since a method with nothing
configured would be a dead button and a link that goes nowhere tells a member
the money moved when it did not. The offline methods (cash, payroll deduction,
other) need nothing, so ticking them is enough.

That asymmetry is why **a new store starts on cash alone**
(`_DEFAULT_PAYMENT_METHODS`). Seeding Venmo, PayPal and check ticked — as it
used to — showed the quartermaster three methods that were switched on and did
nothing, because members never saw them until a handle was entered. Cash is the
honest floor: it needs no setup and it works.

Un-ticking everything normalizes back to cash rather than storing an empty
list. A store has to accept something, and it removes the "no method at all"
state from every code path that would otherwise have to reason about it.

The same list is enforced at checkout (`create_order` raises for a method not
in `accepted_payment_methods`), so hiding the button is not the only thing
standing in the way of a crafted request.

**Zelle deliberately has no link.** It runs inside each bank's own app and
publishes no web or deep-link scheme, so the most that can honestly be offered
is the handle to type. Inventing a `zelle.com` URL would send members to a page
that cannot pay anybody.

Two behaviours that are easy to miss:

- A member is not locked into the method they chose at checkout. All configured
  methods stay available — the money only has to arrive.
- If the department later stops accepting a method, orders already placed on it
  keep their button. Somebody who still owes on a Venmo order needs to be able
  to pay it.

Where the link cannot carry the order number, the member is shown the reference
to type. That reference is what lets a treasurer match the payment, so it is
never hidden — including when no method is configured at all.

### Payment policy

`StoreSettings.payment_policy` decides what an unpaid order is allowed to do.
Departments genuinely differ here and both directions are defensible, so the
default is `none` — the behaviour a store already had before the setting
existed.

| Value | In the vendor order | `ordered` / `ready_for_pickup` | `fulfilled` |
|-------|--------------------|-------------------------------|-------------|
| `none` | Yes | Yes | Yes |
| `before_pickup` | Yes | Yes | **Refused** while a balance is due |
| `before_vendor_order` | **Held back** | **Refused** | **Refused** |

`before_vendor_order` blocks `ORDERED` and `READY_FOR_PICKUP` as well as
`FULFILLED`, because the item was deliberately left off the vendor sheet and so
does not exist. Neither claim can be made about goods nobody bought — and
"ready for pickup" is worse than merely inaccurate, since it emails the member
to come and collect something that was never ordered.

Under `before_vendor_order`, `size_totals` and `tallies` cover settled orders
only, and the excluded ones come back as `held_totals` / `held_order_count`
rather than disappearing — the quartermaster has to see who is being left out
before the order goes in.

Only those transitions are gated (`_PAYMENT_GATED_STATUSES`). Messaging the
member, moving an order back to awaiting payment, and cancelling all still run
under every rule.
`bulk_update_status` delegates to the same check, so advancing a whole window
moves the settled orders and returns the rest by order number with the balance
in the message.

The policy governs future transitions only — changing it never rolls back a
step already taken, so a department can adjust it mid-window without
invalidating what it has already sent to the vendor.

"Settled" means `payment_status` is `paid` or `waived`, or the balance is zero
— so waiving a comp or a replacement releases the order exactly like a payment
does.

### The vendor order

`POST /store/windows/{id}/vendor-order` records that the bulk order has gone
out, and is the step between "ordering closed" and "come pick it up" — the one
members chase. It does three things in one call so they cannot drift apart:

1. Stamps `vendor_name`, `vendor_reference`, `vendor_ordered_at` and
   `vendor_ordered_by` on the window, plus `expected_delivery_date` if given.
2. Advances every eligible order to `ORDERED`.
3. Emails everyone who ordered, with the vendor and expected date.

Orders the payment policy holds back are skipped, not advanced, and come back
in `skipped` with the balance in the message. They were not on the sheet the
vendor received, so recording them as ordered would be a lie the member
discovers at pickup.

### Recording money

| Action | Endpoint | Effect |
|--------|----------|--------|
| Mark paid | `POST /store/orders/{id}/mark-paid` | Settles the whole remaining balance, reading the amount off the order |
| Record payment | `POST /store/orders/{id}/payments` | Records a specific amount (partial payments) |
| Waive | `POST /store/orders/{id}/waive` | Clears the balance without money changing hands |
| Refund | `POST /store/orders/{id}/refund` | Records a refund |
| Bulk mark paid | `POST /store/orders/bulk-payment` | Several orders at once |

Every one of these takes the **payment method actually used**, which need not
be the one the member chose at checkout — they picked Venmo and then handed
over cash at drill. Recording the real method is what keeps a treasurer's
Venmo reconciliation from coming up one short with no explanation.
`GET /store/orders?payment_method=zelle` narrows the list the same way, since
each app settles as its own payout.

Mark-paid reads the balance off the order rather than asking for it. Typing the
amount is the common case by far and adds a chance to fat-finger it.

Handles are validated on save, not silently dropped. A typo'd `$cashtag` would
otherwise just make the Cash App button vanish with nothing telling the
administrator why.

---

## PayPal reconciliation

Optional. A department that connects its own PayPal **Business** account gets
inbound capture notifications, and matching orders settle themselves.

Set it up under **Settings → Integrations → PayPal**. Full walkthrough:
[STOREFRONT_PAYPAL.md](./STOREFRONT_PAYPAL.md).

A payment applies automatically only when **both** hold:

1. The reference contains exactly one order number in `ORD-YYYY-NNNN` form —
   read from PayPal's `invoice_id`, `custom_id`, or note.
2. The amount equals that order's outstanding balance **exactly**.

Everything else lands in the **Payments** tab for a person. Fuzzy matching on
payer name or amount alone was considered and rejected: two members can easily
owe the same amount in the same window, and crediting the wrong member's order
is worse than a wait in a queue.

Every inbound payment is recorded whether or not it matched. The unmatched ones
are the point — the money has already left the member's account, so discarding
the notification would leave them chasing an order that still reads unpaid.

**Why only PayPal?** Venmo publishes no API for personal or peer-to-peer
transfers, Cash App has no equivalent merchant webhook for this use, and Zelle
is bank-side. PayPal is the only one of the four that can report back, so it is
the only one that can settle an order without a human.

---

## Product photos

Uploaded through `POST /store/products/{id}/image`, stored as binary in
`store_product_images.data` (`MEDIUMBLOB` — the default `BLOB` caps at 64 KB,
which is smaller than any usable photo).

Uploads are bounded at 5 MB and re-encoded before storage. The content type is
identified by **magic bytes**, not the client-supplied `Content-Type` header —
a header is not evidence, and sniffing is what stops a renamed executable from
being stored and served back to members.

---

## Personalization

Per-product: enable it, optionally require it, set the label the member sees
("Name for embroidery"), a max length, and an optional surcharge.

Personalization text is part of a cart line's **identity**. Two shirts with
different names are two different goods and never merge into one line of
quantity 2 — they are physically different items and the vendor needs them
listed separately.

---

## Notifications

Email via `storefront_notification_service.py`. Configurable per organization:

- Order confirmation to the member
- New-order notice to administrators
- Status-change updates
- Payment reminders (after N days)
- Window-closing reminder (N hours before)

Administrator recipients resolve from position slugs (`ADMIN_NOTIFY_ROLE_SLUGS`)
plus any addresses in `notify_emails`. Order emails carry the same payment
buttons as the web page.

---

## Exports

`GET /store/orders/export` produces a line-level CSV for a window or status —
the file you hand a vendor or a treasurer.

Written with `SafeCsvWriter`, never bare `csv.writer`. Member names and
personalization text are free text that ends up in Excel, and a member named
`=cmd|…` would otherwise run a formula on whoever opens the export. Paged at
200 rows internally so a large window exports completely.

Every order is included, unpaid ones too, because the file doubles as the
treasurer's record. Under `before_vendor_order` the **Held From Vendor Order**
column marks the rows the on-screen tally excluded — without it the export
would read as a vendor sheet that quietly undoes the policy.

---

## Design decisions worth knowing

**Stock is locked, not checked.** Orders that touch tracked stock take
`SELECT … FOR UPDATE` on the product rows in a stable id order. Checking
availability and then writing is a race two members can both win on a Sunday
night when the window is about to close; ordering the locks by id avoids
deadlocking against each other.

**Payment status is separate from fulfillment status.** See
[Order lifecycle](#order-lifecycle).

**Reporting a payment is not paying.** A member's report moves the order to
`pending_verification` and nothing else.

**JSON column mutations use `copy.deepcopy()`.** `store_settings` holds JSON
columns; a shallow `dict()` copy shares nested references and SQLAlchemy skips
the UPDATE. See CLAUDE.md pitfall 12.

---

## Related documentation

- [STOREFRONT_PAYPAL.md](./STOREFRONT_PAYPAL.md) — PayPal setup and the
  reconciliation rules
- [Training guide 18](./training/18-storefront.md) — the user-facing walkthrough
- [Training guide 16](./training/16-integrations.md) — integrations generally
