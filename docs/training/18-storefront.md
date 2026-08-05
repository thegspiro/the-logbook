# Department Store

The Department Store module lets your department sell merchandise to members —
job shirts, coins, patches, Class B uniforms — with ordering windows, size and
colour options, name embroidery, and payment tracking.

**Read this first:** The Logbook never takes a payment. There is no card form
and no money passes through the system. The store records what members ordered
and what they owe; the money moves the way it always has — Venmo, PayPal, Cash
App, Zelle, cash, a check, or payroll deduction. What the store does is make
settling up fast to record and hard to lose track of.

---

## Table of Contents

1. [Store Overview](#store-overview)
2. [Turning the Store On](#turning-the-store-on)
3. [Store Settings](#store-settings)
4. [Building the Catalog](#building-the-catalog)
5. [Options — Sizes and Colours](#options--sizes-and-colours)
6. [Personalization](#personalization)
7. [Product Photos](#product-photos)
8. [Order Windows](#order-windows)
9. [Placing an Order (Member View)](#placing-an-order-member-view)
10. [Paying (Member View)](#paying-member-view)
11. [Working the Orders](#working-the-orders)
12. [Recording Payment](#recording-payment)
13. [Automatic PayPal Reconciliation](#automatic-paypal-reconciliation)
14. [Telling the Vendor, and Telling the Members](#telling-the-vendor-and-telling-the-members)
15. [Closing a Window and Ordering from the Vendor](#closing-a-window-and-ordering-from-the-vendor)
16. [Realistic Example: A Fall Job-Shirt Window](#realistic-example-a-fall-job-shirt-window)
17. [Troubleshooting](#troubleshooting)

---

## Store Overview

Navigate to **Store** in the sidebar. The module must be enabled for your
organization in Organization/Admin Settings > Modules (`enabled_modules`).

| URL | Page | Permission |
|-----|------|------------|
| `/store` | Browse the open window and place an order | `storefront.view` |
| `/store/orders` | My Orders — status, balance, payment buttons | `storefront.view` |
| `/store/admin` | Quartermaster console | `storefront.manage` |

### Permissions

| Permission | Description |
|------------|-------------|
| `storefront.view` | Browse the store and see your own orders |
| `storefront.order` | Place orders |
| `storefront.manage` | Catalog, order windows, everyone's orders, payments, settings |

> **[SCREENSHOT NEEDED]:** _Screenshot of the member storefront at `/store`
> showing the open window banner, a product grid with photos and prices, and
> the cart summary._

---

## Turning the Store On

There are two separate switches, and knowing why is worth thirty seconds.

1. **The module** — Admin Settings > Modules. Controls whether "Store" appears
   in navigation at all.
2. **The store itself** — Store Admin > Settings > "Store is live for members".

The second one exists so you can take the member-facing shop offline —
mid-season, between windows, while you rebuild the catalog — **without** hiding
the admin screens you still need to work the orders already placed. When it is
off, members see nothing; you keep everything.

---

## Store Settings

**Store Admin (`/store/admin`) > Settings tab.**

### Identity

| Field | Notes |
|-------|-------|
| Store name | Shown as the page heading |
| Tagline | One line under the name |
| Description | Longer intro text |
| Currency | Three-letter code, defaults to USD |

### Payment methods

A new store starts on **cash** only. That is deliberate: cash is the one
method that works with nothing filled in, so a fresh store can take an order
on day one. Tick the others as you configure them.

Tick every method your department accepts, then fill in the details for each.
Except for the offline methods — cash, payroll deduction, other — the
member-facing side only shows a method that is **both ticked and configured**;
a ticked method with no handle stays hidden. See
[Paying](#paying-member-view).

Un-tick everything and it falls back to cash. A store has to accept something,
and cash is the floor.

| Method | What to enter |
|--------|---------------|
| Venmo | Your handle, with or without the `@` |
| PayPal | Your PayPal.Me link, and/or the PayPal email |
| Cash App | Your `$cashtag` |
| Zelle | The email or mobile number Zelle is registered to, plus optional instructions |
| Check | Who checks are payable to, and the mailing address |
| Cash | Free-text instructions ("Pay the quartermaster at drill") |
| Payroll deduction | Free-text instructions |
| Other | Free-text instructions |

Cash App and Zelle handles are **validated when you save**. If you mistype a
`$cashtag`, you get an error rather than a silently missing button.

Un-ticking a method takes it off the member's screen immediately and blocks it
at checkout — a crafted request cannot slip past the buttons. The one
exception: a member who **already** placed an order on that method keeps their
button, because they still owe you and still need a way to pay. If you have
closed the account entirely, clear the handle as well and the button goes for
everyone.

### Pricing

| Field | Notes |
|-------|-------|
| Tax rate | Entered as a percentage; stored as a fraction |
| Flat shipping rate | Applied to orders that ship |
| Allow pickup / Allow shipping | Leave at least one on — with both off, every order is rejected |
| Unpaid orders | Your department's payment rule — see below |
| Pickup location | Where members collect |

### Unpaid orders — your department's rule

Departments genuinely differ on this, so pick the one that matches yours.
**Unpaid orders** in Settings offers three:

| Setting | What happens to a member who hasn't paid |
|---------|------------------------------------------|
| **No payment gate** | Their shirt is ordered and they can collect it. You chase the money separately. This is the default and what the store did before this setting existed. |
| **Payment required before pickup** | Their shirt *is* ordered — it's in the vendor order like everyone else's — but they cannot collect it until they've paid. |
| **Payment required before the vendor order** | Their shirt is **not ordered at all**. They're held out of the vendor order until they pay, and it cannot be marked *ordered* either — the record would otherwise claim the vendor was told about a shirt you deliberately left off the sheet. |

Under the third rule, held-back orders are **shown** on the Tally, not silently
dropped. You need to see who is being left out — and chase them — before the
order goes in. Record their payment and they rejoin the totals immediately.

The setting is presented as a comparison of all three, with what each does to
the vendor order and to pickup side by side, because you pick it before there
is a catalog to test it against. **Change it whenever your practice changes** —
it governs what happens next and never undoes a step already taken, so
switching mid-window will not un-order anything you have already sent.

Under either of the last two, marking an unpaid order **fulfilled** is refused
with the balance in the message. Bulk-fulfilling a window still works: the paid
orders go through and the unpaid ones come back listed by order number, so you
know exactly who to go find. Recording the payment *or* waiving the balance
both release it — a comp or a replacement clears the gate without money moving.

Every step short of the handover still runs under all three rules. The shirt
gets ordered, received, and marked ready for pickup regardless; it is only
putting it in the member's hands that waits.

### Notifications

The **Notifications** panel lists every email the store can send, in two
groups, each with a line saying who receives it. Untick one and the department
stops sending it; all nine start switched on.

**Order notices**

| Switch | Who gets it, and when |
|---|---|
| Order confirmation | The member, the moment they order — their receipt and how to pay |
| Status changes | The member, when their order becomes ordered, ready for pickup, picked up, or cancelled |
| Payment receipts | The member, when you record a payment, waive one, or record a refund |
| Payment reminders | Members still carrying a balance, after N days |
| New order alert | You and the addresses in **Extra notification recipients**, each time an order lands |

**Order window notices**

| Switch | Who gets it, and when |
|---|---|
| Ordering is open | Every active member when a window opens |
| Last call | Every active member, N hours before the window closes |
| Ordering has closed | Everyone who ordered in that window |
| Order placed with the vendor | Everyone who ordered, when you record the vendor order |

Two of these catch people out. **Status changes** also covers the cancellation
email — untick it and a member whose order you cancel hears nothing. And
**Payment receipts** covers refunds and waivers as well as payments, because
all three are money moving on someone's order.

A switch is a ceiling, not a duplicate. Actions that offer an "email members"
box — opening a window, closing one, recording the vendor order — can still
skip a single send, and an individual window can decline to announce itself.
Neither can send a notice you have switched off here.

What the emails say is yours to shape too, through settings rather than a
template editor: the payment instructions and per-method notes appear under the
pay buttons, the receipt footer closes the confirmation, a window's pickup
instructions ride along with every announcement about it, and the open / close
/ vendor-order actions each take a free-text message for that send only. The
layout, your logo and your colours come from the organization's email branding.

### Seeing one before you send it

Every switch has a **Preview** button beside it. It opens the actual email —
subject line, layout, your logo, and the pay buttons exactly as a member's
phone will show them — built against a sample job shirt order and a sample
window.

The sample order is invented. Everything a department controls is not: the
Venmo handle, the cash instructions, the receipt footer, the store name and
your branding all come from your own saved settings. That makes the preview the
fastest way to answer the questions that actually bite — *is my cashtag
right? does the Zelle handle read properly? did I leave a method ticked that I
never configured?* A method you do not accept simply is not there.

Two things to know. The preview reads **saved** settings, so reword the
instructions and hit Save before you look. And you can preview a notice that is
switched off — the panel says so at the top of the preview — which is the point,
since otherwise you could not see what you were deciding about.

Nothing is sent and nothing is recorded. Previewing does not create an order,
does not touch a window, and does not email anybody, including you.

Everything the store sends is logged in **Communications → Message History**
under a `storefront_` type, so "did she ever get the reminder?" is a question
with an answer.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Settings tab showing the payment
> method checkboxes with the Venmo, PayPal, Cash App and Zelle fields revealed
> beneath them._

---

## Building the Catalog

**Store Admin > Catalog tab > New item.**

(The UI calls catalog entries *items* and their size/colour choices *options*.
This guide uses the same words.)

| Field | Notes |
|-------|-------|
| Name, SKU, Description | |
| Category | Free text, used for grouping |
| Price | Base price before option adjustments |
| Cost | What you pay the vendor — internal only, never shown to members |
| Taxable | Applies the store tax rate to this item |
| Status | **Draft** (invisible), **Active (for sale)**, **Archived** (retired) |
| Max per member | Caps how many one member can order |
| Track stock | Enables quantity enforcement |
| Link to inventory item | Ties the store item to an existing inventory record |

Draft is the useful one while you build: add the item, load the photo, set up
options, then flip to **Active (for sale)** when it is ready.

---

## Options — Sizes and Colours

Add **options** to an item for anything a member has to choose between: S/M/L/XL,
navy vs. black, men's vs. women's cut. Use **Add option** on the item form.

Each option carries:

- **Label** — what the member picks ("XL", "Navy — Women's")
- **SKU** — the vendor's code for that specific option
- **Price delta** — added to the base price. `+3.00` on 2XL is the usual case;
  a negative delta works too.
- **Stock quantity** — tracked per option, not just per item
- **Active** — retire a size without deleting order history

Mark the item as requiring an option if the member must pick one.

---

## Personalization

For embroidered or engraved items. On the product:

| Setting | Effect |
|---------|--------|
| Enable personalization | Adds a text box to the member's order (placeholder: "Name to embroider") |
| Require personalization | They cannot order without filling it in |
| Label | What the box says — "Name for embroidery" |
| Max length | Character limit (the vendor's limit) |
| Personalization price | Surcharge added per personalized item |

Two shirts with different names are always listed as **separate lines**, never
merged into one line of quantity 2. They are physically different items and
your vendor needs them listed separately.

---

## Product Photos

**Catalog > edit an item > Upload photo.** Up to 5 MB; JPEG, PNG, or WebP.
Images are re-encoded on upload, so the stored file is smaller than what you
sent.

Members shop by picture. A catalog of text rows sells nothing.

---

## Order Windows

**Store Admin > Order Windows tab > New order window.**

A window is an ordering period — you open it, members order, you close it, you
place one bulk order with the vendor.

| Status | Meaning |
|--------|---------|
| Draft | Being set up, invisible to members |
| Scheduled | Has dates but is not open yet |
| Open | Members can order |
| Closed | No new orders; existing ones continue through fulfillment |
| Fulfilled | Everything handed out |
| Cancelled | Called off |

**More than one window can be open at once.** Members land on whichever closes
soonest — that being the deadline that matters to them — and get a switcher for
the others. So an apparel window and a Class B uniform window can run side by
side without either hiding the other.

When creating a window, choose either **all active products** or a specific
list. The specific list is how you run a "Class B uniforms only" window without
archiving the rest of the catalog.

Opening a window can **email the membership**; closing it can **email everyone
who ordered**. The window-closing reminder goes out automatically based on your
notification settings.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Order Windows tab showing an open
> window card with order count, gross sales, outstanding balance, and the
> Close/Cancel actions._

---

## Placing an Order (Member View)

At `/store`:

1. Browse the products in the open window.
2. Pick a size or colour if the item has options.
3. Type the personalization if offered.
4. Set quantity and **Add to cart**.
5. Review the cart — subtotal, tax, shipping, total.
6. Choose **pickup** or **shipping** (shipping asks for an address).
7. Choose a payment method.
8. Add notes if you need to, then **Place order**.

You get an order number like `ORD-2026-0042` and a confirmation email. That
number is what ties your payment to your order — keep it.

If the store is closed, or no window is open, the page says so instead of
showing an empty catalog.

---

## Paying (Member View)

**My Orders (`/store/orders`)** shows each order with its balance and a button
for every payment method the department has set up.

| Method | What you get |
|--------|--------------|
| Venmo | A button that opens Venmo with the amount **and your order number** already filled in |
| PayPal | A button with the amount filled in — type your order number in the note |
| Cash App | A button with the amount filled in — type your order number in the note |
| Zelle | The department's handle, tap to copy — enter it in your own bank's app |
| Check / cash / payroll | The payee and instructions |

Three things worth knowing:

- **You are not stuck with the method you picked at checkout.** Every method the
  department set up stays available. If you chose Venmo and later realise you
  only have Cash App, just use the Cash App button.
- **Zelle has no button on purpose.** Zelle lives inside your own bank's app and
  has no web link, so all anyone can give you is the handle to type. A button
  would go nowhere.
- **Where the button cannot carry your order number, type it.** The screen shows
  it right there. It is what lets your treasurer match your payment to your
  order — without it, your payment lands in a queue for somebody to chase.

After sending, tap **I've sent payment** and enter the reference (Venmo
transaction, check number, etc.). That marks your order as *pending
verification* — it tells the quartermaster to look, it does not mark you paid.
Somebody confirms the money actually arrived.

> **[SCREENSHOT NEEDED]:** _Screenshot of My Orders showing an unpaid order
> with the balance due and a row of payment buttons (Venmo, Cash App) plus the
> Zelle handle and the order reference._

---

## Working the Orders

**Store Admin > Orders tab.** Filter by window, status, or payment status.

Filters: window, order status, payment status, and **payment method**. That
last one is how you reconcile — each app pays out separately, so "show me
everyone who paid by Zelle" is the question you actually have in front of a
bank statement.

| Action | What it does |
|--------|--------------|
| Set status | Move through submitted → ordered → ready for pickup → fulfilled |
| Mark paid | Settle the whole remaining balance in one click |
| Record payment | Enter a specific amount (partial payments) |
| Waive | Clear the balance without money changing hands |
| Refund | Record money going back |
| Message | Post an update to the member (optionally emailing them) |
| Internal notes | Notes only staff see |
| Cancel | Cancel the order |

Select several orders and use **Mark selected paid** or the bulk status change
to move a whole window at once — "everything's in, mark them all ready for
pickup" is one action, not forty.

### Two statuses, not one

Every order has a **fulfillment status** and a **payment status**, and they move
independently:

- A member can pay for a shirt you have not ordered from the vendor yet.
- A shirt can be sitting on the shelf ready for pickup while the member still
  owes for it.

That is why they are separate. Combining them would force one to wait on the
other.

---

## Recording Payment

The common case is **Mark paid**: money arrived out of band for exactly what was
owed, and you just need to say so. It reads the balance off the order, so there
is no amount to mistype.

### Record how they *actually* paid

The **Paid by** dropdown on an order defaults to the method the member chose at
checkout — but change it if they paid another way. Casey picked Venmo and then
handed you cash at drill; record it as **cash**.

This matters more than it looks. If you leave it as Venmo, your treasurer
reconciles the Venmo payout, comes up one payment short, and has no way to
find out why. The **Reference** box next to it takes whatever identifies the
payment — a Venmo transaction, a check number, or just "handed over at drill".

Use **Record payment** when somebody pays part of it, or when you need the
amount on record to differ from the balance.

**Waive** is for the cases where the balance goes away without money — a
replacement for a defective item, a departmental comp. It is recorded as a
waiver, not as a payment, so your totals still tell the truth.

Orders where the member has tapped "I've sent payment" show as **pending
verification** — that is your queue. Confirm the money arrived, then mark it
paid.

---

## Automatic PayPal Reconciliation

Optional. If your department has a PayPal **Business** account, connect it under
**Settings > Integrations > PayPal** and PayPal will tell The Logbook what it
received. Orders whose payment reference carries the order number settle
themselves — no marking paid by hand.

Full setup walkthrough: [Integrations guide, PayPal
section](./16-integrations.md#paypal--store-payment-reconciliation).

A payment settles automatically only when **both** are true:

1. The reference names exactly one order number (`ORD-2026-0042`).
2. The amount equals that order's balance exactly.

Anything else goes to **Store Admin > Payments** for you to decide:

| What you see | What happened |
|--------------|---------------|
| Applied | Matched and settled — nothing for you to do |
| Matched — not applied | Would have settled, but automatic settlement is off |
| No order found | No order number in the reference |
| Needs a decision | Amount doesn't match, or the order is cancelled or already square |
| Dismissed | You decided it wasn't a store payment |

For each one you can **Apply to order** (entering the order if the matcher
couldn't find it) or **Dismiss** it — for a donation, a dues payment, or a
refund that isn't store business.

Payments that match nothing still appear here. That is the point: the money has
already left the member's account, so it has to reach a person rather than
being dropped.

Why only PayPal? Venmo publishes no API for personal transfers, and Zelle runs
inside each bank. PayPal is the only one that can report back.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Payments tab showing an unmatched
> payment with payer name, amount, and the Apply / Dismiss actions._

---

## Telling the Vendor, and Telling the Members

Once you have the tally, place the order with your vendor — then come back and
hit **Record vendor order** on the window.

| Field | Why |
|-------|-----|
| Vendor | Who it went to |
| PO / reference | Their order number, for when you have to chase it |
| Expected delivery | Goes in the email to members |

Recording it does three things in one action, so they cannot drift apart:

1. Stamps who, what reference, and when — so "has this been ordered yet?" is
   answered from the record instead of from memory.
2. Marks every eligible order **ordered**.
3. Emails everyone who ordered, with the vendor and the expected date.

That email is the one members actually want. Between "ordering closed" and
"come pick it up" there can be six quiet weeks, and without it you field the
same question a dozen times.

Orders your payment rule holds back are **skipped**, not marked ordered — they
were not on the sheet the vendor received. The result tells you how many moved
and how many were held, so you know who to chase.

---

## Closing a Window and Ordering from the Vendor

1. **Close ordering** — no new orders; existing ones keep moving.
2. Open the window's **Tally**. It shows the money — order count, members,
   gross, collected, outstanding — then two tables.
3. **Order this from the vendor** is the purchase order: quantity per size,
   merged across every member. *"10 job shirts — 3 M, 2 L, 3 XL, 1 2XL, 1 3XL."*
   This is what you send the vendor. If your rule is *payment before the vendor
   order*, unpaid members are excluded here and listed under **Held back**
   instead.
4. **Line detail** below it breaks the same shirts out by embroidery name. That
   is what the vendor stitches. On a personalized item the two always differ —
   ten shirts, ten names, five sizes.
5. Export the CSV if the vendor wants it as a file rather than a screenshot.
   It keeps **every** order, unpaid ones included, because it doubles as the
   treasurer's record — so under the *payment before the vendor order* rule,
   check the **Held From Vendor Order** column and drop the `yes` rows before
   sending it. Without that step you would mail the vendor a sheet that undoes
   the rule you set.
6. When the goods arrive, bulk-set the window's orders to **ready for pickup**.
7. Hand them out, mark **fulfilled**, then mark the window fulfilled.

The outstanding-balance figure is your chase list. Sort the Orders tab by
payment status to find who still owes.

---

## Realistic Example: A Fall Job-Shirt Window

**Setup (September)**

1. Settings: tick Venmo, Cash App, Zelle and Check. Enter the handle, the
   `$cashtag`, the treasurer's Zelle email, and who checks are payable to.
   Under **What happens to an unpaid order?**, this department picks *payment
   required before the vendor order* — they won't front the cost of a shirt
   somebody might never pay for.
2. Catalog: create "Department Job Shirt", $45, taxable, max 2 per member.
   Upload a photo. Add options S–3XL, with `+3.00` on 2XL and 3XL.
3. Enable personalization: label "Name for embroidery", max 20 characters,
   $8.00 surcharge.
4. Save as **Draft**, check the member view, flip to **Active**.

**Opening (October 1)**

5. Create window "Fall Apparel 2026", closing October 21, all active products.
   **Open ordering** — with the notify option on, the department gets an email.

**During**

6. Orders arrive. 14 members order 19 shirts, 11 personalized.
7. Members pay by Venmo and Cash App from their My Orders page. Venmo payments
   carry the order number; Cash App ones need it typed, and the screen tells
   them so.
8. You mark each paid as the money lands — or, with PayPal connected, the
   PayPal ones settle themselves.

**Closing (October 21)**

9. **Close ordering** on the window. Summary reads: 14 orders, 19 shirts,
   $921.00 gross, $812.00 collected, $109.00 outstanding — 12 members paid, 2
   have not.
10. **Order this from the vendor**: 2 M, 6 L, 7 XL, 1 2XL, 1 3XL — **17
    shirts**, not 19. **Line detail** lists the 9 names to embroider on them.
    Send both.
11. **Held back — unpaid (2 orders)** sits underneath: 1 M and 1 2XL, $109.00
    between them. Their shirts are deliberately *not* in the 17, they are not
    on the embroidery list, and their orders cannot be marked ordered. Chase
    them; the moment they pay they rejoin the totals — add them to this run if
    the vendor hasn't started, or catch them on the next one.
12. Sort by payment status for the reminder list.

**Fulfillment (November)**

13. 17 shirts arrive. Bulk-set the window's orders to **ready for pickup** —
    the 2 held-back orders are skipped, because there is no shirt on the shelf
    for them to be ready for.
14. Hand them out at drill and mark **fulfilled**. The bulk action moves the 12
    paid orders and returns the 2 unpaid ones by order number with what they
    owe — so you know exactly who to find before handing anything over.
15. Mark the window fulfilled.

---

## Troubleshooting

**A member says the store is empty.**
Check that a window is **open** (not draft or scheduled), that products are
**Active** (not draft), and — if the window uses a specific product list — that
the products are actually on it.

**A payment button isn't showing.**
The method has to be both ticked in Settings *and* have its details filled in. A
method with no handle is hidden on purpose, so members never get a button that
goes nowhere. Check the handle saved without an error.

**There's no Zelle button.**
There is never a Zelle button. Zelle runs inside each bank's app and has no web
link — members get the handle to copy instead.

**An unpaid member's shirt isn't in the vendor order.**
That is the *payment required before the vendor order* rule doing its job. They
are listed under **Held back** on the Tally. Record their payment and they
rejoin the totals; if you want them ordered anyway, switch the rule to
*payment required before pickup*.

**I can't mark an order fulfilled.**
Under either payment rule, an order with a balance due cannot be handed over.
The error names the amount owed. Record the payment, or waive the balance if
the department is comping it.

**I can't mark a held order ready for pickup either.**
Under *payment required before the vendor order* their item was never bought,
so it cannot be on the shelf. Marking it ready would email them to come and
collect something that does not exist. Take their payment and it unblocks.

**The treasurer's Venmo total doesn't match the store.**
Check the **Paid by** column. If somebody paid cash or by check and it was
recorded as Venmo, the store and the payout will disagree by exactly that
amount. Open the order and correct the method.

**A member paid but their order still says unpaid.**
Paying happens outside The Logbook, so nothing changes until someone records
it. If they tapped "I've sent payment", the order is in **pending
verification** — confirm and mark it paid. With PayPal connected, check the
**Payments** tab: it may be sitting there because the amount didn't match or
the reference had no order number.

**PayPal payments aren't arriving at all.**
The integration needs a **Webhook ID**, not just credentials. Without it,
deliveries can't be verified and are rejected. Test Connection warns you when
it's missing. Also confirm the webhook is subscribed to *Payment capture
completed*.

**The vendor tally doesn't match what I counted.**
The tally counts all non-cancelled orders in the window. Cancelled orders drop
out; unpaid ones do not — somebody who ordered and hasn't paid still needs a
shirt ordered for them.

**A member ordered the wrong size.**
Cancel the line and have them reorder while the window is open. After closing,
edit the order and message them so the change is on the record.

---

## Related Guides

- [Integrations](./16-integrations.md) — connecting PayPal
- [Inventory Management](./05-inventory.md) — linking store products to
  inventory records
- [Finance](./11-finance.md) — how store income relates to budgets and dues
