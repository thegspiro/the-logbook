# Application Review — Inventory (Tier B, 2nd pass)

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
