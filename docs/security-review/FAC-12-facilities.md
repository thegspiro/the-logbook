# Security Review 12 — Facilities

**Prefix:** `FAC` · **Iteration:** 12 · **Reviewed:** 2026-08-26 · **PR:** (opened this iteration)

**Backend:** `api/v1/endpoints/facilities.py` (98 routes), `services/facilities_service.py`
(~3,290 L), model `app/models/facilities.py`
**Frontend:** `modules/facilities`
**Migrations:** none this iteration (no schema change)

---

## Scope

This is the most heavily audited state this rotation has inherited for any
feature so far: module-audit iteration 4, four app-review Tier B passes
(2026-08-06/06/09/09), and a full "advertised vs. delivered" product-delivery
pass (2026-08-20) that closed five more items (FAC-P2/P6/P7/P9 plus
re-verification). Every prior security finding (FAC-1 through FAC-5) was
already ✅ fixed; only FAC-4 (search wired but not exposed — a deliberate,
non-security, owner-decision item) was left open.

Re-verified rather than re-derived: `_assert_facility_in_org` wiring (FAC-3 +
FAC2-1's XC-1 closure — 10 call sites, matching the app-review pass 4 count
exactly), the FAC-5 sensitive-family gate (`facilities.view_sensitive` /
`.edit` / `.manage` on all 5 sensitive families' list+get routes — 10
occurrences, matching), and the LIKE-escaping fix (`Facility.name`/
`.facility_number`/`.city` all pass `escape=LIKE_ESCAPE_CHAR`, the SEC-00
invariant).

**Growth since the last full read:** `facilities.py` grew from 95 to 98
routes. Two are the `/dashboard`+`/page` split from FAC-P2 (2026-08-20,
already covered by that pass). The third, `GET /{facility_id}/folders`, is
new since any prior pass and was read in full below — it bridges to the
generic Documents module (`DocumentFolder`/`Document`), the first
cross-module integration point this feature has ever had, so it got the
most scrutiny this iteration.

## Route inventory

98/98 routes carry `require_permission`/`require_all_permissions` — 0 bare
`get_current_user`, 0 unauthenticated (verified by exact count:
`grep -c 'require_permission(\|require_all_permissions('` returns 98,
matching the route count 1:1). Permission distribution: 27 `.manage`-only
(deletes + admin-only mutations), 26 `.view`/`.manage` (operational reads —
rooms, systems, maintenance, inspections, emergency contacts, shutoffs,
compliance, dashboard/page/types/statuses), 16 `.edit`/`.manage` (operational
writes), 15 `.create`/`.edit`/`.manage` (operational creates), and the 10
sensitive-family reads on `.view_sensitive`/`.edit`/`.manage` (access keys,
utility accounts + readings, capital projects, insurance policies,
occupants) — this last group is FAC-5, re-verified intact.

### `GET /{facility_id}/folders` (new, first review)

Read in full, including its two service dependencies
(`DocumentsService.ensure_facility_folder`/`get_facility_sub_folders`).
Gated on `facilities.view`/`.manage`. The facility itself is fetched
org-scoped first (`get_facility(facility_id, organization_id=...)`, 404 on
miss) before any folder work runs; every downstream folder query filters
`DocumentFolder.organization_id == organization_id` and then walks
parent-child links server-side (`facilities-root → facility-{id} →
sub-folders`) — no client-supplied folder id is ever accepted, so there is
no IDOR surface here.

**Cross-module ACL boundary, verified intact:** this endpoint returns only
folder metadata and a per-folder `document_count`; it does not return
document contents or ids. Reading the documents actually inside a folder
still requires `documents.view` (`documents.py`'s `list_documents`,
independently permission-gated) — a `facilities.view` holder without
`documents.view` can see that, say, the "Insurance & Leases" sub-folder has
3 documents, but cannot list or open them. This mirrors the vendor
list/item-catalog redaction pattern elsewhere in this rotation (show the
container, redact the sensitive content) rather than being a gap: the
folder names are fixed, deterministic labels created for every facility
(not user input), and a bare count carries materially less information than
the record data DOC-4/DOC-5 (still open in the Documents review) are
actually about. Not a finding — verified acceptable design, not re-derived
from either module's own doc.

## Verified good ✅

- **Auth coverage 98/98**, 0 bare `get_current_user`, enumerated above by
  exact grep count rather than sampled.
- **FAC-3/FAC2-1 (XC-1 FK-validation) still closed** — `_assert_facility_in_org`
  present at all 10 previously-documented call sites; the lookup-table
  exception (facility type/status/maintenance-type, which legitimately allow
  `organization_id IS NULL` system rows) is unchanged and still the correct
  design, not a gap.
- **FAC-5 (HIGH, sensitive-family gating) still closed** — all 5 sensitive
  families' list+get routes require `facilities.view_sensitive`/`.edit`/
  `.manage`, not the baseline `.view`; `backend/tests/test_facilities_permissions.py`
  (route-dependency introspection) still exists and covers this.
- **No raw SQL, LIKE search escaped** — the only search (`list_facilities`)
  uses `escape=LIKE_ESCAPE_CHAR` on all three ilike'd columns.
- **New cross-module folder integration is org-scoped and IDOR-safe**, and
  does not leak document content across the `documents.view`/`facilities.view`
  permission boundary (see above).
- **Lint:** flake8 clean, no TODO/FIXME.

## Findings

No new findings. FAC-4 (search wired but not exposed) remains open,
unchanged, and is not a security defect — already documented in
`docs/app-review/facilities.md` as a deliberate owner-decision item, not
re-flagged here.

## Schema & migration notes

No schema changes. Re-confirmed from prior passes: `FacilityMaintenance.maintenance_type_id`
is `nullable=False` with the FAC-2 create-time guard still in place; no
`SET NULL` FK nullability issues found.

## Guard tests added

None — no code changed this iteration. Existing guards
(`test_facilities_permissions.py`, `test_facilities_service.py`,
`test_org_scoping.py`) already cover every invariant re-verified above.

## Completion gate

| Check                                             | Result                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations (no files changed)                              |
| `black --check app/ tests/ alembic/`              | ✅ clean (no files changed)                                     |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (no files changed)                                     |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change                                |
| `pytest tests/ -k facilities`                     | ✅ 54 passed, 1 skipped (pre-existing optional-dependency skip) |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change                                        |
