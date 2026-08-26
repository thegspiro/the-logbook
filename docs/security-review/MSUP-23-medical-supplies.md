# Security Review — Medical Supplies

**Prefix:** `MSUP` · **Iteration:** 23 · **Reviewed:** 2026-08-26 · **PR:** TBD

**Backend:** `app/api/v1/endpoints/medical_supplies.py` (667 L, 15 endpoints).
No dedicated service — every route delegates to the already-audited
`InventoryService` (`app/services/inventory_service.py`, ~7,450 L, covered in
full by `docs/security-review/INV-11-inventory.md`).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — this iteration's fix is a service-layer null-handling
change only.

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

## Completion gate

| Check                                                | Result                               |
| ---------------------------------------------------- | ------------------------------------ |
| `flake8` (changed files)                             | clean                                |
| `black --check` (changed files)                      | clean                                |
| `isort --check-only` (changed files)                 | clean                                |
| `python3 scripts/validate_migrations.py --strict`    | PASSED (no migrations)               |
| backend tests, scope (`inventory` + `medical_suppl`) | 553 passed, 1 skipped (pre-existing) |
| backend tests, full suite                            | pending                              |
