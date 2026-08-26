# Security Review 12 — Facilities

**Prefix:** `FAC` · **Iteration:** 12 · **Reviewed:** 2026-08-26 · **PR:** [#1836](https://github.com/thegspiro/the-logbook/pull/1836)

**Backend:** `api/v1/endpoints/facilities.py` (98 routes), `services/facilities_service.py`
(~3,290 L), `services/documents_service.py` (the new folder-bridge methods),
model `app/models/facilities.py`
**Frontend:** `modules/facilities`
**Migrations:** none this iteration (no schema change)

---

## Revision note

First drafted as "no new findings, no code changes" — a re-verification pass
that confirmed FAC-1 through FAC-5 still hold and read the one new surface
(`GET /{facility_id}/folders`) without finding a defect in it. **A Codex
review of that draft PR caught five real issues**, four of them genuine bugs
the draft missed entirely and one a stale claim (FAC-4) the draft carried
forward without re-checking current code — exactly the kind of drift this
rotation exists to catch, this time in its own output. All five verified and
fixed below. This is the same shape as MP-08's draft-vs-final split: an
initial "clean" pass that under-scrutinized, corrected by review before
merge.

## Scope

This is the most heavily audited state this rotation has inherited for any
feature so far: module-audit iteration 4, four app-review Tier B passes
(2026-08-06/06/09/09), and a full "advertised vs. delivered" product-delivery
pass (2026-08-20). Every prior security finding (FAC-1 through FAC-5,
including the HIGH-severity FAC-5 sensitive-family gate) re-verified intact —
that part of the draft held.

**Growth since the last full read:** `facilities.py` grew from 95 to 98
routes. Two are the `/dashboard`+`/page` split from FAC-P2 (2026-08-20,
already covered by that pass). The third, `GET /{facility_id}/folders`, is
new since any prior pass — a bridge to the generic Documents module
(`DocumentFolder`/`Document`), the first cross-module integration point this
feature has ever had. The draft read it for IDOR and org-scoping and found
neither issue (both genuinely clean — see below); it did not look at
concurrency safety or the ACL shape of the aggregate `document_count` it
returns, which is where FAC-6 and FAC-9 were.

## Route inventory

98/98 routes carry `require_permission`/`require_all_permissions` — 0 bare
`get_current_user`, 0 unauthenticated (verified by exact count:
`grep -c 'require_permission(\|require_all_permissions('` returns 98,
matching the route count 1:1). Permission distribution: 27 `.manage`-only
(deletes + admin-only mutations), 26 `.view`/`.manage` (operational reads),
16 `.edit`/`.manage` (operational writes), 15 `.create`/`.edit`/`.manage`
(operational creates), and the 10 sensitive-family reads on
`.view_sensitive`/`.edit`/`.manage` (access keys, utility accounts + readings,
capital projects, insurance policies, occupants) — FAC-5, re-verified intact.

### `GET /{facility_id}/folders`

Gated on `facilities.view`/`.manage`. The facility itself is fetched
org-scoped first (404 on miss) before any folder work runs; every downstream
folder query filters `DocumentFolder.organization_id == organization_id` and
walks parent-child links server-side — no client-supplied folder id is ever
accepted, so there is no IDOR surface. This much the draft got right.

## Verified good ✅

- **Auth coverage 98/98**, 0 bare `get_current_user`, enumerated by exact
  grep count rather than sampled.
- **FAC-3/FAC2-1 (XC-1 FK-validation) still closed** — `_assert_facility_in_org`
  present at all 10 previously-documented call sites.
- **FAC-5 (HIGH, sensitive-family gating) still closed** — all 5 sensitive
  families' list+get routes require `facilities.view_sensitive`/`.edit`/
  `.manage`, not the baseline `.view`.
- **No raw SQL, LIKE search escaped** — the only search (`list_facilities`)
  uses `escape=LIKE_ESCAPE_CHAR` on all three ilike'd columns.
- **`GET /{facility_id}/folders` is org-scoped and IDOR-safe** — no
  client-supplied folder id, every query filters on the caller's org.
- **Lint:** flake8 clean, no TODO/FIXME.

## Findings

### FAC-4 — correction, not a finding — the search-unexposed claim is stale — ✅ CORRECTED

The draft carried forward app-review's "search wired but not exposed" claim
without checking current code. It's wrong: `GET /facilities` and
`GET /facilities/page` both accept and forward a validated `search` query
parameter (`facilities.py:456,531`) to `FacilitiesService.list_facilities`,
and `FacilitiesDashboard.tsx:83` calls it from the frontend. FAC-4 has been
closed since before this iteration started. Corrected in this doc and in
`docs/app-review/facilities.md`.

### FAC-6 — HIGH (correctness/availability) — facility-folder creation races into a permanently broken endpoint — ✅ FIXED

**What:** `DocumentsService.ensure_facility_folder` is a check-then-insert
with no uniqueness constraint behind it (`DocumentFolder` has none on
`(parent_id, slug)`). Two concurrent first-accesses to
`GET /{facility_id}/folders` for a facility that has never had its folder
created both see "no folder yet," and both insert a duplicate facility
folder plus its six sub-folders.
**Where:** `app/services/documents_service.py:790` (`ensure_facility_folder`),
consumed by `get_facility_sub_folders` at line 889.
**Failure scenario:** any `facilities.view` holder triggers it by firing two
requests close together — a double-click on a facility's Files tab, or two
staff opening the same new facility's page at once. After the race,
`get_facility_sub_folders`'s `scalar_one_or_none()` lookup for the
`facility-{id}` slug finds two rows and raises `MultipleResultsFound`, which
propagates as an unhandled 500 on **every subsequent load** of that
facility's folders — not a transient failure, a permanent one until someone
manually deletes the duplicate row.
**Impact:** availability — a broken, unrecoverable-without-DB-access feature
for the affected facility. No data disclosure (both org-scoped throughout).
**Fix:** lock the organization row `FOR UPDATE` for the duration of the
get-or-create (the same shape as CLAUDE.md Pitfall #27 and the precedent in
`inventory_service.py`'s sequential-barcode allocator), serializing
concurrent first-accesses across the org's facilities. Cheap: this only runs
once per facility, ever. Also hardened `get_facility_sub_folders`'s two
lookups from `scalar_one_or_none()` to `order_by(id).limit(1)` +
`scalar_one_or_none()`, so a duplicate that already exists from a race
predating this fix degrades to picking one deterministically instead of a
persistent 500. Guard test:
`test_facilities_folders.py::TestFolderCreationIsLocked`.

### FAC-7 — MED (correctness) — six update paths turned an explicit null on a NOT-NULL column into a 500 — ✅ FIXED

**What:** `update_facility`, `update_photo`, `update_maintenance_record`,
`update_inspection`, `update_capital_project`, and `update_insurance_policy`
each hand-rolled `for field, value in update_data.items(): setattr(instance,
field, value)` — no nullability check. Thirteen more update methods routed
through the module's own `_apply_updates` helper, which did the identical
unchecked loop. Only `update_room` (fixed for a different reason, FAC2-1)
already used the shared `apply_updates` utility.
**Where:** `app/services/facilities_service.py` — `_apply_updates` (line 152) plus the six call sites named above.
**Failure scenario:** `Facility.name` and `FacilityPhoto.is_primary` are both
`nullable=False`, but `FacilityUpdate.name`/`FacilityPhotoUpdate.is_primary`
are `Optional`, so Pydantic accepts an explicit `null`. The value reaches
`setattr` unchecked and only fails at `db.commit()`, surfacing as a raw
`IntegrityError` → 500 instead of a clean 400 — the same shape MS-5 already
fixed in the medical-screening review, recurring here because this module's
`_apply_updates` was never migrated to the shared utility when it shipped.
**Fix:** `_apply_updates` now delegates to `app.utils.model_updates.apply_updates`
(already imported in this file for `update_room`), which raises `ValueError`
— turned into a 400 by every one of these endpoints' existing
`except ValueError` handler — on a null against a non-nullable column, and
raises on an unknown field name as a bonus safety net. The six inline loops
were switched to call the same utility directly. No behavior change for
valid payloads. Guard tests:
`test_facilities_service.py::TestNullabilityGuard` — two direct checks
against real `Facility`/`FacilityPhoto` model instances, plus a
source-inspection parametrized test over all seven previously-vulnerable
methods asserting each calls `apply_updates(` and none still contains the
raw loop, so a future edit cannot silently reintroduce it.

### FAC-8 — LOW (data exposure) — facility photo/document responses leaked the internal storage path — ✅ FIXED

**What:** `FacilityPhotoResponse`/`FacilityDocumentResponse` both extended
their `*Create` schema, which declares `file_path: str` — so every read
(`GET /photos`, `GET /documents`, and the single-item create/update
responses) serialized it to any `facilities.view` holder, the baseline
permission gating these routes.
**Where:** `app/schemas/facilities.py:525,556`.
**Impact:** internal storage-layout disclosure (filesystem path or storage
key, depending on how the value was populated) — the same class of
implementation detail the generic Documents module's own `DocumentResponse`
deliberately excludes (`file_name`/`file_size`/`file_type`/`has_file`, never
the path). LOW because this facility-photo/document feature currently has no
frontend caller at all (`FAC-P10` — API-only, no facility-detail workflow),
so nothing today actively surfaces the leaked value, but the response shape
itself was wrong regardless of who calls it today.
**Fix:** both response schemas now declare their fields explicitly instead
of inheriting from `*Create`, matching the Documents module's precedent and
omitting `file_path`. No frontend change needed (nothing reads it). Guard
tests: `test_facilities_service.py::TestFacilityFileResponseRedaction`.

### FAC-9 — LOW (data exposure, ACL) — folder `document_count` crossed the `documents.view` boundary — ✅ FIXED

**What:** `GET /{facility_id}/folders` is gated on `facilities.view`, but
returned each sub-folder's `document_count` — an aggregate over the generic
Documents module's own `Document` table, every other read of which
(`list_documents`, folder detail, summaries) requires `documents.view`
independently.
**Where:** `app/api/v1/endpoints/facilities.py:3635` (the response assembly
in `get_facility_folders`).
**Impact:** the same aggregate-disclosure class `DOC-4` already records as
open in the Documents review (`docs/security-review/DOC-10-documents-legal.md`)
— a `facilities.view`-only member learns, e.g., that a facility's "Insurance
& Leases" folder has 3 documents, without holding `documents.view`. LOW: a
bare count, not content, names, or ids — but the draft's original reasoning
("materially less information than the record data DOC-4 is actually about")
was Codex's point exactly: it's still the DOC-4 class, not a different one,
and the fact that it's less severe doesn't make it not the boundary crossing
DOC-4 already flags.
**Fix:** `document_count` is now `None` for a caller who lacks
`documents.view`/`documents.manage`, using the same
build-full-response-then-redact pattern `_facility_response_for` already
uses for the two sensitive facility fields (`lease_expiration`/
`property_tax_id`) — the folder list itself (names, which are fixed
per-facility labels, not user content) stays visible, only the aggregate is
gated. `FoldersListResponse.document_count` was already
`Optional[int] = 0`, so no schema change needed there. Guard tests:
`test_facilities_folders.py::TestFacilityFolderDocumentCountRedaction`.

## Schema & migration notes

No schema changes. `DocumentFolder` still has no uniqueness constraint on
`(parent_id, slug)` — FAC-6's fix is a lock, not a constraint, which is
sufficient because every insert of a facility folder or its sub-folders goes
through the one locked code path (`ensure_facility_folder`); a future writer
that inserts `DocumentFolder` rows outside that path would need its own
locking or the constraint. Not added here as it would require auditing every
`DocumentFolder` insert site in the (much larger) Documents module, out of
scope for a Facilities-feature iteration. `FacilityMaintenance.maintenance_type_id`
`nullable=False` + FAC-2's create-time guard re-confirmed unchanged.

## Guard tests added

- `test_facilities_folders.py::TestFolderCreationIsLocked` — source-inspects
  `ensure_facility_folder` for `with_for_update()`; fails on FAC-6
  reintroduction.
- `test_facilities_folders.py::TestFacilityFolderDocumentCountRedaction` —
  three cases (view-only, `documents.view`, `documents.manage`) asserting
  `document_count` is `None` vs. populated; fails on FAC-9 reintroduction.
- `test_facilities_service.py::TestNullabilityGuard` — two direct
  `apply_updates` rejections against real models, plus a parametrized
  source-inspection test over all 7 previously-vulnerable methods; fails on
  FAC-7 reintroduction at any of them.
- `test_facilities_service.py::TestFacilityFileResponseRedaction` — asserts
  `file_path` absent from both response schemas' fields; fails on FAC-8
  reintroduction.

## Completion gate

| Check                                             | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/`              | ✅ 1247 files unchanged                                          |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change                                 |
| `pytest tests/ -k "facilities or documents"`      | ✅ 211 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)              | ✅ 8317 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change                                         |
