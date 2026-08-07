# Module Audit — Storefront

**Files:** `app/api/v1/endpoints/storefront.py` (1,597 L, 47 endpoints),
`app/services/storefront_service.py` (2,965 L),
`app/models/storefront.py` (911 L), `app/services/storefront_notification_service.py`,
`app/services/storefront_preview_service.py`,
`app/services/email_templates_storefront.py`,
`app/api/public/paypal_webhook.py` (149 L),
frontend `modules/storefront` (3 pages, 8 components, store + service).
**Audited:** 2026-08-07 (iteration 28 — the module the original 27-module
rotation never covered).

Storefront was written after the rotation defined its patterns, and it shows:
the module already uses the shared `assert_in_org` helper (XC-1),
`SafeCsvWriter` (XC-5), and org-scoped fetches throughout. It is the
best-defended module reviewed to date, and the one finding below is LOW.

## Verified good ✅

- **Auth coverage:** all 47 endpoints carry an auth dependency. 46 are
  `require_permission`-gated (`storefront.manage` ×39, `storefront.view` ×6,
  `storefront.order` ×1). The single bare-`get_current_user` route is
  `GET /store/permissions`, which returns only the caller's *own* store
  permissions — a self-probe, correctly ungated.
- **Tenant isolation:** no unscoped by-id read/update/delete. Every
  `select()` in the service filters `organization_id`, or resolves through a
  parent that was already org-scoped. The automated sweep for
  client-supplied ids with no org filter returns zero hits for this module.
  `get_order` additionally takes an optional `user_id` so member-facing routes
  scope to the caller's own orders, not just the org.
- **XC-1 (client FK validation):** `create_product` / `update_product`
  validate a client-supplied `inventory_item_id` through `assert_in_org`
  before storing it, and `_replace_offerings` validates window product ids.
  This is the pattern the rest of the codebase is still being swept onto.
- **XC-5 (CSV injection):** `export_orders_csv` uses `SafeCsvWriter`. It also
  pages through the entire result set rather than the first page — an export
  that silently truncated would send the department to the vendor with the
  wrong quantities — and marks orders the payment policy held back so the
  sheet cannot be mailed to the vendor in a way that undoes the rule.
- **No raw SQL:** no `text()`, f-string, or `.format()` query construction.
- **Money path (the reason this module matters).** Reviewed closely:
  - `_price_lines` prices **every line from the catalog**, never from the
    client. Quantities are locked (`_lock_products`) *before* per-window and
    per-member limits are counted, so a concurrent order cannot slip past a
    limit. Duplicate cart lines are collapsed with personalization as part of
    the key, so per-product caps see the true ask.
  - `report_payment` (member self-declaration) deliberately does **not** move
    `amount_paid`; it only sets `PENDING_VERIFICATION` for an admin to confirm.
    Nothing self-reported settles the ledger.
  - `record_external_payment` requires an **exact** match between the captured
    amount and the order's outstanding balance. Short payments, over payments,
    cancelled orders and zero-balance orders all become `AMBIGUOUS` for a human
    rather than auto-settling. Order matching is on the order number only —
    fuzzy matching on payer name or amount was considered and rejected, which
    is the right call (two members can owe the same amount in one window).
  - Replay: `external_id` is unique per (org, provider), so a redelivered
    notification returns the existing event instead of paying an order twice.
- **PayPal webhook** (`app/api/public/paypal_webhook.py`): every payload is
  verified through PayPal's verify-webhook-signature API; an integration with
  no webhook id configured is **rejected**, not trusted; rate-limited per IP;
  replay-protected via `is_duplicate_webhook`; every delivery audit-logged.
  Unhandled event types and duplicates answer 200 (so PayPal stops retrying)
  without acting.
- **Frontend auth:** the module's axios instance comes from the shared
  `createApiClient()` factory (`withCredentials`, CSRF double-submit, shared
  refresh promise), so Pitfall #7 does not apply.
- **Lint:** flake8 / black / isort clean across all storefront files.

## Findings

### SF-1 — LOW — search did not escape LIKE wildcards — ✅ FIXED

`list_products` and `list_orders` built their search filter as
`f"%{search}%"` with no escaping, so `%` and `_` in a member's search string
reached the database as wildcards rather than literals. Searching `%` returned
the entire catalog (and the entire order list, including every member's name
and email, for a `storefront.manage` holder); `_` matched any single character.

Not an injection — SQLAlchemy parameterizes the value — but it defeats the
filter and makes the paginated CSV export scan far more than intended. This is
the same defect recorded as INV-5 in inventory and fixed in facilities,
apparatus, documents, equipment-check, forms and fundraising.

**Fixed** by escaping through the new shared helper and passing the escape
character to SQL:

```python
pattern = like_pattern(search)
query.where(Model.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
```

### SF-2 — LOW — `/store/` was missing from the API cache exclusion list — ✅ FIXED

`UNCACHEABLE_PREFIXES` in `frontend/src/utils/apiCache.ts` did not list
`/store/`, although store orders carry member names, shipping addresses,
payment references and outstanding balances — the same class excluded for
`/finance/` and `/inventory/charges`.

No live exposure: the storefront module builds its axios instance via
`createApiClient()`, which does not install the cache interceptor, so no store
response was ever cached. Fixed as a guardrail before any storefront call is
routed through the cached global client, which is the documented convention.

### SF-3 — informational — LIKE escaping was copy-pasted seven times

The escape transform SF-1 needed already existed, independently duplicated, in
`apparatus_service`, `documents_service`, `equipment_check_service`,
`facilities_service`, `forms_service` (×2) and `fundraising_service`. Promoted
to `app/utils/sql_search.py` (`escape_like` / `like_pattern` /
`LIKE_ESCAPE_CHAR`) with unit tests, mirroring how `assert_in_org` was
promoted out of `forms_service`.

**Storefront now uses the helper. The seven pre-existing call sites were left
in place** — they are already correct, and a mechanical sweep of them could not
be verified end-to-end in an environment without MySQL. Migrating them is a
follow-up whose value is consistency, not a fix.

All seven escape the same three characters correctly. What they *don't* do is
pass `escape="\\"` to `ilike()`, so they rely on MySQL's implicit default
escape character rather than declaring it. That is correct under MySQL's
default configuration and wrong under `NO_BACKSLASH_ESCAPES`; the helper takes
the explicit route so the behavior does not depend on server mode. Worth
folding into the sweep, but it is not a live defect today.

## Open / not changed

- **SF-4 — LOW — `storefront.order` is held by one endpoint only.** Checkout
  requires `storefront.order` while the rest of the member surface requires
  `storefront.view`. Worth confirming the seeded member role grants both, or
  members can browse the store and fail at checkout. Not changed: it depends on
  seed/role data, which is an org-configuration question rather than a code
  defect.
