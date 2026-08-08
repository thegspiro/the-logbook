# Application Review — Inventory (Tier B)

**Prefix:** `INV2` · **Iteration:** B3 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2)

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
