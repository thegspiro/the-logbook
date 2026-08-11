# Application Review — Inventory (Tier B)

**Prefix:** `INV2` · **Iteration:** B3 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-08-11 (follow-up)

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
sub-agent) confirmed every FK target *is* org-scoped and validatable, and that the
read-leak subset (member `user_id` via listings) was already closed in INV2-1 —
so these were integrity-only, which is why they were safe to leave flagged until a
focused pass. Now fixed:

| Method | FK(s) now validated in-org | Target model |
|---|---|---|
| `create_category` / `update_category` | `parent_category_id` | `InventoryCategory` |
| `create_item` / `update_item` | `location_id`, `storage_area_id`, `variant_group_id`, `assigned_to_user_id` | `Location`, `StorageArea`, `ItemVariantGroup`, `User` |
| `create_maintenance_record` / `update_maintenance_record` | `performed_by` | `User` |
| `create_write_off_request` | `clearance_id` | `DepartureClearance` |
| `create_size_variants` | `category_id`, `location_id`, `storage_area_id` | `InventoryCategory`, `Location`, `StorageArea` |
| `create_return_request` | `assignment_id`, `issuance_id`, `checkout_id` | `ItemAssignment`, `ItemIssuance`, `CheckOutRecord` |
| `create_reorder_request` / `update_reorder_request` | `item_id`, `category_id` | `InventoryItem`, `InventoryCategory` |
| `create_equipment_kit` | line-item `item_id`, `category_id` | `InventoryItem`, `InventoryCategory` |
| `create_reorder_from_plan` | `stock_category_id` | `InventoryCategory` |

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
(`assign_item_to_user`'s `user_id`) against the *item* response and cleared it —
but the assignment/checkout/issuance/charge **listings** tell a different story.

### INV2-1 — MED — Member-facing mutations didn't validate `user_id` in-org; the member name leaks via listings — ✅ FIXED

**What:** `assign_item_to_user`, `checkout_item`, and `issue_from_pool` each lock
and org-validate the *item*, but stored the client-supplied **`user_id` with no
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
`create_equipment_kit` (which currently drops it), so the *feature* remains a
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
in `issue_kit_to_member` was *latent-broken*, not dead — now made safe.

## Documentation

`docs/module-audit/inventory.md`: INV-3, INV-5, INV-6 now resolved (INV-6's
safe half); INV-4 stands with the read-back verification added.

## Future development

1. **INV-4 dedicated XC-1 sweep** — the biggest remaining item; ~15 create/update
   methods, mechanical with `assert_in_org`.
2. **Equipment-kit `optional` feature** (INV-6 flagged half) — column + migration
   + `create_equipment_kit` wiring, so kit items can actually be optional.
3. **`_escape_like` helper** — small DRY cleanup across the search methods.
4. **No service-level unit tests for the maintenance/kit paths** — the fixes
   here rest on `test_org_scoping.py` and the DB-backed `test_inventory_gaps.py`;
   a targeted test for the maintenance in-org guard and the kit `getattr` guard
   would lock them once MySQL is in CI.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**; 137 inventory-selected tests pass. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. The DB-backed maintenance test creates its item in-org, so the new INV-3 guard is compatible. |
</content>
