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

### W67b-6 — MED — A size can be priced below zero — OPEN

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

**Fix (not applied):** refuse a negative unit price in `_price_lines`, and
when a variant or window price is saved.

### W67b-7 — MED — A payment larger than the balance is accepted — OPEN

**Did:** recorded $150 against a $15 order as `quartermaster`.
**Saw:** 200; `amountPaid: 150.00`, `balanceDue: 0`.

The window's collected figure is inflated by $135. Dues payments refuse an
overpayment; the store does not. A payment against an already-paid order is
accepted the same way.

**Where:** `storefront_service.py` `record_payment`.

### W67b-8 — LOW — Refund is one tap and always refunds everything — OPEN

Read from code, not clicked:

- Refund in the order dialog has no confirmation and no amount field, so it
  refunds the whole amount paid and emails the member.
- The endpoint accepts a partial `amount`.
- Every other irreversible action in this module asks first (W67-3).

**Where:** `components/OrderDetailModal.tsx` `refund`.

### W67b-9 — LOW — A pickup order keeps the home address typed for shipping — OPEN

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

### W67b-10 — LOW — Loading the checkout page directly sends the member back to the store — OPEN

**Did:** as `member2`, with an item in the cart, loaded `/store/checkout`
directly, then reloaded it.

**Saw:** both landed on `/store`. The cart itself survived.

The page checks `cart.length === 0` before `loadStorefront` has restored the
saved cart, and bounces. Its own comment still says the cart is "deliberately
unpersisted", which W67-6's fix of 2026-10-27 made untrue.

**Where:** `pages/CheckoutPage.tsx`.

### W67b-18 — LOW — The progress steps on a shipped order end at "Ready for pickup" — OPEN

**Saw:** while re-driving W67b-3, the step list on My Orders for the shipped
ORD-2026-0007 read Submitted, Payment due, Ordered, Ready for pickup.

**Where:** `components/OrderStatusStepper.tsx` does not read
`fulfillmentMethod`. The order statuses have no shipped state either, so a
fix needs a decision on what a shipped order's last step is called and when it
is reached.

### Read from code, not driven

These came from a read of the backend paths no earlier pass covered. Each was
traced in the code; none was exercised in the browser, mostly because this
install sends no email.

- **W67b-11 — HIGH — "Placed with the vendor" is emailed to members whose
  unpaid orders were held back.** `record_vendor_order` skips unpaid orders
  under pay-before-vendor-order. It then mails `_window_customer_emails`,
  which is every non-cancelled order in the window.
- **W67b-12 — MED — Cancelling or fulfilling a window has no transition guard
  and leaves its orders open.** Payment reminders then keep chasing members
  for goods that will never be ordered. Where: `set_window_status`;
  `run_payment_reminders` filters on order status only.
- **W67b-13 — MED — `record_vendor_order` has three faults.**
  - It advances only the first 200 orders.
  - It moves Ready for pickup orders back to Ordered.
  - Run again, it re-sends the vendor email to everyone, with no idempotency
    key (pitfall #36).
- **W67b-14 — MED — A member's "I've sent payment" cannot be rejected.**
  Nothing returns `pending_verification` to unpaid. If the money never
  arrives:
  - the order stays pending for good;
  - reminders stop;
  - the member cannot change the payment method.
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
