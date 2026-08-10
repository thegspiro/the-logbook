# Application Review — Equipment Check / Shift Completion (Tier B)

**Prefix:** `EC2` · **Iteration:** B7 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

---

## Pass 4 (2026-08-09) — invariants re-verified; no code change

Pass 3 closed the substantive items (EC2-4 read-leak, EC2-3 write-side FK
validation, the three latent-500 endpoints, EC2-5 E712). Pass 4 confirmed the
landed state holds:

- **EC2-4 read-leak fix intact** — the `item_names` lookup still filters
  `InventoryItem.organization_id == organization_id` (service ~1361), so a foreign
  `inventory_item_id` resolves to no name.
- **EC2-3 write-side FK validation intact** — `_validate_item_fks`
  (`inventory_item_id` + `equipment_id` via `is_in_org`/`assert_in_org`) is present
  (8 FK-validation refs), and `_get_compartment` gates `parent_compartment_id`.
- **E712-free** — 0 `# noqa: E712` in both `equipment_check_service.py` and
  `shift_completion_service.py`.

Open items unchanged: **EC-11** (compliance-cadence model — a feature) and **EC-7
residual** (whether submit endpoints should require `equipment_check.submit` — an
owner intra-org permission call). Neither is a defect.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a · `test_equipment_check_service.py` **12 passed** (DB-free).

---

## Pass 3 (2026-08-09) — a read-leak pass 2 misclassified; EC2-3 closed

Re-verifying EC2-3 (which pass 2 called "integrity-only, not projected by name")
found that one of its FKs **is** projected by name — an actual cross-tenant read
leak, not a dangling reference. Fixed that plus the write-side sweep.

### EC2-4 — MED — Foreign `inventory_item_id` leaks the item name into the checklist — ✅ FIXED

**What pass 2 missed:** `get_my_checklists` resolves each item's `inventory_item_id`
to an `inventory_item_name` in the response (service ~1337). The adjacent
`apparatus_names` lookup filters `organization_id`, but the **`item_names`
(InventoryItem) lookup did not** — and `inventory_item_id` is a client-supplied FK
that `add_item`/`update_item` store **raw** through their generic constructors/setattr
loops (only `compartment_id` was validated, per EC2-2). So a manager who sets an
item's `inventory_item_id` to another org's inventory item causes that org's item
**name** to render in the checklist every member on the shift sees — the EC2-1 shape,
which pass 2 had ruled out for this FK.

**Fix (two layers, mirroring EC2-1):**
1. *The leak:* the `item_names` lookup now filters
   `InventoryItem.organization_id == organization_id` — a foreign id resolves to no
   name. This is the definitive guard regardless of how a bad id was stored.
2. *Write side (EC2-3, now closed):* a new `_validate_item_fks` validates
   `inventory_item_id` **and** `equipment_id` in-org (via `is_in_org`) on `add_item`,
   `update_item`, and `add_compartment`'s nested-item path; `parent_compartment_id`
   is validated via the org-scoped `_get_compartment` on `add_compartment` /
   `update_compartment`.

**Latent-500 corrected along the way:** the `add_compartment`, `update_compartment`,
and `add_item` **endpoints had no `ValueError` handling** (only `update_item` did), so
the new guards — and any pre-existing service `ValueError` — would have surfaced as
500s. All three gained the module-standard `except ValueError → 400 + safe_error_detail`
(the same latent-500 class pass 2 fixed on `update_template`). **6 tests added**
(`TestItemFkValidation`, `TestCompartmentParentValidation`); the module's existing
equipment-check service tests still pass.

### EC2-5 — NIT — 2 `== True  # noqa: E712` in shift_completion swept — ✅ FIXED

`shift_completion_service.py` carried 2 boolean-column E712 suppressions
(`User.is_active`, `SkillEvaluation.active`); converted to `.is_(True)`. The main
`equipment_check_service.py` was already E712-free.

### Still flagged (unchanged)

- **EC-11** — compliance metrics (`checks_expected`/`overdue_count`) hardcoded to 0;
  needs an expected-check-cadence model (feature).
- **EC-7 residual** — the submit endpoints keep bare `get_current_user` (each
  org-scopes its target); whether writes should require `equipment_check.submit` is
  the owner's intra-org permission call.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · `test_equipment_check_service.py`
**12 passed** (6 + 6 new) + sibling equipment tests 18 passed (all DB-free; the
shift_completion `db_session` errors are the known no-MySQL fixture failures).

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (EC-8 by-id reads, EC-1…EC-10 all intact; EC-11 still a
flagged feature). Then applied the B2/B4 update-bypass lens to the template CRUD
— the create/clone paths validate their apparatus in-org, so the question was
whether the **update** paths, which share one generic `setattr` loop, do too.
They did not, in two different ways.

### EC2-1 — MED — `update_template` re-parents to a foreign apparatus → apparatus-name leak — ✅ FIXED

`create_template`/`clone_template` validate the apparatus is in-org, but
`update_template` applied `EquipmentCheckTemplateUpdate` (which **exposes
`apparatus_id`**) through a `setattr` loop guarded only by `PROTECTED_FIELDS`
(`{id, organization_id, created_at, updated_at, created_by}` — **not**
`apparatus_id`). So `PUT /templates/{id}` with a foreign `apparatus_id` stored it,
and the checklist/supply listings (`get_my_checklists`, `get_supply_overview`)
resolve `apparatus_id` to an apparatus **name** via a lookup that had **no org
filter** — so the foreign org's apparatus name read back. The AP2-1 shape.

**Fixed both layers:** `update_template` validates a reassigned `apparatus_id`
via the shared `is_in_org` (None clears it — a generic template); and both
`apparatus_name` lookups now filter `Apparatus.organization_id == organization_id`
(defense-in-depth, so no stray foreign id ever resolves a name). The
`update_template` **endpoint had no `ValueError` handling** — the guard would have
surfaced as a 500 — so it (and `update_item`) gained the module's standard
`except ValueError → 400 + safe_error_detail`, matching `create_template`/
`clone_template`. (Same latent-500 class pass 1 found on MM-1.)

### EC2-2 — MED — `update_item` re-parents an item into another org's checklist (cross-org write) — ✅ FIXED

`CheckTemplateItemUpdate` exposes `compartment_id`, and `update_item` ran it
through the same unguarded `setattr` loop. A check item has **no
`organization_id` of its own** — it is org-scoped only via
`compartment → template`. So setting `compartment_id` to a **foreign** org's
compartment doesn't dangle: it **transfers the item out of the caller's org and
into the target org's checklist**, carrying the caller's `name`/`description`/
`serial_number`. That is a cross-tenant *write* (checklist tampering), a step
beyond EC2-1's read leak. **Fixed:** `update_item` validates a reassigned
`compartment_id` via the org-scoped `_get_compartment` before re-parenting.

### EC2-3 — LOW — Remaining dangling FKs on the same setattr loop — 🚩 OPEN

The other client FKs reachable through the item/compartment update loops —
`inventory_item_id` and `equipment_id` on items, `parent_compartment_id` on
compartments — are **not** validated either, but they are integrity-only: none
moves the row's org membership (unlike `compartment_id`) and none is projected by
name into a response (the responses carry scalar ids). Same dangling-FK class as
AP2-2 / INV-4-remainder; recommend a defense-in-depth sweep validating them via
the org-scoped getters. No disclosure or cross-org write in the interim.

### EC-7 residual (submit endpoints on bare auth) — unchanged

`submit_check` / `submit_standalone_check` / `complete_incomplete_check` still
gate on `get_current_user` (any member), not `equipment_check.submit`. Re-confirmed
each org-scopes its target (shift/template/apparatus), so this is an **intra-org
permission-granularity** decision, not a cross-tenant hole — left as the owner call
pass 1 recorded, deliberately not reopened.

---

## Pass 1 (2026-08-06)

**Prefix:** `EC2` · **Iteration:** B7 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/equipment_check.py` (34), `endpoints/shift_completion.py`
(21), `services/equipment_check_service.py`, `shift_completion_service.py`,
`equipment_check_pdf.py`
**Prior audit:** `docs/module-audit/equipment-check.md` — the heaviest audit
iteration (EC-1…EC-5 real cross-tenant writes, all fixed). EC-8 (unscoped
by-id changelog reads) and EC-11 (compliance metrics stubbed) left open.

---

## Scope

Tier B: the two open findings. The security pass had already found and fixed the
genuine cross-tenant writes (EC-1/EC-2 apparatus-deficiency and template-item
write-back, EC-3 viewer-writable swap, EC-4 clone XC-3) — re-verified those are
intact, worked the residual.

## Findings

### EC-8 — LOW — Unscoped by-id reads for changelog metadata — ✅ FIXED (the two real cases)

The prior audit listed four endpoints (`delete_compartment`, `delete_item`,
`add_item`, `update_item`) that read a row by id with no org filter to build
changelog text. Working through them, they split into two kinds:

- **Read-before-validate** (`delete_compartment`, `delete_item`): the raw
  `select(...).where(id == x)` ran *before* the org-scoped mutation. I verified
  this was already harmless — the changelog is written only after
  `if not deleted: raise 404`, so a foreign id's transient read is always
  discarded — but org-scoped the reads anyway, reusing the service's own
  `_get_compartment` / `_get_item` getters (template-join, org-filtered). Now a
  foreign id never loads at all.
- **Read-after-validate** (`add_item`, `update_item`): these read the
  compartment's `template_id` *after* an org-scoped `service.add_item` /
  `update_item` succeeded, so the id is already proven in-org. Not an EC-8
  exposure — left as-is, noted here so the distinction is on record rather than
  re-investigated.

With the two genuine cases closed, **every by-id read in this module is now
org-scoped** — no exceptions for the next reader to reason about, which is the
value of closing an explicitly-harmless finding.

### EC-11 — LOW — Compliance metrics hardcoded — 🚩 FLAGGED (feature, unchanged)

`get_compliance_report` still returns `checks_expected = 0` and
`overdue_count = 0`. This is unchanged and correctly deferred: computing them
needs an **expected-check-cadence model** (how often each apparatus is supposed
to be checked) that doesn't exist in the schema. It is an incomplete feature, not
a defect — a real design task (a per-apparatus/per-template cadence field + a
scheduler comparison), not a review-time fix.

## Verified good ✅ (re-confirmed)

- The EC-1…EC-5 fixes are intact: `_update_apparatus_deficiency` and
  `_load_template_items_map` are org-scoped, `swap_item_lot` is
  permission-gated, `clone_template` org-resolves its target apparatus.
- EC-6 (trainee_id org-validated when shift absent), EC-7 (read endpoints now
  `equipment_check.view OR .submit`), EC-9 (`get_report` org-filtered), EC-10
  (completion path re-applies the auto-fail rule) all remain fixed.
- 55/55 endpoints authenticated.

## Duplication

None introduced. Reusing `_get_compartment`/`_get_item` in the endpoints
*removed* two inline raw-select duplications of logic the service already owned.

## Dead code

None; no TODO/FIXME.

## Documentation

`docs/module-audit/equipment-check.md`: EC-8 now resolved (the two real cases);
EC-11 stands as a flagged feature.

## Future development

1. **Expected-check-cadence model** (EC-11) — the one substantive open item in
   this module. A per-template or per-apparatus "expected every N days" field
   would let `get_compliance_report` compute real `checks_expected` /
   `overdue_count` instead of zeros. This is also what the A3 finding about
   task-run observability would consume.
2. **A submit-permission gate on the write endpoints** (noted in EC-7's
   resolution as a separate deliberate decision) — the submit endpoints keep
   bare authentication; whether writes should require `equipment_check.submit`
   is an owner call.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**. 648 errors, all `db_session` fixture (no MySQL). |
</content>
