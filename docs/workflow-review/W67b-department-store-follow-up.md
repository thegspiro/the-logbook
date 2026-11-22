# Workflow Review — W67b The Department Store, Follow-up

**Driven:** 2026-11-13 · **As:** `quartermaster`, `member`, `member2` · **Viewports:** 1280×900
**Commit:** `71bfff68` · **Database:** fresh (`start.sh --reset`, then `seed.mjs`)

---

W67 covered setup, a single order taken through payment and fulfilment, and
the phone layout. This pass picks up what W67 did not reach:

- shipping;
- personalization;
- part payments;
- a member cancelling an order that already has money on it;
- status changes made out of order;
- stock that has to last across more than one order window.

It also reads the parts of the module no earlier pass had read in full: the
member and admin screens of `modules/storefront`, the window lifecycle, the
vendor-order step and the notification triggers.

**Nothing was changed.** Every finding below is OPEN or FLAGGED. Several change
behaviour that departments rely on — what stock means, when a member may
cancel, which status moves are legal — so they wait for the owner rather than
being fixed on review.

## What was driven

Setup went through the API as `quartermaster`, because W67 already drove the
setup screens:

- the store, with Cash and Venmo, pay-before-pickup, 7% tax, $5 flat-rate
  shipping, and both pickup and shipping allowed;
- a "Station Hoodie" at $40, taxable, size required, stock tracked (M: 1,
  L: 5), with name embroidery at +$5;
- a "Ball Cap" at $15;
- one open order window, "Winter 2026".

Then:

1. As `member`, in `/store`:
   - added the hoodie in M, embroidered "J. SMITH", and the cap;
   - opened checkout, chose "Ship to me", typed an address, and switched back
     to pickup;
   - submitted, which placed ORD-2026-0001;
   - checked what the API stored for that order.
2. As `quartermaster`, in Inventory Administration → Department Store →
   Orders, opened Manage on ORD-2026-0001 and read the whole dialog. Then
   recorded a $20 part payment there.
3. As `member`, in My Orders, pressed Cancel order and confirmed it.
4. As `quartermaster`, read the store overview tiles and the window summary.
5. As `member2`:
   - placed ORD-2026-0002;
   - added an item to the cart, then loaded and reloaded `/store/checkout`.
6. As `quartermaster`, through the API, took ORD-2026-0002 through these
   steps:
   - mark paid;
   - status Fulfilled;
   - status Awaiting payment;
   - status Cancelled;
   - a payment against the cancelled order.
7. As `quartermaster` then `member2`, through the API:
   - a product priced $3 with a "Youth" size at −$5, ordered beside the cap.
     The product was deleted afterwards;
   - a $150 payment recorded against a $15 order.
8. As `member2` then `member`:
   - ordered the last M hoodie in "Winter 2026";
   - the quartermaster opened a second window;
   - `member` read that window's offers and ordered the same hoodie in M.

**Not driven:**

- the phone viewport, which W67 covered;
- PayPal reconciliation, covered by the app review;
- every email. This install sends none, so each email finding below is read
  from code.

## Held up ✅

- **Pricing matches between screen and server.** The cart, the checkout
  summary and the stored order agreed:
  - a $60.00 subtotal;
  - $3.15 tax, which is 7% of the $45 taxable hoodie line only;
  - a $63.15 total, or $68.15 with shipping selected.

  The embroidery upcharge showed on the line ("Size M · Embroidered “J. SMITH”
  (+$5.00)").

- **The saved cart came back** after a full page load of `/store`.
- **My Orders states the balance,** the reference to quote, and a per-method
  "Pay $63.15 with Cash" and "Pay with Venmo".
- **A part payment** moved the order to "Partially paid" and lowered the
  balance and the "Mark paid in full" amount to $43.15.
- **The member's cancel asks first:** "Cancel ORD-2026-0001? … cannot be
  reopened".
- **A cancelled order refuses a payment:** 400, "A cancelled order cannot take
  a payment".
- **Browser signals:** no console errors and no failed API calls on any
  driven screen.

## Findings

### W67b-1 — HIGH — Tracked stock is sold again in every order window — FLAGGED

**Did:**

- gave the hoodie stock 1 in M;
- as `member2`, ordered that unit in "Winter 2026";
- opened a second window;
- as `member`, read the second window's offers.

**Saw:**

- The M variant still offered `availableQuantity: 1`, `stockAvailable: 1`.
- The order was accepted (ORD-2026-0006).
- One unit of stock was sold twice.

**Expected:** stock that is tracked is the department's stock, not each
window's.

**Where:** `storefront_service.py`:

- `_remaining_units` and the variant equivalent subtract units ordered in
  this window only;
- `_ordered_quantities` filters on `window_id`;
- nothing ever writes `stock_quantity` back.

The SF-8 locks serialize within one window's tally, so they cannot catch this.

**Why flagged:** "stock" needs a definition from the owner:

- (a) units on hand: decrement on order, restore on cancel;
- (b) count every non-cancelled order across all windows.

Either changes what existing departments see as available.

### W67b-2 — HIGH — Money paid on an order the member cancels drops out of the books — FLAGGED

**Did:**

- recorded a $20 part payment on ORD-2026-0001 as `quartermaster`;
- cancelled the order as `member` from My Orders.

**Saw:**

- The cancel was allowed. A part payment leaves the status at "Awaiting
  payment", which is in `_MEMBER_CANCELLABLE_STATUSES`.
- My Orders moved the order under "Settled orders" as "Cancelled · $63.15",
  with no mention of the $20.
- The store overview read Awaiting payment 0, Outstanding $0, Needs attention
  0, Collected (open window) $0.00.
- The window summary read `collected: 0.00`.
- No admin was notified: the member path cancels with `notify_member` and
  sends nothing to staff.

**Expected:** a member with money on an order either cannot cancel it, or the
cancel puts a refund in front of the quartermaster.

**Where:**

- `storefront_service.py`:
  - `cancel_order` and `_MEMBER_CANCELLABLE_STATUSES`;
  - `record_payment`, which leaves the status unchanged on a part payment;
  - `_order_rollup`, which excludes cancelled orders entirely;
- `MyOrdersPage.tsx`: `isSettled` treats any cancelled order as settled.

**Read from code, same class:**

- A member can also cancel while a reported payment is pending verification.
  That money can then be neither recorded (the order is cancelled) nor
  refunded (`amount_paid` is 0).
- The cancellation email still promises a refund will be arranged.

**Why flagged:** whether a member may cancel once money is recorded, and how
the refund is surfaced, are owner decisions. The likely shape:

- refuse a member cancel when `amount_paid > 0` or a payment report is
  pending;
- notify staff on any member cancel;
- list "cancelled with money held" on the admin hub.

### W67b-3 — HIGH — The quartermaster cannot see where to send a shipped order — ✅ FIXED (2026-11-14)

**Did:** opened Manage on ORD-2026-0001 as `quartermaster`.
**Saw:** the dialog lists the items, Total, Paid, Balance due and Method.
Nowhere in it, nor on the order row, are these:

- pickup or ship;
- the shipping address;
- the member's notes;
- the subtotal, tax and shipping lines.

`grep` finds `shippingAddress`, `memberNotes` and `fulfillmentMethod` only in
`CheckoutPage.tsx`. The data is in the API response, and in the CSV export,
but on no screen. My Orders does not show the member their own address or
delivery choice either.

**Expected:** a shipped order shows its address, and every order shows what the
member asked for, where the person fulfilling it works.

**Where:** `components/OrderDetailModal.tsx`, `pages/MyOrdersPage.tsx`.
**Fix:** frontend only. The API already returned every field. A new
`components/OrderDeliveryDetails.tsx` holds two pieces that both screens use:

- `OrderDeliveryDetails` shows pickup or ship, the address (shipped orders
  only) and the member's notes. It reads "Ship to the member" and "Member's
  notes" to staff, and "Ship to me" and "Your notes" to the member.
- `OrderChargeRows` shows the subtotal, tax, shipping and discount lines above
  the total. When the total is the subtotal alone it shows nothing, since a
  "Subtotal" row equal to "Total" explains nothing.

The address is left off a pickup order even when one is stored, so the order
cannot read as one to ship. That hides W67b-9 on screen; it does not stop the
address being stored.

**Tests:** `components/OrderDetailModal.test.tsx` (new, three cases) and one
new case in `pages/MyOrdersPage.test.tsx`. All four failed against the
unchanged screens, on the missing text, and pass now.

**Re-driven:** as `member`, checked out a Ball Cap with "Ship to me", a
two-line address and a note (ORD-2026-0007). My Orders showed the $15.00
subtotal, $5.00 shipping, the address and "Your notes". As `quartermaster`,
Manage on the same order showed the same lines in a Delivery panel, at
1280×900 and at 390×844 with no sideways overflow. No console errors and no
failed API calls.

### W67b-4 — MED — An order's status can be moved anywhere, including backwards and to Cancelled — ✅ FIXED (2026-11-14)

**Did:** as `quartermaster`, through `POST /store/orders/{id}/status`, took
ORD-2026-0002 Paid → Fulfilled → Awaiting payment → Cancelled.

**Saw:**

- Every step returned 200.
- After Fulfilled → Awaiting payment, the order read `awaiting_payment`, but
  its payment was still `paid` and it was still stamped fulfilled.
- Cancelled through this route left `cancelledAt` null and kept
  `amountPaid: 15.00`. It skips the cancellation record and the cancellation
  notice.

**Where:** `storefront_service.py` `update_order_status`. Its only guard is
"a cancelled order cannot be advanced". The bulk status endpoint shares it.

**Read from code:** setting the same status again re-sends the status email.

**Owner decision (2026-11-14):** backward moves are allowed only as
fulfilment corrections. The alternatives were "forward only" and "any move,
guard contradictions".

**Fix:** `update_order_status` in `storefront_service.py`, which the single
and bulk endpoints share, now applies these rules:

- **Forward moves** are allowed as before, payment gate included.
- **Backward moves** are allowed only among Ordered / Ready for pickup /
  Fulfilled. Leaving Fulfilled clears `fulfilled_at`, `fulfilled_by` and each
  item's `fulfilled_quantity`.
- **No move back into Submitted, Awaiting payment or Paid,** which follow the
  payment ledger. A settled order cannot be set to Submitted or Awaiting
  payment either.
- **The same status again** is a no-op: no timeline event and no email.
- **Cancelled is still accepted,** but is routed to `cancel_order`, so it
  records the date, the reason (the status note) and the cancellation
  notice. Existing callers and tests that cancel this way keep working.

The rules live in `_STATUS_STAGE`, `_FULFILMENT_STAGES` and
`_status_transition_error`, and are documented under "Order lifecycle" in
`docs/STOREFRONT_MODULE.md`.

**Lock handling in bulk updates:** a bulk move to Paid now rolls back after
a refused order, releasing that order's row lock rather than carrying it
into the next, as `bulk_mark_paid` does. The rollback is limited to Paid,
the only target that locks. A first version rolled back on every refusal.
That made `test_bulk_fulfill_reports_who_was_held_back` fail, and it would
have crashed `record_vendor_order`, which uses its window object after
calling the bulk update.

**Tests:** `TestOrderStatusTransitions` in `tests/test_storefront_service.py`
has seven cases:

- the same status is a no-op;
- Cancelled through the route is a real cancellation;
- no move back into a payment state;
- a settled order cannot be marked Awaiting payment;
- a fulfilment correction clears the fulfilled stamps;
- bulk skips and reports a refused move;
- bulk to Paid goes on past a refused order.

Each failed against the old service. 571 storefront, payment, locking and
separation-of-duties tests pass.

**Re-driven** on the review install, restarted onto the new code:

1. As `member2`, placed ORD-2026-0008; as `quartermaster`, marked it paid.
2. In Manage, Fulfilled was accepted.
3. Awaiting payment was refused. The toast read "This order is already
   settled, so it cannot be marked awaiting payment", and the badge stayed
   Fulfilled.
4. Ready for pickup was accepted, with `fulfilledAt` null, the item's
   fulfilled quantity 0 and the payment still Paid.
5. Through the API:
   - the same status again added no timeline event (4 before, 4 after);
   - Paid was refused with 400 ("An order cannot move back from ready for
     pickup to paid…");
   - Cancelled with the note "Duplicate order" set `cancelledAt` and stored
     that note as the reason.

The only failed request was the deliberate refusal.

**Still open, related:**

- The dialog's status list still offers every status, including moves the
  server now refuses; a refused move shows its reason. Filtering the list
  would re-implement the rule in the browser (CLAUDE.md Pitfall #29). The
  clean fix is for the API to report each order's allowed moves.
- `record_vendor_order` still moves Ready for pickup orders back to Ordered
  (W67b-13). Under these rules that is a permitted correction, so W67b-13's
  fix is to advance only orders before Ordered.

### W67b-5 — MED — Admins have no way to cancel an order on screen — ✅ FIXED (2026-11-14)

**Saw:** the order dialog has no Cancel action. Its status list is Awaiting
payment, Paid, Ordered from vendor, Ready for pickup and Fulfilled.

`POST /store/orders/{id}/cancel` exists, and so does
`storefrontService.cancelOrder` in `services/api.ts`, but nothing calls it.
The only ways to cancel are the member's own button and the status route in
W67b-4, which records the cancel badly.

**Where:** `components/OrderDetailModal.tsx`.

**Fix:** the order dialog now has a "Cancel order" section with an optional
reason, which the member is shown. It calls the existing
`POST /store/orders/{id}/cancel`, so the cancel is recorded properly, with the
date, the reason and the cancellation email. No backend change.

- **It asks first:** "Cancel ORD-…? … cannot be reopened", with "Keep order"
  and "Cancel order", as the member's own cancel does (W67-3).
- **It names money already recorded.** Cancelling leaves `amount_paid`
  alone, so the confirmation says "$N has been recorded on this order.
  Cancelling does not refund it — use Refund to record the money going
  back." That is the part of W67b-2 a screen can warn about. Whether a
  cancel with money held should be allowed at all is still the owner's
  decision.
- **A cancelled order shows why it was cancelled.** The dialog shows the
  date and the reason, and any amount still recorded as paid.
- **It hides what the server refuses on a cancelled order:** Mark paid,
  Record payment, Waive payment, Change status and the "Balance due" row.
  Refund stays, since the server still accepts it.

**Tests:** four new cases in `components/OrderDetailModal.test.tsx`:

- cancelling sends the reason;
- "Keep order" sends nothing;
- the confirmation names money already recorded;
- a cancelled order offers Refund and nothing the server refuses.

All four failed against the unchanged dialog and pass now. The no-"Balance
due" assertion was added after the re-drive below and also failed first.

`StoreOrdersTab.test.tsx` now renders the tab inside `ConfirmProvider`, as
the app shell does. The dialog it opens calls `useConfirm()`, which throws
without one. No assertion there changed.

**Re-driven:**

1. As `quartermaster`, recorded $5.00 on ORD-2026-0007.
2. In Manage, typed a reason and pressed Cancel order.
3. The confirmation named the $5.00. After confirming, the order was stored
   cancelled with its date and reason, with the $5.00 still recorded.
4. The dialog then offered only Refund, Send update and Save notes.
5. As `member`, My Orders showed the order as cancelled.

No console errors and no failed API calls.

**Seen while fixing, not changed:** `WriteOffsPage.tsx` and
`ReorderRequestsPage.tsx` in the inventory module use a `btn-danger` class
that `styles/index.css` does not define, so those buttons render unstyled.
It is outside this module; it is recorded here as a lead.

### W67b-6 — MED — A size can be priced below zero — ✅ FIXED (2026-11-16)

**Did:**

- created a $3 product whose only size was "Youth" at −$5;
- as `member2`, ordered 5 of it beside the $15 cap.

**Saw:** 201, total $5.00. The −$2 lines were accepted.

**Read from code:** an order whose total reaches $0 or less is created already
marked PAID with `paid_at` set.

**Where:**

- `schemas/storefront.py`: `price_delta` allows `ge=-MONEY_MAX`;
- `storefront_service.py` `_price_lines`: no floor on the unit price;
- `create_order`: the `total <= 0` branch.

**Fix:** in `storefront_service.py`, `_option_below_zero` checks whether any
active option's price falls below zero. An option may still lower the price,
down to exactly zero. The check runs in four places:

- **`create_product`**, against the options sent;
- **`update_product`**, against the product as it will be after the update,
  since a lower base price can take an existing option below zero;
- **`_replace_offerings`**, against a window's price override with each of
  the product's active options. Every offering is checked before the
  window's old offerings are deleted, so a refused save changes nothing;
- **`_price_lines`**, refusing any order line priced below zero. This is the
  guard nothing bypasses: it also catches prices saved before the
  save-time checks existed.

**Tests:** `TestNoPriceBelowZero` in `tests/test_storefront_service.py`:

- a product with an option below zero is refused;
- an option that brings the price to exactly zero is allowed;
- lowering the base price under an option is refused;
- a window override under an option is refused;
- an order line below zero, from a price stored directly in the database, is
  refused.

The four refusal cases failed against the old code; the zero case passed both
before and after, as a guard.

**Re-driven:** creating "Patch" at $3.00 with a "Youth" option at −$5.00 is
refused with 400: "'Patch' would be priced below zero for 'Youth': 3.00 with
-5.00 comes to -2.00. An option can lower the price, but not below zero."
A $5.00 product with the same option is accepted.

### W67b-7 — MED — A payment larger than the balance is accepted — ✅ FIXED (2026-11-16)

**Did:** recorded $150 against a $15 order as `quartermaster`.
**Saw:** 200; `amountPaid: 150.00`, `balanceDue: 0`.

The window's collected figure is inflated by $135. Dues payments refuse an
overpayment; the store does not. A payment against an already-paid order is
accepted the same way.

**Where:** `storefront_service.py` `record_payment`.

**Owner decision (2026-11-15):** refuse a typed overpayment; record a PayPal
capture as it arrived, and show the excess as owed back to the member. The
alternatives were "refuse everywhere" and "warn and allow", the dues pattern,
which the store cannot follow since it has no donation path.

**Fix:**

- **Typed payments:** `record_payment` refuses an explicit amount above the
  balance: "That is more than the 15.00 still owed on this order. Record
  15.00, and return the rest to the member." It also refuses any explicit
  amount on an order already paid in full. Settling the balance (`amount`
  left out) is unchanged.
- **PayPal captures:** `apply_payment_event` passes `allow_overpayment=True`,
  so applying a capture records the money that actually arrived and the
  ledger matches PayPal.
- **Showing the excess:** the order response gains `overpaid_amount` (an
  additive field), money recorded beyond the total.
  - The admin order dialog shows "$5.00 more than the order total has been
    recorded. It is owed back to the member." It offers "Refund the $5.00
    excess", which asks first.
  - My Orders shows the member "Owed to you $5.00".
- **Refund status:** `refund_order` now sets the payment status from what is
  left. Refunding only the excess leaves the order Paid; it used to read
  Partially paid after any partial refund.

**Tests:**

- `TestTypedOverpayment` in `tests/test_storefront_service.py`, three cases:
  more than the balance is refused, a payment on an order paid in full is
  refused, and the exact balance still settles.
- `TestAppliedOverpayment` in `tests/test_storefront_reconciliation.py`, two
  cases: an applied overpaying capture is recorded in full, and refunding
  only the excess leaves the order Paid.
- In `components/OrderDetailModal.test.tsx` and `pages/MyOrdersPage.test.tsx`:
  the excess is offered for refund at exactly its amount, nothing is offered
  when there is none, and the member sees what they are owed.

Every case that checks new behaviour failed against the old code. The
exact-balance, applied-capture and nothing-overpaid cases passed before and
after, as guards for behaviour that must not change.

`OrderDetailModal.test.tsx` had a bare `refundOrder: vi.fn()` in its service
mock, and the later key silently overrode the recording mock, so the new
refund test first failed on wiring rather than behaviour. The duplicate key is
removed; no assertion changed.

**Re-driven** on the review install, restarted onto the new code:

1. In Manage on ORD-2026-0009 ($15.00), typed 150 and pressed Record payment.
   The Payment section showed the refusal above, and nothing was recorded.
2. A $20.00 PayPal capture for the order was recorded through the webhook's
   own `record_external_payment` and listed as "Needs a decision". Applying
   it from the Payments tab recorded $20.00: Paid, $0.00 due, $5.00 overpaid.
3. As `member2`, My Orders showed "Owed to you $5.00".
4. As `quartermaster`, Manage showed the excess notice. "Refund the $5.00
   excess" asked "Refund $5.00 to Alex Brooks?". After confirming, the order
   read $15.00 paid and still Paid, and the notice was gone.

The only failed request was the deliberate refusal.

**Not changed:** on an order paid in full, the Payment section still offers
Record payment. The server now refuses it ("This order is already paid in
full"), so nothing wrong is recorded, but the control could be hidden.

### W67b-8 — LOW — Refund is one tap and always refunds everything — ✅ FIXED (2026-11-16)

Read from code, not clicked:

- Refund in the order dialog has no confirmation and no amount field, so it
  refunds the whole amount paid and emails the member.
- The endpoint accepts a partial `amount`.
- Every other irreversible action in this module asks first (W67-3).

**Where:** `components/OrderDetailModal.tsx` `refund`.

**Fix:** Refund now has its own section in the order dialog, in place of the
one-tap button in the Payment row. Frontend only.

- **An amount,** defaulting to everything paid, so a partial refund is
  possible. An amount of zero, or above what was paid, is named on its field
  ("Enter no more than the $15.00 paid.") before anything is asked or sent.
- **A reason,** shown to the member.
- **A question first:** "Refund $5.00 to Jordan Avery?" with "Not now" and
  "Refund $5.00".
- **Shown whenever money has been paid,** cancelled orders included: that is
  how money on a cancelled order goes back. A cancelled order no longer shows
  a Payment section, since nothing in it applies.

**Tests:** three new cases in `components/OrderDetailModal.test.tsx`:

- the whole amount paid is offered, and the amount and reason given are
  refunded once confirmed;
- backing out records nothing;
- an amount above what was paid is named on its field, and nothing is asked
  or sent.

All three failed against the old dialog. In the existing cancelled-order
case, the selector for the refund button changed from `/Refund/` to "Record
refund" to match the new label; what it checks is unchanged.

**Re-driven:** see W67b-9. ORD-2026-0010 was marked paid ($15.00).

1. The Refund amount defaulted to 15.00.
2. Entering 100 showed the field error and opened no confirmation.
3. Entering 5 with a reason asked "Refund $5.00 to Jordan Avery?".
4. After confirming, the order read $10.00 paid, Partially paid, $5.00 due,
   with the reason on the timeline.

### W67b-9 — LOW — A pickup order keeps the home address typed for shipping — ✅ FIXED (2026-11-16)

**Did:**

- chose "Ship to me";
- typed "12 Elm St, Springfield";
- switched back to "Pick up at Station 1";
- submitted.

**Saw:** the stored order is `fulfillmentMethod: pickup` with that address in
`shippingAddress`. The hidden textarea keeps its value and is sent anyway, and
the server stores it whatever the method. A member's home address is kept on
an order that has no use for it.

**Where:** `pages/CheckoutPage.tsx` `handleSubmit`; `storefront_service.py`
`create_order`.

**Fix:** both ends.

- Checkout sends an address only when the order ships.
- `create_order` stores one only for a shipped order, whatever a client sends.
- The order screens already hide an address on a pickup order (W67b-3).

**Tests:**

- `CheckoutPage.test.tsx`: an address typed for shipping is not sent after
  the member switches back to pickup.
- `TestPickupKeepsNoAddress` in `tests/test_storefront_service.py`: a pickup
  order stores no address, and a shipped order keeps its address.

The two cases checking the fix failed against the old code; the
shipped-order case passed before and after, as a guard.

**Re-driven:** as `member`, checked out a Ball Cap, typed an address under
"Ship to me", switched back to pickup and submitted. ORD-2026-0010 was stored
`pickup` with no address.

**Not changed: addresses already stored on pickup orders.** Clearing them
would mean a data migration that deletes member data, which needs the
owner's go-ahead. Until then they stay in the database, though no screen
shows them.

### W67b-10 — LOW — Loading the checkout page directly sends the member back to the store — ✅ FIXED (2026-11-17)

**Did:** as `member2`, with an item in the cart, loaded `/store/checkout`
directly, then reloaded it.

**Saw:** both landed on `/store`. The cart itself survived.

The page checks `cart.length === 0` before `loadStorefront` has restored the
saved cart, and bounces. Its own comment still says the cart is "deliberately
unpersisted", which W67-6's fix of 2026-10-27 made untrue.

**Where:** `pages/CheckoutPage.tsx`.

**Fix:** `CheckoutPage.tsx` makes no decision about the cart until the store
has loaded, since loading it is what restores the cart saved in this browser.
Frontend only.

- **While loading:** the page shows its loading skeleton.
- **If the load fails:** it shows the error with "Try again", where it used
  to drop the member on the store.
- **Once loaded:** an empty cart still goes back to the store, as before.
- **Stale comment corrected:** the page no longer says the cart is "deliberately
  unpersisted".

**Tests:** three new cases in `pages/CheckoutPage.test.tsx`:

- a reload with a saved cart comes back to the review;
- a failed load shows the error and a retry;
- an empty cart is still sent to the store once the store has loaded.

The first two failed against the old page; the third passed before and after,
as a guard.

**Re-driven:** as `member2`, added a Ball Cap and opened checkout. After a
reload, and after loading `/store/checkout` directly, the page stayed on
"Review your order" with "Ball Cap × 1". No console errors and no failed
requests.

### W67b-18 — LOW — The progress steps on a shipped order end at "Ready for pickup" — ✅ FIXED (2026-11-17)

**Saw:** while re-driving W67b-3, the step list on My Orders for the shipped
ORD-2026-0007 read Submitted, Payment due, Ordered, Ready for pickup.

**Where:** `components/OrderStatusStepper.tsx` does not read
`fulfillmentMethod`. The order statuses have no shipped state either, so a
fix needs a decision on what a shipped order's last step is called and when it
is reached.

**Owner decision (2026-11-17):** relabel everywhere. A shipped order keeps
the same statuses, but "Ready for pickup" reads "Ready to ship" and
"Fulfilled" reads "Shipped". The alternatives were the progress steps only,
or a new Shipped status with its own transitions and migration.

**Fix:** no new status, no migration, no change to stored data.

- **Backend:** `_status_label` in `storefront_service.py` gives the shipping
  wording to the status-change email (its subject and body), the order
  timeline entry, the payment-gate refusal and the status-transition refusal.
- **Frontend:** `utils/orderStatus.ts` `orderStatusLabel` mirrors it. The
  wording follows each order's delivery method in:
  - the member's progress steps and badge (My Orders);
  - the staff order dialog's badge and status picker;
  - the orders list row;
  - the admin overview's recent orders.
- **Left general:** lists that mix pickup and shipped orders keep the general
  wording. That covers the status filters, the overview counts, and the
  activity feed built from events alone.

**Tests:**

- `TestShippedOrderWording` in `tests/test_storefront_service.py`: a shipped
  order's email and timeline read "Ready to ship" and then "Shipped"; a
  pickup order keeps "Ready for pickup".
- `utils/orderStatus.test.ts` covers the label helper.
- `MyOrdersPage.test.tsx` and `OrderDetailModal.test.tsx` cover the progress
  steps, badges and status picker for a shipped order.

The shipped-order cases failed against the old code; the pickup cases passed
before and after, as guards.

**Re-driven:**

1. As `member2`, placed a shipped order (ORD-2026-0011); as `quartermaster`,
   marked it paid.
2. In Manage, the status picker offered "Ready to ship". After choosing it,
   the badge read "Ready to ship" and the timeline "Status changed to Ready
   to ship".
3. As `member2`, My Orders showed "Ready to ship" in the badge and as the
   last progress step.

No console errors and no failed requests.

### Read from code, not driven

These came from a read of the backend paths no earlier pass covered. Each was
traced in the code; none was exercised in the browser, mostly because this
install sends no email.

- **W67b-11 — HIGH — "Placed with the vendor" is emailed to members whose
  unpaid orders were held back.** `record_vendor_order` skips unpaid orders
  under pay-before-vendor-order. It then mails `_window_customer_emails`,
  which is every non-cancelled order in the window. ✅ **FIXED
  (2026-11-21).** Under that policy the notice goes only to members whose
  orders are settled. "Settled" is decided by the same `_is_settled` rule
  that holds an order back, so the two cannot disagree. Other policies are
  unchanged. Two tests in `TestVendorOrderNoticeRecipients`
  (`tests/test_storefront_notifications.py`); the held-member case failed
  against the old code. Not driven in the browser, since this install sends
  no email.
- **W67b-12 — MED — Cancelling or fulfilling a window has no transition guard
  and leaves its orders open.** Payment reminders then keep chasing members
  for goods that will never be ordered. Where: `set_window_status`;
  `run_payment_reminders` filters on order status only. ✅ **FIXED
  (2026-11-21).** Owner decisions:
  - **Cancelling a window** (`cancel_window`) cancels each order still open
    in it, through `cancel_order`. Each gets its date, the reason "The order
    window was cancelled", a timeline entry and the member's notice. It is
    refused while any of those orders has money recorded or a payment report
    waiting, naming them, so no money is left on cancelled orders (W67b-2).
    A fulfilled window cannot be cancelled. Cancelling again changes
    nothing, and nobody is emailed twice.
  - **Marking a window fulfilled** (`fulfill_window`) is allowed only for a
    closed window, and only once every order in it is fulfilled or
    cancelled. Otherwise it is refused with the number still outstanding.
  - **Payment reminders** skip orders in a cancelled window, which covers
    windows cancelled before this fix. Orders whose window was deleted are
    still reminded.
  - `set_window_status` is removed; its only two callers were these
    endpoints.

  **Tests:** seven in `TestWindowCancelAndFulfil`
  (`tests/test_storefront_service.py`). Six exercise the two new methods, so
  against the old code they fail because the methods do not exist; the
  reminder case failed on the behaviour itself.

  **Re-driven:**
  1. Cancelling a window holding a $5 payment was refused, naming
     ORD-2026-0013.
  2. After the refund, the window cancelled, and both of its orders read
     "The order window was cancelled".
  3. Cancelling it again changed nothing.
  4. In the windows tab, "Mark fulfilled" on a closed window with three open
     orders showed "3 orders are not fulfilled or cancelled yet…", and the
     window stayed closed.

- **W67b-13 — MED — `record_vendor_order` has three faults.**
  - It advances only the first 200 orders.
  - It moves Ready for pickup orders back to Ordered.
  - Run again, it re-sends the vendor email to everyone, with no idempotency
    key (pitfall #36).

  ✅ **FIXED (2026-11-21).**
  - It now selects every order in the window still before Ordered
    (submitted, awaiting payment, paid), with no page limit. Ready and
    fulfilled orders are never selected, so they stay where they are.
  - Who is emailed depends on what the call did. The members whose orders
    this call advanced are told. On the first recording only, everyone
    `_window_customer_emails` names is told as well, which covers orders
    an officer had already moved to Ordered by hand. A later recording,
    such as correcting the vendor reference, emails nobody. A member who
    paid after the first recording is ordered and told on the next one.
    The order status itself is the idempotency key: an order already
    Ordered is not selected again.
  - Two recordings submitted in the same instant can both pass the
    status check before either commits. Each order is moved once, but its
    member could be emailed twice. Closing that needs the window row held
    across the per-order commits, which `update_order_status` does not
    allow, so it is left as a residual.

  - **Found while re-driving it: recording a vendor order that advanced
    any order returned a 500.** The orders were advanced and the members
    emailed, then serializing the response failed: each order's commit
    expired the window, and its offerings lazy-loaded outside the session
    (MissingGreenlet). The officer saw an error for a recording that had
    worked, which invited recording it again and the duplicate emails
    above. The window is now re-read before the response is built. The old
    code fails the same way.

  **Tests:** five in `TestVendorOrderRerun`
  (`tests/test_storefront_service.py`), all seen to fail against the old
  code: every order past the page size, an order on the shelf left there,
  no second email with or without advancing, and the late payer ordered
  and told. A sixth calls the endpoint and validates its response; it
  failed with MissingGreenlet against both the old and the unfixed new
  code.

  **Re-driven:** two orders in a closed window, recorded twice. The first
  returned 200 with 2 advanced, the second 200 with 0 advanced and the
  corrected reference. Before the window re-read, the first returned 500.

- **W67b-14 — MED — A member's "I've sent payment" cannot be rejected.**
  Nothing returns `pending_verification` to unpaid. If the money never
  arrives:
  - the order stays pending for good;
  - reminders stop;
  - the member cannot change the payment method.

  ✅ **FIXED (2026-11-21).**
  - New `POST /store/orders/{id}/reject-payment-report` (needs
    `storefront.manage`) calls `reject_payment_report`. It locks the
    order and returns it to Unpaid, or to Part paid if money was already
    recorded. `amount_paid` is untouched, because a report never moved it.
    It clears the reported reference and time, adds a timeline entry the
    member sees, emails the member (unless `notifyMember` is false), and
    writes an audit event. An order with no report waiting is refused.
  - Reminders pick the order up again, and the member can change the
    payment method.
  - The order dialog shows **Not received** in the "member reported
    paying" notice, behind a confirm that says what the member will be
    told.
  - The member's error when changing method on a pending order now says to
    ask staff to mark the payment not received, which is now possible.

  **Tests:** nine in `TestRejectPaymentReport`, including the endpoint and
  another organization being refused, and three in `OrderDetailModal.test.tsx`.
  The dialog tests failed against the old component.

  **Re-driven:** a member reported paying ORD-2026-0014 in cash. In the
  order dialog, **Not received** opened the confirm naming the member;
  confirming showed "Payment marked as not received", and the button went
  away. The order read Unpaid with no reference. The member's timeline
  showed "The payment you reported could not be verified…", and the member
  could then change the payment method (200).

- **W67b-15 — LOW — Orders are accepted for up to 15 minutes after a window's
  closing time.** `create_order` checks the status, not `closes_at`. Only the
  15-minute lifecycle job closes a window.
- **W67b-16 — LOW — Two window lifecycle gaps.**
  - Reopening a window whose deadline has passed sends "ordering is open",
    then a second "ordering has closed".
  - A draft window given an `opens_at` later never opens on its own.
- **W67b-17 — LOW — Two notification gaps.**
  - Payment reminders are classed as store announcements. A member who mutes
    announcements stops hearing about money they owe. Whether that is
    intended is unverified.
  - The cancellation email has a template but is missing from the preview
    catalog, so it cannot be previewed or test-sent.

## Checklist

| Section                 | Result                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Shop, check out and pay held. A shipped order now shows its address and notes to staff (W67b-3, fixed).              |
| 2. The right people     | Not re-tested; W67 held. No new refusal gap seen.                                                                    |
| 3. Wrong input, failure | Negative prices, overpayment and backwards status moves are all accepted (W67b-4, -6, -7).                           |
| 4. Browser signals      | Clean: no console errors and no failed API calls on any driven screen.                                               |
| 5. Coming back to it    | The saved cart held. Loading checkout directly loses the page, not the cart (W67b-10).                               |
| 6. On a phone           | Not driven; W67 covered it.                                                                                          |
| 7. Everyone can use it  | Not re-audited.                                                                                                      |
| 8. What happens around  | Money leaves the books on a member cancel (W67b-2). Stock is resold across windows (W67b-1). Emails: W67b-11 to -17. |

## Completion gate

The review itself changed no code. The W67b-3, W67b-5 (frontend) and W67b-4
(backend) fixes of 2026-11-14 are the only code changes. The figures below are
for the tree with all three applied:

| Check                    | Result                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                    |
| npm run lint             | clean                                                                                                                                    |
| prettier --check         | clean on the changed files                                                                                                               |
| frontend tests (touched) | `src/modules/storefront`: 247 passed; 8 new (4 for W67b-3, 4 for W67b-5), each seen to fail first                                        |
| integrity suites         | dialog scroll, dialog dismiss, touch target, hover reveal and the stylesheet suites: all passed (313 in total with the storefront tests) |
| backend                  | flake8, black, isort clean on the changed files; mypy ratchet 0 errors; 571 storefront, payment, locking and SoD tests pass              |
