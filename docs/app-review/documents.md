# Application Review — Documents (Tier B)

**Prefix:** `DOC2` · **Iteration:** B8 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-14 (pass 5)

---

## Pass 5 (2026-10-14) — the update paths hold; two unused API surfaces removed, the guard now pinned by a test

Lens for this pass: the update-payload discipline the B4–B7 passes applied
(`exclude_unset`, `apply_updates`, an explicit `null` on a NOT NULL column),
driven through the **real handlers**, plus an AST dead-code scan that this time
includes `tests/` as a reference source. This module had been through four
passes and two security reviews; the honest result is that its write paths were
already right, and the value added is evidence and a regression test rather than
a fix.

### Update paths — verified, not assumed

`PATCH /documents/{id}` and `PATCH /documents/folders/{id}` dump with
`exclude_unset` (the only `exclude_none` hit in `endpoints/documents.py` is a
comment saying why not). Both services apply the dict with `apply_updates`, and
both handlers wrap the service call in `handle_service_errors`, so a ValueError
is a 400. A null for each NOT NULL field the schemas can name (`name` and
`visibility` on folders; `name` and `status` on documents) and for the two
nullable-but-response-required folder fields (`color`, `icon` — refused by hand,
DOC-20) came back 4xx, never 500; a null for the genuinely nullable `description`
and `tags` cleared (200). Nothing to fix.

New `backend/tests/test_documents_update_null_columns_integration.py` (10
tests, `integration`) pins that, with the NOT NULL half derived from the schemas
and models. It has no red-before-fix run — there was nothing to fix — so it was
**mutation-checked** instead: removing the `handle_service_errors` wrapper from
`update_document` makes exactly `document-name` and `document-status` fail
(500), and restoring it brings back 10/10. Marker routing confirmed: 0 of 10
under the unit job's expression.

### DOC2-3 — INFO — `DocumentCreate` (backend schema) had no reference anywhere — ✅ REMOVED

An AST scan of 92 definitions across the two document services, the three
endpoint files and the schema module, resolving `Attribute` / `Name` / string /
import references under `app/`, `scripts/` and — after the B7 lesson — `tests/`,
found exactly one name with no reference at all: `schemas/documents.py::
DocumentCreate`. Upload takes `Form` fields, not a body model. The frontend has an
unrelated `FacilityDocumentCreate`; no doc names this class. Removed.

### DOC2-4 — INFO — three unused frontend client methods — ✅ REMOVED

`documentsService.getDocument`, `.updateDocument` and `.getMyFolder` have no
caller outside their own tests (checked by name across all non-test `.ts` /
`.tsx`, not just by the `documentsService.` prefix — `getFolderRoleOptions` looks
unused by prefix and is not). The endpoints behind them are live and stay
(`GET /my-folder` is the documented way to find a personal folder in
`TROUBLESHOOTING.md`); only the typed wrappers and their tests are gone.
`updateDocument` was also a small trap if someone wired it later: its payload type
declared `description: string` and `tags: string`, so it could not express "clear
this", which is the wrong shape for an update call.

### Verified good ✅ (this pass)

- Folder dialog (`FolderManageDialog`) sends every field it owns on save, with
  `blankToNull` for the description and explicit `parent_id: null` to move to the
  top level; upload omits blank optional fields (the create path), and the backend
  falls back to the filename and to General Documents.
- Download: ACL check (`can_access_document`) before any file work, then the
  resolved path confined to _this organization's_ documents area, then an audit
  event. A document with `content_html` and no `file_path` is a distinct 404.
- All 13 routes in `endpoints/documents.py` carry `documents.view` or
  `documents.manage`; no route added or removed since pass 4.
- The three document-named endpoint files: `legal_documents.py` gates every route
  on the legal/settings permissions; `station_documents.py` takes bare
  authentication in its signature but authorizes per document type in the handler
  (`_authorize_document`), so it is not an open route.
- Related suites: 649 backend tests (document, folder, org-scoping ratchet, CSV
  and LIKE sweeps) pass.

### Observation, not a finding

`frontend/src/services/documentsService.ts` also declares the Meetings types
(`MeetingRecord`, `MeetingAttendee`, `MeetingActionItem`, `MeetingsSummary`),
which `meetingsServices.ts` and `services/api.ts` import from there. They are used,
so nothing was moved; they are simply in the wrong file.

### Not read (scope, stated plainly)

`DocumentsPage.tsx` (1,297 lines) was read only for its upload and payload paths,
not its rendering; the file-storage and upload-validation internals, the folder
ACL engine (`can_access_folder`, `_settle_access_fields`) and the print-document
service behind `station_documents.py` were not re-read — the ACL is covered by
passes 1–4 and the existing 649-test run above, and a clean result here says
nothing new about them. There is no module reference doc for Documents to check
the code against.

### Completion gate (pass 5)

| Check                                                                      | Result                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/`                                                       | ✅ exit 0, no output                                                                                                     |
| `black --check app/ tests/`                                                | ✅ 1698 files unchanged                                                                                                  |
| `isort --check-only` (changed files)                                       | ✅ clean                                                                                                                 |
| `npm run typecheck`                                                        | ✅ exit 0                                                                                                                |
| `eslint` (2 changed frontend files)                                        | ✅ no output                                                                                                             |
| new backend file, mutation-checked                                         | ✅ 10 pass; **2 fail with the `update_document` wrapper removed** (`document-name`, `document-status`); 10 pass restored |
| marker routing                                                             | ✅ `-m "not integration and not slow and not docker"` selects 0 of 10                                                    |
| backend tests (document, folder, org-scoping ratchet, CSV and LIKE sweeps) | ✅ **649 passed, 1 skipped** (optional `pywebpush`)                                                                      |
| frontend (`documentsService`, `components/documents`, `DocumentsPage`)     | ✅ 4 files, **62 passed**                                                                                                |

---

## Pass 4 (2026-08-09) — invariants re-verified; no code change

Pass 3 verified the module clean and cleared the latent-500 over-flag (the
`visibility` fields carry `Field(pattern=...)`). Pass 4 re-verified:

- **DOC-6 FK guards intact** — `assert_in_org` present at 6 sites
  (`create_folder`/`update_folder` `parent_id` + `owner_user_id`;
  `update_document` `folder_id`).
- **DOC2-1 name enrichment intact**; **E712-free** in both `documents_service.py`
  and the sibling `document_service.py`.

Open items at review time: **DOC-4**/**DOC-5** (owner product
decisions in `KNOWN_LIMITATIONS.md` — the sensitive case, member personal folders,
stays `OWNER`-visibility regardless), and the `get_folders` → `can_access_folder`
consolidation (a drift-risk cleanup on the ACL path — left flagged rather than
refactored in a rotation tick, since consolidating access-control logic without a
DB to exercise both branches is exactly the kind of change that wants its own
verified pass).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a · document tests **39 passed** (DB-free).

---

## Pass 3 (2026-08-09) — verified clean; latent-500 lens over-flag cleared; 1 E712

Re-verified the landed fixes hold: DOC-6 `assert_in_org` guards intact
(`create_folder`/`update_folder` `parent_id` + `owner_user_id`; `update_document`
`folder_id`); DOC2-1 `attach_document_names` present and wired; DOC-2/DOC-3 access

- upload guards in place. `documents_service.py` (the real service — the endpoint
  imports `DocumentsService`) is E712-free.

### Latent-500 lens (the B1 finding) — over-flagged, then cleared

The automated lens flagged `DocumentFolderCreate.visibility` /
`DocumentFolderUpdate.visibility` as free-`str` fields mapping to the strict
`visibility` ENUM — but careful reading cleared both: each carries a
`Field(pattern="^(organization|leadership|owner)$")`, so Pydantic already rejects an
out-of-set value with 422 at the boundary. Combined with DOC-6's
`DocumentUpdate.status: Optional[DocumentStatus]`, **every** enum-mapped request
field in this module is validated — no free-string→ENUM 500 path. (A good example of
the lens producing a false positive that a read, not a "fix," resolves — no change
made.)

### DOC2-2 — NIT — 1 `is_system == True  # noqa: E712` in `document_service.py` swept — ✅ FIXED

The sibling `document_service.py` (the minutes-publish/rendering service, MM2-1's
home) carried a single boolean-column E712; converted to `.is_(True)`.

### Doc correction — pass 2's "dead fields" future note is stale

Pass 1/2's future-dev item "remove or populate `uploader_name`/`folder_name` dead
response fields" is **already resolved**: DOC2-1 (pass 2) populates both via
`attach_document_names`. Removed from the open list below.

### DOC-4 / DOC-5 — historical finding (both fixed 2026-09-02)

At the time of this pass, DOC-4 (summary aggregates counts across all
folders incl. restricted — count-only, no content) and DOC-5 (per-folder
ACL isn't hierarchical, so `ORGANIZATION`-visible apparatus/facility child
folders under a `LEADERSHIP` root are directly readable) remained owner
decisions in `KNOWN_LIMITATIONS.md`. Member personal folders stayed
`OWNER`-visibility, so the sensitive case was closed regardless. **Both are
now fixed** (PR #2160 for DOC-5, PR #2171 for DOC-4, re-verified by
security review DOC-10 pass 3).

### Future development (updated)

1. **DOC-5 hierarchical-ACL decision (resolved 2026-09-02)** — the one potential access gap, depending on
   intent.
2. **DOC-4 summary scoping (resolved 2026-09-02)** — `get_summary` now
   scopes every aggregate to the caller's `accessible_folder_ids`.
3. **`get_folders` should call `can_access_folder`** rather than re-inlining
   it (drift risk) — **resolved 2026-09-02** alongside DOC-5; it now
   delegates to `can_access_folder` for every folder.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · document tests **39 passed** (all DB-free).

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (DOC-1/2/3 and the DOC-6 write-path FK/enum fixes intact).
Pass 1 recorded `uploader_name`/`folder_name` on `DocumentResponse` as "never
populated — always null" and framed the fix as _remove or populate_. The B1
(MS2-4) lesson resolves that ambiguity: the frontend **renders** the field, so
it's a live silently-dead feature, and the fix is to **populate**, not remove.

### DOC2-1 — LOW→MED (live UI defect) — Uploader/folder names never populated — ✅ FIXED

**What:** `DocumentResponse` declares `uploader_name` and `folder_name`, but
`get_documents` / `get_document_by_id` return the raw `Document` ORM row, which
has neither attribute — so both always serialized as `null`. `DocumentsPage.tsx:423`
renders `doc.uploader_name ? "Uploaded by " + doc.uploader_name : ''`, so the
**uploader attribution never appeared** on any document in the list. Unlike MS2-4
(which showed a hard "Unknown"), this degrades to blank — the feature is simply
invisible, which is why it survived to a second pass: nothing looked broken, the
line just silently never rendered.

**Fix:** a new `attach_document_names` helper (the MS2-4 pattern) batch-resolves
the uploader (`uploaded_by` → `User`) and folder (`folder_id` → `DocumentFolder`)
names — one org-scoped query each, no N+1 — and sets them as instance attributes
Pydantic reads via `from_attributes`. Wired into all four document response paths
(list, get-by-id, upload, update). Org-scoping is load-bearing and tested: a
missing/out-of-org id yields `None`, so a name never crosses an org boundary. This
generalizes the MS2-4 repair (B1 medical-screening) to the documents module.
3 tests added (`TestAttachDocumentNames`).

### DOC-4 / DOC-5 — historical finding (both fixed 2026-09-02)

At the time of this pass, DOC-4 (summary ignores the folder ACL —
count-only, no content) and DOC-5 (per-folder ACL isn't hierarchical, so
apparatus/facility child folders under a `LEADERSHIP` root are directly
readable) both remained owner decisions, unchanged from pass 1 and already
in `KNOWN_LIMITATIONS.md`. Member **personal** folders were already
`OWNER`-visibility, so the sensitive case was closed regardless of either
decision. **Both subsequently resolved 2026-09-02** — DOC-5 by hierarchical
authorization (PR #2160), DOC-4 by scoping the summary aggregate to the
caller's accessible folders (PR #2171).

---

## Pass 1 (2026-08-06)

**Prefix:** `DOC2` · **Iteration:** B8 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/documents.py` (11), `services/documents_service.py`,
`schemas/documents.py`, `models/document.py`
**Prior audit:** `docs/module-audit/documents.md` — DOC-1/2/3 fixed; DOC-4
(summary ignores ACL), DOC-5 (ACL not hierarchical), DOC-6 (write-path FK/enum
gaps) left open.

---

## Scope

Tier B: the three open findings. The security pass had already hardened upload
(magic-byte MIME, UUID paths, no traversal), confirmed tenant isolation, and
established the folder ACL is not bypassable on direct read — re-verified, not
re-derived.

## Findings

### DOC-6 — LOW — Write-path FK / enum validation gaps (XC-1 + enum) — ✅ FIXED

Closed all three parts:

- **`update_document` folder_id** — a document could be reassigned to any folder
  id (foreign or nonexistent) via bare `setattr`. Now validated in-org with
  `assert_in_org` (`allow_none` — clearing the folder moves the doc to org
  level).
- **`create_folder` / `update_folder` `parent_id` + `owner_user_id`** — both
  stored client-supplied FKs with no in-org check. Both now validated
  (`allow_none`).
- **`DocumentUpdate.status`** — was a free `Optional[str]` set via `setattr`, so
  any string could become a document's status. Constrained to
  `Optional[DocumentStatus]` at the **schema** layer, so Pydantic rejects an
  invalid value with 422 at the boundary — the right layer for enum validation.

All three are leadership-gated (`documents.manage`), so this is data-integrity
hardening, not a privilege fix. Two endpoints (`update_document`,
`update_folder`) called the service directly with no error wrapper, so the new
`ValueError`s would have 500'd — wrapped both in the module's
`handle_service_errors` (`ValueError → 400`), matching `create_folder`.

### DOC-4 — LOW — `get_documents_summary` ignores the folder ACL — ✅ FIXED (2026-09-02, was 🚩 FLAGGED at this pass)

`get_summary` still aggregates counts/size across the **whole org**, including
leadership-only and member-personal folders, so a plain `documents.view` user
sees aggregate volume/existence of restricted content (counts only — no names,
no content). Scoping it to `accessible_folder_ids` is a behavior change to a
stats endpoint that some deployments may rely on as an org-wide total; left for
a deliberate decision. **Not a disclosure of content**, only of aggregate
counts.

### DOC-5 — LOW — Hierarchical folder ACL — ✅ FIXED (2026-09-02)

`can_access_folder` now walks the requested folder and every ancestor, requiring
each folder to admit the caller and failing closed for missing, foreign, or
cyclic ancestry. System-root ACLs are normalized so member owners and
facility-sensitive permission holders pass their roots, while apparatus remains
leadership-only. The apparatus docstring no longer claims an unimplemented role
restriction.

## Verified good ✅ (re-confirmed)

- DOC-1 (delete orphaned files — both `delete_document` and the `delete_folder`
  subtree walk), DOC-2 (`can_access_document` fails closed on a missing folder),
  DOC-3 (`upload_document` rejects an unresolvable `folder_id`) all remain fixed.
- Upload hardening intact; folder ACL not bypassable on direct read; no
  `file_path` leak in this module's `DocumentResponse`.

## Duplication

`get_folders` still duplicates `can_access_folder`'s logic inline rather than
calling it (noted in the prior audit as a drift risk). Not changed — refactoring
it is orthogonal to the XC-1 work and risks the listing behavior; recorded as
future development.

## Dead code

`uploader_name` / `folder_name` on `DocumentResponse` are never populated (no
enrichment join) — always null. The prior audit flagged them as dead fields;
still true. Left as-is (removing response fields is a frontend-contract change);
recorded for a future frontend-shared iteration.

## Documentation

`docs/module-audit/documents.md`: DOC-6 resolved; DOC-5 and DOC-4 were both
subsequently resolved on 2026-09-02 (previously this line said DOC-4
remained open — corrected by security review DOC-10 pass 3).
DOC-5's doc-vs-code mismatch (apparatus docstring claims a restriction that
isn't coded) is the one active documentation inaccuracy — its resolution depends
on the DOC-5 product decision (fix the code or fix the docstring).

## Future development

1. **DOC-5 hierarchical-ACL decision (resolved 2026-09-02)** — the one item here that could be a real
   access gap depending on intent. Decide whether apparatus/facility child
   folders should inherit their parent's `LEADERSHIP` restriction.
2. **DOC-4 summary scoping (resolved 2026-09-02)** — `get_summary` now
   scopes every aggregate to the caller's accessible folders.
3. **`get_folders` should call `can_access_folder`** rather than re-inlining
   it (drift risk) — **resolved 2026-09-02** alongside DOC-5.
4. **Remove or populate `uploader_name`/`folder_name`** dead response fields
   — **resolved** (DOC2-1, pass 2, 2026-08-06): `attach_document_names`
   populates both.

## Completion gate

| Check                | Result                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                       |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                        |
| `black --check`      | ✅ 503 files unchanged                                                                                                                 |
| `eslint`             | ✅ clean                                                                                                                               |
| backend tests        | ✅ **2517 passed, 0 failed**; 33 document tests pass with the schema/service changes. 648 errors, all `db_session` fixture (no MySQL). |

</content>
