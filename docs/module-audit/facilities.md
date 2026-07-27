# Module Audit — Facilities

**Files:** `app/api/v1/endpoints/facilities.py` (3,553 L, 95 endpoints),
`app/services/facilities_service.py` (2,766 L), model `app/models/facilities.py`,
frontend `modules/facilities`.
**Audited:** iteration 4 (full line-by-line tenant-isolation read of the service
layer + endpoint auth coverage).

## Verified good ✅
- **Auth coverage:** all 95 endpoints carry `require_permission(...)` — 0
  unauthenticated routes, no bare `get_current_user` (every route is
  permission-gated with sensible `.view`/`.manage` scoping).
- **Tenant isolation is solid — no IDOR.** Every by-id
  `get_*`/`update_*`/`delete_*` in the service filters `organization_id`, and
  every update/delete routes through an org-scoped `get_*` first. Lookup tables
  (types/statuses/maintenance-types) additionally allow `organization_id IS NULL`
  system rows — intentional and correct. `delete_room`'s linked-`Location`
  delete is scoped by both `facility_room_id` and `organization_id`.
- **No SQL injection:** no `text()`/f-string/`.format()` SQL. The one search
  (`list_facilities`) escapes `\`, `%`, `_` before building the `ilike` term —
  this is the correct pattern (contrast INV-5).
- **No PK-bypass** (`db.get`/`filter_by(id=)`).
- **Lint:** flake8 clean; no TODO/FIXME markers.

## Findings

### FAC-1 — cleanup — dead no-op "attachment conversion" blocks — ✅ FIXED
Eight create/update methods (maintenance, inspection, capital-project,
insurance-policy × create+update) contained:
```python
# Convert attachment models to dicts for JSON storage
if dump.get("attachments"):
    dump["attachments"] = [a if isinstance(a, dict) else a for a in dump["attachments"]]
```
Both branches of `a if isinstance(a, dict) else a` return `a` unchanged, and
`model_dump()` already produces dicts — so the block is an unconditional no-op
with a misleading comment. Removed all 8 (behavior-preserving; verified compile
+ flake8 clean).

### FAC-2 — LOW correctness/robustness — `maintenance_type_id` NOT NULL vs schema-optional — ✅ FIXED
`FacilityMaintenance.maintenance_type_id` is `nullable=False`, but
`FacilityMaintenanceCreate` declares it `Optional[str] = None`, and
`create_maintenance_record` only validated it "if provided." A caller omitting
it produced a DB `IntegrityError` → generic 500 at insert time.
**Fix:** guard at the top of the create path — `raise ValueError` (→ clean 400)
when `maintenance_type_id` is missing, then validate it resolves in-org. Success
path unchanged (the column has always required a value, so no existing row could
have been created without one). The Update schema stays optional (correct).

### FAC-3 — LOW — Create/update paths don't validate referenced FK ids are in-org (XC-1 class)
Client-supplied FK ids stored without an in-org check:
- `create_photo` / `create_document` — `facility_id` stored with no `get_facility`
  ownership check (every other child-create verifies the facility).
- `create_maintenance_record` — `system_id` stored unverified (facility +
  maintenance-type are verified).
- `create_access_key` — `assigned_to_user_id` stored unverified.
- `update_facility` — applies `facility_type_id` / `status_id` from the payload
  via `setattr` with no re-validation (unlike `create_facility`).
- `update_maintenance_record` — applies `maintenance_type_id` / `system_id`
  unverified; `update_access_key` sets `assigned_to_user_id` unverified.

Writes are org-stamped, so a bad FK is a dangling/mis-attributed reference, not
a cross-tenant read. **Status:** flagged (XC-1) — best closed by the shared
`assert_in_org` helper rather than per-method patches.

### FAC-4 — LOW (unused capability) — `list_facilities` search not exposed
The service's `list_facilities` supports a `search` argument (with correct LIKE
escaping), but the `GET /facilities` endpoint never accepts/forwards a `search`
query param — the search branch is unreachable from the API. Not a bug; a
wired-but-unexposed feature. **Status:** flagged (adding the query param is a
small API addition, left for deliberate feature work rather than auto-applied).

## Notes
- No wrong-attribute bugs. `_sync_room_location` was verified against
  `app/models/location.py` — all referenced fields exist.
