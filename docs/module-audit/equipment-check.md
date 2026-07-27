# Module Audit — Equipment Check / Shift Completion

**Files:** `app/api/v1/endpoints/equipment_check.py` (1,280 L, 34 endpoints),
`app/api/v1/endpoints/shift_completion.py` (707 L, 21 endpoints),
`app/services/equipment_check_service.py` (2,245 L),
`app/services/shift_completion_service.py` (1,477 L),
`app/services/equipment_check_pdf.py`, model `app/models/apparatus.py`.
**Audited:** iteration 7 (full read of all four files + XC-1/XC-3 lens). This
was the heaviest iteration — the check-submission path had genuine cross-tenant
writes.

## Verified good ✅
- **Auth coverage:** all 55 endpoints authenticated.
- **Template / compartment / item CRUD is org-scoped** via the template join
  (`get_template`, `_get_compartment`, `_get_item`).
- **Report review workflow org-scoped:** `review_report`, `update_report`,
  `acknowledge_report`, `get_reports_by_status`, analytics all filter org.
- **Photo upload** joins `ShiftEquipmentCheck.organization_id`.
- **Model attribute accesses all valid** (verified against `apparatus.py`,
  `training.py`, `user.py`).

## Findings

### EC-1 — HIGH — Cross-org apparatus deficiency write via standalone check — ✅ FIXED
`submit_standalone_check` took a client-supplied `apparatus_id` and never
validated its org; it was stored on the check and passed to
`_update_apparatus_deficiency`, which fetched `Apparatus` by id **with no org
filter** and flipped `has_deficiency` / `deficiency_since`. Any authenticated
user could mark another department's apparatus deficient (or clear a real
deficiency) — a safety-relevant cross-tenant write.
**Fix:** (a) org-scoped `_update_apparatus_deficiency` (`Apparatus.id == x AND
organization_id == caller`) so a foreign id can never be mutated — the critical
guard; (b) validate a client-supplied `apparatus_id` in-org at submit time
(reject otherwise) to prevent even storing a foreign FK on the check.

### EC-2 — MEDIUM — `submit_check` cross-org template-item write-back — ✅ FIXED
`_load_template_items_map` loaded `CheckTemplateItem` rows by id with **no org
filter**, and `_create_check_items` writes `serial_found`/`lot_found` back onto
those rows. A caller submitting foreign `template_item_id`s could overwrite
serial/lot numbers on another org's template items (`submit_check` also never
validated `template_id` org, unlike `submit_standalone_check`).
**Fix:** org-scoped `_load_template_items_map` via the
`CheckTemplateItem → CheckTemplateCompartment → EquipmentCheckTemplate`
(organization_id) join, so a foreign `template_item_id` never resolves to a
loaded record and can't be written back to. Applied to both submit paths.

### EC-3 — MEDIUM — `swap_item_lot` was a viewer-accessible inventory write — ✅ FIXED
`POST /items/{id}/swap` decrements `InventoryLot.quantity` and mutates the
deployed item's lot/expiration, but required only `get_current_user` — any
member could consume ready stock / swap lots. (The service body itself is
org-scoped, so this was a privilege gap, not IDOR.)
**Fix:** gated behind `require_permission("equipment_check.manage",
"inventory.manage")`, mirroring the dual-permission style of the companion GET
at write level.

### EC-4 — MEDIUM — `clone_template` attached the clone to an unvalidated apparatus — ✅ FIXED
`clone_template` (`equipment_check.manage`) looked up
`Apparatus.id == target_apparatus_id` with **no org filter** and persisted it as
the new template's `apparatus_id` — the XC-3 pattern (manager relies only on the
permission; target object not org-resolved). An org-A manager could point a
clone at org-B's apparatus id.
**Fix:** org-scoped the apparatus lookup and raise `ValueError` (→ 400) when the
target apparatus isn't in the caller's org.

### EC-5 — LOW — Unescaped LIKE in failed-item search — ✅ FIXED (prior commit)
`item_name.ilike(f"%{item_name}%")` didn't escape `%`/`_`. Fixed by escaping and
declaring `escape="\\"` (committed separately at the start of this iteration).

### EC-6 — MED/LOW — ✅ FIXED — `create_report` didn't validate `trainee_id` org when `shift_id` is absent (XC-1)
When `shift_id` is None, the shift/attendance/assignment block is skipped, so a
client-supplied `trainee_id` was never tied to the caller's org (the report +
`SkillCheckoff` rows stored a possibly-foreign `user_id`).
**Fix:** the `shift_id`-absent branch now validates that `trainee_id` is a user
in the caller's org (`User.id == trainee_id AND organization_id == org`) before
the report is created, raising "Trainee not found in this organization"
otherwise. The `shift_id`-present path already tied the trainee via
attendance/assignment. **Status:** fixed.

### EC-7 — LOW — Detail/read endpoints bypass `equipment_check.view`
`get_check`, `get_shift_checks`, `get_item_history`, `get_last_check_results`,
`get_shift_checklists` use `get_current_user` (not `require_permission("equipment_check.view")`),
while the list endpoints require it. All are org-scoped (not cross-tenant), so
this is an internal permission inconsistency — a member without the view
permission can still read completed checks/failure notes.
**Status:** flagged — tightening read permissions is a behavior change that could
break legitimate member access; needs a deliberate decision, not auto-applied.

### EC-8 — LOW — Endpoint-level unscoped by-id reads (changelog metadata only)
`delete_compartment`, `delete_item`, `add_item`, `update_item` read the target
row by id with no org filter, but only to build changelog text (never returned)
and the mutation itself is org-scoped. Harmless today; defense-in-depth would add
the org filter. **Status:** flagged.

### EC-9 — LOW — ✅ FIXED — `get_report` has no org filter (fragile)
`select(ShiftCompletionReport).where(id == report_id)` had no org constraint —
safe only because every caller re-checked `organization_id` afterward, an IDOR
waiting for a forgetful caller.
**Fix:** `get_report` now takes an optional `organization_id` and filters on it
when provided; every caller (the three internal mutation paths and the
`GET /shift-completion/{id}` endpoint) now passes the caller's org, so the getter
itself is org-scoped rather than relying on downstream re-checks. **Status:** fixed.

### EC-10 — LOW correctness — ✅ FIXED — `complete_incomplete_check` skipped the auto-fail rule
Initial submit force-fails items that are expired / below `required_quantity`
(`_compute_check_status`), but the completion path recomputed from `item.status`
directly and didn't re-apply that rule, so `failed_items`/`overall_status` could
under-count a safety-critical shortfall as passing.
**Fix:** `complete_incomplete_check` now applies the same auto-fail rule to the
check's items (expired → fail; found < required → fail) before computing the
aggregate counts, matching the initial-submit path. **Status:** fixed.

### EC-11 — LOW (flagged) — Compliance metrics hardcoded
`get_compliance_report` always returns `checks_expected = 0` and
`overdue_count = 0`. These need an expected-check-cadence model (how often each
apparatus is *supposed* to be checked) that doesn't exist yet — an incomplete
feature, not a bug. **Status:** flagged (feature, not a LOW fix). EC-7
(read-permission tightening — deferred behavior change) and EC-8 (changelog-only
unscoped by-id reads — harmless defense-in-depth) remain flagged as above.

## Notes
- `shift_completion_service` uses `func.date_format` (MySQL-specific) but fully
  parameterized — not an injection concern.
- XC-3 recurred here (EC-4) — added to the cross-cutting tally.
