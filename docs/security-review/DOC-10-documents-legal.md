# Security Review — Documents & Legal

**Prefix:** `DOC` · **Iteration:** 10 · **Reviewed:** 2026-08-25 · **PR:** (this PR)

**Backend:** `endpoints/documents.py` (462 L, 11 routes), `services/documents_service.py` (998 L), `endpoints/station_documents.py` (102 L, 2 routes, new to this rotation), `services/print_document_service.py` (515 L, new), `endpoints/legal_documents.py` (340 L, 6 routes, new), `services/legal_service.py` (241 L, new), `schemas/legal.py`, `schemas/documents.py`, `models/document.py`, `models/legal.py`
**Frontend:** `pages/legal/LegalPage.tsx` (public consumption path, read for XSS — see Verified good), `modules/governance/pages/LegalDocumentsPage.tsx` (not read in full — backend-only pass)
**Migrations:** `20260820_0135_06adc68a8b84_add_legal_document_revisions.py` — reviewed, sound

---

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
- **Explicitly out of scope:** `app/api/public/legal.py`, the anonymous `GET
/legal` endpoint the published text is served from. Already reviewed under
  feature 03 (`PUB-03-public-surface-webhooks.md` / PR #1806, finding PUB-2).
  This pass only checked the write side feeding it and the client-side
  rendering of what it returns.

## Route inventory

| Method | Path                                     | Permission                                                                   | Org-scoped                      |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| GET    | /folders                                 | documents.view                                                               | yes                             |
| POST   | /folders                                 | documents.manage                                                             | yes (+FK validation, DOC-6)     |
| PATCH  | /folders/{folder_id}                     | documents.manage                                                             | yes (+FK validation, DOC-6)     |
| DELETE | /folders/{folder_id}                     | documents.manage                                                             | yes                             |
| GET    | /documents                               | documents.view                                                               | yes                             |
| POST   | /documents/upload                        | documents.manage                                                             | yes (+folder-ACL check)         |
| GET    | /documents/my-folder                     | documents.view                                                               | yes (self-scoped)               |
| GET    | /documents/{document_id}                 | documents.view                                                               | yes (+folder-ACL check)         |
| PATCH  | /documents/{document_id}                 | documents.manage                                                             | yes (+FK validation, DOC-6)     |
| DELETE | /documents/{document_id}                 | documents.manage                                                             | yes                             |
| GET    | /documents/stats/summary                 | documents.view                                                               | yes (DOC-4: ignores folder ACL) |
| POST   | /station-documents/preview               | any permission the requested `document` accepts (see note)                   | yes                             |
| POST   | /station-documents/print                 | same                                                                         | yes                             |
| GET    | /legal                                   | legal.propose / legal.publish / settings.manage                              | yes                             |
| POST   | /legal/revisions                         | legal.propose / legal.publish / settings.manage                              | yes                             |
| PUT    | /legal/revisions/{revision_id}           | legal.propose / legal.publish / settings.manage (+own-draft check, see note) | yes                             |
| DELETE | /legal/revisions/{revision_id}           | legal.propose / legal.publish / settings.manage (+own-draft check)           | yes                             |
| POST   | /legal/revisions/{revision_id}/publish   | legal.publish / settings.manage                                              | yes                             |
| POST   | /legal/{document_type}/revert-to-default | legal.publish / settings.manage                                              | yes                             |

**Note on `/station-documents/{preview,print}`:** no `require_permission`
dependency — the permission set is a function of the request body's
`document` field (`shift_roster` → `scheduling.view`/`.manage`;
`apparatus_check_sheet` → `equipment_check.view`/`.submit`/`.manage`),
resolved and checked by `_authorize_document` before any work happens. Not a
gap: `required_permissions_for_document` returns `None` for an unregistered
key (404), and the permission check runs before `PrintDocumentService.build`
is ever called.

**Note on `/legal/revisions/{id}` PUT/DELETE:** gated at the router level by
the propose-tier permission, then narrowed by `_assert_may_modify` — a
caller who cannot publish may only touch a revision they themselves created
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
  (`documents_service.py:72-87`, `:247-265`, `:465-476`).
- **Upload hardening intact.** Magic-byte MIME detection against an
  allowlist (not the HTTP header), extension derived from the detected MIME
  (no double-extension attack), UUID on-disk filenames (no path traversal),
  50MB cap, org-segregated directories (`documents.py:236-291`).
- **Folder ACL is not bypassable on direct read.** `get_document` calls
  `can_access_document`, which resolves the containing folder org-scoped and
  applies the same `can_access_folder` rule the listing enforces, and
  answers 404 (not 403) on a restricted document so existence isn't
  confirmed to someone guessing ids (`documents.py:383-404`).
- **`GET /documents` (unfiltered listing) cannot leak a restricted folder's
  contents.** `accessible_folder_ids` returns `None` only for leadership;
  otherwise it's the actual set of folders the caller can see, and
  `get_documents` ANDs that into the query
  (`documents_service.py:219-237`, `:368-372`) — a folder-less listing
  cannot surface an owner-only or leadership-only folder's documents.
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
  (`legal_service.py:208-240`).
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
- **`GET /documents` and folder listings are pagination-safe** —
  `get_documents` takes `skip`/`limit` through to a SQL `OFFSET`/`LIMIT`
  (`documents_service.py:392-395`), unlike the unbounded-list class flagged
  elsewhere in this rotation (FIN-9/ELEC-12/USR-5/MP-10/MS-6). `get_folders`
  has no limit, but folder counts are bounded by organizational structure,
  not user-generated content growth, and this was already assessed clean
  rather than flagged in the module audit.

## Findings

No new findings. Every finding from `docs/module-audit/documents.md`
(DOC-1 through DOC-6) is either ✅ FIXED and re-confirmed intact, or — DOC-4
and DOC-5 — an unchanged, already-flagged owner decision (below).
`station_documents.py`/`print_document_service.py` and
`legal_documents.py`/`legal_service.py`, reviewed here for the first time
end-to-end, were found sound against all seven checklist dimensions: no
tenant-isolation gap, no injection surface (no raw SQL or `.ilike()` in
either), no data-exposure gap (the public-facing legal text path was traced
through to the frontend and confirmed to render as text, not HTML), and the
one new migration is guarded and correctly scoped.

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
`docs/KNOWN_LIMITATIONS.md`; no change needed there beyond noting the
facility case is the same shape (done below).

### DOC-7 — LOW — `_assert_may_modify` had zero test coverage — ✅ FIXED

`_assert_may_modify` (`legal_documents.py:323-335`) is the only thing
stopping a `legal.propose`-only holder from rewriting or discarding a
colleague's draft under their own name — the separation-of-duties guard
called out in the route inventory's note on `PUT`/`DELETE
/legal/revisions/{id}`. Neither branch (author-may-edit-own,
non-publisher-blocked-from-others, publisher/`settings.manage`-override) was
exercised anywhere in the test suite; a regression here would have shipped
silently. Added 4 direct unit tests exercising the function against a
transient `LegalDocumentRevision`/`SimpleNamespace` user (no DB needed, since
the guard reads only `created_by` and the caller's `positions`/`rank`):
`tests/test_legal_documents.py::TestAssertMayModify`.

## Schema & migration notes

`20260820_0135_06adc68a8b84_add_legal_document_revisions.py` reviewed in
full — sound (see Verified good). `created_by`/`published_by` are
`ondelete="SET NULL"` and correctly `nullable=True` (Pitfall #2, cited by
name in the migration's own comment). No other migration touches these
tables since the last audit.

## Guard tests

`tests/test_legal_documents.py::TestAssertMayModify` — added this pass to
close DOC-7 (see above); covers all four `_assert_may_modify` outcomes so a
future regression in the separation-of-duties guard fails a unit test
instead of shipping silently. Existing coverage otherwise already pins
every invariant checked above:
`tests/test_documents_access.py`, `tests/test_legal_documents.py`,
`tests/test_print_documents.py`, `tests/test_changelog_fixes.py` — 124 + 4
tests, run in full this pass, all passing.

## Completion gate

| Check                                             | Result                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8`                                          | pass (`tests/test_legal_documents.py`, the only file touched)                                                                                            |
| `black --check`                                   | pass                                                                                                                                                     |
| `isort --check-only`                              | pass                                                                                                                                                     |
| `python3 scripts/validate_migrations.py --strict` | pass (357 migrations, single head)                                                                                                                       |
| `pytest` — documents/legal/print test surface     | 128 passed (`test_documents_access.py`, `test_legal_documents.py` incl. new `TestAssertMayModify`, `test_print_documents.py`, `test_changelog_fixes.py`) |
| `npx tsc --noEmit`                                | not run — no frontend files changed                                                                                                                      |

## Next

Feature 11 (Inventory).
