# Security Review 12 — Facilities

**Prefix:** `FAC` · **Iteration:** 12 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-28 (pass 2), 2026-09-03 (pass 3) · **PR:** [#1836](https://github.com/thegspiro/the-logbook/pull/1836) (pass 1), [#1959](https://github.com/thegspiro/the-logbook/pull/1959) (pass 2), [#2191](https://github.com/thegspiro/the-logbook/pull/2191) (pass 3), [#2194](https://github.com/thegspiro/the-logbook/pull/2194) (FAC-22, FAC-23, urgent post-merge fix), [#2195](https://github.com/thegspiro/the-logbook/pull/2195) (FAC-24 through FAC-28, pass 3 continued, merged), [#2198](https://github.com/thegspiro/the-logbook/pull/2198) (FAC-29 through FAC-33 fixed, FAC-30 flagged; FAC-34 fixed; FAC-35 fixed — the total-order fix superseding FAC-32/34; FAC-36 fixed — the third call site FAC-35 flagged for revisit; FAC-37/FAC-38 fixed (test-only); FAC-39 fixed (test-only, full-file sweep) — pass 3 continued)

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

### FAC-31 — P1 (access control, TOCTOU) — FAC-29's lock protected the validation step, but committed before the reference it validated for was ever inserted — ✅ FIXED

**Found by Codex review of the FAC-29 commit.** FAC-29 locked the `Document`
row `_validate_shared_document_reference` reads, but validating the
reference and actually filing it are two separate steps:
`_validate_shared_document_reference` locks the document and (for a
folderless document) assigns it a facility folder; the caller
(`create_facility_document`/`create_facility_photo`) inserts the
`FacilityDocument`/`FacilityPhoto` row that records the reference only
_after_ that function returns. The function's own `await db.commit()` at the
end of the folder-assignment branch released the lock immediately — before
the row the lock was supposed to protect even existed.

**What that reopens:** a concurrent `delete_document` can acquire the lock
in the gap between that commit and the caller's insert, run its
facility-reference existence check, see nothing (because the reference truly
has not been filed yet), delete the document and its backing file, and
commit — all while the original request is mid-flight. The original request
then proceeds to insert a `FacilityDocument`/`FacilityPhoto` row whose
`file_path` points at a document that no longer exists: FAC-29's own race,
reopened one step later in the same sequence it was meant to close, and with
FAC-26's permission gate never even engaged (no reference existed yet for it
to protect).

**Where:** `backend/app/api/v1/endpoints/facilities.py`
(`_validate_shared_document_reference`, `create_facility_document`,
`create_facility_photo`).

**Fix:** stop committing inside `_validate_shared_document_reference`.
Flushing (not committing) the folder assignment keeps the document's `FOR
UPDATE` lock held for the rest of the request, across both the
`ensure_facility_folder` call and the caller's own
`FacilityDocument`/`FacilityPhoto` insert, in the one transaction the
endpoint's `get_db` dependency already commits once at the end (or rolls
back whole, on any failure in between). The lock is now released only when
the reference has either been filed in the same transaction or never will
be.

**Regression test:** `tests/test_facility_document_reference_race.py`,
`TestReferenceInsertStaysUnderTheDocumentLock`. Proving this needed more than
a stale-read comparison (unlike FAC-29's tests): the fix's whole effect is
that a concurrent session genuinely _blocks_ on the still-held lock rather
than resolving a stale value, and a plain sequential `await` between two
independent sessions cannot observe a block. The test runs the deleting
session's `delete_document` as a background task while the creating
session's transaction is still open and checks whether it has completed
after a short pause: pre-fix, it completes immediately (the lock was already
released) and the creator goes on to file a reference to what is now a
deleted document; post-fix, it is still pending (genuinely blocked on the
lock), and only proceeds — now correctly refused by FAC-26's permission
check, since the reference exists by the time it resumes — once the creator
finishes and commits. Confirmed to fail against pre-fix code (`git stash`
isolating the source change, reproducing a real dangling reference in the
database) and pass post-fix.

**Mirrored to** `CHANGELOG.md`.

### FAC-32 — P2 (reliability, lock-ordering deadlock) — `delete_folder`'s cascade took the same two locks as the FAC-31 creator path in the opposite order — ✅ FIXED

**Found by Codex review of the FAC-29 commit**, alongside FAC-31. FAC-31's
fix makes the creator path lock a `Document` row first, then (still holding
it) insert into the `FacilityDocument`/`FacilityPhoto` reference table.
`delete_folder`'s cascade — which also touches both of those — did it
backwards: it called `_match_facility_document_references` (a broad,
organization-scoped `SELECT ... FOR UPDATE` over the reference table) before
ever locking the subtree's `Document` rows, which only happened afterward,
implicitly, when the ORM's `delete-orphan` cascade deleted them.

**Why that is a deadlock, not just a staleness risk:** two transactions
taking the same two locks in opposite orders is the textbook shape. With a
creator (Document row, then reference table) and this cascade (reference
table, then Document row) running concurrently against overlapping rows, the
creator's reference-table insert can block on a gap lock the cascade's scan
is holding, while the cascade's later need for the same Document row blocks
on the lock the creator already holds — neither can proceed, and InnoDB
kills one side with `Deadlock found when trying to get lock`. There is no
retry around either endpoint, so the killed transaction surfaces as a bare 500.

**Where:** `backend/app/services/documents_service.py` (`delete_folder`,
the call to `_match_facility_document_references` via
`_delete_facility_document_references`).

**Fix:** add `.with_for_update()` to the subtree's `Document` id/file-path
query and run it before `_delete_facility_document_references`, so this
cascade acquires the two shared locks in the same order the FAC-31 creator
path does — Document row(s) first, then the reference table. Matching lock
order is what turns a potential deadlock back into ordinary serialization:
whichever transaction gets there first makes the other wait, rather than
both waiting on each other.

**Regression test:** `tests/test_facility_document_reference_race.py`,
`TestDeleteFolderLocksDocumentsBeforeTheReferenceTable`. A true two-session
InnoDB deadlock is inherently timing-sensitive to force on demand (both
sides must be simultaneously blocked on each other for the engine to detect
it), so — per this rotation's own escalation discipline when a live repro's
reliability is in doubt — the test instead asserts the concrete, observable
effect of the ordering fix: with a `Document` row locked by one session,
`delete_folder`'s cascade (run in a second, real session) blocks on that
lock immediately, _before_ it ever reaches the reference-table scan, proving
the new order directly rather than depending on the engine's deadlock
detector actually firing within a test timeout.

**Mirrored to** `CHANGELOG.md`.

### FAC-33 — P1, test-only (CLAUDE.md "Fix All Errors") — the two-session test fixture's teardown swallowed any rollback failure with a blanket `except Exception: pass` — ✅ FIXED

**Found by Codex review of the FAC-29 commit.**
`test_facility_document_reference_race.py`'s `two_sessions` fixture wrapped
each session's teardown `rollback()` in `try/except Exception: pass`. Per
CLAUDE.md's "Fix All Errors" policy, silently discarding a runtime failure
hides a broken connection or an unreleased transaction until some later,
unrelated test fails or hangs for no apparent reason — exactly the class of
bug this file's own subject matter (lock lifetimes across two real sessions)
makes plausible to hit here of all places.

**Verified before fixing, per the file's own guidance:** ran both a clean
session's `rollback()` and one on an already-`close()`d session against this
backend (MariaDB via the async driver this app uses) — neither raises.
There is no known-benign exception to narrow the catch to; the blanket catch
was pure risk with no corresponding case it was protecting against.

**Where:** `backend/tests/test_facility_document_reference_race.py`
(`two_sessions` fixture).

**Fix:** removed the `try/except` entirely. A rollback failure during
teardown now fails the test that triggered it, in the same way any other
uncaught exception would.

**Mirrored to** `CHANGELOG.md`.

### FAC-34 — P2 (reliability, lock-ordering deadlock) — a _third_ shared resource FAC-32 didn't cover: the destination `DocumentFolder` a folderless-document creator locks via `ensure_facility_folder` — ✅ FIXED

**Found by Codex review of the FAC-32 commit (`d0ec9194`).** FAC-32 ordered
this cascade's two shared locks (`Document` rows, then the reference table)
to match the FAC-31 creator path. But the creator path takes a _third_
shared lock in between those two, and only when the document being filed
has no folder yet: `_validate_shared_document_reference` (facilities.py)
locks the `Document` row, then — via `ensure_facility_folder` — the
destination `DocumentFolder`, and only _then_ flushes `document.folder_id`
onto it. `delete_folder`'s cascade never explicitly locked its own subtree's
`DocumentFolder` rows at all; the only lock it ever took on them was the
implicit one the folder's own `DELETE` takes at commit, which lands _after_
the (FAC-32-ordered) Document lock and the reference-table scan. Codex's
claim: a creator racing to file a folderless document into a facility folder
this cascade is concurrently deleting could still deadlock, because the
cascade's Document-lock query (`Document.folder_id.in_(subtree_ids)`) can
itself block a concurrent `document.folder_id` write before this cascade
ever reaches an explicit folder lock.

**Verified real, not merely plausible — with two real, independently-committing sessions, at the SQL locking-primitive level directly (not
just through the application code), because the exact mechanism turned out
to be more subtle than the finding's own wording:**

- A raw `Document.organization_id == org AND Document.folder_id.in_({one folder id}) FOR UPDATE` — with a locking `Document` read already held on a
  _different_ row and nothing else touching `folder_id` yet — completed
  instantly, finding no rows, and then the creator's own later
  `document.folder_id = <that folder>` flush **blocked indefinitely**: a
  gap/next-key lock left behind by the first query, at the value the flush
  was about to insert.
- The _same_ race, run through the actual `delete_folder` (whose subtree for
  a facility folder is never one id — root plus `FACILITY_SUB_FOLDERS`,
  seven), instead showed the cascade's Document-lock query itself blocking —
  confirmed via `SHOW FULL PROCESSLIST` / `information_schema.innodb_trx`
  against the live query — apparently because MySQL/MariaDB's optimizer
  chose a different index for a seven-value `IN` than for a one-value `IN`,
  scanning (and blocking on) the creator's already-locked, unrelated
  `Document` row before the `folder_id` filter was ever applied. In that
  arrangement the cascade blocks first and never accumulates the
  reference-table lock, so no cycle forms — the query planner's choice
  happened to serialize the two sides safely, not the code.

That second result does **not** mean the finding is a false positive on the
real `delete_folder` path — it means the underlying InnoDB locking behaviour
for this query is plan-dependent, and a database with a realistic volume of
documents per organization (where `idx_documents_folder`, not the
organization-scoped index, becomes the selective choice for a small subtree)
would plausibly hit the first, genuinely cyclic mechanism instead. Relying on
an incidental query-plan choice to keep two transactions from deadlocking is
not a fix; it is a coincidence of this review's near-empty test database.

**Where:** `backend/app/services/documents_service.py` (`delete_folder`,
between the subtree walk and the FAC-32 Document-lock query).

**Fix:** lock the subtree's `DocumentFolder` rows first — _before_ the
Document-lock query, not after (and not merely between it and the
reference-table scan, which was this session's own first, insufficient
attempt: placing the folder lock after the Document-lock query does nothing,
because by then the Document-lock query has already run and already
produced whichever plan-dependent blocking behaviour it was going to
produce). With the folder locked first, this cascade either wins the race
outright (nothing below has run yet, so it cannot be holding anything the
creator needs) or loses it and blocks immediately — before ever issuing the
Document-lock query that could otherwise trap a concurrent creator's flush,
regardless of which index that query's plan would have used. The two
queries were extracted into `_lock_subtree_folders`/`_lock_subtree_documents`
so a test can assert the _ordering_ directly (patch-and-track, the same
technique FAC-32's own test uses) rather than depend on forcing one specific
InnoDB plan.

**Regression test:**
`tests/test_facility_document_reference_race.py`,
`TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery`. Same
engine-independence rationale as FAC-32's own test — a genuine two-session
deadlock is inherently plan- and timing-sensitive to force on demand — so
this asserts the concrete, deterministic effect instead: with the
destination folder locked by one session (`ensure_facility_folder`'s "found"
path), `delete_folder` run in a second, real session blocks on _that_ lock,
and never issues its `_lock_subtree_documents` query while blocked.
Confirmed against pre-fix code via `git stash` (fails — the extracted method
does not exist without the fix's refactor) and passing post-fix; the deeper
locking-primitive behaviour above was independently confirmed live, outside
pytest, with `SHOW FULL PROCESSLIST`/`information_schema.innodb_trx`
inspection while the block was held.

**Mirrored to** `CHANGELOG.md`.

### FAC-35 — P2 (reliability, lock-ordering deadlock) — the total-order fix that supersedes FAC-32 and FAC-34's pairwise reorderings — ✅ FIXED

**Found by Codex review of the FAC-34 commit (`b651b5cc`), at
`documents_service.py:656`.** FAC-34 reordered `delete_folder`'s cascade to
lock the subtree's `DocumentFolder` rows before its `Document` rows —
correct for the conflict it was fixing (this cascade's Document-lock query
trapping a concurrent creator's `document.folder_id` flush), and verified
against the FAC-32 pairing it had to preserve (Document before the reference
table). What it did not check is that reordering _created a new conflict
with a third path_: the FAC-31-fixed creator (`_validate_shared_document_reference`
in `facilities.py`) still locked `Document` first, then `DocumentFolder`
(via `ensure_facility_folder`) — the exact opposite of the order FAC-34 had
just given the cascade. Two paths taking the same two locks in opposite
orders is the textbook deadlock shape FAC-32 closed for the
Document/reference-table pair, reopened here for the Document/DocumentFolder
pair: a cascade that has locked the destination folder and a creator that
has locked the document being filed into it can each end up waiting on the
resource the other holds.

**This is the second time in a row a pairwise reorder created a different
pairwise conflict** (FAC-32 ordered Document/reference-table; fixing the
Document/DocumentFolder conflict against it (FAC-34) put Document/DocumentFolder
in one order in the cascade while the creator — never touched by either
fix — still used the other). Each of FAC-29/31/32/34 individually verified
its own fix closed the _specific_ interleaving reported, without checking
the result against _every other_ path touching the same shared state. This
finding does that check, and replaces the pairwise-reorder pattern with a
single total order instead of reordering one more pair.

**The canonical order chosen:** `DocumentFolder`, then `Document`, then the
`FacilityDocument`/`FacilityPhoto` reference table — documented as a
module-level note at the top of `documents_service.py` (immediately after
`FACILITY_SENSITIVE_PERMISSIONS`), so a future call site checks against one
written source of truth instead of inferring an order from whichever
existing function it reads first. This is `delete_folder`'s order exactly as
FAC-32/34 left it — no change was needed on the cascade side. `DocumentFolder`
sorts first because the mechanism FAC-34 identified is not really about the
`Document` row as a primary-key lock at all: assigning `document.folder_id`
is a write against the `folder_id` secondary index, and FAC-34's own
verification showed a locking read filtered on that column can block a
concurrent write to it (a gap/next-key lock) even when it currently matches
no rows, or — depending on which index the query optimizer picks — block
outright on some other, unrelated row of the same organization that happens
to be examined first. Either behaviour is plan-dependent and not something
either code path controls, so the only order immune to it is one where
nothing ever issues a `Document`/`folder_id` operation before the specific
`DocumentFolder` row it concerns is already locked. Locking the folder first
in both paths removes the dependency on that query plan entirely, the same
way FAC-34 removed it for the cascade alone.

**Where:** `backend/app/api/v1/endpoints/facilities.py`
(`_validate_shared_document_reference` — reordered);
`backend/app/services/documents_service.py` (module-level canonical-order
note, added; `delete_folder` — comment updated to point at it, no lock-order
change).

**Fix:** `_validate_shared_document_reference` now resolves and locks the
destination `DocumentFolder` (via `ensure_facility_folder`) _before_ it
locks the `Document` row, matching the cascade's existing order. This is
resolved **unconditionally** — even for a document that already has a
folder and will not be reassigned — rather than only when a preliminary
read says the document is folderless. That is a deliberate choice, not an
oversight: `document.folder_id` is client-writable through the generic
`PATCH /documents/{id}` endpoint (`DocumentsService.update_document`,
confirmed via `grep` as the _only_ other writer of `Document.folder_id` in
the backend — including a legal `null`, "moves the document to org level"),
and that write is not itself a locking read. An unlocked peek at
`document.folder_id`, taken before the document's own `FOR UPDATE` lock, to
decide "does this request need the folder lock" would create a window in
which a concurrent `PATCH` clears the field after the peek but before the
locked read — and a creator that skipped the folder lock based on the stale
peek would then, correctly per its own (now-wrong) decision, leave the
document unfiled: a facility reference left pointing at an org-level,
unfiled document, which is precisely the vulnerability
`_validate_shared_document_reference` exists to close (see the function's
own docstring). The pre-FAC-35 code never had this window, because its
single locked read of `Document` was also the only read the "assign or not"
decision was ever based on — decoupling that decision from the lock (to buy
back the folder-lock-only-when-needed optimization) would have reopened it.
Resolving the folder unconditionally keeps the actual assignment decision
exactly where it always was — the `Document` row's own locked,
authoritative read — while still achieving a lock order with no exceptions
to remember.

One observable side effect: a request that references an already-filed
document against a nonexistent `facility_id` now gets `404 Facility not
found` directly from this function (as unfiled documents already did),
rather than reaching `FacilitiesService.create_document`/`create_photo`'s
own `assert_in_org` check downstream (`400`). No test asserted the old,
inconsistent behaviour (grepped `backend/tests/` for both status codes
against this scenario); the two are equivalent in intent — neither responds
in a way a caller could use to distinguish "wrong org" from "does not
exist" — and the fix makes the two branches agree instead of only one of
them getting the check.

**Regression tests:** `tests/test_facility_document_reference_race.py`, two
new classes, driving the _real_ `_validate_shared_document_reference` (not a
hand-reconstructed lock sequence, unlike FAC-34's own test — see its updated
comment there, which now explains why its manual replication still tests
something valid: `delete_folder`'s own behaviour, independent of whoever
holds the folder lock):

- `TestCreatorLocksTheFolderBeforeTheDocument` — the direction that had no
  coverage at all before this fix. A cascade-like session locks the
  destination `DocumentFolder` first (`_lock_subtree_folders`, exactly as
  `delete_folder` does); the real creator function, raced in as a
  background task, must block there _before_ it ever issues its own
  `Document` lock query. Confirmed to **fail** against pre-fix code via
  `git stash` (the pre-fix creator locked `Document` immediately, never
  deferring to the folder lock at all — `document_lock_reached` was set
  before the blocking assertion even ran) and pass post-fix.
- `TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar` — the mirror
  direction, built the hard way on purpose. An earlier draft of this test
  let the creator run to full completion (holding both locks) before
  starting the cascade — and passed against **both** pre- and post-fix code,
  because a creator that has already finished holds both locks regardless
  of which order it acquired them in; that shape cannot discriminate the
  fix from its absence, since `delete_folder`'s own order was never in
  question here (FAC-34 already covers it). The corrected version pauses
  the real creator, via a patched, event-gated `get_document_by_id`, at the
  exact instant it is about to lock the `Document` row — post-fix, this is
  strictly after the destination folder is already locked; pre-fix, it is
  the creator's very first locking call, before any folder has been
  touched. Only the post-fix window has the property the finding is about
  (folder held, document not yet). Confirmed to **fail** against pre-fix
  code via `git stash` (nothing blocks the cascade at that pause point, and
  it runs straight through to, and past, the Document-lock query) and pass
  post-fix.

Both tests were also run five times in a row post-fix with no failures (no
flakiness from the event-based pause/release synchronization), and the full
`tests/test_facility_document_reference_race.py` file (7 tests total, the 5
pre-existing plus these 2) passes together.

**Two existing unit tests in `test_facilities_permissions.py` needed
updating**, not because their invariants changed but because the
unconditional folder resolution described above changes which mocks a
call now reaches: `test_shared_file_reference_leaves_an_already_filed_document_alone`
now also mocks `FacilitiesService.get_facility` and asserts
`ensure_facility_folder` **is** awaited (previously asserted the opposite) —
its real invariant, that `document.folder_id` is left untouched, is
unchanged and still asserted; `test_shared_file_reference_rejects_cross_organization_document`
now also mocks `get_facility`/`ensure_facility_folder` so the test reaches
the same `get_document_by_id`-returns-`None` → `404` path it always tested,
rather than failing earlier on an unmocked `FacilitiesService(db).get_facility`
call against a bare `AsyncMock` session (confirmed this is exactly what
happened: `pytest tests/ -k "facilities or documents"` failed both, with
`AttributeError: 'coroutine' object has no attribute 'id'` from the
unmocked call, before these two tests were updated).

**Manual trace of both interleavings, post-fix** (the check the four prior
rounds each skipped — verifying a fix against every _other_ path touching
the same resources, not just the one interleaving that was reported):

1. _Cascade reaches the folder first._ Cascade locks `DocumentFolder`
   (`_lock_subtree_folders`), then blocks nothing (nothing else is
   contending yet), proceeds to lock `Document` rows
   (`_lock_subtree_documents`), then the reference table, then commits. A
   concurrent creator's `ensure_facility_folder` call blocks on the
   cascade-held `DocumentFolder` row immediately — before the creator has
   locked anything else at all (per FAC-35's fix, `Document` is locked
   _after_ the folder). The creator simply waits; no cycle, because the
   creator holds nothing the cascade needs.
2. _Creator reaches the folder first._ Creator locks `DocumentFolder`, then
   `Document`, then (FAC-31) holds both while the caller inserts the
   reference row, then commits once. A concurrent cascade's
   `_lock_subtree_folders` blocks on the creator-held folder immediately —
   before the cascade has issued any `Document` query at all. The cascade
   waits; no cycle, because the cascade holds nothing the creator needs.
3. _Both start at approximately the same instant._ Whichever session's
   `DocumentFolder` lock request InnoDB/MariaDB serializes first wins outright
   (case 1 or case 2, from that point on); the other blocks on that single,
   explicit, primary-key-scoped row lock — not on a plan-dependent scan or
   gap lock, since the folder lock is always the first shared resource
   either side touches. No third resource is ever acquired by the loser
   before the winner already holds the one lock the loser is waiting on, so
   no cycle can form regardless of which side wins the race.

No interleaving was found in which the two paths wait on each other. The
`Organization` row `ensure_facility_folder` also locks (for its own,
FAC-27-style get-or-create race, unrelated to this finding) is only ever
locked by the creator path — `delete_folder`'s cascade never touches it —
so it is not part of this three-resource ordering problem and was left out
of the canonical-order note.

**Whether this needs a runtime lock-order assertion, not just documentation
and tests:** considered and rejected for now, on scale grounds. Only two
call sites in the whole backend acquire more than one of these three
resources together (the ones this finding fixes), and this pattern — a
shared reference table bridging two modules' own primary resources, with a
third, cross-cutting delete cascade — does not recur elsewhere in this
codebase's other ~30 service files audited so far in this rotation. A
generic runtime checker (tracking acquired-lock "levels" per session and
raising if a later acquisition violates the declared order) would be
justified once a third call site needs this order, or once any other
feature grows a comparable three-way shared-resource shape; for two call
sites, the module-level note plus the two direction-specific regression
tests above are the proportionate control, and are already what caught this
exact defect in review before it reached production. Revisit this if a
sixth round is ever needed despite the total order.

**Mirrored to** `CHANGELOG.md`.

## Completion gate (pass 3, round 8 — Codex review of `d0ec9194`, FAC-34)

| Check                                                   | Result                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                              |
| `black --check app/ tests/ alembic/`                    | ✅ clean                                     |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                     |
| `pytest tests/test_facility_document_reference_race.py` | ✅ 5 passed (+1, FAC-34's regression test)   |
| `pytest tests/ -k "facilities or documents"`            | ✅ 301 passed (+1), 1 skipped (pre-existing) |

**FAC-34's regression test independently confirmed against pre-fix code:**
`git stash` isolating just the `documents_service.py` fix —
`TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery` fails
(`AttributeError`, since `_lock_subtree_documents` is part of the fix's own
refactor and does not exist without it); `git stash pop` restored the fix
and all 5 tests in the file passed.

## Completion gate (pass 3, round 9 — Codex review of `b651b5cc`, FAC-35)

| Check                                                   | Result                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                    | ✅ clean                                                                    |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                                                    |
| `pytest tests/test_facility_document_reference_race.py` | ✅ 7 passed (+2, FAC-35's two regression tests)                             |
| `pytest tests/ -k "facilities or documents"`            | ✅ 301 passed, 1 skipped (pre-existing)                                     |
| `pytest tests/` (full backend suite)                    | ✅ 10050 passed, 21 skipped (pre-existing Docker/optional-dependency skips) |

**FAC-35's two regression tests independently confirmed against pre-fix
code:** `git stash` isolating just the `facilities.py`/`documents_service.py`
fix (test file changes kept) —
`TestCreatorLocksTheFolderBeforeTheDocument::test_creator_blocks_on_a_cascade_held_folder_before_locking_the_document`
and
`TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar::test_cascade_blocks_on_the_folder_while_the_creator_has_not_yet_locked_its_document`
both fail (each on its own "should still be blocked" assertion — the
pre-fix creator does not defer to a cascade-held folder lock at all); `git
stash pop` restored the fix and all 7 tests in the file passed, repeated 5
times with no flakiness. `pytest tests/ -k "facilities or documents"` also
caught two now-updated unit tests in `test_facilities_permissions.py` that
assumed `ensure_facility_folder` was skipped for an already-filed document —
see FAC-35's write-up above for why that assumption changed.

### FAC-36 — P2 (reliability, lock-ordering deadlock) — the generic `PATCH /documents/{id}` move path was the third call site FAC-35's total order missed — ✅ FIXED

**Found by Codex review of the FAC-35 commit (`b651b5cc`… now `5a1420f4`).**
FAC-35 declared a canonical order — `DocumentFolder`, then `Document`, then
the `FacilityDocument`/`FacilityPhoto` reference table — and brought
`_validate_shared_document_reference` and `delete_folder` into line with it.
But a third call site touches two of these three resources too:
`DocumentsService.update_document`, the generic `PATCH /documents/{id}`
handler, writes a client-supplied `folder_id` directly onto the `Document`
row whenever a caller moves a document into a folder. It never explicitly
locked the destination `DocumentFolder` at all — the only lock it took on
that folder was the implicit one InnoDB's own row-then-FK-check order takes
for the `UPDATE` at commit, which lands _after_ this transaction has already
(implicitly) locked the `Document` row being written. Document-then-Folder
is the opposite of FAC-35's declared order and the opposite of what
`_validate_shared_document_reference` now always does: a document moved by
this generic endpoint into the same facility folder a concurrent facility
reference is being filed into (or a concurrent `delete_folder` is deleting)
can hold the `Document` lock while waiting on the folder, while the other
side holds the folder lock while waiting on the `Document` — the same
two-way-deadlock shape FAC-35 closed on the other two call sites, reopened
here on a third.

**Where:** `backend/app/services/documents_service.py` (`update_document`).

**Fix:** lock the destination `DocumentFolder` first — before the `Document`
row is ever locked — matching FAC-35's canonical order. Extracted into
`_lock_destination_folder`, the same "extract so a test can patch-and-track
it" pattern as `_lock_subtree_folders`/`_lock_subtree_documents`. Only
runs when `folder_id` is actually being set to a real folder (clearing it to
`None`, i.e. moving a document to org level, references no parent row and
needs no lock); the document is then re-fetched under `for_update=True` so
the write proceeds against a genuinely locked row rather than the earlier
plain read. The existing "not found returns `None`" precedence for the
target document itself is unchanged — that check still runs first, before
any folder validation or locking.

**Regression test:**
`tests/test_facility_document_reference_race.py`,
`TestUpdateDocumentLocksTheFolderBeforeTheDocument`. Same shape as
`TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery`: with the
destination folder already locked by one session, `update_document` run in
a second, real session blocks on it and — the differentiator that actually
proves the fix, since both the pre- and post-fix code remain "not done"
after a short pause either way (pre-fix blocks later, inside `db.commit()`'s
own implicit FK-check lock, not observable from outside) — never explicitly
locks the `Document` row via `get_document_by_id(for_update=True)` until
_after_ the folder lock is released. Confirmed against pre-fix code via
`git stash`: the post-release assertion that the explicit lock was ever
taken fails (it never fires pre-fix, whether blocked or not), and the test
passes clean post-fix.

**Mirrored to** `CHANGELOG.md`.

### FAC-37 — LOW, test-only (Codex, flaky-test risk) — a fixed 0.5s sleep could let a slow-CI run of an existing regression test pass for the wrong reason — ✅ FIXED

**Found by Codex review of the same commit.**
`TestReferenceInsertStaysUnderTheDocumentLock` (FAC-31's regression test)
started a `delete_document` background task, slept a fixed 0.5 seconds, and
branched on whether the task had finished to decide which assertions to run.
On a slow CI database, the deleter's own _preliminary_, non-locking query
could still be in flight — or not yet even issued — when that fixed delay
expired: the test would then take the "still blocked" branch for the wrong
reason (query latency, not a held lock), and a delayed pre-fix delete would
go on to raise the very `PermissionError` the test expects once it finally
ran, letting the test pass without ever having actually exercised the lock.

**Where:** `backend/tests/test_facility_document_reference_race.py`
(`TestReferenceInsertStaysUnderTheDocumentLock`).

**Fix:** replaced the fixed sleep with an event set the instant the deleter
issues its own locking read (`get_document_by_id(..., for_update=True)`),
via the same instance-level patch-and-track technique the rest of this file
already uses. The test now waits for that event before deciding whether the
task is blocked, plus a short, fixed 0.2s grace period purely to let a
genuinely blocked task's `await` settle — the ambiguous window (query
latency) is gone; the only thing left that can still be "not done" at that
point is a held lock.

**Mirrored to** `CHANGELOG.md`.

### FAC-38 — LOW, test-only (Codex, flaky-test risk) — the same fixed-sleep risk FAC-37 fixed on one test was still live on the sibling FAC-32 test — ✅ FIXED

**Found by Codex review of the FAC-36/FAC-37 commit (`53de6d0e`).**
`TestDeleteFolderLocksDocumentsBeforeTheReferenceTable` (FAC-32's regression
test) had the identical shape FAC-37 just fixed elsewhere in this file: a
fixed 0.5s sleep between starting `delete_folder` as a background task and
asserting it was still blocked. On a slow MySQL/MariaDB runner,
`delete_folder` can still be doing its preliminary folder-subtree walk or
its (uncontended, in this test) FAC-34 folder lock when that delay expires
— both assertions would then pass without the test ever having actually
proven the intended Document-before-reference-table ordering.

**Where:** `backend/tests/test_facility_document_reference_race.py`
(`TestDeleteFolderLocksDocumentsBeforeTheReferenceTable`).

**Fix:** same technique as FAC-37, applied to the resource this test
actually contends on. `_lock_subtree_documents` (already extracted by
FAC-34, so already a natural instrumentation point) is patched-and-tracked
to set an event the moment the cascade attempts its `Document` lock — the
point genuinely contended by the creator's own lock in this test — and the
test now waits on that event, plus a short fixed grace period, instead of a
sleep timed from task creation.

**Mirrored to** `CHANGELOG.md`.

### FAC-39 — LOW, test-only (Codex, flaky-test risk) — full-file sweep: every remaining fixed-delay synchronization point in this file converted to event-based waits — ✅ FIXED

**Found by Codex review, a third round on the same file** — three more
instances in one comment
(`TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery`,
`TestCreatorLocksTheFolderBeforeTheDocument`,
`TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar`), the same root
cause as FAC-37/FAC-38: a fixed sleep used to "wait" for a competing task to
reach its actual lock-acquisition point, which can expire before the task
gets there on a slow CI runner, making the test pass without proving
anything. Rather than fix three more line numbers and risk a fourth Codex
round finding a fifth instance, this finding is a **comprehensive sweep** of
every `await asyncio.sleep(...)` used as inter-task lock-order
synchronization in `test_facility_document_reference_race.py` — four sites,
the three Codex found plus `TestUpdateDocumentLocksTheFolderBeforeTheDocument`
(FAC-36's own regression test, landed with the same pattern before this
sweep existed to catch it).

| Site (class)                                                      | Contended call tracked                                                                                         | Extra fast-path probe needed?                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery` | `_lock_subtree_folders` (new event; `_lock_subtree_documents` already tracked)                                 | No — creator holds both Document and folder locks unconditionally throughout |
| `TestCreatorLocksTheFolderBeforeTheDocument`                      | `DocumentsService.ensure_facility_folder` (class-level patch, alongside the existing `get_document_by_id` one) | No — cascade holds the folder lock unconditionally throughout                |
| `TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar`          | `_lock_subtree_folders` (new event)                                                                            | **Yes** — see below                                                          |
| `TestUpdateDocumentLocksTheFolderBeforeTheDocument`               | `_lock_destination_folder` (new event, on the test's existing named per-coroutine `updater_service` instance)  | No — the cascade session holds the folder lock unconditionally throughout    |

**The fast-path subtlety in `TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar`,
found during this sweep's own verification, not by Codex.** This test's
creator is deliberately _paused_ at a point that, pre-fix, holds no lock at
all yet (its very first locking call) — unlike every other site in the
table, there is no lock unconditionally held throughout to guarantee the
cascade's tracked call actually blocks. Wiring in only the event (as the
other three sites use) initially looked sufficient and passed 5 repeated
runs — but verifying it against the true historical pre-FAC-35 revision
(`git show <FAC-35 commit>~1:.../facilities.py`, the same file FAC-35's own
verification used) revealed the event alone made this **worse**, not
better: because the event resolves the instant `_lock_subtree_folders` is
_entered_ (before its own internal locking completes), the assertions
could run before the pre-fix, genuinely uncontended cascade had had time to
race ahead and complete — the exact same false-pass shape Codex flagged,
just relocated. The original fixed `asyncio.sleep(0.5)` had — by accident,
not by design — given that uncontended path enough real wall-clock time to
finish, which is _why_ the sleep-based version of this specific test
correctly failed against pre-fix code when it was first written; a naive
event-only conversion would have silently broken that. Fixed by adding a
bounded `asyncio.wait_for(asyncio.shield(cascade_task), timeout=2.0)` probe
after the event — the same technique FAC-37 uses for its own fast-path
grace period, just as a probe on the task rather than a flat sleep: it
gives a genuinely uncontended cascade real time to complete and prove the
regression, while a genuinely blocked one (current, correct code) simply
times out and is confirmed still pending. Re-verified against the same
historical pre-FAC-35 revision after this correction: the test now fails on
the expected assertion (`cascade_task` has a `result=True`, i.e. completed,
rather than "still blocked").

**Why the other three sites don't need the same probe:** each has a lock
unconditionally held by the _other_ session for the test's entire duration,
established synchronously before the task under test is even created (see
the table) — so the tracked call's block is a deterministic property of the
setup, not a race between two tasks' relative speed.

**Also corrected as part of this sweep:** the module-level canonical-order
note atop `documents_service.py` still described only the two call sites
FAC-35 fixed — FAC-36's own commit added `update_document`'s fix without
updating the note to name it as a third site, or removing FAC-35's own
"only two call sites in the whole backend acquire more than one of these
three resources together" scale-based justification for skipping a runtime
lock-order assertion, which this finding (a third site existing) already
falsifies. The note now names `update_document`/`_lock_destination_folder`
explicitly and, rather than repeat an exhaustiveness claim that has now
been wrong once, tells the next reader to grep for
`with_for_update`/`for_update=True` against these three models before
trusting the comment's site list over the code.

**Verified:** all four converted sites independently confirmed against a
genuine ordering regression, not merely re-run against already-correct
code — a temporary swap of the two calls in `delete_folder` (for the FAC-34
site; failed via a deterministic 10s timeout, since the creator in that
test holds both locks and the cascade never reaches the tracked call at
all), the true historical pre-FAC-35 `facilities.py` (for both FAC-35
sites), and a temporary reorder inside `update_document` (for the FAC-36
site) — each failed on a clean assertion (or the one deterministic timeout)
before the fix, and passed, five repeated runs with no flakiness, after.
Full file (8 tests) now runs in ~5.3s, down from ~6-8s pre-sweep across the
several fixed sleeps removed.

**Where:** `backend/tests/test_facility_document_reference_race.py`
(four test-file sites) and `backend/app/services/documents_service.py`
(module-level note only — no behavioral change).

**Mirrored to** `CHANGELOG.md`.

## Completion gate (pass 3, round 12 — Codex review, third round on the same file, FAC-39 full-file sweep)

| Check                                                   | Result                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                    | ✅ clean                                                                    |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                                                    |
| `pytest tests/test_facility_document_reference_race.py` | ✅ 8 passed, 5 repeated runs, no flakiness, ~5.3s                           |
| `pytest tests/ -k "facilities or documents"`            | ✅ 301 passed, 1 skipped (pre-existing)                                     |
| `pytest tests/` (full backend suite)                    | ✅ 10051 passed, 21 skipped (pre-existing Docker/optional-dependency skips) |

**All four converted sites independently verified against a genuine
ordering regression** (not merely re-run against already-correct code) —
see the FAC-39 write-up above for the specific method used at each, including
the one (`TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar`) whose
first, event-only conversion attempt was itself found to be insufficient
during this verification, and was corrected in the same pass before this
table was produced.

## Completion gate (pass 3, round 11 — Codex review of `53de6d0e`, FAC-38)

| Check                                                   | Result          |
| ------------------------------------------------------- | --------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations |
| `black --check app/ tests/ alembic/`                    | ✅ clean        |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean        |
| `pytest tests/test_facility_document_reference_race.py` | ✅ 8 passed     |

No source change this round — test-only. `TestDeleteFolderLocksDocumentsBeforeTheReferenceTable`
and the rest of the file re-run clean with the synchronized version.

## Completion gate (pass 3, round 10 — Codex review of `5a1420f4`, FAC-36/FAC-37)

| Check                                                   | Result                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                            |
| `black --check app/ tests/ alembic/`                    | ✅ clean                                   |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                   |
| `pytest tests/test_facility_document_reference_race.py` | ✅ 8 passed (+1, FAC-36's regression test) |
| `pytest tests/test_documents_access.py`                 | ✅ 114 passed                              |
| `pytest tests/ -k "facilities or documents"`            | ✅ 301 passed, 1 skipped (pre-existing)    |

**FAC-36's regression test independently confirmed against pre-fix code:**
`git stash` isolating just the `documents_service.py` fix (test file
changes kept) —
`TestUpdateDocumentLocksTheFolderBeforeTheDocument::test_update_document_locks_the_folder_before_the_document`
fails on its post-release assertion that `update_document` ever explicitly
locked the `Document` row via `get_document_by_id(for_update=True)` (it
never does, pre-fix — the deadlock hazard was in InnoDB's own implicit
FK-check lock at commit, not observable through that call); `git stash pop`
restored the fix and the file's 8 tests all passed.

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
