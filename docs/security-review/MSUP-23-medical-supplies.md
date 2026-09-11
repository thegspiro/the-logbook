# Security Review — Medical Supplies

**Prefix:** `MSUP` · **Iteration:** 23 · **Reviewed:** 2026-08-26 (pass 1, PR
#1905), 2026-08-30 (pass 2, PR #2075; audit-trail follow-up, PR #2076),
2026-09-06 (pass 3 through pass 10, all on PR #2301), 2026-09-11 (pass 11, PR
#TBD)

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

**Fix (superseded by MSUP-12 below):** the first attempt extracted the
three checks `retire_item` already ran (assignment, active checkout,
unreturned pool issuance) into a shared `_deactivation_block_reason(item,
verb)` helper and ran it in `update_item` whenever `active` was set to
`False`. A further Codex round found this still-conditional check
insufficient on its own — see MSUP-12 for the two remaining gaps and the
final fix, which replaces the conditional check with an outright rejection
of `active` in this method. `_deactivation_block_reason` remains, used
only by `retire_item` now.

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

A third Codex round, against the commit that fixed MSUP-7, found two
further gaps in that fix specifically — not new findings against the
router, but against the fix itself.

### MSUP-12 — MED — MSUP-7's own fix still left a race and a status-desync gap — ✅ FIXED (supersedes MSUP-7's original fix)

**What:** MSUP-7's first fix gated `update_item` clearing `active` on the
same three checks `retire_item` runs, but two gaps survived:

1. **Unlocked check, race intact.** `active` was never added to
   `needs_lock`'s trigger set, so the blocker check ran against an
   unlocked `get_item_by_id` read. A concurrent `assign_item_to_user` or
   `checkout_item` call — both of which lock the item row before writing —
   could acquire the lock, create the assignment/checkout, and commit in
   the window between this call's blocker check and its own commit,
   leaving a newly-held item marked inactive anyway.
2. **No status/condition sync.** A successful deactivation through this
   path left `status` at whatever it already was (e.g. `AVAILABLE`)
   instead of `RETIRED` the way `retire_item` sets it. `assign_item_to_user`
   and `checkout_item` both gate on `status`, not `active` — so a
   "deactivated" item could be assigned or checked out again immediately
   afterward, recreating the exact hidden-held state MSUP-7 exists to
   prevent, just by a different route.

**Where:** `app/services/inventory_service.py` — `update_item`.

**Why the conditional check couldn't be patched further:** closing gap 1
needs locking (routing through `_get_item_locked`); closing gap 2 needs
either replicating `retire_item`'s full status/condition/audit contract
inline, or defining a new "reactivation" semantics for the opposite
direction — and nothing in this codebase reactivates a retired item today,
so that direction has no existing behavior to preserve or extend.

**Fix:** `update_item` now rejects `active` outright — `"active" in
update_data` returns a clean error directing the caller to the retire
action, before any other validation runs. No frontend screen currently
sends `active` through this path (confirmed by search), so this changes
nothing for any existing caller. `_deactivation_block_reason` remains,
used only by `retire_item`, which already closes both gaps atomically
(locked fetch, status/condition/active set together, dedicated audit
event).

**Guard tests:** `TestUpdateItemRejectsActive` (replaces
`TestUpdateItemDeactivationGuard`) in `test_inventory_service.py` (4
cases) — rejects clearing `active` regardless of whether anything would
have blocked retiring, rejects setting it to `True` too, and confirms an
update that never mentions `active` is unaffected. Verified
fail-before/pass-after: reverted to a no-op and confirmed the first three
cases regressed to a silent commit.

### Completion gate (pass 3, after all three Codex rounds)

| Check                                                                                                                                               | Result                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `flake8` (medical_supplies.py, inventory.py, inventory_service.py, all three touched test files)                                                    | clean                                |
| `black --check` (same files)                                                                                                                        | clean                                |
| `isort --check-only` (same files)                                                                                                                   | clean                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                   | PASSED — single head                 |
| `tests/test_endpoint_auth_coverage.py`                                                                                                              | 1 passed                             |
| `test_medical_supplies_domain.py` + `test_inventory_service.py` + `test_inventory_lot_stock_levels.py` + `test_inventory_identity_map_staleness.py` | 134 passed                           |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                       | 728 passed, 1 pre-existing skip      |
| `pytest tests/` (full backend suite)                                                                                                                | 11,449 passed, 21 pre-existing skips |

No migration, no schema change. MSUP-4 and MSUP-11 remain the only open,
flagged items (both unchanged/new cross-cutting product decisions) —
MSUP-8/9/10 and the final MSUP-12 (which supersedes MSUP-7's first fix)
are new fixes, not re-verifications, and MSUP-1 through MSUP-6 all
re-verified intact as described earlier in this Pass 3 section.

## Pass 4 — 2026-09-06

A fourth Codex round on the same PR found that MSUP-12's own fix — the
`"active" in update_data` reject — still had a gap in the same shape, plus a
display-side companion to MSUP-8 and a locking gap in `retire_item` itself.

### MSUP-13 — MED — MSUP-12 blocked `active` but not a `status`/`condition`

### pair of RETIRED, and `retire_item` re-read the item unlocked — ✅ FIXED (supersedes MSUP-12)

**What:** Two gaps, both closed by the same investigation:

1. **The RETIRED status/condition pair bypassed MSUP-12 entirely.**
   `update_item` rejects `"active" in update_data`, but a caller could send
   `{"status": "retired", "condition": "retired"}` with no `active` key at
   all. That pair passes `_validate_item_state` — RETIRED has no
   assigned-user rule blocking it in `_REQUIRES_ASSIGNED_USER` — with none
   of `retire_item`'s blocker checks (assignment/checkout/pool-issuance),
   no lock, and no `active` sync. An item could be marked RETIRED in every
   externally-visible way while `active` stayed `True` and none of the
   guards MSUP-7/MSUP-12 exist for ever ran.
2. **`retire_item` had its own unlocked read**, independent of the
   `update_item` gaps above: it called `get_item_by_id` (no lock) before
   its blocker checks, so a concurrent `assign_item_to_user` or
   `checkout_item` — both of which lock the item row before committing —
   could land between `retire_item`'s check and its own commit, over the
   same transaction's stale, pre-race read. This is the same class of bug
   as MSUP-10 (CLAUDE.md pitfall #27: a locking re-read is required, not
   just a lock), just on the one write path here that had never picked up
   `_get_item_locked` at all.

**Where:** `app/services/inventory_service.py` — `update_item`,
`_deactivation_block_reason`, `retire_item`.

**Fix:**

- `update_item`'s reject condition now also covers
  `update_data.get("status") == ItemStatus.RETIRED.value` and
  `update_data.get("condition") == ItemCondition.RETIRED.value`, alongside
  the existing `active` check — all three routes to deactivating an item
  outside `retire_item` are rejected with the same "use the retire action"
  error.
- `retire_item` now fetches the item via `_get_item_locked` instead of
  `get_item_by_id`, closing the same class of race MSUP-10 closed for
  `add_lot`.
- `_deactivation_block_reason` dropped its `verb` parameter (it is now only
  ever called with `"retire"`, from `retire_item` alone) and its docstring
  was rewritten to say plainly that `update_item` does not call it and
  never will — replicating retire_item's locked/blocker-checked/
  status-synced/audited contract inline was already rejected as the wrong
  shape when MSUP-12 was fixed; the old docstring describing it as "shared
  by retire_item and update_item" was stale the moment MSUP-12 landed and a
  Codex reviewer flagged it as misleading (P1) for exactly that reason.

**Guard tests:**

- `TestUpdateItemRejectsActive` (`test_inventory_service.py`) gained
  `test_rejects_the_retired_status_condition_pair_even_without_active`,
  `test_rejects_retired_condition_alone`, and
  `test_a_non_retired_status_change_is_still_allowed` — the first two mock
  `service._get_item_locked` rather than `service.get_item_by_id`, since a
  `status`/`condition` payload makes `needs_lock` true and the real
  `update_item` calls the locked fetch for it.
- `TestRetireItem` (pre-existing, 6 cases) now mocks
  `service._get_item_locked` instead of `service.get_item_by_id`, matching
  the method `retire_item` actually calls.
- `test_inventory_identity_map_staleness.py` gained
  `test_retire_item_sees_a_concurrent_assignment_not_its_own_stale_cache`:
  two real database sessions (matching this file's established pattern —
  a mock has no identity map, and the shared-connection savepoint
  `db_session` fixture cannot show a genuine cross-transaction commit
  becoming visible to a lock acquired afterward). Session A peeks the item
  unassigned with an unlocked read; session B independently assigns it and
  commits; session A's own `retire_item` call must see B's committed
  assignment and refuse, not the pre-race snapshot it read before B ran.
  Confirmed failing (item retired over a live assignment) against
  `get_item_by_id`, passing against `_get_item_locked`.

**A one-time test-database cleanup this fix required:** the fail-before run
of the new staleness test above, against the _unfixed_ `retire_item`,
correctly reproduced the bug — `retire_item` incorrectly succeeded over the
concurrent assignment — which meant it ran all the way through
`retire_item`'s success path, including its `log_audit_event` call and
`self.db.commit()`, _before_ the test's own assertion caught the wrong
result and failed. That committed one permanent row into the shared
`intranet_test.audit_logs` table (this file's own `_cleanup` helper deletes
the org/user/item rows it creates, but had no reason to know about audit
rows until now). `retire_item`'s `log_audit_event` call stamps neither
`organization_id` nor `user_id`, so the row was also unreachable by every
existing org-scoped cleanup query.

That single orphaned row broke 8 unrelated tests across
`test_audit_shipping.py`, `test_audit_org_scoping.py`, and
`test_audit_retention_archival.py` — all of it downstream of
`archive_expired_logs`'s `head` query
(`select(AuditLog).order_by(AuditLog.id).limit(1)`), which is intentionally
unscoped in production (retention has to walk from the _true_ head of the
table) but means any test assuming it owns a clean table breaks the moment
one other row exists anywhere with a lower id. Root-caused by reproducing
the 8 failures against a fully clean `git stash` of every uncommitted
change (same 8 failures, ruling out this PR's code as the cause), then
confirming a single row (`id=2059`, `organization_id=NULL`, event
`inventory_item_retired`, `event_data->>'$.item_id'` matching this test's
item) was the entire table's contents. Deleting that row immediately fixed
all 8. Fixed at the root rather than just deleted once: `_cleanup` now
takes an optional `item_id` and, when given, deletes
`audit_logs` rows by `JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.item_id'))`
matching this test's own fresh `uuid4()` — safe against any other
concurrently-running test's rows, and it means a future fail-before run of
this same test (or any new real-session test in this file that reaches a
`log_audit_event` call) cleans up after itself instead of corrupting
shared test-database state for unrelated suites again.

### MSUP-14 — LOW/MED — the general item detail page still displayed a

### lot-stocked pool item's stale `quantity` column, not its lot-derived on-hand — ✅ FIXED

**What:** MSUP-8 made the single-item detail _response_ attach `lot_stock`
for a lot-stocked item, but `frontend/.../pages/ItemDetailPage.tsx`'s "Qty
On Hand" field still read `item.quantity` directly — the same raw ledger
column that `add_lot`/`_carry_forward_column_stock` treat as a
best-effort mirror, not the source of truth, for a lot-stocked item. A
department viewing a lot-stocked item's detail page saw a different number
than the one `InventoryItemsPage.tsx` and `PoolItemsPage.tsx` already
computed correctly via the shared `onHandQuantity()` helper.

**Where:** `frontend/src/modules/inventory/pages/ItemDetailPage.tsx`.

**Fix:** the "Qty On Hand" field now calls
`onHandQuantity(item)` (`../utils/onHand.ts`) — the same canonical
lot-vs-`quantity` helper already used by the two list pages and the
medical-supplies module — instead of reading `item.quantity` directly.
`medicalSuppliesService.getItem` (MSUP-8's other call site) has no live
frontend caller today, so this page is the only one with a visible effect
right now; the fix is applied at the shared display layer rather than
duplicated so any future caller gets it for free.

**Guard tests:** `ItemDetailPage.test.tsx` gained two cases — a
lot-stocked pool item with `quantity: 0, lot_stock: 12` renders "12", not
"0"; a non-lot-stocked item still falls back to `quantity` unchanged.

### MSUP-15 — LOW, flagged (not fixed) — the item edit form's "Quantity"

### field has no lot-stocked awareness

**What:** `ItemFormModal.tsx`'s edit form always shows a plain, editable
"Quantity" input pre-filled from `editItem.quantity` and saves whatever the
admin types back to that same column — with no indication that for a
lot-stocked item, `quantity` is a best-effort mirror and the real on-hand
figure is the sum of that item's lots (now correctly shown as "Qty On
Hand" on the detail page per MSUP-14). An admin who opens the edit form for
a lot-stocked item, sees "Quantity: 0" (or whatever the mirror currently
holds), and — reasonably, given the detail page right next to it says
"12" — "corrects" it by typing 12 and saving, writes a number into the
mirror column with no lot backing it, at least until the next lot-driven
carry-forward silently overwrites it again.

**Why flagged, not fixed:** this is a product/UX question, not a
mechanical bug — should the Quantity field be hidden, disabled, or
relabeled ("Mirror — read-only") for a lot-stocked item, and if editable,
should the change go through a lot adjustment instead of the raw column?
Any of those changes whoever's-facing behavior in a way that should be a
deliberate product decision, not a security-review guess. No data
corruption occurs today from this alone (no code path treats the edited
mirror value as authoritative over the lots), so this is not gated as a
security finding.

**Recommendation:** either disable/hide the Quantity input when
`is_lot_stocked` is true (matching how the detail page already treats it
as derived), or relabel it to make clear it is not the authoritative
on-hand count.

### Completion gate (pass 4)

| Check                                                                                                                                                                | Result                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `flake8` (inventory_service.py, both touched backend test files)                                                                                                     | clean                                |
| `black --check` (same files)                                                                                                                                         | clean                                |
| `isort --check-only` (same files)                                                                                                                                    | clean                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                    | PASSED — single head                 |
| `test_inventory_service.py` + `test_inventory_identity_map_staleness.py` + `test_inventory_lot_stock_levels.py`                                                      | all passing                          |
| `test_audit_shipping.py` + `test_audit_org_scoping.py` + `test_audit_retention_archival.py` (the 8 discovered failures, root-caused to a leaked test row, now clean) | 20 passed                            |
| `pytest tests/` (full backend suite)                                                                                                                                 | 11,453 passed, 21 pre-existing skips |
| Frontend: `ItemDetailPage.test.tsx`                                                                                                                                  | 7 passed (5 existing + 2 new)        |
| Frontend: `npm run typecheck`, `eslint` on both touched files                                                                                                        | clean                                |

MSUP-4, MSUP-11, and the new MSUP-15 remain the only open, flagged items.
MSUP-13 and MSUP-14 are new fixes; MSUP-1 through MSUP-12 all re-verified
intact.

## Pass 5 — 2026-09-06

A fifth Codex round, reviewing the commit that fixed MSUP-13, found one
functional regression the fix chain itself had introduced, plus a comment
in `update_item` that had drifted into review chronology instead of a
durable explanation.

### MSUP-16 — MED — closing the `active`/RETIRED bypass left medical-only managers with no way to retire a medical item at all — ✅ FIXED

**What:** Every route on `medical_supplies.py` grants `inventory.manage_medical`
the same access as the broader `inventory.manage` — that OR-permission
pattern is the whole point of the router, letting a supply officer manage
medical stock without also holding blanket inventory access. The one
exception was retirement: the only retire route lived on the general
inventory router (`POST /inventory/items/{id}/retire`), gated on
`inventory.manage` alone, with no domain-pinned equivalent on
`medical_supplies.py`. Before MSUP-7, a medical-only manager could still
reach deactivation indirectly through `PATCH /medical-supplies/items/{id}`
with `{"active": false}` (unsafe, but reachable); MSUP-7 → MSUP-12 → MSUP-13
progressively closed that path for good reason (it bypassed retire_item's
blocker checks, locking, and status sync), but none of those fixes added a
replacement — so as of MSUP-13, a caller holding only
`inventory.manage_medical` had **no way to retire a medical item at all**.
This is a real regression this PR's own fix chain introduced, not a
pre-existing gap: MSUP-7's first commit is what started removing the only
path such a caller had.

**Where:** `app/api/v1/endpoints/medical_supplies.py`.

**Fix:** added `POST /medical-supplies/items/{item_id}/retire`
(`retire_medical_item`), gated on the router's usual
`require_permission("inventory.manage_medical", "inventory.manage")`,
domain-checked via the existing `_require_medical_item` before delegating
to `InventoryService.retire_item` — a thin wrapper, not a second
implementation, mirroring `inventory.py`'s own retire route (same
`ItemRetireRequest` schema, same `if error: raise 400` shape) behind this
router's domain pin.

**Guard tests:** `TestItemDomainPinning` in `test_medical_supplies_domain.py`
gained 3 cases — retiring a gear item is a 404 with `retire_item` never
awaited (domain pinning holds here too), a successful retire delegates to
`service.retire_item` with the request's notes and logs a
`medical_item_retired` audit event, and a blocker error from `retire_item`
(e.g. still assigned) surfaces as a clean 400 with no audit event.

### MSUP-17 — LOW, comment hygiene — `update_item`'s rejection comment read as review chronology, not a durable invariant — ✅ FIXED

**What:** The comment above `update_item`'s `active`/RETIRED rejection
described "a first attempt", enumerated "three gaps a Codex review
caught", and narrated how each fix round closed them. That is accurate
history, but it belongs in this findings doc and the PR description
(both already carry it) — not in the code, where it reads as unstable
process narrative that will drift the moment the guard changes again, and
obscures the one thing a future reader actually needs: _why_ this method
must not attempt retirement inline.

**Fix:** rewritten to state the durable invariant directly — retirement
requires a locked fetch, the blocker checks, `status`/`condition`/`active`
set together, and a dedicated audit event, and `update_item` has none of
that machinery and must not approximate it. No review chronology, no
enumerated fix history.

### Completion gate (pass 5)

| Check                                                                                                                          | Result                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `flake8` / `black --check` / `isort --check-only` (medical_supplies.py, inventory_service.py, test_medical_supplies_domain.py) | clean                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                              | PASSED — single head, no schema change |
| `test_medical_supplies_domain.py`                                                                                              | 30 passed (27 existing + 3 new)        |
| `test_endpoint_auth_coverage.py` (new route registered correctly)                                                              | 1 passed                               |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                  | 735 passed, 1 pre-existing skip        |

MSUP-4, MSUP-11, and MSUP-15 remain the only open, flagged items. MSUP-16
is a new fix (a genuine functional regression introduced by this same PR's
earlier rounds, not a pre-existing gap); MSUP-17 is comment hygiene, no
behavior change.

## Pass 6 — 2026-09-06

A sixth Codex round, reviewing the commit that added the medical retire
route (MSUP-16) and the earlier locking fixes, found two P1 concurrency
gaps in code this PR's own rounds had already touched, plus a P2 TOCTOU
gap in the route MSUP-16 just added.

### MSUP-18 — MED — `_carry_forward_column_stock`'s locking SELECT excluded zero-quantity rows from the lock entirely — ✅ FIXED

**What:** The locking SELECT that decides whether an item's `quantity`
needs to be carried into an opening-balance lot filtered
`InventoryItem.quantity > 0` _inside the same `FOR UPDATE` query_ — so an
item currently at 0 was never matched, and therefore never locked. A
concurrent quantity edit raising it to a positive number in the narrow
window between that decision and this call's own commit takes no lock
either (nothing was holding one), commits freely, and is never revisited:
this call already decided, correctly for the instant it ran, that there
was nothing to carry. The edited units then sit in the `quantity` column
forever unread, because the delivery lot this call creates for the item
makes every reader stop consulting that column for it — the exact
disappearing-stock failure mode MSUP-10 closed for the "quantity changes
to a different positive number while already matched and locked" case,
but here for the "quantity starts at zero and is never locked at all"
case, which MSUP-10's fix did not reach.

**Where:** `app/services/inventory_service.py` —
`_carry_forward_column_stock`.

**Fix:** the locking SELECT now locks every target item unconditionally
(`id`/`organization_id` only in its `WHERE`), and the `quantity > 0`
decision moved to a Python filter over the refreshed, post-lock rows.
Every target item is now serialized on before this call decides whether
it has anything to carry, regardless of what its `quantity` read before
the lock was acquired.

**Guard tests:** `TestFirstLotLedgerTransition` in `test_capacity_locking.py`
gained `test_the_lock_is_not_conditioned_on_quantity`, asserting the
locking SELECT's `WHERE` clause does not reference `InventoryItem.quantity`
— verified fail-before (failed against the reverted `quantity > 0` filter)
/ pass-after, matching this file's existing static-inspection convention
for this exact method (`test_the_item_rows_are_locked`,
`test_both_reads_are_locking`).

### MSUP-19 — MED — `retire_item`'s blocker counts were plain reads, invisible to a concurrent checkout/issuance committed while retirement waited on the lock — ✅ FIXED

**What:** `retire_item` locks the item row via `_get_item_locked` before
checking blockers (MSUP-13's fix), which does force a concurrent
`assign_item_to_user`/`checkout_item` — both of which lock the item before
inserting their holding record — to block until this transaction commits.
But `_deactivation_block_reason`'s two blocker counts (active checkouts,
unreturned pool issuances) were plain `SELECT COUNT(...)` queries. Under
InnoDB's default REPEATABLE READ (CLAUDE.md pitfall #27), a plain SELECT
answers from the snapshot taken at this transaction's _first_ read, which
predates the item lock — locking the item does not, by itself, refresh
what a later plain read within the same transaction sees. So even though
the concurrent checkout is forced to wait and its row genuinely exists by
the time retirement's counts run, those counts could still report zero and
let retirement proceed over a holding that, by then, is already real and
committed.

**Where:** `app/services/inventory_service.py` — `_deactivation_block_reason`.

**Fix:** both count queries now add `.with_for_update()`, making them
locking reads that see the latest committed data rather than the
transaction's first-read snapshot — the same fix MSUP-27-class capacity
checks elsewhere in this file already apply (a lock alone is necessary and
not sufficient; the read that decides has to be locking too).

**Guard tests:** new `TestRetireItemBlockerCounts` in
`test_capacity_locking.py` asserts both counts in
`_deactivation_block_reason` are locking reads (`with_for_update()` appears
twice), matching this file's established convention for pinning this exact
class of invariant.

### MSUP-20 — LOW/MED — the new medical retire route validated domain membership before the lock, not under it — ✅ FIXED

**What:** MSUP-16's `retire_medical_item` calls `_require_medical_item`
(an unlocked preflight, matching every other route on this router) before
delegating to `service.retire_item`. If a broad `inventory.manage` caller
reclassifies the item to a gear category in the window between that
preflight and `retire_item` acquiring its row lock, the medical-only
caller's retirement would still proceed — the service never rechecked the
category once locked. A caller holding only `inventory.manage_medical`
could, under this narrow race, retire an item outside the domain their
permission grants them.

**Where:** `app/api/v1/endpoints/medical_supplies.py` —
`retire_medical_item`; `app/services/inventory_service.py` —
`retire_item`.

**Fix:** `retire_item` gained an optional `required_item_types` parameter.
When given, it re-validates domain membership (via the existing
`category_in_domain` helper) against the item's `category_id` _after_
`_get_item_locked` returns — by which point no concurrent write to this
item's `category_id` can land until this transaction commits, so the
answer cannot go stale under it the way the preflight check could.
`retire_medical_item` now passes `required_item_types=MEDICAL_ITEM_TYPES`
alongside its existing preflight (kept as a fast-fail for the common,
non-race case, consistent with every sibling route on this router). The
general `inventory.py` retire route passes nothing, so this adds no
behavior or query cost there.

**Guard tests:** `TestRetireItem` in `test_inventory_service.py` gained 3
cases — a failing domain re-check returns "Item not found" without ever
reaching a commit, a passing check proceeds normally, and omitting
`required_item_types` (the general route's call shape) skips the check
entirely (`category_in_domain` never awaited). `TestItemDomainPinning` in
`test_medical_supplies_domain.py` was extended to assert
`retire_medical_item` passes `required_item_types=MEDICAL_ITEM_TYPES`
through to the service.

### Completion gate (pass 6)

| Check                                                                                                                                                                            | Result                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `flake8` / `black --check` / `isort --check-only` (inventory_service.py, medical_supplies.py, all touched tests)                                                                 | clean                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                | PASSED — single head, no schema change |
| `test_inventory_service.py` + `test_medical_supplies_domain.py` + `test_capacity_locking.py` + `test_inventory_identity_map_staleness.py` + `test_inventory_lot_stock_levels.py` | 169 passed                             |
| `test_endpoint_auth_coverage.py`                                                                                                                                                 | 1 passed                               |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                                                    | 738 passed, 1 pre-existing skip        |
| `pytest tests/` (full backend suite)                                                                                                                                             | 11,461 passed, 21 pre-existing skips   |

MSUP-4, MSUP-11, and MSUP-15 remain the only open, flagged items. MSUP-18,
MSUP-19, and MSUP-20 are new fixes; MSUP-1 through MSUP-17 all re-verified
intact (no code in this round touched their fixes beyond the two methods
named above).

## Pass 7 — 2026-09-06

A seventh Codex round, reviewing the commit that fixed MSUP-20, found that
fix's own re-check still had a gap in the same shape as MSUP-19.

### MSUP-21 — LOW/MED — MSUP-20's domain re-check locked the item but not the separate category row it queried — ✅ FIXED (supersedes MSUP-20)

**What:** MSUP-20 made `retire_item`'s domain re-check read the _locked_
item's `category_id`, which is correct — but the `category_in_domain`
call it then made was still a plain (non-locking) read against the
_separate_ `InventoryCategory` row. Locking `InventoryItem` does not lock
`InventoryCategory`, and `retire_medical_item`'s own preflight
(`_require_medical_item`) already executes a plain read before
`retire_item` is even called — under REPEATABLE READ, that preflight read
is what establishes this transaction's snapshot (the snapshot is taken at
the transaction's _first_ read, not per-statement). So a plain
`category_in_domain` read later in the same transaction, no matter how
late, still answers from that same pre-race snapshot: if a broad
`inventory.manage` caller changes the _category's own_ `item_type` (medical
→ gear) while this retirement is in flight, the re-check could still see
the old, medical `item_type` and let the retirement through. This is
exactly the same root cause as MSUP-19 (a lock on one row does not make an
unrelated plain read of another row current), just found one call site
later — the category check MSUP-20 added had the identical gap MSUP-19 had
already fixed for the checkout/issuance counts on the very same PR.

**Where:** `app/services/inventory_service.py` — `category_in_domain`,
`retire_item`.

**Fix:** `category_in_domain` gained an optional `for_update: bool = False`
parameter (default unchanged — every other caller is a stateless preflight
with nothing of its own to lock, so a plain read stays the default and
this adds no cost or behavior change to them). `retire_item`'s domain
re-check now passes `for_update=True`, making that read bypass the
transaction's snapshot the way `_get_item_locked` and MSUP-19's blocker
counts already do.

**Guard tests:** new `TestCategoryInDomainForUpdate` in
`test_inventory_service.py` (2 cases, compiled-SQL capture matching
`TestGetCategoriesDefaultLimit`'s pattern) — the default call compiles
with no `FOR UPDATE`, `for_update=True` compiles with it. Verified
fail-before (failed against the plain read) / pass-after.
`test_retire_item_rechecks_domain_under_the_lock` updated to assert
`category_in_domain` is now called with `for_update=True`.

### Completion gate (pass 7)

| Check                                                                                                                                                                            | Result                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `flake8` / `black --check` / `isort --check-only` (inventory_service.py, test_inventory_service.py)                                                                              | clean                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                | PASSED — single head, no schema change |
| `test_inventory_service.py` + `test_medical_supplies_domain.py` + `test_capacity_locking.py` + `test_inventory_identity_map_staleness.py` + `test_inventory_lot_stock_levels.py` | 171 passed                             |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                                                    | 740 passed, 1 pre-existing skip        |
| `pytest tests/` (full backend suite)                                                                                                                                             | 11,463 passed, 21 pre-existing skips   |

MSUP-4, MSUP-11, and MSUP-15 remain the only open, flagged items. MSUP-21
is a new fix (supersedes MSUP-20); MSUP-1 through MSUP-20 all re-verified
intact.

## Pass 8 — 2026-09-06

An eighth Codex round, reviewing the commit that fixed MSUP-21, found that
MSUP-16's backend retire route had no frontend consumer — the capability
it exists to restore was still unreachable through the shipped app.

### MSUP-22 — MED — the medical retire route MSUP-16 added had no frontend caller, so a medical-only manager still had no way to retire an item through the app — ✅ FIXED

**What:** MSUP-16 added `POST /medical-supplies/items/{id}/retire` because
closing the `active`/RETIRED bypass (MSUP-7→13) left a caller holding only
`inventory.manage_medical` with no way to retire a medical item at all.
But `medicalSuppliesService.ts` had no `retireItem` method, and
`MedicalSuppliesPage.tsx`'s per-row actions offered only Edit. The
existing `inventoryService.retireItem` calls the _general_ inventory
route, which still requires the broader `inventory.manage` — so a
medical-only manager using the shipped SPA still had no path to retire an
item. The backend fix was real but invisible: the regression MSUP-16
exists to close was still present from that manager's actual vantage
point, the app.

**Where:** `frontend/src/services/medicalSuppliesService.ts`,
`frontend/src/modules/medical-supplies/pages/MedicalSuppliesPage.tsx`.

**Fix:** added `medicalSuppliesService.retireItem(itemId, notes?)`,
posting to the medical-domain route MSUP-16 added. Added a Retire action
next to Edit in the medical supplies table (same `canManage` gate as
Edit), behind a `useConfirm()` dialog (Pitfall #16 — never
`window.confirm`) since retirement cannot be undone, with the existing
`react-hot-toast` success/error pattern this module's own item form modal
already uses.

**Guard tests:** `MedicalSuppliesPage.test.tsx` gained 2 cases — a Retire
button is offered per row to a manager, and confirming it calls
`medicalSuppliesService.retireItem` with the item's id (posting to the
medical-domain route, not the general one `inventoryService.retireItem`
would have hit).

### Completion gate (pass 8)

| Check                                                                                | Result                          |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| Frontend: `npm run typecheck`                                                        | clean                           |
| Frontend: `eslint` (medicalSuppliesService.ts, MedicalSuppliesPage.tsx and its test) | clean                           |
| `MedicalSuppliesPage.test.tsx`                                                       | 49 passed (47 existing + 2 new) |
| `vitest run src/modules/medical-supplies`                                            | 65 passed                       |

MSUP-4, MSUP-11, and MSUP-15 remain the only open, flagged items. MSUP-22
is a new fix, completing MSUP-16's originally-intended capability end to
end; MSUP-1 through MSUP-21 are backend-only and unaffected by this
frontend-only change.

## Pass 9 — 2026-09-06

A ninth Codex round found two more real, mechanically-fixable bugs, and one
finding broad enough that it needs a scoped follow-up rather than a patch
in this already nine-round PR.

### MSUP-23 — MED — `assign_item_to_user`, `checkout_item`, and `issue_from_pool` locked the item with a duplicated inline SELECT missing `populate_existing` — ✅ FIXED

**What:** These three methods each had their own inline
`select(InventoryItem)...with_for_update()` instead of calling the shared
`_get_item_locked` helper — identical in shape to the exact bug MSUP-10
fixed for `add_lot` and MSUP-13 fixed for `retire_item`. `distribute_items`
(the scan/distribution batch flow) preloads a candidate item unlocked via
`_lookup_by_item_id`/`lookup_by_code`, in the same session/transaction,
before calling into whichever of these three the item's tracking type
routes it to. Without `populate_existing`, a concurrent write racing that
window (e.g. a retirement committing while the batch request waited on the
lock) would be invisible: SQLAlchemy's identity map hands back the stale,
pre-race Python object from the preload rather than the row the locking
SELECT itself just fetched — letting an assignment, checkout, or pool
issuance land on a now-retired item, the exact hidden-held state this
whole PR exists to prevent, from the opposite direction.

**Where:** `app/services/inventory_service.py` — `assign_item_to_user`,
`checkout_item`, `issue_from_pool`.

**Fix:** all three now call `_get_item_locked(item_id, organization_id)`
instead of duplicating the inline SELECT, matching `unassign_item` and the
maintenance-completion paths, which already did.

**A test-writing pitfall worth recording:** the first version of this
fix's regression test used `assert peek.scalar_one().status == ...` —
matching `retire_item`'s own staleness test's style — and it passed
against the _unfixed_ code, silently proving nothing. The two tests are
demonstrating different mechanisms: `retire_item`'s original bug
(pre-MSUP-13) was an entirely **unlocked** read (`get_item_by_id`, no
`FOR UPDATE` at all) — plain Pitfall #27 snapshot staleness, which persists
for the whole transaction regardless of whether the peeked Python object
is still referenced. This bug is **identity-map object** staleness: the
locking SELECT's SQL genuinely fetches current data, but SQLAlchemy only
overwrites an _already-loaded_ cached object's attributes when
`populate_existing=True` is set. Testing that requires an object that is
still loaded — and SQLAlchemy's identity map holds it by weak reference,
so an unreferenced peek (`peek.scalar_one().status == ...`, matching the
retire_item test's shape) is garbage-collected the moment the statement
finishes, and the next query then legitimately builds a fresh object
regardless of the bug. Confirmed empirically: the same peek query with
and without binding its result to a kept-alive local variable gave
opposite outcomes against identical unfixed code. Fixed by binding the
peek to `cached_item` and keeping it referenced through the rest of the
test, matching MSUP-10's own `add_lot` staleness test
(`test_add_lot_carries_forward_the_current_quantity_not_a_stale_cache`),
which already does this correctly. The lesson: an identity-map-staleness
test needs a _referenced_ stale object to demonstrate anything; a
snapshot-staleness test (no lock at all) does not.

**Guard tests:** `test_capacity_locking.py` gained
`TestLockedMutationsUseTheSharedHelper.test_assign_checkout_and_issue_use_get_item_locked`
(static, asserts all three call `_get_item_locked`, not an inline SELECT).
`test_inventory_identity_map_staleness.py` gained
`test_checkout_item_sees_a_concurrent_retirement_not_its_own_stale_cache`
(the two-real-session, kept-alive-reference test described above) —
verified failing against the reverted inline-SELECT code and passing
after.

### MSUP-24 — MED — the pool-issuance retirement check was skipped once an item's tracking type was switched away from POOL — ✅ FIXED

**What:** `_deactivation_block_reason`'s unreturned-pool-issuance check
ran only `if item.tracking_type == TrackingType.POOL`. `tracking_type` is
an ordinary field on the generic `update_item` PATCH with no check against
outstanding holdings, so a caller could switch a pool item to `individual`
specifically to skip this check, then retire the item over units a member
still has checked out — an `ItemIssuance` row persists independently of
whatever tracking_type the item is relabeled to later, so gating the
check on the item's _current_ value was never correct.

**Where:** `app/services/inventory_service.py` — `_deactivation_block_reason`.

**Fix:** the pool-issuance count now runs unconditionally, matching the
active-checkout count just above it (which was never gated). An
individual-tracked item with no issuance history simply gets a harmless
zero-row count.

**Guard tests:** `TestRetireItem` in `test_inventory_service.py` gained
`test_retire_blocked_by_a_pool_issuance_even_after_tracking_type_changed`.
`test_capacity_locking.py` gained
`TestRetireItemBlockerCounts.test_the_pool_issuance_check_is_not_gated_on_tracking_type`
(static, asserts `TrackingType.POOL` no longer appears in
`_deactivation_block_reason`'s source).

### MSUP-25 — LOW/MED, flagged (not fixed this pass) — every other medical-domain write shares retire_item's original preflight-then-mutate TOCTOU shape

**What:** `update_medical_item`, `add_medical_item_lot`,
`receive_medical_delivery`, `update_medical_lot`, and `delete_medical_lot`
all validate domain membership via a plain-read preflight
(`_require_medical_item`/`_require_medical_category`) _before_ calling
into the underlying `InventoryService` mutation, exactly like
`retire_medical_item` did before MSUP-20/21. If a broad `inventory.manage`
caller reclassifies the item or its category between that preflight and
the mutation's own lock (where one exists), a medical-only caller could
mutate a row that raced out of their domain in the same narrow window
MSUP-20/21 closed for retirement specifically.

**Why flagged, not fixed here:** this is the same root shape as
MSUP-20/21, but generalizing the fix means auditing and instrumenting five
more mutation paths individually — `update_item`'s `needs_lock` branching,
`add_lot`'s two-phase locked carry-forward, `add_lots_bulk`'s per-line
loop, and `update_lot`/`delete_lot`, which mutate `InventoryLot` rows and
may not lock the parent `InventoryItem` at all today. Each needs its own
locked re-validation designed against its own transaction shape, the way
`retire_item`'s was — not a single mechanical patch. The severity is also
genuinely lower than retirement's: these are same-organization,
non-destructive field edits (rename, quantity, lot dates), not an
irreversible removal from active inventory, and the race requires a
category reclassification to land in the same narrow window as a
non-destructive edit — narrower, lower-impact, and effort-disproportionate
to fix as a ninth-round patch on a PR already this deep into the same
question. Recorded here so it is not silently dropped; a follow-up pass
should design one shared "validate domain under this mutation's own lock"
contract and apply it to all five, rather than resolving each ad hoc.

### Completion gate (pass 9)

| Check                                                                                                                                                                            | Result                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `flake8` / `black --check` / `isort --check-only` (inventory_service.py, all touched backend test files)                                                                         | clean                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                | PASSED — single head, no schema change |
| `test_inventory_service.py` + `test_capacity_locking.py` + `test_inventory_identity_map_staleness.py` + `test_medical_supplies_domain.py` + `test_inventory_lot_stock_levels.py` | 175 passed                             |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                                                    | 742 passed, 1 pre-existing skip        |
| `pytest tests/` (full backend suite)                                                                                                                                             | 11,467 passed, 21 pre-existing skips   |

MSUP-4, MSUP-11, MSUP-15, and the new MSUP-25 are the only open, flagged
items. MSUP-23 and MSUP-24 are new fixes; MSUP-1 through MSUP-22 all
re-verified intact.

## Pass 10 — 2026-09-06

A tenth Codex round found that MSUP-13's own fix broke two already-shipped
frontend flows outright, plus one more bypass in the same shape as
MSUP-25's flagged class.

### MSUP-26 — MED — MSUP-13's status/condition-RETIRED rejection deterministically broke two shipped frontend flows — ✅ FIXED

**What:** `InventoryItemsPage.tsx`'s "Bulk Status Change" picker and
`ItemFormModal.tsx`'s Condition dropdown both still offered `Retired` as a
selectable option and, on selection, submitted exactly the
`status`/`condition` RETIRED pair MSUP-13 made `update_item` reject
outright. Both controls shipped before MSUP-7 through MSUP-13 existed;
none of those rounds' frontend-caller searches caught them because they
don't literally send `active` — same shape as MSUP-16/22 (a real
capability broken by this PR's own fix chain, not a pre-existing gap), but
here the break is a guaranteed 400 on every use of two already-shipped
controls, not a narrow permission-holder's missing path.

**Where:** `frontend/src/modules/inventory/pages/InventoryItemsPage.tsx`
(bulk status picker), `frontend/src/modules/inventory/components/ItemFormModal.tsx`
(Condition picker).

**Fix:** both pickers now filter `retired` out of their options
(`STATUS_OPTIONS`/`ITEM_CONDITION_OPTIONS` themselves are untouched, since
both are also used for filter dropdowns and label lookups elsewhere that
still need `retired` to remain a valid, displayable value). Retiring
continues to be reachable only through the dedicated Retire action
already present in both pages' per-row actions.

**Guard tests:** `ItemFormModal.test.tsx`'s
`test_derives_a_retired_status_from_a_retired_condition` (which exercised
the now-removed option) was replaced with a test asserting `Retired` is
absent from the rendered options.
`InventoryItemsPage.test.tsx` gained the equivalent assertion for the bulk
status picker.

### MSUP-27 — MED — `update_item` let a caller silently reopen an already-retired item's status — ✅ FIXED

**What:** MSUP-13's reject condition only catches a payload _entering_
retirement (`active` present, or a `status`/`condition` pair of RETIRED).
It says nothing about an _already-retired_ item's `status`/`condition`
being changed to something else — `PATCH {"status": "available",
"condition": "good"}` on a retired item touches neither of the guarded
values, so it passes through untouched. Since `active` is never mentioned
in that payload, it stays `false` while `status` becomes `available` —
and `assign_item_to_user`/`checkout_item` gate on `status`, not `active`,
so the item could be handed to a member while remaining hidden from every
active-inventory listing. Nothing in this codebase reactivates a retired
item (re-confirmed again this round), so there was never a legitimate
transition here to preserve.

**Where:** `app/services/inventory_service.py` — `update_item`.

**Fix:** added a second reject condition: if the item is currently
inactive (`not item.active`) and the update touches `status` or
`condition` at all, reject with a clear error. Fields unrelated to
status/condition (name, storage location, notes, etc.) remain editable on
a retired item for record-keeping.

**Guard tests:** `TestUpdateItemRejectsActive` gained
`test_rejects_reopening_a_retired_items_status` (verified fail-before/
pass-after) and `test_a_retired_items_unrelated_fields_stay_editable`
(confirms the guard is scoped to status/condition, not every field).

**Also discovered, folded into MSUP-25's flagged scope rather than fixed
separately:** the maintenance-completion path
(`complete_maintenance`/`InventoryMaintenancePage.tsx`'s "Condition After
Work" picker) can independently write a RETIRED condition, and
`_enforce_state_invariant`'s auto-correction then sets `status = RETIRED`
too — entirely outside `update_item` and this round's guard, with none of
`retire_item`'s locking, blocker checks, or audit trail, and leaving
`active` untouched (`True`). This is the same systemic shape MSUP-25 already
flags (a write path other than `retire_item` producing retirement-equivalent
state); recorded here as a concrete second instance for the same follow-up
pass to address, not fixed now for the same scope/severity reasons MSUP-25
was flagged rather than fixed.

### Completion gate (pass 10)

| Check                                                                                               | Result                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `flake8` / `black --check` / `isort --check-only` (inventory_service.py, test_inventory_service.py) | clean                                  |
| `python3 scripts/validate_migrations.py --strict`                                                   | PASSED — single head, no schema change |
| `test_inventory_service.py`                                                                         | 97 passed                              |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                       | 744 passed, 1 pre-existing skip        |
| `pytest tests/` (full backend suite)                                                                | 11,469 passed, 21 pre-existing skips   |
| Frontend: `npm run typecheck`, `eslint`                                                             | clean                                  |
| `InventoryItemsPage.test.tsx` + `ItemFormModal.test.tsx`                                            | 52 passed                              |

MSUP-4, MSUP-11, MSUP-15, and MSUP-25 (now covering a second concrete
instance, the maintenance-completion path) are the only open, flagged
items. MSUP-26 and MSUP-27 are new fixes; MSUP-1 through MSUP-24 all
re-verified intact.

## Pass 11 — 2026-09-11

Routine rotation re-verification, not triggered by a Codex round on an open
PR — pass 10 closed out its own PR (#2301) five days prior, and the general
inventory feature's own security review (INV-11 pass 4, PR #2422, merged
2026-09-08) already independently re-verified this same fix chain from its
side. This pass re-reads the router, every `InventoryService` method it
calls, and the frontend module against current code, rather than trusting
either prior write-up.

### Scope

Read in full: `backend/app/api/v1/endpoints/medical_supplies.py` (still 763
L, still 15 routes — up one route from pass 3's 14, per MSUP-16's retire
route added at pass 5). Re-read directly against current line numbers
(`inventory_service.py` grew again, ~9,995 L at pass 3/4 to 11,169 L now,
from unrelated inventory features and INV-11's own pass 4 fixes landing
since): `create_category`/`get_categories`/`update_category` (:798-957),
`get_item_by_id`/`_get_item_locked`/`update_item`/
`_deactivation_block_reason`/`retire_item` (:2560-2897),
`get_low_stock_items_for_alerts`/`category_in_domain`/`item_in_domain`/
`items_in_domain`/`lot_in_domain`/`list_lots`/
`_carry_forward_column_stock`/`add_lot`/`add_lots_bulk`/`update_lot`/
`delete_lot`/`get_expiring_lots` (:7329-8001). Also read, for the first time
at this depth in this rotation's own MSUP-23 file (prior passes covered the
backend only, per each pass's own stated scope): the five frontend files
under `frontend/src/modules/medical-supplies/` plus
`frontend/src/services/medicalSuppliesService.ts`.

Every route enumerated for its auth dependency and permission string (not
spot-checked) — all 15 still carry `Depends(get_db)` +
`Depends(require_permission(...))`, still domain-first
(`inventory.view_medical`/`inventory.manage_medical` OR'd against the broad
`inventory.view`/`inventory.manage`), matching the router's own module
docstring.

### Re-verified against current code — all fixes hold

Every prior fix (MSUP-1 through MSUP-24, MSUP-26, MSUP-27) was re-read at
its current location, not assumed from the line numbers in earlier passes:

- **MSUP-1** (`apply_updates`, not `setattr` loops) — `update_category`
  (:915), `update_item` (:2763), `update_lot` (:7933) all still route
  through it.
- **Domain pinning** (`category_in_domain`/`item_in_domain`/
  `items_in_domain`/`lot_in_domain`, :7405-7548) — all four still
  org-scoped on both sides of their join, fail closed.
- **MSUP-2/9** — `items_in_domain`'s bulk one-query domain check (:605 in
  the router) and `get_categories`' `limit: int = 5000` default (:834)
  both unchanged.
- **MSUP-3** — `medical_supply_summary`'s `low_stock`/`total_items` split
  (router :752-758) still reads `low_stock` from
  `get_low_stock_items_for_alerts` (uncapped,
  `reorder_point IS NOT NULL`-filtered before any row loads) and
  `total_items` from a separate `limit=1` call — neither depends on a
  page-size cap.
- **MSUP-5/6** — `update_medical_category`/`update_medical_item` still
  audit on success (router :228, :443), and the `fields_updated` snapshot
  in `update_medical_category` (:213) is still taken _before_
  `service.update_category()`'s in-place `metadata` → `extra_data` rename.
- **MSUP-7/12/13/27** — `update_item` (:2629) still rejects `active`, a
  `status`/`condition` RETIRED pair, and (MSUP-27) any `status`/`condition`
  change on an already-inactive item (:2702-2722); `retire_item` alone sets
  the triple (`status`/`condition`/`active`) together (:2875-2877).
- **MSUP-8/14** — `get_item_by_id`'s `attach_lot_stock` parameter (:2564)
  still defaults `False` and `get_medical_item` still passes `True`
  (router :334); confirmed the frontend companion (MSUP-14,
  `ItemDetailPage.tsx`'s `onHandQuantity()` call) separately, see below.
- **MSUP-10/18** — `_carry_forward_column_stock`'s locking SELECT (:7623)
  still locks unconditionally (`quantity > 0` filtered in Python _after_
  the lock, :7635) with `populate_existing=True` (:7630).
- **MSUP-16/22** — `retire_medical_item` (router :458) still exists,
  still domain-checked via `_require_medical_item` plus
  `required_item_types=MEDICAL_ITEM_TYPES` passed to `retire_item`
  (:490-496); `medicalSuppliesService.retireItem` and
  `MedicalSuppliesPage.tsx`'s Retire action (confirmed directly, see
  below) still call the medical-domain route, not the general one.
- **MSUP-19** — both blocker counts in `_deactivation_block_reason`
  (:2797, :2813) still add `.with_for_update()`.
- **MSUP-20/21** — `retire_item`'s domain re-check (:2863-2869) still
  passes `for_update=True` into `category_in_domain` (:7410), which still
  defaults `for_update=False` for every other (stateless-preflight)
  caller.
- **MSUP-23** — `assign_item_to_user` (confirmed at :2921) still calls
  `_get_item_locked`, not a duplicated inline `SELECT ... FOR UPDATE`.
- **MSUP-24** — the pool-issuance blocker count (:2813-2819) still runs
  unconditionally, with no `tracking_type == POOL` gate in its source.
- **MSUP-26** — not independently re-verified this pass (frontend files
  outside this module's own directory were not re-read); no reason to
  suspect drift, since nothing in `inventory_service.py`'s diff since pass
  10 touches `ItemStatus`/`ItemCondition` option lists.

No regression, no drift, and — checking the one commit that landed in
`inventory_service.py` between pass 10 and today
(`4648783098`, "only an inspection may move an item's inspection clock",
2026-09-11) — no interaction with anything this router or its domain-pinning
helpers depend on: that fix is confined to `create_maintenance_record`'s
inspection-date logic, a different method entirely.

### Frontend module, read for the first time at this depth

`medical_supplies.py`'s own docstring and prior passes' "Frontend: not
reviewed this pass — backend only" note left the module's five component/
page files and its service wrapper unread by this rotation's own findings
file until now (MSUP-14/22 touched specific frontend files as fixes, but
neither pass read the whole module). All read in full this pass:

- **`services/medicalSuppliesService.ts`** — every method goes through the
  shared, cached `apiClient` (not a bespoke instance missing the auth/CSRF
  interceptors, the shape Pitfall #7 warns about). Its own header comment
  states the caching rationale correctly and consistently with the
  domain's own "Verified good" note above: this is department stock (item
  names, lot numbers, quantities), not PHI, unlike the similarly-named
  `/medical-screening/` endpoints — confirmed against
  `frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES`, which excludes
  `/medical-screening/` but not `/medical-supplies/`, matching the stated
  design.
- **`MedicalItemFormModal.tsx`** — uses `blankToNull`/`numberOrNull` on the
  update path and `|| undefined` on the create path (Pitfall #1, both
  directions correct). **Already lot-stocked-aware**: `isLotStocked` hides
  the editable Quantity input behind a read-only "N from stock lots" note
  and omits `quantity` from the update payload entirely when the item is
  lot-stocked (`...(isLotStocked ? {} : { quantity: numberOrNull(...) })`).
  This is the medical-domain-specific counterpart to MSUP-15's flagged gap
  in the _general_ inventory module's `ItemFormModal.tsx` — confirmed by
  direct comparison that the general file (`modules/inventory/components/
ItemFormModal.tsx`) has no `is_lot_stocked`/`isLotStocked` reference
  anywhere in it, so MSUP-15's gap is real and unchanged there, but does
  **not** reach a medical item through this module's own screens
  (`MedicalSuppliesPage.tsx` renders only this file's modal, never the
  general one). It is still reachable for a medical item through the
  _general_ Inventory page, since a broad `inventory.manage` holder's
  `ItemDetailPage.tsx`/`ItemFormModal.tsx` flow is not domain-filtered
  (`GET /inventory/items/{id}` and `PATCH /inventory/items/{id}` both take
  `inventory.manage`/`inventory.view` alone, with no
  `exclude_item_types=MEDICAL_ITEM_TYPES` the _list_ routes carry) —
  additive by the router's own stated design (`inventory.manage` covers
  medical stock too), not a new gap, but worth stating precisely since
  MSUP-15's original write-up did not scope which module the risk actually
  lives in. KNOWN_LIMITATIONS.md's MSUP-15 row, added this pass (it was
  never mirrored there before), records this precisely.
- **`MedicalCategoriesPage.tsx`**, **`MedicalSupplyItemPicker.tsx`**,
  **`ReceiveDeliveryModal.tsx`**, **`MedicalSuppliesPage.tsx`** — all use
  `blankToNull`/`numberOrNull` or `|| undefined` correctly per their
  create/update distinction; retirement goes through `useConfirm()` (never
  `window.confirm`, Pitfall #16); every manage-gated control checks
  `checkPermission('inventory.manage_medical') ||
checkPermission('inventory.manage')`, matching the backend's OR-gate
  exactly; `ReceiveDeliveryModal.tsx`'s "blank row vs. incomplete row"
  validation matches the backend's own all-or-nothing delivery semantics.
  No new finding in any of the four.

### Documentation drift found and corrected — not a code finding

**`docs/KNOWN_LIMITATIONS.md`'s row for MSUP-11 was labeled MSUP-10.** The
row (added at pass 3) describes `list_lots` having no row cap — which pass
3's own findings doc numbers **MSUP-11** — but its trailing citation and
inline "see ... MSUP-10" both said MSUP-10, which is pass 3's _other_,
already-fixed finding (the `add_lot` opening-balance race in
`_carry_forward_column_stock`). A reader following the KNOWN_LIMITATIONS
citation to "MSUP-10" would land on the wrong section and could
mistakenly conclude `list_lots`'s cap gap was fixed. Corrected in place;
no code or behavior change.

**MSUP-15 and MSUP-25 were never mirrored into `KNOWN_LIMITATIONS.md` at
all**, across passes 4 (MSUP-15) and 9/10 (MSUP-25) — both are genuine
owner-decision items per CLAUDE.md's step 6/7 instructions ("mirror any
owner-decision items into KNOWN_LIMITATIONS.md"), and this pass adds them
(see the two new rows described above, and their exact text in the diff).

### Findings

None. This pass found no new code defect, confirmed every prior fix
(MSUP-1 through MSUP-27) still holds against current code with no drift,
and confirmed the four still-open flagged items (MSUP-4, MSUP-11, MSUP-15,
MSUP-25) remain accurately described. The only changes this pass makes are
the two `KNOWN_LIMITATIONS.md` corrections above — both documentation
accuracy, not security fixes.

### Completion gate (pass 11)

| Check                                                                                                                                                                            | Result                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                    | clean                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                             | clean — 1581 files unchanged                       |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                        | clean                                              |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                | PASSED — 443 revisions, single head `0533644945cd` |
| `test_medical_supplies_domain.py` + `test_inventory_service.py` + `test_capacity_locking.py` + `test_inventory_identity_map_staleness.py` + `test_inventory_lot_stock_levels.py` | 180 passed                                         |
| `test_endpoint_auth_coverage.py`                                                                                                                                                 | 1 passed                                           |
| `pytest -k "inventory or medical_supplies"` (full scoped run)                                                                                                                    | 849 passed, 1 pre-existing skip                    |
| Frontend: `npm run typecheck`                                                                                                                                                    | clean                                              |
| Frontend: `npm run lint`                                                                                                                                                         | clean — exit 0                                     |

No migration, no schema change, no source-code change. Only
`docs/KNOWN_LIMITATIONS.md` (two corrections/additions) and this findings
file changed. MSUP-4, MSUP-11, MSUP-15, and MSUP-25 remain the only open,
flagged items; MSUP-1 through MSUP-27 all re-verified intact.
