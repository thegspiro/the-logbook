# Workflow Review — W67 The Department Store

**Driven:** 2026-10-15 · **As:** `quartermaster`, `member`, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-15 plus this run's changes · **Database:** continued from W66

---

## What was driven

1. As `member`: the store with nothing set up ("The store is closed").
2. As `quartermaster`, Inventory Administration → Department Store:
   - **Settings:** store live, named "Valley Fire Gear Shop"; Cash and
     Check; payment required before pickup; pickup at Station 1. Saved with a
     double-click, then a reload.
   - **Catalog:** "Save item" empty, then with a price of −5, then "Station
     T-shirt", $20, active, max 2 per member, sizes S/M/L, saved with a
     double-click.
   - **Order Windows:** "Fall 2026 order", first with the close before the
     open, then 15–31 October; saved with a double-click, then "Open
     ordering".
3. As `member`, the store:
   - each size;
   - the quantity stepper past 2, then "Review order";
   - checkout with Cash and a cart of 3;
   - after the fixes, a cart of 2, a reload, and Submit double-clicked;
   - My Orders.
4. As `quartermaster`, Orders:
   - "Mark paid";
   - Manage, then Ordered from vendor, Ready for pickup and Fulfilled.
5. As `member`: My Orders afterwards.
6. As `member2`:
   - `member`'s order and the admin list through `wr.api`;
   - an order of one shirt, then "Cancel order".
7. At 390×844: the store, My Orders, and the console's Orders and Catalog
   tabs.

## Held up ✅

- **Setup:**
  - every settings field is labelled, the settings survive a reload, and
    each double-click made one record;
  - an item needs a name ("Give the item a name") and a price of at least
    0;
  - a window closing before it opens is refused ("Window close time must be
    after the open time.").
- **Checkout:**
  - the checkout states the payment policy ("Your items are held for pickup
    until your payment is recorded");
  - a double-clicked Submit placed one order, ORD-2026-0001, "Awaiting
    payment";
  - My Orders shows the balance, the reference to include, and the steps
    ahead.
- **Fulfilment:** payment and each status change applied. The member's order
  read "Fulfilled · nothing owed".
- **Who sees what:** `member2` got 403 on another member's order and on the
  admin list, and an empty list of their own.
- **Phone:** no sideways overflow on any screen.

## Findings

### W67-1 — MED — The per-member limit was shown as stock: "Only 2 left", then "Sold out" — ✅ FIXED

**Did:** as `member`, opened the T-shirt (no stock tracked, max 2 per
member) and picked each size.
**Saw:**

- "Only 2 left in S", in M and in L.
- `available_quantity` is the tightest of stock, the window's cap and the
  member's own allowance, and the card read any low figure as stock. So an
  unlimited item looked almost sold out.
- Read from code, the same card would have said "Sold out" to a member who
  had ordered their two, while everyone else could still buy.

**Where:**

- `services/storefront_service.py`, `_build_offers`;
- `schemas/storefront.py`;
- `StoreProductCard.tsx`.

**Fix:**

- Each offer and size also reports `stock_available`: the stock and window
  caps alone. The change is additive.
- The card shows "Only N left" only from that figure.
- A member at their limit reads "Limit reached" and "You have ordered your
  limit of 2", not "Sold out".

**Re-driven:** no "Only … left" on the untracked shirt.

### W67-2 — MED — The quantity stepper went past the limit, and the refusal blamed stock — ✅ FIXED

**Did:** pressed "+" to 3 against the 2-per-member limit, then Submit.
**Saw:**

- The stepper allowed 3 and the cart took them.
- At submit the server refused: "Only 2 of 'Station T-shirt' remain
  available", which reads as the item selling out.

**Where:** `StoreProductCard.tsx` (the stepper), `storefront_service.py`
(`create_order`).
**Fix:**

- The stepper stops at what the member may still order.
- When the member's own allowance is what binds, the refusal says so: "You
  can order 2 more of 'Station T-shirt' in this window (2 per member)", or
  "You have already ordered the most allowed …".
- Two existing tests pinned the old wording for per-member cases and were
  updated. The stock and window cases still say "Only N … remain available".

**Re-driven:** the stepper stopped at 2, its "+" disabled.

### W67-3 — MED — Cancelling an order took one tap — ✅ FIXED

**Did:** as `member2`, pressed "Cancel order" on a new order.
**Saw:**

- Cancelled at once, with no question. A cancelled order cannot be
  reopened.

**Where:** `MyOrdersPage.tsx`, `cancelOrder`.
**Fix:** it asks first: "Cancel ORD-…? The order is cancelled and cannot be
reopened…", with "Keep order" and "Cancel order".

### W67-4 — LOW — The screen-reader countdown said 17 days where the card said 16 — ✅ FIXED

The visible countdown counts whole days down; the announcement rounded up.
Both now count down. Re-driven: "Ordering closes in 16 days".

### W67-5 — LOW — Order checkboxes, "Select all" and the back link were 16–20px on a phone; row buttons were not named — ✅ FIXED

**Fix:**

- Each order's checkbox has a 44px label, and "Select all" is 44px on a
  phone or touch screen.
- My Orders' "Back to the store" is 44px.
- The row buttons are named for their order: "Mark ORD-2026-0001 paid",
  "Manage ORD-2026-0001".

**Re-driven:** 44×44 per order checkbox, and they still toggle.

### W67-6 — LOW — The cart is lost on a reload — 🚩 FLAGGED

**Saw:** two shirts in the cart, a reload, and "Nothing in your cart yet".
The cart is held only in memory, so a phone member who switches away and
back can lose it.
**Why flagged:** keeping it means choosing where (browser storage or
server), and for how long. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### Noted, not changed

- **"Mark paid" records the whole balance on one tap** and tells the member.
  The orders tab's own test names this "a one-click mark-paid", so it is
  deliberate (fast reconciliation), and Refund can reverse the money. Left
  as it is.

## Checklist

| Section                 | Result                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| 1. The job gets done    | Held end to end: set up, shop, check out, pay, fulfil. Fixed W67-1, W67-2.                             |
| 2. The right people     | Held: another member and the admin list refuse a member (403).                                         |
| 3. Wrong input, failure | Held: required name, non-negative price, window dates; double submits record once. Fixed W67-2, W67-3. |
| 4. Browser signals      | Only the deliberate refusals (422 on bad input, 400 on the over-limit order). No console errors.       |
| 5. Coming back to it    | Settings, catalog, windows and orders survive a reload. Flagged W67-6 (the cart does not).             |
| 6. On a phone           | No overflow. Fixed W67-5.                                                                              |
| 7. Everyone can use it  | Held: labelled settings and item forms. Fixed W67-4, W67-5.                                            |
| 8. What happens around  | Status and payment notices to members are email (off in this install), not seen here.                  |

## Completion gate

| Check                    | Result                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean, after `npm ci`: today's merge of `main` added `@tiptap/*`, which had not been installed                                                                                                                  |
| npm run lint             | clean, with no warnings (a `no-node-access` warning from this run's first version of the checkbox test was removed)                                                                                             |
| flake8 / black           | clean on `services/storefront_service.py`, `schemas/storefront.py` and `tests/test_storefront_service.py`                                                                                                       |
| frontend tests (touched) | `src/modules/storefront` with the touch-target, dialog-dismiss and route integrity suites: 207 passed. New: 4 card cases, `StoreWindowCard.test.tsx`, a cancel case and a checkbox case; each fails on old code |
| backend tests            | `test_storefront*.py`: 416 passed. New: `test_offers_report_stock_apart_from_the_member_allowance` (fails on old code); 2 per-member wording cases updated                                                      |
| environment              | `pip install nh3==0.3.7`, added to `requirements.txt` by today's merge, so the schema would build; `http-ece` (optional web push) does not build here and nothing in this run uses it                           |
