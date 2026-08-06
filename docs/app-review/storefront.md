# Application Review — Storefront & Payments

**Prefix:** `SF` · **Iteration:** A1 · **Reviewed:** 2026-08-05

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
files and belong to the A4 *Email templates & delivery* iteration), and the
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
  resolved only against *that product's own* variants. A cart referencing
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
  FIN-7 flagged as *missing* for finance request numbers is present here.
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

**Impact:** *Latent, not live.* The storefront module builds its client through
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

None material. Two things that *look* like duplication are deliberate and
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
   natural backfill source. *Scale/robustness.*
2. **Per-IP webhook rate limiting is per-process.** `public_rate_limit` shares
   the same limitation flagged in PP-6: with more than one worker the effective
   limit is 60/min × workers. Same Redis-backed fix as PP-6 would resolve both.
3. **No separation of duties on payments.** One `storefront.manage` holder can
   record a payment, mark an order paid, waive the balance, and issue a refund.
   This is the same SoD gap as FIN-4 and AH-4, and the same product decision:
   plausible for a small department, not for a large one. A `storefront.disburse`
   tier would mirror the `finance.disburse` proposal. *Product decision.*
4. **`auto_apply_payments` defaults to `True`** (`paypal_webhook.py:124`) when
   the integration config omits it, so an exact-amount capture settles an order
   with no human in the loop. Correct for the intended workflow and well-guarded
   by the amount check — but it is an implicit default on a money path and
   deserves to be explicit in the integration setup UI. *Product decision.*
5. **No test asserts the negative-quantity and negative-refund rejections.**
   Both are currently enforced only by Pydantic `Field` constraints; a schema
   refactor could silently drop `ge=1` / `gt=0`. These are cheap regression
   tests for two invariants that directly protect money.
6. **Order export is unpaginated.** `GET /orders/export` streams every order for
   the org. Same shape as the export DoS noted in FIN-7. *Scale limit.*

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (repo-wide) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `eslint` | ✅ clean |
| frontend tests | ✅ 156 passed (11 files: storefront + apiCache) |
| backend tests | ✅ 129 storefront tests passed · ⚠️ 180 errored at fixture setup — all are `db_session` failing to reach MySQL, which is not running in the review sandbox (no Docker daemon). Environment limitation, not a regression: neither fix touches a DB path, and the errors reproduce on an unmodified checkout. |
</content>
