# Security Review — Storefront & Payments

**Prefix:** `SF` · **Iteration:** 04 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3) · **PR:** #1807 (pass 1)

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope, using `git diff` between tree states rather than `git log` commit
enumeration.** Pass 2 documented that this repo's history for this path was
squashed/rewritten at some point, so `git log --since`/ancestry traversal
can silently miss real commits — the exact mechanism that caused pass 2's
own first draft to under-scope and then need a correction. `git diff`
between two known commits doesn't have that failure mode: it compares tree
content directly, independent of how the commit graph between them is
shaped. Diffed pass 2's own closing merge (`d8c5e39e`) against current
`HEAD` across the full domain pass 2 established — not the narrower list
pass 1's header literally named, which is what caused pass 2's own
under-scoping — all ten backend files (`storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`email_templates_storefront.py`, `storefront_preview_service.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`), **plus two artifacts a
filename-only filter missed on the first pass of this correction, caught by
a second Codex round**: `app/utils/embroidery.py` (imported by both
`storefront_service.py` and `schemas/storefront.py`, so part of this
feature's real dependency graph even though its name doesn't match a
storefront/embroidery/personalization/thread filename filter applied to
`alembic/versions/` — it isn't a migration) and the
`settle_variant_size_order` migration
(`20260825_1520_c6a3f8b41e29_settle_variant_size_order.py`, named for what
it does rather than for "storefront"), the entire
`frontend/src/modules/storefront/` tree, and every other migration whose
filename matches storefront/embroidery/personalization/thread. **Zero
changes across that domain** — `git diff --stat` returns nothing for any of
it. SF-5 and SF-6's fixes, and every pass-1/2 "Verified good" item, stand
unmodified and unre-derived.

**Correction (Codex review on this PR, round 3): two more shared
dependencies this feature actually calls had changed, and "zero changes"
needed to become "reviewed the changes that exist," not another attempt at
an ever-widening enumeration.** `paypal_webhook.py` imports and calls
`public_rate_limit` from `app/core/security_middleware.py`, which changed
(both hunks carry a `Codex, PR #2106` comment, so already reviewed and
merged once independently of this rotation): a `RateLimiter` bug fix where
`lockout_seconds=0` — `public_rate_limit`'s own in-memory-fallback value —
made an expired-lockout check unconditionally clear the caller's whole
request history, so every `max_requests+1`th over-limit hit reset the
sliding window and defeated the limit entirely; now gated on
`lockout_seconds > 0`, so a real lockout still clears its history the same
way it always did, and a zero-second one no longer resets anything. Strictly
tightens enforcement — nothing this feature's webhook relies on got weaker.
A second, unrelated hunk in the same file self-heals a missing Redis TTL on
`daily_cap_exceeded`'s counter key so a transient `EXPIRE` failure can't
leave a scope blocked past its intended day. Frontend:
`frontend/src/modules/storefront/services/api.ts` builds its axios instance
via `createApiClient()`, which changed to decode a JSON error body that
arrives as a `Blob` (because axios applies a `blob` `responseType` to error
responses too, not just success ones — relevant here because storefront's
own order-export flow is exactly this shape) so the real backend error
message reaches the user instead of a generic fallback; parsed JSON only
feeds existing error-message plumbing, never a `dangerouslySetInnerHTML` or
similar sink. Both changes are defensive corrections to shared
infrastructure, not new surface, and neither weakens anything this feature
depends on.

**Correction (Codex review on this PR, two rounds): the router-level module
gate does reach every storefront request, and the routing/auth inventory had
two errors.** Round 1 of this correction claimed `a518957e`'s
`get_request_enabled_modules` change "doesn't reach this feature's routes at
all," reasoning only from a grep of `storefront.py` itself. Round 2 found
the real wiring: `app/api/v1/api.py` mounts `storefront.router` with
`dependencies=module_gate("storefront", "The Department Store")`, and
`module_gate` returns `[Depends(require_module(module, label))]` —
`require_module`'s inner check depends on `get_request_enabled_modules`
directly. So `a518957e` runs on **every** storefront request, contrary to
round 1's claim.

Re-verified what that actually means rather than repeating the same class of
error: `require_module`'s check is `if enabled is None or module in
enabled: return` — an unusable session (`enabled is None`, whether from no
cookie at all or, post-`a518957e`, an invalid one) makes the module gate
**pass through without checking the module flag**. That sounds like a
weakening, but it doesn't change the outcome for storefront specifically, for
a reason particular to this feature's routes: `module_gate` runs before an
endpoint's own auth dependency in FastAPI's resolution order, but the
endpoint's own dependency still runs immediately after and still uses the
**mandatory** `get_current_user` (or `require_permission`, which calls it),
which `a518957e` explicitly does not change — it still rejects a missing or
invalid credential with 401. Storefront has no route that would proceed past
that second check anonymously: all 48 routes require at least
`Depends(get_current_user)` (grep-confirmed against the current file). So a caller with no session or an invalid one
is rejected by the endpoint's own auth dependency regardless of what the
module gate decided — the module-gate pass-through and the endpoint's own
rejection land on the same outcome, just via a different one of the two
checks. For a genuinely authenticated caller whose org has the module
switched off, `enabled` resolves to the org's real flag set (unaffected by
`a518957e`, which only touches the invalid/absent-session path) and the 403
still fires normally. No finding — but "doesn't reach it" was wrong; the
correct statement is "reaches it and is a no-op for this route composition."

Round 2 also caught that round 1's authorization-inventory line — "every
route is permission-gated" — is itself wrong and contradicts this
document's own pass-1 "Verified good" section: `GET /permissions`
(`storefront.py:1512-1521`) is a deliberate `Depends(get_current_user)`
self-probe, not `require_permission(...)`, exactly as pass 1 already
recorded. Restated correctly below and in `PROGRESS.md`.

`core/permissions.py`'s diff since `d8c5e39e` does touch lines near
`STOREFRONT_VIEW`/`STOREFRONT_ORDER`/`STOREFRONT_MANAGE` — checked
precisely: every hit is adjacent-context noise from the unrelated
`equipment_check.*` → `inventory.check_*` rename (`cf033864`, also reviewed
in `PERM-02-permissions-roles.md`'s pass 3); none of the three storefront
`Permission(...)` definitions themselves changed. The rename **did** reach
this feature's own test suite, though: `test_corporate_storefront_grants.py`
(+28/-1) and `test_storefront_grant_backfill.py` (+15/-1) both needed a
`LEGACY_PERMISSION_ALIASES`-derived translation so their frozen pre-rename
migration snapshots keep comparing against the old `equipment_check.*`
spelling instead of silently matching nothing once the live registry moved
to `inventory.check_*` — a downstream test-fixture adaptation of the
already-reviewed rename, not a new behavior or a new finding; the backfill
migrations' own logic is untouched by either diff.

**Order export remains unbounded — carried forward again, still not
fixed, and pass 2's own citation for it was wrong.** Pass 2 recorded this at
`storefront_service.py:2916-2953,2980-3015`; re-checking those ranges
against current (byte-identical-to-pass-2) code shows they are
`_order_rollup`/`get_window_rollups`/`get_dashboard` — dashboard summary
code, not the export. The actual unbounded accumulation is
`export_orders_csv` (`storefront_service.py:3035-3072`): a `while True` loop
(`page += 1`) that extends one in-memory `orders` list until
`list_orders(...)` returns fewer than a full page, with no cap on the
number of pages or total rows before the CSV is built. Same defect pass 2
described, just at the range that actually contains it — a citation error
carried unnoticed through one prior pass. Still needs a product decision (a
row cap or a mandatory date window), not a drive-by fix.

**No new findings** beyond the corrections above (a wrong "doesn't reach it"
authorization claim, restated with the actual mechanism; a lost `GET
/permissions` exception; a wrong export line citation; two scope artifacts a
filename filter missed; two shared-dependency changes reviewed and confirmed
safe) — all in this write-up across three Codex rounds, none
in application code.

**Completion gate:** no backend or frontend source file was modified by
this pass — the `git diff` above is definitive, not merely a `flake8`/
`validate_migrations.py` spot-check standing in for one. Both re-run
directly anyway, alongside this pass's own PR's CI run for the frontend
gates and full test suite.

---

## Pass 2 (2026-08-27)

**Scope correction (Codex review on PR #1935):** the first draft of this
section scoped its diff to only the 7 files pass 1's header literally
listed under "Backend"/"Frontend", missing that a real feature had landed
touching this domain's models, schemas, a new utility module, six
migrations, and eleven frontend files — none of which the security-review
command's own procedure permits skipping (it asks for everything that
changed in the feature's area, not just the files a prior pass happened to
enumerate). Re-swept properly below, and the frontend completion-gate rows
this draft had wrongly marked "n/a" are now filled in for real.

`git diff` between PR #1807's merge commit (`311aa196`) and this PR's base
(`36ce7595`, the tip of `main` when this branch was cut) touches, in the
storefront domain:

- **Backend, declared scope:** `storefront.py` (+2, two new display fields
  added to the product-serialization allowlist) and `storefront_service.py`
  (+131/-6, the embroidery feature plus a size-aware variant-ordering fix).
  The other 5 declared files are byte-identical.
- **Backend, outside the literal file list, all part of the same feature:**
  `app/models/storefront.py` (+17 — two new nullable `String` columns each
  on `StoreProduct`/`StoreOrderItem`, no FK/`SET NULL` concern),
  `app/schemas/storefront.py` (+98 — the Pydantic schema half of the
  enum validation below), `app/utils/size_order.py` (new file, 162 L, a
  pure regex-based size-label sort key with no injection surface — reviewed
  in full), and 6 new/merge migrations (below).
- **Frontend, previously unreviewed this pass:** `OrderDetailModal.tsx`,
  `ProductFormModal.tsx`, `StoreProductCard.tsx`, `StoreWindowsTab.tsx`
  (all changed), `ThreadSwatch.tsx` (new), `types/index.ts` (+107, type
  mirrors of the backend enums), `utils/personalization.ts` (new),
  `utils/threadPreview.ts` (new) — all read in full.

**Embroidery thread color / personalization method is a closed-enum
feature end to end**, on both sides of the API boundary:

- Backend: `EmbroideryThreadColor`/`PersonalizationMethod` are `(str, Enum)`
  types; the create/update Pydantic schemas type the fields as those enums
  directly (an invalid value 422s before reaching the service); every read
  path normalizes defensively via `normalize_thread_color`/
  `normalize_personalization_method` (falls back to a default rather than
  raising on an unrecognized stored value). The CSV export's two new
  columns resolve only to fixed strings from the enum's own label table,
  never client input — the existing `SafeCsvWriter` is unchanged.
- Frontend: the product-edit picker (`ProductFormModal.tsx`) offers only
  the fixed `EMBROIDERY_THREAD_COLORS`/`PERSONALIZATION_METHODS` arrays
  (mirroring the backend enums); the one inline `style={{ backgroundColor:
... }}`/`style={{ color: ... }}` per swatch (`ThreadSwatch.tsx`,
  `StoreProductCard.tsx`) always resolves from that fixed catalog or from
  `personalizationThreadColorHex`, which the backend computes server-side
  from the same closed enum (`_resolve_thread_color_hex` model validator) —
  never a raw client-supplied string reaching a `style` attribute. Member-
  entered `personalizationText`/`trimmedText` renders as plain JSX text
  content in every location (React's default escaping applies) — no
  `dangerouslySetInnerHTML` anywhere in the diff. No `window.confirm`/
  `alert`/`prompt`.
- `size_order.py`'s regexes are simple and anchored (no nested quantifiers)
  — no ReDoS surface — and only ever order already-fetched, already-org-
  scoped rows; they make no access-control decision.

**The 6 new migrations, all reviewed:** `add_embroidery_thread_color` and
`add_personalization_method` each add two nullable `String` columns,
correctly guarded on table existence (Pitfall #26) since `store_products`/
`store_order_items` predate this and could theoretically not exist yet in
a fresh-DB CI run. `settle_variant_size_order` re-sorts existing variant
rows into size order using an inlined, frozen copy of the ranking (Pitfall
#20 — a migration must keep transforming rows the way it did the day it
ran, independent of `size_order.py`'s own freedom to grow new spellings
later); table-existence guarded, `downgrade` is a documented no-op (the
replaced values carried no information worth restoring). Two independent
grant backfills (`a4f8c1b92d17`, `c4f8a2e70d19`) were written for the same
bug from the same parent revision; the losing one is a documented no-op
deferring to the other, which correctly follows the Pitfall #23 shape
(`is_system`-scoped, rewrites a row only when its stored permissions still
exactly equal a frozen `_PRIOR_DEFAULTS` snapshot). A third grant migration
(`grant_corporate_storefront_access`) follows the identical shape for 13
corporate positions that had no storefront grant at all. Two more are pure
Alembic multi-head merges with no data changes. All guard tests
(`test_corporate_storefront_grants.py`, `test_storefront_baseline_grants.py`,
`test_storefront_grant_backfill.py`) pass.

- **`_ordered_variants`** makes `sort_order` fully server-computed (size
  order), where it previously honored a client-supplied `sort_order` on
  create. Not itself a security boundary (display ordering only), but a
  reduction in client influence over stored data, not an increase.
- **SF-6's separation-of-duties guard is confirmed still present and
  unmodified** — `record_payment`'s `assert_different_person(...)` call
  (`storefront_service.py:1826`) sits outside this diff's changed line
  ranges, re-verified by direct read. SF-5's guard tests
  (`test_refund_amount_must_be_positive`/`_may_be_omitted`) still pass
  unmodified.

**No findings.** No code changes this pass — the changes since pass 1 are a
well-built feature addition with proper enum-level validation throughout,
on both the backend and frontend.

**Completion gate (pass 2, corrected):** flake8/black/isort clean on
`app/ tests/ alembic/`; `validate_migrations.py --strict` passed (381
revisions, single head); scoped backend tests (`-k "storefront"`) 644
passed, 1 skipped (pre-existing) — SF-6/SF-5's four guard tests and all six
new grant/thread-color/variant-ordering guard-test files individually
re-confirmed passing; full backend suite 9040 passed, 22 skipped
(pre-existing), 0 failed. `tsc --noEmit` 0 errors; `eslint
src/modules/storefront/` 0 errors; `vitest run src/modules/storefront/`
15 files, 170 tests, all passed.

---

## Pass 1 (2026-08-25)

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
- **Git history since the 2026-08-08 pass, re-audited (correction — see
  below): no unaddressed regression beyond SF-6.** Frontend redesign of the
  member storefront (UI only), the `get_open_windows` eager-load /
  `MissingGreenlet` fix, three release-screenshot defects (frontend/UX),
  cart/product-lock key canonicalization (case-insensitive `product_id`/
  `variant_id` matching, so `ABC` and `abc` can no longer be tracked as
  separate stock/limit buckets), a notice-recipient disclosure fix (store-wide
  BCC announcements previously left the _first_ recipient's address visible
  in `To:` — now sent individually so no recipient sees another's address),
  and a new member-facing payment-method-change endpoint (self-scoped via
  `get_order(..., user_id=user_id)`, blocked once `PAID`/`WAIVED`/
  `PENDING_VERIFICATION`, method validated against the store's accepted
  list) — all verified present in current code and correct. The one gap this
  history should have caught the first time is SF-6.

## Correction (added after initial review, before merge)

**The claims above were wrong on first pass, caught by a Codex review comment
on the PR.** The original text asserted "three commits… all UI/robustness…
no open security gap" and reported "no new findings." Both were incorrect:

1. **The git-history sweep was incomplete.** `git log --since` on this
   repo's history cannot be trusted (documented already in `AUTH-01` —
   history for this path was squashed/rewritten at some point, so commits
   with dates _after_ the cutoff don't reliably surface, and some commit
   hashes cited in review tooling don't resolve to objects in this shallow
   clone even though their content is present in the current tree). Re-swept
   by hand, cross-checking `git show <hash>` output against current file
   content rather than trusting `--since`/ancestry: the five additional
   commits above are real and their changes are live in the current
   codebase. Four are correctness/hardening fixes already present and
   correct (listed above). The fifth uncovered SF-6.
2. **A real, live separation-of-duties bypass was missed.** See SF-6.
3. **A still-open item from the prior app-review's future-development list
   (unbounded `/orders/export`) was silently dropped instead of carried
   forward.** Recorded below, unfixed — see "Carried forward, not fixed."

## Findings

### SF-6 — MED — `record_payment` had no separation-of-duties check, unlike its three siblings — ✅ FIXED (see "Correction" above for how this was found)

**What:** `mark_order_paid`, `waive_order_payment`, and `refund_order` all
call `assert_different_person(actor_id, order.user_id, ...)` before mutating
an order's payment state. `record_payment` — the method all three of those
actually delegate to for the ledger mutation itself, and also directly
exposed as its own endpoint — had no such check.

**Where:** `app/services/storefront_service.py:1716` (pre-fix).

**Failure scenario:** `mark_order_paid` calls
`assert_different_person(...)` and then calls `self.record_payment(...)` to
do the work — so the guard was on the wrapper, not the engine. `POST
/orders/{order_id}/payments` calls `record_payment` directly, skipping the
wrapper (and its guard) entirely. A `storefront.manage` holder who also owns
the target order — a plausible overlap in a small department, and exactly
the scenario `mark_order_paid`'s own inline comment names as the thing being
guarded against — could settle their own order's balance (including
flipping it to `PAID` when `mark_paid=True`, the default) through this route
with no check at all. `apply_payment_event` (the manual "settle from a
recorded payment event" admin action) also calls `record_payment` with the
caller's real id and was equally unguarded through that second path.

**Impact:** the prior app-review's "no separation of duties on payments" item
treated this as one deliberate, accepted product decision spanning all four
actions ("plausible for a small department… same product decision as
FIN-4/AH-4"). That framing was accurate when it was written but went stale:
at some point three of the four actions were given the guard (found via
`git log -S"assert_different_person"`, itself dateless due to the squashed
history), leaving `record_payment` as an inconsistency — an oversight against
an established pattern, not a product decision anyone made about this
specific method.

**Fix:** added the same `assert_different_person` call directly inside
`record_payment`, positioned before any mutation (mirroring
`mark_order_paid`'s placement). No-ops when `actor_id` is `None` — the
automated PayPal reconciliation path (`record_external_payment` →
`apply_payment_event(..., actor_id=None)` → `record_payment`) is unaffected,
verified by tracing that call chain. `mark_order_paid` keeps its own
(now-redundant but harmless) check rather than removing it, to avoid
touching a working, tested wrapper for no functional gain.

Four existing tests incidentally called `record_payment` with the order's
own member as `actor_id` — not testing self-approval, just written before
the guard existed. Updated to use a distinct officer actor, matching the
pattern already used everywhere else in the same file for exactly this
reason.

**Guard tests:** `tests/test_storefront_service.py` —
`test_cannot_record_a_payment_on_your_own_order` (asserts
`SeparationOfDutiesError` when `actor_id == order.user_id`) and
`test_reconciliation_may_record_a_payment_with_no_actor` (confirms the
`actor_id=None` exemption the automated path relies on still works).

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

## Carried forward, not fixed

- **Order export is unbounded.** `GET /orders/export` pages through every
  matching order into one in-memory list before building the CSV
  (`storefront_service.py:2916-2953,2980-3015`). Already recorded as an open
  future-development item in `docs/app-review/storefront.md:246-247`
  ("Same shape as the export DoS noted in FIN-7… Scale limit"). Not
  re-derived and not fixed here — flagging explicitly so this security pass
  doesn't read as having cleared it. A fix needs a row cap or a required date
  window, which is a behavior change belonging with a product decision, not
  a drive-by in this iteration.

## Schema & migration notes

No models touched this iteration. No drift found between any storefront
model and its migrations.

## Guard tests added

- `test_cannot_record_a_payment_on_your_own_order` /
  `test_reconciliation_may_record_a_payment_with_no_actor`
  (`tests/test_storefront_service.py`) — fail if the `record_payment`
  separation-of-duties guard regresses or the reconciliation exemption
  breaks.
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
| backend tests (scoped: `-k storefront`)   | ✅ 533 passed, 1 skipped (environment-only: py_vapid not installed) |
| `tsc --noEmit`                            | ✅ 0 errors (no frontend files touched)                             |
| `eslint .`                                | n/a — no frontend files touched                                     |
