# Security Review 12 — Facilities

**Prefix:** `FAC` · **Iteration:** 12 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-28 (pass 2), 2026-09-03 (pass 3) · **PR:** [#1836](https://github.com/thegspiro/the-logbook/pull/1836) (pass 1), [#1959](https://github.com/thegspiro/the-logbook/pull/1959) (pass 2), [#2191](https://github.com/thegspiro/the-logbook/pull/2191) (pass 3)

**Backend:** `api/v1/endpoints/facilities.py` (98 routes), `services/facilities_service.py`
(~3,290 L), `services/documents_service.py` (the new folder-bridge methods),
model `app/models/facilities.py`
**Frontend:** `modules/facilities`
**Migrations:** none this iteration (no schema change)

---

## Pass 3 (2026-09-03)

Prior art re-read in full: `docs/module-audit/facilities.md` (open item FAC-3
already closed per pass 1/2, re-confirmed below) and
`docs/app-review/facilities.md` (no open items — FAC-4 closed since pass 1
of this doc). Pass 1 and pass 2's findings (FAC-1 through FAC-12) all
re-verified intact against current code; no regression in any of them.

**Scope of this pass:** `git diff --stat` for
`backend/app/api/v1/endpoints/facilities.py`,
`backend/app/services/facilities_service.py`, `backend/app/models/facilities.py`,
`backend/app/schemas/facilities.py`, and `frontend/src/modules/facilities/`
since pass 2's merge (`b39a548c`, PR #1959) — small on the backend
(`facilities.py` +12/−3, `facilities_service.py` +49/−4,
`schemas/facilities.py` +14/−2: an `include_inactive` list param for the
maintenance-types settings screen, and `usage_count` stamped on the three
lookup-table list endpoints so the settings screen's Delete-disable guard
means something), larger on the frontend (a new
`FacilitiesSettingsPage.tsx`, `window.confirm`→`useConfirm()`/`PromptDialog`
migrations already landed and re-verified clean, a stale-response-race guard
in `facilitiesStore.ts`, error-handling fixes in `FilesSection.tsx`). None of
that backend/frontend product work introduced a new tenant-isolation, auth,
or injection gap — re-checked each site individually.

**This pass's specific brief** was to check whether PR #2160 ("Normalize
document system folder access" / "Enforce document folder ancestor
authorization" — the DOC-5 fix from feature 10's own pass, which touched
`facilities.py` by adding `current_user=current_user` to the
`get_facility_sub_folders` call) left a facilities-specific gap, without
re-deriving DOC-5's own mechanism review. `docs/security-review/
DOC-10-documents-legal.md`'s pass 3 already verified `can_access_folder`'s
ancestor-walk mechanism itself is sound (fail-closed on missing/cross-org/
cyclic ancestry, `required_permissions` checked before the leadership
bypass) — not re-derived here. It did.

### FAC-13 — HIGH (correctness/access, not a leak) — every facility folder now requires the sensitive-family permission set, silencing Photos, Maintenance Records, and Inspection Reports — three established-baseline categories — for their intended audience (Blueprints & Permits' classification is separately undecided, see below) — 🚩 FLAGGED

**What:** `GET /{facility_id}/folders` is gated at `facilities.view`/
`.manage` (`facilities.py:3714-3716`), and FAC-5's whole design point is
that facility data splits into five **sensitive** families (access keys,
utility accounts, capital projects, insurance policies, occupants — gated
`facilities.view_sensitive`/`.edit`/`.manage`) and everything else —
including a facility's photos and maintenance/inspection records — which
stays readable at the **baseline** `facilities.view` grant held by
`secretary`, `quartermaster`, `safety_officer`, and `training_officer`
(`core/permissions.py:1694`, `1755`, `1963`, `1989` — each holds
`FACILITIES_VIEW` alone, none of `FACILITIES_VIEW_SENSITIVE`/`_EDIT`/
`_MANAGE`).

The facility **file tree** built by `ensure_facility_folder`
(`documents_service.py:913`) does not honor that split. Every node — the
shared `facilities` system root, each per-facility folder, and **all six**
of its sub-folders (Photos, Blueprints & Permits, Maintenance Records,
Inspection Reports, Insurance & Leases, Capital Projects) — is stamped with
the identical `required_permissions = FACILITY_SENSITIVE_PERMISSIONS =
["facilities.view_sensitive", "facilities.edit", "facilities.manage"]`
(`documents_service.py:986,1013,1041`), and the backfill migration
`20260827_1800_a9c4e7b2f631` stamped every existing row the same way. That
stamping was already in place as of pass 2 (2026-08-28) but **inert**:
`get_facility_sub_folders` did not call `can_access_folder` at all until
PR #2160 added the `current_user` parameter and the filter on
2026-09-02 (`git show 5ff4ca3b -- backend/app/services/documents_service.py`
— the filter line is new in that commit, not a signature-only change).
`can_access_folder` ANDs every ancestor (`documents_service.py:281-303`), so
once enforced, a caller who is not admitted at the shared root is refused
**every** facility's entire folder tree, sensitive or not.

**Verified empirically**, exercising the real `DocumentsService.can_access_folder`
(not a reimplementation) against an in-memory tree shaped exactly like
`ensure_facility_folder` builds it:

```
facilities.view-only can see Photos sub-folder: False
facilities.manage    can see Photos sub-folder: True
```

**Failure scenario:** a secretary, quartermaster, safety officer, or
training officer — every one of them holding `facilities.view` by design,
per FAC-5 — calls `GET /facilities/{id}/folders` for any facility and gets
back an **empty folder list** (`"folders": [], "total": 0`), for every
facility, permanently, including the non-sensitive Photos and Maintenance
Records categories they are supposed to see. `POST /photos`
(`facilities.py:773`, gated `facilities.create`/`.edit`/`.manage`) still
succeeds for whoever can upload, and `GET /photos` (`facilities.py:748`,
gated baseline `.view`) still returns the photo's metadata — caption,
`is_primary`, timestamps — to a `facilities.view` holder. Only the actual
file, filed by `_validate_shared_document_reference` into this same gated
tree, is unreachable to them. The record says a photo exists; the bytes
behind it do not open for the same caller the record itself is visible to.

**Not a data-exposure bug** — fail-closed throughout, verified by the
empirical check above and by `DOC-10`'s own mechanism review. It is a
functional regression: a permission tier the product deliberately created
(FAC-5, FAC-P9) can no longer do the file-viewing part of its job. Two
comments in the code now assert something false about current behavior as a
result — both corrected in this pass as a pure-documentation, zero-behavior
change (see below); the underlying access gap is flagged, not fixed.

This claim is scoped to the mechanism just described (the folder-listing
over-restriction itself) — it is not a claim that every document-access path
in this pass is airtight. A Codex review of this pass's own fix commit found
two real gaps nearby, on the opposite side of the same boundary: FAC-14
below (a genuine bypass on the generic document write routes, now fixed) and
an extension to remediation item (3) further down (already-filed documents
left in a weakly-protected folder are not relocated either — flagged, not
yet fixed).

**Why this is flagged rather than fixed:** a correct fix is not "loosen the
gate" — that would let any `documents.view` holder (a much broader grant;
the default `member` position holds it) browse a facility's Photos/
Maintenance Records folder through the generic Documents module UI with
_no_ facilities permission at all, reopening exactly the leak
`_validate_shared_document_reference`'s own docstring describes closing.
Because `can_access_folder` ANDs every ancestor, splitting the tree
correctly needs:

1. A new, named permission tier for "any facilities module access" (the
   endpoint's own `facilities.view`/`.manage` OR-set, not the narrower
   sensitive set) to gate the shared root and the three sub-folders that are
   unambiguously operational per FAC-5's own text — Photos, Maintenance
   Records, Inspection Reports. `FACILITY_SENSITIVE_PERMISSIONS` stays on
   `Insurance & Leases` and `Capital Projects`.
2. A product/security call on **Blueprints & Permits** specifically: unlike
   the three above, a building's floor plans are defensibly
   security-sensitive (entry points, alarm/utility shutoff locations) even
   though FAC-5 never named them as one of the five families — an owner
   call, not one this review should make unilaterally. Until that call is
   made, Blueprints & Permits stays on `FACILITY_SENSITIVE_PERMISSIONS`
   alongside the two financial sub-folders, fail-closed.
3. Reclassifying existing document references into a correctly-gated
   sub-folder **before** touching the per-facility folder's own permission
   — covering two distinct cases, not just the unfiled one (the second was
   missing from this remediation plan as originally drafted; a Codex
   review of this pass's own fix commit caught it, verified independently
   below):
   - **Unfiled documents.** `_validate_shared_document_reference`
     (`facilities.py:180-189`) files every currently-unfiled photo/document
     directly into the per-facility folder itself — the parent all six
     sub-folders hang off, and the very node (1) proposes loosening — not
     into any of the six sub-folders. Loosening that parent folder's ACL on
     its own would therefore immediately expose every document sitting
     there today, sensitive or not, to a baseline viewer, regardless of how
     the sub-folders underneath it end up classified.
   - **Already-filed documents left in a weaker folder.** The same
     function only relocates when `document.folder_id is None`
     (`facilities.py:180`) — deliberately, per its own docstring: "Only an
     unfiled document is moved. A caller that deliberately filed it
     somewhere else keeps that placement." So `POST /facilities/documents`
     referencing an already-org-shared document that is already sitting in
     an unrestricted or otherwise weakly-protected folder leaves it exactly
     there. `GET /documents/{id}/download` authorizes on that folder's own
     ACL alone (`can_access_document`, with no facility-specific check
     layered on top — confirmed by reading the endpoint in full), so a
     default member holding only `documents.view` can already download
     bytes a facility record treats as sensitive today, through a
     pre-existing folder placement the facility endpoint never chose and
     never re-examines. **This gap is live today**, independently of
     whether (1)/(2) above are ever acted on — it needs no loosening of
     anything to be exploitable.

   Both cases need to be classified and moved into the correctly-gated
   sub-folder (or individually re-authorized) — a data-classification
   pass, not just a permission change — before the per-facility folder's
   own permission changes.

   **Flagged, not fixed, here — unlike FAC-14 below.** FAC-14 closed a
   mechanical gap: a well-tested ACL check (`can_access_document`) simply
   wasn't being called on two routes that already had everything needed to
   call it. Closing the already-filed case above is a different shape of
   problem — there is no existing "is folder A's grant at least as strong
   as folder B's requirement" comparison anywhere in this codebase
   (`can_access_folder` only ever answers "can _this_ user access _this_
   folder", never whether one folder's ACL subsumes another's) — and each
   candidate remedy is itself a product call: silently relocating the
   document reverses the _intentional_ "only an unfiled document is moved"
   decision quoted above with no signal that reversing it is now safe for
   every caller of this endpoint; rejecting the reference outright breaks
   any legitimate workflow that shares an already-filed document across
   modules; and per-document re-authorization needs a new override plus
   its own migration. That is the same "owner call, not one this review
   should make unilaterally" bar as point (2)'s Blueprints & Permits
   decision — not a same-day fix.

4. A migration correcting every already-stamped row for the categories that
   move (the root, the per-facility folders, and the sub-folders chosen in
   (1)/(2)), sequenced after the reclassification in (3) — mirroring
   `a9c4e7b2f631`'s own shape, in the other direction.

That is a genuine design decision plus a data-classification pass plus a
migration, squarely the "flag, not auto-apply" case this rotation's
discipline exists for.

**Fixed in this pass — the two comments that now claim something false:**
`facilities.py:3756-3763`'s comment on `get_facility_folders` said "A
facilities.view-only caller sees the folders... but not how many documents
are inside them" — true when FAC-9 wrote it, false since PR #2160. Corrected
to state the current behavior and point at this finding.
`test_facilities_folders.py`'s module docstring made the identical claim
about the scenario `TestFacilityFolderDocumentCountRedaction` is named for;
corrected to note that class mocks `get_facility_sub_folders` outright, so
it verifies only the count-redaction branch, never the folder-visibility
claim in its own name. Neither correction changes any behavior or any
test's pass/fail outcome — both are doc-accuracy fixes, verified by the full
`facilities`/`documents` test run below.

**Mirrored to** `docs/KNOWN_LIMITATIONS.md`.

### FAC-14 — HIGH (access control, IDOR) — generic document mutation routes let `documents.manage` bypass a document's own folder ACL entirely — ✅ FIXED

**Found by Codex review of this pass's own fix commit (`0231a904`).**
FAC-13's "not a data-exposure bug — fail-closed throughout" claim above is
about the _read_ path (`get_document`/`download_document`, and the folder
listing they sit behind). The write path told a different story.
`PATCH /documents/{document_id}` and `DELETE /documents/{document_id}`
(`documents.py`) were gated only on `documents.manage`, resolved the
target purely by `organization_id`
(`DocumentsService.get_document_by_id`), and never called
`can_access_document`/`can_access_folder` — the same check `get_document`
and `download_document` already run. `PATCH` additionally accepted
`{"folder_id": null}` and validated only that a _new_ `folder_id` belongs
to the caller's own org (`assert_in_org`, DOC-6/XC-1) — never that the
caller may access the document's _current_ folder.

**Impact:** `documents.manage` is an org-wide administrative grant,
independent of any facilities permission. `_folder_admits_user`
(`documents_service.py:214-239`) deliberately does **not** let
`documents.manage`'s leadership bypass override a folder's own
`required_permissions` — the entire point of `FACILITY_SENSITIVE_PERMISSIONS`
is that a documents administrator holding none of `facilities.view_sensitive`/
`.edit`/`.manage` cannot read a facility's Insurance & Leases or Capital
Projects folder. Because the mutation routes skipped the check entirely, that
same documents.manage-only caller — holding or obtaining a sensitive
facility document's UUID (an earlier authorized view, a URL, an audit-log
entry, a list elsewhere) — could `PATCH` its `folder_id` to `null` and move
it to unfiled/org-level storage, after which any `documents.view` holder
(the default `member` grant) could list and download it. `DELETE` had the
identical gap and could destroy the file outright.

**Verified independently**, not on Codex's claim alone: read
`update_document`/`delete_document` in both `documents.py` and
`documents_service.py` in full and confirmed neither calls
`can_access_document`/`can_access_folder` anywhere in the call chain, and
confirmed `_folder_admits_user` really does check `required_permissions`
_before_ the `documents.manage` leadership bypass (so the read-side check
this fix now reuses genuinely denies a documents.manage-only, non-facilities
caller — it isn't itself a no-op for that grant).

**Fix:** both endpoints now fetch the existing document and call
`DocumentsService.can_access_document` — the same helper `get_document`/
`download_document` already use — before applying any change, returning the
same "not found" 404 (not 403) an inaccessible document already returns
elsewhere, so existence isn't confirmed to a caller who can't see it. A
document with no folder (org-level) is unaffected — `can_access_document`
already treats that as accessible to any `documents.view` holder, matching
existing behavior. A caller who genuinely holds the folder's own
`required_permissions` (e.g. `facilities.view_sensitive`) can still move or
delete the document, so legitimate facility-admin workflows are unaffected.

**Regression test:** `tests/test_documents_access.py::
TestUpdateAndDeleteDocumentRespectFolderAcl` (4 tests) — two prove a
`documents.manage`-only caller can no longer unfile or delete a document
sitting in a `facilities.view_sensitive`-gated folder (both now raise 404;
independently confirmed to fail — "DID NOT RAISE HTTPException" — against
the pre-fix routes via `git stash`, and to pass again once the stash was
restored), and two positive-control tests prove a caller who holds that
folder's own `required_permissions` can still do both.

**Scope note:** `facilities.py` and `apparatus.py` also call methods named
`update_document`/`delete_document`, but on `FacilitiesService` and
`ApparatusService` respectively — distinct classes operating on their own
`FacilityDocument`/apparatus-document models, not the generic
`DocumentsService` this finding is about. Confirmed via `grep` that
`DocumentsService.update_document`/`delete_document` have exactly one
caller each, both in `documents.py`, so this fix has no effect on those
other modules.

## Verified good ✅ (re-confirmed this pass)

- **Auth coverage 98/98** — exact grep count unchanged since pass 2
  (`grep -c 'require_permission(\|require_all_permissions(' facilities.py`
  = 98 = `grep -c '^@router\.'`), 0 bare `get_current_user`. No new route
  landed since pass 2.
- **FAC-1 through FAC-12** (all prior findings) — spot-checked each site,
  no regression.
- **Settings-screen CRUD** (`create_facility_type`/`_status`/
  `_maintenance_type` and their `update_*`) — all `facilities.manage`;
  their `delete_*` siblings — all `require_permission("facilities.delete",
"facilities.manage")`. Correctly manager-only.
- **`_attach_usage_counts`** (new this window, `facilities_service.py:306`)
  — the settings screen's per-lookup usage count — filters
  `org_column == str(organization_id)` explicitly; a system (NULL-org)
  lookup's usage is never counted against or leaked to another org.
- **No new raw SQL / unescaped LIKE** — the one search
  (`list_facilities`) is unchanged; `escape=LIKE_ESCAPE_CHAR` on all three
  `ilike` calls, as before.
- **No `window.confirm`/`.alert`/`.prompt`** anywhere in
  `frontend/src/modules/facilities/` (already fixed pre-pass-3; re-verified
  clean by direct grep).
- **No reservation/booking/capacity-check shape** — `max_occupancy`
  (`Facility`) and `capacity` (`FacilityRoom`) are descriptive fields synced
  one-way into the linked `Location` record; neither is read back and
  compared against a live count anywhere in `facilities_service.py`. CLAUDE.md
  Pitfall #27 (capacity check needs both halves of the lock) does not apply
  to this feature — there is no count-then-insert against either field.
- **Lint:** flake8 clean on the two files touched this pass.

## Completion gate (pass 3)

| Check                                                                                                                                                                     | Result                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                             | ✅ 0 violations                                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                      | ✅ clean                                                                   |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                 | ✅ clean                                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                         | ✅ single head, no schema change                                           |
| `pytest tests/ -k "facilities or documents"`                                                                                                                              | ✅ 249 passed, 1 skipped (pre-existing optional-dependency skip)           |
| `pytest tests/` (full backend suite)                                                                                                                                      | ✅ 9992 passed, 21 skipped (pre-existing Docker/optional-dependency skips) |
| `npm run typecheck` (TypeScript 7 via `tsc-native.mjs` — bare `tsc` resolves to the 5.9 lint compiler, not the build compiler; see CLAUDE.md's "Two TypeScript installs") | ✅ 0 errors (no frontend code changed this pass)                           |
| `eslint .`                                                                                                                                                                | ✅ (see report body — no frontend code changed this pass)                  |

## Completion gate (pass 3, round 2 — Codex review of `0231a904`)

Re-run after FAC-14's fix and the doc corrections (Finding 1/3/4/5) below.

| Check                                                                                                                        | Result                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/api/v1/endpoints/documents.py tests/test_documents_access.py`                                                    | ✅ 0 violations                                          |
| `black --check app/api/v1/endpoints/documents.py tests/test_documents_access.py`                                             | ✅ clean                                                 |
| `isort --check-only app/api/v1/endpoints/documents.py tests/test_documents_access.py`                                        | ✅ clean                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                            | ✅ single head, no schema change                         |
| `pytest tests/ -k "facilities or documents"`                                                                                 | ✅ 253 passed (+4, FAC-14's regression tests), 1 skipped |
| `pytest tests/` (full backend suite)                                                                                         | ✅ 9996 passed (+4), 21 skipped (pre-existing)           |
| `npm run typecheck` (TypeScript 7 via `tsc-native.mjs`)                                                                      | ✅ 0 errors (no frontend code changed this round)        |
| `eslint .`                                                                                                                   | ✅ clean, exit 0 (no frontend code changed this round)   |
| `prettier` on the four markdown docs touched (`FAC-12-facilities.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`, `PROGRESS.md`) | ✅ clean                                                 |

**FAC-14's regression test independently confirmed against pre-fix code:**
`git stash` isolating just the `documents.py` fix, then
`pytest tests/test_documents_access.py -k TestUpdateAndDeleteDocumentRespectFolderAcl`
— the two bypass tests failed (`DID NOT RAISE HTTPException`) as expected,
the two positive-control tests still passed; `git stash pop` restored the
fix and all four passed.

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

---

## Pass 2 (2026-08-28)

Scoped to the full domain since pass 1's merge (`4e8c6b0c`, PR #1836):
`git diff --stat` against `backend/app/api/v1/endpoints/facilities.py`,
`facilities_service.py`, `models/facilities.py`, `schemas/facilities.py`,
`frontend/src/modules/facilities/`, and every migration in that window
content-relevant to `document_folders`/`positions`/facility permissions.
This range carried substantially more product work than code churn in the
declared backend service/model/schema files (both unchanged): a new
cross-module document-reference validator in the endpoint file, a granular
`facilities.delete` permission wired to every delete route, four permission
migrations restricting `facilities.view` to leadership/facilities-manager
positions instead of the baseline member grant, a new folder-ACL migration,
a new `FilesSection` frontend component, a stale-response-race guard added
to `facilitiesStore.ts`, and the whole-app module-gating sweep (verified to
include this router: `module_gate("facilities", "Facilities")` at
`api.py:153`).

**Verified good (re-confirmed and newly checked):**

- FAC-3/FAC2-1, FAC-5, FAC-6, FAC-7, FAC-8, FAC-9 (pass 1 fixes) all still
  intact — spot-checked each site, no regression.
- `_validate_shared_document_reference` (new, `facilities.py:127`, landed via
  PR #1953/DOC-10 pass 2, not documented in that pass's own findings file):
  org-scoped document lookup (`get_document_by_id` filters
  `organization_id`), 404 on a missing/cross-org document is indistinguishable
  from a genuinely missing one, and the update schemas
  (`FacilityPhotoUpdate`/`FacilityDocumentUpdate`) do not expose `file_path`
  at all — so a caller cannot bypass the validator by creating a photo/
  document normally and then `PATCH`ing a different reference in. A benign
  same-org, unfiled-document "adoption" race (two concurrent creates
  referencing the same never-before-filed document into two different
  facilities) exists but is a data-placement quirk, not a security defect —
  the last write wins which facility's folder the document lands in, nothing
  is disclosed or lost. Not fixed: low value for the complexity of a locking
  fix on a one-time, cross-facility, same-org coincidence.
- Granular `facilities.delete` (PR #1897 "Honor granular facility deletion
  permission"): every position that holds `facilities.delete` in the
  registry (`core/permissions.py`) already also holds `facilities.manage`
  alongside it (checked all 3 occurrences) — wiring it into the delete
  routes' `require_permission("facilities.delete", "facilities.manage")`
  grants no principal new access; it only makes a previously-dead permission
  meaningful (the CLAUDE.md Pitfall #19 shape, in the safe direction). A
  department's own custom role that was granted `facilities.delete` alone
  before this change gaining real delete power now is the intended effect
  of "honoring" the grant, not a regression.
- `facilities.view` revocation migrations (`e4f5a6b7c8d9`,
  `c7e2b9a41f83`): both guard `"positions" not in ... get_table_names()`
  before reflecting (Pitfall #26 — `positions` is a `create_all`-only
  table), scope to `is_system = True` only, and match the current registry
  (`OPERATIONAL_RANKS`/`DEFAULT_POSITIONS` no longer grant
  `FACILITIES_VIEW` to any rank from `member` through `lieutenant`/chiefs —
  only administrative positions and `facilities_manager` do).
- `document_folders.required_permissions` migration (`a9c4e7b2f631`):
  guards the `create_all`-only table the same way, matches by fixed
  system-assigned slug (not user-editable), and the permission set matches
  the endpoint's own `_SENSITIVE_READ_PERMISSIONS`.
- Module gating: `facilities.router` is registered with
  `module_gate("facilities", "Facilities")` — confirmed at the
  `include_router` call site, not just claimed by the sweep's own commit
  message.

**Findings:**

### FAC-10 — LOW (doc accuracy) — module docstring called `facilities.view` "the baseline member grant" after it no longer is — ✅ FIXED

**What:** The module docstring at the top of `facilities.py` still described
`facilities.view` as "the baseline member grant," carried forward unchanged
since before the 2026-08-26/27 revocation migrations
(`e4f5a6b7c8d9`, `c7e2b9a41f83`) removed it from the default `member`,
`firefighter`, `emt`, `engineer`, `captain`, `lieutenant`, and chief
positions. It is now a leadership/facilities-manager-only grant (president,
treasurer, quartermaster, safety officer, training officer, facilities
manager) plus chiefs via `facilities.manage`. A reader trusting the
docstring — the next engineer adding an endpoint, or a future review pass —
would wrongly assume the whole department can reach baseline facility data.
**Where:** `app/api/v1/endpoints/facilities.py:1-19` (module docstring).
**Fix:** Docstring corrected to state the current, narrower grant population
and cite the revocation migrations by date.

### FAC-11 — MED (reliability, CLAUDE.md Pitfall #16) — new Files section used `window.prompt`, which a browser can silently no-op — ✅ FIXED

**What:** The new `FilesSection.tsx` (frontend-only, ships in this window,
not present at pass 1) called `window.prompt()` to edit a photo caption or
document description. Per CLAUDE.md Pitfall #16, Chrome suppresses repeated
`window.prompt` dialogs (and any dialog in a cross-origin frame), and a
suppressed prompt returns `null` — indistinguishable from the user pressing
Cancel. The existing `if (value === null) return;` guard then silently
no-ops the edit with no error and no indication to the user that anything
was blocked.
**Where:** `frontend/src/modules/facilities/components/FilesSection.tsx`
(`edit`, now `submitEdit`).
**Fix:** Replaced with the project's `PromptDialog` component
(`components/ux/PromptDialog`), matching the pattern already used in
`CheckRequestDetailPage.tsx`. While rewiring, corrected a second issue this
introduced: clearing the field to empty must send an explicit `null` on this
**update** payload (`blankToNull`, not `|| undefined` — CLAUDE.md Pitfall #1's
update-path amendment), or the omitted key leaves the old caption/description
in place behind a success toast. The two service methods
(`facilitiesService.updatePhoto`/`updateFacilityDocument`) only typed their
payload as `Partial<FacilityPhotoCreate>`/`Partial<FacilityDocumentCreate>`
(`caption`/`description: string`, no `null`), so the parameter types were
widened for just those two fields rather than casting past the type error.

### FAC-12 — LOW (authorization consistency) — Files section delete button gated on `facilities.manage` instead of the granular delete grant — ✅ FIXED

**What:** Every other mutable section on `FacilityDetailPage` passes the
hook's general `canDelete` (`canManage || facilities.delete`) for its delete
affordance. The new `FilesSection` was wired to `canManage` alone
(`<FilesSection ... canDelete={canManage} .../>`), so a principal holding
only the new granular `facilities.delete` grant — exactly the population
PR #1897 was written to enable — passes the backend's
`require_permission("facilities.delete", "facilities.manage")` on
`DELETE /photos/{id}` and `DELETE /documents/{id}` but never sees the delete
button for facility files, while seeing it on every other section. Fail-
closed (a UX/consistency defect, not an access-control gap — the backend
authorization was already correct), but a real inconsistency introduced in
the same window as the granular-delete rollout it undermines.
**Where:** `frontend/src/modules/facilities/pages/FacilityDetailPage.tsx`
(`FilesSection` call site).
**Fix:** Changed to pass `canDelete`, matching every sibling section on the
same page and the hook's own stated intent
(`useFacilitiesAccess.ts`: "Granular delete grants destructive controls
only... it must not imply create, edit, maintenance, sensitive-read, or
general management" — the Files section is exactly a destructive-controls
consumer, not one of the excluded categories).

**Codex review on the draft PR caught two more real issues, both fixed:**

- The FAC-10 docstring's "only" list of positions retaining `facilities.view`
  omitted `vice_president` and `secretary` (`permissions.py:1536,1623`), both
  of which the registry does grant it. Corrected the list and marked it
  explicitly non-exhaustive against a department's own customized positions,
  so the next reader can't treat it as a closed enumeration either.
- The FAC-11 `PromptDialog` rewrite unconditionally cleared `editTarget` when
  its update resolved. If that request was slow, the user could dismiss the
  dialog and open a different file's edit before it finished; the first
  request's completion would then close the second, still-open dialog and
  discard its in-progress input. Fixed by capturing the target the request
  was submitted for and only clearing state if it is still the current one
  (`setEditTarget((current) => (current === target ? null : current))`).

## Completion gate (pass 2)

| Check                                             | Result                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`              | ✅ 1323 files unchanged                                               |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                              |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change                                      |
| `pytest tests/ -k "facilities"`                   | ✅ 80 passed, 1 skipped (pre-existing)                                |
| `pytest tests/` (full backend suite)              | ✅ 9176 passed, 22 skipped (pre-existing Docker/contract skips)       |
| `tsc --noEmit`                                    | ✅ 0 errors                                                           |
| `eslint .`                                        | ✅ 0 errors, 10 pre-existing warnings (none in touched files)         |
| `vitest run src/modules/facilities`               | ✅ 73 passed                                                          |
| `vitest run` (full frontend suite)                | ⚠️ 5383/5384 passed — 1 failure, unrelated to this change (see below) |

**Full-suite frontend failure, investigated and confirmed out of scope:**
`NotificationCard.test.tsx` (`read state > marks an unread notification read
before following its CTA`) failed only in the full-suite run; re-run in
isolation (`vitest run src/components/NotificationCard.test.tsx`), all 8
tests including this one pass deterministically. This file has no relation
to Facilities (not in the diff, not imported by anything this pass touched)
and the failure is a cross-file test-pollution symptom (likely shared
`window.history`/router state leaking between files under the full run,
the frontend analogue of CLAUDE.md Pitfall #22's backend shared-mock
collision), not a regression introduced here. Diagnosing frontend test
isolation across the whole suite is out of scope for a Facilities-feature
pass; noted here per CLAUDE.md's "no acceptable pre-existing errors" rule
rather than silently omitted. Not mirrored to `KNOWN_LIMITATIONS.md` (it's
a test-suite hygiene issue, not a product limitation) — worth a dedicated
look next time the rotation reaches the notifications/messaging feature
(25) or the cross-cutting baseline's second pass.
