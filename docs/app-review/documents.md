# Application Review — Documents (Tier B)

**Prefix:** `DOC2` · **Iteration:** B8 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3)

---

## Pass 3 (2026-08-09) — verified clean; latent-500 lens over-flag cleared; 1 E712

Re-verified the landed fixes hold: DOC-6 `assert_in_org` guards intact
(`create_folder`/`update_folder` `parent_id` + `owner_user_id`; `update_document`
`folder_id`); DOC2-1 `attach_document_names` present and wired; DOC-2/DOC-3 access
+ upload guards in place. `documents_service.py` (the real service — the endpoint
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

### DOC-4 / DOC-5 — 🚩 FLAGGED (product decisions, unchanged)

DOC-4 (summary aggregates counts across all folders incl. restricted — count-only,
no content) and DOC-5 (per-folder ACL isn't hierarchical, so `ORGANIZATION`-visible
apparatus/facility child folders under a `LEADERSHIP` root are directly readable)
remain owner decisions in `KNOWN_LIMITATIONS.md`. Member personal folders stay
`OWNER`-visibility, so the sensitive case is closed regardless.

### Future development (updated)

1. **DOC-5 hierarchical-ACL decision** — the one potential access gap, depending on
   intent.
2. **DOC-4 summary scoping** — scope the aggregate to accessible folders if the
   count-leak matters.
3. **`get_folders` should call `can_access_folder`** rather than re-inlining it
   (drift risk).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · document tests **39 passed** (all DB-free).

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (DOC-1/2/3 and the DOC-6 write-path FK/enum fixes intact).
Pass 1 recorded `uploader_name`/`folder_name` on `DocumentResponse` as "never
populated — always null" and framed the fix as *remove or populate*. The B1
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

### DOC-4 / DOC-5 — still flagged (unchanged, product decisions)

DOC-4 (summary ignores the folder ACL — count-only, no content) and DOC-5
(per-folder ACL isn't hierarchical, so apparatus/facility child folders under a
`LEADERSHIP` root are directly readable) both remain owner decisions, unchanged
from pass 1 and already in `KNOWN_LIMITATIONS.md`. Re-confirmed member **personal**
folders are `OWNER`-visibility, so the sensitive case stays closed regardless of
the DOC-5 decision.

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

### DOC-4 — LOW — `get_documents_summary` ignores the folder ACL — 🚩 FLAGGED (unchanged)

`get_summary` still aggregates counts/size across the **whole org**, including
leadership-only and member-personal folders, so a plain `documents.view` user
sees aggregate volume/existence of restricted content (counts only — no names,
no content). Scoping it to `accessible_folder_ids` is a behavior change to a
stats endpoint that some deployments may rely on as an org-wide total; left for
a deliberate decision. **Not a disclosure of content**, only of aggregate
counts.

### DOC-5 — LOW — Folder ACL is per-folder, not hierarchical — 🚩 FLAGGED (needs product decision)

`can_access_folder` inspects only a folder's own `visibility`/`allowed_roles`,
never its ancestor chain. Apparatus/facility per-item child folders are created
`ORGANIZATION`-visibility with no `allowed_roles`, even though their parent roots
are `LEADERSHIP` — so any `documents.view` user can read those child folders
directly, and the apparatus docstring's "allowed_roles restricted" claim is not
actually coded.

**This is a genuine product decision, not a clear bug:** org-visible apparatus
and facility files may be exactly what's wanted (crews should see their rig's
manuals). If leadership-only was intended, the fix is a hierarchical ACL that
walks the parent chain — a larger change with performance implications on every
folder check. Flagged for the owner to decide intent; **member personal folders
are unaffected** (individually `OWNER`-visibility), so the sensitive case is not
exposed. Recorded in `KNOWN_LIMITATIONS.md`.

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

`docs/module-audit/documents.md`: DOC-6 now resolved; DOC-4/DOC-5 stand.
DOC-5's doc-vs-code mismatch (apparatus docstring claims a restriction that
isn't coded) is the one active documentation inaccuracy — its resolution depends
on the DOC-5 product decision (fix the code or fix the docstring).

## Future development

1. **DOC-5 hierarchical-ACL decision** — the one item here that could be a real
   access gap depending on intent. Decide whether apparatus/facility child
   folders should inherit their parent's `LEADERSHIP` restriction.
2. **DOC-4 summary scoping** — scope the aggregate to accessible folders if the
   count-leak matters.
3. **`get_folders` should call `can_access_folder`** rather than re-inlining it
   (drift risk).
4. **Remove or populate `uploader_name`/`folder_name`** dead response fields.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**; 33 document tests pass with the schema/service changes. 648 errors, all `db_session` fixture (no MySQL). |
</content>
