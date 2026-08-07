# Application Review — Facilities (Tier B, 2nd pass)

**Prefix:** `FAC2` · **Iteration:** B4 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/facilities.py` (3,553 L, 95 endpoints),
`app/services/facilities_service.py` (2,766 L)
**Frontend:** `modules/facilities`
**Prior audit:** `docs/module-audit/facilities.md` (iteration 4) — FAC-1/FAC-2
fixed; FAC-3 (XC-1 cluster) and FAC-4 (search unexposed) left open.

---

## Scope

Tier B: worked the two open findings. The security pass had done a full
line-by-line tenant-isolation read and confirmed 95/95 permission-gated
endpoints — re-verified, not re-derived.

## Findings

### FAC-3 — LOW — Create/update paths don't validate FK ids in-org (XC-1) — ✅ FIXED (all 7 methods)

A focused, well-enumerated cluster — unlike inventory's INV-4 — so I closed it
in full rather than flagging. The important subtlety was that **not every FK
takes the same validation**:

- **Org-owned entities** (`facility_id`, `system_id`, `assigned_to_user_id`)
  → `assert_in_org` (requires an org match). Applied to `create_photo`,
  `create_document` (facility_id), `create_maintenance_record` +
  `update_maintenance_record` (system_id), `create_access_key` +
  `update_access_key` (assigned_to_user_id).
- **Lookup tables that legitimately hold system rows with `organization_id IS
  NULL`** (`facility_type_id`, `status_id`, `maintenance_type_id`) → the
  module's own `get_facility_type` / `get_facility_status` /
  `get_maintenance_type` getters, which allow the NULL-org system rows.
  **Using `assert_in_org` here would have been a bug** — it would reject every
  default system type/status, breaking legitimate facility creation. `update_facility`
  and `update_maintenance_record` now re-validate these on update, mirroring
  `create_facility`.

**Impact (confirms the audit's rating):** all mis-attribution, not disclosure —
I verified the highest-risk sub-case (`access_key.assigned_to_user_id`) and the
`assigned_to_name` shown in the response is a **caller-supplied stored column**,
not a join from the `User` table, so a foreign `user_id` doesn't leak PII.

**Verification:** every affected endpoint already wraps its service call in
`try/except ValueError → 400` (checked `create_photo` and `update_access_key`
directly; the other five raised `ValueError` before), so the new validation
surfaces as a clean 400 rather than a 500. Coverage rests on
`test_org_scoping.py` (7/7) for `assert_in_org`, and the lookup-getter path is
the same one `create_facility` has always used.

With FAC-3 closed, this is the **third module** to have its create-path XC-1 gap
fully resolved (after apparatus and medical-screening).

### FAC-2b — NIT — `is_primary == True # noqa` — ✅ FIXED

`create_photo`'s primary-photo query used `== True` with an E712 noqa; swapped
to `.is_(True)`, same as the apparatus AP-2 cleanup. No behavior change.

### FAC-4 — LOW — `list_facilities` search wired but not exposed — 🚩 FLAGGED (unchanged)

The service's `list_facilities` accepts a `search` arg (with correct LIKE
escaping), but `GET /facilities` never forwards a `search` query param, so the
branch is unreachable from the API. **Left flagged, deliberately:** wiring it is
a one-line API addition, but it is still an unrequested API-surface change, and
adding a feature nobody asked for during an unattended review is scope creep the
owner should sign off on (does it interact with pagination? should every field
be searchable?). It is *correct* dead-reachability, not a bug — recorded for the
owner, same disposition the prior audit chose.

## Verified good ✅ (re-confirmed)

- 95/95 endpoints permission-gated, no bare `get_current_user`.
- Tenant isolation solid on every by-id op; lookup tables correctly allow
  system rows; `delete_room`'s linked-Location delete is doubly scoped.
- The one search (`list_facilities`) escapes LIKE correctly (the pattern INV-5
  was missing).
- FAC-1 (dead no-op blocks) and FAC-2 (`maintenance_type_id` NOT-NULL guard)
  remain fixed.

## Duplication

The lookup-FK re-validation now appears in both `create_facility` and
`update_facility` (and the maintenance equivalents). That is intentional
symmetry, not accidental duplication — create and update must each validate —
but a shared `_validate_facility_lookups(data, org)` helper would DRY the four
sites if this module is revisited. Noted, not actioned.

## Dead code

None (the FAC-1 no-op blocks were removed in iteration 4). No TODO/FIXME. FAC-4
is unreachable-but-correct code, not dead code to delete.

## Documentation

`docs/module-audit/facilities.md`: FAC-3 now resolved across all listed methods;
FAC-4 stands.

## Future development

1. **Expose `list_facilities` search** (FAC-4) — a small API addition once the
   owner confirms the semantics.
2. **`_validate_facility_lookups` helper** — small DRY cleanup for the
   create/update symmetry.
3. **No facilities-service unit tests for the create/update FK guards** — they
   rest on `test_org_scoping.py` and the module's getter tests; a targeted test
   would lock them once MySQL is in CI.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
