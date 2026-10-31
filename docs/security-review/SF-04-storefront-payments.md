# Security Review — Storefront & Payments

**Prefix:** `SF` · **Iteration:** 04 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8), 2026-10-14 (pass 9), 2026-10-18 (pass 10), 2026-10-22 (pass 11), 2026-10-25 (pass 12), 2026-10-28 (pass 13), 2026-10-31 (pass 14) · **PR:** #1807 (pass 1)

---

## Pass 14 (2026-10-31) — watchdog pickup: true near-zero delta, 0 fixed, 0 new findings

Watchdog pickup. The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable, confirmed via
`ListAgents`. Step 0 (`gh api repos/.../pulls?state=open`) found 0 open PRs
whose head branch starts with `claude/security-review-`: the three open PRs
at the time (#3875, #3876, #3877) are all unrelated feature work. PR #3878
(Feature 03, Public surface & webhooks, pass 14) had already merged
(`657911daa`). Row 04 (Storefront & payments) was the next `⬜` row,
confirmed on a freshly fetched, unshallowed `main`.

**Scope.** Diffed pass 13's own merge (`7c0162c06`, PR #3805) against current
`main` across the full established domain: `storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `email_templates_storefront.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, and every migration added
since, checked by content for storefront/embroidery/personalization/thread
keywords (repo was shallow at session start; `git fetch --unshallow`
resolved it before trusting any diff range, same precaution every prior pass
has had to take).

**Near-zero delta — exactly 2 non-merge commits touch this scope, both read
in full:**

1. **`31f39cf6c` — "Notifications: officer alerts whose email can be turned
   off also leave a bell entry."** Touches only
   `storefront_notification_service.py`, adding `get_admin_user_ids` (a
   fresh, org-scoped `select(User).where(User.organization_id == ...,
User.status.in_(ACTIVE_ACCOUNT_STATUSES), ...)` — Pitfall #32 compliant,
   not a literal `== ACTIVE`) and wiring `send_admin_new_order` to also write
   an in-app bell entry via the new shared `officer_alert_copies.
add_in_app_copies` helper, guarded by `if self._capture is None` so a
   settings-screen preview (which diverts into `_capture` instead of
   sending) never writes a bell entry — exactly the "not written for a
   settings preview" the commit message states, confirmed by reading
   `StorefrontNotificationService.__init__`'s own docstring on `_capture`.
   Read `add_in_app_copies` (new shared infra in
   `app/services/officer_alert_copies.py`) in full: `organization_id` is the
   caller's own already-resolved `order.organization_id` (never a
   client-supplied id), `recipient_ids` come only from the org-scoped
   `get_admin_user_ids` query, and the one `logger.debug` call passes
   `category`/`organization_id`/counts as arguments rather than splicing them
   into the f-string (Pitfall #33 compliant). The notification `message`
   interpolates `order.customer_name` (itself server-derived at order
   creation from `user.full_name or user.email or "Member"`, already
   reviewed under this feature in prior passes — not client-free-text at
   checkout) via an f-string, but this is building a stored `message` field,
   not a log call, so Pitfall #33 does not apply to it; checked the frontend
   render path (`components/NotificationCard.tsx:228,264`) renders
   `notification.message` as plain JSX text (`{notification.message}`), never
   `dangerouslySetInnerHTML`, so React's default escaping closes any HTML/XSS
   concern regardless. `storefront_admin` is a new `NotificationLog.category`
   value; `notificationCategoryDisplay.tsx`'s `CATEGORY_ALIASES` map is
   cosmetic only (icon/color, falls back to a generic icon for an
   unmapped category) — its absence from that map is not a Pitfall #19
   "switch with no reader" shape, since the bell entry still renders and
   functions without it. No route, permission, schema, or org-scoping file
   touched.
2. **`f2ea7ba55` — "Stop the remaining pages jumping while they load"**
   (a 135-route layout-shift sweep). Touches only
   `StoreAdminPage.tsx` (+11/-2): the back-link-to-Inventory anchor is held
   in the layout, invisible (`invisible` class) and keyboard-unreachable
   (`tabIndex={-1}`, `aria-hidden`) while the enabled-modules lookup is in
   flight, instead of popping in afterwards and shifting the header. Purely
   a CSS/accessibility layout fix — `aria-hidden`/`tabIndex={-1}` correctly
   pair so an invisible link is also not tab-focusable, and Tailwind's
   `invisible` utility (`visibility: hidden`) already makes it
   unclickable — no data-fetching, auth, or permission logic touched.

**No new migrations** touching storefront/embroidery/personalization tables
landed in this window. Four new migration files since pass 13 matched a
content grep for `store_`/`storefront`/`thread` purely incidentally — three
repeat the repo-wide `REQUIRED_EMAIL_KINDS`/notification-kind enum literal
list (which happens to include the ten `storefront_*` template-kind strings)
for unrelated follow-up-form seed migrations, and the fourth
(`d8f1a4c27b93`, positions/committee seeds) grants new baseline positions the
same member-level `storefront.view`/`storefront.order` pair every other
baseline position already carries — the same false-positive content-grep
shape pass 3/4/7 already classified, re-confirmed by reading each match
directly; none creates or alters a `store_*` table.

**Re-verified unchanged, by direct read of an empty diff (not inferred from
"file not listed"):** `git diff --stat 7c0162c06..main -- storefront.py
storefront_service.py schemas/storefront.py paypal_webhook.py
models/storefront.py storefront_preview_service.py storefront_payments.py
size_order.py embroidery.py` returns nothing — every one of those files is
byte-identical to pass 13's reviewed state. This means the price/amount
integrity guard (`StoreOrderItemInput` carries no price field;
`_price_lines` recomputes every line from the org-scoped catalog),
capacity locking (organisation → window → product → tally lock order),
all five self-settlement separation-of-duties guards
(`assert_different_person` in `record_payment`, `mark_order_paid`,
`waive_order_payment`, `refund_order`, `update_order_status`'s settlement
branch), the PayPal webhook signature verification and replay/idempotency
guard (`UniqueConstraint(organization_id, provider, external_id)`), and
SF8-04-2/SF8-04-3's locking fixes (pass 13's own confirmation) all carry
forward unchanged with no re-derivation needed.

**Route inventory re-enumerated by AST, independently of the file diff.**
`ast.walk` over every `@router.{get,post,put,patch,delete}`-decorated
function in `storefront.py` finds **48** routes — identical to pass
11/12/13's count. Re-read every one of the 48 against its dependency: 47
carry `require_permission(...)` (the member self-service surface —
`/orders/mine*`, payment-method update, `report_payment`, order
cancellation — `storefront.view`; order creation the dedicated
`storefront.order`; every catalog/window/order-admin/payment-admin route,
including both refund and the four payout/settlement routes,
`storefront.manage`); the 48th (`GET /permissions`) carries only
`Depends(get_current_user)` — a self-introspection endpoint returning the
caller's own permission flags, listed in
`tests/permissionless_route_baseline.txt`
(`app/api/v1/endpoints/storefront.py::get_store_permissions`), unchanged
classification from every prior pass.

**0 fixed, 0 new findings.** Both standing findings this feature carried
(SF8-04-2, SF8-04-3) were already confirmed FIXED in pass 13 — see that
section — and remain fixed: the file that held both (`storefront_service.py`)
is byte-identical to pass 13's state, confirmed above.

## Guard tests added (pass 14)

None new. Nothing in this window's 2-commit delta closed a new class of bug.
Re-ran the full existing suite: `test_storefront_payment_race.py`,
`test_storefront_waive_settled.py`, `test_storefront_order_deadlock.py`,
`test_storefront_schemas.py`, `test_storefront_locking.py`,
`test_encryption_registry_coverage.py`, `test_email_fingerprint.py`,
`test_rotate_email_fingerprints.py`, `test_officer_alert_copies.py` (the new
shared bell-copy sender this pass reviewed, not storefront-owned, included
because `send_admin_new_order` now calls it), plus the repo-wide
`test_org_scoping_ratchet.py` / `test_capacity_locking.py` /
`test_csv_writer_sweep.py` / `test_like_escaping.py` /
`test_migration_create_all_tables.py` / `test_baseline_member_grants.py` /
`test_account_status_gates.py`.

## Completion gate (pass 14)

| Check                                                                                                                                                                         | Result                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`, CI's interpreter/pin)                                                                                                  | ✅ 0 violations                                          |
| `black --check app/ tests/ alembic/`                                                                                                                                          | ✅ 2754 files unchanged                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                     | ✅ clean                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                             | ✅ 679 revisions, single head (`c588f525fdbb`)           |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                             | ✅ 281 routes, 0 errors, 0 warnings                      |
| backend tests (scoped: `-k "storefront or stripe or payment or refund or checkout"`)                                                                                          | ✅ 603 passed, 1 skipped (environment-only: `pywebpush`) |
| storefront + bell-copy guard suites (payment race, waive-settled, order-deadlock, schemas, locking, encryption-registry coverage, email-fingerprint ×2, officer-alert-copies) | ✅ 66 passed                                             |
| standing repo-wide guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates) | ✅ 171 passed                                            |
| `cd frontend && npm run typecheck`                                                                                                                                            | ✅ 0 errors                                              |
| `npm run lint` (`eslint --max-warnings 10`)                                                                                                                                   | ✅ 0 errors, 0 warnings                                  |

Note on tooling (still true this pass): a bare `python3`/`pytest` on this
sandbox resolves to an isolated interpreter (3.11) lacking the app's own
dependencies; `/usr/bin/python3` (3.13) is the one with
`sqlalchemy`/`fastapi`/`flake8`/`black`/`isort`/`pytest` installed at the
versions CI pins, and is what every command above actually ran under.

---

## Pass 13 (2026-10-28) — watchdog pickup: SF8-04-2 and SF8-04-3 both confirmed fixed; email/phone/address encryption-at-rest verified; 0 new findings

Standing-rotation pickup (`/loop 30m /security-review`): the dedicated
session (`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable, confirmed
via `ListAgents`. PR #3804 (Feature 03, Public surface & webhooks, pass 13)
had already merged with no open rotation PR behind it — confirmed via
`search_pull_requests` (`is:pr is:open head:claude/security-review-`), 0
matching results. Row 04 (Storefront & payments) was the next `⬜` row in
`PROGRESS.md`'s rotation table, confirmed on a freshly fast-forwarded `main`.

**Scope.** Diffed pass 12's own merge (`4f27e679f`, PR #3688) against
current `main` across the full established domain: `storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `email_templates_storefront.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, and migrations matching
storefront/embroidery/personalization/thread/order/product by content.
(Repo was shallow at session start; `git fetch --unshallow` resolved it
before trusting the diff, same precaution prior passes took.)

**Real delta, every file read in full:**

- **`storefront.py` (endpoints), `schemas/storefront.py`,
  `storefront_payments.py`, `paypal_webhook.py` — byte-identical to pass 12.** Route inventory re-enumerated by AST independently of the file
  diff (not trusted from "unchanged"): **48** routes, matching pass
  11/12's count exactly, all 48 re-confirmed carrying the permission gates
  pass 12 cited (47 `require_permission(...)`, the 48th —
  `GET /permissions` — a self-introspection endpoint on
  `Depends(get_current_user)` only, unchanged classification).
- **SF8-04-2 — MED — ✅ FIXED, confirmed this pass.** `update_order_status`
  (`storefront_service.py:1904`) now calls `get_order(order_id,
organization_id, for_update=status == StoreOrderStatus.PAID)` — the
  order row is locked precisely for the one transition
  (`settles_payment`) that writes `amount_paid`/`payment_status` from a
  read, closing the stale-read race pass 8 through pass 12 carried open.
  Landed in commit `4a51ec6a1` ("Lock storefront settlement on a move to
  PAID, refuse waiving a settled order"), between pass 12's merge and this
  pass's baseline. Covered by
  `test_storefront_payment_race.py::test_a_status_update_to_paid_racing_a_payment_does_not_lose_it`
  — re-run this pass, passes.
- **SF8-04-3 — LOW — ✅ FIXED, confirmed this pass.** `waive_order_payment`
  (`:2141`–`:2152`) now locks the order (`for_update=True`) and raises
  `ValueError` (→ 400, via `safe_error_detail()`) if the order's payment is
  already `WAIVED` or already settled (`_is_settled(order)`), per the
  owner's chosen resolution (refuse rather than silently overwrite a paid
  order's status). A partly-paid order can still be waived — only a fully
  settled or already-waived one is refused. Covered by
  `test_storefront_waive_settled.py` — re-run this pass, passes. Both
  findings were already reflected as resolved in `KNOWN_LIMITATIONS.md`
  (SF8-04-2, SF8-04-3 entries); no edit needed.
- **Email/phone/address encryption at rest — verified correct, not this
  feature's own change.** `models/storefront.py`: `StoreOrder.customer_email`
  and `.customer_phone` and `.shipping_address` are now `EncryptedText`
  (previously plaintext `String`/`Text`); `StorePaymentEvent.payer_email`
  likewise. This is the app-wide email/PII-at-rest rollout (migration
  `b8236e29ec44`), already reviewed under its own rotation slot (Core
  infrastructure, CI10/CI11) and the cross-cutting baseline — this pass
  verified only that it was applied _correctly_ to this feature's fields,
  per CLAUDE.md Pitfall #29 (consume the shared mechanism, don't re-derive
  it):
  - `StoreOrder` gained a `customer_email_hash` column and a
    `keep_email_fingerprint(StoreOrder.customer_email,
"customer_email_hash")` registration (`models/storefront.py:1091`) —
    confirmed present in `rotate_encryption_key.py`'s hand-maintained
    `_FINGERPRINT_COLUMNS` list (`("store_orders", "customer_email",
"customer_email_hash")`), so a future key rotation will re-derive this
    column's fingerprints too — exactly the gap CI11-33's guard test exists
    to catch (`test_encryption_registry_coverage.py`, re-run this pass:
    passes, both directions).
  - The order search path (`storefront_service.py:~1877`) that used to
    `ilike` the plaintext `customer_email` column now matches
    `customer_email_hash.in_(email_fingerprints(search))` — correct: an
    encrypted column cannot be `ILIKE`'d server-side at all, so dropping to
    exact-match-by-fingerprint is the only sound option, not a narrowing of
    a feature. A new `ix_store_orders_org_customer_email_hash` index backs
    it so the lookup stays org-scoped and indexed rather than a table scan.
  - `storefront_notification_service.py`'s member-notification-preference
    lookup (`:611`) switched from `User.email.in_(addresses)` to
    `User.email_hash.in_([... email_fingerprints(a) for a in addresses
...])` — same pattern, correct.
  - `StorePaymentEvent.payer_email` is written only (from PayPal's capture
    payload) and never matched/searched against anywhere in
    `storefront_service.py` or `paypal_webhook.py` — confirmed by grep — so
    it correctly has no fingerprint column; one would be dead weight.
  - Read paths (`_window_customer_emails`, the payment-reminder sweep's
    `customer_email.isnot(None)` filter, direct attribute reads) are
    unaffected: `EncryptedText` decrypts transparently on attribute access,
    and a NULL-check doesn't need plaintext.
- **A second, independent feature change: per-org "switched off" email
  notices.** `storefront_notification_service.py` gained a `_switched_off()`
  check (`:461`) consulting `EmailTemplateService.is_switched_off()` before
  sending any storefront notice (order confirmations, payment reminders,
  etc.), with a small per-call cache. `is_switched_off()` itself
  (`email_template_service.py:3509`) is shared, org-scoped
  (`EmailTemplate.organization_id == str(organization_id)`) infrastructure
  belonging to the Forms/Messaging rotation slot, not re-derived here — this
  pass verified only that storefront's new call site uses it correctly:
  fails open on a read error (logged, not raised — matches the existing
  "template that will not load" fail-open precedent in the same file), is
  **not** consulted by the preview path (so an admin previewing a switched-off
  notice still sees what it would say), and both new log calls pass the
  template type and org id as logger arguments rather than splicing them
  into the message string (CLAUDE.md Pitfall #33 — one formatting pass, no
  f-string-plus-arguments). This is a genuine, wired reader for a
  not-yet-reviewed-here config switch, not Pitfall #19's "switch with no
  reader" shape, and it was not accompanied by any new orphaned setting.
- **Frontend: Department Store console reorganized into two-level
  navigation** (`storeAdminTabs.ts` +82 lines, `StoreAdminPage.tsx`
  rewritten, `storeAdminTabs.test.ts` new), matching the shared area-card
  pattern Training/Events/Members/Inventory/Scheduling administration hubs
  already use. Read in full: purely a client-side navigation/URL-param
  shell (`?tab=`) around the same six existing tabs — no new data fetch, no
  new permission check, no change to which API calls a given tab makes.
  Traces to a server-side decision already enforced (the same 48 routes,
  unchanged) exactly as FE12-34's framing describes for this kind of
  change — correctly scoped as UI/UX only.
- **Price/amount integrity, capacity locking, separation of duties.**
  Re-verified unchanged at the same lines pass 12 cited: `StoreOrderItemInput`
  still carries no price field; `_price_lines` still recomputes every line
  from the org-scoped, lock-ordered catalog read; all five self-settlement
  guards (`record_payment`, `mark_order_paid`, `waive_order_payment`,
  `refund_order`, `update_order_status`'s settlement branch) still call
  `assert_different_person` before any ledger mutation.

**0 fixed by this pass (both standing findings were already fixed by the
owner between passes), 0 new findings.**

## Guard tests added (pass 13)

None new. Re-ran the existing suite that now covers both closed findings
(`test_storefront_payment_race.py`, `test_storefront_waive_settled.py`,
`test_storefront_order_deadlock.py`, `test_storefront_schemas.py`,
`test_storefront_locking.py`, `test_encryption_registry_coverage.py`,
`test_email_fingerprint.py`, `test_rotate_email_fingerprints.py`), plus the
repo-wide `test_org_scoping_ratchet.py` / `test_capacity_locking.py` /
`test_csv_writer_sweep.py` / `test_like_escaping.py` /
`test_migration_create_all_tables.py` / `test_baseline_member_grants.py` /
`test_account_status_gates.py`.

## Completion gate (pass 13)

| Check                                                                                                                                                                                                                | Result                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`, CI's interpreter/pin)                                                                                                                                         | ✅ 0 violations                                          |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                 | ✅ 2706 files unchanged                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                            | ✅ clean                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                    | ✅ 666 revisions, single head (`0d9897752425`)           |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                    | ✅ 279 routes, 0 errors, 0 warnings                      |
| backend tests (scoped: `-k "storefront or stripe or payment or refund or checkout"`)                                                                                                                                 | ✅ 597 passed, 1 skipped (environment-only: `pywebpush`) |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates, encryption-registry coverage, email-fingerprint) | ✅ 190 passed                                            |
| `cd frontend && npm run typecheck`                                                                                                                                                                                   | ✅ 0 errors                                              |
| `npm run lint` (`eslint --max-warnings 10`)                                                                                                                                                                          | ✅ 0 errors, 0 warnings                                  |

Note on tooling (still true this pass): a bare `python3`/`pytest` on this
sandbox resolves to an isolated interpreter lacking the app's dependencies;
`/usr/bin/python3` (3.13) is the one with `sqlalchemy`/`fastapi`/`flake8`/
`black`/`isort`/`pytest` all installed at the versions CI pins.

---

## Pass 12 (2026-10-25) — watchdog pickup: true zero-delta, 0 fixed, 0 new findings; SF8-04-2/SF8-04-3 re-confirmed open, unchanged

Standing-rotation pickup (`/loop 30m /security-review`): PR #3687 (Feature 03,
Public surface & webhooks, pass 12) had already merged with no open
rotation PR behind it — confirmed via `search_pull_requests`
(`is:pr is:open head:claude/security-review-`), 0 matching results, checked
before starting and re-checked immediately before branching. Row 04
(Storefront & payments) was the next `⬜` row in `PROGRESS.md`'s rotation
table.

**Scope.** Diffed pass 11's own merge (`6b85bc33`, PR #3559) against current
`HEAD` across the full established domain: `storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `email_templates_storefront.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, and every migration under
`alembic/versions/` whose filename or content matches
storefront/embroidery/personalization/thread/grant.

**Unshallowed before trusting the delta** (`git rev-parse
--is-shallow-repository` → `true`; `git fetch --unshallow` resolved it —
same precaution passes 9–11 each had to take).

**True zero-delta on the backend.** `git log --no-merges 6b85bc33..origin/main`
across the entire file list above returns exactly **one** commit
(`8d5764549`, "Fix form fields squeezed and misaligned on iPad/tablet," a
134-route Playwright tablet-layout sweep), and its only line inside this
feature's scope is a 2-line, CSS-only change in
`frontend/src/modules/storefront/components/StoreOrdersTab.tsx` — the order
method `<select>` moved into its own grid cell so it no longer splits a
column with the search box on an iPad-width screen beside the side nav. Read
in full: no logic, data-fetching, auth, or org-scoping content. No backend
file in the declared scope changed at all. A `--diff-filter=A` scan of new
migration files between the two commits, checked by content for
storefront/embroidery/personalization keywords, found zero matches — no new
storefront-related migration landed either.

**Re-verified unchanged, by direct read (not merely by the empty diff):**

- **Route inventory, by AST, not spot-check.** `ast.walk` over every
  `FunctionDef`/`AsyncFunctionDef` decorated with
  `@router.{get,post,put,patch,delete}` in `storefront.py` counts **48**
  routes — identical to pass 11's count. All 48 were read against their
  `Depends(...)` line directly: 47 carry `require_permission(...)` (the
  member self-service surface — `/orders/mine*`, payment-method update,
  `report_payment`, order cancellation — gated `storefront.view`; order
  creation gated the dedicated `storefront.order`; every catalog/window/
  order-admin/payment-admin route gated `storefront.manage`, including both
  refund (`POST /orders/{order_id}/refund`, `:1412`) and payout/settlement
  routes (`record_payment`, `mark_order_paid`, `waive_order_payment`,
  `bulk_mark_orders_paid`)); the 48th (`GET /permissions`, `:1534`) carries
  only `Depends(get_current_user)` — a self-introspection endpoint returning
  the caller's own permission flags, no data exposure, unchanged from every
  prior pass's classification.
- **Price/amount integrity.** `StoreOrderItemInput` (`schemas/storefront.py:662`)
  still carries no price field — only `product_id`, `variant_id`, `quantity`,
  `personalization_text`. `StoreOrderCreate`'s own docstring states the
  invariant directly ("Prices are deliberately absent: the server recomputes
  every line from the catalog so a tampered client cannot set its own
  price"), and `_price_lines` (`storefront_service.py:1529`) still derives
  every line's price from the org-scoped `StoreProduct`/`StoreWindowProduct`
  rows read under lock, never from client input.
- **Capacity locking (Pitfall #27).** `_price_lines` still takes the lock
  order documented in its own comment — organisation row
  (`StoreSettings`, `:1588`) → window row (`:1592`) → products
  (`_lock_products`, `:1600`) → per-window/per-member ordered-quantity
  tallies, all `with_for_update()` — before computing any cap, with the
  rationale (gap-lock deadlocks measured at the product- and window-row
  granularities before landing on the organisation row) still documented
  in-line. Unchanged from every prior pass's citation.
- **SF8-04-2 — MED — ✅ FIXED 2026-10-25 (owner-directed, after this pass).**
  `update_order_status` now reads the order with `for_update=True` when the
  target status is `PAID` (option 1 below, narrowed to the one transition that
  can settle); `test_storefront_payment_race.py::test_a_status_update_to_paid_racing_a_payment_does_not_lose_it`.
  Pass 12's text as found: `update_order_status`
  (`storefront_service.py:1896`) still resolves the order via a plain,
  unlocked `get_order()` (`:1905`), and its `settles_payment` branch still
  writes `order.payment_status = PAID` / `order.amount_paid = _money(order.total)`
  (`:1949`–`:1951`) from that unlocked read. Line numbers match pass 11's
  citation exactly (file byte-identical in this range).
- **SF8-04-3 — LOW — ✅ FIXED 2026-10-25 (owner-directed, after this pass).**
  Owner chose refusal: `waive_order_payment` locks the order and raises
  `ValueError` (→ 400) on an order already paid or already waived; a partly
  paid order can still be waived. `test_storefront_waive_settled.py`.
  Pass 12's text as found: `waive_order_payment`
  (`:2120`) still has no `_is_settled()` guard before unconditionally setting
  `payment_status = WAIVED` (`:2142`) and reads the order unlocked (`:2134`).
  Both remain an owner decision per pass 8's original rationale, already
  mirrored in `KNOWN_LIMITATIONS.md` (confirmed present, no edit needed this
  pass).
- **Separation of duties.** All five self-settlement guards
  (`record_payment` `:2018`, `mark_order_paid` `:2098`, `waive_order_payment`
  `:2140`, `refund_order` `:2337`, `update_order_status`'s `settles_payment`
  branch `:1932`) still call `assert_different_person` before any ledger
  mutation — confirmed by direct read of each, none touched this window.
- **PayPal webhook.** `paypal_webhook.py` is byte-identical to pass 11
  (file outside this window's one-commit delta); signature verification and
  the replay/idempotency guard (the DB `UniqueConstraint` on
  `(organization_id, provider, external_id)` plus `IntegrityError` handling in
  `record_external_payment`) are unchanged. This mechanism was independently
  re-read in full by `PUB-03-public-surface-webhooks.md`'s own Pass 12 (the
  rotation's immediately-prior PR, #3687) three days before this pass, which
  confirmed the same thing from the webhook-handler side; nothing in this
  pass's zero backend delta gives any reason that has changed.

**0 fixed, 0 new findings.**

## Guard tests added (pass 12)

None. Nothing changed in a way that needed a new guard; the existing suite
(`test_storefront_payment_race.py`, `test_storefront_order_deadlock.py`,
`test_storefront_schemas.py`, `test_paypal_backfill.py`, plus the repo-wide
`test_org_scoping_ratchet.py` / `test_capacity_locking.py` /
`test_csv_writer_sweep.py` / `test_like_escaping.py` /
`test_migration_create_all_tables.py` / `test_baseline_member_grants.py` /
`test_account_status_gates.py`) was re-run, not re-written.

## Completion gate (pass 12)

| Check                                                                                                                                                                                                                        | Result                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                              | ✅ 0 violations                                          |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                     | ✅ 2638 files unchanged                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                  | ✅ clean                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                            | ✅ 651 revisions, single head (`3d67883cd461`)           |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                            | ✅ 276 routes, 0 errors, 0 warnings                      |
| backend tests (scoped: `-k "storefront or stripe or payment or refund or checkout"`)                                                                                                                                         | ✅ 887 passed, 1 skipped (environment-only: `pywebpush`) |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates, storefront-specific race/deadlock/schema/backfill tests) | ✅ 227 passed                                            |
| backend tests (full suite, `pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                 | ✅ 17,491 passed, 5 skipped, 0 failed                    |
| `cd frontend && npm run typecheck`                                                                                                                                                                                           | ✅ 0 errors                                              |
| `npm run lint` (`eslint --max-warnings 10`)                                                                                                                                                                                  | ✅ 0 errors, 0 warnings                                  |

Note on tooling: this sandbox resolves a bare `python3`/`pytest` to an
isolated interpreter (3.11, and a `uv`-tool-installed pytest venv
respectively) that lacks the app's own dependencies; `/usr/bin/python3`
(3.13) is the interpreter with `sqlalchemy`/`fastapi`/`pytest` all installed
at matching versions, and is what every command above actually ran under.
Recorded here because the next pass's sandbox may differ and this is the
failure mode to check for first (`ModuleNotFoundError: No module named
'sqlalchemy'` at `conftest.py` import) rather than assuming the dependency
is actually missing.

---

## Pass 11 (2026-10-22) — watchdog pickup: delta re-verify, 0 fixed, 0 new findings; SF8-04-2/SF8-04-3 re-confirmed open, unchanged

**Scope.** Diffed pass 10's own merge (`8bb9a74d`, PR #3400) against current
`HEAD` across the same declared file set (`storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, the `frontend/src/modules/storefront/` tree, and any
migration touching storefront/embroidery/personalization tables).

**Unshallowed before trusting the delta** — same precaution passes 9/10 took
(`git rev-parse --is-shallow-repository` → `true`; `git fetch --unshallow`
resolved it).

**6 non-merge commits since pass 10 touch this scope, all read in full:**

1. **`74638250` — numeric-bounds hardening (repo-wide, 408 fields).** Adds
   `le=MONEY_MAX` / `le=INT32_MAX` / `ge=INT32_MIN` to every previously-
   unbounded numeric field in `schemas/storefront.py` (`price`, `cost`,
   `shipping_flat_rate`, `price_delta`, `stock_quantity`, `max_per_member`,
   `personalization_price`, `sort_order`, …). Strictly tightens existing
   lower-bound-only fields; nothing widened or removed. Already covered by
   its own repo-wide guard test (`tests/test_request_numeric_bounds.py`).
   Defense-in-depth improvement, not a new gap.
2. **`8a57d069` — CLAUDE.md Pitfall #32 fix in `storefront_notification_service.py`.**
   `_notification_recipients`'s `User.status == UserStatus.ACTIVE` →
   `.in_(ACTIVE_ACCOUNT_STATUSES)`, so a probationary member now receives
   store notification emails like any other current member. Already swept
   by `tests/test_account_status_gates.py`'s repo-wide allowlist check.
3. **`7197f577` — UTC datetime fix in `schemas/storefront.py`.** `opens_at`/
   `closes_at`/`expected_delivery_date` annotated `UTCDateTime` so a naive
   datetime is read as UTC instead of silently losing its offset (closed a
   stored-time bug and a `TypeError`-as-500 comparing naive vs. aware
   datetimes). Correctness fix, not an auth/tenancy change.
4. **`3982e653` — W67 workflow-review (5 fixed, 1 flagged, already landed).**
   Adds `stock_available` (stock/window cap only, no per-member allowance) to
   `StorefrontVariantOption`/`StorefrontProductOffer` and a clearer
   over-per-member-limit error message in `StorefrontService._validate_cart`
   (`storefront_service.py:1708-1731`). Read both hunks in full: purely
   additive, read-only display/error-message logic — no new mutation path,
   no permission or org-scoping change. The flagged item (W67-6, cart not
   surviving a reload) is a UX/data-loss concern, not a security finding, and
   already tracked in its own workflow-review record.
5. **`382758ab` / `75501134` — accessibility/contrast CSS only**
   (`StoreWindowsTab.tsx`, `StorePaymentsTab.tsx`, `types/index.ts`). Class-
   string and type-literal changes only; no logic touched. Confirmed by
   reading both diffs — the `types/index.ts` hunk in `75501134` is a
   same-file coincidence with the color-token sweep, not a storefront type
   change.

**No migrations** touching storefront/embroidery/personalization tables
landed in this window (confirmed via `--diff-filter=AM` on the versions
directory; none of the 6 commits above touch `alembic/versions/`).

**Re-verified unchanged, by direct read:** `update_order_status` still reads
the order via a plain `get_order()` (no `for_update`) at
`storefront_service.py:1905`, and its `settles_payment` branch (`:1917-1951`)
still writes `payment_status`/`amount_paid` from that unlocked read —
**SF8-04-2 stays OPEN (flagged)**, unchanged in shape and line position from
pass 10's description. `waive_order_payment` still reads unlocked at `:2134`
and still has no `_is_settled()` guard before unconditionally setting
`payment_status = WAIVED` at `:2142` — **SF8-04-3 stays OPEN (flagged)**,
likewise unchanged. Both remain an owner decision, not a low-risk mechanical
fix, per pass 8's original rationale (mirrored in `KNOWN_LIMITATIONS.md`).

Re-enumerated all 48 routes in `storefront.py` against their
`require_permission`/`Depends` gate directly (not spot-checked): the member
self-service surface (`/orders/mine*`, payment-method update, `report_payment`)
is `storefront.view`, order creation is the dedicated `storefront.order`,
every staff/admin route is `storefront.manage`, and `/permissions` requires
only authentication (a self-introspection endpoint, returns the caller's own
permission flags — no data exposure). All unchanged from pass 10's count and
shape. The five self-settlement separation-of-duties guards (`record_payment`,
`mark_order_paid`, `waive_order_payment`, `refund_order`,
`update_order_status`'s `settles_payment` branch) all still call
`assert_different_person` before any mutation — confirmed by direct read of
each, none touched this window. PayPal webhook signature verification
(`verify_webhook_signature`, `paypal_webhook.py:92`) and the replay guard are
untouched (file not in this window's delta).

**0 fixed, 0 new findings.**

## Completion gate (pass 11)

- `flake8`/`black --check`/`isort --check-only` over `app/ tests/ alembic/`
  (7.4.1 / 26.5.1 / isort 9.0.1, CI-pinned): clean.
- `validate_migrations.py --strict`: 639 revisions, single head (`e5f9bb066e07`).
- `check_route_permissions.py --strict`: 273 routes, 0 errors, 0 warnings.
- Scoped backend tests (`-k "storefront or paypal_webhook"`): 765 passed, 1
  skipped (environment-only: `pywebpush`).
- Standing guard suites (org-scoping ratchet, capacity locking, CSV sweep,
  LIKE escaping, `create_all`-table tolerance, baseline member grants,
  account-status gates, numeric-bounds sweep): 682 passed.
- `cd frontend && npm run typecheck`: 0 errors.
- `npm run lint` (whole repo, backend + frontend): 0 errors, 0 warnings.

---

## Pass 10 (2026-10-18) — watchdog pickup: delta re-verify, 0 fixed, 0 new findings; SF8-04-2/SF8-04-3 re-confirmed open, unchanged

**Scope.** Diffed pass 9's own merge (`a137bedf`, PR #3223) against current
`HEAD` across the same declared file set (`storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, the `frontend/src/modules/storefront/` tree, and any
migration touching storefront/embroidery/personalization tables).

**Unshallowed before trusting the delta.** The sandbox's clone was shallow
(`git rev-parse --is-shallow-repository` → `true`) — the same risk pass 9's
own note and the Apparatus & NFC pass 14 note both warn about. `git fetch
--unshallow` resolved it before any `git log` range was trusted.

**4 non-merge commits since pass 9 touch this scope, all read in full — all
frontend-only, none behind the `storefront.manage` permission boundary:**

1. **`53e37f9a3` — product form: price becomes required, not silently `$0`.**
   `ProductFormModal.tsx` now rejects a blank/non-numeric price client-side
   (`Enter a price (type 0 for a free item)`) instead of coercing it to `0`.
   Purely a UX guard — the backend already enforces `price: Decimal =
Field(..., ge=0)` as a required field on `StoreProductCreate`
   (`schemas/storefront.py:263`) independently of what the client sends, so
   this closes a UX footgun, not a security gap. No backend file in scope
   changed.
2. **`6c2bddcb5` — store-window and draft-product messaging.** Copy-only
   changes in `StoreWindowCard.tsx`, `StoreWindowsTab.tsx`, `StoreAdminPage.tsx`
   and `ProductFormModal.tsx`: explains when the store is actually closed
   (the "Store is live for members" switch, distinct from "Open ordering"),
   that a Draft product isn't shown to members, and rounds the open-window
   countdown consistently. No data-fetching, auth, or permission logic
   touched — confirmed by reading every hunk of the diff, not just the
   commit message.
3. **`37c057558` — `WindowFormModal`: send explicit `null` to clear a field.**
   Reviewed in full (see below) — this is the one commit with payload-shape
   implications, verified safe.
4. **`1d51336af` — dark-mode CSS only.** `StoreProductCard.tsx`'s category
   badge switches from a translucent 6%-white fill to the `surface-opaque`
   utility. No logic change.

**`37c057558` in detail — frontend now matches an update contract the backend
already had.** `WindowFormModal.tsx`'s save payload switched from `value ||
undefined` to the shared `formCoercions`/`text`/`pick` helpers so a cleared
`description`/`opensAt`/`closesAt`/`expectedDeliveryDate`/
`pickupInstructions`/`notes` is sent as an explicit `null` rather than
omitted. Verified this is not a new capability, only a frontend bug fix
landing on an already-correct backend contract:

- `StoreOrderWindowUpdate` (`schemas/storefront.py:508-524`) already typed
  every one of these fields `Optional[...] = None` — nothing added or
  widened server-side.
- The endpoint (`storefront.py:906-923`) already called
  `payload.model_dump(exclude_unset=True)` — the correct "omitted key means
  keep" / "explicit null means clear" contract (CLAUDE.md Pitfall #1's
  update-path rule) was already in place before this commit; the frontend
  was simply the half that hadn't caught up.
- `StorefrontService.update_window` (`storefront_service.py:719-743`) resolves
  the window through an org-scoped `get_window(window_id, organization_id)`
  before calling `apply_updates(window, data)` — no bypass of tenancy. The
  `offerings` replacement path validates every `product_id` through
  `assert_in_org` (`:764`) before inserting a `StoreWindowProduct` row —
  Pitfall #14c intact, unchanged by this commit.
- The route itself is still gated by
  `require_permission("storefront.manage")` (`storefront.py:911`), unchanged.

No regression, no new exposure — a pre-existing backend contract correctly
adopted by a previously-lagging frontend form.

**No migrations** touching storefront/embroidery/personalization tables
landed in this window (confirmed via `--diff-filter=AM` on the versions
directory, scanning each new/changed file's content for the feature's
keywords — none matched).

**Re-verified unchanged, by direct read (file not in this window's delta):**
`update_order_status`'s settlement branch still reads via a plain
`get_order()` (no `for_update`) at `storefront_service.py:1866`, writing
`amount_paid`/`payment_status` from that unlocked read — **SF8-04-2 stays
OPEN (flagged)**, exactly as pass 9 described it. `waive_order_payment`
still has no `_is_settled()` guard and still reads unlocked at `:2095` —
**SF8-04-3 stays OPEN (flagged)**, likewise unchanged. Both remain an owner
decision, not a low-risk mechanical fix, per pass 8's original rationale
(mirrored in `KNOWN_LIMITATIONS.md`). The five self-settlement
separation-of-duties guards (`record_payment`, `mark_order_paid`,
`waive_order_payment`, `refund_order`, `update_order_status`'s
`settles_payment` branch) all still call `assert_different_person` before any
mutation — confirmed by direct read of each, none touched this window.
PayPal webhook signature verification and replay guard untouched (file not
in this window's delta). All 48 routes' permission gates unchanged (no
backend route file in this window's delta touched a `Depends`).

**0 fixed, 0 new findings.**

## Pass 9 (2026-10-14) — watchdog pickup: delta re-verify, 0 fixed, 0 new findings; SF8-04-2/SF8-04-3 re-confirmed open, unchanged

## Pass 9 (2026-10-14) — watchdog pickup: delta re-verify, 0 fixed, 0 new findings; SF8-04-2/SF8-04-3 re-confirmed open, unchanged

**Scope.** Diffed pass 8's own merge (`44a66e34`, PR #3128) against current
`HEAD` across the same declared file set passes 3–8 established
(`storefront.py`, `storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, the `frontend/src/modules/storefront/` tree, and any
migration touching storefront/embroidery/personalization tables).

**Caught and corrected a shallow-clone truncation before trusting the delta**
— the same risk the Apparatus & NFC pass 14 note warned a later pass about
(CLAUDE.md-adjacent; `git rev-parse --is-shallow-repository` returned `true`).
A pathspec-filtered `git log` run before unshallowing returned a false
positive: `793d3209` (`fix(members): hold the Organization lock for the whole
tier-advance scan`, USR-10a — an unrelated member-tier fix) appeared to touch
`storefront.py`/`storefront_service.py` only because, at the shallow
boundary, git had no parent to diff against and reported the whole file as
newly added, matching the pathspec by accident. `git fetch --unshallow`
resolved it; the corrected, real delta is 3 non-merge commits, none of them
`793d3209`.

**3 non-merge commits since pass 8, all read in full:**

1. **`e3f236d8` — `perf(exports): stream the admin-hours, storefront and
training CSV exports (AH-16)`.** `export_orders_csv` is now a thin
   `collect_csv` join over a new `stream_orders_csv`/`_order_csv_chunks`
   generator; the response at `GET /storefront/orders/export` is now a
   `StreamingResponse` over those chunks instead of one buffered string.
   Still written through `SafeCsvWriter` (now via `SafeCsvChunks`, a drained
   `SafeCsvWriter` — Pitfall #15 intact), still pages through the full result
   set rather than stopping at the first page, and the `organization_id`
   filter and `holds_unpaid`/`window_id`/`status` scoping are unchanged —
   confirmed by direct read, not inferred from the commit message (which
   undersells it as exports-only; it is, no auth/tenancy change). This also
   resolves the "order-export unbounded pagination" item carried in pass 8's
   own notes above — already reflected as **Resolved 2026-10-11** in
   `KNOWN_LIMITATIONS.md`'s AH-16 row, so no further doc change needed here.
2. **`7770b180` / `fb70c06a` — accessibility-only.** Cart/product quantity
   steppers gained `aria-live`/`sr-only` announcements and swapped `md:`
   sizing for the `touch:` variant (Pitfall's shared-utility convention);
   `StorefrontPage` no longer flashes "The store is closed" before its first
   load answers (a `firstLoadDone` state gate, not a data-fetching change).
   No route, permission, or org-scoping touched in either commit.

**No migrations** touching storefront/embroidery/personalization tables
landed in this window (confirmed via `--diff-filter=A` on the versions
directory).

**Re-verified unchanged, by direct read:** `update_order_status`'s
settlement branch still reads via a plain `get_order()` (no `for_update`) at
`storefront_service.py:1866`, writing `amount_paid`/`payment_status` from
that unlocked read at `:1907`–`:1912` — **SF8-04-2 stays OPEN (flagged)**,
exactly as pass 8 described it, mirrored in `KNOWN_LIMITATIONS.md`.
`waive_order_payment` still has no `_is_settled()` guard and still reads
unlocked at `:2095` — **SF8-04-3 stays OPEN (flagged)**, likewise unchanged.
Neither this pass's own scope (a docs-only delta re-verify) nor the three
commits above touch either method, so nothing here changes the "why flagged,
not fixed" rationale pass 8 already recorded: both are still an owner
decision, not a low-risk mechanical fix. The five self-settlement
separation-of-duties guards (`record_payment`, `mark_order_paid`,
`waive_order_payment`, `refund_order`, `update_order_status`'s
`settles_payment` branch) all still call `assert_different_person` before any
mutation, confirmed by direct read of each. PayPal webhook signature
verification and replay guard untouched (file not in this window's delta).
All 48 routes' permission gates unchanged (no backend route file in this
window's delta touched a `Depends`).

**0 fixed, 0 new findings.**

## Pass 8 (2026-10-12) — watchdog pickup: SF-9 and SF-11 closed by other work, one new lock gap fixed, two more flagged

**Scope, same `git diff`-between-tree-states method passes 3–7 used.** Diffed
pass 7's own closing merge (`01b1bc26`, PR #2940) against current `HEAD`
across the same file set passes 3–7 established:
`storefront.py`, `storefront_service.py`, `storefront_notification_service.py`,
`storefront_preview_service.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, the `frontend/src/modules/storefront/` tree, and
every migration touching storefront/embroidery/personalization tables.

**Not zero-delta — 18 non-merge commits touched this domain since pass 7,**
read in full rather than diff-trusted:

1. **`storefront.py` (+10, `upload_product_image`):** product images are now
   scanned through the shared `reject_if_malicious` (part of the app-wide
   "every upload scanned, org-first storage" feature, already reviewed as a
   cross-cutting collaborator). Called after the existing magic-byte MIME
   check and before re-encoding, with the already-detected MIME passed
   through rather than re-sniffed — no new trust boundary, no change to this
   route's permission gate (`storefront.manage`, unchanged).
2. **`models/storefront.py` (610 lines, mechanical):** `Column(...)` →
   `Mapped[...] = mapped_column(...)` (SQLAlchemy 2.0 typed-declarative
   migration, part of the app-wide mypy cleanup). Checked this is genuinely
   mechanical and not a semantic drift: every `nullable=True`/`nullable=False`
   line count matches 1:1 before and after (78/78, 36/36), and all 12
   `ondelete="SET NULL"` FKs are still paired with `nullable=True` on the same
   or adjacent line (Pitfall #2) — `inventory_item_id`, `window_id`,
   `user_id` (×5), `matched_order_id`, `resolved_by`, `product_id`,
   `variant_id`. No column, type, default, or constraint changed.
3. **`schemas/storefront.py` (+5): SF-11 fixed.** `StoreOrderCreate.items`
   gained `max_length=STORE_ORDER_MAX_LINES` (200), closing the standing LOW
   finding below — see its entry.
4. **`storefront_service.py` (+87/-29): SF-9 fixed.** `get_order` and
   `get_payment_event` gained a `for_update` flag
   (`.with_for_update().execution_options(populate_existing=True)`);
   `record_payment` now takes the lock before its read, accepts
   `amount=None` to settle the remaining balance computed under that lock,
   and `mark_order_paid`/`bulk_mark_paid` were updated to use it (the latter
   now rolls back after a refused order so no lock carries into the next
   iteration); `apply_payment_event` locks the payment event first, then
   calls into the now-locked `record_payment` — lock order is consistently
   event → order, never the reverse, so no new deadlock cycle is possible.
   Closes the standing MED finding below — see its entry. The order-numbering
   helper also switched from `_utcnow().year` to the department's own local
   `resolve_org_today(...).year` (a date-boundary correctness fix, not a
   security change: a US department's New Year's Eve had been dated by the
   server's UTC clock).
5. **`storefront_service.py`, `record_external_payment`: the "concurrent
   duplicate webhook delivery degrades to a 500" item tracked in
   `docs/app-review/storefront.md` is also fixed**, in the same change as
   item 4 — a redelivered capture racing the backfill or a second webhook
   attempt now catches the `IntegrityError` the unique `(org, provider,
external_id)` constraint raises, rolls back, re-reads the row that won,
   and returns it rather than raising. This is app-review's own tracked item,
   not a security-review finding of this feature's prefix; noted here only
   because it landed in the same commit as SF-9's fix and this pass verified
   it directly (seeded two concurrent inserts against a real transaction;
   the loser returns the winner's row rather than raising).
6. **`paypal_webhook.py` (1 line):** `bool(config.get("auto_apply_payments",
True))` → the already-reviewed `paypal_auto_apply(config)` helper
   (pass 7 reviewed its introduction; this is the last remaining call site
   switched over). No behavior change at this call site.
7. **22 frontend files:** the "Remove nested modal-body scrollers inside the
   shared `Modal`" sweep (six storefront dialogs lost a redundant
   `modal-body` class now that `Modal` supplies its own scroll container —
   Pitfall #21's concern, already centrally fixed, not re-litigated per
   call site), an admin-hub card-tabs refactor (`storeAdminTabs.ts`, new —
   cosmetic, same six tabs, same permission-gated page), the AAA→AA contrast
   correction's storefront call sites (`text-blue-600` → `text-blue-800`
   etc., consistent with CLAUDE.md's 2026-09-07 sweep), and a product-card
   layout fix (price moved off the title row). None touch price,
   permission, or org-scoping logic. `StoreAdminPage.test.tsx`,
   `StoreProductCard.test.tsx`, `StorefrontPage.test.tsx`,
   `storefrontStore.test.ts` gained type-only test updates from the app-wide
   mypy/strict-typing passes, no behavior assertions changed.

**One real gap found by this pass, not carried from pass 7: `refund_order`
had the identical unlocked-read-modify-write shape SF-9 just fixed in its
siblings, and `update_order_status`'s settlement branch still does. See
SF8-04-1 (fixed) and SF8-04-2 (flagged) below.**

**Re-verified unchanged:** the order-export unbounded-pagination item (still
open, still grouped in `KNOWN_LIMITATIONS.md`); all 48 routes' permission
gates (the only backend route-file change was the 10-line image-scan
addition in item 1, confirmed by direct read of the diff); the five
self-settlement separation-of-duties guards (`record_payment`,
`mark_order_paid`, `waive_order_payment`, `refund_order`,
`update_order_status`'s `settles_payment` branch — all still call
`assert_different_person` before any mutation); PayPal webhook signature
verification and replay guard (file touched only by item 6's one-line
change).

**One commit-message accuracy note, not a security finding:** the SF-9/SF-11
fixes (item 3/4 above) landed inside a commit titled "fix(types): clear mypy
errors in services m-z," whose message states "no behaviour change." That is
inaccurate for this file — adding row locking and a `max_length` bound are
both real behavior changes, independently reviewed here rather than trusted
from the message, consistent with this review's standing practice of
re-reading every diff rather than its commit log.

### SF8-04-1 — MED — `refund_order` had the same unlocked read-modify-write SF-9 just fixed in its siblings — ✅ FIXED

**What:** `refund_order` read the order with a plain `get_order()` (no
`for_update`), then computed `paid - refunded` in Python and wrote it back.
Exactly SF-9's shape: a `record_payment` commit (the webhook's auto-apply,
now holding a row lock) landing between this read and this write is
overwritten the instant this write's own blocked `UPDATE` finally lands,
computed from a balance that predates the settlement that was just applied.

**Where:** `backend/app/services/storefront_service.py:2294`
(`refund_order`, pre-fix).

**Failure scenario:** an order carries a $50 partial payment. A treasurer
opens it to refund $20 at the same moment the PayPal webhook's auto-apply
lands a further $30 payment. The webhook's `record_payment` locks the row,
computes `50 + 30 = 80`, commits. The refund's earlier, unlocked read still
holds `paid = 50`; its `UPDATE` blocks on the lock, then lands with
`amount_paid = 50 - 20 = 30` — the $30 payment that committed in between is
silently erased, with no error and no audit trail pointing at the loss.

**Impact:** a real, successfully-processed member payment vanishes from the
ledger whenever a refund and a settlement race, with no error surfaced to
either party — a money-handling correctness defect, same class and severity
as SF-9.

**Fix:** `refund_order`'s `get_order` call now passes `for_update=True`
(identical mechanism SF-9 already added and this pass already re-verified
under real concurrent connections), so the refund's read waits for any
in-flight settlement and sees the committed balance.
`test_a_refund_racing_a_payment_does_not_lose_it` in
`test_storefront_payment_race.py` reproduces the race with a raw-SQL first
writer (fails against the pre-fix code: ends at 30 instead of 60) and passes
against the fix.

### SF8-04-2 — MED — `update_order_status`'s settlement branch still reads the order unlocked — OPEN (flagged)

**What:** `update_order_status` is a fourth self-settlement path (alongside
`record_payment`, `mark_order_paid`, `refund_order` — all now locked): when
the caller's target `status` is `PAID` and the order is not already
paid/waived, it sets `order.amount_paid = _money(order.total)` (the _full_
total, not a delta) from a plain, unlocked `get_order()` read.

**Where:** `backend/app/services/storefront_service.py:1867` (the read),
`:1908`–`:1913` (the unlocked write of `amount_paid`/`payment_status`/
`paid_at`).

**Failure scenario:** a partially-paid order ($50 of $100) is advanced to
`PAID` through the generic status endpoint
(`POST /orders/{order_id}/status`) at the moment the PayPal webhook auto-applies
the remaining $50. The webhook's `record_payment` (locked) commits
`amount_paid = 100`, `payment_status = PAID`. The status update's earlier,
unlocked read still holds `amount_paid = 50`; once its blocked `UPDATE`
lands, it writes `amount_paid = 100` anyway (since it always writes the full
total, not a delta) — in this particular interleaving the number happens to
still be correct, but the `StoreOrderEvent` audit row it created
("Payment of ... recorded" is not emitted by this path at all — only a
`STATUS_CHANGED` event) does not reflect that a real, independently-arriving
$50 payment is what actually settled the order, and the reverse interleaving
(status update completes first, webhook's payment arrives after with its
own, separately correct locked arithmetic) is unaffected only because the
webhook path itself is now locked. The genuinely unsafe case is two
_unlocked_ writers on this path alone — e.g. this status update racing
`waive_order_payment` (SF8-04-3, also unlocked) — or a future caller that
computes a _partial_ settlement through this branch rather than always the
full total.

**Impact:** lower immediate risk than SF8-04-1 since the specific race this
pass could demonstrate does not currently lose money (the branch always
writes the full total rather than an incremental amount), but the method
shares the exact unguarded-read shape SF-9/SF8-04-1 were fixed for, is the
most heavily used of the five settlement paths (the generic status-change
route, not a specialized payment action), and a future change to this
branch's arithmetic (e.g., to record a partial settlement) would silently
reintroduce the SF-9 class of bug on the busiest of the five call sites.

**Why flagged, not fixed:** unlike `refund_order` (a single-purpose,
infrequent, money-only method where adding the lock has no other effect),
`update_order_status` is the generic handler for every order-lifecycle
transition — `SUBMITTED → PROCESSING`, `→ FULFILLED`, cancellation-adjacent
transitions, etc. — most of which never touch `amount_paid`. Taking an
unconditional `for_update` lock here would serialize _every_ status change
on _every_ order through a row lock, not just the ones that settle payment;
that is a broader behavior/performance change than this pass's "clearly
correct, low-risk" bar for an unsupervised fix. Two non-equivalent options
for an owner to choose between: (a) take the lock only on the
`settles_payment` branch, by re-reading the order with `for_update=True`
immediately before that branch's writes (cheap, but means the order is read
twice on that path); (b) have `settles_payment` delegate to the already-fixed
`record_payment(order_id, organization_id, None, ...)` the way
`mark_order_paid` now does, reconciling the two methods' slightly different
post-settlement `status`-transition rules. Mirrored into
`KNOWN_LIMITATIONS.md`.

### SF8-04-3 — LOW — `waive_order_payment` overwrites `payment_status` unconditionally, even onto an order already settled — OPEN (flagged)

**What:** unlike `mark_order_paid` (`_is_settled(order)` early-returns if the
order is already paid or waived), `waive_order_payment` has no such check: it
unconditionally sets `payment_status = WAIVED` and `paid_at = now()` after
only checking the order is not `CANCELLED` and the separation-of-duties
guard.

**Where:** `backend/app/services/storefront_service.py:2102`–`:2112`.

**Failure scenario:** no concurrency is even required — in plain sequential
use, if a payment is recorded on an order (`payment_status = PAID`,
`amount_paid = 100`) and a quartermaster later calls "waive" on that same
order (e.g., from a stale admin-hub tab that still shows it as unpaid), the
order ends up with `amount_paid = 100` **and** `payment_status = WAIVED` —
an internally inconsistent row: the ledger shows money collected on an order
flagged as comped, and the sales rollup (which keys off `payment_status`,
per this method's own docstring: "the sales rollup still reports the order's
value as uncollected") now undercounts revenue that was, in fact, collected.
Concurrently, the same race SF8-04-1/SF-9 cover (an unlocked read racing a
locked settlement) makes this easier to hit by accident rather than only by
a stale tab, since this method's read is also unlocked — but the
inconsistency exists even without any race at all.

**Impact:** a data-integrity defect in the payment ledger (revenue
under-reporting), not a money-loss or access-control defect — no funds move
and no unauthorized party gains anything; it is a reporting/reconciliation
correctness gap, hence LOW rather than MED.

**Why flagged, not fixed:** this is a business-rule gap (should waiving an
already-settled order be refused, the way `mark_order_paid` refuses to
re-settle one?), not a mechanical lost-update race — adding `for_update`
alone does not change the unconditional overwrite, since the method does not
branch on the fresh read at all. A correct fix needs a product decision on
the intended behavior (refuse with a `ValueError`, matching
`mark_order_paid`'s `_is_settled` guard? or silently no-op, matching that
same guard's choice for its own case? both differ from today's silent
overwrite) before the code changes, which is exactly what this review's
contract treats as out of scope for an unsupervised fix in a payments path.
Mirrored into `KNOWN_LIMITATIONS.md`.

### SF-9 — MED — Concurrent payment recording loses money off the ledger — ✅ FIXED (closed by other work, re-verified)

Re-verified fixed by other, non-security-review work landing between pass 7
and this pass (app-review's own track, `docs/app-review/storefront.md`'s
SF-9, resolved 2026-10-05, owner decision option (a)). See item 4 of this
pass's diff review above for the mechanism, and SF8-04-1 above for the one
sibling method (`refund_order`) the same fix had not yet reached.

### SF-11 — LOW — No upper bound on order line count — ✅ FIXED (closed by other work, re-verified)

Re-verified fixed by other, non-security-review work landing between pass 7
and this pass: `StoreOrderCreate.items` now carries
`max_length=STORE_ORDER_MAX_LINES` (200). See item 3 of this pass's diff
review above.

## Guard tests added (pass 8)

- `test_a_refund_racing_a_payment_does_not_lose_it` in
  `backend/tests/test_storefront_payment_race.py` — a concurrent settlement
  landing between `refund_order`'s read and write must not be overwritten
  (SF8-04-1). Fails against the pre-fix code (asserts 60, pre-fix code
  produces 30); passes against the fix. The two pre-existing tests in this
  file (`record_payment`, `apply_payment_event`) continue to cover SF-9
  directly.

## Completion gate (pass 8)

| Check                                                                                                                                | Result                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin — see `.github/workflows/ci.yml`'s Backend Lint step, not `requirements.txt`'s 7.4.1) | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                        | ✅ clean (after formatting the new test file with `black`) |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin — installed over the sandbox's pre-installed 9.0.2 to match)              | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                    | ✅ 572 revisions, single head (`3c9c5025a380`)             |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                    | ✅ 265 routes, 0 errors, 0 warnings                        |
| backend tests (scoped: `-k "storefront or payment"`, unit)                                                                           | ✅ 796 passed, 1 skipped (environment-only: `py_vapid`)    |
| backend tests (scoped: `-k "storefront or payment"`, integration)                                                                    | ✅ 248 passed, 1 skipped                                   |
| cross-cutting guard tests (deadlock, org-scoping ratchet, capacity locking, LIKE escaping, CSV sweep, endpoint-auth coverage)        | ✅ 87 passed                                               |
| backend tests (full suite, `pytest tests/ -m "not integration and not slow and not docker"`)                                         | ✅ 14,246 passed, 1 skipped, 0 failed                      |
| `npm run typecheck`                                                                                                                  | ✅ 0 errors                                                |
| `npm run lint` (`eslint --max-warnings 10`)                                                                                          | ✅ 0 errors, 0 warnings                                    |
| `vitest run src/modules/storefront/ src/components/admin/`                                                                           | ✅ 233 passed (21 files)                                   |

A note on the flake8/isort version line above: CI's "Backend Lint" job
installs `flake8==7.3.0`/`isort==9.0.1` explicitly, pinned apart from
`requirements.txt`'s `black==26.5.1`/`flake8==7.4.1`/`isort==9.0.2` — the
workflow file's own comment (`.github/workflows/ci.yml:110-121`) documents
that this exact kind of drift ("CI was green against a toolchain no
developer actually ran") has happened before and is why the install step is
pinned explicitly rather than reading `requirements.txt`. `requirements.txt`
has since moved to `7.4.1`/`9.0.2` without the workflow's pinned install
step following — i.e., the drift the comment warns about has recurred.
This is a repo-wide tooling-hygiene item, not specific to storefront, so it
is not filed as an `SF`-prefixed finding; flagged here because this pass
hit it directly, and mirrored into `KNOWN_LIMITATIONS.md` for whichever
pass (or Feature 00's cross-cutting sweep) picks it up.

---

## Addendum (2026-10-06) — SF-backfill: PayPal reconciliation backfill

Owner decision on the open "no reconciliation backfill" item: build it. New
daily task `paypal_capture_backfill` (`app/services/paypal_backfill_service.py`).
No new route — it is manually runnable only through the existing
System-Owner-only `POST /scheduled/run-task`. Reviewed for the properties a
payment path must hold:

- **No unverified data settles an order.** Transaction Search only discovers
  ids. Each id is re-read from `GET /v2/payments/captures/{id}` with the
  department's own credentials; only a capture whose `status` is `COMPLETED`
  and whose `id` equals the one asked for is recorded, and the id is
  path-escaped so it cannot steer the request. Amount, currency and the
  references matched on come from that capture object — the same object a
  verified `PAYMENT.CAPTURE.COMPLETED` webhook carries. The search's payer
  name/email fills only the display field the treasurer sees.
- **Idempotent with the webhook.** Already-recorded ids are skipped before any
  capture read. A concurrent webhook insert loses or wins on
  `uq_store_payment_events_provider_external`; `record_external_payment` now
  answers a lost race with the winning row (previously an unhandled
  IntegrityError → 500 and a PayPal retry), so nothing is applied twice.
- **Org-scoped.** One integration per org; every lookup is filtered on, and
  every write stamped with, the integration's `organization_id`; the PayPal
  account behind the credentials can only report its own captures. Lookback
  never precedes the integration's `created_at`.
- **Bounded.** 20 search pages × 100 rows and 200 capture reads per
  integration per run; the remainder is picked up next run.

Tests: `tests/test_paypal_backfill.py` (PayPal mocked at the HTTP client and
at the wrapper functions; no network).

---

## Pass 7 (2026-10-05) — real changes, all reviewed, 0 new findings

**Scope, same `git diff`-between-tree-states method passes 3–6 used.** Diffed
pass 6's own closing merge (`a16635e60`, PR #2598) against current `HEAD`
across the full domain established since pass 3: `storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`email_templates_storefront.py`, `storefront_preview_service.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, every migration whose
filename or content matches storefront/embroidery/personalization/thread/
grant, and the shared collaborators prior passes established:
`admin_hub_service.py`/`admin_hub.py`, `core/permissions.py`,
`api/dependencies.py`, `core/security_middleware.py`, `models/notification.py`,
`core/database.py`, `core/utils.py`.

**Not zero-delta this time — 3 backend files and 22 frontend files changed,
read in full rather than diff-trusted.** 75 non-merge commits landed between
pass 6's merge and this pass; unlike pass 6's own "nothing moved" result, six
real feature changes reached this domain:

1. **`storefront.py` (1 line) / `storefront_service.py` (1 line, same
   change twice):** `author.full_name` → `author.display_name` in the two
   order-activity-timeline serializers (`_order_payload` and
   `get_order_events`'s equivalent). Part of the app-wide "preferred display
   name" feature (`f92fbd927`); cosmetic field rename, no behavior or
   authorization change — `display_name` is a plain attribute read off an
   already-org-scoped, already-permission-checked `User`/`author`
   relationship, same as `full_name` was.
2. **`storefront_service.py` (+9, `export_orders_csv`):** the CSV export's
   submitted-time column now renders in the organization's configured
   timezone (`resolve_scheduling_timezone` + `to_local`) instead of a hardcoded
   `"%Y-%m-%d %H:%M UTC"` literal — a correctness fix matching CLAUDE.md's
   UTC-storage/local-display convention, not a security change. Still
   `SafeCsvWriter`; still unbounded pagination (SF export finding, unchanged,
   see below); no new client input reaches this path.
3. **`storefront_notification_service.py` (+73/-2): a new
   `_drop_opted_out` filter wired into every non-capture send.** Part of the
   app-wide "required vs. optional member email" feature
   (`72dfb4f1e`/`b5fe2ca00`, already reviewed under
   [`MSG-25-messaging-notifications.md`](./MSG-25-messaging-notifications.md)
   and `CRON5-31-scheduled-tasks.md`). Reviewed here for what _this_ feature's
   call site does with it, not re-auditing the shared module: the lookup
   query (`select(User.email, User.notification_preferences).where(
User.organization_id == str(organization.id), User.email.in_(addresses))`)
   is org-scoped on the already-resolved `organization`, never a
   client-supplied id; `department_required_kinds(organization)` is checked
   _before_ any opt-out is honored, so a department that marked
   `storefront_new_order_admin` mandatory cannot have it silently dropped; and
   a lookup failure (`except Exception`) logs and falls back to sending
   unfiltered — documented in-line as the deliberate direction ("sending to a
   member who opted out is the lesser failure than every member missing an
   ordering window"), matching this codebase's existing fail-open/fail-closed
   reasoning for notification delivery rather than a new unreviewed tradeoff.
   The order-receipt template (a required notice) is absent from
   `_EMAIL_KIND_BY_TEMPLATE` by design — it is never looked up, so it is
   never filtered.
4. **`storefront_notification_service.py` (2 lines): window-close/open email
   timestamps now render via `format_in_org_timezone` instead of a hardcoded
   `"UTC"` literal** — same class of fix as item 2, no security content.
5. **22 frontend files, all copy/UX polish and defensive hardening, none
   touching price, permission, or org-scoping logic:** wording passes
   ("Failed to load X" → "Could not load X", clearer action labels), mobile
   touch-target class additions (`touch:min-h-11`, `mobile-touch-target`),
   `card-grid` adoption in `StoreCatalogTab`, and — the one defensive pattern
   worth naming — four call sites (`StoreOrdersTab`, `StorePaymentsTab`,
   `StoreAdminPage`'s dashboard loader) now validate the response shape
   (`Array.isArray(response?.items)`, numeric-type checks on counts) before
   rendering, throwing a user-facing error instead of crashing on
   `undefined.length` when a captive portal or proxy returns a non-JSON body.
   This hardens the client against a malformed response; it does not change
   what the server trusts from the client, so it does not touch the
   price-integrity or org-scoping findings below.
6. **New seeded positions carrying baseline `storefront.view`/
   `storefront.order` grants** (`assistant_membership_coordinator`,
   `compliance_officer`, plus `core/permissions.py`'s `DEFAULT_POSITIONS`
   additions for the same): confirmed, by reading each migration/position
   definition in full, to be the same "every new baseline position gets the
   member-level storefront grants every other baseline position already has"
   pattern pass 3/4 already classified as a false positive from a content
   grep — none adds or widens access to `storefront.manage`, and the
   `STOREFRONT_VIEW`/`STOREFRONT_ORDER`/`STOREFRONT_MANAGE` `Permission(...)`
   definitions themselves are untouched (only adjacent-context diff noise from
   an unrelated `INVENTORY_KIOSK` insertion).

**Shared-collaborator diffs, each checked for storefront relevance and found
to have none:** `api/dependencies.py`'s `get_request_enabled_modules` change
retypes its parameter from `Request` to `HTTPConnection` so a WebSocket
handshake on a gated router doesn't 500 before accepting — storefront has no
WebSocket route, and the function's behavior for an HTTP request
(`isinstance(connection, Request)` → proceeds exactly as before) is
unchanged. `core/database.py`'s `_stamp_utc` change (reads already-loaded
column state via `inspect(target).dict` instead of `getattr`, to avoid a
second SELECT firing from inside a partial-refresh event handler) is a
load-time correctness fix with no authorization or tenancy content — storefront
models use the same `DateTime(timezone=True)` pattern as everything else and
are neither more nor less affected than any other model. `core/security_middleware.py`'s
changes are (a) a new `is_unlogged_path` carve-out for anonymous
suggestion-box routes, which do not include any storefront path, and (b) one
new entry (`/api/v1/inventory/not-seen/export`) added to the sensitive-export
tracking list that already includes `/api/v1/store/orders/export`, unchanged.
`admin_hub_service.py`'s diff is confined to `_training_compliance` and
`_scheduling_needs_closeout` (an empty-denominator "100%"/"all clear" framing
fix, the exact Pitfall-#29-adjacent pattern SEC-00 already tracks) and an
`AdminHubService._timezone_for_org`-equivalent refactor onto a shared
`scheduling_timezone()` helper — grep-confirmed zero hits on `_store_` or
`storefront` anywhere in the diff, so none of the six storefront `MetricSpec`
resolvers (`_store_open_orders`, `_store_awaiting_payment`,
`_store_outstanding_balance`, `_store_pending_verification`,
`_store_ready_for_pickup`, `_store_active_products`) or `_storefront_attention`
changed. `models/notification.py`'s diff adds two new trigger enum values and
a `created_by` FK's `ondelete` for an unrelated suggestion-box/equipment-request
feature — no `NotificationChannel`/`NotificationLog` schema change storefront
writes through. `paypal_webhook.py`, `storefront_payments.py`,
`models/storefront.py`, `schemas/storefront.py`, `utils/size_order.py`, and
`utils/embroidery.py` are all byte-identical to pass 6 (`git diff` returns
nothing for each, confirmed directly, not inferred from the aggregate stat).

**Re-verified the three still-open findings directly against current code,
not merely by their unchanged citation in the diff:**

- **SF-9 (app-review, MED, still OPEN)** — `record_payment`
  (`storefront_service.py:1919`) is still a plain `get_order` read (`:1931`,
  no `for_update`) followed by `order.amount_paid = _money(Decimal(
order.amount_paid or 0) + applied)` (`:1952`) and a commit. Line numbers
  shifted by a handful from the `tz`/`format_in_org_timezone` insertions
  above them in the file, but the method body is unchanged. The
  `assert_different_person` guard (`:1944`) remains present and unrelated to
  this finding (it blocks self-settlement, not the concurrent-write race). No
  fix attempted here, for the reason passes 5/6 both gave: the change moves
  transaction boundaries shared by `bulk_mark_paid`'s per-order commit loop
  and the unauthenticated PayPal webhook's auto-apply path, with two
  non-equivalent remediation options that need an owner call in a payments
  path. Still mirrored in `KNOWN_LIMITATIONS.md`.
- **SF-11 (app-review, LOW, still OPEN)** — `StoreOrderCreate.items`
  (`schemas/storefront.py:675`) is still `Field(..., min_length=1)` with no
  `max_length`. Confirmed by direct read; still mirrored in
  `KNOWN_LIMITATIONS.md`.
- **Order export unbounded (carried forward since pass 1, LOW/MED, still
  OPEN)** — `export_orders_csv`'s page-accumulation loop
  (`storefront_service.py:3151` onward) is unchanged in shape; still
  `SafeCsvWriter`-based, still paginates to exhaustion with no row cap. Still
  deliberately grouped with `AH-21`'s and `reportExportService`'s siblings in
  `KNOWN_LIMITATIONS.md` rather than fixed piecemeal.

**All five self-settlement separation-of-duties guards re-confirmed present
and unmodified** (`record_payment` `:1944`, `mark_order_paid` `:2017`,
`waive_order_payment` `:2059`, `refund_order` `:2245`,
`update_order_status`'s `settles_payment` branch `:1869` — all shifted by the
same small, explained offset, all still positioned before any ledger
mutation).

**Route inventory, price integrity, idempotency, and abuse-resistance
unchanged and re-confirmed by direct read of the one real backend diff
(`storefront.py`'s 1-line field rename touches nothing else):** still 48
routes, same permission table as pass 4/5/6 (not reproduced a fourth time
verbatim); `_price_lines` still derives every line from the catalog, and
`StoreOrderItemInput` still carries no client-supplied price field;
`record_external_payment`'s dedupe-on-`(organization_id, provider,
external_id)` and `apply_payment_event`'s `APPLIED`-status short-circuit are
untouched; PayPal webhook signature verification, replay guard, and audit
logging are untouched (file byte-identical to pass 6).

**No new findings.**

## Guard tests added

None by this pass — nothing changed in a way that needed a new guard. The
existing suite (`test_storefront_order_deadlock.py`, the lock-order and
locking-read source guards, the SF-6/SF-7 self-settlement tests,
`test_refund_amount_must_be_positive`/`_may_be_omitted`) was re-run, not
re-written.

## Completion gate

| Check                                                                                                                         | Result                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                 | ✅ 0 violations                                         |
| `black --check app/ tests/ alembic/`                                                                                          | ✅ 1874 files unchanged                                 |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                             | ✅ clean                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                             | ✅ 512 revisions, single head (`34d3d56d1479`)          |
| `python3 scripts/check_route_permissions.py --strict` (frontend route↔page registry)                                          | ✅ 244 routes, 0 errors, 0 warnings                     |
| backend tests (scoped: `-k "storefront or payment"`)                                                                          | ✅ 787 passed, 1 skipped (environment-only: `py_vapid`) |
| cross-cutting guard tests (deadlock, org-scoping ratchet, capacity locking, LIKE escaping, CSV sweep, endpoint-auth coverage) | ✅ 72 passed                                            |
| backend tests (full suite, `pytest tests/ -m "not integration and not slow and not docker"`)                                  | ✅ 12,600 passed, 1 skipped, 0 failed                   |
| `npm run typecheck`                                                                                                           | ✅ 0 errors                                             |
| `npm run lint` (`eslint --max-warnings 10`)                                                                                   | ✅ 0 errors, 0 warnings                                 |
| `vitest run src/modules/storefront/ src/components/admin/`                                                                    | ✅ 213 passed (18 files)                                |

Every real change this pass was read directly against current code and
traced to one of six named feature changes above, each reviewed for
storefront-specific effect rather than trusted on the diff summary alone; the
gate above is a direct re-run against the current tree, including the full
backend unit suite given this feature's money-handling sensitivity.

---

## Pass 6 (2026-09-15) — zero-delta re-verification, 0 new findings

**Scope, same `git diff`-between-tree-states method passes 3–5 used.** Diffed
pass 5's own closing merge (`11de49d61`, PR #2542) against current `HEAD`
(`origin/main` at the time of this pass) across the full domain established
since pass 3: `storefront.py`, `storefront_service.py`,
`storefront_notification_service.py`, `email_templates_storefront.py`,
`storefront_preview_service.py`, `storefront_payments.py`, `paypal_webhook.py`,
`models/storefront.py`, `schemas/storefront.py`, `utils/size_order.py`,
`utils/embroidery.py`, the entire `frontend/src/modules/storefront/` tree, and
every migration under `alembic/versions/` whose filename or content matches
storefront/embroidery/personalization/thread/grant. Also re-checked, as pass 4
and pass 5 did, the shared collaborators this feature calls into:
`admin_hub_service.py`/`admin_hub.py` (the "Needs attention" queue and headline
metrics `StoreAdminPage` reads), `core/permissions.py`, `api/dependencies.py`,
`core/security_middleware.py`, `models/notification.py`, `core/database.py`,
`core/utils.py`.

**True zero-delta: every file in the full list above is byte-identical to pass
5's reviewed state.** `git diff 11de49d61 origin/main` across the entire set —
the 13 declared/established backend files, the frontend module tree, the
migrations glob, and all seven shared collaborators — returns no lines, and
`git log 11de49d61..origin/main` over the same set returns zero commits.
75 commits landed on `main` between pass 5's merge and this pass; none of them
touch anything in this feature's domain or its previously-identified
collaborator set. This is a stronger result than pass 5's own "one in-scope
collaborator file changed" (`finance_approvals.py`, that pass) — this pass
found nothing to independently re-verify beyond re-confirming the prior
findings' own citations, because nothing moved.

**Verified the zero-diff claim is real, not diff-tool noise, by reading the
still-open findings' own cited lines directly against current code** rather
than trusting an empty `git diff` alone:

- **SF-9 (app-review, MED) — resolved 2026-10-05**, see `docs/app-review/storefront.md` → SF-9. As recorded at the time: `record_payment`
  (`storefront_service.py:1918`) is still a plain
  `get_order` read (`:1930`) followed by
  `order.amount_paid = _money(Decimal(order.amount_paid or 0) + applied)`
  (`:1951`) with no `for_update` lock anywhere in the method, matching pass
  5's citation exactly at the same line numbers. The
  `assert_different_person` separation-of-duties guard (`:1943`) is present
  and unrelated to this finding — it prevents self-settlement, not the
  concurrent-write race. No fix attempted here, for the same reason pass 5
  gave: the change moves transaction boundaries shared by `bulk_mark_paid`'s
  per-order commit loop and the unauthenticated PayPal webhook, with two
  non-equivalent remediation options that need an owner call in a payments
  path, not a guess.
- **SF-11 (app-review, LOW, still open)** — `StoreOrderItemInput`'s parent
  list (`StoreOrderCreate.items`, `schemas/storefront.py:675`) is still
  `Field(..., min_length=1)` with no `max_length`/`max_items` — confirmed by
  direct read of the current schema file, same line number as pass 5.
  **Resolved 2026-10-05 (owner decision):** `items` is capped at
  `STORE_ORDER_MAX_LINES = 200`; a cart of 201 lines gets a 422. Boundary
  tests in `test_storefront_schemas.py`. A checkout rate limit was not part of
  the decision and is not added.
- **Order export unbounded (carried forward since pass 1, LOW/MED, still
  open)** — `export_orders_csv` (`storefront_service.py:3150`) is unchanged;
  still the same `SafeCsvWriter`-based, unbounded-pages shape tracked in
  `KNOWN_LIMITATIONS.md` alongside `AH-21`'s and `reportExportService`'s
  siblings, deliberately not fixed as a drive-by per that entry's own
  reasoning (a page-size/streaming decision needs to land consistently across
  all three siblings, not piecemeal).

**All five self-settlement separation-of-duties guards re-confirmed present
and unmodified, at their pass-5-cited line numbers:** `record_payment`
(`:1943`), `mark_order_paid` (`:2016`), `waive_order_payment` (`:2058`),
`refund_order` (`:2244`), and `update_order_status`'s `settles_payment` branch
(`:1868`).

**48/48 endpoints still gated** (`check_route_permissions.py --strict`: 228
routes total, 0 errors, 0 warnings — the same route inventory pass 4/5
enumerated, with no route added, removed, or re-gated). Every by-id method
this feature exposes (`get_order`, `get_product`, `get_window`,
`get_payment_event`, `find_order_by_reference`) still resolves at the line
numbers pass 5 named, unmoved. Price integrity (`_price_lines` derives every
line from the catalog; `StoreOrderItemInput` carries no client-supplied price
field), money-as-`Decimal` (no `float(` in either file), the PayPal webhook's
signature verification/replay guard/audit logging, and the absence of any
unbounded in-memory tracker or JSON-column shallow-copy mutation are all
unchanged from pass 5's re-verification, and were not re-derived from
scratch given the confirmed zero diff on every file that could affect them.

**No new findings.**

## Route inventory

Unchanged since pass 4 (re-enumerated via `check_route_permissions.py
--strict` rather than assumed) — all 48 routes, same permission table, same
one documented exception (`GET /permissions`, a deliberate
`get_current_user`-only self-probe). See pass 4's section for the full table;
it was not worth reproducing a third time verbatim against an unchanged file.

## Schema & migration notes

No storefront model or migration touched since pass 5 (confirmed by the `git
diff`/`git log` above, which return nothing under `alembic/versions/` for any
storefront/embroidery/personalization/thread/grant filename or content match).

## Guard tests added

None by this pass — nothing changed to need a new guard, and the existing
suite (`test_storefront_order_deadlock.py`,
`test_the_service_locks_the_org_before_the_window_and_tallies`,
`test_both_availability_tallies_are_locking_reads`, the SF-6/SF-7
self-settlement tests, `test_refund_amount_must_be_positive`/
`_may_be_omitted`) was re-run rather than re-written.

## Completion gate

| Check                                                                                                            | Result                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                    | ✅ 0 violations                                         |
| `black --check app/ tests/ alembic/`                                                                             | ✅ 1596 files unchanged                                 |
| `isort --check-only app/ tests/ alembic/`                                                                        | ✅ clean                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                | ✅ 444 revisions, single head (`6ab7d903fae5`)          |
| `python3 scripts/check_route_permissions.py --strict`                                                            | ✅ 228 routes, 0 errors, 0 warnings                     |
| backend tests (scoped: `-k "storefront or payment"`, DB available)                                               | ✅ 725 passed, 1 skipped (environment-only: `py_vapid`) |
| cross-cutting guard tests (org-scoping ratchet, capacity locking, LIKE escaping, CSV sweep, storefront deadlock) | ✅ 71 passed                                            |
| backend tests (full suite, `pytest tests/ -m "not integration and not slow and not docker"`)                     | ✅ 10,199 passed, 1 skipped, 0 failed                   |
| `npm run typecheck`                                                                                              | ✅ 0 errors                                             |
| `npm run lint` (`eslint --max-warnings 10`)                                                                      | ✅ 0 errors, 0 warnings                                 |

No file in this feature's scope, or in any of its previously-identified
shared collaborators, was changed by this pass or needed to be — the finding
is that nothing moved since pass 5, verified by diff and by re-reading the
open findings' own cited lines directly, not inferred from the diff alone.

---

## Pass 5 (2026-09-14) — 0 new findings; the app-review track closed SF-8 (the capacity race) between passes

**Scope, same `git diff`-between-tree-states method passes 3 and 4 used.** Diffed
pass 4's own closing merge (`c71b5fb26`, PR #2395) against current `HEAD`
across the full domain established since pass 3: `storefront.py`,
`storefront_service.py`, `storefront_notification_service.py`,
`email_templates_storefront.py`, `storefront_preview_service.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, and every migration whose
filename or content matches storefront/embroidery/personalization/thread/grant
terms. No migration in that domain changed.

**Real changes, all in `storefront_service.py` (+104/-11), none from this
track.** Three commits landed between pass 4's merge and this pass, all from
the **app-review** track's own Tier-A pass 5
(`docs/app-review/storefront.md`, 2026-09-09), which applied the concurrency
lens this security-review track had not yet applied to this feature:

- **SF-8 (app-review, HIGH, fixed): stock and per-member caps counted from a
  stale snapshot.** `_ordered_quantities` was a plain `SELECT` compared against
  a `SELECT ... FOR UPDATE`-locked product row — the second half of CLAUDE.md
  Pitfall #27 was missing. Fixed in two rounds, both measured against a real
  database rather than argued: the first version locked only the product rows
  and traded a rare same-product oversell for a _frequent_ cross-cart deadlock
  (InnoDB gap locks on the still-empty order-window range collide even for
  disjoint carts); the shipped version locks `store_settings` (one row per
  org) before the window, before the products, before the now-`for_update=True`
  tallies — `organisation → window → products → tallies`, a fixed order on
  every path so the four locks cannot invert. Guarded by
  `tests/test_storefront_order_deadlock.py`, which drives two real concurrent
  `create_order` calls through a rendezvous (not a fixed `sleep`) and clears
  orders between rounds so every round starts from the empty range the gap
  lock actually needs; 6/6 detection with the regression re-injected, 3/3 clean
  with the fix in place.
- **A same-day follow-up (app-review, still SF-8's fix) closed two further
  review findings on that lock**, per its own commit message: the source-level
  guard (`test_the_service_locks_the_org_before_the_window_and_tallies`) was
  checking lock _order_ but not that the three reads were actually locking
  reads — a mutation that dropped `.with_for_update()` from the org-level
  `SELECT` left the whole suite green because the two DB-backed deadlock tests
  drive their own hard-coded SQL rather than calling the service. Now an AST
  walk asserts all three positions **and** that both tallies still pass
  `for_update=True`. Separately, `_price_lines` had gone back to one
  `get_product` call per distinct cart line inside the (now org-wide) critical
  section — proportional-to-cart work inside a critical section that already
  serializes the whole organisation is exactly what SF-11 (below) warns is
  reachable, since the cart has no line-count maximum. Fixed by fetching every
  cart line's product in one query, guarded by asserting the query count does
  not grow with cart size (2 lines vs. 8).
- **Everything else in the diff is frontend, and is contrast/accessibility,
  not this feature's.** `OrderStatusStepper.tsx` / `StoreWindowCard.tsx`
  (`emerald-600` → `emerald-700`) and `headingLevel` props added to three
  `EmptyState` call sites in `StorePaymentsTab.tsx` / `StorefrontPage.tsx` —
  all from the same-week mobile-accessibility review sweep across the whole
  app, confirmed by `git log` to carry no storefront-specific content.

**Read in full this pass** (not merely diffed, since a security pass owns
verifying the _result_ of someone else's concurrency fix, not just noting it
landed): all 48 endpoint handlers in `storefront.py`; every method in
`storefront_service.py` that resolves a client-supplied id (`get_order`,
`get_product`, `get_window`, `get_payment_event`, `find_order_by_reference`)
or mutates the payment ledger (`record_payment`, `mark_order_paid`,
`waive_order_payment`, `refund_order`, `update_order_status`,
`bulk_mark_paid`, `bulk_update_status`, `apply_payment_event`,
`record_external_payment`); `create_order`/`_price_lines`/`_lock_products` in
full, including the new org-lock block; `export_orders_csv`; the dashboard and
rollup aggregations; `run_window_lifecycle`/`run_payment_reminders`; and
`storefront_payments.py` end to end. `paypal_webhook.py` returned a byte-for-byte
empty diff against pass 4, so it was read again anyway rather than trusted on
that alone — signature verification (`verify_webhook_signature`, 401 on
failure), the replay guard (`is_duplicate_webhook`, ack'd 200 on a repeat), and
the audit-log call on every accepted delivery are all unchanged.

**48/48 endpoints still gated**, re-enumerated independently rather than
carried over — same count and same one exception (`GET /permissions`, a
deliberate `get_current_user`-only self-probe) as pass 4's table, which still
matches the live code.

**Every by-id query traced confirms org-scoping (Pitfall #14a).** `get_order`,
`get_product`, `get_window`, `get_payment_event` all filter
`organization_id == organization_id` in the same `WHERE` as the id; nothing in
the service resolves a `StoreOrder`/`StoreProduct`/`StoreOrderWindow`/
`StorePaymentEvent` by id without it. `apply_payment_event`'s client-supplied
`order_id` (14b/14c: a permission check alone would not scope it) resolves
through `get_order(target_id, organization_id)`, so an org-B order id 404s
rather than being adopted. `create_product`/`update_product`'s
`inventory_item_id` and `_replace_offerings`'s `product_id` are both validated
with `assert_in_org` before being stored (14c). No new by-id surface was added
this pass — the diff added no endpoint and no new client-facing id parameter.

**Price integrity unchanged.** `_price_lines` still derives `unit_price` only
from `product.price` / `offering.price_override` / `variant.price_delta` /
`product.personalization_price` — the request schema's `items` carries no
price field for the server to trust in the first place, confirmed by re-reading
`StoreOrderItemInput` in `schemas/storefront.py` (`product_id`, `variant_id`,
`quantity`, `personalization_text` only).

**Idempotency / replay on the money paths unchanged and adequate.**
`record_external_payment` de-duplicates on `(organization_id, provider,
external_id)` before insert, so a redelivered PayPal capture cannot apply
twice (the pass-2/pass-5-app-review-noted degrade-to-500 on a _simultaneous_
duplicate delivery is self-healing — PayPal retries, the webhook's own
body-hash replay guard catches the retry — and is not re-litigated here, since
it belongs with SF-9's transaction-boundary work per the app-review track's own
note). `apply_payment_event` short-circuits on `event.status ==
StorePaymentEventStatus.APPLIED` before doing anything. Manual `record_payment`
has no request-level idempotency key, which is correct for its purpose (a
quartermaster recording two genuinely separate Venmo transfers on the same
order is two payments, not a duplicate) rather than a gap.

**Money storage/arithmetic unchanged.** `Decimal` end to end via the shared
`_money()` helper; grep for `float(` in `storefront_service.py` and
`storefront_payments.py` returns nothing.

**CSV export still `SafeCsvWriter`.** `export_orders_csv` (`storefront_service.py:3150`)
constructs `SafeCsvWriter(output, quoting=csv.QUOTE_MINIMAL)`; still unbounded
(pages to exhaustion rather than a fixed cap) — carried forward again, not
re-litigated here, matching AH-16/AH-21's decision to solve the
`export_entries_csv`/`reportExportService`/storefront trio consistently rather
than as three separate drive-by fixes (see `KNOWN_LIMITATIONS.md`).

**No unbounded in-memory tracker (Pitfall #9).** The only module-level mutable
state in the two files is a handful of `re.compile()` patterns, a frozen
label dict, and a status-code tuple — no dict/set that accumulates per request.

**No JSON-column shallow-copy mutation (Pitfall #12).** The three `JSON`
columns this feature owns (`StoreSettings.accepted_payment_methods`,
`StoreSettings.notify_emails`, `StorePaymentEvent.raw_payload`) are each either
replaced wholesale through `apply_updates`/direct assignment or written once at
row creation and never mutated in place afterward — there is no
`dict(obj.json_column)`-then-reassign pattern to check.

**SF-9 (app-review, MED, still open) re-confirmed at its cited lines, still
correctly left flagged rather than fixed here.** `record_payment` is still a
plain-`SELECT`-then-`order.amount_paid = amount_paid + applied`-then-commit
(`storefront_service.py:1930`, `:1951`) with no row lock — a concurrent
webhook auto-apply and an admin working the same order in the hub can still
lose a payment off the ledger. This is the app-review track's own finding
(their SF-9, distinct from this track's SF-6/SF-7 — the two tracks share the
`SF-` prefix, documented in both files), deliberately not fixed there because
the change moves transaction boundaries shared by `bulk_mark_paid`'s per-order
commit loop and the unauthenticated webhook, with two non-equivalent options
(lock the order row vs. a relative `SET amount_paid = amount_paid + :n` SQL
write) that need an owner call rather than a guess in a payments path. This
pass re-derived the same conclusion independently before checking
`KNOWN_LIMITATIONS.md`'s existing entry: not a HIGH-severity, freshly
discovered race this pass is obligated to fix-with-a-red-test-first per
CLAUDE.md Pitfall #27/#22 — it is a previously identified, already-reasoned,
MED-severity, deliberately-deferred one, and second-guessing that reasoning
from inside a different review track's pass would be exactly the "wrong fix in
a payments path is worse than an accurate finding" failure mode this rotation
exists to avoid. Left flagged, unchanged, still mirrored in
`KNOWN_LIMITATIONS.md`.

**SF-11 (app-review, LOW, still open) re-confirmed unchanged.**
`StoreOrderItemInput`'s parent list (`StoreOrderCreate.items`) is still
`Field(..., min_length=1)` with no maximum — a `storefront.order` holder can
submit an arbitrarily large cart, bounded only by the 60 MiB request-body cap.
Worth re-stating given this pass's own scope: the _server-side cost_ of a large
cart was fixed by the app-review round above (one query instead of one per
line), but the _request-contract_ question — what a legitimate maximum is,
given a quartermaster placing a bulk roster-wide order is a real case — is
still a product decision, not a security gap this review can close by picking
a number.

**All five self-settlement guards (SF-6, SF-7, and the three siblings) still
present and unmodified**, re-read directly rather than assumed from the diff:
`assert_different_person` in `record_payment` (:1943), `mark_order_paid`
(:2016), `waive_order_payment` (:2058), `refund_order` (:2244), and
`update_order_status`'s `settles_payment` branch (:1868) — all positioned
before any mutation, all exempt for `actor_id=None` (the reconciliation path).

**No new findings.**

## Route inventory (re-enumerated this pass, not carried over)

All 48 routes, permission dependency read directly from each handler's
signature; identical to pass 4's table (reproduced there, not repeated here)
— no route added, removed, or re-gated since pass 4.

## Schema & migration notes

No storefront model or migration touched this pass (confirmed by the `git
diff` above, which returns nothing under `alembic/versions/` for any
storefront/embroidery/personalization/thread/grant filename or content match).

## Guard tests added

None by this pass — `tests/test_storefront_order_deadlock.py` and the
`test_the_service_locks_the_org_before_the_window_and_tallies` /
`test_both_availability_tallies_are_locking_reads` guards were added by the
app-review track's own SF-8 fix (2026-09-09/10), ahead of this pass; this pass
re-ran them rather than re-writing them, per the rotation's rule to re-verify
what a prior pass already closed rather than re-deriving it.

## Completion gate

| Check                                                                                        | Result                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`                                                         | ✅ 1592 files unchanged                                               |
| `isort --check-only app/ tests/ alembic/`                                                    | ✅ clean                                                              |
| `python3 scripts/validate_migrations.py --strict`                                            | ✅ 444 revisions, single head (`6ab7d903fae5`)                        |
| `python3 scripts/check_route_permissions.py --strict`                                        | ✅ 228 routes, 0 errors, 0 warnings                                   |
| backend tests (scoped: `-k "storefront or payment"`, DB available)                           | ✅ 725 passed, 1 skipped (environment-only: `py_vapid` not installed) |
| cross-cutting guard tests (org-scoping ratchet, capacity locking, LIKE escaping, CSV sweep)  | ✅ 58 passed                                                          |
| backend tests (full suite, `pytest tests/ -m "not integration and not slow and not docker"`) | ✅ 10,158 passed, 1 skipped, 0 failed                                 |
| `npm run typecheck`                                                                          | ✅ 0 errors                                                           |
| `npm run lint` (`eslint --max-warnings 10`)                                                  | ✅ 0 errors, 0 warnings                                               |
| `vitest run src/modules/storefront/ src/components/admin/`                                   | ✅ 205 passed (18 files)                                              |

No file in this feature's scope was changed by this pass — the finding was
that nothing needed to be, and the gate above is a direct re-run against the
current tree rather than a diff-only inference.

---

## Pass 4 (2026-09-08) — one real finding: a fourth self-settlement path SF-6 didn't reach

**Scope, using the same `git diff`-between-tree-states method pass 3 used, for
the same reason.** Diffed pass 3's own closing merge (`59b8ccff1`, PR #2138)
against current `HEAD` (`d03530fce`) across the full domain pass 3 established:
`storefront.py`, `storefront_service.py`, `storefront_notification_service.py`,
`email_templates_storefront.py`, `storefront_preview_service.py`,
`storefront_payments.py`, `paypal_webhook.py`, `models/storefront.py`,
`schemas/storefront.py`, `utils/size_order.py`, `utils/embroidery.py`, the
entire `frontend/src/modules/storefront/` tree, and every migration whose
filename or content matches storefront/embroidery/personalization/thread/grant
terms.

**Backend, real changes:** `storefront.py` (+8 — a new `exclude_cancelled`
query parameter on `list_orders`) and `storefront_service.py` (+10 — the same
parameter threaded into the query, plus one new filter clause). Both read in
full; the filter is additive to an already org-scoped query
(`StoreOrder.organization_id == organization_id` is already a `list_orders`
predicate this diff does not touch) and introduces no new by-id access.

**Frontend, real changes, all one feature: the admin console moved into
Inventory Administration and adopted the shared `AdminHubFrame`.**
`routes.tsx` (path moved `/store/admin` → `/inventory/admin/store`, with an
unwrapped `<Navigate>` redirect kept at the old address — same shape as every
other redirect in the app: the target route still carries
`requiredPermission="storefront.manage"` and the storefront module gate, so
refusing at the redirect would only change which page says no, not who gets
in). `StoreAdminPage.tsx` (310-line rewrite onto `AdminHubFrame` /
`AdminMetricsSettings`, tab state moved into `?tab=`), `StoreOrdersTab.tsx` /
`StorePaymentsTab.tsx` (small additions wiring the new `excludeCancelled`
filter and an `onChanged` call on dismiss), `services/api.ts` (+2, the
`excludeCancelled` param mirrored to match the backend). All read in full,
alongside their test-file diffs (`StoreAdminPage.test.tsx` +197,
`routes.test.tsx`, `StoreOrdersTab.test.tsx`, `StorePaymentsTab.test.tsx`) —
the tests cover the redirect, the module gate at the new path, the
`Object.prototype.hasOwnProperty` guard against a `?payment=toString`
prototype-chain hit, and the loading-state guard on the "back to Inventory"
link (`isModuleOn` reports every module on while a lookup is in flight, so the
link is suppressed until it resolves, mirroring `ProtectedRoute`'s own module
gate).

**Shared dependency this feature now calls for the first time, reviewed for
what it actually does with storefront data:** `app/services/admin_hub_service.py`
(not itself in this feature's domain — it is feature 32's, `admin_hub.py` /
`Locations & kiosk` — but `StoreAdminPage`'s new headline metrics and
"Needs attention" queue are read from it, so the storefront-specific code
inside it is in scope here). Read `_storefront_attention` and all six
`MetricSpec` resolvers (`_store_open_orders`, `_store_awaiting_payment`,
`_store_outstanding_balance`, `_store_pending_verification`,
`_store_ready_for_pickup`, `_store_active_products`) in full: every query
filters `organization_id` from `MetricContext` (itself built from
`user.organization_id`, never a client-supplied value), and the
`_store_pending_verification_criteria`/`_store_open_orders_criteria` helpers
those resolvers share are the same predicate the endpoint layer uses, not a
re-derivation of it (the shape Pitfall #29 warns about). The endpoint layer
(`admin_hub.py`) resolves `spec.permission` (`"storefront.manage"`) before any
of this code runs, and refuses an unknown or unauthorized module with a bare
404 rather than a 403 — deliberately, per its own docstring, so a caller who
may not administer Training cannot learn from this endpoint whether the
department runs it. `AdminHubFrame.tsx`'s own diff this window (+53, a
`summary` opt-out flag for hubs with mixed administrator types, a
`breadcrumbs` override, and an `attention ?? []` defensive fallback) does not
change anything storefront's page passes into it. Not a full audit of
`admin_hub_service.py` — that document is feature 32's — but the six
resolvers and one attention function storefront's page actually exercises are
now verified, not merely trusted.

**Grant migration, reviewed as a false-positive the way pass 3's method
already established.** The largest migration touching this domain since pass 3,
`20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py` (1,875 lines),
matches on `storefront.*`/`storefront.manage`/`storefront.order`/
`storefront.view` dozens of times — but it is a general seeded-grant
correction (the onboarding wizard's position editor was overwriting
`DEFAULT_POSITIONS`' seeded permissions with a heuristic's answer on every
department's first Continue; see its own docstring), not a storefront-specific
schema or grant-policy change, and every hit is one more permission string
inside a per-position stored-list literal the migration is restoring to what
`DEFAULT_POSITIONS` already seeds. Already independently reviewed for its own
domain by `ELEC-06`, `GF-22` and `MP-08`'s equivalent passes; storefront's own
findings here treat it the same way MP-08 did — a false positive from a
content grep, not a change to re-derive. The two storefront-specific grant
backfill migrations that also changed
(`a4f8c1b92d17_backfill_storefront_member_grants.py`,
`b3e8d1f45a27_grant_corporate_storefront_access.py`) each gained only a
corrected code comment (the `positions`-table-existence guard was defensive,
not load-bearing — `positions` is in fact built by the migration chain, not
by `create_all`, contrary to what the original comment claimed); no logic
changed in either.

### SF-7 — MED — `update_order_status` had its own, unguarded path to self-settle a payment — ✅ FIXED

**What:** `mark_order_paid`, `waive_order_payment`, `refund_order` and
`record_payment` (the shared engine all three delegate to, guarded directly
since SF-6 closed the gap where it was reachable around the wrapper) all call
`assert_different_person(actor_id, order.user_id, ...)` before touching the
payment ledger. `update_order_status` has its own, independent branch that
does the exact same ledger mutation — `payment_status = PAID`,
`amount_paid = order.total`, `paid_at = now()` — whenever the caller advances
an order's fulfillment `status` to `PAID`, and it carried none of the four
siblings' guard.

**Where:** `app/services/storefront_service.py:1774` (pre-fix; the
`elif status == StoreOrderStatus.PAID and order.payment_status not in
(PAID, WAIVED):` branch), reached from `POST /orders/{order_id}/status`
(`storefront.py:1223`) and its bulk sibling
`POST /orders/bulk-status` → `bulk_update_status` →
`update_order_status` (`storefront.py:1503`, `storefront_service.py:2307`).

**Failure scenario:** exactly the scenario SF-6's own write-up already named
as plausible for a small department — a `storefront.manage` holder who also
placed their own order. SF-6 closed the three settlement wrappers and the
direct `record_payment` endpoint; this branch settles the same ledger through
a fourth, separate method the earlier fix never touched. That caller calls
`POST /orders/{their_own_order_id}/status` with `{"status": "paid"}` (a status
value the schema accepts unconditionally — `PAID` is not one of the
`_PAYMENT_GATED_STATUSES` this method already refuses to advance into without
settlement, because this branch is not "advancing past a gate," it _is_ the
settlement) and their own balance zeroes out, `paid_at` is stamped, and the
order flips to `PAID` — with no money having moved and no second person
involved. `bulk_update_order_status` reaches the identical branch per order in
one call, so the same bypass works across an entire selection at once.

**Impact:** MED — same class and severity as SF-6, which this is a direct
continuation of: a control that closed three-and-a-half of what were, it now
turns out, five paths into the same ledger mutation
(`record_payment`/`mark_order_paid`/`waive_order_payment`/`refund_order`
already guarded; `update_order_status` was not). Not a cross-tenant issue —
`get_order` still resolves the order org-scoped before any of this runs — and
not reachable by a member with no management grant. The risk is specifically
the SF-6-documented overlap: a `storefront.manage` holder who is also a
member placing personal orders through the same store.

**Fix:** computed the settlement predicate once
(`settles_payment = status == StoreOrderStatus.PAID and order.payment_status
not in (PAID, WAIVED)`) and called `assert_different_person(actor_id,
order.user_id, action="mark paid via a status update on", record="order")`
under it, positioned before `order.status = status` — i.e. before any
mutation, matching where the check sits in `record_payment` and
`waive_order_payment`. `assert_different_person` no-ops when `actor_id` is
`None`; no production caller passes `None` into `update_order_status` today
(confirmed by grep — every caller is the endpoint layer, which always supplies
`current_user.id`), but the exemption is part of the shared control and is
tested here too so it holds if one ever does.

**Guard tests** (`backend/tests/test_storefront_service.py`):
`test_cannot_settle_your_own_order_via_status_update` (asserts
`SeparationOfDutiesError` when `actor_id == order.user_id`, and that the order
is left unmutated — status, payment status and `amount_paid` all unchanged —
confirming the guard fires before any assignment, not merely before commit);
`test_an_officer_may_settle_someone_elses_order_via_status_update` (a distinct
actor still settles the order normally); `test_reconciliation_may_settle_via_status_update_with_no_actor`
(the `actor_id=None` exemption holds here too). Verified red-then-green: ran
the first test against the pre-fix method (`git stash` on
`storefront_service.py` only) — `Failed: DID NOT RAISE
SeparationOfDutiesError` — then restored the fix and reconfirmed all three
green, alongside the full existing `-k storefront` suite (no test asserted
same-actor behavior on this path before, so nothing needed updating).

**No other findings.** The `exclude_cancelled` filter, the `AdminHubFrame`
migration, and the grant-migration correction above are all reviewed and
clean. Re-verified, unchanged since pass 3: 48/48 endpoints gated (route
count and permission table re-enumerated independently below, not assumed
from pass 1); all 7 `.ilike()` calls still pass `escape=LIKE_ESCAPE_CHAR`;
`export_orders_csv` still uses `SafeCsvWriter`; zero raw SQL; `_price_lines`
still prices every line from the catalog; PayPal webhook signature
verification, replay guard and audit logging untouched.

## Route inventory (re-enumerated this pass, not carried over)

All 48 routes, permission dependency read directly from each handler's
signature (not from a prior pass's table):

| Method              | Path                                                                                                                         | Permission                                                 | Notes                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| GET                 | `/storefront`                                                                                                                | `storefront.view`                                          |                                                        |
| POST                | `/orders`                                                                                                                    | `storefront.order`                                         |                                                        |
| GET                 | `/orders/mine`                                                                                                               | `storefront.view`                                          | self-scoped (`user_id`)                                |
| GET                 | `/orders/mine/{order_id}`                                                                                                    | `storefront.view`                                          | self-scoped                                            |
| PATCH               | `/orders/mine/{order_id}/payment-method`                                                                                     | `storefront.view`                                          | self-scoped                                            |
| POST                | `/orders/mine/{order_id}/report-payment`                                                                                     | `storefront.view`                                          | self-scoped                                            |
| POST                | `/orders/mine/{order_id}/cancel`                                                                                             | `storefront.view`                                          | self-scoped                                            |
| GET/PUT             | `/settings`                                                                                                                  | `storefront.manage`                                        |                                                        |
| GET                 | `/settings/notifications/{notice}/preview`                                                                                   | `storefront.manage`                                        |                                                        |
| POST                | `/settings/notifications/{notice}/test`                                                                                      | `storefront.manage`                                        | sends only to caller's own email                       |
| GET/POST/PUT/DELETE | `/products*`, `/products/{id}/image`                                                                                         | `storefront.manage` (`GET .../image` is `storefront.view`) |                                                        |
| GET/POST/PUT/DELETE | `/windows*` (9 routes)                                                                                                       | `storefront.manage`                                        |                                                        |
| GET                 | `/dashboard`                                                                                                                 | `storefront.manage`                                        |                                                        |
| GET                 | `/orders`, `/orders/export`, `/orders/{id}`                                                                                  | `storefront.manage`                                        |                                                        |
| POST                | `/orders/{id}/status`, `/payments`, `/mark-paid`, `/waive`, `/refund`, `/cancel`, `/messages`, `bulk-payment`, `bulk-status` | `storefront.manage`                                        | SF-7 fix is on `/status` and `bulk-status`             |
| PUT                 | `/orders/{id}/notes`                                                                                                         | `storefront.manage`                                        |                                                        |
| GET                 | `/permissions`                                                                                                               | _(none — `get_current_user` only)_                         | deliberate self-probe, returns only caller's own flags |
| GET                 | `/payments`, POST `/payments/{id}/apply`, `/ignore`                                                                          | `storefront.manage`                                        |                                                        |

47/48 permission-gated; the one exception is the documented self-probe,
unchanged since pass 1.

## Schema & migration notes

No storefront model or migration touched this pass. The two storefront grant
migrations that changed carry a comment correction only (see above); the
large cross-feature grant-restoration migration is reviewed above as a false
positive.

## Guard tests added

| Test                                                               | Invariant asserted                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `test_cannot_settle_your_own_order_via_status_update`              | `update_order_status` refuses to settle an order's own owner's balance to `PAID`, and leaves the order unmutated when it refuses |
| `test_an_officer_may_settle_someone_elses_order_via_status_update` | The guard does not block a legitimate settlement by a different person                                                           |
| `test_reconciliation_may_settle_via_status_update_with_no_actor`   | The `actor_id=None` exemption (for any future automated caller) holds on this path too                                           |

## Completion gate

| Check                                                                                                               | Result                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                       | ✅ 0 violations                                                                                                                   |
| `black --check app/ tests/ alembic/`                                                                                | ✅ clean (1 file reformatted during this pass, re-verified clean after)                                                           |
| `isort --check-only app/ tests/ alembic/`                                                                           | ✅ clean                                                                                                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                   | ✅ 438 revisions, single head (`1603bd9c59e7`)                                                                                    |
| backend tests (scoped: `-k "storefront or payment"`)                                                                | ✅ 718 passed, 1 skipped (environment-only: `py_vapid` not installed)                                                             |
| backend tests (full suite)                                                                                          | ✅ 11,835 passed, 21 skipped (all environment-only: optional deps, Docker daemon/registry unavailable, opt-in API-contract suite) |
| cross-cutting guard tests (org-scoping ratchet, capacity locking, LIKE escaping, CSV sweep, endpoint-auth coverage) | ✅ 56 passed                                                                                                                      |
| `npm run typecheck`                                                                                                 | ✅ 0 errors                                                                                                                       |
| `npm run lint` (`eslint --max-warnings 10`)                                                                         | ✅ 0 errors, 2 pre-existing warnings (unrelated `CallTypeChips.tsx`, within budget) — see note below                              |
| `vitest run src/modules/storefront/ src/components/admin/`                                                          | ✅ 205 passed (18 files)                                                                                                          |

**Note on the frontend gate:** the first `npm run lint` in this pass's sandbox
reported 1,116 warnings across ~20 files, all `@typescript-eslint/no-unsafe-*`
on Node-API calls (`fs.readdirSync`, `path.join`, etc.) in test/integrity-check
scripts unrelated to storefront. Root-caused before treating it as a finding:
this worktree had no `node_modules` of its own, so npm's directory-walk-up
resolution reached the shared checkout's root `node_modules` (present) but
never its `frontend/node_modules/@types/node` (a workspace-hoisted location a
level the walk-up does not pass through), leaving every `node:fs`/`node:path`
import untyped for typescript-eslint's type-aware rules. Confirmed environment-only,
not a code regression, three ways: (1) `@types/node` was genuinely absent from
every `node_modules` directory physically inside this worktree; (2)
yesterday's Feature 34 pass 4 (2026-09-07, same repository state modulo one
day) recorded `eslint . 0 errors / 2 pre-existing warnings` from a normal
checkout; (3) linking this worktree's `node_modules` to the shared checkout's
(a local, gitignored, uncommitted fix — nothing checked in changes) reproduced
that exact same 2-warning result immediately, both on the single previously-flagged
file in isolation and on a full `npm run lint` run. Recorded here rather than
silently rerun so the next pass over this file — or over any feature reviewed
from a similarly bare worktree — isn't surprised by the same false signal.

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

**Correction (Codex review on this PR, round 4, precision fixed in round
5): `dependencies.py`'s other change reaches storefront's permission
decisions too, and wasn't reviewed for what it actually does here.**
`cf033864` didn't only touch `core/permissions.py` — it also added a call
to `expand_legacy_permissions` inside `_collect_user_permissions` (`app/api/
dependencies.py`), the function that assembles a user's full
granted-permission set. Both `require_permission` (47 of storefront's 48
routes, via `PermissionChecker.__call__`) and `user_has_permission` (the
`GET /permissions` self-probe, confirmed by reading its body) resolve
through it. **Round 4 overstated when**: `PermissionChecker.__call__` takes
`current_user: User = Depends(get_current_user)` as its own parameter, so
FastAPI resolves authentication first and a missing/invalid credential
never reaches the function body at all; the router-level `module_gate`
dependency likewise runs before any endpoint dependency, so a request an
authenticated caller's disabled module rejects never gets there either.
Correct statement: `_collect_user_permissions` runs for every storefront
request that reaches an actual permission decision — after authentication
and the module gate both pass, not unconditionally on every request.

`core/permissions.py:permission_matches` — the function every one of those
permission decisions ultimately calls — **also** calls
`expand_legacy_permissions` directly, on its own `granted` parameter,
independent of `_collect_user_permissions`'s call (missed in round 4's
correction, caught in round 5; both were already noted as the same
double-call in `PERM-02-permissions-roles.md`'s pass 3, "redundant but
harmless since expansion is idempotent" — round 4 named only the first of
the two call sites). Same conclusion applies to both, for the same reason:
`expand_legacy_permissions` only adds an entry when the input set contains
one of `LEGACY_PERMISSION_ALIASES`' keys, and every key in that map is
`equipment_check.*`-shaped — confirmed by re-reading the map (already
quoted above) — a namespace with no `storefront.*` entry on either side of
it. Whatever a given storefront caller's granted set contains from
elsewhere (a customized position still holding a legacy
`equipment_check.view` string, say), expanding it — at either call site —
can only ever add `inventory.check_*` names to that set; it cannot add,
remove, or alter `storefront.view`/`storefront.order`/`storefront.manage`,
so `permission_matches("storefront.*", granted)` returns the identical
answer before and after this change for every caller who reaches it.
Provably a no-op for every storefront authorization decision, at both call
sites, whenever one is reached.

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

**Correction (Codex review on this PR, round 5): three more imports from
changed files, each verified at the level of the actual imported symbol
rather than the file.** `storefront.py`/`paypal_webhook.py` import `get_db`
from `app/core/database.py` and `safe_error_detail` from `app/core/
utils.py`; `storefront_service.py` imports `NotificationChannel` from
`app/models/notification.py`. All three files changed since `d8c5e39e` —
but a changed file is not the same claim as a changed symbol, the exact
distinction the `core/permissions.py`/`STOREFRONT_*` context-noise check
above already had to draw once. Checked precisely this time, per symbol:

- `database.py`'s diff is confined to `DatabaseManager.disconnect()` (an
  app-shutdown method, unrelated to any request path) gaining exception
  handling so `self.engine`/`self.session_factory` reset even when
  `dispose()` itself fails. `get_db()` (line 252, what this feature actually
  imports and calls per-request) does not appear in the diff at all.
- `core/utils.py`'s diff is a pure addition: a new function,
  `sanitize_connector_error`, for integration-connector failures — grep
  confirms neither `storefront.py`, `paypal_webhook.py`, nor
  `storefront_service.py` calls it. `safe_error_detail` (what this feature
  actually imports) does not appear in the diff at all.
- `models/notification.py`'s +99/-1 diff is new tables, columns, and
  relationships for an unrelated messaging feature
  (`DepartmentMessageDelivery` and friends). `class NotificationChannel`
  (what `storefront_service.py` actually imports — the enum's own
  definition) does not appear in the diff at all; it's referenced only
  inside a new column declaration on an unrelated table.

All three: the file changed, the imported symbol didn't. No finding.

**Correction (Codex review on this PR, round 6): "the imported symbol
didn't change" isn't the whole story for `NotificationLog` — the table
itself changed, and storefront writes to it through a different symbol than
the one checked.** `StorefrontService.add_order_message`
(`storefront_service.py:2260`) calls `self.in_app_notifications
.log_notification(...)`, which does `NotificationLog(organization_id=...,
**log_data)` — an insert into the exact table the messaging-feature diff
added `department_message_id` (a nullable FK) and a new
`UniqueConstraint("department_message_id", "recipient_id", "channel")` to.
Checking only that `NotificationChannel` (the enum) was untouched missed
that the table it's a column _type_ for gained a new column and constraint.

Checked whether that constraint can reject or otherwise disrupt a
storefront-originated insert: `add_order_message`'s `log_data` dict
(reproduced above) has no `department_message_id` key, so the new column
takes its default — `NULL`, per its `nullable=True` declaration with no
explicit default. Under InnoDB (MySQL 8.0, this app's database per
CLAUDE.md), a `UNIQUE` index treats `NULL` as distinct from every other
`NULL`, including in a composite key — two rows with `department_message_id
IS NULL` never collide on that account, regardless of what
`recipient_id`/`channel` they share. So an order-status notification to the
same member on the same channel (routine — a member can get several
`storefront` in-app notices for one order) still inserts every time, exactly
as before this column existed; the constraint only ever activates between
rows that share a real, non-`NULL` `department_message_id`, which
`add_order_message` never sets. No finding — the new constraint has no
storefront-reachable failure mode.

**No new findings** beyond the corrections above (a wrong "doesn't reach it"
authorization claim, restated with the actual mechanism; a lost `GET
/permissions` exception; a wrong export line citation; two scope artifacts a
filename filter missed; two shared-dependency changes reviewed and confirmed
safe; two `dependencies.py`/`core/permissions.py` legacy-expansion call
sites proven a no-op, with the "every request" timing corrected; three more
imports verified unchanged at the symbol level; a schema change to a table
storefront writes through, confirmed to have no storefront-reachable
failure mode) — all in this write-up across six Codex rounds, none in
application code.

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
