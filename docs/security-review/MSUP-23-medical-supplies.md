# Security Review — Medical Supplies

**Prefix:** `MSUP` · **Iteration:** 23 · **Reviewed:** 2026-08-26 (pass 1, PR
#1905), 2026-08-30 (pass 2, PR #2075; audit-trail follow-up, PR #2076),
2026-09-06 (pass 3)

**Backend:** `app/api/v1/endpoints/medical_supplies.py` (pass 1: 667 L, 15
endpoints; pass 2: 670 L, 14 routes — no route added or removed). No
dedicated service — every route delegates to the already-audited
`InventoryService` (`app/services/inventory_service.py`, pass 1: ~7,450 L,
pass 2: ~8,200 L; covered in full by `docs/security-review/INV-11-inventory.md`).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none in either pass — pass 1's fix was service-layer
null-handling only; pass 2's fixes (MSUP-2/MSUP-3) are a new bulk
domain-check method and reusing an existing alert-scan method for a domain
count, also model/schema-free.

---

## Scope

No prior module-audit or app-review pass exists for this feature — the first
review of `medical_supplies.py`. Read the file in full directly (rather than
via parallel background agents): at 667 lines it doesn't need the fan-out
this rotation uses for larger files, and its only service dependency
(`InventoryService`) was already read end-to-end by the INV-11 security-review
pass three weeks prior.

`medical_supplies.py` is a thin, domain-pinned wrapper: every route resolves
`InventoryService` methods already covered by INV-11's tenant-isolation sweep,
scoped to `MEDICAL_ITEM_TYPES` (`frozenset({ItemType.MEDICAL})`) so an EMS
supply officer's grant (`inventory.view_medical` / `inventory.manage_medical`)
never reaches gear/uniform stock. This pass does not re-derive INV-11's
findings — it verifies the domain-pinning mechanism itself is sound, and reads
every `InventoryService` method this router actually calls (rather than
trusting INV-11's coverage of the file by name) for anything that pass's
tenant-isolation lens wouldn't have caught.

## Verified good ✅

- **Domain pinning is real, not cosmetic.** Every by-id write
  (`update_medical_category`, `update_medical_item`, `add_medical_item_lot`,
  `receive_medical_delivery`, `update_medical_lot`, `delete_medical_lot`)
  re-checks the target is _in_ the medical domain via
  `_require_medical_item`/`_require_medical_category`/`service.lot_in_domain`
  before touching it — a permission grants access to a domain, not to a row.
  `category_in_domain`/`item_in_domain`/`lot_in_domain`
  (`inventory_service.py:5241-5301`) are all org-scoped and fail closed (an
  unresolvable or wrong-domain id returns `False`, never raises past the
  caller).
- **The domain is never client-supplied.** `create_medical_category` forces
  `data["item_type"] = "medical"` regardless of what the payload claims;
  `update_medical_category` explicitly rejects any attempt to reclassify a
  category's `item_type` out of `medical` (400, not a silent drop).
- **The `category_id: null` escape hatch is closed.** `update_medical_item`
  checks key _presence_ (`"category_id" in data`), not truthiness — an
  earlier version's `data.get("category_id")` truthiness check would have let
  `{"category_id": null}` through `exclude_unset`, clearing the column and
  stranding the item as uncategorized (visible to neither domain's list
  filter). The existing guard test
  (`test_an_explicit_null_category_is_refused`) pins this; re-confirmed
  correct, not re-derived.
- **404, not 403, on a cross-domain id** (`_require_medical_item`'s own
  docstring states the reasoning) — to a medical-only officer, a uniform
  item's id does not exist; a 403 would confirm the id is real. Consistent
  across every by-id route.
- **`get_items`'s `item_types`/`exclude_item_types` filtering is genuinely
  server-side and org-scoped**, including inside the `_category_ids_of_type`
  subquery (commented specifically against the risk of matching another
  org's category of the same type) — re-verified directly rather than
  trusted from INV-11's summary table, since this is the one query every
  medical list/summary route depends on.
- **Scheduled-task alert audiences are domain-split.** Both
  `run_inventory_low_stock_alerts` and the expiring-supplies alert
  (`scheduled_tasks.py`) build one rendered email per audience
  (`_stock_alert_audiences`), so a medical-only officer's low-stock/expiring
  email contains only medical rows — mailing gear item names to someone the
  API refuses them to would be the same disclosure the API prevents. Item
  names are HTML-escaped before going into the table (`_html.escape`).
- **No SQL injection, no unescaped LIKE** in anything this router reaches.

## Findings

### MSUP-1 — MED — three shared `InventoryService` update methods used blind `setattr` loops instead of `apply_updates` — ✅ FIXED

**What:** `update_category`, `update_item`, and `update_lot` all applied
their update payload with a hand-rolled loop
(`for key, value in data.items(): setattr(instance, key, value)`, two of the
three additionally guarded by `hasattr`) instead of `apply_updates`. All
three are reachable from `medical_supplies.py` (`update_medical_category`,
`update_medical_item`, `update_medical_lot`) as well as the main
`inventory.py` router — not a medical-specific bug, but directly exercised by
this feature's own routes, and not previously flagged: INV-11's audit lens
was tenant isolation (XC-1/XC-3), not Pitfall #1 null-handling, so this
pattern was out of scope there.
**Where:** `app/services/inventory_service.py` — `update_category` (was
`hasattr`-guarded setattr inside a `try/except Exception` that swallows the
resulting `IntegrityError` into a generic `str(e)`), `update_item` (same
shape, no `hasattr` guard at all), `update_lot` (worst of the three: no
`try/except` anywhere in the method — an explicit null against a NOT NULL
column reached `commit()` and raised **unhandled**, a genuine 500, not a
softened one).
**Failure scenario:** a supply officer edits a medical category/item/lot and
the client sends an explicit `null` for a NOT NULL field (`name` on a
category or item; `quantity` on a lot — all three are `Optional`-typed on
their respective `*Update` schemas with no server-side status restriction
stopping the client from sending null). `update_category`/`update_item`
degrade to a generic sanitized error (`sanitize_error_message` strips the raw
`IntegrityError` text as an unsafe pattern, so the officer sees "An
unexpected error occurred" instead of "name cannot be empty").
`update_lot`'s call sites (`update_medical_lot` in this router,
`update_item_lot` in `inventory.py`) had no `try/except` at all, so this one
was a genuine unhandled 500 with no clean error path whatsoever.
**Fix:** all three now route through `apply_updates(instance, data,
skip={"id", "organization_id", ...})`, matching the convention already used
elsewhere in this same file (`update_vendor`, `update_vendor_contact`). An
explicit null against a NOT NULL column now raises a clean `ValueError`
("Field 'x' cannot be cleared") instead of reaching `commit()`.
`update_category`/`update_item`'s existing `try/except Exception` already
converts that into their established `(None, error_string)` return shape, so
no endpoint-layer change was needed for those two. `update_lot` has no error
channel in its return type (`Optional[InventoryLot]`, not a tuple) — its two
callers (`update_medical_lot`, `update_item_lot`) gained a
`try/except ValueError: raise HTTPException(400, ...)`, matching the
existing convention on this exact router for `add_lots_bulk`'s `ValueError`.

## Confirmed still open — flagged, not fixed

None found this pass that need a product decision — the domain-pinning
mechanism this feature exists for is sound, and the one real gap found
(MSUP-1) had a mechanical fix.

## Schema & migration notes

None — no model or migration changes this iteration.

## Guard tests added

- `tests/test_inventory_service.py`:
  - `TestUpdateCategory::test_update_category_rejects_null_name`
  - `TestUpdateItem::test_update_item_rejects_null_name`
  - `TestUpdateLot` (new class) — `test_update_lot_rejects_null_quantity`
    (asserts `ValueError`, since `update_lot` has no error-string return
    channel), `test_update_lot_success`, `test_update_lot_missing_returns_none`
- `tests/test_medical_supplies_domain.py`:
  - `TestLotDomainPinning::test_clearing_lot_quantity_is_a_clean_400` —
    asserts the router converts `update_lot`'s new `ValueError` into a 400,
    not an unhandled 500.

## Completion gate (pass 1)

| Check                                                | Result                               |
| ---------------------------------------------------- | ------------------------------------ |
| `flake8` (changed files)                             | clean                                |
| `black --check` (changed files)                      | clean                                |
| `isort --check-only` (changed files)                 | clean                                |
| `python3 scripts/validate_migrations.py --strict`    | PASSED (no migrations)               |
| backend tests, scope (`inventory` + `medical_suppl`) | 553 passed, 1 skipped (pre-existing) |
| backend tests, full suite                            | 8897 passed, 22 skipped              |

## Pass 2 — 2026-08-30

The endpoint file grew by only 3 lines since pass 1 (667 L → 670 L, no route
added or removed) — the growth is `medical_supply_summary`'s `_on_hand`
helper and its low-stock calc, which reconciles `quantity` against
`_attach_lot_stock`'s per-item lot totals; a pre-existing correctness fix,
not new since pass 1, and not security-relevant (it reads from an already
org-scoped item list). `inventory_service.py` itself grew substantially
(~7,450 L → 8,200 L) from other reviews/features touching it, so every
method this router calls was re-read directly rather than trusting the file
hasn't moved.

Re-verified directly against current code:

- **MSUP-1's fix holds.** `update_category`, `update_item`, and `update_lot`
  all still route through `apply_updates`, not a hand-rolled `setattr` loop.
- **Domain pinning is unchanged and still real.** `item_in_domain`,
  `category_in_domain`, `lot_in_domain` all still join/filter on
  `organization_id` on both sides of the join and fail closed.
- **`get_items`'s domain filter (`item_types`/`exclude_item_types`) and its
  `_category_ids_of_type` subquery are still org-scoped inside the
  subquery**, not just the outer query.
- **`add_lots_bulk`'s XC-1 check still resolves every `inventory_item_id` in
  one org-scoped query before writing any lot** — a delivery naming another
  org's item id is rejected whole, not partially applied.
- **`get_items`'s free-text search still uses `like_pattern` +
  `escape=LIKE_ESCAPE_CHAR`** on every `ilike` clause (Pitfall #25).

Codex's review of the first commit caught two real bugs and corrected a
misstatement in this doc's own first draft; all three below.

### MSUP-2 — LOW — `receive_medical_delivery` validated domain membership one query per line — ✅ FIXED

**What:** the per-line loop calling `_require_medical_item` (one
`item_in_domain` query per entry) ran _before_ `add_lots_bulk`'s own
single-query org check, so a delivery near the schema's 200-entry cap
(`InventoryLotBulkCreate.entries`, `max_length=200`) cost up to 200
sequential round trips instead of one. Checklist §6: "no N+1 loop issuing a
query per row."
**Fix:** added `InventoryService.items_in_domain` — the bulk counterpart of
`item_in_domain`, resolving every id in one org+domain-scoped query — and
switched the router to call it once instead of looping. Behavior is
unchanged (still all-or-nothing, still 404 on any non-medical or foreign
line); only the query count changes. Guard test:
`test_a_delivery_checks_domain_in_one_query_not_one_per_line` pins that
`items_in_domain` is called and the old `item_in_domain` is not.

### MSUP-3 — LOW/MED — `medical_supply_summary`'s `low_stock` count silently dropped items past the 500th — ✅ FIXED

**What:** `medical_supply_summary` called `get_items(..., limit=500)` and
computed `low_stock` by walking the returned page, while `total_items` used
the query's separate, uncapped count. A department with more than 500
active medical items got a `low_stock` tile that undercounted — any
low-stock item sorted past the 500th was invisible to the headline number
while the table below it (which paginates properly) still showed it.
**Fix (round 1, superseded):** raising the internal `limit` to 10000 closed
the undercount for any realistic department, but Codex correctly flagged it
as still materializing up to 10000 full `InventoryItem` rows (with three
eager-loaded relationships) merely to derive a count — real database and
memory cost for a routine dashboard load, and still not exact above the new
cap.
**Fix (round 2):** replaced the raised cap with
`InventoryService.get_low_stock_items_for_alerts` — an existing method
(already used by the low-stock alert email) that filters on `reorder_point
IS NOT NULL` _before_ loading any rows, so the candidate set is only the
items that can ever be "low," not the whole domain. Added an `item_types`
parameter to scope it to `MEDICAL_ITEM_TYPES` (optional, so the alert
email's existing whole-org call is unaffected) and `low_stock` is now
`len()` of that result — no page, no cap, exact at any org size.
`total_items` no longer needs the item rows either: `get_items` is now
called with `limit=1`, using only its separate, always-uncapped count.
Guard tests: `test_low_stock_comes_from_the_uncapped_domain_scoped_scan`,
`test_total_items_does_not_depend_on_the_low_stock_scan`. No
`KNOWN_LIMITATIONS.md` entry needed — there is no residual cap to record.

**Round 3 (efficiency, not fixed — convergence stop):** Codex's third
comment on this same finding asks for a bare `COUNT(*)`/aggregate query in
place of `get_low_stock_items_for_alerts`, since that method still
materializes every candidate `InventoryItem` row (select-in-loading
category, joining lot totals) to produce a number the endpoint only
`len()`s. True, and a real optimization for a department with thousands of
reorder-tracked items — but this is the third round on one finding, and
rounds 1→2 fixed a genuine correctness bug (an undercount) while round 2→3
asks for a pure performance rewrite of already-correct, already-shared,
already-tested logic. Building a bespoke aggregate would mean
re-deriving `get_low_stock_items_for_alerts`'s on-hand rule (lots vs.
`quantity`, expired lots excluded) a second time in raw SQL — a duplicate
implementation to maintain in lockstep, for a dashboard load, not a
latency-critical path. Per this rotation's own precedent for a
finding that stops converging (GF-22 pass 2, GF-27→GF-27a — "not chasing a
further variant"), this is the stopping point: not fixed, noted here as a
possible future optimization, not a correctness or security concern.

### Correction — this doc's first draft mischaracterized baseline medical-supply visibility

The first commit on this PR claimed "a rank-and-file member does not get
medical-supply visibility for free" because `_LINE_MEMBER_PERMISSIONS`
grants only `inventory.view`, never `inventory.view_medical`. That is true
of the permission grant but false as a conclusion: every medical **view**
route (`list_medical_categories`, `list_medical_items`, `get_medical_item`,
`list_medical_item_lots`, `list_expiring_medical_lots`,
`medical_supply_summary`) OR-gates `inventory.view_medical` against the
broad `inventory.view` — and `_LINE_MEMBER_PERMISSIONS` grants that broad
permission to every firefighter/EMT baseline. So every rank-and-file member
_can_ already view medical-supply categories, items, lots, and expirations,
via the broad grant every member already holds.

This is the router module docstring's own stated design, not a gap: "Access
is OR-logic against the broad inventory permissions, so a department that
runs everything through one quartermaster keeps working unchanged," and the
permission definitions' comment states plainly that "the broad
`inventory.manage` still covers medical stock" — additive by design, not a
narrowing. It is also benign: this domain is physical stock (dressings,
AEDs, oxygen) with no PHI, unlike the separate `medical_screening` domain
(feature 09) that holds member fitness-for-duty records. The
`inventory.view_medical` / `inventory.manage_medical` split governs _manage_
authority (letting a department appoint a narrower EMS supply officer
without also handing over the uniform closet) — it was never meant to
restrict baseline _view_ access, and the two-domain permission design
doesn't claim otherwise anywhere else in the codebase. No code change; this
doc's own "Verified good" wording (below) is corrected instead.

### MSUP-4 — LOW, flagged (not fixed) — `get_expiring_lots` has no row cap

**What:** `get_expiring_lots` (used by `GET /lots/expiring` directly, and
internally by `medical_supply_summary` to derive `expiring_soon`/`expired`)
has no `limit`/pagination — for a department that never clears old
zero-or-positive-quantity expired lots, the query returns every matching row
back to the beginning of the `days_ahead` window, unbounded. Checklist §6:
"List endpoints and exports are bounded."
**Why flagged, not fixed:** `get_expiring_lots` is a shared `InventoryService`
method — it also backs the main (non-medical) inventory router and the
low-stock/expiring alert email in `scheduled_tasks.py`. Adding a cap changes
those callers' contracts too (would the alert email now silently omit rows
past the cap? what page size is right for each caller?), which is a product
decision spanning outside this feature's scope, not a mechanical
medical-supplies patch. Mirrored into `KNOWN_LIMITATIONS.md`.

### MSUP-5 — LOW-MED — medical category/item **updates** were the only writes on this router with no audit trail — ✅ FIXED

**What:** `create_medical_category` and `create_medical_item` both call
`log_audit_event` on success. Their `update_medical_category` and
`update_medical_item` counterparts did not — an edit to a medical supply
category or item (rename, reorder, reclassify a field, change a reorder
point) left no audit record at all. This is the inverse of what the data's
sensitivity would suggest: `inventory.py`'s general-purpose `update_category`
(`inventory.py:400-411`) and `update_item` (`inventory.py:1553-1564`) **do**
audit their updates — so the medical-scoped router, arguably the
higher-sensitivity path (EMS/controlled-substance-adjacent stock, run by its
own officer), was the one place in the whole inventory feature where an
update left no trail.

**Where:** `app/api/v1/endpoints/medical_supplies.py` —
`update_medical_category`, `update_medical_item`.

**Failure scenario:** a medical supply officer's `update_medical_item` call
silently changes an item's reorder point or name. Nothing in
`audit_logs` records who changed what or when — an after-the-fact question
("who lowered this item's reorder point last month?") has no answer, unlike
the identical question for a gear item on the general inventory page, or for
the medical item's own creation.

**Fix:** both routes now call `log_audit_event` after a successful update,
mirroring the exact pattern already used by this file's own create routes
and by `inventory.py`'s `update_category`/`update_item` —
`event_type="medical_category_updated"` /
`"medical_item_updated"`, `event_category="inventory"`,
`event_data={"category_id"/"item_id", "fields_updated": list(data.keys())}`.
No new dependency, no schema change — `log_audit_event` was already
imported in this file for the create paths.

**Scope note — lot endpoints not touched.** `add_medical_item_lot`,
`receive_medical_delivery`, `update_medical_lot`, and `delete_medical_lot`
also don't audit, but neither do their exact equivalents in `inventory.py`
(`add_item_lot`, `add_lots_bulk`, `update_item_lot`, `delete_item_lot`) — this
is a pre-existing, cross-cutting gap in the shared lot-management code, not
a medical-specific asymmetry the way the category/item gap was. Left alone
rather than expanded into a broader inventory-module audit-coverage pass,
which is out of this feature's scope.

**Guard tests added:** `tests/test_medical_supplies_domain.py` —
`TestCategoryDomainPinning::test_update_logs_an_audit_event`,
`TestItemDomainPinning::test_update_logs_an_audit_event`. Both assert
`log_audit_event` is awaited once with the expected `event_type`; verified to
fail against the pre-fix router (0 awaits) and pass after.

### MSUP-6 — LOW — MSUP-5's own audit event could report the DB column name instead of the field the caller changed — ✅ FIXED

**What:** Codex's review of the MSUP-5 commit caught a real bug in the fix
itself. `InventoryService.update_category()` renames a `"metadata"` key to
the DB column name `"extra_data"` inside the _same_ `update_data` dict it was
given, in place (`inventory_service.py:743-745`). `update_medical_category`
passes its own `data` dict to that call by reference and then, after the
call returns, builds the audit event's `fields_updated` from
`list(data.keys())` — so an update that changed `metadata` recorded
`extra_data` in the audit trail instead, the exact internal detail an audit
record shouldn't leak. `inventory.py`'s general-purpose `update_category`
route doesn't share this bug: it happens to call
`update_data.model_dump(exclude_unset=True)` a second time for its own audit
event, which re-derives a fresh dict from the untouched Pydantic model rather
than reading back the one the service mutated.

**Where:** `app/api/v1/endpoints/medical_supplies.py` —
`update_medical_category`.

**Fix:** snapshot `fields_updated = list(data.keys())` before calling
`service.update_category(...)`, so the audit event reflects what the caller
actually sent rather than whatever the service renamed it to afterward.
`update_medical_item` was checked for the same shape and doesn't have it —
`InventoryService.update_item` performs no key renames on its `update_data`.

**Guard test added:** `tests/test_medical_supplies_domain.py` —
`TestCategoryDomainPinning::test_update_audit_reports_metadata_not_the_db_column_name`,
which mocks `update_category` with the same in-place rename the real service
performs and asserts the audit event still reports `"metadata"`; verified to
fail against the pre-fix endpoint (`fields_updated == ["extra_data"]`) and
pass after.

## Guard tests added (pass 2)

- `tests/test_medical_supplies_domain.py`:
  - `TestSummaryCounts::test_low_stock_comes_from_the_uncapped_domain_scoped_scan`
    and `::test_total_items_does_not_depend_on_the_low_stock_scan` (MSUP-3)
  - `TestLotDomainPinning::test_a_delivery_checks_domain_in_one_query_not_one_per_line`
    (MSUP-2 — asserts `items_in_domain` is called and the old `item_in_domain`
    loop is not)
  - `TestCategoryDomainPinning::test_update_logs_an_audit_event` and
    `TestItemDomainPinning::test_update_logs_an_audit_event` (MSUP-5)
  - `TestCategoryDomainPinning::test_update_audit_reports_metadata_not_the_db_column_name`
    (MSUP-6)

## Completion gate (pass 2)

| Check                                                                                                                                                                   | Result                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                           | clean                   |
| `black --check app/ tests/ alembic/`                                                                                                                                    | clean                   |
| `isort --check-only app/ tests/ alembic/`                                                                                                                               | clean                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                       | PASSED (no migrations)  |
| `pytest tests/test_inventory_service.py tests/test_medical_supplies_domain.py tests/test_inventory_lot_stock_levels.py tests/test_inventory_low_stock_email_only.py -q` | 112 passed              |
| backend tests, full suite                                                                                                                                               | 9270 passed, 22 skipped |

### Completion gate — MSUP-5 audit-trail follow-up (same day)

| Check                                                 | Result                              |
| ----------------------------------------------------- | ----------------------------------- |
| `flake8` (changed files)                              | clean                               |
| `black --check` (changed files)                       | clean                               |
| `isort --check-only` (changed files)                  | clean                               |
| `python3 scripts/validate_migrations.py --strict`     | PASSED — 394 revisions, single head |
| `tests/test_endpoint_auth_coverage.py`                | 1 passed                            |
| backend tests, scope (`medical_supplies`/`inventory`) | 577 passed, 1 pre-existing skip     |
| backend tests, full suite                             | 9273 passed, 22 pre-existing skips  |

### Completion gate — MSUP-6 tend fix (same day)

| Check                                                 | Result                             |
| ----------------------------------------------------- | ---------------------------------- |
| `flake8` (changed files)                              | clean                              |
| `black --check` (changed files)                       | clean                              |
| `isort --check-only` (changed files)                  | clean                              |
| new guard test, verified fail-before/pass-after       | confirmed                          |
| backend tests, scope (`medical_supplies`/`inventory`) | 577 passed, 1 pre-existing skip    |
| backend tests, full suite                             | 9273 passed, 22 pre-existing skips |

## Pass 3 — 2026-09-06

The endpoint file grew from 670 L to 699 L since pass 2 — no route added or
removed (still 14 routes), and diffing the growth shows it is entirely
explanatory comments (the module docstring's domain-pinning rationale, the
`_require_medical_item`/`_require_medical_category` docstrings, and inline
notes on the MSUP-5/MSUP-6 audit-snapshot and MSUP-2 bulk-domain-check
fixes) — no logic changed. `inventory_service.py` grew substantially
(~8,200 L → ~9,995 L) from unrelated inventory work landing since pass 2
(e.g. the fulfillment-options feature), so every method this router calls
was re-read directly against current line numbers rather than trusted from
the prior pass's summary:

- **MSUP-1's fix holds.** `update_category`, `update_item`, and `update_lot`
  (`inventory_service.py:853`, `:1884`, `:6841`) all still route through
  `apply_updates`, not a hand-rolled `setattr` loop.
- **Domain pinning is unchanged and still real.** `category_in_domain`
  (`:6360`), `item_in_domain` (`:6425`), `items_in_domain` (`:6447`), and
  `lot_in_domain` (`:6478`) all still filter/join on `organization_id` on
  both sides and fail closed (an unresolvable or wrong-domain id returns
  `False`/empty, never raises past the caller).
- **`get_items`'s domain filter and its `_category_ids_of_type` subquery
  are still org-scoped inside the subquery** (`:1607`), not just the outer
  query; its free-text search still uses `like_pattern` +
  `escape=LIKE_ESCAPE_CHAR` on every `ilike` clause (Pitfall #25); its
  `ORDER BY` still carries `InventoryItem.id` as a tie-breaker.
- **`add_lots_bulk`'s XC-1 check still resolves every `inventory_item_id`
  in one org-scoped query before writing any lot** (`:6640-6656`) — a
  delivery naming another org's item id is rejected whole, not partially
  applied — and `receive_medical_delivery` still validates the whole
  line-list's domain membership through `items_in_domain` in one query
  (MSUP-2), not a per-line loop.
- **`medical_supply_summary`'s `low_stock`/`total_items` split still holds**
  (MSUP-3): `low_stock` comes from `get_low_stock_items_for_alerts`
  (uncapped, `reorder_point IS NOT NULL`-filtered before any row loads),
  `total_items` from `get_items(..., limit=1)`'s separate always-uncapped
  count — neither depends on a page-size cap.
- **MSUP-5/MSUP-6's audit trail on category/item updates still fires**, and
  the `fields_updated` snapshot in `update_medical_category` is still taken
  _before_ `service.update_category()`'s in-place `metadata` →
  `extra_data` rename, so the audit event still reports what the caller
  sent rather than the DB column name.
- **MSUP-4 re-confirmed still open, unchanged.** `get_expiring_lots`
  (`inventory_service.py:6894`) still has no `limit`/pagination — still a
  shared `InventoryService` method backing the main inventory router and
  the alert email, so a cap remains a cross-cutting product decision, not a
  medical-specific patch. `docs/KNOWN_LIMITATIONS.md`'s MSUP-4 row is
  unchanged and accurate.

All 110 scoped tests (`test_medical_supplies_domain.py` +
`test_inventory_service.py`) passed unmodified at this point, confirming
every pass-1/pass-2 fix and guard test still held against the current code
with zero drift in the logic this router and its domain-pinning helpers
depend on — but this pass's own "no new finding" conclusion was wrong. A
Codex review round on PR #2301 caught three real gaps that a
tenant-isolation/domain-pinning lens does not cover, all in the same
shared `InventoryService` methods this router calls. All three fixed.

### MSUP-7 — MED — a generic item PATCH could deactivate an item while it was still assigned, checked out, or pool-issued — ✅ FIXED

**What:** `InventoryItemUpdate` carries `active: Optional[bool]`, and
`update_medical_item`/the general `inventory.py` `update_item` route pass
it straight to `InventoryService.update_item`, which committed it via
`apply_updates` with no check at all. The dedicated retire endpoint
(`retire_item`) blocks deactivation while the item is assigned, has an
active checkout, or (for a pool item) has an unreturned issuance — none of
that ran on this path.

**Where:** `app/services/inventory_service.py` — `update_item`.

**Failure scenario:** a medical supply officer sends
`PATCH /medical-supplies/items/{item_id}` with `{"active": false}` on a
device currently issued to a member. `update_item` commits it directly:
the item disappears from every active list and picker while the member
still physically holds it, with no error and no record of why it left
active inventory (unlike `retire_item`, which logs a dedicated audit event
and sets `status`/`condition` to `RETIRED` consistently). Reachable from
both `medical_supplies.py` and the general `inventory.py` router — a
cross-cutting gap in the shared service method, not medical-specific, but
directly exercised by this feature's own `update_medical_item` route.

**Fix:** extracted the three checks `retire_item` already ran
(assignment, active checkout, unreturned pool issuance) into a shared
`_deactivation_block_reason(item, verb)` helper, used by both
`retire_item` (verb="retire", same error text as before) and `update_item`
(verb="deactivate", new). `update_item` now runs the check whenever
`update_data` sets `active` to `False` on a currently-active item, and
returns the same kind of clean error string as every other validation
failure on that method — no change for any update that leaves `active`
alone, and no change to `retire_item`'s existing behavior or messages.

**Guard tests:** `TestUpdateItemDeactivationGuard` in
`test_inventory_service.py` (6 cases) — blocks deactivation when
assigned/checked-out/pool-issued, allows it when nothing blocks it, skips
the check entirely when the item is already inactive or when `active` is
being set to `True`. Verified fail-before/pass-after by reverting the fix
and confirming all three blocking cases regressed to a silent commit.

### MSUP-8 — LOW/MED — the single-item detail response never attached lot stock — ✅ FIXED

**What:** `get_items` (the list endpoint) calls `_attach_lot_stock` on
every row it returns, but `get_item_by_id` — used by both
`get_medical_item` and the general `inventory.py` `get_item` route — never
did. `InventoryItemResponse.lot_stock`/`is_lot_stocked` therefore came
back at their `None`/`False` defaults on the detail view.

**Where:** `app/services/inventory_service.py` — `get_item_by_id`.

**Failure scenario:** an item stocked purely through dated lots (the
supply-officer workflow this feature exists for) has a stale or zero
`quantity` column, because lots and `quantity` are separate ledgers and
receiving a lot never touches the column. The list view correctly reports
the lot-derived on-hand count; opening that same item's detail page
reported the stale column instead, disagreeing with the screen the officer
just came from.

**Fix:** `get_item_by_id` gained an `attach_lot_stock: bool = False`
parameter, off by default since most of its 9 call sites are write paths
(`update_item`, `retire_item`, assignment/checkout flows,
`create_item_if_absent`) with no use for the extra query.
`get_medical_item` and `inventory.py`'s `get_item` — the two single-item
detail responses — now pass `attach_lot_stock=True`.

**Guard tests:** `TestGetItemByIdAttachesLotStockOnRequest` in
`test_inventory_lot_stock_levels.py` (3 cases) — default omits the
lot-totals query entirely (no behavior change for the 9 existing
callers), `attach_lot_stock=True` populates `is_lot_stocked`/`lot_stock`,
and a missing item still short-circuits without querying lots.

### MSUP-9 — LOW/MED — `get_categories`'s 200-row default silently truncated a department's category list — ✅ FIXED

**What:** none of `get_categories`' three real callers (the medical and
gear category pickers, and the CSV-import name-to-id lookup) pass
`skip`/`limit` — each treats the result as the organization's complete
category set, and no frontend screen offers a way to page through
categories. The method's `limit: int = 200` default silently dropped every
category past the 200th, with no error surfaced anywhere.

**Where:** `app/services/inventory_service.py` — `get_categories`.

**Failure scenario:** a department with more than 200 active categories in
either domain (a plausible ceiling after years of use, sub-categorization,
or a large multi-station department) finds categories past the 200th
absent from the picker in both `list_medical_categories` and the general
`list_categories` — items already filed under them show an unresolved
category and cannot be filtered by it, with nothing in the UI indicating
the list is incomplete.

**Fix:** raised the default `limit` from 200 to 5000. Categories are a
curated, hand-built structure — closer to positions or roles than to a
per-transaction table like donations or line items — so a high ceiling
that will not realistically be reached is the correct bound for a picker
with no pagination contract, unlike a genuinely unbounded table (the
inverse of MSUP-4, which is unbounded on purpose because a cap there would
need real pagination semantics its callers don't have either).

**Guard test:** `TestGetCategoriesDefaultLimit` in
`test_inventory_service.py` — captures the compiled statement with literal
binds and asserts `LIMIT 5000`, not `LIMIT 200`. Verified
fail-before/pass-after.

A second Codex round on the same commit caught one more real bug and one
more real gap, neither covered by the first round's findings above.

### MSUP-10 — MED — `add_lot` could invent or lose units in an item's opening-balance lot under a concurrent quantity edit — ✅ FIXED

**What:** `add_lot` loads the target item with an unlocked `_get_item`
read, then calls `_carry_forward_column_stock`, which re-selects the same
row `.with_for_update()` to move any pre-existing `quantity` into a new
opening-balance lot before the item's first real lot is recorded. The
locking re-select had no `populate_existing=True` — the exact identity-map
pitfall `_get_item_locked`'s own docstring already documents elsewhere in
this file. The lock is acquired at the SQL level and the `quantity > 0`
filter is evaluated against the live row, but the Python object the code
then reads `item.quantity` from is the one `_get_item` cached moments
earlier, in the same session.

**Where:** `app/services/inventory_service.py` — `_carry_forward_column_stock`.

**Failure scenario:** a supply officer corrects an item's hand-counted
`quantity` (via `update_item`) in the moment between another officer's
`add_lot` call reading the item and that call reaching the carry-forward
step. If the edit changes `quantity` to a different positive number, the
row still matches the `quantity > 0` filter, so the stale cached object is
still returned — the opening-balance lot is created with the pre-edit
quantity, inventing or losing units relative to what the edit actually
set. (An edit down to exactly zero is already caught by the filter itself,
which is likely why this survived pass 1 and pass 2's review — the
narrower zero case reads as handled and the general case was not checked
separately.)

**Fix:** added `.execution_options(populate_existing=True)` to the locking
re-select, matching `_get_item_locked`'s own established pattern. No
behavior change outside the race window — an uncontended call reads the
same row either way.

**Guard test:** `test_add_lot_carries_forward_the_current_quantity_not_a_stale_cache`
in `test_inventory_identity_map_staleness.py`, following that file's own
two-real-session pattern (a mock has no identity map to demonstrate this
against). Session A performs the unlocked read `_get_item` does inside
`add_lot`; session B independently commits a quantity edit; session A's
subsequent `add_lot` call must carry forward B's committed value. Verified
to fail against the pre-fix code (asserted `10 == 3`, the stale cached
value instead of the concurrently-committed one) and pass after.

### MSUP-11 — LOW, flagged (not fixed) — a single item's stock-lot list has no row cap

**What:** `list_lots` (backing `GET /medical-supplies/items/{id}/lots` and
the equivalent gear-side route) has no `limit`/pagination — for an item
restocked frequently over a long enough history without its depleted lots
ever being deleted, the query returns every lot ever recorded against it.
Checklist §6: "List endpoints and exports are bounded."

**Why flagged, not fixed:** same shape as MSUP-4. `list_lots` is a shared
`InventoryService` method with two callers (medical and general gear), and
neither frontend screen has any pagination UI to receive a page beyond the
first — both treat the result as the item's complete lot history. Adding a
cap changes what "an item's lots" means to both screens with nowhere for
the rest to go, which is a product decision (a page-size control? a
"showing latest N" note? a separate history view?), not a mechanical
medical-supplies patch. Mirrored into `KNOWN_LIMITATIONS.md`.

### Completion gate (pass 3, after both Codex rounds)

| Check                                                                                                                                               | Result                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `flake8` (medical_supplies.py, inventory.py, inventory_service.py, all three touched test files)                                                    | clean                                |
| `black --check` (same files)                                                                                                                        | clean                                |
| `isort --check-only` (same files)                                                                                                                   | clean                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                   | PASSED — single head                 |
| `tests/test_endpoint_auth_coverage.py`                                                                                                              | 1 passed                             |
| `test_medical_supplies_domain.py` + `test_inventory_service.py` + `test_inventory_lot_stock_levels.py` + `test_inventory_identity_map_staleness.py` | 136 passed                           |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                       | 730 passed, 1 pre-existing skip      |
| `pytest tests/` (full backend suite)                                                                                                                | 11,451 passed, 21 pre-existing skips |

No migration, no schema change. MSUP-4 and MSUP-11 remain the only open,
flagged items (both unchanged/new cross-cutting product decisions) —
MSUP-7/8/9/10 above are new fixes, not re-verifications, and MSUP-1
through MSUP-6 all re-verified intact as described earlier in this Pass 3
section.
