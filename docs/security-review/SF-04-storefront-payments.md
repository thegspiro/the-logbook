# Security Review — Storefront & Payments

**Prefix:** `SF` · **Iteration:** 04 · **Reviewed:** 2026-08-25 · **PR:** #TBD

**Backend:** `app/api/v1/endpoints/storefront.py` (1650 L, 48 endpoints),
`app/services/storefront_service.py` (3184 L),
`app/services/storefront_notification_service.py` (1016 L),
`app/services/email_templates_storefront.py` (564 L),
`app/services/storefront_preview_service.py` (378 L),
`app/utils/storefront_payments.py` (348 L),
`app/api/public/paypal_webhook.py` (153 L, spot-checked in PUB-03)
**Frontend:** none touched
**Migrations:** none touched

---

## Scope

This is the most heavily-audited module in the codebase before this pass: a
dedicated module audit (iteration 28, 2026-08-07) and two app-review passes
(2026-08-05, 2026-08-08) already covered the endpoint layer (47/48 routes
enumerated for auth), tenant isolation, client-FK validation, LIKE-escaping,
money-as-`Decimal`, refund guards, reconciliation, and the PayPal webhook in
depth — explicitly called "the best-defended module reviewed to date." This
iteration did not re-derive that work. It re-verified the established
invariants still hold against current code, read the one file with no prior
audit coverage (`storefront_preview_service.py`, 378 L — used by 2 endpoints:
notification preview/test-send), and checked git history since the last pass
for anything the existing docs don't yet reflect.

## Verified good ✅

- **Auth coverage: 48/48 endpoints gated** (one more than the 47 last
  recorded — `enumerate_storefront_routes` re-run this iteration confirms all
  48; the delta is accounted for by the two preview/test-send routes below,
  which did not exist at the last audit). Every route carries
  `require_permission("storefront.view" | "storefront.order" | "storefront.manage")`
  except `GET /permissions`, a deliberate bare-`get_current_user` self-probe
  that returns only the caller's own capability flags.
- **`storefront_preview_service.py` (unaudited, read in full) is clean.**
  Both endpoints that use it (`GET .../preview`, `POST .../test`) require
  `storefront.manage`; `organization_id` passed into the service comes only
  from `current_user.organization_id`, never a client-supplied value; the
  test-send recipient comes only from `current_user.email` — the docstring's
  claim ("delivery is only ever to the requesting user's own email... cannot
  be turned into a way to mail arbitrary people") was verified against the
  endpoint, not just the service. The client-supplied `notice` path param is
  used only as a dict key into a fixed catalog (`CATALOG.get(notice)`); an
  unknown value raises a 404, not an injection surface. Sample preview data
  is fabricated in Python and never persisted.
- **Established invariants re-confirmed unchanged**: `_price_lines` still
  prices every line from the catalog, never the client; money is `Decimal`
  end-to-end (no `float(` in the service); refund guards still reject
  `refunded > paid`; all 7 `.ilike()`/`.like()` calls in
  `storefront_service.py` pass `escape=LIKE_ESCAPE_CHAR` (matches the
  whole-codebase sweep from security-review iteration 00); zero raw SQL;
  zero TODO/FIXME. PayPal webhook signature verification, replay guard, and
  audit logging (spot-checked already in `PUB-03-public-surface-webhooks.md`)
  remain intact.
- **A previously-open finding (module-audit SF-4) is resolved, found via git
  history rather than by re-deriving it.** `storefront.order` being held by
  only one endpoint, while the rest of the member surface uses
  `storefront.view`, was flagged as worth confirming against seed data. A
  2026-08-24 fix (`_VIEW_IMPLIED_PERMISSIONS` in `onboarding.py`) closes it at
  the source: the position editor now grants `storefront.order` alongside
  `storefront.view` whenever a module is saved with View ticked and Manage
  not, for both a from-scratch position and an existing one's carried-over
  defaults. Verified all fourteen seeded positions holding `storefront.view`
  hold `storefront.order` (documented and asserted at
  `onboarding.py:1821-1823`). Corrected `docs/module-audit/storefront.md` to
  mark SF-4 resolved rather than leaving it recorded as open.
- **Git history since the 2026-08-08 pass shows no unaddressed security
  regression.** Three substantive commits landed: a full frontend redesign of
  the member storefront (UI only, no backend security surface), a fix for
  `get_open_windows` not eager-loading `offerings` (a `MissingGreenlet` 500 on
  the admin dashboard — the same bug class found and fixed in this
  iteration's own PERM-02 pass, independently caught and fixed by the project
  itself here), and three defects behind the module's release screenshots
  (all frontend/UX, already fixed and tested). None left an open security
  gap.

## Findings

No new findings this iteration. One test-coverage gap from the prior
app-review's future-development list was closed as a cheap, safe addition
(see below); no code-behavior change was needed anywhere else.

### SF-5 — NIT — Refund amount's `gt=0` constraint had no regression test — ✅ FIXED (test only)

**What:** the 2026-08-08 app-review flagged that both the negative-quantity
and negative-refund rejections were enforced only by Pydantic `Field`
constraints (`ge=1` / `gt=0`) with no test pinning them, so a schema refactor
could silently drop either. `test_quantity_must_be_positive` already existed
for the order-quantity half; the refund-amount half did not.

**Where:** `tests/test_storefront_schemas.py`.

**Fix:** added `test_refund_amount_must_be_positive` (rejects `0` and a
negative value) and `test_refund_amount_may_be_omitted` (confirms `None` —
"refund the full balance" — is not caught by the same constraint). No
production code changed; `StoreOrderRefund.amount` already had `gt=0`.

## Schema & migration notes

No models touched this iteration. No drift found between any storefront
model and its migrations.

## Guard tests added

- `test_refund_amount_must_be_positive` / `test_refund_amount_may_be_omitted`
  (`tests/test_storefront_schemas.py`) — close the last cheap test-coverage
  gap the 2026-08-08 app-review's future-development list identified.

## Completion gate

| Check                                     | Result                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`             | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`      | ✅ unchanged                                                        |
| `isort --check-only app/ tests/ alembic/` | ✅ clean                                                            |
| `validate_migrations.py --strict`         | ✅ single head                                                      |
| backend tests (scoped: `-k storefront`)   | ✅ 531 passed, 1 skipped (environment-only: py_vapid not installed) |
| `tsc --noEmit`                            | ✅ 0 errors (no frontend files touched)                             |
| `eslint .`                                | n/a — no frontend files touched                                     |
