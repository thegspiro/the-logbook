# Application Review — Inventory (Tier B)

**Prefix:** `INV2` · **Iteration:** B3 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-08-11 (follow-up), 2026-10-06 (pass 5)

---

## Pass 5 (2026-10-06) — the real test baseline, and the last open item closed

**Backend:** `endpoints/inventory.py` (7,387 L, **148** routes),
`services/inventory_service.py` (11,627 L), `schemas/inventory.py` (2,909 L) —
~22k lines, the largest module in the repo
**Frontend:** none changed this pass
**Docs:** at review time, `wiki/Module-Inventory.md` (1,472 lines: vocabulary,
pages, endpoint paths, change history) and `wiki/Inventory-NFC-Tags.md` — but no
structured reference under `docs/`. Closed 2026-10-08 by
`docs/INVENTORY_MODULE.md`

### Scope — read this before reading "verified good"

This module is ~22,000 lines with 51 commits since the last pass. **It was not
read line-by-line and this pass does not claim it was.** A truncated read
reporting "clean" is worse than an honest partial scope, so:

**Reviewed exhaustively (mechanically, every instance):** all 148 route auth and
permission gates; all 12 authenticated-only routes' self-scoping; every
`like`/`ilike` call (31); every `# noqa: E712` (0); every quantity-mutating
method and whether it holds a row lock (8); every `*Create`/`*Update` quantity
field bound.

**Reviewed by reading:** `issue_from_pool`, `_get_item_locked`,
`_require_self_or_quartermaster`, `_redact_holder`, `list_equipment_requests`,
`list_return_requests`, `extend_checkout`, the five `users/{user_id}/…` reads,
and the three unlocked quantity helpers plus their callers.

**Not reviewed:** the remaining bulk of `inventory_service.py` — lots/ledger
internals beyond the locking question, NFC, kiosk, labels, import/export,
impact planner, audit scheduling, vendors. Each has its own test file (68
inventory test files exist) and prior passes covered the FK/tenancy invariants
across the module; their _business logic_ carries no verdict from this pass.

### Verified good ✅

- **148 routes, 0 without an auth dependency** — enumerated mechanically (parse
  each `@router.*`, walk to its `def`, scan the whole signature block), not
  spot-checked. 136 carry a permission gate: `inventory.manage` ×102,
  `inventory.view` ×34.
- **All 12 authenticated-only routes are correctly self-scoped**, which is the
  checklist's dimension-2 self-scoping item and the thing an `inventory.view`
  gate could not have answered. Five `users/{user_id}/…` reads (assignments,
  issuances, inventory, clearance, issuance-history) go through
  `_require_self_or_quartermaster`, which returns early for self, allows
  `inventory.manage`, and otherwise **raises 403** — no fall-through, fails
  closed. `extend_checkout` resolves the checkout org-scoped first, then applies
  the same own-or-manage test. `list_equipment_requests` and
  `list_return_requests` both **force** the requester filter to the caller for
  non-managers regardless of the `mine_only` flag
  (`requester_id = None if (can_manage and not mine_only) else current_user.id`),
  so the flag cannot be used to widen a read. The guard's docstring explains why
  `inventory.view` is the wrong gate — it is in the baseline Member position, so
  every member holds it — and `_redact_holder` closes the matching catalog-side
  disclosure (`GET /items?assigned_to=<uuid>` reconstructing a colleague's kit).
- **Every quantity mutation is serialized by a row lock.** Eight methods write
  `quantity`/`quantity_issued`; five lock directly and the three that do not
  (`_release_item_holders`, `_return_units_to_stock`, called from
  `review_write_off`, `return_to_pool`, `review_return_request`) are private
  helpers invoked under a caller that already holds the lock — checked by
  resolving each call site's enclosing method, not by assuming. `issue_from_pool`
  is the pitfall #27 shape (read `item.quantity`, compare, decrement) and locks
  through `_get_item_locked`, whose docstring documents the trap that makes the
  lock real: `populate_existing=True`, because without it SQLAlchemy's identity
  map hands back the stale pre-lock copy of `quantity` and the lock is acquired
  but useless. That is pitfall #27's second half, understood and written down.
- **Negative stock is closed on both sides.** Every `quantity` field on a
  `*Create`/`*Update` schema is bounded (`ge=0` or `ge=1`), so a client cannot
  send a negative; the only decrement paths check sufficiency first
  (`issue_from_pool`'s "Insufficient stock", `_consume_from_lots`' error
  return); and migration `7d2e4f6a8b13` clamped the historical negatives that
  used to 500 the item list.
- **Injection-free.** All **31** `like`/`ilike` calls carry
  `escape=LIKE_ESCAPE_CHAR` — verified with a paren-matching scan rather than a
  line grep, because the kwarg routinely sits on a continuation line and a line
  grep reports false positives. 0 `# noqa: E712` remain.
- **The AP2-5 no-op ternary class is extinct repo-wide.** Yesterday's apparatus
  pass removed four `a if isinstance(a, dict) else a` blocks; an AST sweep
  comparing `ast.dump(node.body) == ast.dump(node.orelse)` over every `IfExp` in
  `app/`, `tests/` and `scripts/` now finds **0**. (A regex for this produces ~49
  false positives, because the backreference matches the prefix of
  `value if value.tzinfo else value.replace(...)`, whose branches genuinely
  differ. The AST comparison is the check worth keeping.)

### INV2-3 — The last open item closed by verification, not by a fix — ✅ CLOSED

**What:** passes 2–4 each carried forward a `_escape_like` DRY cleanup — a
hand-rolled LIKE-escaper duplicated across the search methods — as the smallest
remaining flagged item.

**Where:** `inventory_service.py`; `grep -c _escape_like` now returns **0**.

**Impact:** none outstanding. The helper is gone, replaced by the shared
`like_pattern()` / `LIKE_ESCAPE_CHAR` pair from `app/utils/sql_search.py` (8
`like_pattern` call sites), which is what CLAUDE.md pitfall #25 requires and what
`tests/test_like_escaping.py` enforces repo-wide. The repo-wide pitfall-#25 work
absorbed this module's copy; nobody closed the item because nobody looked.

**Fix:** no code change — the item is recorded closed. With INV-4 closed in pass
4 and INV-6 in the 2026-08-11 follow-up, **this module now carries no open
code findings.**

### No new code defects this pass

Stated plainly rather than dressed up: within the scope above, this pass found
nothing to fix in the code. Four prior app-review passes, a follow-up and a
security-review rotation have worked this module hard, and the dimensions most
likely to still hide something — self-scoping and quantity concurrency — came
back clean under exhaustive rather than sampled checks. The contribution of this
pass is therefore the test baseline below, the closed item above, and the
process correction in Documentation gaps.

### Duplication

- No duplication found within the reviewed surface. The two candidates a reader
  might expect are both already consolidated: LIKE escaping (now one
  `like_pattern`) and the own-or-quartermaster test (now one
  `_require_self_or_quartermaster`, 7 call sites, rather than per-endpoint
  re-checks).

### Dead code

- Nothing found. `MAX_INVENTORY_CSV_BYTES` is a live module constant (2 uses),
  not a stale flag; the AST sweep above found no no-op branches.

### Documentation gaps

1. **`CHECKLIST.md` gained the stale-schema trap** — the one thing this pass
   genuinely needed to write down. The session-start hook builds the schema
   **once**; `main` moves while a session runs; so a DB-backed suite can fail
   with `(1054, "Unknown column 'x'")`, which is indistinguishable from a real
   defect in the feature under review. This pass opened with **98 failures and
   25 errors** across the inventory suite on a tree it had not touched. All 123
   were stale schema and all 123 disappeared after
   `alembic upgrade head && repair_schema.py`. The entry now says to rebuild
   before reading such a failure as a finding. Without it the next reviewer
   loses the same time, or worse, reports phantom findings.
2. **No structured reference under `docs/`** — 148 routes, two permission
   strings, pool vs individual vs lot tracking, issuance allowances, departure
   clearance, write-offs, NFC and kiosk had no single place stating their shapes
   and gates. Same gap as apparatus (AP2 pass 5).

   > **Correction (2026-10-08).** This item originally said the module was
   > "documented only in docstrings and the wiki's nav tables", and named the
   > missing file `docs/INVENTORY.md`. Both were wrong.
   > **[wiki/Module-Inventory.md](../../wiki/Module-Inventory.md)** — 1,472 lines
   > including a 434-line endpoint section — existed throughout, and this pass
   > did not look for it; the house convention is `<NAME>_MODULE.md`. The real
   > gap was the absence of a _structured_ reference, now
   > `docs/INVENTORY_MODULE.md`, which cross-links the
   > wiki page and deliberately defers to it for the exhaustive path list rather
   > than creating a second copy to go stale. Several modules carry both by
   > design — `docs/SCHEDULING_MODULE.md` and `wiki/Module-Scheduling.md` are
   > the precedent.

### Future development

1. ~~**A structured reference for this module.**~~ **Closed 2026-10-08** —
   `docs/INVENTORY_MODULE.md`, alongside
   `docs/APPARATUS_MODULE.md` for the other large module.
   `docs/FEATURE_DOC_COVERAGE.md` now tracks which
   of the 36 reviewed features still lack one, so the question stops being
   re-answered per pass.
2. **The unreviewed surface has no business-logic verdict** — lots/ledger, NFC,
   kiosk, labels, import/export, impact planner, vendors. Each is a plausible
   focused iteration; the lots ledger is the highest-value one, since it is the
   authoritative stock record for lot-tracked items and the only quantity path
   this pass checked solely for locking.
3. **`MAX_INVENTORY_CSV_BYTES` is hardcoded at 10 MB.** Not a defect and not
   flagged — a fixed cap is arguably the safer design — but it is the one
   operational knob in this module that an operator cannot change.

### Completion gate (pass 5)

| Check                | Result                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`  | ✅ 0 (no frontend file changed this pass)                                                                                                                                  |
| `flake8 app/ tests/` | ✅ 0                                                                                                                                                                       |
| `black --check`      | ✅ clean                                                                                                                                                                   |
| `npm run lint`       | ✅ 0 (no frontend file changed this pass)                                                                                                                                  |
| backend tests        | ✅ **1,169 passed, 1 skipped, 0 failed** (`-k inventory`) — the first real number for this module; passes 3–4 could only report 142 DB-free passing plus 75 fixture errors |
| docs link check      | ✅ 0 broken links                                                                                                                                                          |

---

## Follow-up (2026-08-11) — pagination, storage filters, and optional kit lines

- Equipment-request pagination now runs a filtered count query and returns the
  real total instead of the current page length. The admin page exposes 25-row
  previous/next navigation and sends explicit `skip`/`limit` parameters.
- Storage-area tree responses now use the same filtered query as flat responses;
  `location_id` and `parent_id` are no longer discarded by an unfiltered reload.
- INV-6 is closed: equipment-kit lines persist an `optional` flag through the
  database model, migration, API schemas, service, frontend contracts, and kit
  editor. Optional missing/failed lines are skipped; required lines still fail.
- Best-effort WebSocket publishing remains non-blocking but now logs exceptions
  with organization and action context.

Focused DB-free backend and frontend regression tests cover the filtering,
pagination-total, page-navigation, and optional-line editor behavior.

---

## Pass 4 (2026-08-09) — INV-4 closed: the dedicated XC-1 FK-scoping sweep

Pass 4 did the one substantive item the prior three passes deliberately deferred:
the mechanical-but-real `assert_in_org` sweep across every inventory create/update
method that persists a client-supplied FK without an in-org check.

### INV-4 — LOW/MED — Client-supplied FKs stored without an in-org check — ✅ FIXED

**What:** ~13 methods stored a client-supplied FK id straight onto an org-stamped
row without verifying the referenced row is in the caller's org. Each is a
dangling/mis-attributed cross-tenant reference (XC-1). A full map (via a
sub-agent) confirmed every FK target _is_ org-scoped and validatable, and that the
read-leak subset (member `user_id` via listings) was already closed in INV2-1 —
so these were integrity-only, which is why they were safe to leave flagged until a
focused pass. Now fixed:

| Method                                                    | FK(s) now validated in-org                                                  | Target model                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `create_category` / `update_category`                     | `parent_category_id`                                                        | `InventoryCategory`                                   |
| `create_item` / `update_item`                             | `location_id`, `storage_area_id`, `variant_group_id`, `assigned_to_user_id` | `Location`, `StorageArea`, `ItemVariantGroup`, `User` |
| `create_maintenance_record` / `update_maintenance_record` | `performed_by`                                                              | `User`                                                |
| `create_write_off_request`                                | `clearance_id`                                                              | `DepartureClearance`                                  |
| `create_size_variants`                                    | `category_id`, `location_id`, `storage_area_id`                             | `InventoryCategory`, `Location`, `StorageArea`        |
| `create_return_request`                                   | `assignment_id`, `issuance_id`, `checkout_id`                               | `ItemAssignment`, `ItemIssuance`, `CheckOutRecord`    |
| `create_reorder_request` / `update_reorder_request`       | `item_id`, `category_id`                                                    | `InventoryItem`, `InventoryCategory`                  |
| `create_equipment_kit`                                    | line-item `item_id`, `category_id`                                          | `InventoryItem`, `InventoryCategory`                  |
| `create_reorder_from_plan`                                | `stock_category_id`                                                         | `InventoryCategory`                                   |

**How:** every check reuses the shared `assert_in_org(..., allow_none=True,
label=…)` (all these FKs are nullable), matching the existing `create_variant_group`
precedent already in this file. Two small helpers keep it DRY where a method group
shares the same FK set — `_assert_item_fks_in_org` (item location/storage/
variant-group/assignee, present-key-only so a partial update doesn't touch
unmentioned FKs) and `_assert_reorder_fks_in_org`. `category_id` on items was
already validated via `_validate_category_requirements`, so it's not re-checked.
`EquipmentKitItem` has no `organization_id` (org-scoped only through its parent
kit), so its child FKs (`item_id`/`category_id`) are validated directly.
`create_reorder_from_plan` now **fails closed** on a foreign/missing stock category
(it previously stamped the client id onto generated reorders even when the
org-scoped lookup returned nothing — a dangling FK relying on a zero-shortfall side
effect to be harmless). Added `DepartureClearance`, `StorageArea`, and a top-level
`Location` import (the latter replacing a redundant in-method import).

No behavior change for valid callers (the frontend selects these ids from
org-scoped dropdowns); a foreign/garbage id that previously stored a dangling
reference is now a clean `ValueError → 400`. **10 DB-free tests added**
(`test_inventory_inv4_fk_scoping.py`): foreign FK rejected per model, all-in-org
passes, partial-update touches only present keys, explicit-None allowed, plus
method-level checks on `create_return_request` and `create_category`.

**This closes INV-4 — the biggest standing item on the module.** The remaining
flagged items are the equipment-kit `optional` feature (INV-6 half — a
column+migration) and the `_escape_like` DRY cleanup, both smaller and unchanged.

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_inventory_inv4_fk_scoping.py` **10 passed** +
`test_inventory_service.py` DB-free suite unchanged. The `test_inventory.py`
`db_session` errors remain the known no-MySQL fixture failures.

---

## Pass 3 (2026-08-09) — closed INV2-2 (E712 sweep); latent-500 lens clean

Re-verified the landed fixes hold: **INV2-1** member-in-org validation intact at
all four member-facing mutation sites (`is_in_org(self.db, User, user_id, org)` →
`"Member not found"` at service lines 929, 1124, 1359, 4408); **INV-3** maintenance
item-in-org guard intact (the `"Item not found"` early return); INV-1/INV-2/INV-5/
INV-6-safe-half unchanged.

### INV2-2 — NIT — 55 `== True/False  # noqa: E712` suppressions swept — ✅ FIXED

Pass 2 recorded these as a standalone cleanup to do in "one focused commit, no
behavior change" — deliberately not mixed into the INV2-1 security fix. Done here as
that focused commit: all 55 boolean-column comparisons in `inventory_service.py`
(`.is_returned == False`, `.active == True`, `.is_overdue == True`, etc. — including
the ternary at the assignment/issuance branch and the list-context conditions) were
converted to `.is_(True)` / `.is_(False)` (Pitfall #10), removing **every**
`# noqa: E712` from the file. Behavior-neutral for boolean columns; flake8 stays
clean and the file needs no black reformat.

### Latent-500 lens (the B1 finding) — checked, clean

The B1 class (a request field typed as free `str` that maps to a strict `Enum`
column) does **not** recur here. Inventory has a large enum surface (17 models with
enum columns — `condition`/`status`/`tracking_type`, `request_type`/`priority`,
`maintenance_type`, `checkout_condition`, `storage_type`, …), and an automated
sweep of every `*Create`/`*Update` schema field that maps to an enum column found
**0** typed as free `str` — all are properly enum-typed, so an out-of-range value
is rejected at the schema (422) rather than reaching MySQL and 500-ing.

### INV-4 remainder — LOW — dangling-only FK sweep — 🚩 OPEN (unchanged)

Still the one substantive open item: the ~15 create/update methods that persist
client-supplied `category_id`/`location_id`/`storage_id`/assignment-issuance-checkout
ids without an in-org check. Pass 2 established (and re-confirmed here) that these are
**integrity-only** — the read-leak subset (member `user_id` via listings) was already
closed in INV2-1, and these remaining FKs are not projected by name into any
response. As pass 1/2 both concluded, this is a genuine ~15-method mechanical
`assert_in_org` sweep that "deserves a dedicated focused pass" rather than a rushed
half-sweep in a rotation tick; kept flagged. No disclosure risk in the interim.

### Future development (unchanged)

1. **INV-4 dedicated XC-1 sweep** — the ~15 create/update methods, mechanical with
   `assert_in_org`; the biggest remaining item.
2. **Equipment-kit `optional` feature** — column + migration + `create_equipment_kit`
   wiring (INV-6 flagged half).
3. **`_escape_like` helper** — small DRY cleanup across the search methods.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected (no frontend change) · inventory tests
**142 passed** (all DB-free); the 75 `test_inventory_gaps.py` errors are the known
`db_session`/no-MySQL fixture failures (`pymysql` connection refused at setup),
unchanged by this behavior-neutral sweep.

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (INV-3 maintenance item validation, INV-5 LIKE escape, INV-6
`getattr` guard — all intact). Then took the flagged **INV-4** XC-1 sweep and
applied the B1/B2 lens: which of its FK sites are actually **projected into a
response** (a real read leak) versus dangling-only? Pass 1 had checked one site
(`assign_item_to_user`'s `user_id`) against the _item_ response and cleared it —
but the assignment/checkout/issuance/charge **listings** tell a different story.

### INV2-1 — MED — Member-facing mutations didn't validate `user_id` in-org; the member name leaks via listings — ✅ FIXED

**What:** `assign_item_to_user`, `checkout_item`, and `issue_from_pool` each lock
and org-validate the _item_, but stored the client-supplied **`user_id` with no
in-org check** (`issue_kit_to_member` does the same via delegation).

**Why it's a read leak, not just a dangling FK (correcting pass 1's scope):** the
item response exposes only `assigned_to_user_id` (pass 1's finding), but the
**listing** endpoints format the member name from the record's eager-loaded
`user` — `get_assignments`, the checkout list, the issuance list, and the admin
**charge-management** view all call `_format_user_name(x.user)` (service lines
3016 / 3071 / 3121 / 3557; the charge list is typed `IssuanceChargeListItem` with
a non-optional `user_name`). So an admin who assigns/checks-out/issues an item to
a **foreign `user_id`** causes that other org's member **name (PII)** to render in
these views — the AP2-1 shape, but PII rather than config. A notification is also
queued to the foreign member.

**Fix:** validate the member in-org at the top of all four paths via the shared
`is_in_org(self.db, User, user_id, organization_id)` (chosen over `assert_in_org`
because these methods use a `(None, "message")` return contract, not exceptions —
so a clean `return None, "Member not found"` fits, and the surrounding
`except Exception` isn't relied on for control flow). `issue_kit_to_member`
validates once up front to fail fast; its per-item `issue`/`assign` calls
re-check. 5 unit tests added (`TestMemberOrgValidation`): foreign user rejected on
each of the four paths, plus an ordering guard that item-not-found short-circuits
before the member lookup. The existing assign/checkout tests use a single
`return_value` mock, so the added lookup returns a truthy row and they still pass;
verified 65/65.

### INV-4 remainder — LOW — Non-projected FKs still unvalidated — 🚩 OPEN (narrowed)

With the member-name read leak now closed, the rest of INV-4 is the
**dangling-FK-only** set: `category_id`/`location_id`/`storage_id` on
item/variant/kit/reorder/allowance, and the assignment/issuance/checkout ids on
returns. Verified these are **not** projected by name into any response
(`InventoryItemResponse` exposes scalar `category_id`/`location_id`; the
name-bearing schemas like `LowStockItem`/`UserInventoryItem` are built from
org-scoped aggregation, not from an item's client-supplied FK). So they are
integrity-only, no disclosure — the continued mechanical `assert_in_org` sweep
pass 1 described, now with the read-leak subset carved out and fixed.

### INV2-2 — NIT — ~55 `== True/False  # noqa: E712` suppressions — 🚩 OPEN

`inventory_service.py` carries ~55 `# noqa: E712` comparisons that should be
`.is_(True)`/`.is_(False)` (Pitfall #10). Deliberately **not** swept in this
iteration: they are suppressed (flake8 is clean), and rewriting 55 lines across a
5,700-line file would swamp a security fix with unrelated churn and risk. Recorded
as a standalone cleanup — one focused commit, no behavior change.

---

## Pass 1 (2026-08-06)

**Prefix:** `INV2` · **Iteration:** B3 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/inventory.py` (5,605 L, 116 endpoints incl. 1
WebSocket), `app/services/inventory_service.py` (5,678 L), `labels.py`,
`label_service.py`. No dedicated frontend module (rendered in-app).
**Prior audit:** `docs/module-audit/inventory.md` (iteration 3) — INV-1/INV-2
fixed; INV-3, INV-4, INV-5, INV-6 left open.

---

## Scope

Tier B: worked the four open findings. The security pass had already done a
full line-by-line tenant-isolation read of the service and confirmed auth
coverage (116/116) — re-verified, not re-derived. The two largest files
(~11k lines combined) were reviewed at the finding level, not re-read whole.

## Findings

### INV-3 — MEDIUM — Maintenance record: foreign item + silent no-op — ✅ FIXED

**What:** `create_maintenance_record` took a client `item_id`, wrote the record
with the caller's org, and **never checked the item was in-org**. Worse: when
`is_completed=True`, the item-side update (`condition`, inspection dates) ran
inside `if item:` where `_get_item_locked` returned `None` for a
foreign/missing item — so a record created "completed" against an item the
caller couldn't see **silently updated nothing and still reported success.**

**Why MED (up from the audit's LOW):** the silent no-op is a correctness bug on
a compliance-relevant record (NFPA inspection dates), not just a dangling FK — a
completed inspection that didn't actually update the item's next-due date is a
safety-tracking gap.

**Fix:** validate the item is in-org at the top of the method (a cheap
org-scoped existence query) and return `(None, "Item not found")` — the method's
existing error-return contract — before writing anything. Closes both the XC-1
and the silent no-op. Verified the DB-backed `test_inventory_gaps.py` NFPA test
creates its item in-org first, so the check passes there.

### INV-5 — LOW — `list_reorder_requests` LIKE not wildcard-escaped — ✅ FIXED

`ReorderRequest.item_name.ilike(f"%{search}%")` didn't escape `%`/`_`, unlike
every other search method in the service. A literal `%` in the search box matched
everything. Applied the same
`.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")` the sibling
searches use. (Never an injection — always a bound parameter — just consistent
wildcard behavior now.)

### INV-6 — MEDIUM — Equipment-kit `optional` was a live AttributeError — ✅ FIXED (safe half) / 🚩 FLAGGED (feature)

**What the audit suspected, now confirmed:** `EquipmentKitItem` has **no
`optional` column** (verified against the model and every migration), yet
`issue_kit_to_member` reads `kit_item.optional` at two points.

**Why it's a live bug, not just an unpersisted flag:** both reads sit on
**error-only branches** (`if not item:` and `if err and ...`), and the second
short-circuits on a falsy `err`. So the happy path never touches `.optional` and
kits issue fine — but the moment a kit has a missing underlying item or an issue
fails, `kit_item.optional` raises `AttributeError`, which the outer
`except Exception` swallows into a confusing generic "failed to issue kit"
message. The intended "skip if optional / fail if required" logic never worked.

**Fix (safe, no migration):** `getattr(kit_item, "optional", False)` at both
sites — removes the crash and makes every item required, which is the behavior
the missing column already implied. **Flagged:** persisting a real `optional`
value needs the column + an Alembic migration + wiring it through
`create_equipment_kit` (which currently drops it), so the _feature_ remains a
tracked follow-up.

### INV-4 — LOW — Broad create/update FK-validation gaps (XC-1) — 🚩 FLAGGED (with a verification)

The ~15-method cluster (user_id on assign/checkout/issue/kit; assignment/
issuance/checkout ids on returns; category/location/storage ids on
variants/kits/reorder/allowance; etc.) remains open. **I verified the sub-case
most likely to be a live leak and it is not:** `assign_item_to_user` stores a
client `user_id` on `item.assigned_to_user_id`, and `get_item_by_id`
eager-loads `assigned_to_user` — but the item **response schema exposes only
`assigned_to_user_id`, never the assignee's name/email**, and member-inventory
summaries are org-scoped to the org's own members. So a foreign `user_id` is
**mis-attribution, not a PII disclosure** — the prior audit's classification
holds.

**Why still flagged rather than swept here:** it is a genuine 15-method
mechanical sweep across a 5,700-line service, each site needing the right model,
`allow_none` semantics, and endpoint `ValueError→400` handling. Doing it
half-way in one rotation tick invites errors; it deserves a dedicated focused
pass like AXC-1 got. Recorded as the continued XC-1 sweep for this module.

## Verified good ✅ (re-confirmed)

- Auth coverage 116/116 (the WebSocket authenticates manually, org-scoped);
  service-layer tenant isolation solid on every by-id op; label service
  org-scopes cross-module id lists; no raw SQL; the other searches escape LIKE.
- INV-1 (`get_item_history` AttributeError) and INV-2 (equipment-request
  cross-tenant read) remain fixed.

## Duplication

The LIKE-escape triple-`.replace` is now repeated across ~4 search methods
(INV-5 added the 4th). Minor — a `_escape_like(s)` helper would DRY it, but the
inline form is readable and consistent. Noted, not actioned.

## Dead code

None (vulture clean per prior audit; no TODO/FIXME). The `optional`-branch code
in `issue_kit_to_member` was _latent-broken_, not dead — now made safe.

## Documentation

`docs/module-audit/inventory.md`: INV-3, INV-5, INV-6 now resolved (INV-6's
safe half); INV-4 stands with the read-back verification added.

## Future development

1. **INV-4 dedicated XC-1 sweep** — the biggest remaining item; ~15 create/update
   methods, mechanical with `assert_in_org`.
2. **Equipment-kit `optional` feature** (INV-6 flagged half) — column + migration
   - `create_equipment_kit` wiring, so kit items can actually be optional.
3. **`_escape_like` helper** — small DRY cleanup across the search methods.
4. **No service-level unit tests for the maintenance/kit paths** — the fixes
   here rest on `test_org_scoping.py` and the DB-backed `test_inventory_gaps.py`;
   a targeted test for the maintenance in-org guard and the kit `getattr` guard
   would lock them once MySQL is in CI.

## Completion gate

| Check                | Result                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                                                                                                                                  |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                                                                                                   |
| `black --check`      | ✅ 503 files unchanged                                                                                                                                                                                                                            |
| `eslint`             | ✅ clean                                                                                                                                                                                                                                          |
| backend tests        | ✅ **2517 passed, 0 failed**; 137 inventory-selected tests pass. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. The DB-backed maintenance test creates its item in-org, so the new INV-3 guard is compatible. |

</content>
