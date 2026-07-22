# Module Audit — Apparatus

**Files:** `app/api/v1/endpoints/apparatus.py` (2,980 L, 83 endpoints),
`app/services/apparatus_service.py` (2,395 L), `evoc_level_service.py` (329 L),
frontend `modules/apparatus`.
**Audited:** iteration 2 (large module — audit focused on security/correctness
invariants, not line-by-line of all 5.7k lines).

## Verified good ✅
- **Auth coverage:** all 83 endpoints carry an auth dependency
  (`require_permission` / `require_all_permissions` / `get_current_user`) — no
  unauthenticated endpoint.
- **Tenant isolation:** every by-ID equality query (17 found) filters
  `organization_id`; no `db.get()`/`filter_by(id=)` PK-bypass patterns. Sub-
  resources (photos, documents, maintenance types/records, EVOC levels) each
  carry their own `organization_id` and are queried with
  `apparatus_id == X AND organization_id == caller_org` — no IDOR via a child
  resource id.
- **No SQL injection:** no `text()` / f-string / `.format()` query building.
- **Lint:** flake8 clean across all three files.

## Findings

### AP-1 — LOW — Create paths don't validate referenced parent belongs to org
`create_photo` / `create_document` (and similar maintenance-record creates) set
`organization_id` from the caller but do not verify the referenced
`apparatus_id` belongs to that org. Not a disclosure — the child is scoped to
the caller's org, and `list_*` filters by both `apparatus_id` and org, so a
child pointing at a foreign `apparatus_id` is an orphan, not a leak — but it's a
data-integrity / mis-attribution gap.
**Status:** flagged (see cross-cutting note below). Not auto-fixed — adding FK
org-validation is a behavior change that needs a shared helper + tests.

## Cross-cutting note (spans modules)
This is the **second** module (after medical-screening MS-3) where a create
endpoint trusts a client-supplied foreign-key id without checking it belongs to
the caller's organization. Worth treating as a **systemic pattern**: a shared
`assert_in_org(db, Model, id, org_id)` helper used by create/update paths across
services would close this class uniformly. Tracking in
`docs/module-audit/CROSS-CUTTING.md`.

## Notes
- Service docstrings are present but terse ("Create photo", "Delete photo") —
  acceptable; not flagged.
- `create_photo` uses `== True` with `# noqa: E712`; harmless, could be `.is_(True)`.
- Vulture-style "unused function" hits on apparatus endpoints are false positives
  (they're live routes referenced only by decorators).
