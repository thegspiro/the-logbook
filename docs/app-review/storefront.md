# Application Review — Storefront & Payments

**Prefix:** `SF` · **Iteration:** A1 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-09-09 (pass 5)

## Pass 5 (2026-09-09) — concurrency, and the ratchet that did not cover this module

First Tier A re-run since pass 2 (passes 3 and 4 were Tier B only). The module
has grown ~1.2k lines since pass 2 — the endpoint file 1597 → 1660 L, the
service 2965 → 3345 L — and gained the payment-policy gate, personalization
thread colour/method, window rollups and the notification preview surface.

Pass 2's verdicts were re-verified and **all still hold**: money is `Decimal`
end to end, `SafeCsvWriter` on the export, every route permission-gated (now
44 after the route set changed), `/orders/mine/*` self-scoped, XC-3 clean,
`_price_lines` re-prices and org-scopes every FK, the PayPal webhook fails
closed, and the currency guard pass 2's SF-4 added is present and correct
(`storefront_service.py:2463`).

This pass took the **concurrency lens**, which no earlier pass had applied
here, and it is where the module turns out to be weakest. **2 fixed, 1
flagged.**

> **Finding ids here start at SF-8 because the `SF-` prefix is shared with the
> security-review track**, which independently allocated SF-4 … SF-7 in
> `docs/security-review/SF-04-storefront-payments.md`. The two tracks have
> already collided on SF-4 (here: currency-blind auto-settle; there: a
> different finding), so an `SF-n` reference is only unambiguous with the file
> that owns it — `KNOWN_LIMITATIONS.md`'s SF-6/SF-7 mentions are the
> security-review ones. Numbering above the shared high-water mark keeps this
> pass from adding a third collision; **giving one of the two tracks a distinct
> prefix is the actual fix, and is an owner call rather than something to
> rename unilaterally across three documents.**

### SF-8 — HIGH — Stock and per-member caps count from a stale snapshot, so a window oversells — ✅ FIXED

**What:** `_price_lines` locks every product in the cart with
`SELECT ... FOR UPDATE` (`_lock_products`, 1434) and then compares against
tallies from `_ordered_quantities`, which was a **plain** `SELECT`. That is the
second half of CLAUDE.md Pitfall #27, and only the first half was present.

Under InnoDB's default REPEATABLE READ a plain `SELECT` answers from the
snapshot taken at the transaction's first read, and taking a row lock does not
refresh it. `create_order` reads the settings row (1291) and the open windows
(1295) _before_ reaching the lock, so the snapshot is already open. The losing
request of two simultaneous submissions blocks on the product lock, waits,
acquires it, counts — and still sees the tally from before the winner
committed.

**Where:** `backend/app/services/storefront_service.py:1191` (the tally),
called from `:1511`–`:1514` (the capacity check).

**Impact:** two members ordering the last unit at the same moment are both
sold it, and the same stale read defeats `max_per_member` and a window's
`quantity_limit`. The department finds out at the vendor order, when the tally
exceeds `stock_quantity` and somebody has to be told their shirt is not coming
after they were shown a confirmation. The collision is realistic precisely
because ordering is bursty here: a window opens, `send_window_opened` mails the
whole department, and everyone taps at once.

**Why three previous passes missed it.** `tests/test_storefront_locking.py`
asserts that `_lock_products` locks the right ids — the half that was already
correct — and its name reads as coverage of the whole question.
`tests/test_capacity_locking.py`, the repository's ratchet for exactly this
rule, imported six services and not this one. Pass 1 recorded "order numbers
are race-safe" and stopped at the allocator; the seat-cap shape was never
asked about.

**Fix:** `_ordered_quantities` takes a `for_update` flag and issues the tally
as a locking read when set. The flag is required rather than unconditional
because the same helper serves `_build_offers`, which renders the member-facing
store — locking there would take write locks on every order item in the window
on every page view and block submission behind browsing. `_price_lines` passes
`for_update=True` for both tallies; `_build_offers` stays unlocked. This
mirrors `scheduling_service.get_shift_by_id`'s existing `for_update` parameter.
`FOR UPDATE` on this `GROUP BY` + `JOIN` aggregate was executed against the
live database before the change was written, alongside the plain and
`FOR UPDATE OF` forms.

**Guarded:** `tests/test_capacity_locking.py` now imports `storefront_service`
and adds `TestStorefrontStockCapacity` — the tally is a locking read, the order
path passes the flag twice, and the browse path still does not lock. The third
assertion is what stops the next reader from "simplifying" this into an
unconditional lock.

**Corrected after review: the tally lock alone was worse than the bug it fixed.**
Codex raised a P2 on PR #2446 against the first version of this change, and it
was right. The tallies are range reads over an order window, and a window is
empty exactly when it opens, so InnoDB takes next-key/**gap** locks over that
empty range. Gap locks do not conflict with each other — so two members ordering
**different** products both sail past `_lock_products` (their product rows are
disjoint) and both acquire the same gap, and then each one's `INSERT` needs an
insertion-intention lock that the other's gap lock blocks. InnoDB breaks the
cycle by killing one member's order with a 1213.

Different products is the _common_ case when a window opens, so the first
version traded a rare same-product oversell for a frequent different-product
failure. **Reproduced against a real database before believing it:** 5 rounds of
two concurrent disjoint carts produced **2 deadlocks** without the remedy below
and **0** with it.

The remedy is the other half of Pitfall #27, which the first version had
skipped — _lock the parent row, not the rows being counted_. **Getting the
granularity of that parent right took two rounds of review, both measured
against a real database rather than argued:**

| Locked                    | Same-window disjoint carts | Two open windows      |
| ------------------------- | -------------------------- | --------------------- |
| products only (first try) | 2 deadlocks / 5 rounds     | —                     |
| + the window row          | 0                          | 1 deadlock / 4 rounds |
| + the organisation        | 0                          | 0                     |

The window row is **not** a sufficient parent. `store_orders` is indexed on
`(organization_id, window_id)`, so two open windows with empty or sparse ranges
share a single gap while their parent rows are different and therefore
uncontended — and the store genuinely supports several open windows at once,
which is what `other_open_windows` on the storefront payload is for (Codex P3
on PR #2446). The organisation is the narrowest parent covering every gap the
tallies can touch, because all of those ranges are org-scoped;
`store_settings` is the row for it, one per organisation by unique constraint,
and `create_order` has already called `get_settings()` before `_price_lines`
so it always exists.

Lock order is **organisation → window → products → tallies** on every path, so
they cannot invert. The cost is that order placement serializes per
organisation rather than per window — nothing for a department storefront, and
what the capacity check needs anyway, since a tally another order can
invalidate mid-decision is the defect this block exists to prevent.

`tests/test_storefront_order_deadlock.py` exercises **both** cases against a
real database. Disabling the org lock leaves the same-window test passing (the
window lock does cover that one) and fails the cross-window test — which is
precisely why the second case was easy to miss. A source-level companion pins
the lock _order_, since an org lock taken after the tallies would not stop two
transactions holding the same gap.

**The detector had to be made dependable, because a deadlock is a race.** As
first written it used a fixed `sleep` to overlap the two transactions and left
each round's orders in place. Re-running the rejected protocol under it caught
the regression 4 times in 4 in isolation but only **2 in 3** in a whole-file
run — and a whole file is how CI runs it, so a third of the time the ratchet
would have waved the defect through. Two changes fixed that: a rendezvous
instead of a sleep, so the overlap does not depend on connection or buffer-pool
warmth, and clearing the orders between rounds, so every round starts from the
**empty** range the gap lock needs rather than being a weaker repeat of the
first. Extra rounds had not helped for that second reason. Detection is now
**6 in 6**, with 3 in 3 clean when the lock is present.

**⚠️ This fix was not in PR #2446.** The per-org lock was committed nine
minutes after that PR merged (merge `fba00fe` took the branch at `92920e7`;
the fix is `7b23d66`), so `main` briefly carried the window-only protocol —
the configuration measured at 1 deadlock / 4 rounds above. It ships separately
on the follow-up branch. Nothing else from the pass-5 work was affected; the
storefront tally lock, the auth lockout lock and the scheduled-email org filter
were all inside the merge.

### SF-9 — MED — Concurrent payment recording loses money off the ledger — FLAGGED

**What:** `record_payment` is a read-modify-write on a money column with no row
lock — `get_order` (plain `SELECT`), then
`order.amount_paid = amount_paid + applied`, then commit. Two overlapping calls
both read the same `amount_paid` and the second write lands on top of the first.

**Where:** `backend/app/services/storefront_service.py:1844` and `:1865`.

**Impact:** the recorded total is short by one payment. The order stays
`PARTIAL`/`UNPAID`, the member is chased for money they already sent, and the
outstanding-balance rollup the treasurer reconciles against is wrong. The
realistic collision is not two admins double-clicking — it is the webhook's
auto-apply path (`apply_payment_event` → `record_payment`, `actor_id=None`)
landing while a treasurer works the same order in the admin hub, which is
exactly when reconciliation happens.

**Fix — not applied, deliberately.** The change is small (`get_order` gains a
`for_update` flag; `record_payment` uses it) but it sits in the payments path
and moves transaction boundaries shared by `bulk_mark_paid`'s per-order loop
and the unauthenticated webhook, and this review's contract is to flag rather
than guess there. Two non-equivalent options:

1. **Lock the order row in `record_payment`** — narrowest, serializes all money
   writes per order. Needs a check that `bulk_mark_paid`'s loop (which commits
   per order) does not hold locks across iterations.
2. **Make the write relative in SQL** (`SET amount_paid = amount_paid + :n`) —
   lost-update-free without a lock, but the `payment_status`/`paid_at`
   transition below reads the resulting balance, so it needs a re-read.

Option 1 matches the rest of the codebase. Mirrored into `KNOWN_LIMITATIONS.md`.

### SF-10 — NIT — Dead parameter on the tally helper — ✅ FIXED

`_ordered_quantities(exclude_order_id=...)` was declared and implemented but
never passed —`grep -rn "exclude_order_id" app/ tests/` returned only the
declaration and its own two uses inside the helper. No runtime effect; it
mattered only because it sat in the signature being changed for SF-8, where an
unused branch invites a future caller to assume it was exercised. Removed in
the same edit.

### Re-verified, still open

The pass-2 note that **concurrent duplicate webhook deliveries degrade to a
500** still holds and is unchanged: `record_external_payment` checks for an
existing `(org, provider, external_id)` row (`:2410`) then inserts, so two
simultaneous deliveries of one capture both pass the check and the second hits
the unique constraint; `paypal_webhook.py:127` catches only `ValueError`, so it
surfaces as a 500. Still self-healing (PayPal retries, the body-hash replay
guard catches the retry) and still no double-apply — the constraint is the real
guard. Left as pass 2 left it: the fix belongs with SF-9's transaction work,
not ahead of it.

### Pass 5 additions to "verified good"

Checked this pass and not covered by pass 1 or 2:

- **Route ordering does not shadow.** `GET /orders/export` (1178) and
  `GET /orders/mine` (378) are both registered before `GET /orders/{order_id}`
  (1208).
- **Every `ondelete="SET NULL"` FK is `nullable=True`** — all 12, column by
  column (Pitfall #2).
- **PII does not reach the client cache.** The router mounts at `/store`
  (`api/v1/api.py:223`) and `/store/` is in `UNCACHEABLE_PREFIXES`, so order
  responses carrying member name, email, phone, shipping address and payment
  references are never cached.
- **The frontend module shares the global client** — `createApiClient()`, not a
  hand-rolled axios instance (Pitfall #7).
- **All three catalog search predicates** use `like_pattern()` +
  `escape=LIKE_ESCAPE_CHAR` (`:366`–`:371`) — Pitfall #25 clean.
- **Rollups aggregate in SQL.** `_order_rollup` (2628) groups by window with
  `func.sum`/`case`; `export_orders_csv` pages to exhaustion rather than taking
  page 1.
- **Scheduled tasks are org-scoped and bounded** — `run_payment_reminders`
  filters on org, caps at `.limit(200)`, and stamps `payment_reminder_sent_at`.
- **Email escaping is complete** — `html.escape` on product name, variant
  label, personalization text, customer name, member notes, payment
  instructions and receipt footer; the `RAW_HTML_VARIABLES` allowlist is the
  only unescaped path and every member of it is service-built HTML.

### Pass 5 scope

Read in full: `models/storefront.py`, the endpoint file (all 44 routes
enumerated for auth and permission), and the service's order-placing, pricing,
payment, reconciliation, rollup, export and scheduled-task paths; the public
webhook end to end; escaping across the notification service and email
templates.

**Not re-read this pass,** and so carrying no pass-5 verdict: the 40-file
frontend module beyond the two mechanical invariants above (shared client,
cache exclusion), `storefront_preview_service.py` and `paypal_service.py`
beyond their call-in points, and the notification/email-template internals
(unchanged from pass 2's deferral to the A4 iteration).

### Pass 5 documentation check

`docs/STOREFRONT_MODULE.md` (now 575 L) and `docs/STOREFRONT_PAYPAL.md` remain
accurate: the three permission strings and what each grants, the
route→page→permission table, and the claim that preview and test-send are both
behind `storefront.manage` were each checked against the code.

One stale reference found and **not** fixed here, because it is not this
feature's: `docs/app-review/CHECKLIST.md` and `CLAUDE.md` both point at
`docs/endpoint-permissions.md`, which does not exist — `ls docs/` and a
repo-wide grep for a job that parses it both come back empty. CLAUDE.md names
it as one of two docs with its own contract check, so the pointer is stale
rather than merely absent. It belongs to whoever owns the review tooling;
editing CLAUDE.md under a storefront review would be the wrong place.

### Pass 5 future development

Added to the pass-1 list:

1. **The concurrency invariants are asserted at source level only.**
   `test_capacity_locking.py` proves the storefront _asks_ for a locking read;
   nothing proves the cap actually holds. A DB-backed test driving two
   `create_order` calls at the last unit through `asyncio.gather` would close
   it — and per CLAUDE.md #22 it must enter any `patch()` above the `gather`,
   never inside each coroutine.
2. **No test covers two overlapping `record_payment` calls** (SF-9).
3. **The CSV export is not really streamed** — `export_orders_csv` accumulates
   every order, builds the whole CSV in a `StringIO`, and the endpoint wraps it
   in `StreamingResponse(iter([content]))`, one chunk. Fine for a department;
   it is the memory ceiling for a multi-year archive.
4. **Order-number allocation reads every number for the year.**
   `_generate_order_number` selects all `ORD-YYYY-%` for the org and maxes the
   suffix in Python — correct, and deliberately MAX-not-count, but O(orders
   this year) per submission.
5. **A member can re-report payment without limit.** `report_payment` has no
   cooldown and each call emails the admins via `send_admin_new_order`.

### Pass 5 completion gate

| Check          | Result                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| tsc --noEmit   | ✅ 0 errors                                                               |
| flake8         | ✅ 0 violations (`app/ tests/`)                                           |
| black --check  | ✅ 1101 files unchanged                                                   |
| eslint         | ✅ 0 errors, 2 warnings (pre-existing, `modules/scheduling`; limit 10)    |
| frontend tests | ✅ 185 passed, 15 files (`src/modules/storefront`)                        |
| backend tests  | ✅ 774 passed, 1 skipped (storefront + capacity + csv + LIKE + money-SoD) |

Unlike earlier passes, DB-backed tests **did** run: the session-start hook
brings up MariaDB and Redis, so the `db_session` fixture connects rather than
timing out. The single skip is `test_push_service.py`, which needs the optional
`pywebpush` dependency.

---

## Pass 2 (2026-08-08) — six-lens sweep + the reconciliation surface

Re-verified pass-1 (money is `Decimal` end-to-end; `SafeCsvWriter`; 47/47
endpoints gated; `/orders/mine/*` self-scoped; `_price_lines` re-prices + org-scopes
every FK; refund guarded against exceeding paid; PayPal webhook fails closed; SF-1/2
hold). This pass added the **out-of-band payment reconciliation** the B12 integrations
pass deferred here (`apply_payment_event`, AMBIGUOUS handling, batch settlement) —
all confirmed org-scoped (XC-3 clean). **1 fix.**

### SF-4 — MEDIUM (money integrity) — Currency-blind auto-settle — ✅ FIXED

`record_external_payment` auto-applies a capture when `amount == balance` and
`auto_apply_payments` is on (it defaults on). The match chain checked cancelled →
`balance <= 0` → `amount != balance` → apply, but **never compared the capture
currency to the store currency**, even though both are stored (`StorePaymentEvent.
currency`, `StoreSettings.currency`) and `extract_capture` carries whatever currency
the payer selected. A PayPal.me payer can pick a non-USD currency, so a capture of
`50.00 CAD` against a `$50.00` USD balance satisfies `amount == balance` and
auto-settles the order — recording $50 collected for a payment worth materially
more or less. `StoreOrder` has no currency column, so nothing downstream catches it.
(`KNOWN_LIMITATIONS` flags `auto_apply_payments` generally but reasons only about the
_amount_.) **Fix:** a currency guard as the second match branch — a capture whose
currency differs from `get_settings().currency` is routed to **AMBIGUOUS** for human
reconciliation, exactly like a short/over payment; a matching-currency exact amount
still auto-applies unchanged. 1 DB-backed regression test (`test_storefront_
reconciliation.py`) + 1 DB-free unit test (`test_storefront_currency_guard.py`).

**Flagged (unchanged):** the payments SoD — one `storefront.manage` holder can
record/mark-paid/waive/refund (KNOWN_LIMITATIONS, same shape as FIN-4/AH-4) — stands.
Two LOW robustness items noted (not fixed): concurrent duplicate webhook deliveries
degrade to a 500 → provider retry (the `UniqueConstraint` is the real guard, no
double-apply), and an order cancelled in the match→apply race yields a 400 to PayPal
while the event stays correctly MATCHED for a human (self-healing on retry). Lenses
1–4 otherwise clean (no blind-FK update bypass; no cross-org projection; all
reconciliation/settlement org-scoped; `*_name` populated).

---

**Backend:** `app/api/v1/endpoints/storefront.py` (1597 L, 47 endpoints),
`app/services/storefront_service.py` (2965 L),
`app/services/storefront_notification_service.py` (987 L),
`app/services/email_templates_storefront.py` (512 L),
`app/services/integration_services/paypal_service.py`,
`app/api/public/paypal_webhook.py` (150 L, **unauthenticated**),
`app/models/storefront.py`, `app/schemas/storefront.py`,
`app/utils/storefront_payments.py`
**Frontend:** `modules/storefront` (29 files, 7965 L)
**Docs:** `docs/STOREFRONT_MODULE.md` (563 L), `docs/STOREFRONT_PAYPAL.md` (167 L)

---

## Scope

Full read of the endpoint layer (all 47 routes enumerated for auth and
permission), the public PayPal webhook and its signature verification, and the
service's money paths: `create_order`, `_price_lines`, `record_external_payment`,
`apply_payment_event`, `refund_order`, and the CSV export. Model constraints and
request schemas were checked against the invariants the code assumes.

**Not exhaustively read:** the 987 L notification service and 512 L email
template module beyond their call sites (they are covered by four dedicated test
files and belong to the A4 _Email templates & delivery_ iteration), and the
frontend module's component internals beyond the service/store layer.

This was the largest never-reviewed feature in the codebase and the only
payment-handling surface. **It is in materially better shape than the modules
covered by the original security audit** — the two findings below are both
defense-in-depth, not live defects.

## Verified good ✅

- **Auth coverage: 47/47 endpoints gated.** Member-facing reads and order
  placement require `storefront.view` / `storefront.order`; every
  administrative route requires `storefront.manage`. The one
  `get_current_user`-only route (`GET /permissions`) returns just the caller's
  own capability flags.
- **Self-scoping on the member paths is correct.** `/orders/mine`,
  `/orders/mine/{id}`, `report-payment`, and `cancel` all pass
  `user_id=current_user.id` into the service alongside the org, so a member
  cannot read or act on another member's order by id. This is the IDOR that
  the equivalent paths in other modules got wrong.
- **Tenant isolation (XC-3) clean.** Every by-id operation resolves through
  `get_order` / `get_product` / `get_settings` with an `organization_id`
  argument. No bare `select(Model).where(Model.id == x)` on a client id.
- **Client prices are never trusted (XC-1 clean on the order path).**
  `_price_lines` re-prices every line from the catalog: the product is fetched
  org-scoped, the window offering is matched org-scoped, and a `variant_id` is
  resolved only against _that product's own_ variants. A cart referencing
  another org's product or an unoffered product is rejected.
- **Quantity and money inputs are bounded at the schema.**
  `quantity: int = Field(..., ge=1, le=999)`, refund `amount: Field(None, gt=0)`,
  payment `amount: Field(..., gt=0)`. The negative-quantity and negative-refund
  paths — which would have inverted the order total and inflated `amount_paid`
  respectively — are both closed.
- **Money math uses `Decimal` end to end.** Zero `float(` calls in the service;
  a single `_money()` helper quantizes everything to cents. This is the only
  money-handling module in the codebase without the float-arithmetic finding
  (compare FIN-7, GF-9).
- **Refund guards are complete** (`storefront_service.py:1904`): org-scoped
  fetch, refuses when nothing is paid, and rejects `refunded > paid`.
- **PayPal webhook signature verification fails closed on every path**
  (`paypal_service.py:124`). A missing `webhook_id`, any missing signature
  header, an auth failure, a transport exception, or an HTTP ≥400 all return
  `False`; only an explicit `verification_status == "SUCCESS"` passes. It
  delegates to PayPal's verify API rather than parsing `PAYPAL-CERT-URL`
  locally, which is what makes a forged cert-url header useless.
- **Payment replay cannot double-pay an order.** Two independent layers: the
  `is_duplicate_webhook` replay guard, and a real DB `UniqueConstraint` on
  `(organization_id, provider, external_id)` — verified present both in the
  model (`storefront.py:803`) and in migration
  `20260802_0004_add_store_payment_events.py:93`, not just asserted in a comment.
- **Reconciliation refuses to guess.** A capture whose amount differs from the
  order balance, or which matches a cancelled or zero-balance order, is recorded
  `AMBIGUOUS` for a human rather than applied. Unmatched payments are still
  persisted — the design note that a member whose money has left their account
  must never be silently dropped is implemented as written.
- **CSV export uses `SafeCsvWriter`** (`storefront_service.py:2737`), so the
  formula-injection class (CI-1, CS-4) does not recur here.
- **Product image upload is hardened**: magic-byte MIME detection,
  re-encode to WebP (which strips EXIF/GPS), size cap, org-scoped write, and
  serving is `storefront.view`-gated with a `private` cache header.
- **Order numbers are race-safe**: `UniqueConstraint(organization_id,
order_number)` backing a retry-on-conflict allocator — the constraint that
  FIN-7 flagged as _missing_ for finance request numbers is present here.
- **Frontend module uses the shared `createApiClient` factory**, so Pitfall #7
  (module axios instances missing CSRF/credentials) does not apply.
- **Test coverage is real**: 11 backend test files and 10 frontend test files,
  including dedicated reconciliation and payment-options suites. No TODO/FIXME
  markers anywhere in the module.

## Findings

### SF-1 — LOW — Storefront responses were not excluded from the API cache — ✅ FIXED

**What:** `UNCACHEABLE_PREFIXES` in `frontend/src/utils/apiCache.ts` listed no
storefront path, although `StoreOrderResponse` carries `customer_name`,
`customer_email`, `customer_phone`, and `shipping_address` — a member's home
address. Comparable surfaces (`/prospective-members/`, `/finance/`,
`/admin-hours/`) are all excluded.

**Where:** `frontend/src/utils/apiCache.ts:31`.

**Impact:** _Latent, not live._ The storefront module builds its client through
`createApiClient()`, which installs CSRF and auth-refresh interceptors but **not**
the caching interceptor — that lives only on the global `services/api.ts`
instance, and no `/store/` call routes through it today. The exposure would
appear the moment any storefront call were moved to the global instance, which
is exactly the kind of refactor the exclusion list exists to survive.

**Fix:** added `'/store/'` to `UNCACHEABLE_PREFIXES` with a comment naming the
PII fields. Adding an exclusion can only suppress caching, so there is no
behavioral risk.

### SF-2 — LOW — Public webhook returned a raw exception string — ✅ FIXED

**What:** the PayPal webhook returned `detail=str(exc)` on a `ValueError`,
bypassing `safe_error_detail()`, which every other error path in the codebase
routes through.

**Where:** `backend/app/api/public/paypal_webhook.py:128`.

**Impact:** low today — the reachable `ValueError` from `record_external_payment`
is the benign "Payment notification carried no identifier". But this is an
**unauthenticated public endpoint**, and `str(exc)` has no sanitizer between a
future service-layer exception and the response body, so any `ValueError` later
raised deeper in the reconciliation path (which touches order rows and SQL)
would be echoed verbatim to an anonymous caller.

**Fix:** routed through `safe_error_detail(exc)` and added the import. Behavior
for the existing message is unchanged — `safe_error_detail` passes `ValueError`
text through unless it contains SQL, file paths, or tracebacks.

### SF-3 — NIT — Payment-event dedup is check-then-insert — OPEN

**What:** `record_external_payment` (`storefront_service.py:2138`) SELECTs for an
existing `(org, provider, external_id)` row before inserting. Two concurrent
redeliveries of the same capture can both pass the SELECT.

**Impact:** **not a double-payment bug** — the DB unique constraint rejects the
second INSERT. The loser raises `IntegrityError` → 500 → PayPal retries → the
retry finds the committed row and returns 200. Correct outcome, noisy path.

**Why not fixed:** the clean fix is catching `IntegrityError` and re-reading, but
that changes commit/rollback handling on the money path for a cosmetic gain.
Worth doing alongside any future refactor of this method, not on its own.

## Duplication

None material. Two things that _look_ like duplication are deliberate and
correct:

- `email_templates_storefront.py` (512 L) is separate from the general
  `email_template_service.py` (2739 L). Whether these should converge is a
  question for the **A4** iteration, which owns both — flagged there rather than
  decided here.
- Order line items snapshot `product_name` / `variant_label` / `sku` / price
  rather than joining the catalog. That is intentional denormalization,
  documented in the model: a receipt must keep saying what the member actually
  bought after the catalog is renamed or repriced.

## Dead code

None found. `grep -rn "TODO\|FIXME\|XXX\|HACK"` across the endpoint, service,
and frontend module returns nothing, and no unreferenced service methods
surfaced while tracing the endpoint layer.

## Documentation gaps

None requiring correction. `docs/STOREFRONT_MODULE.md` (563 L) and
`docs/STOREFRONT_PAYPAL.md` (167 L) describe the implemented behavior, and —
unlike the "hashed tokens" and "AES-256" claims caught in ELEC-5 and CI-5 — the
security claims in the webhook docstring were **verified against the code and
hold**: signature verification is real and fails closed, the replay guard exists,
and the uniqueness claim is backed by an actual DB constraint in an actual
migration.

## Future development

1. **Reconciliation has no retry/backfill path.** If PayPal's verify API is
   down, the webhook 401s and PayPal eventually stops retrying — the payment is
   then lost to the ledger with no way to re-ingest it. The Transaction Search
   API (noted in the service docstring as rejected for latency) would be the
   natural backfill source. _Scale/robustness._
2. **Per-IP webhook rate limiting is per-process.** `public_rate_limit` shares
   the same limitation flagged in PP-6: with more than one worker the effective
   limit is 60/min × workers. Same Redis-backed fix as PP-6 would resolve both.
3. **No separation of duties on payments.** One `storefront.manage` holder can
   record a payment, mark an order paid, waive the balance, and issue a refund.
   This is the same SoD gap as FIN-4 and AH-4, and the same product decision:
   plausible for a small department, not for a large one. A `storefront.disburse`
   tier would mirror the `finance.disburse` proposal. _Product decision._
4. **`auto_apply_payments` defaults to `True`** (`paypal_webhook.py:124`) when
   the integration config omits it, so an exact-amount capture settles an order
   with no human in the loop. Correct for the intended workflow and well-guarded
   by the amount check — but it is an implicit default on a money path and
   deserves to be explicit in the integration setup UI. _Product decision._
5. **No test asserts the negative-quantity and negative-refund rejections.**
   Both are currently enforced only by Pydantic `Field` constraints; a schema
   refactor could silently drop `ge=1` / `gt=0`. These are cheap regression
   tests for two invariants that directly protect money.
6. **Order export is unpaginated.** `GET /orders/export` streams every order for
   the org. Same shape as the export DoS noted in FIN-7. _Scale limit._

## Completion gate

| Check                | Result                                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (repo-wide)                                                                                                                                                                                                                                                                                     |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                                                                                                                                                             |
| `black --check`      | ✅ unchanged                                                                                                                                                                                                                                                                                                |
| `eslint`             | ✅ clean                                                                                                                                                                                                                                                                                                    |
| frontend tests       | ✅ 156 passed (11 files: storefront + apiCache)                                                                                                                                                                                                                                                             |
| backend tests        | ✅ 129 storefront tests passed · ⚠️ 180 errored at fixture setup — all are `db_session` failing to reach MySQL, which is not running in the review sandbox (no Docker daemon). Environment limitation, not a regression: neither fix touches a DB path, and the errors reproduce on an unmodified checkout. |

</content>
