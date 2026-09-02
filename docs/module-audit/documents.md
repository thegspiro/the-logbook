# Module Audit — Documents

**Files:** `app/api/v1/endpoints/documents.py` (441 L, 11 endpoints),
`app/services/documents_service.py` (842 L — the service the endpoint uses;
thin wrapper over the singular `document_service.py` used by minutes),
`app/schemas/documents.py`, model `app/models/document.py`. Rendered in-app
(no dedicated frontend module dir).
**Audited:** iteration 8 (upload/download file handling, folder ACL bypass,
tenant isolation).

## Verified good ✅

- **Auth coverage:** all 11 endpoints permission-gated (`documents.view` reads,
  `documents.manage` writes — `manage` is a leadership permission).
- **Upload is well-hardened:** UUID on-disk filename (no user input in the
  path → **no path traversal**), magic-byte MIME validation against an allowlist
  (not the HTTP header), extension derived from detected MIME (no
  double-extension attacks), 50MB cap, org-segregated dirs, cleanup-on-error.
- **Tenant isolation is solid:** every by-id getter filters `organization_id`;
  all update/delete route through those getters. No cross-org IDOR.
- **Folder ACL is NOT bypassable on direct read:** `get_document` calls
  `can_access_document`, which resolves the containing folder org-scoped and
  applies `can_access_folder` — the same boundary the listing enforces. A
  `documents.view`-only user cannot read a restricted folder's document by
  guessing its id. `get_my_member_folder` takes no id (derived from
  `current_user`), so no cross-member access.
- **No `file_path` leak in this module:** the endpoint `DocumentResponse` does
  **not** expose `file_path` (that field is on `PublishedDocumentResponse`, used
  by minutes-publish). Frontend confirms no consumption.
- **LIKE search escapes `\`, `%`, `_`; no raw SQL; flake8 clean; no TODOs.**

**Correction (security review, 2026-08-25):** `docs/security-review/DOC-10-documents-legal.md`
re-verified DOC-1/2/3/6 (still fixed) and DOC-4 (still open at the time) and DOC-5 (resolved 2026-09-02 after being confirmed to extend identically to the facility-folder hierarchy
added since this audit), and reviewed two files this audit never covered —
`station_documents.py`/`print_document_service.py` and
`legal_documents.py`/`legal_service.py` — for the first time. No new
findings in either.

**Correction (security review DOC-10 pass 3, 2026-09-02):** DOC-4 is now
also fixed (a separate PR, #2171, merged the same day as DOC-5's #2160 —
re-verified against current code, not the diff, and covered by a dedicated
per-caller-tier test). See DOC-4 below.

## Findings

### DOC-1 — MEDIUM (data retention) — `delete_document` orphaned the on-disk file — ✅ FIXED

`delete_document` deleted the DB row but never removed the file under
`/app/uploads/documents/<org>/<uuid>.<ext>`, so every "deleted" document — a
potentially sensitive upload — persisted on disk indefinitely.
**Fix:** capture `file_path` before the row delete and `os.remove` it
best-effort (via `asyncio.to_thread`) after the commit; a missing file logs a
warning rather than erroring.
**✅ Also fixed:** `delete_folder` used to cascade DB rows only, orphaning the
files of every document in the folder subtree. It now walks the folder subtree
(the folder + all descendants via `parent_id`, org-scoped), collects the backing
file paths before the cascade delete, and `os.remove`s them best-effort after the
commit — same pattern as `delete_document`.

### DOC-2 — LOW (ACL fail-open) — `can_access_document` returned True on a missing folder — ✅ FIXED

When a document referenced a `folder_id` whose folder row couldn't be resolved,
`can_access_document` returned `True` (accessible). Low practical impact (folder
delete cascades / nulls `folder_id`), but a fail-open ACL branch.
**Fix:** return `False` (fail closed) when the referenced folder can't be
resolved. Documents with no folder remain org-level readable (unchanged).

### DOC-3 — LOW (validation fail-open) — `upload_document` silently accepted an invalid `folder_id` — ✅ FIXED

The guard was `if folder and not can_access_folder(...)`, so when
`get_folder_by_id` returned `None` (nonexistent or out-of-org folder) the check
was skipped and the document was created with that unvalidated `folder_id`.
**Fix:** reject a provided-but-unresolvable `folder_id` with 404 before the
access check.

### DOC-4 — LOW — `get_documents_summary` ignores the folder ACL — ✅ FIXED (2026-09-02)

`get_summary` used to aggregate `total_documents`/`total_folders`/
`total_size_bytes`/`documents_this_month` across the **entire org**,
including leadership-only, owner-only (member personal), and
role-restricted folders — so a plain `documents.view` user saw aggregate
volume/existence of restricted content (counts only, no names/content).
**Fix (PR #2171):** `get_summary` now takes the caller and scopes every
aggregate — the document count/size/this-month sum and the folder count —
to `accessible_folder_ids`. Covered by
`tests/test_documents_access.py::TestDocumentsSummaryAccess::
test_summary_matches_each_caller_access_scope` (5 caller tiers, exact
expected counts each).

### DOC-5 — LOW (design) — Hierarchical folder ACL — ✅ FIXED (2026-09-02)

`can_access_folder` now requires the requested folder and every ancestor to admit
the caller. Missing, cross-organization, and cyclic ancestry fails closed. Root
ACLs are normalized so member owners and facility-sensitive permission holders
retain intended access, while apparatus remains leadership-only.

### DOC-6 — LOW — Write-path FK/enum validation gaps (leadership-gated) — ✅ FIXED (app-review B8, 2026-08-06)

- `update_document` applies `update_data` (incl. `folder_id`) via bare `setattr`
  with no org/existence/access check — a doc can be reassigned to any folder id.
- `create_folder`/`update_folder` store `parent_id` / `owner_user_id` with no
  in-org verification.
- `DocumentUpdate.status` is a free `Optional[str]` set via `setattr` with no
  validation against `DocumentStatus`.
  All are behind `documents.manage` (leadership), so these are data-integrity
  gaps, not privilege escalations. **Status:** flagged (XC-1 class).

## Notes

Both items formerly listed here are resolved, and the corrections were
scattered elsewhere rather than made in this file — recorded here so a
reader of this file specifically doesn't rediscover them as open:

- `uploader_name` / `folder_name` on `DocumentResponse` were never
  populated (no enrichment join) — always null; dead fields. **Fixed**
  (DOC2-1, app-review pass 2, 2026-08-06): a new `attach_document_names`
  helper batch-resolves both, org-scoped, wired into every document
  response path. Noted as resolved in `docs/app-review/documents.md` at the
  time, but this file was never back-corrected until now (security review
  DOC-10 pass 3, 2026-09-02).
- `get_folders` duplicated `can_access_folder`'s logic inline rather than
  calling it — a drift risk, since the two copies could (and eventually
  did) diverge. **Fixed** (PR #2160, 2026-09-02, alongside DOC-5): the
  inline visibility-only check is gone; `get_folders` now delegates to
  `can_access_folder` for every folder, so it inherits the same
  ancestor-walk/`required_permissions` rule the by-id path enforces.
