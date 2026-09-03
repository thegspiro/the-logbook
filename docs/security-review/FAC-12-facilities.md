# Security Review 12 — Facilities

**Prefix:** `FAC` · **Iteration:** 12 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-28 (pass 2), 2026-09-03 (pass 3) · **PR:** [#1836](https://github.com/thegspiro/the-logbook/pull/1836) (pass 1), [#1959](https://github.com/thegspiro/the-logbook/pull/1959) (pass 2), [#2191](https://github.com/thegspiro/the-logbook/pull/2191) (pass 3), [#2194](https://github.com/thegspiro/the-logbook/pull/2194) (FAC-22, FAC-23, urgent post-merge fix), [#2195](https://github.com/thegspiro/the-logbook/pull/2195) (FAC-24 through FAC-28, pass 3 continued, merged), [#2198](https://github.com/thegspiro/the-logbook/pull/2198) (FAC-29 fixed, FAC-30 flagged, pass 3 continued)

**Backend:** `api/v1/endpoints/facilities.py` (98 routes), `services/facilities_service.py`
(~3,290 L), `services/documents_service.py` (the new folder-bridge methods),
model `app/models/facilities.py`
**Frontend:** `modules/facilities`
**Migrations:** none this iteration (no schema change)

---

## FAC-22 — CRITICAL (unrecoverable, org-wide data loss) — `delete_folder` never checked `is_system` — urgent post-merge fix, PR #2194 — ✅ FIXED

**Not routine rotation work.** Codex posted this P1 finding on PR #2191's
final commit (`910c27e6`) after the PR had already merged, so it could not
be fixed on that branch — reusing a merged branch's name is prohibited
(CLAUDE.md Pitfall #24) — and instead landed here as a dedicated, out-of-
band fix on a fresh branch off `main`. This is the most severe finding in
this PR's cascade-delete investigation (FAC-16/17/20/21 above): those are
narrower single-document/single-subtree ACL bypasses; this one destroys an
entire system-managed folder tree — e.g. every member's personal folder and
every document in it — from a single request by a permission
(`documents.manage`) held broadly across the org.

**What:** `DELETE /documents/folders/{folder_id}` (`delete_folder`,
`documents.py`) checks the caller's own folder ACL
(`can_access_folder`) but never checked `existing.is_system` before invoking
the cascade. FAC-16 (same PR) fixed `DocumentFolder.children`'s
self-referential relationship (`remote_side` was on the wrong attribute) so
`cascade="all, delete-orphan"` now genuinely deletes a folder's subtree
instead of merely orphaning it (nulling descendants' `parent_id`). Before
that fix, the missing `is_system` check was latent — the delete didn't
destroy anything, only detached rows. After it, any `documents.manage`
holder can delete a system root such as **"Member Files"** outright and
cascade-destroy every member's subfolder and document beneath it in one
request — directly contradicting the documented invariant that system
folders cannot be deleted (`docs/TROUBLESHOOTING.md`: "System folders (the 7
default folders) cannot be deleted"; `docs/changelog/2026-02.md:2153`:
"System folder protection (cannot delete system folders)" under Verified
Secure). Neither claim was ever actually enforced in `documents_service.py`
or `documents.py` — confirmed against `origin/main` prior to this fix, and
against the full pre-#2191 history: this gap predates the rotation
entirely, made severe rather than created by FAC-16's correction.

**Reproduced against pre-fix code before writing any fix:** built a
system-flagged "Member Files" folder with a descendant folder and a
document, called `delete_folder` as an authorized `documents.manage`
caller with no other facilities/documents grant. The call succeeded with no
exception, and all three rows (system folder, descendant, document) were
destroyed.

**Where:** `app/services/documents_service.py` (`DocumentsService.delete_folder`).

**Fix:** `delete_folder` now raises `PermissionError` — converted to a 403
by the endpoint's existing `handle_service_errors` wrapper, matching the
403 convention `roles.py` already uses for "Cannot delete system
positions" — the moment it loads a folder with `is_system == True`, before
any subtree walk or delete begins. Placed in the service (not only the
endpoint) so any future caller of `delete_folder` is protected too, and
alongside the FAC-17/FAC-20/FAC-21 guards already living in this same
method.

**Investigated and out of scope:** `update_folder`'s rename/reparent path,
per the concern that reparenting a system folder (or moving something out
from under one) might carry its own invariant. It does not: the
`ensure_facility_folder`/`ensure_member_folder`-style lookups that
recreate a missing system folder key off `slug` + `is_system`, never off
`name` or `parent_id`, so a rename or reparent doesn't break
auto-recreation and causes no data loss. No documentation anywhere
prohibits renaming or reparenting a system folder — only deleting one — so
`update_folder` was left unchanged rather than over-scoped.

**Regression tests** (`TestDeleteFolderRefusesSystemFolder`,
`tests/test_documents_access.py`, mirroring FAC-16/20/21's shape):
`test_deleting_a_system_folder_is_refused_and_nothing_is_deleted` (403, and
the folder/descendant/document all survive) and
`test_a_non_system_folder_still_deletes_normally` (positive control). Both
confirmed to fail against pre-fix code via `git stash`
(`DID NOT RAISE HTTPException`, the same failure mode as the live
reproduction above) and pass post-fix.

## Completion gate (FAC-22, PR #2194)

| Check                                            | Result                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `flake8` (changed files)                         | ✅ 0 violations                                            |
| `black --check` (changed files)                  | ✅ clean                                                   |
| `isort --check-only` (changed files)             | ✅ clean                                                   |
| `python scripts/validate_migrations.py --strict` | ✅ single head, no schema change (no model file touched)   |
| `pytest tests/test_documents_access.py`          | ✅ 90 passed                                               |
| `pytest tests/` (full backend suite)             | ✅ 10019 passed, 21 skipped (pre-existing), no regressions |

No model file was touched, so `scripts/generate_schema_docs.py` has nothing
to regenerate.

## FAC-23 — CRITICAL (unrecoverable, org-wide data loss) — two-step bypass of FAC-22 via `update_folder`'s unchecked reparent — urgent post-merge fix, PR #2194 — ✅ FIXED

**Found by Codex review of FAC-22's own fix commit (`6c0137ed`), on the same
PR, before it merged.** FAC-22 closed the direct route — a caller can no
longer `DELETE` a system folder outright — but left the two-step route open:
`update_folder` never checked `is_system` before applying a reparent, and
`delete_folder`'s subtree walk (added for FAC-20's cross-org check and
FAC-21's descendant-ACL check) never checked `is_system` on a descendant
either. A caller could `PATCH` a system folder's `parent_id` to point at an
ordinary, freely deletable folder, then delete that ordinary folder — the
root-level `is_system` check in `delete_folder` only inspects the folder
named in the request (the ordinary one), the subtree walk finds the system
folder as a descendant, and neither the cross-org nor the ACL check already
in that loop stops it. The ORM cascade (`cascade="all, delete-orphan"`,
FAC-16) then destroys the system folder and everything beneath it — the
identical catastrophic, unrecoverable data loss FAC-22 was meant to close,
reached one step removed.

**What:** Two independent gaps, both in `app/services/documents_service.py`:

1. `DocumentsService.update_folder` applied `update_data` — including a
   reassigned `parent_id` — with no check of `folder.is_system` at all.
2. `DocumentsService.delete_folder`'s subtree walk checks each descendant's
   cross-organization membership (FAC-20) and its own `required_permissions`
   ACL (FAC-21), but never `is_system` — so a system folder reached as a
   descendant (by whatever means) was cascaded through like any other row.

**Verified independently before fixing:** wrote the two-step bypass directly
against pre-fix code — a system-flagged "Member Files" folder reparented (at
the DB layer, standing in for what an unguarded `update_folder` would do)
underneath an ordinary "Scratch" folder, then `delete_folder(scratch_id, ...)`
called as an authorized `documents.manage` caller. The call raised no
exception and destroyed the system folder, its descendant, and its document —
confirmed with `pytest --lf` isolating just the new regression test against
the code with the service-layer fix reverted (`git stash`): `Failed: DID NOT
RAISE HTTPException`.

**Where:** `app/services/documents_service.py`
(`DocumentsService.update_folder`, `DocumentsService.delete_folder`).

**Fix, both independent (either alone stops the reproduced bypass; both are
kept because each closes a different way to reach the same cascade):**

1. `update_folder` now raises `ValueError` (→ 400, via the endpoint's
   existing `handle_service_errors` wrapper — no endpoint change needed) if
   `folder.is_system` and `"parent_id"` is present in the update payload, at
   the same layer as the existing DOC-6/DOC-20 folder-specific validation.
   Matches the documented invariant that a system folder's location does not
   move (`docs/TROUBLESHOOTING.md`, `docs/changelog/2026-02.md`).
2. `delete_folder`'s subtree walk now also raises `ValueError` (→ 400, same
   shape as the existing FAC-20/FAC-21 checks in the same loop) the moment
   any descendant it visits has `is_system == True` — before anything is
   deleted. This is the robust half of the fix: it holds regardless of how a
   system folder ends up as a descendant — a row that predates fix (1), a
   future writer that misses it, or any other path — not just the one this
   finding demonstrated.

**Regression tests** (`tests/test_documents_access.py`, mirroring the
FAC-16/20/21/22 shape):

- `TestUpdateFolderRefusesReparentingSystemFolder` — a `documents.manage`
  caller cannot reparent a system folder (400, left exactly where it was);
  positive controls prove renaming a system folder without touching
  `parent_id` still works, and reparenting an ordinary folder still works.
- `TestDeleteFolderRefusesReparentedSystemFolderInSubtree` — reproduces the
  full two-step bypass end to end: a system folder is reparented underneath
  an ordinary folder (at the DB layer, isolating this test from fix (1) above
  so it verifies the `delete_folder`-side guard specifically), then deleting
  the ordinary folder is asserted to 400 with the entire subtree — ordinary
  folder, system folder, its descendant, and its document — surviving
  untouched.

Both new bypass tests independently confirmed to fail against pre-fix code
via `git stash` isolating just the `documents_service.py` fix (keeping the
new tests unstashed) — `DID NOT RAISE HTTPException` in both cases, the same
failure mode as the live reproduction above — and to pass once the stash was
restored. The existing `TestDeleteFolderRefusesSystemFolder` (FAC-22) suite
re-verified unaffected by either change.

## Completion gate (FAC-23, PR #2194)

| Check                                   | Result                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `flake8` (changed files)                | ✅ 0 violations                                                                     |
| `black --check` (changed files)         | ✅ clean                                                                            |
| `isort --check-only` (changed files)    | ✅ clean                                                                            |
| `pytest tests/test_documents_access.py` | ✅ 94 passed (+4 over FAC-22's 90)                                                  |
| `pytest tests/` (full backend suite)    | ✅ 10023 passed (+4 over FAC-22's 10019), 21 skipped (pre-existing), no regressions |

No model file was touched, so `scripts/generate_schema_docs.py` has nothing
to regenerate, and `python scripts/validate_migrations.py --strict` has
nothing new to validate (no schema change).

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

### FAC-15 — P1 (access control, write-side) — `PATCH /documents/{document_id}` authorized only the document's _source_ folder on a move, never the _destination_ — ✅ FIXED

**Found by Codex review of FAC-14's own fix commit (`b5fdf79d`).** FAC-14
closed the read-direction gap (a `documents.manage`-only caller moving or
deleting a document out of a folder they cannot access). It left the mirror
image open: `update_document` called `can_access_document` against the
document's **existing** folder only, and `DocumentsService.update_document`
validated a reassigned `folder_id` solely via `assert_in_org` (DOC-6/XC-1 —
same organization, nothing about the caller's own access to that folder).
Nothing on the write path checked whether the caller could access the
**destination** folder at all.

**Impact:** a `documents.manage` holder with zero facilities permission could
`PATCH` the `folder_id` of a document they already have legitimate access to
(e.g. an ordinary org-level memo) so that it points at a
`facilities.view_sensitive`-gated folder (Insurance & Leases, Capital
Projects) — injecting arbitrary content into a folder ACL'd against them.
The opposite direction from FAC-14 (write-into rather than read-out-of), but
the same root cause: a folder's `required_permissions` is meant to gate both
directions of movement across its boundary, and only one direction was
checked.

**Verified independently:** read `update_document` (`documents.py`) and
`DocumentsService.update_document` (`documents_service.py`) in full post-FAC-14
and confirmed no call to `can_access_folder` exists anywhere in the reassigned-
`folder_id` path. Compared against `upload_document`
(`documents.py:330-347`), which already resolves the destination folder and
calls `can_access_folder` before saving a new upload — the correct pattern
this fix mirrors, confirming the gap was an inconsistency between two routes
rather than a missing capability.

**Fix:** `update_document` now resolves the destination folder and calls
`can_access_folder` on it whenever `folder_id` is present in the update
payload, non-null, and different from the document's current `folder_id` —
matching `upload_document`'s own check (404 if the folder doesn't resolve in
the org, 403 if it resolves but the caller can't access it). Moving _out_ of
a folder to unfiled (`folder_id: null`) needs no destination check — FAC-14's
source-folder check already covers that direction, and there is no
destination folder to authorize. Re-sending the same `folder_id` alongside an
unrelated field edit is treated as no move, not a destination check.

**Regression test:**
`tests/test_documents_access.py::TestUpdateDocumentRespectsDestinationFolderAcl`
— proves a `documents.manage`-only caller cannot move an accessible document
into a sensitive-gated folder (403, document left in its original folder);
a positive control proves a caller holding the destination folder's own
permission still can; a third test proves re-sending the unchanged
`folder_id` needs no destination grant. Independently confirmed failing
pre-fix via `git stash` (the bypass test raised no `HTTPException` — the move
silently succeeded) and passing post-fix.

### FAC-16 — P1 (access control, IDOR) — `PATCH`/`DELETE /documents/folders/{folder_id}` never checked `can_access_folder` on the target folder itself — ✅ FIXED

**Found by Codex review of FAC-14's own fix commit (`b5fdf79d`).** FAC-14 and
FAC-15 both closed gaps on the _document_ mutation routes. The _folder_
mutation routes had the identical shape of bug, one level up the tree:
`update_folder` and `delete_folder` (`documents.py`) were gated only on
`documents.manage` and never called `can_access_folder` on the folder being
renamed, reparented, or deleted — even though a folder's own
`required_permissions` is exactly the rule `documents.manage`'s leadership
bypass is not supposed to override (`_folder_admits_user`,
`documents_service.py:214-239`). The read-side equivalent
(`get_facility_sub_folders`) already filters every folder it returns through
this same check; the two folder-mutation routes had no equivalent gate at
all.

**Impact:** a `documents.manage` holder with zero facilities permission could
rename or reparent a sensitive-gated facility folder (Insurance & Leases,
Capital Projects), or delete it outright — a full destructive cascade
(every descendant folder, every document in the subtree, and their backing
files) rather than the single document FAC-14 was scoped to. More severe
than FAC-14/FAC-15: a delete here is irreversible and destroys data the
caller was never entitled to see, not merely relocate.

**Verified independently:** read `update_folder`/`delete_folder`
(`documents.py`) and their `DocumentsService` implementations in full and
confirmed neither called `can_access_folder`, `can_access_document`, or any
other ACL check against the target folder before mutating — only the
`documents.manage` permission dependency and (for `update_folder`) FK
validation on a _reassigned_ `parent_id`/`owner_user_id`. Confirmed
`delete_folder`'s cascade claim empirically (see below).

**Fix:** both routes now fetch the target folder and call `can_access_folder`
on it before proceeding, returning 404 (not 403) on denial — consistent with
FAC-14/FAC-15 and with `can_access_document`'s existing "don't confirm
existence to a caller who can't see it" behavior. A caller who holds the
folder's own `required_permissions` is unaffected.

**A second, independent bug found while writing this fix's cascade-delete
regression test — also fixed here:** `DocumentFolder.children`
(`app/models/document.py`) declared `remote_side=[id]` directly on the
plural `children` relationship rather than on its singular `parent` backref
— inverted from the standard SQLAlchemy self-referential idiom used
correctly elsewhere in this codebase (`FacilityRoom.parent_room`,
`BudgetCategory.parent`, `StorageArea.parent`, `Event.recurrence_parent` all
place `remote_side` on the singular side). Empirically confirmed the effect
with a raw multi-level fixture: `db.delete(parent)` did **not** cascade to a
child folder; instead, because SQLAlchemy no longer recognized any
cascade-configured relationship pointing at the child, it proactively set the
child's `parent_id` to `NULL` before issuing the `DELETE` — so the DB's own
`ON DELETE CASCADE` (confirmed present at the schema level,
`fk_document_folders_parent_id_document_folders`, `DELETE_RULE=CASCADE`)
never even fired, since the child no longer referenced the parent by the
time the row was removed. Net effect: deleting a folder with descendants
silently detached them as orphaned root-level folders — retaining their own
`required_permissions` and documents, unreachable through normal navigation
(`can_access_folder` fails closed on missing ancestry) but still present and
still queryable in the database — rather than actually deleting them, despite
`delete_folder`'s own docstring and this pass's audit-log severity both
describing a full destructive cascade. No production code reads
`DocumentFolder.children`/`.parent` directly (grep-confirmed; every existing
call site — `get_facility_sub_folders`, `_creates_cycle`, `delete_folder`'s
own subtree walk — queries `parent_id` explicitly), so the only observable
effect of the relationship's direction is this cascade behavior, and
correcting it changes nothing else. Fixed by moving `remote_side=[id]` onto
the `parent` backref (`backref=backref("parent", remote_side=[id])`),
matching the pattern used correctly elsewhere in this codebase; re-verified
with a standalone, ad-hoc three-level fixture (root → child → grandchild →
document, built directly against the model, separate from the pytest
regression suite below) that a delete now removes every row.

**Not fixed here, flagged for a future pass:** the same inverted-`remote_side`
shape exists in two other, unrelated modules —
`CheckTemplateCompartment.children` (`app/models/apparatus.py:2248`) and
`TrainingCategory.subcategories` (`app/models/training.py:181`) — found by
grepping every `remote_side` usage in `app/models/` for comparison while
diagnosing this one. Both are outside this feature's scope (apparatus and
training belong to other rotation features) and unverified beyond the
pattern match; each needs the same empirical cascade-delete check this
finding used before assuming the fix transfers directly.

**Regression test:**
`tests/test_documents_access.py::TestFolderMutationRespectsOwnFolderAcl` —
proves a `documents.manage`-only caller cannot rename, reparent, or delete a
sensitive-gated folder (all three 404, and the delete-attempt test confirms
the entire subtree — folder, child folder, grandchild folder, and all three
documents — is untouched, not partially cascaded); two positive-control
tests prove a caller holding the folder's own permission can still rename it
and can still delete it, with the delete test asserting the cascade removes
every row two descendant levels deep (folder, child folder, grandchild
folder, and all three documents). Independently confirmed failing pre-fix
via `git stash` (the three bypass tests raised no `HTTPException`) and
passing post-fix; the positive-control delete test also served as the
reproduction case for the cascade bug above (it failed with an
`AssertionError` — the child folder survived — before that fix, distinct
from the `HTTPException`-based ACL failures).

**Correction (Codex round):** this write-up originally described the
regression fixture (`_org_with_sensitive_folder`) as proving a
`root → child → grandchild → document` cascade, echoing the ad-hoc
standalone fixture used to diagnose the model bug above. The actual pytest
fixture at the time only built a target folder, one child folder, and
documents — two levels, not three — so the claimed grandchild-level coverage
was not actually tested. Fixed by extending `_org_with_sensitive_folder` to
add a genuine grandchild folder and document and asserting its deletion (and
its survival in the bypass/untouched-subtree tests) alongside the existing
two levels — the write-up above and the regression-test description now
describe the fixture that actually runs, rather than narrowing the claim to
match the old, weaker fixture.

**Mirrored to** `docs/KNOWN_LIMITATIONS.md` (the two flagged sibling
relationships) and `CHANGELOG.md`.

### FAC-17 — MED (correctness) — `GET /{facility_id}/folders`'s return value never satisfied its own declared `FoldersListResponse`, so a real HTTP call 500'd on every path — ✅ FIXED

**Found by Codex review of this pass's own work** (thread on the FAC-13
write-up's own body, which describes the endpoint returning
`{"folders": [], "total": 0}` for the empty-list case). `FoldersListResponse`
(`schemas/documents.py`) requires `folders`, `total`, `skip`, and `limit` —
none of the last two are `Optional`. `get_facility_folders`'s return
statement only ever set `folders` and `total`, on the single return path
both the populated and the empty-list cases share. Once a facility is found
(past the 404 check), FastAPI's own response-model validation runs against
that dict on _every_ successful call and rejects it — `skip`/`limit` are
`Field required`, `msg: 'Field required'` — which FastAPI turns into a 500,
not the 200 with an empty (or populated) folder list the surrounding
documentation, the FAC-13 write-up above, and `TestFacilityFolderDocumentCountRedaction`'s
assertions all assume.

**Why the existing tests missed it:** `TestFacilityFolderDocumentCountRedaction`
(`test_facilities_folders.py`) calls `get_facility_folders` as a plain Python
coroutine and indexes straight into the dict it returns — that path never
goes through FastAPI's request/response cycle, so `response_model` validation
never runs and the missing fields were invisible to the suite.

**Verified independently:** reverted just the handler's return statement
(`git stash`), reran the route through a real ASGI request (`httpx.AsyncClient`
with `ASGITransport`, dependency-overriding `get_current_user`/`get_db` the
way `test_equipment_check_endpoint_permissions.py` already does elsewhere in
this suite), and reproduced the exact failure:
`fastapi.exceptions.ResponseValidationError`, two validation errors, one at
`loc: ('response', 'skip')` and one at `loc: ('response', 'limit')`.
Restored the fix and reran — 200 in both the empty and populated cases.

**Fix:** the return now includes `"skip": 0, "limit": len(sub_folders)`
alongside the existing `folders`/`total`. This route has no pagination
parameters of its own — a facility's folder tree is a small, fixed set (the
six sub-folders) — so `skip`/`limit` report the whole unpaginated result
rather than echoing request query params, unlike the generic `GET /folders`
in `documents.py` (`list_folders`), which does paginate and echoes
`pagination.skip`/`pagination.limit` back. Widening the response model
instead (making `skip`/`limit` optional) was rejected: `DocumentsListResponse`
and `FoldersListResponse` are shared pagination shapes used by an actually-
paginated sibling endpoint, and weakening the contract there to accommodate
one non-paginated caller would let a future paginated caller silently omit
the fields too.

**Regression test:** `TestFolderRouteResponseValidation`
(`test_facilities_folders.py`) — two new tests issue a real ASGI request
through the actual `facilities` router (not a direct handler call) for both
the empty-list and populated-list cases, and assert a 200 with `skip`/
`limit` present in the JSON body. Independently confirmed both fail with
`ResponseValidationError` against the pre-fix return statement and pass
against the fix.

**Mirrored to** `CHANGELOG.md`. No `KNOWN_LIMITATIONS.md` entry — unlike
FAC-13, this was a straightforward code fix, not a flagged design decision.

### FAC-18 — P1 (access control, IDOR) — `update_folder`'s reparent authorized only the folder's _current_ ancestry, never the _new parent_ — ✅ FIXED

**Found by Codex review of the FAC-16 fix commit (`489f8c9e`).** The same
"destination not checked" shape as FAC-15, one level up the tree: FAC-16 made
`update_folder` call `can_access_folder` on the folder being renamed or
reparented — but that check walks the folder's own (pre-move) ancestry, and
`DocumentsService.update_folder`'s DOC-6 FK validation on a reassigned
`parent_id` only confirms the new parent belongs to the caller's organization
(`assert_in_org`), never that the caller can access it.

**Impact:** a `documents.manage` holder with zero facilities permission could
reparent a folder they already have legitimate access to — and everything
inside it — into a sensitive-gated facility tree (Insurance & Leases, Capital
Projects) they cannot access at all, injecting an entire accessible subtree
into a folder ACL'd against them in one move. Same root cause as FAC-15,
here for folder reparenting instead of document moving.

**Verified independently:** read `update_folder` (`documents.py`) and
`DocumentsService.update_folder` (`documents_service.py`) in full and
confirmed the only check against a reassigned `parent_id` is `assert_in_org`
(same-org existence) plus `_creates_cycle` (self/descendant reparenting) —
neither asks whether the caller can access the new parent.

**Fix:** `update_folder` now resolves the new parent and calls
`can_access_folder` on it whenever `parent_id` is present in the update
payload, non-null, and different from the folder's current `parent_id` —
mirroring FAC-15's destination check on `update_document` exactly (404 if
the parent doesn't resolve in-org, 403 if it resolves but the caller can't
access it). Moving to root (`parent_id: null`) needs no destination check.

**Regression test:**
`tests/test_documents_access.py::TestFolderReparentRespectsNewParentAcl` —
proves a `documents.manage`-only caller cannot reparent an accessible folder
into a sensitive-gated parent (403, folder left where it was); a positive
control proves a caller holding the new parent's own permission still can;
a third test proves re-sending the unchanged `parent_id` alongside a rename
needs no destination re-check. Independently confirmed failing pre-fix via
`git stash` (the bypass test raised no `HTTPException`) and passing post-fix.

### FAC-19 — P2 (access control, IDOR) — `create_folder` never checked the supplied parent's ACL either — ✅ FIXED

**Found by Codex review of `489f8c9e`, same round as FAC-18.** `create_folder`
has the identical gap on the creation path: its DOC-6 FK validation on a
supplied `parent_id` only confirms the parent is in the caller's organization,
never that the caller can access it.

**Impact:** a `documents.manage` holder with zero facilities permission could
create a new child folder directly under a sensitive-gated facility folder
they cannot even read — injecting an arbitrary folder (and, subsequently,
documents into it via the now-accessible-to-them-alone new folder — though
FAC-15's fix still gates moving an _existing_ document there) into a tree
they are forbidden from browsing. Lower severity than FAC-18: the injected
folder itself starts empty and the attacker cannot then populate it via a
normal upload (`upload_document` already checks `can_access_folder` on its
destination), but the folder's existence and name are still an unauthorized
write into a restricted tree.

**Fix:** `create_folder` now resolves a supplied `parent_id` and calls
`can_access_folder` on it before creating the child (404 if the parent
doesn't resolve in-org, 403 if it resolves but the caller can't access it),
mirroring `upload_document`'s and FAC-15/18's destination checks. A root-level
create (no `parent_id`) needs no check.

**Regression test:**
`tests/test_documents_access.py::TestFolderCreationRespectsParentAcl` —
proves a `documents.manage`-only caller cannot create a folder inside a
sensitive-gated parent (403, nothing persisted); a positive control proves a
caller holding the parent's own permission still can; a third test proves a
root-level create needs no parent check. Independently confirmed failing
pre-fix via `git stash` and passing post-fix.

### FAC-20 — P1 (access control, cross-tenant, defense-in-depth) — `delete_folder`'s cascade walks `parent_id` with no organization filter — ✅ FIXED

**Found by Codex review of `489f8c9e`.** FAC-16's fix made
`DocumentFolder.children`'s cascade (`cascade="all, delete-orphan"`) actually
work. That cascade — and the ORM's own descendant-loading when
`self.db.delete(folder)` runs — walks `parent_id` alone, with no
`organization_id` filter at all; only the separate file-cleanup subtree walk
in `delete_folder` was org-scoped.

**Whether this is currently reachable:** searched every write path that sets
`DocumentFolder.parent_id` (`grep -n "parent_id" backend/app/services/
documents_service.py`, plus every other `DocumentFolder(` construction site
in the backend). Exactly two are client-facing — `create_folder` and
`update_folder` — and both validate a supplied `parent_id` via
`assert_in_org` (DOC-6), which fails closed on a cross-org id. Every other
writer (`ensure_member_folder`, `ensure_apparatus_folder`,
`ensure_facility_folder`, the events-root helper) derives `parent_id` from a
root folder it looked up itself, already scoped to the same `organization_id`
it's about to insert under — never from client input. So on the current
code, a cross-organization `parent_id` cannot be created through the
application today, and `document_folders.parent_id` has no same-organization
_database_ constraint (MySQL has no native way to express "this FK's
referenced row must share a value in another column" without a trigger) —
DOC-6 is an application-level guard on two specific call sites, not a schema
invariant.

**Why fixed anyway, not just flagged:** "cannot be created through the
application today" is not "verified impossible" — DOC-6 is exactly the kind
of guard a future writer can forget (as FAC-18/19 themselves just
demonstrated: two more call sites had the _organization_ check but not the
_ACL_ check, found only by review), and this repo's own git history is a
single synthetic/squashed baseline commit for this file
(`git blame`/`git log -S` both bottom out at one commit,
`692b9500`/`2026-08-31`), so "no window ever existed before DOC-6" cannot be
proven from history either — only "not reachable from current code." A row
imported directly, restored from an older backup, or written by a future
migration that forgets the guard would all bypass DOC-6 without touching any
of today's endpoints. CLAUDE.md Pitfall #14's own standard is "fail closed in
access-control helpers... if a referenced parent can't be resolved, deny,
don't grant" — the same standard applied here to a resolved-but-wrong-org
parent.

**Fix:** `delete_folder`'s subtree walk (already collecting file paths) now
fetches each level's `organization_id` alongside its `id` — still with no
`organization_id` filter on the query, deliberately, so it discovers exactly
what the ORM cascade below it would — and raises `ValueError` (→ 400,
`handle_service_errors`, added to the `delete_folder` route which had no
service-error wrapper before) the moment any discovered descendant's
`organization_id` doesn't match the caller's, before the delete runs at all.
The overwhelmingly common same-organization case is unaffected: the walk now
does one query per level instead of one org-filtered query per level, same
round-trip count as before.

**Regression test:**
`tests/test_documents_access.py::TestDeleteFolderRefusesCrossOrgCascade` —
constructs a folder in org A whose child folder was written directly with
`organization_id` set to org B (bypassing the service layer entirely, since
DOC-6 blocks the application from creating this state — this is the "written
before the guard existed, or by a future writer that forgets it" scenario,
reproduced directly rather than assumed), and asserts `delete_folder` raises
rather than deleting either row; a positive control proves an ordinary
same-organization subtree still deletes normally (including the cascade).
Independently confirmed failing pre-fix via `git stash` (the guard test
raised no `ValueError` and both rows were gone — the cascade reached the
cross-org child) and passing post-fix.

### FAC-21 — P1 (access control, IDOR) — `delete_folder`'s cascade never checked a descendant's _own_ `required_permissions`, only the root being deleted — ✅ FIXED

**Found by Codex review of this round's own fix commit (`8b8aeabf`), after
the sweep below was already written and had (wrongly) concluded no further
instance of this bug class remained.** `delete_folder`'s endpoint-level
`can_access_folder` check (FAC-16) authorizes the folder being deleted and,
through that call's own ancestor walk, everything _above_ it — but nothing
requires a descendant to be at least as permissive as its parent.
`required_permissions` is set per-folder independently; nothing in the data
model or the write paths (`create_folder`/`update_folder`) enforces that a
child's restrictions can only get looser going down the tree. A
`documents.manage` holder with no facilities grant, admitted at an
accessible parent folder, could therefore delete it and cascade-destroy a
more-restricted descendant nested beneath it — one they could never access
or delete directly, since `can_access_folder` on that descendant alone
would refuse them.

**Why the sweep missed it:** the sweep table's `DELETE /folders/{folder_id}`
row was accurate about what FAC-16 and FAC-20 (cross-org) each check, but
"the target folder's own ACL" was read as covering the whole subtree the
delete destroys — it doesn't; it only covers the one folder named in the
request. The same gap FAC-19's cross-org guard closed for _organization_
membership existed, unaddressed, for _permission_ membership.

**Verified independently:** confirmed the facility tree itself cannot
exercise this today — every facility folder, root through all six
sub-folders, currently carries the identical `FACILITY_SENSITIVE_PERMISSIONS`
(the FAC-13 bug), so there is no accessible-parent/inaccessible-child pair
in that tree yet. But `required_permissions` cannot be set via the API at
all (`DocumentFolderCreate`/`DocumentFolderUpdate` don't expose the field),
so this is purely a function of what system code stamps — and FAC-13's own
flagged remediation plan is to give exactly three of the six sub-folders a
_weaker_ tier than their siblings and parent, which would create precisely
this shape the day it lands. Fixing now, rather than flagging until then,
because the fix is mechanical and the alternative is landing FAC-13's
eventual remediation with this hole still open and forgotten.

**Fix:** `delete_folder`'s existing subtree walk (already extended once for
FAC-20's cross-org check) now also takes an optional `current_user` and,
for every descendant it visits, calls the same node-local
`_folder_admits_user` check `can_access_folder` uses per level — not a full
ancestor re-walk per descendant, which would be redundant: the walk already
visits every folder between the (already-authorized) root and each
descendant, so the AND of every `_folder_admits_user` result along the way
is exactly what a full `can_access_folder` computes. Raises the same
`ValueError` → 400 shape as FAC-20 the moment any descendant refuses the
caller, before anything is deleted. `current_user` is optional on the
service method (no client-facing caller reaches it without one today), and
the endpoint now passes it through.

**Regression test:** `tests/test_documents_access.py::
TestDeleteFolderRefusesInaccessibleDescendant` — constructs an accessible
root with a `required_permissions`-gated child underneath it and asserts
deleting the root 400s with nothing touched; a positive control proves a
caller holding the child's own permission can still delete the whole
subtree; a second positive control proves the pre-FAC-21 call shape (no
`current_user` passed) still works unchanged. Independently confirmed
failing pre-fix via `git stash` (`DID NOT RAISE HTTPException` — the delete
silently cascaded into the sensitive child) and passing post-fix.

**Mirrored to** `CHANGELOG.md`; no `KNOWN_LIMITATIONS.md` entry, since this
is a closed fix, not a flagged decision.

## Sweep — every `documents.py` route that accepts a `folder_id`/`parent_id`

FAC-18/19/20 came from three individual Codex findings; the task for this
round was also a systematic sweep of the rest of `documents.py` rather than
continuing to react one comment at a time. Every route in the file that
accepts a folder reference from the client, or resolves one to serve a
response, enumerated below. There is no copy/duplicate or bulk-operation
endpoint in this file — the full route list is 12 entries, all accounted for.
**This table's own "no further instance found" conclusion was itself wrong**
— see FAC-21 above, found by Codex review after this table was written; the
statuses below are updated to reflect the fix, not the sweep's original
(incomplete) read.

| Route                         | Folder references                               | Verified status                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /folders`                | `parent_id` (query, optional)                   | Read-only. `DocumentsService.get_folders` filters to `accessible_folder_ids` when `current_user` is passed — always is here. Safe by construction.                                                      |
| `POST /folders`               | `parent_id` (body, optional)                    | **FAC-19 — fixed this round.** Now checks `can_access_folder` on a non-null parent before creating.                                                                                                     |
| `PATCH /folders/{folder_id}`  | target folder (path) + `parent_id` (body, opt.) | Target: FAC-16 (prior round), unchanged, still checks `can_access_folder`. New parent: **FAC-18 — fixed this round.**                                                                                   |
| `DELETE /folders/{folder_id}` | target folder (path) + every descendant         | Target + org: FAC-16/FAC-20. **FAC-21 — fixed this round**: every descendant's own `required_permissions` is now checked too, not just the target folder named in the request.                          |
| `GET /` (list_documents)      | `folder_id` (query, optional)                   | Read-only. Checks `can_access_folder` on an explicit `folder_id`; an unfiltered listing is scoped to `accessible_folder_ids`. Unchanged, re-verified.                                                   |
| `POST /upload`                | `folder_id` (form, optional)                    | Checks `can_access_folder` on a non-null destination before saving. Unchanged, re-verified (this is the pattern FAC-15/18/19 all mirror).                                                               |
| `GET /my-folder`              | none (server-derived, `ensure_member_folder`)   | No client-supplied folder reference. Safe by construction.                                                                                                                                              |
| `GET /{document_id}`          | document's own folder (server-resolved)         | Checks `can_access_document`, which resolves the document's `folder_id` and calls `can_access_folder`. Unchanged, re-verified.                                                                          |
| `GET /{document_id}/download` | document's own folder (server-resolved)         | Same as above. Unchanged, re-verified.                                                                                                                                                                  |
| `PATCH /{document_id}`        | document's current folder + `folder_id` (opt.)  | Current: FAC-14 (prior round). Destination: FAC-15 (prior round). Both unchanged, re-verified. No cascade or subtree involved (a single document, not a folder), so FAC-21's shape does not apply here. |
| `DELETE /{document_id}`       | document's current folder (server-resolved)     | FAC-14 (prior round): checks `can_access_document`. Unchanged, re-verified. Same note as above — a single document, no subtree.                                                                         |
| `GET /stats/summary`          | none (aggregate over `accessible_folder_ids`)   | No client-supplied folder reference; DOC-4/FAC-9's separate aggregate-disclosure flag is out of scope here (it's about _what_ the summary reveals, not an ACL bypass).                                  |

**Every route in this file that touches a folder reference now authorizes
every folder it actually touches — source, destination, and (for the one
cascading operation, `DELETE /folders/{folder_id}`) every descendant in
between.** No further instance of this bug class found as of FAC-21; the
sweep's own miss here is itself evidence that "no further instance found"
in a table like this means "none found by this method," not "none exist" —
recorded so a later pass reads this claim with that caveat rather than at
face value.

**Superseded by FAC-24 below in one respect:** every "checks `can_access_folder`
[or `can_access_document`]" cell in the table above described _whether_ a
check ran, not _how strict_ it was. FAC-24 found that the check itself
admitted a caller on a read-only permission for what is, in every row of
this table, a mutation. The table's per-row conclusions ("fixed this round",
"unchanged, re-verified") still hold as to _whether an ACL check exists at
each site_ — FAC-24 is a correction to what that shared check requires, not
a reopening of any row's own finding.

### FAC-24 — P1 (access control, write-vs-read permission tier) — every check this sweep verified admitted a caller on a folder's read-only permission alone — ✅ FIXED

**Found by Codex review of this round's own sweep.** `can_access_folder`/
`can_access_document` (`documents_service.py`) — the one shared predicate
every row of the sweep table above relies on — admit a caller who holds
**any one** of a folder's `required_permissions`. For a sensitive facility
folder, that list is `facilities.view_sensitive` OR `.edit` OR `.manage`
(`FACILITY_SENSITIVE_PERMISSIONS`), an explicit **read-only** grant being one
of the three. That is the right question for a read (`get_document`,
`download_document`, the folder listing) but the wrong one for a write: the
facility-side mutation routes themselves never accept `view_sensitive` alone
— `update_facility_document`/`delete_facility_document`
(`facilities.py:967-1024`) require `facilities.edit`/`.delete`/`.manage`
specifically. FAC-14 through FAC-21 all closed "no check at all" or "checked
the wrong folder"; none of them asked whether the check they added or
verified was itself answering a write question with a read-admission
predicate.

**Impact:** a caller holding `documents.manage` (the org-wide generic-module
mutation grant) plus only a facility folder's read-tier permission — no
facilities write permission of any kind — passed every one of FAC-14
through FAC-21's checks. The seeded **treasurer** role is exactly this
combination: `DOCUMENTS_MANAGE` + `FACILITIES_VIEW_SENSITIVE`
(`core/permissions.py:1637-1644`), and none of `FACILITIES_EDIT`/`_DELETE`/
`_MANAGE`. A treasurer could therefore unfile, move, or delete a sensitive
facility document through the generic document routes, or rename, reparent,
delete, or inject a folder into the sensitive folder tree — despite holding
no facilities write permission whatsoever.

**Verified independently:** read `_folder_admits_user`
(`documents_service.py`) and confirmed it checks `required_permissions` via
`permission_matches_any` — an OR match with no distinction between the
entries' own read/write character. Read
`update_facility_document`/`delete_facility_document`
(`facilities.py:967-1024`) and confirmed both require `facilities.edit`/
`.delete`/`.manage` specifically, never `view_sensitive`. Read the seeded
`treasurer` role definition (`core/permissions.py:1617-1650`) and confirmed
`DOCUMENTS_MANAGE.name` and `FACILITIES_VIEW_SENSITIVE.name` are both
present, with none of `FACILITIES_EDIT`/`_DELETE`/`_MANAGE` — a real, live
combination, not hypothetical.

**Fix:** every permission family in this codebase names its read-only
actions `<module>.view` / `<module>.view_<detail>` and everything else as a
write (`create`/`edit`/`update`/`delete`/`manage`) — `is_read_only_permission`
and `permission_matches_any_write` (`core/permissions.py`) codify that
convention rather than inventing a new one. `_folder_admits_user`,
`can_access_folder`, and `can_access_document` (`documents_service.py`) take
a new `require_write` keyword: when set, a folder's `required_permissions`
are filtered down to their write-tier entries before matching, so a caller
holding only the read-only entry no longer satisfies the check. Applied
`require_write=True` at every site the sweep table above lists as a
mutation-gating check: document update/delete and its destination, folder
rename/delete and its destination (create's parent, update's reparent), and
— one level deeper — the descendant-ACL check FAC-21 added inside
`delete_folder`'s cascade walk, so a descendant admitting the caller only at
its read-only tier still aborts a delete the same way a directly-targeted
one would. A caller who holds the folder's own write-tier permission
(`facilities.edit`, in the treasurer's case still absent) is unaffected.

**Dangling reference on delete, also confirmed real and fixed:**
`FacilityDocument.file_path` (`app/models/facilities.py`) stores a plain
`"document:<uuid>"` string referencing the shared `documents` table
(`_validate_shared_document_reference`, `facilities.py:135-190`) — not a
foreign key. Deleting the referenced `Document` — via the generic
`DELETE /documents/{document_id}` or via a folder cascade delete — left that
string pointing at nothing: the facility record kept listing a document
entry that could never be downloaded again, with no error surfacing the
break. Fixed by a new
`DocumentsService._delete_facility_document_references` helper, called from
both `delete_document` and `delete_folder`'s cascade before the document
rows themselves are removed, in the same transaction — deletes any
`facility_documents` row (org-scoped) whose `file_path` names a document
being deleted.

**Regression tests:** `tests/test_documents_access.py::TestFolderWriteTierPermission`
(9 tests) reproduces the treasurer-shaped combination
(`documents.manage` + `facilities.view_sensitive`, no facilities write
grant) and proves it is refused on: unfiling a document, deleting a
document, renaming a folder, deleting a folder, moving a document into the
folder, reparenting a folder into it, and creating a folder under it — with
two positive controls proving a caller holding the folder's own write-tier
permission (`facilities.edit`) can still do each of these.
`TestDeleteDocumentCleansUpFacilityReference` (3 tests) proves deleting a
referenced document, or deleting the folder it sits in, removes the
facility's own reference, org-scoped (a same-string reference belonging to a
different organization survives). Independently confirmed all 12 fail
against the pre-fix code (`git stash` isolating just the source changes) —
the ACL bypasses raised no `HTTPException`, the dangling-reference tests
found the stale row still present — and pass once restored. Adapting these
also required widening every existing fixture in this file whose
`required_permissions` was `["facilities.view_sensitive"]` alone (matching
production's `FACILITY_SENSITIVE_PERMISSIONS`, not a single entry) and
changing each `_caller(..., facilities_permission=True)` positive control to
grant `facilities.edit` rather than the now-insufficient
`facilities.view_sensitive` — otherwise `require_write` would have made
every one of those positive controls unsatisfiable by any permission, since
their fixture's `required_permissions` listed only the one, now-filtered-out,
read-only entry.

**Mirrored to** `CHANGELOG.md`.

### FAC-25 — P1 (access control, write-vs-read permission tier) — `POST /documents/upload`'s folder-destination check was the one mutation site FAC-24 missed — ✅ FIXED

**Found by Codex review of the FAC-24 commit itself.** FAC-24 added
`require_write=True` to every folder-mutation call site it enumerated in its
sweep table, but `upload_document`'s own folder-destination check
(`documents.py`, `POST /documents/upload`) was not one of the rows that
sweep walked — it still called `can_access_folder(folder,
current_user.organization_id, current_user)` with the keyword's default
(`require_write=False`), left on the read-admission path FAC-24 was written
to close everywhere else.

**Impact:** the exact treasurer-shaped combination FAC-24 restricts
everywhere else — `documents.manage` + `facilities.view_sensitive`, no
facilities write grant — could still upload a file directly into a sensitive
facility folder via this one endpoint, bypassing the write-tier restriction
FAC-24 otherwise applies uniformly.
**Where:** `backend/app/api/v1/endpoints/documents.py`, `upload_document`
(the `can_access_folder` call gating the `folder_id` destination).
**Fix:** pass `require_write=True`, matching every other folder-destination
check in the file.
**Regression tests:**
`tests/test_documents_access.py::TestFolderWriteTierPermission::test_view_sensitive_alone_cannot_upload_into_the_folder`
(treasurer-shaped caller, real DB user so the FK `uploaded_by` constraint
doesn't mask the permission check, refused with 403) plus
`test_write_permission_can_upload_into_the_folder` (a `facilities.edit`
holder still succeeds). Independently confirmed the first test fails against
pre-fix code (`git stash` isolating the source change) — the upload
proceeded far enough to fail on an unrelated FK constraint after bypassing
the ACL check entirely — and passes post-fix.

**Mirrored to** `CHANGELOG.md`.

### FAC-26 — P1 (access control, permission-tier mismatch) — deleting a shared document cleaned up its facility reference without checking the facility-specific delete permission — ✅ FIXED

**Found by Codex review.** `DocumentsService.delete_document` (and
`delete_folder`'s cascade) called `_delete_facility_document_references`
unconditionally before removing the document row(s). The generic endpoints
reaching it — `DELETE /documents/{document_id}` and
`DELETE /documents/folders/{folder_id}` — are gated only by
`documents.manage`. The facility module's own document-delete route,
`delete_facility_document` (`facilities.py:1006-1017`), deliberately reserves
deletion for `facilities.delete`/`.manage` specifically — a stricter,
action-specific grant that FAC-24's `permission_matches_any_write` treats
`facilities.edit` as satisfying for a folder's own ACL (since a sensitive
folder's `required_permissions` typically lists both `.edit` and `.manage`),
but which the facility module's own delete route never accepts.

**Impact:** a caller holding `documents.manage` + `facilities.edit` — write-
capable by FAC-24's standard, but explicitly not `facilities.delete` — could
delete a shared document and silently remove its `FacilityDocument`
reference through the generic Documents endpoint (or a folder cascade),
bypassing the facility API's own delete-specific permission boundary
entirely. FAC-24's `require_write` fix stops a read-only-permission holder
from reaching this path at all, but does not distinguish `facilities.edit`
from `facilities.delete`/`.manage` once a caller is write-capable — a
distinction the facility module's own routes already make and the generic
document-delete path did not honor.
**Where:** `backend/app/services/documents_service.py`
(`_delete_facility_document_references`, `delete_document`, `delete_folder`);
`backend/app/api/v1/endpoints/documents.py` (`delete_document`).
**Fix:** threaded `current_user` through `delete_document` (mirroring
`delete_folder`'s existing optional `current_user` param — optional only so
the signature doesn't break a caller with no user in scope; every
client-facing route passes it). `_delete_facility_document_references` now
first checks (org-scoped) whether any `FacilityDocument` row actually
references the document(s) being deleted. If none does, the delete proceeds
regardless of this permission — the gate only engages when there is
something to protect. If a reference exists, the caller must hold
`facilities.delete` or `facilities.manage` (checked directly, not through
the folder-ACL's `required_permissions`) or the whole call raises
`PermissionError`, which the endpoint (wrapped in `handle_service_errors`,
matching every other mutation in this file) turns into a 403 — the entire
delete is refused, not just the reference cleanup, so the caller can't still
walk away with the document's bytes gone and only the facility metadata
intact.
**Regression tests:** `TestDeleteDocumentCleansUpFacilityReference` extended
with `test_without_facility_delete_permission_the_whole_delete_is_refused`
(a `facilities.edit`-holding, non-`facilities.delete` caller refused with
403; both the document row and the facility reference survive),
`test_folder_cascade_without_facility_delete_permission_is_refused` (same
refusal through a folder cascade delete), and
`test_no_facility_reference_deletes_regardless_of_the_permission` (a caller
with no facilities permission at all can still delete a document no
facility references, proving the gate is conditional on an actual
reference). The class's three pre-existing tests were updated to grant its
"can do it all" admin caller `facilities.manage` alongside `documents.manage`
— the tests were written before this permission existed to check and would
otherwise now fail with the fix in place, not because they exercise the
bypass, but because they no longer hold the permission the fix correctly
requires. Independently confirmed the two new refusal tests fail against
pre-fix code (`git stash` isolating the source change — the delete + cleanup
proceeded with no exception raised) and pass post-fix; the four other tests
in the class are unaffected.

**Mirrored to** `CHANGELOG.md`.

### FAC-27 — P2 (data integrity, dangling reference) — the facility-reference cleanup exact-matched a canonical string it built itself, missing valid non-canonical stored forms — ✅ FIXED

**Found by Codex review.** Facility create schemas accept `file_path` as an
unrestricted string; `_validate_shared_document_reference` (`facilities.py`)
validates the UUID suffix with `UUID(...)` — which accepts far more than one
form (mixed case, brace-wrapped, ...) — but stores the _original_ string
unchanged, not a normalized one. `_delete_facility_document_references`
built only the canonical lowercase, unbraced `document:{document_id}` form
and did an exact string `IN` match against it, so a validated, resolving
reference stored in any other accepted form never matched and was left
dangling once the document it pointed at was deleted.
**Where:** `backend/app/services/documents_service.py`
(`_delete_facility_document_references`).
**Fix:** rather than building one canonical string to match against,
`_match_facility_document_references` fetches every `"document:%"`-prefixed
reference in the org and re-parses each stored suffix with `UUID(...)`,
comparing the _parsed_ value — covering every form the validation path
accepts, not just the one the cleanup happened to construct. (A pure
case difference turned out to be insufficient to demonstrate the bug in
this repo's test database: MySQL's default collation compares
case-insensitively, so an uppercase suffix already matched the pre-fix exact
`IN` clause. The regression test instead uses a brace-wrapped suffix — a
literal character difference no collation folds away — to exercise the
actual defect regardless of collation.)
**Regression test:** `TestDeleteDocumentCleansUpFacilityReference::test_a_non_canonical_reference_form_is_still_cleaned_up`.
Independently confirmed to fail against pre-fix code (`git stash` isolating
the source change — the brace-wrapped reference survived the delete) and
pass post-fix.

### FAC-28 — P2 (data integrity, dangling reference) — the facility-reference cleanup swept `FacilityDocument` rows only, leaving `FacilityPhoto` references dangling — ✅ FIXED

**Found by Codex review.** `POST /facilities/photos` (`create_facility_photo`)
validates its `file_path` through the same `_validate_shared_document_reference`
used by `create_facility_document`, and stores it in `FacilityPhoto.file_path`
— the identical `"document:<uuid>"` reference shape. The cleanup added for
FAC-24/26 only ever queried and deleted `FacilityDocument` rows, so deleting
a shared document referenced by a facility photo (directly, or via a folder
cascade) left that photo row pointing at nothing, with no error surfacing
the break — the same class of defect the original FAC-24 fix closed for
`FacilityDocument`, just for a second table validated through the identical
path.
**Where:** `backend/app/services/documents_service.py`
(`_delete_facility_document_references`).
**Fix:** `_match_facility_document_references` (added for FAC-27) is
model-agnostic — it takes the SQLAlchemy model as a parameter, so it runs
once against `FacilityDocument` and once against `FacilityPhoto`.
`_delete_facility_document_references` now checks both, gates the whole
delete on the same `facilities.delete`/`.manage` permission if _either_
turns up a match, and deletes from both tables in the same transaction —
proceeding regardless of the permission only when neither table references
the document(s) being deleted.
**Regression tests:**
`TestDeleteDocumentCleansUpFacilityReference::test_deleting_the_document_removes_the_facility_photo_reference`
(a `facilities.manage` caller's delete removes a referencing photo row) and
`test_without_facility_delete_permission_a_photo_reference_also_blocks_the_delete`
(a `facilities.edit`-only caller is refused, mirroring FAC-26's document
case — the document and the photo reference both survive). Independently
confirmed both fail against pre-fix code (`git stash` isolating the source
change) and pass post-fix.

**Mirrored to** `CHANGELOG.md`.

### FAC-29 — P1 (access control, TOCTOU) — the facility-reference check and the reference-filing validation were each a plain SELECT, so a stale REPEATABLE READ snapshot could miss a concurrent commit on either side — ✅ FIXED

**Found by Codex review of the FAC-26/27/28 commit.** Both directions of this
read-then-write are a genuine race, not a hypothetical one, and both were
reproduced live against a real MySQL connection (two independently-
committing sessions — not the savepoint-based test fixture, which never
truly commits and so cannot demonstrate cross-transaction visibility):

- **Delete misses a reference committed mid-flight.** Under InnoDB's default
  REPEATABLE READ, a plain SELECT answers from the snapshot taken at the
  transaction's _first_ read — and the `delete_document` endpoint already
  reads the document once (to check folder access) before `delete_document`
  and its facility-reference existence check ever run, so that snapshot
  predates a reference someone else commits in between. Reproduced: a
  deleting transaction reads the document (establishing its snapshot), a
  second, real transaction files and commits a `FacilityDocument` reference,
  and the deleting transaction's (pre-fix) plain-SELECT existence check
  reported no reference at all — the delete would have proceeded
  unconditionally, past FAC-26's permission gate, leaving the just-created
  reference dangling the moment the delete committed.
- **A reference gets filed against a document already deleted.**
  Symmetrically, `_validate_shared_document_reference` (facilities.py) reads
  the `Document` row with a plain SELECT. Reproduced: an unrelated earlier
  read establishes the creating transaction's snapshot while the document
  still exists (modeling a request's own earlier reads, e.g. an auth
  dependency's user lookup), a second, real transaction deletes and commits
  the document, and the creating transaction's (pre-fix) plain read still
  resolved the document as existing — it would have filed a
  `FacilityDocument`/`FacilityPhoto` reference to a row already gone the
  moment both transactions finished, permanently dangling from the instant
  it committed (not merely until some later delete, unlike FAC-27/28).
  **Where:** `backend/app/services/documents_service.py`
  (`get_document_by_id`, `delete_document`, `_match_facility_document_references`);
  `backend/app/api/v1/endpoints/facilities.py` (`_validate_shared_document_reference`).
  **Fix:** a _locking_ read (`with_for_update()`/`for_update=True`) always
  reads the latest committed version regardless of when the transaction's
  snapshot was taken — the same pattern this codebase's capacity checks
  already use (CLAUDE.md Pitfall #27). `get_document_by_id` gained a
  `for_update` keyword (mirroring `scheduling_service.get_shift_by_id`);
  `delete_document` and `_validate_shared_document_reference` both now lock
  the `Document` row they read, serializing "delete this document" against
  "file a reference to this document" on the one row both sides share.
  `_match_facility_document_references`'s own SELECT is now also a locking
  read, so the existence check itself — not just the `Document` row — is
  immune to a stale snapshot.
  **Regression tests:** `tests/test_facility_document_reference_race.py`
  (new file; `@pytest.mark.integration`), using two real, independently-
  committing sessions to force each interleaving deterministically (no
  timing-dependent flakiness — the order of operations across the two
  sessions is fully controlled, not raced via `asyncio.gather`).
  `TestFacilityReferenceExistenceCheckIsALockingRead` reproduces the first
  race directly against `_match_facility_document_references`;
  `TestCreateReferenceValidationIsALockingRead` reproduces the second directly
  against `get_document_by_id`, asserting the plain read _does_ see the stale
  state (documenting the race) before asserting the locking read does not.
  Both independently confirmed to fail against pre-fix code (`git stash`
  isolating the source change) and pass post-fix.

**Mirrored to** `CHANGELOG.md`.

### FAC-30 — P2 (access control, permission-model gap) — FLAGGED, not fixed — a `facilities.delete`-only custom role cannot pass the generic Documents folder ACL at all, before or after FAC-24/26

**Found by Codex review**, and worth recording precisely because the finding
as posted is easy to misread as a regression from FAC-24/26. Verified
independently before deciding not to fix it:

**What Codex observed:** a custom caller holding `documents.manage` +
`facilities.view_sensitive` + `facilities.delete` (no `.edit`/`.manage`)
"passed the previous ACL check" (via `view_sensitive`, a read-tier grant)
and, per Codex's framing, holds the exact action-specific permission
`delete_facility_document` (`facilities.py:1006-1017`) itself accepts — yet
`require_write` now rejects them, since a sensitive folder's
`required_permissions` list (`FACILITY_SENSITIVE_PERMISSIONS`) is
`[facilities.view_sensitive, facilities.edit, facilities.manage]` and
**never included `facilities.delete` at all**.

**Why this is not a regression, and not something FAC-24/26 changed:**
`facilities.delete` was never a member of the folder's `required_permissions`
list, so `permission_matches_any` (the read-admission check, unchanged by
FAC-24) never admitted a `facilities.delete`-only caller either — before
FAC-24, this caller failed the read check and got a 404; after FAC-24, they
still fail the read check for the exact same reason (the permission is
simply absent from the list), and now also fail the narrower write check for
the same reason. `require_write` filtering the list down to its write-tier
entries didn't remove `facilities.delete` from anything — it was never in
the list to begin with. So "this caller passed the previous ACL check" is
not accurate: they never passed it, on either side of FAC-24/26.

**Confirmed no seeded role is affected:** `facilities.delete` appears in
`core/permissions.py` only bundled with `facilities.edit` **and**
`facilities.manage` together, on exactly three operational ranks
(`fire_chief`, `deputy_chief`, `assistant_chief`) — never alone. No seeded
role or rank holds `facilities.delete` without also holding `.manage` (which
already satisfies `require_write` outright). The gap is real only for a
department's own **custom** position that grants `facilities.delete` without
`.edit`/`.manage` — a combination nothing in this codebase's seed data
creates.

**Why this is flagged rather than fixed:** closing it isn't a mechanical
correction — it's a permission-model design question. `can_access_folder`'s
`required_permissions` list is a single read/write-filterable list shared by
every mutation the generic Documents API performs on a folder (rename,
reparent, delete, file/unfile a document). Teaching it a third,
action-specific tier (distinguishing "delete-capable" from "edit-capable"
within the write tier) — so that a `facilities.delete`-only holder can delete
through the _generic_ Documents API the same way they can through the
_facility-specific_ `delete_facility_document` route — is a real product
decision about whether the generic module should honor a facility-specific
action grant at all, not a bug this rotation's read-vs-write distinction is
positioned to answer. Flagging per CLAUDE.md's fix-vs-flag discipline rather
than making that call unreviewed.
**Where:** `backend/app/core/permissions.py` (`FACILITY_SENSITIVE_PERMISSIONS`
consumed by `can_access_folder`/`can_access_document` in
`documents_service.py`).
**Status:** deferred — needs a product decision on whether
`facilities.delete` alone should authorize a folder/document delete through
the generic Documents API, distinct from its existing authority on the
facility-specific delete route. Not mirrored to `CHANGELOG.md` (no code
change).

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

## Completion gate (pass 3, round 4 — Codex review of FAC-13's empty-list return, FAC-17)

FAC-15/FAC-16 (round 3, `489f8c9e`) landed without an accompanying gate
table here; this round's numbering continues from round 2 above rather than
re-using "round 3", which that commit's own message already claimed.

**Two issues were in play by the time this round finished; only one was
this round's own fix.** While investigating FAC-17, a coordinator report
surfaced a red "Backend Unit Tests" job on the PR's then-head (`489f8c9e`)
and attributed it to stale generated schema docs. Verified that attribution
was wrong before acting on it — `python scripts/generate_schema_docs.py
--check` was already clean on `489f8c9e` (relationship-metadata changes
like `DocumentFolder.children`'s `remote_side` fix carry no
table/column/FK/index representation for that generator to reflect), and the
job's own log showed the schema-docs step completing with no error. Reading
the same job's log in full found the real cause: `489f8c9e`'s own FAC-15/
FAC-16 regression test classes
(`TestUpdateDocumentRespectsDestinationFolderAcl`,
`TestFolderMutationRespectsOwnFolderAcl`) use the real `db_session` fixture
like their sibling `TestUpdateAndDeleteDocumentRespectFolderAcl` (FAC-14),
but were missing the `@pytest.mark.integration` marker that sibling carries
— so the DB-less "Backend Unit Tests" job (`pytest -m "not integration and
not slow and not docker"`, no MySQL service; see `.github/workflows/ci.yml`'s
own "no DB required" comment on that job) tried to run them anyway and
errored on all 8 with `Can't connect to MySQL server`. Before this round's
own fix commit could land, a separate, concurrent session pushed exactly
that fix (`acc4e29d`, "fix Backend Unit Tests CI failure -- mark two new
DB-backed test classes integration") — this round rebased onto it rather
than duplicating it. Re-verified post-rebase: unit-mode selection deselects
both classes (0 collected, previously 8 setup errors), and an integration-
mode run against a real database still passes all 8.

**This round's own fix is FAC-17** (see above): `get_facility_folders`'s
return value never satisfied `FoldersListResponse`.

| Check                                                                                                      | Result                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `flake8 app/api/v1/endpoints/facilities.py tests/test_facilities_folders.py`                               | ✅ 0 violations                                                                            |
| `black --check` (same two files)                                                                           | ✅ clean                                                                                   |
| `isort --check-only` (same two files)                                                                      | ✅ clean                                                                                   |
| `pytest tests/test_facilities_folders.py`                                                                  | ✅ 7 passed (+2, FAC-17's regression tests)                                                |
| `pytest tests/ -m "not integration and not slow and not docker"` (mirrors the "Backend Unit Tests" CI job) | ✅ 8474 passed, 1 skipped, 0 errors (was 8472 passed, 8 errors before `acc4e29d`'s fix)    |
| `pytest tests/ -k "facilities or documents"`                                                               | ✅ 263 passed, 1 skipped                                                                   |
| `pytest tests/` (full backend suite)                                                                       | ✅ 10006 passed (+2), 21 skipped (pre-existing) — no regression from the 10004/21 baseline |
| `python scripts/generate_schema_docs.py --check`                                                           | ✅ up to date — no model change this round                                                 |

**FAC-17's regression test independently confirmed against pre-fix code:**
`git stash` isolating just the `facilities.py` return-statement fix, then a
real ASGI request through `TestFolderRouteResponseValidation` — both new
tests failed with `fastapi.exceptions.ResponseValidationError` (`loc:
('response', 'skip')` / `('response', 'limit')`, `Field required`), the
exact failure Codex described; `git stash pop` restored the fix and both
passed.

## Completion gate (pass 3, round 5 — Codex review of `489f8c9e`)

Before starting, fetched the branch's current remote head and found it had
moved one commit past `489f8c9e` (`acc4e29d`, then `8b8aeabf` — the round 4
work directly above, landed by a concurrent session); merged cleanly
(fast-forward, then a manual reconciliation of this round's own draft
against round 4's overlapping response-model fix — see below) before
starting this round's own work.

Re-run after FAC-18/19/20's fixes (this round's three findings) below,
which close the last three Codex threads on `489f8c9e` (FAC-15/16's own
commit) plus a systematic sweep of every remaining folder/document route.
**A fourth Codex thread on `b5fdf79d` (the response-model bug on
`GET /{facility_id}/folders`) was independently found and fixed by this
round's own draft too — round 4 above landed it first as FAC-17, so this
round's duplicate fix (source and test alike) was dropped in favor of
round 4's, rather than shipping two fixes for the same bug under different
names.**

| Check                                                                                                                        | Result                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                                                                                         | ✅ clean                                                                    |
| `isort --check-only app/ tests/ alembic/`                                                                                    | ✅ clean                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                            | ✅ single head, no schema change                                            |
| `pytest tests/test_documents_access.py tests/test_facilities_folders.py`                                                     | ✅ 92 passed (+8 this round's own regression tests, on top of round 4's 84) |
| `pytest tests/` (full backend suite)                                                                                         | ✅ 10014 passed (+8 over round 4's 10006), 21 skipped (pre-existing)        |
| `npm run typecheck` (TypeScript 7 via `tsc-native.mjs`)                                                                      | ✅ 0 errors (no frontend code changed this round)                           |
| `eslint .`                                                                                                                   | ✅ clean, exit 0 (no frontend code changed this round)                      |
| `prettier` on the four markdown docs touched (`FAC-12-facilities.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`, `PROGRESS.md`) | ✅ clean                                                                    |

No model file was touched this round (only `documents.py`,
`documents_service.py`, and `tests/test_documents_access.py`), so
`scripts/generate_schema_docs.py` was not re-run — `DATABASE_SCHEMA.md` has
nothing to regenerate.

**All three regression tests independently confirmed against pre-fix code:**
`git stash` isolating just the three source files' fixes (keeping the new
tests unstashed), then running the three new test classes together —
`TestFolderCreationRespectsParentAcl`, `TestFolderReparentRespectsNewParentAcl`,
and `TestDeleteFolderRefusesCrossOrgCascade` — against the pre-fix code: the
three bypass tests (one per finding) failed exactly as expected (`DID NOT
RAISE HTTPException`/`ValueError`), while every positive-control test in the
same classes still passed (proving the tests target the fix, not some
unrelated setup issue). `git stash pop` restored all three fixes; the full
8-test set passed.

## Completion gate (pass 3, round 6 — Codex review of `8b8aeabf`)

Re-run after FAC-21's fix below, found by Codex on this round's own prior
commit after the sweep above had already (wrongly) concluded no further
instance of this bug class remained. Before starting, re-fetched the
branch's remote head and confirmed it had not moved past `8b8aeabf` since
round 5's push.

| Check                                                                                                                        | Result                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                | ✅ 0 violations                                                      |
| `black --check app/ tests/ alembic/`                                                                                         | ✅ clean                                                             |
| `isort --check-only app/ tests/ alembic/`                                                                                    | ✅ clean                                                             |
| `python3 scripts/validate_migrations.py --strict`                                                                            | ✅ single head, no schema change                                     |
| `pytest tests/test_documents_access.py tests/test_facilities_folders.py`                                                     | ✅ 95 passed (+3 this round's regression tests)                      |
| `pytest tests/` (full backend suite)                                                                                         | ✅ 10017 passed (+3 over round 5's 10014), 21 skipped (pre-existing) |
| `npm run typecheck` (TypeScript 7 via `tsc-native.mjs`)                                                                      | ✅ 0 errors (no frontend code changed this round)                    |
| `eslint .`                                                                                                                   | ✅ clean, exit 0 (no frontend code changed this round)               |
| `prettier` on the four markdown docs touched (`FAC-12-facilities.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`, `PROGRESS.md`) | ✅ clean                                                             |

No model file was touched this round, so `scripts/generate_schema_docs.py`
has nothing to regenerate.

**FAC-21's regression test independently confirmed against pre-fix code:**
`git stash` isolating just the `documents.py`/`documents_service.py` fixes
(keeping the new test class unstashed), then running
`TestDeleteFolderRefusesInaccessibleDescendant` alone — the bypass test
failed with `Failed: DID NOT RAISE HTTPException` (the delete silently
cascaded into the sensitive child), both positive-control tests still
passed. `git stash pop` restored the fix; all three passed.

## Completion gate (pass 3, round 7 — Codex review of FAC-14/15/16's own predicate; FAC-24)

PR #2191 merged (`f5e800f1`) before this round's fix could be pushed to it —
per CLAUDE.md Pitfall #24, work continues on a new branch
(`claude/security-review-facilities-followup`) and a new PR rather than
reusing the merged one. Rebuilt this round's changes against a fresh
`origin/main` (which already carried FAC-17 through FAC-21 from concurrent
sessions) rather than against the pre-merge state they were first drafted
against — `can_access_folder`/`can_access_document`/`_folder_admits_user`
had no `require_write` support on `main` at rebuild time, confirmed by
grepping the fresh checkout before writing a line, so this is not
duplicate work.

| Check                                                                    | Result                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                            | ✅ 0 violations                                                                             |
| `black --check app/ tests/ alembic/`                                     | ✅ clean (1405 files)                                                                       |
| `isort --check-only app/ tests/ alembic/`                                | ✅ clean                                                                                    |
| `python3 scripts/validate_migrations.py --strict`                        | ✅ single head, no schema change                                                            |
| `python3 scripts/generate_schema_docs.py --check`                        | ✅ up to date — no model change this round                                                  |
| `pytest tests/test_documents_access.py tests/test_facilities_folders.py` | ✅ 107 passed (+12 for this round's tests)                                                  |
| `pytest tests/ -k "facilities or documents"`                             | ✅ 286 passed (+12), 1 skipped (pre-existing)                                               |
| `pytest tests/` (full backend suite)                                     | ✅ 10029 passed (+12), 21 skipped (pre-existing) — no regression from the 10017/21 baseline |

**FAC-24's regression tests independently confirmed against pre-fix code:**
`git stash` isolating just the source changes to `documents.py`,
`documents_service.py`, and `core/permissions.py` (keeping the new/adapted
test files in place), then running `TestFolderWriteTierPermission` and
`TestDeleteDocumentCleansUpFacilityReference`. All 10 new bypass/reference
tests failed pre-fix — `DID NOT RAISE HTTPException` on every bypass, the
stale `facility_documents` row still present on both dangling-reference
tests — while the 2 positive-control tests already passed (they had genuine
access before this fix too). `git stash pop` restored the fix and all 12
passed.

**Also fixed in this round, same discipline as the two prior comment-history
findings on this PR:** trimmed the `documents.py`/`documents_service.py`
comments this round's own edits touched that had drifted back into
review-round narration (`"FAC-16 (Codex follow-up on FAC-14)"`,
`"FAC-17 (Codex round 4 on FAC-14/15/16)"`, `"FAC-21 (Codex, round 6)"`) down
to durable rationale only — the same class of issue fixed at earlier points
in this PR's history, recurring because each new round's fix is drafted
independently and the convention isn't machine-checked.

**Two additional doc corrections, same round:** (1) the FAC-16 write-up's
regression-test description claimed a `root → child → grandchild → document`
cascade the actual `_org_with_sensitive_folder` fixture didn't build (two
levels, not three) — fixed by extending the fixture rather than narrowing
the claim (see the correction note under FAC-16 above). (2) `CHANGELOG.md`'s
FAC-13 entry named the seeded `quartermaster` role among those refused
access through the generic Documents module, but quartermaster has no
`documents.view` grant and so could never reach that module either before or
after the regression — corrected to scope that specific claim to the three
roles that actually hold `documents.view` (secretary, safety officer,
training officer), while quartermaster stays correctly named as affected by
the direct `/{facility_id}/folders` endpoint's own gate.

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
