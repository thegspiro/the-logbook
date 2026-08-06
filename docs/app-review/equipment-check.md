# Application Review — Equipment Check / Shift Completion (Tier B, 2nd pass)

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
