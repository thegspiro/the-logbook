# Security Review — Documents & Legal

**Prefix:** `DOC` · **Iteration:** 10 · **Reviewed:** 2026-08-26 · **PR:** #1821 (original), fixes landed in #1826 (follow-up, survivor of a two-PR consolidation with #1827 — see revision notes)

**Backend:** `endpoints/documents.py` (462 L, 11 routes), `services/documents_service.py` (998 L), `endpoints/station_documents.py` (102 L, 2 routes, new to this rotation), `services/print_document_service.py` (515 L, new), `endpoints/legal_documents.py` (340 L, 6 routes, new), `services/legal_service.py` (241 L, new), `schemas/legal.py`, `schemas/documents.py`, `models/document.py`, `models/legal.py`
**Frontend:** `pages/legal/LegalPage.tsx` (public consumption path, read for XSS — see Verified good), `modules/governance/pages/LegalDocumentsPage.tsx` (not read in full — backend-only pass)
**Migrations:** `20260820_0135_06adc68a8b84_add_legal_document_revisions.py` — reviewed, sound

---

**Revision note (2026-08-25):** This file originally concluded "no new
findings." An 11-comment Codex review of the draft PR found that conclusion
wrong on several axes — real correctness/exposure bugs the first pass missed
entirely (a 500 on a malformed folder id, dropped explicit nulls on PATCH, a
required-but-advertised-optional upload field, a printer error leaking
network topology, an unenforced folder-cycle guard, an unserialized publish
race, and a shared settings key that let publishing one legal document
misdate the other), plus a route-inventory framing error and one scope
correction (the "direct content read" characterization of an upload path
that in fact has no download endpoint at all). Nine were small, contained,
and fixed in this pass; two are unbounded-list findings consistent with this
rotation's established flag-not-fix pattern (FIN-9/ELEC-12/USR-5/MP-10/MS-6);
one is a real, larger gap flagged for an owner decision rather than
implemented here. See Findings below for per-item disposition.

**#1821 merged (at its pre-fix commit) before this review round was
resolved.** Per CLAUDE.md Pitfall #24, the fixes below were not pushed onto
the now-closed `claude/security-review-doc` branch; they landed as a new
follow-up PR, #1826, against `main`. The Codex review threads on #1821 were
each replied to with a link forward to #1826 and resolved there.

**Round-2 (2026-08-25):** A Codex review of #1826's own fix commit
(`dd0e40cd`) found three more issues — a real regression each in DOC-10's
legacy-date fallback and DOC-12's null-handling, plus a test file
(`test_public_legal.py`) the completion-gate command list had omitted, which
let DOC-10's response-shape change break it silently. All three fixed;
recorded as DOC-19 through DOC-21 below.

## Scope

The rotation's feature 10 row lists three files
(`documents.py`/`station_documents.py`/`legal_documents.py`), but only
`documents.py` had ever been reviewed: `docs/module-audit/documents.md`
(iteration 8: DOC-1 through DOC-6) and `docs/app-review/documents.md` (Tier
B, four passes through 2026-08-09). `station_documents.py` and
`legal_documents.py` — and their backing services — do not appear in either
doc. This pass split accordingly:

- **`documents.py` / `documents_service.py`:** a re-verification pass. Read
  both files in full current-state (462 L / 998 L, up from the audited
  441 L / 842 L) and compared against what the last app-review pass (2026-08-09)
  documented. The growth is almost entirely five new folder-provisioning
  helpers (`ensure_apparatus_folder`, `get_apparatus_sub_folders`,
  `ensure_facility_folder`, `get_facility_sub_folders`, `ensure_event_folder`)
  — internal methods called by other modules (apparatus/facilities/events) to
  auto-create a document folder when their own resource is created, not
  reachable through any route in this file. They don't take client input
  directly (`organization_id`/`apparatus_id`/`facility_id`/`event_id` come
  from the calling service), so the auth boundary is whatever gates apparatus/
  facility/event creation — out of this feature's scope, and out of the
  rotation until those features are reached. They do confirm DOC-5 (below)
  is still live: the sub-folders they create are `ORGANIZATION`-visibility
  under `LEADERSHIP`-visibility roots, exactly the pattern DOC-5 already
  describes.
- **`station_documents.py` / `print_document_service.py`:** first review.
  Read both files in full (617 L combined). Prints a shift roster or an
  apparatus check sheet to a receipt printer at the watch desk — nothing is
  stored, so this is a read/render path, not a data-at-rest concern.
- **`legal_documents.py` / `legal_service.py` / `schemas/legal.py` /
  `models/legal.py`:** first review. Read in full (726 L combined) plus the
  one migration that created the backing table. Governance workflow for
  proposing and publishing the text on the anonymous, public `/privacy` and
  `/terms` pages — the one place in this feature where a write from an
  authenticated leader reaches unauthenticated visitors, so the frontend
  rendering path (`LegalPage.tsx`) was read too, to check for stored XSS.
- **Explicitly out of scope:** `app/api/public/legal.py`'s route registration
  and rate-limiting were already reviewed under feature 03
  (`PUB-03-public-surface-webhooks.md` / PR #1806, finding PUB-2). This pass
  only touched that file to fix the shared-effective-date bug (DOC-10 below)
  and otherwise treats its access-control posture as already covered there.

## Route inventory

All routes below are mounted under the global `/api/v1` prefix. The
authenticated legal-document router is registered as
`api_router.include_router(legal_documents.router, prefix="/legal-documents", ...)`
(`api/v1/api.py`) — its full paths are `/api/v1/legal-documents[...]`, not
`/legal` (see DOC-17: the original table conflated this with the _separate_,
anonymous `GET /api/public/v1/legal` endpoint, which is out of scope here and
carries no `/v1` segment inside its own prefix by coincidence of naming, not
because the two share a boundary).

| Method | Path                                               | Permission                                                                   | Org-scoped                                        |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| GET    | /documents/folders                                 | documents.view                                                               | yes                                               |
| POST   | /documents/folders                                 | documents.manage                                                             | yes (+FK validation, DOC-6)                       |
| PATCH  | /documents/folders/{folder_id}                     | documents.manage                                                             | yes (+FK validation DOC-6, +cycle DOC-16)         |
| DELETE | /documents/folders/{folder_id}                     | documents.manage                                                             | yes                                               |
| GET    | /documents                                         | documents.view                                                               | yes                                               |
| POST   | /documents/upload                                  | documents.manage                                                             | yes (+folder-ACL check)                           |
| GET    | /documents/my-folder                               | documents.view                                                               | yes (self-scoped)                                 |
| GET    | /documents/{document_id}                           | documents.view                                                               | yes (+folder-ACL check)                           |
| GET    | /documents/{document_id}/download                  | documents.view                                                               | yes (+folder-ACL check, +path containment DOC-24) |
| PATCH  | /documents/{document_id}                           | documents.manage                                                             | yes (+FK validation, DOC-6)                       |
| DELETE | /documents/{document_id}                           | documents.manage                                                             | yes                                               |
| GET    | /documents/stats/summary                           | documents.view                                                               | yes (DOC-4: ignores folder ACL)                   |
| POST   | /station-documents/preview                         | any permission the requested `document` accepts (see note)                   | yes                                               |
| POST   | /station-documents/print                           | same                                                                         | yes                                               |
| GET    | /legal-documents                                   | legal.propose / legal.publish / settings.manage                              | yes                                               |
| POST   | /legal-documents/revisions                         | legal.propose / legal.publish / settings.manage                              | yes                                               |
| PUT    | /legal-documents/revisions/{revision_id}           | legal.propose / legal.publish / settings.manage (+own-draft check, see note) | yes                                               |
| DELETE | /legal-documents/revisions/{revision_id}           | legal.propose / legal.publish / settings.manage (+own-draft check)           | yes                                               |
| POST   | /legal-documents/revisions/{revision_id}/publish   | legal.publish / settings.manage                                              | yes (+row lock, DOC-15)                           |
| POST   | /legal-documents/{document_type}/revert-to-default | legal.publish / settings.manage                                              | yes (+row lock, DOC-15)                           |

**Note on `/station-documents/{preview,print}`:** no `require_permission`
dependency — the permission set is a function of the request body's
`document` field (`shift_roster` → `scheduling.view`/`.manage`;
`apparatus_check_sheet` → `equipment_check.view`/`.submit`/`.manage`),
resolved and checked by `_authorize_document` before any work happens. Not a
gap: `required_permissions_for_document` returns `None` for an unregistered
key (404), and the permission check runs before `PrintDocumentService.build`
is ever called.

**Note on `/legal-documents/revisions/{id}` PUT/DELETE:** gated at the router
level by the propose-tier permission, then narrowed by `_assert_may_modify` —
a caller who cannot publish may only touch a revision they themselves created
(separation of duties: a proposal is not supposed to be quietly rewritten by
a colleague under someone else's name).

## Verified good ✅

- **DOC-1/DOC-2/DOC-3/DOC-6 (documents.py) all re-confirmed intact.**
  `delete_document`/`delete_folder` both remove backing files after the
  cascade (`documents_service.py:274-325`, `:485-506`);
  `can_access_document` fails closed on an unresolvable folder (`:199-217`);
  `upload_document` rejects an unresolvable `folder_id` with 404 before the
  access check (`documents.py:219-233`); `create_folder`/`update_folder`/
  `update_document` all validate client-supplied FKs (`parent_id`,
  `owner_user_id`, `folder_id`) via `assert_in_org` before writing
  (`documents_service.py:72-87`, `:247-265`, `:465-476`). `update_folder`
  additionally now rejects a re-parent that would make the folder its own
  ancestor (DOC-16, this pass).
- **Upload hardening intact.** Magic-byte MIME detection against an
  allowlist (not the HTTP header), extension derived from the detected MIME
  (no double-extension attack), UUID on-disk filenames (no path traversal),
  50MB cap, org-segregated directories (`documents.py:236-291`).
- **Folder ACL is not bypassable on direct read.** `get_document` calls
  `can_access_document`, which resolves the containing folder org-scoped and
  applies the same `can_access_folder` rule the listing enforces, and
  answers 404 (not 403) on a restricted document so existence isn't
  confirmed to someone guessing ids (`documents.py:383-404`). Note: this
  proves a _restricted_ document can't be read by id — it does not mean the
  bytes of an _accessible_ one can be; see DOC-18.
- **`GET /documents` (unfiltered listing) cannot leak a restricted folder's
  contents.** `accessible_folder_ids` returns `None` only for leadership;
  otherwise it's the actual set of folders the caller can see, and
  `get_documents` ANDs that into the query
  (`documents_service.py:219-237`, `:368-372`) — a folder-less listing
  cannot surface an owner-only or leadership-only folder's documents. This
  query is also genuinely pagination-safe: `skip`/`limit` reach a SQL
  `OFFSET`/`LIMIT` (`:392-395`). **Correction:** the previous version of this
  file extended that same "pagination-safe" claim to `get_folders`, which is
  wrong — see DOC-9.
- **`station_documents.py`'s pass-down-notes narrowing is real, not
  decorative.** `_may_see_pass_down` (`print_document_service.py:94-117`)
  mirrors the scheduling module's own canonical handoff-access rule (shift
  manager, the named shift officer, or someone actually rostered and
  confirmed) rather than re-deriving a looser one, so a roster printed under
  a flat `scheduling.view` grant cannot become a way around the handoff
  endpoint's own restriction. Covered directly:
  `test_print_documents.py::TestShiftRoster::test_the_pass_down_reaches_the_crew_it_belongs_to`
  and `::test_the_pass_down_is_withheld_from_everyone_else`.
- **The apparatus check sheet inherits `EquipmentCheckService`'s own
  position-narrowing rather than re-querying the table directly.**
  `build_apparatus_check_sheet` (`print_document_service.py:265-297`) goes
  through `EquipmentCheckService.get_template(..., visible_positions=...)`
  when the caller holds neither `equipment_check.view` nor `.manage`, so a
  `.submit`-only member sees the same narrowed set of checklists the
  equipment-check module itself would show them — querying the table
  directly would have quietly handed them the whole department's
  configuration. Covered:
  `test_print_documents.py::TestCheckSheet::test_a_submit_only_member_is_narrowed_to_their_positions`.
  All record builders are org-scoped
  (`Shift.organization_id == organization_id`,
  `ShiftAssignment.organization_id == organization_id`; the equipment-check
  template lookup takes `organization_id` through to its own org filter) —
  covered by `TestServiceBuild::test_a_record_in_another_org_is_not_found`.
- **A department's custom legal text cannot inject markup into the public
  page.** `LegalPage.tsx`'s `CustomText` component renders the published
  body as plain JSX text content (`{paragraph}` inside a `<p>`), never
  `dangerouslySetInnerHTML` — confirmed by reading the component, not just
  its comment. A `legal.publish` holder who submits `<script>` as the body
  gets it rendered literally as text to the public, not executed. This
  matters because this is the one path in the feature where an
  authenticated write reaches an _anonymous_ audience.
- **Legal-revision writes are org-scoped and use `apply_updates`
  correctly.** `get_revision` filters `organization_id` explicitly, with a
  comment citing Pitfall #14b by name — a permission check proves the caller
  holds it _in their org_, not that a path id belongs to that org
  (`legal_service.py:51-69`). `update_draft` uses `apply_updates` with a
  `skip` set protecting `id`/`organization_id`/`document_type`/`status`, so
  an explicit null on `effective_date` clears it while a null against the
  `NOT NULL` `body`/`change_note` raises rather than either silently
  dropping or corrupting the row (`:119-142`) — covered by
  `test_legal_documents.py::test_clearing_the_effective_date_persists` and
  `::test_nulling_a_required_field_is_rejected_not_dropped`.
- **`_write_settings` avoids the JSON-column shallow-copy trap.**
  `copy.deepcopy(organization.settings or {})` before mutating the nested
  `"legal"` key, with a comment citing Pitfall #12 by name — a shallow copy
  here would have let a publish report success while writing nothing
  (`legal_service.py:277-303`). As of this pass it also owns a per-document
  effective-date key rather than one shared key — see DOC-10.
- **The migration backfilling `legal.propose`/`legal.publish` onto existing
  positions is sound.** Guards `positions` table existence before querying
  it (Pitfall #26 — `positions` is a `create_all`-only table on a fresh
  install, materialized after migrations run), and only grants each new
  permission to a position that already held the settings-tier permission it
  mirrors (`settings.view` → `legal.propose`, `settings.manage` →
  `legal.publish`) — not a blanket grant
  (`20260820_0135_06adc68a8b84_add_legal_document_revisions.py:132-150`).
- **`DocumentFolderCreate`/`Update.visibility` are enum-constrained at the
  schema boundary** (`Field(pattern="^(organization|leadership|owner)$")`),
  re-confirmed unchanged from app-review pass 3's finding — no
  free-string-to-ENUM 500 path.

## Findings

Nine of eleven Codex comments were real, contained bugs and are fixed in
this pass. Two (DOC-8, DOC-9) are the unbounded-list class this rotation
consistently flags rather than fixes (FIN-9/ELEC-12/USR-5/MP-10/MS-6). One
(DOC-18) is a genuine, larger gap — no authenticated download path exists at
all — flagged for an owner decision rather than built here. DOC-4 and DOC-5
from the earlier module audit remain open, unchanged. DOC-17 is a doc-only
correction.

### DOC-4 — LOW — `get_documents_summary` ignores the folder ACL — 🚩 still flagged (unchanged)

Re-confirmed unchanged: `get_summary` (`documents_service.py:953-998`) still
aggregates `total_documents`/`total_folders`/`total_size_bytes`/
`documents_this_month` across the whole org, including leadership-only and
owner-only (member personal) folders — counts only, no names or content.
Scoping it to `accessible_folder_ids` is a behavior change to a stats
endpoint some deployments may read as an org-wide total; left as an owner
decision, already in `docs/KNOWN_LIMITATIONS.md`.

### DOC-5 — LOW (design) — Folder ACL is per-folder, not hierarchical — 🚩 still flagged (unchanged, and now confirmed to extend to facility folders too)

Re-confirmed unchanged: `can_access_folder` (`documents_service.py:176-197`)
inspects only a folder's own `visibility`/`allowed_roles`, never its
ancestor chain. The apparatus and (newly reviewed this pass) facility
sub-folder provisioning helpers both create children at
`FolderVisibility.ORGANIZATION` under a `FolderVisibility.LEADERSHIP` root
(`ensure_apparatus_folder`/`ensure_facility_folder`,
`documents_service.py:585-830`) — so any `documents.view` holder can read
those child folders directly, the same gap DOC-5 already describes for
apparatus, now confirmed to apply identically to the facility hierarchy
added since. Still a genuine product decision, not a clear bug — org-visible
apparatus/facility files may be exactly what's wanted (crews reading their
rig's manuals). Member personal folders remain unaffected
(`FolderVisibility.OWNER`, individually scoped). Already in
`docs/KNOWN_LIMITATIONS.md`.

### DOC-6 — see module-audit — ✅ FIXED (pre-existing, re-confirmed)

Client-supplied FK validation on `parent_id`/`owner_user_id`/`folder_id`.
Re-confirmed intact this pass (see Verified good), and now paired with
DOC-16's cycle check on the same `parent_id` field.

### DOC-7 — LOW — `_assert_may_modify` had zero test coverage — ✅ FIXED

`_assert_may_modify` (`legal_documents.py:323-335`) is the only thing
stopping a `legal.propose`-only holder from rewriting or discarding a
colleague's draft under their own name — the separation-of-duties guard
called out in the route inventory's note on `PUT`/`DELETE
/legal-documents/revisions/{id}`. Neither branch (author-may-edit-own,
non-publisher-blocked-from-others, publisher/`settings.manage`-override) was
exercised anywhere in the test suite; a regression here would have shipped
silently. Added 4 direct unit tests exercising the function against a
transient `LegalDocumentRevision`/`SimpleNamespace` user (no DB needed, since
the guard reads only `created_by` and the caller's `positions`/`rank`):
`tests/test_legal_documents.py::TestAssertMayModify`.

### DOC-8 — MED — `LegalDocumentService.list_revisions` is unbounded — 🚩 flagged, not fixed

`list_revisions` (`legal_service.py:97-103`) runs `.all()` with no SQL
`LIMIT`/`OFFSET`, and `GET /legal-documents` (`legal_documents.py:65-136`)
returns every draft and every archived revision's full `body` (capped at
100,000 chars each, `MAX_BODY_CHARS`) and `change_note` in one response, for
both document types, on every screen load. Access control is sound — org-
scoped, `legal.propose`/`legal.publish`/`settings.manage`-gated — so this is
a scaling/abuse-resistance gap, not a leak: a department with years of
proposal history, or a `legal.propose` holder repeatedly creating drafts
(the endpoint enforces no per-user or per-org cap on draft creation), pays a
response and query cost that grows without bound. Same class as
FIN-9/ELEC-12/USR-5/MP-10/MS-6 — a response-envelope/frontend-contract
change (this screen currently expects the full `drafts`/`history` arrays
inline per document type, not a paginated sub-resource), so left as an owner
decision rather than guessed at here. Mirrored into `KNOWN_LIMITATIONS.md`.

### DOC-9 — MED — `get_folders` is unbounded and N+1 — 🚩 flagged, not fixed

`get_folders` (`documents_service.py:96-163`) loads every folder at a given
level (root, or one `parent_id`) with no `LIMIT`, then issues one additional
`func.count` query per folder to populate `document_count` — genuinely N+1,
not just unpaginated. Any `documents.manage` holder can create arbitrary
folders (no per-org cap on `create_folder`), so both the row count and the
query count scale with however many folders a department (or a
misbehaving/compromised admin session) has created. The previous version of
this file called this "bounded by organizational structure, not
user-generated content growth" — that was wrong; `documents.manage` is a
sufficiently common grant (department officers generally hold it) that
folder count is user-generated, not structural. Same class as DOC-8 and the
rotation's other unbounded-list findings; a response-envelope change, so
flagged rather than fixed. Mirrored into `KNOWN_LIMITATIONS.md`.

### DOC-10 — MED — Legal documents shared one effective date between two independent documents — ✅ FIXED

`_write_settings` stored a single `settings["legal"]["last_updated"]` used
by _both_ the privacy policy and the terms of service — publishing one
document overwrote the date shown on the other's public page, and
publishing a revision with no `effective_date` of its own silently inherited
whatever date the other document last set. `get_legal_documents`'s overview
and the anonymous `GET /api/public/v1/legal` endpoint both read that same
shared key, so the misdating was visible on both the authenticated
governance screen and the public `/privacy`/`/terms` pages.

Fixed by giving each document type its own settings key
(`privacy_policy_effective_date` / `terms_of_service_effective_date`,
`EFFECTIVE_DATE_KEY` in `legal_service.py`) instead of one shared
`last_updated`. Publishing a revision with no date now clears any stale date
left by a _previous_ revision of the same document type, rather than
leaving it in place misattributed to the new text — the date belongs to the
revision, not to the document type. A shared `effective_date_for(legal,
document_type)` helper reads the per-type key first, falling back to the
legacy shared key so an install that already published under the old shape
keeps showing its date until the document is next republished, rather than
losing it outright the moment this deploys. Both `legal_documents.py`'s
`get_legal_documents` and `app/api/public/legal.py` were updated to use it;
the public endpoint's response now carries
`privacyPolicyLastUpdated`/`termsOfServiceLastUpdated` instead of one
`lastUpdated`, and `LegalPage.tsx` was updated to read the field matching
the page it's rendering. This is a settings-JSON key change, not a schema
migration — no `Organization` column changed shape.

Covered by `tests/test_legal_documents.py::TestWriteSettings` (four new
cases: publishing one document doesn't misdate the other, publishing
without a date clears a stale one, reverting clears only that document's own
key) and `TestEffectiveDateFor` (per-type key wins, legacy fallback, no date
anywhere yields `None`); frontend regression in
`LegalPage.test.tsx::"does not misdate terms with the privacy policy date"`.

### DOC-11 — MED — A malformed folder UUID reached the client as a 500 — ✅ FIXED

`list_folders`'s `parent_id` query param, `list_documents`'s `folder_id`
query param, and `upload_document`'s `folder_id` form field all called
`UUID(value)` directly on a client-supplied string with no error handling.
A malformed value — including the literal `"general"` the upload form sends
as its `folder_id` placeholder when an organization has no folders yet
(`frontend/src/pages/DocumentsPage.tsx:62,162,211`) — raised an unhandled
`ValueError` that FastAPI's default handler turns into a 500, not a 4xx.

Fixed with a shared `_parse_uuid_or_400` helper (`documents.py`) used at all
three call sites; a malformed id is now a clean `400` naming the offending
field. This does not change what happens when an org genuinely has no
folders and the UI's `"general"` placeholder is sent — that still 400s,
since `"general"` is a UI placeholder string, not a real folder id or slug,
and mapping it to "no folder" would be a product decision (does "general"
mean "the org-level General Documents folder" or "no folder selected"?) out
of scope for this fix, which is specifically about the error class, not the
placeholder's semantics.

Covered by `tests/test_documents_access.py::TestParseUuidOr400` (valid UUID
parses, a malformed value is a 400 not a 500, an empty string is also a
clean 400).

### DOC-12 — MED — PATCH endpoints silently dropped explicit nulls — ✅ FIXED

`update_folder` and `update_document` (`documents.py`) dumped their Pydantic
payloads with `model_dump(exclude_none=True)` — the exact update-path
mirror-image of CLAUDE.md Pitfall #1. An explicit `null` sent to clear a
folder's `parent_id`/`owner_user_id` or a document's `folder_id` was dropped
before the service ever saw it: the request returned 200, but the old
foreign key survived untouched, contradicting the prior DOC-6 write-up's
claim that clearing these FKs is supported.

Fixed by switching both endpoints to `model_dump(exclude_unset=True)` and
routing the service methods through `app/utils/model_updates.apply_updates`
(the codebase's established pattern for this — `legal_service.py`'s own
`update_draft` already used it) instead of a bare `setattr` loop. This also
closes a related latent gap: previously, sending an explicit `null` against
a `NOT NULL` column (e.g. a document's `status`) would never have reached
the `setattr` loop either (dropped by `exclude_none`); now it raises a clean
`ValueError` → 400 instead of either silently doing nothing or (had the
dump flag been fixed without also fixing the write loop) a flush-time
`IntegrityError`.

Covered by `tests/test_documents_access.py::TestUpdateFolderPreservesExplicitNulls`
(explicit null clears `parent_id`; omitting the field leaves it alone;
folded in with DOC-16's cycle-rejection test in the same class).

### DOC-13 — LOW — Upload's required `name` field contradicted the UI's advertised-optional field — ✅ FIXED

The upload form's Document Name field is labeled "Optional - defaults to
file name" and the frontend omits the `name` key entirely from the
multipart payload when the field is left blank
(`frontend/src/pages/DocumentsPage.tsx:153-154`). `upload_document` declared
`name: str = Form(...)` — required — so FastAPI 422'd on exactly the normal,
advertised path before any file was saved. The prior "upload hardening
intact" verification checked the MIME/size/path-traversal guards but never
exercised this specific advertised-optional path.

Fixed: `name` is now `Form(None)`, and a new `_resolve_document_name(name,
filename)` helper derives the display name from the uploaded file's
filename (falling back to `"Untitled document"` if neither is present) when
the caller sends a blank or absent name — matching what the UI promises.

Covered by `tests/test_documents_access.py::TestResolveDocumentName` (caller-
supplied name wins; blank/whitespace-only/absent name falls back to the
filename; no name and no filename gets the generic default).

### DOC-14 — MED — The station-print endpoint leaked printer network topology on failure — ✅ FIXED

`POST /station-documents/print` returned `str(PrinterUnreachableError)`
directly on a failed print, and that exception's messages
(`app/utils/printer_transport.py`) embed the printer's configured
hostname/IP and port (e.g. `"Could not connect to the printer at
10.0.0.7:9100."`). Unlike `labels.py`'s printer endpoints — which raise the
same exception type the same way but are gated on
`settings.manage`/`organization.update_settings`, i.e. the same admin who
configured the printer and already knows its address — this endpoint is
reachable by ordinary `scheduling.view`/`equipment_check.submit` holders,
who need not have any printer-configuration access. A failed print
therefore disclosed internal network topology to a caller who may hold no
administrative permission at all.

Fixed: the endpoint now logs the real exception at ERROR level and returns
a generic `502` detail ("The printer could not be reached. Contact whoever
manages the station printer.") instead of the transport's message. Scoped
to this endpoint only — `labels.py`'s admin-gated printer endpoints are
unaffected and out of scope for this feature; their echoing the same detail
back to an already-privileged caller is not the same exposure.

Covered by `tests/test_print_documents.py::TestPrinterErrorRedaction`
(asserts the response is a 502 and that neither the configured host nor
port appear in the detail string).

### DOC-15 — MED — Concurrent publishes of the same legal document type could both succeed — ✅ FIXED

`publish` and `revert_to_default` (`legal_service.py`) are a read-then-write
decision with no lock: both read the currently-published revision for a
`(organization_id, document_type)`, archive it, and mark their own row
`PUBLISHED`. Two concurrent publishes of the same document type could both
read the same prior revision, both archive it, and both end up `PUBLISHED`
— the same shape as CLAUDE.md Pitfall #27. `Organization.settings` is then
last-writer-wins on top of that, so the governance overview could show a
different revision as "published" than the one the public `/privacy`/
`/terms` page was actually serving.

Fixed by locking the organization row (`_get_organization_for_update`, a
`SELECT ... FOR UPDATE`) before archiving and publishing — `Organization` is
the parent row both operations share (there's no separate row per document
type, and it's the only row guaranteed to exist before a first publish).
Locking the parent alone is not sufficient per Pitfall #27's second half:
under this app's default InnoDB REPEATABLE READ, a plain `SELECT` inside
`_archive_published` would still answer from the transaction's original
snapshot, taken before the lock was acquired, and could archive a
revision that a concurrent transaction had already superseded. Made that
read itself a locking `SELECT ... FOR UPDATE` too. `revert_to_default` goes
through the same locked path for consistency, since it has the identical
read-archive-write shape.

Checked by source inspection rather than a live two-connection race — the
same approach `tests/test_capacity_locking.py` uses for this exact class of
bug in this codebase, because a genuine race is expensive to set up
reliably against a shared CI database and a static check catches the same
regression (a lock nobody calls, or a plain read of the very row the lock
protects, is invisible in every test that doesn't race itself). Covered by
`tests/test_legal_documents.py::TestPublishLocking` (four cases: `publish`
and `revert_to_default` both call the locking helper; the helper and
`_archive_published` are both genuinely locking reads).

### DOC-16 — MED — A folder could be re-parented into its own descendant — ✅ FIXED

The existing DOC-6 FK-validation guard on `update_folder`'s `parent_id`
(`assert_in_org`) only checks that the target folder exists in the caller's
organization — it never checks that the target isn't the folder itself or
one of its own descendants. Setting a folder's `parent_id` to itself, a
child, or any deeper descendant committed a cycle: such a folder disappears
from root-based navigation (nothing ever reaches it walking down from a
root) and can break the recursive subtree walk `delete_folder` uses to
collect backing files before a cascade delete.

Fixed with a new `_creates_cycle` helper (`documents_service.py`) that walks
the _candidate parent's_ ancestor chain looking for the folder being moved —
bounded by tree depth, unlike walking the folder's own descendant subtree,
which can be arbitrarily wide. Self-parenting is caught with no query at
all (`folder_id == candidate_parent_id`). A defensive break on a
pre-existing, unrelated cycle (not one this call would create) prevents an
infinite walk rather than trying to repair a cycle that isn't this
operation's to fix. `update_folder` now raises a clean `ValueError` → 400
("A folder cannot be moved into itself or one of its own descendants")
before applying the update.

Covered by `tests/test_documents_access.py::TestCreatesCycle` (self-parent
with no query; a direct child; a deeper descendant; an unrelated folder is
not flagged; a pre-existing unrelated cycle terminates instead of hanging)
and `TestUpdateFolderPreservesExplicitNulls::test_moving_a_folder_under_its_own_descendant_is_rejected`
(integration, against a real database).

### DOC-17 — INFO — Route-inventory table used the wrong prefix for the authenticated legal router — ✅ doc-only correction

The route inventory listed the authenticated legal-document endpoints as
`/legal` and `/legal/revisions`. The router is actually registered as
`api_router.include_router(legal_documents.router, prefix="/legal-documents",
...)` (`api/v1/api.py`) — its real paths are `/api/v1/legal-documents[...]`.
The original table conflated this authenticated, permission-gated surface
with the separate anonymous `GET /api/public/v1/legal` endpoint (already
reviewed under feature 03), which shares no code path with it. No code
change; the table above now shows the corrected paths.

### DOC-18 — P1 — No authorized path exists to retrieve an uploaded document's bytes — ✅ FIXED

`DocumentResponse` deliberately excludes `file_path`, and a repo-wide search
of `endpoints/`, `services/`, and the Documents frontend page turned up no
`/documents/{id}/download` or any other file-serving route — and the
frontend's document cards never requested the bytes either. A member with
`documents.manage` could upload a file and later delete it, but nothing in
the application could ever open or download what was uploaded. The version
of this file before this round characterized `get_document` as "a direct
content read" and described the surface as "sound" against
injection/exposure dimensions; that framing assumed a download path existed
to be sound or unsound. It did not exist, so there was nothing to secure —
this was a missing-feature gap, not an access-control defect in what
existed.

**Fixed in this round** (ported from a competing PR, #1827, that implemented
this independently — see the revision note below): `GET
/documents/{document_id}/download` in `documents.py`, using the exact same
by-id fetch and `can_access_document` folder-ACL check as `GET
/{document_id}`, so a caller who cannot see a document cannot download it
either (a restricted document 404s, matching the existing "don't confirm
existence" behavior). The frontend gained a Download action wherever a
document is listed, plus the "All Documents" and has-file-aware gating
covered under DOC-22/DOC-23 below.

Recorded here rather than reopening `docs/KNOWN_LIMITATIONS.md`'s note,
which is removed as part of this fix.

---

**Round-3 addendum (2026-08-26):** Two competing PRs both fixed DOC-10
through DOC-17 independently. #1827 additionally implemented DOC-18 (this
finding) and had it Codex-reviewed on its own, which found five further
issues plus flagged the two round-2 regressions (DOC-19/DOC-20) again since
#1827's branch had diverged from this one before those landed. This PR
(#1826) was chosen as the survivor — more complete regression coverage, a
green full-suite run recorded at every round — and DOC-18's download
endpoint, ACL check, and frontend affordance were ported onto it here, with
all five new findings fixed before landing (never porting a half-reviewed
feature). #1827 is closed as superseded. Findings below are numbered DOC-22
through DOC-26, continuing this file's own sequence rather than reusing
#1827's (which collided with this file's DOC-19-21 for unrelated issues).

### DOC-22 — P1 — A folderless document was unreachable in the UI once uploaded — ✅ FIXED

DOC-11's fix made the upload form's "Folder" field actually optional at the
API layer (previously the frontend always sent a folder, even a fake
`"general"` placeholder value) — but `DocumentsPage.tsx` only ever fetched
documents while a real folder was selected, so a genuinely folderless
upload became invisible immediately after creation. A member could upload a
document, see the success state, and then never find it again through this
page — worse than the pre-fix state, where at least every document ended up
somewhere folder-shaped.

Fixed by adding an "All Documents" pseudo-folder (`DocumentsPage.tsx`) that
lists every document the caller can see, folderless ones included: selecting
it calls `getDocuments({})` (no `folder_id` filter) rather than
`getDocuments({ folder_id })`. The upload form's folder select also gained
an explicit "No folder" option so choosing no folder is a deliberate action,
not merely leaving a field blank.

### DOC-23 — P2 — The Download action was offered on documents that could never succeed — ✅ FIXED

A generated document (published meeting minutes, a property return) is
stored with `content_html` and no `file_path` at all — by design, it has no
separate file on disk. Rendering a Download button unconditionally on every
row would have shown one on these too, guaranteed to 404 the moment it was
clicked, with no indication beforehand that it would fail.

Fixed by adding `Document.has_file` (`models/document.py`), a `bool(
self.file_path)` property exposed on `DocumentResponse` and
`DocumentRecord`, and gating the frontend's Download button on it. The
download endpoint's own `if not document.file_path: raise HTTPException(404,
...)` stays as defence-in-depth — `has_file` only controls whether the
button renders, never access.

### DOC-24 — P1 (security) — Download's path-containment check was scoped to the shared root, not the caller's own org directory — ✅ FIXED

`upload_document` writes every file under `UPLOAD_DIR/<organization_id>` —
every organization gets its own subdirectory under one shared root. A
containment check that only confirmed the resolved path stayed inside
`UPLOAD_DIR` (the root) would still accept a `file_path` value pointing at
_another org's_ subdirectory: `UPLOAD_DIR/org-b/theirs.pdf` passes a
root-level check just as easily as `UPLOAD_DIR/org-a/mine.pdf` does. Since
`Document.file_path` is plain unvalidated text with no application code
path that would ever legitimately write a cross-org value into it, this is
defence-in-depth rather than an exploitable path today — but a corrupted
row, a future bulk-import script, or a bug elsewhere that ever let
`file_path` be influenced would have served the wrong organization's file
with no additional check catching it. Treated with the rigor this rotation
gives tenant-isolation findings (CLAUDE.md Pitfall #14 shape), since the
consequence — one org's document served to another — is the same shape as
those.

Fixed in `download_document` (`documents.py`): the allowed base is
`os.path.realpath(os.path.join(UPLOAD_DIR, str(current_user.organization_id)))`,
not `os.path.realpath(UPLOAD_DIR)`. A resolved path that doesn't fall inside
the caller's own org subdirectory is rejected with 403, logged as a path
traversal attempt.

Covered by `tests/test_documents_access.py::TestDownloadDocument::test_path_inside_another_orgs_upload_directory_is_rejected`
(a `file_path` pointing at a different, real org's own subdirectory) and
`::test_path_outside_upload_dir_is_rejected` (a `file_path` outside
`UPLOAD_DIR` entirely).

### DOC-25 — P2 — Removing `lastUpdated` from the public legal endpoint broke a documented response field — ✅ FIXED

DOC-10 replaced the public legal endpoint's single shared `lastUpdated`
field with `privacyPolicyLastUpdated` / `termsOfServiceLastUpdated`, which is
the right shape going forward (one shared date across two independent
documents was finding #3 of this file). But `wiki/API-Reference.md` — the
in-repository reference for `GET /api/public/v1/legal` — documents the
response as `{ organizationName, privacyPolicy, termsOfService, lastUpdated
}`. An external v1 client built against that documented shape, whether
reading the field or strictly decoding the response, loses or breaks on a
field the docs say exists.

This is pre-1.0 internal tooling for department deployments rather than a
platform with a versioned external developer ecosystem, and there is no
evidence in the repo of an actual deprecation policy or versioned-contract
promise beyond this one wiki page — but the wiki page is itself evidence
that the shape was documented as a contract, which is enough to fix rather
than merely flag.

Fixed by keeping `lastUpdated` in the response (`api/public/legal.py`),
deprecated, aliased to whichever per-document date is set (privacy
policy preferred) — the same ambiguity the original shared key always had,
not a new one. No migration or frontend change: the org's own `LegalPage.tsx`
already reads the per-type fields and never looks at `lastUpdated`.

### DOC-26 — P3 — No audit log entry for a document download — ✅ FIXED

`SECURITY.md` calls for audit coverage of sensitive data access, and
`document_uploaded` / `document_deleted` events already exist for the other
document lifecycle actions — but the new download endpoint had no
corresponding entry, so there was no record of who retrieved a given
document's contents.

Fixed by adding a `document_downloaded` audit event (`documents.py`,
`log_audit_event`, `severity="info"`, matching `document_uploaded`) on a
successful download, recording the document id, actor, and organization
(the last two resolved by `log_audit_event` from `current_user` the same
way every other call site in this file does) — not the filesystem path,
per the finding's own guidance.

---

**Round-2 addendum (2026-08-25):** A Codex review of commit `dd0e40cd` on
follow-up PR #1826 found three more issues in the fixes above — one real
regression each in DOC-10's fallback and DOC-12's null-handling, plus a test
file the completion-gate command list omitted. All three fixed in this pass.

### DOC-19 — P2 — DOC-10's legacy-date fallback couldn't tell "never migrated" from "explicitly cleared" — ✅ FIXED

`_write_settings`'s publish path popped a document type's per-type date key
whenever a revision published with no `effective_date`, on the reasoning
that a carried-over date would misattribute the new text to an old
revision. That reasoning is right for a previous _per-type_ date, but the
pop was indistinguishable from a key that had never been written at
all — which is exactly the state `effective_date_for`'s legacy-fallback
check was designed to detect. An org still carrying the pre-DOC-10 shared
`last_updated` key that republished a document with the date box left blank
got that stale legacy date resurrected onto the new text, silently
misattributing it.

Fixed by writing the per-type key on every publish, using an explicit
`None` rather than popping it when no date is supplied. `effective_date_for`
now branches on **key presence**, not truthiness: `date_key in legal` means
this document type has been published at least once under the per-type
scheme (whatever the value), so its value is trusted outright, `None`
included; the legacy fallback fires only when the key has never been
written for this document type at all. `revert_to_default`'s full pop of
both keys is untouched — reverting removes the custom body entirely, and
`LegalPage.tsx` never reads the date when there is no custom body to date,
so there's nothing for that path to misattribute.

One edge case worth naming rather than leaving implicit: an org that
publishes privacy under the new scheme with a blank date, then _never
touches terms_, keeps reading `last_updated` for terms indefinitely (by
design — terms hasn't migrated yet) — but if that org's `last_updated` was
itself set by privacy's last pre-migration publish, terms is now showing a
date that described privacy's old text, not its own. This is the
pre-existing DOC-10 finding #3 shape (one shared key covering two
documents), not a new bug from this fix; it self-resolves the moment terms
is republished, same as any other legacy-fallback install.

Covered by `tests/test_legal_documents.py::TestWriteSettings::test_publishing_without_a_date_does_not_resurrect_the_legacy_date`
and `TestEffectiveDateFor::test_explicit_none_per_type_key_does_not_fall_back`,
plus `tests/test_public_legal.py::TestGetLegalText::test_republishing_one_document_stops_its_legacy_fallback`
at the endpoint layer.

### DOC-20 — P1 — Folder PATCH accepted a null `color`/`icon` the response schema can't serialize — ✅ FIXED

DOC-12's fix routed `update_folder` through `apply_updates`, which honors an
explicit `null` as "clear this field" whenever the underlying column is
nullable — correct for `parent_id`/`owner_user_id`, but `DocumentFolder.color`
and `.icon` are also DB-nullable (the columns predate their
`"#3B82F6"`/`"folder"` defaults) while `DocumentFolderResponse` declares both
as plain, non-`Optional` `str`. A client `PATCH`ing `{"color": null}` sailed
through `apply_updates`, committed, and only failed when a response schema
tried to serialize the row — a 500 raised _after_ the null was already
persisted, and the poisoned row then broke every subsequent folder-listing
response that included it too.

Fixed in `update_folder` (`documents_service.py`): an explicit `null` for
`color` or `icon` is rejected with a `ValueError` (→ 400 via the endpoint's
existing `handle_service_errors`) before `apply_updates` ever runs, at the
same layer as the other folder-specific checks (parent cycle, in-org FKs)
already there. Chose rejection over widening the response schema to
`Optional[str]`: neither the folder-icon renderer
(`frontend/src/pages/DocumentsPage.tsx`, `folder.color || <fallback>`) nor
any other frontend call site ever expects or handles a colorless/iconless
folder — every folder is created with a default, and there is no feature
asking to clear one back to "none." Setting a _new_, non-null value is
unaffected.

Covered by `tests/test_documents_access.py::TestUpdateFolderPreservesExplicitNulls::test_clearing_color_or_icon_is_rejected`
(parametrized over both fields) and `::test_setting_color_and_icon_to_a_new_value_still_works`.

### DOC-21 — P1 — `test_public_legal.py` was missing from the completion-gate command and broke silently — ✅ FIXED

DOC-10 changed the public legal endpoint's response shape — one shared
`lastUpdated` field became `privacyPolicyLastUpdated` /
`termsOfServiceLastUpdated` — but `tests/test_public_legal.py` was not in
the pytest invocation this rotation's commits ran
(`test_documents_access.py tests/test_legal_documents.py
tests/test_print_documents.py tests/test_changelog_fixes.py`), so its
fixtures and assertions against the old shape kept passing in CI's eyes
while asserting a key (`lastUpdated`) the endpoint no longer returns —
they'd have failed the moment anyone ran this file, silently.

Fixed by updating every fixture/assertion to the current per-document-type
shape, and folding in the completion gate command below and going forward.
Also added: a per-type-dates case (publishing one document's date and
reading the other's independently), a legacy-fallback case for an org that
never migrated, the DOC-19 republish-clears-fallback regression at the
endpoint layer, and an oversized-effective-date truncation case
(`_MAX_LEGAL_DATE_CHARS`) that had no coverage anywhere.

No test in this file was previously covering the response shape at all
after DOC-10 landed — every assertion against `lastUpdated` was dead code
that happened to still exist as valid Python.

## Schema & migration notes

`20260820_0135_06adc68a8b84_add_legal_document_revisions.py` reviewed in
full — sound (see Verified good). `created_by`/`published_by` are
`ondelete="SET NULL"` and correctly `nullable=True` (Pitfall #2, cited by
name in the migration's own comment). No migration touches these tables
since the last audit; DOC-10's effective-date fix changes only which keys
are written inside the existing `Organization.settings` JSON column, so no
new migration is needed.

## Guard tests

This pass added or extended:

- `tests/test_legal_documents.py::TestAssertMayModify` — DOC-7 (added last
  pass, unchanged this pass).
- `tests/test_legal_documents.py::TestWriteSettings` — 3 new cases for
  DOC-10 (per-document date isolation, stale-date clearing on republish,
  revert clears only that document's key).
- `tests/test_legal_documents.py::TestEffectiveDateFor` — new class, 4
  cases, for DOC-10's read-side helper and legacy fallback.
- `tests/test_legal_documents.py::TestPublishLocking` — new class, 4 cases,
  source-inspection guard for DOC-15.
- `tests/test_documents_access.py::TestParseUuidOr400` — new class, 3 cases,
  for DOC-11.
- `tests/test_documents_access.py::TestResolveDocumentName` — new class, 4
  cases, for DOC-13.
- `tests/test_documents_access.py::TestCreatesCycle` — new class, 5 cases,
  for DOC-16.
- `tests/test_documents_access.py::TestUpdateFolderPreservesExplicitNulls` —
  new class, 3 cases (integration, against a real database), for DOC-12 and
  DOC-16 together.
- `tests/test_print_documents.py::TestPrinterErrorRedaction` — new class, 1
  case, for DOC-14.
- `frontend/src/pages/legal/LegalPage.test.tsx` — 1 new case ("does not
  misdate terms with the privacy policy date") plus updated fixtures for
  DOC-10's response-shape change.

Existing coverage otherwise still pins every invariant checked above:
`tests/test_documents_access.py`, `tests/test_legal_documents.py`,
`tests/test_print_documents.py`, `tests/test_changelog_fixes.py` — 155
backend tests total this pass, all passing.

**Round-2 additions (2026-08-25, Codex on #1826):**

- `tests/test_legal_documents.py::TestWriteSettings::test_publishing_without_a_date_does_not_resurrect_the_legacy_date`
  and `TestEffectiveDateFor::test_explicit_none_per_type_key_does_not_fall_back`
  — DOC-19.
- `tests/test_documents_access.py::TestUpdateFolderPreservesExplicitNulls::test_clearing_color_or_icon_is_rejected`
  (parametrized, both fields) and `::test_setting_color_and_icon_to_a_new_value_still_works`
  — DOC-20.
- `tests/test_public_legal.py` — every fixture/assertion updated off the
  removed `lastUpdated` field; added a per-type-dates case, a
  never-migrated legacy-fallback case, the DOC-19 regression at the
  endpoint layer (`test_republishing_one_document_stops_its_legacy_fallback`),
  and an oversized-effective-date truncation case — DOC-21.

`tests/test_documents_access.py`, `tests/test_legal_documents.py`,
`tests/test_print_documents.py`, `tests/test_changelog_fixes.py`,
`tests/test_public_legal.py` — 171 backend tests total this round, all
passing; full `pytest tests/` — 8156 passed, 22 skipped (pre-existing Docker
skips, daemon unavailable in this environment), 0 failed.

**Round-3 additions (2026-08-26, DOC-18 port + DOC-22 through DOC-26):**

- `tests/test_documents_access.py::TestDownloadDocument` — new class, 6
  cases (integration, against a real database and a real `tmp_path`
  filesystem, matching `upload_document`'s own `UPLOAD_DIR/<org_id>` save
  convention): accessible document downloads, a leadership-restricted
  document 404s rather than 403 (matches `get_document`), a generated
  document with no `file_path` 404s (DOC-23), a missing file on disk 404s,
  a `file_path` outside `UPLOAD_DIR` entirely is rejected 403, and —
  DOC-24's guard test specifically — a `file_path` inside a _different,
  real_ organization's own upload subdirectory is rejected 403.
- `tests/test_public_legal.py::TestGetLegalText` — extended every existing
  case with a `lastUpdated` assertion (DOC-25): present as the deprecated
  back-compat alias when a per-type or legacy date exists, `None` when
  neither does, and continuing to prefer the privacy policy's date when
  both are set.
- `frontend/src/services/documentsService.test.ts` — 2 new cases for
  `downloadDocument` (blob response, error propagation).
- `frontend/src/pages/DocumentsPage.test.tsx` — new file, 3 cases: a
  folderless document is reachable via "All Documents" (DOC-22), the
  Download action is hidden on a `has_file: false` document and shown on a
  real one (DOC-23), and clicking Download calls the service with the
  document id.

`tests/test_documents_access.py`, `tests/test_legal_documents.py`,
`tests/test_print_documents.py`, `tests/test_changelog_fixes.py`,
`tests/test_public_legal.py` — 177 backend tests total this round, all
passing; full `pytest tests/` — 8162 passed, 22 skipped (pre-existing Docker
skips, daemon unavailable in this environment), 0 failed.

## Completion gate

| Check                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8`                                                                                                                                                     | pass (`app/`, `tests/`, `alembic/`)                                                                                                                                                                                                                                                                                                                                                                                       |
| `black --check`                                                                                                                                              | pass                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `isort --check-only`                                                                                                                                         | pass                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                                                                            | pass (358 migrations, single head)                                                                                                                                                                                                                                                                                                                                                                                        |
| `pytest tests/test_documents_access.py tests/test_legal_documents.py tests/test_print_documents.py tests/test_changelog_fixes.py tests/test_public_legal.py` | 177 passed                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pytest tests/` (full backend suite)                                                                                                                         | 8162 passed, 22 skipped, 0 failed                                                                                                                                                                                                                                                                                                                                                                                         |
| `npx tsc --noEmit` (frontend)                                                                                                                                | pass                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npx eslint .` (frontend)                                                                                                                                    | pass (0 errors, 1 pre-existing warning in `MyTrainingPage.tsx`, unrelated to this feature and untouched)                                                                                                                                                                                                                                                                                                                  |
| `npx vitest run` (frontend, full suite)                                                                                                                      | 388 test files, 5138 tests, all passed, 0 failed. 27 failures were present in `shiftBoard.test.ts`/`ShiftSeatList.test.tsx` when this round's work began (scheduling module, confirmed failing on this branch _before_ this round's changes via `git stash`) — a date-anchoring bug unrelated to Documents/Legal; fixed by a concurrent commit (`aa0529b5`) merged into this branch before push, not by this round's work |

## Next

Feature 11 (Inventory).
