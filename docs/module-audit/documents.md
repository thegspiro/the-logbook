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

### DOC-4 — LOW — `get_documents_summary` ignores the folder ACL
`get_summary` aggregates `total_documents`/`total_folders`/`total_size_bytes`/
`documents_this_month` across the **entire org**, including leadership-only,
owner-only (member personal), and role-restricted folders — so a plain
`documents.view` user sees aggregate volume/existence of restricted content
(counts only, no names/content).
**Status:** flagged — scoping the summary to `accessible_folder_ids` is a
behavior change to a stats endpoint; left for a deliberate decision.

### DOC-5 — LOW (design) — Folder ACL is per-folder, not hierarchical
`can_access_folder` inspects only the folder's own `visibility`/`allowed_roles`,
never its ancestor chain. Apparatus/facility per-item child folders are created
`ORGANIZATION`-visibility with no `allowed_roles` even though their parent roots
are `LEADERSHIP`, so any `documents.view` user can read those child folders
directly. The apparatus docstring claims "allowed_roles restricted" but no such
restriction is coded.
**Status:** flagged — confirm intent (org-visible apparatus/facility files may be
desired). If leadership-only was intended, the ACL needs to walk the parent
chain. Member personal folders are unaffected (individually `OWNER`).

### DOC-6 — LOW — Write-path FK/enum validation gaps (leadership-gated)
- `update_document` applies `update_data` (incl. `folder_id`) via bare `setattr`
  with no org/existence/access check — a doc can be reassigned to any folder id.
- `create_folder`/`update_folder` store `parent_id` / `owner_user_id` with no
  in-org verification.
- `DocumentUpdate.status` is a free `Optional[str]` set via `setattr` with no
  validation against `DocumentStatus`.
All are behind `documents.manage` (leadership), so these are data-integrity
gaps, not privilege escalations. **Status:** flagged (XC-1 class).

## Notes
- `uploader_name` / `folder_name` in `DocumentResponse` are never populated
  (no enrichment join) — always null; dead fields.
- `get_folders` duplicates `can_access_folder` logic inline rather than calling
  it — consistent today, a drift risk.
