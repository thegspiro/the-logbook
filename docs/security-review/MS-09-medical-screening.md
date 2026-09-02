# Security Review — Medical Screening

**Prefix:** `MS` · **Iteration:** 9 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2) · **PR:** [#1816](https://github.com/thegspiro/the-logbook/pull/1816) (pass 1), (this PR) (pass 2)

---

## Pass 2 (2026-08-27)

Scoped to the **full domain** since pass 1's merge commit (`daf5eaca`,
PR #1816): `endpoints/medical_screening.py`,
`services/medical_screening_service.py`, `models/medical_screening.py`,
`schemas/medical_screening.py`, every migration since (checked by content,
not filename, for anything touching `screening_records`/
`screening_requirements`), and a `git diff --stat`/content-grep against
`frontend/src/` and `backend/app/` broadly for anything referencing
`medical_screening`/`screening_record`/`screening_requirement`, rather than
a directory glob — the scoping discipline this rotation had to re-learn on
ELEC-06 and MP-08.

**Backend declared files: zero changes.** `git diff daf5eaca..origin/main`
against all four files pass 1 named returns nothing.

**A real, non-trivial change did land, outside those four files: a
server-side module gate on the whole router.**
`backend/app/api/v1/api.py` now registers `medical_screening.router` with
`dependencies=module_gate("medical_screening", "Medical Screening")`, where
`module_gate` resolves to `Depends(require_module(...))`
(`api/dependencies.py:465`). This is new _enforcement_, not a new
permission model — it adds an AND condition ("does this org run the
module") on top of every route's existing permission check, never a
substitute for one. Traced in full:

- `require_module`'s underlying resolver, `get_request_enabled_modules`
  (`api/dependencies.py:404`), is the exact function this rotation already
  hardened — I rewrote it in ELEC-06 pass 2 to call
  `get_optional_current_user` directly (not via `Depends`) wrapped in
  try/except, so an invalid/expired session cookie is treated as anonymous
  for module-gating purposes rather than raising before the module check
  runs. That fix is unmodified here and still covered by
  `test_module_api_gating.py::test_an_invalid_session_cookie_does_not_block_a_public_route_either`.
- `require_module` deliberately passes an anonymous caller through (`enabled
is None` → return), reserved for routers that also carry
  token-authenticated public routes. `medical_screening.router` has no such
  route — every one of its 14 endpoints requires
  `Depends(get_current_user)` or a `require_permission(...)` dependency of
  its own — so this clause is a no-op here rather than a gap: an anonymous
  caller is rejected by the endpoint's own auth dependency regardless of
  what the module gate decides. Verified directly against
  `get_my_compliance` (`endpoints/medical_screening.py:358`), the one route
  with no permission string, which still declares
  `current_user: User = Depends(get_current_user)`.
- 403 (not 404) on a disabled module, with a dedicated error code
  distinguishing "your department switched this off" from "you lack the
  permission" — consistent with every other gated router, and confirmed
  covered for `/api/v1/medical-screening` specifically in
  `test_module_api_gating.py:207,466`.
- `ModuleSettings.medical_screening` (`schemas/organization.py`) defaults to
  `False`. **Correction (Codex review on this PR):** `onboarding.py` does
  not offer it during setup at all — `medical_screening` is in
  `ONBOARDING_SETTINGS_ONLY_MODULES` (`onboarding.py:71-80`), the list the
  wizard deliberately never asks about; it can only be turned on afterward,
  from Settings → Modules. Either way the module starts off and existing
  installations are unaffected on upgrade, matching this rotation's own
  CLAUDE.md Pitfall #19 concern (a switch must have a reader, and must not
  silently change existing behavior) — but "settings-only", not "offered
  during setup", is the accurate description.
- `admin_hub_service.py`'s metric resolver now skips the
  medical-screening lapse/overdue tiles when the module is off
  (`requires_module="medical_screening"`) — display-only, and the
  underlying data read stays permission-gated the same as before.

**Frontend, matching the backend change:**
`modules/medical-screening/routes.tsx` adds `requiredModule="medical_screening"`
to the existing `<ProtectedRoute requiredPermission="medical_screening.view">`.
Confirmed in `ProtectedRoute.tsx:178-224` that the permission/role checks
run strictly before the module gate (`if (requiredModule)` at line 219) —
additive, not a weakening, the same ordering already verified for MP-08's
equivalent change. `Dashboard.tsx`'s `loadMyScreenings` skips calling
`medicalScreeningService.getMyCompliance()` when `isModuleOn('medical_screening')`
is false — a UX/API-call-avoidance convenience with no security
implication, since `/compliance/me` was already safe by construction (no id
parameter, subject is always the caller) and still requires authentication
regardless of the module flag.

**Correction (Codex review on this PR):** that skip is not universal.
`useEnabledModules.ts:52,68` makes `isModuleOn` return `true` for every
module — including `medical_screening` — whenever the organization has no
stored module configuration at all (`enabledModules === null`, distinct
from "configured, and this module is off"; the hook's own comment names
this "permissive when unconfigured", by design, and applies to every
module's nav gate, not something introduced by this change). In that
narrow, genuinely-unconfigured state, `loadMyScreenings` does call the
endpoint even though the backend's `ModuleSettings.medical_screening`
defaults to `False` and will reject it — so the two gates can disagree for
an org that has never touched Settings → Modules. This is not a security
gap: the backend module gate is authoritative and correctly returns 403,
and `loadMyScreenings`'s `catch` silently clears the state to `null`
(`Dashboard.tsx:643-649`, written to avoid showing a stale answer on any
failure) rather than throwing, crashing, or leaking anything. It is a
UX-only mismatch — one predictably-failing request for an org in that
transient state — and changing `useEnabledModules`' permissive-when-
unconfigured default is a cross-cutting change to every module's nav gate,
not something scoped to medical screening or to this PR.

No migrations touch `screening_records`/`screening_requirements` since pass
1's merge. Completion gate: `test_module_api_gating.py` (parity test
covering this router) + `test_medical_screening_service.py` +
`test_medical_screening_update_guards.py` +
`test_my_medical_compliance_route.py` — 67 passed, 0 failed. No code
changes needed. Rotation row 09 -> done.

---

## Pass 1 (2026-08-25)

**Backend:** `endpoints/medical_screening.py` (417 L → 434 L this iteration, 14 routes), `services/medical_screening_service.py` (355 L → 605 L), `models/medical_screening.py`, `schemas/medical_screening.py`
**Frontend:** `modules/medical-screening/` (routes only — see Findings, MS-4)
**Migrations:** `20260810_0001_encrypt_medical_screening_phi.py` — re-verified sound, no new migration this iteration

## Scope

`docs/module-audit/medical-screening.md` (iteration 1: MS-1 through MS-3) and
`docs/app-review/medical-screening.md` (four passes, 2026-08-06 through
2026-08-09: MS-1/MS-2/MS-3/MS2-4/MS2-5) are the prior art. MS-1 (PHI stored in
plaintext) was the one item left open across all four app-review passes; it
was closed in pass 4 by converting the four PHI columns to
`EncryptedText`/`EncryptedJSON`. Every other finding across both docs is
already ✅ FIXED.

The endpoint/service files grew since the 2026-08-09 baseline (13 routes →
14; the service file gained ~250 lines) but `git log`/`git show --stat`
against this window returns only squash-merge artifacts that show the whole
file as new insertions — the same git-history unreliability this rotation has
hit on other features (see MP-08). Rather than trust that, this pass read
both files **in full**, current state, and compared structurally against what
the last app-review pass documented.

- **Read in full:** `endpoints/medical_screening.py`,
  `services/medical_screening_service.py`, `schemas/medical_screening.py`,
  the relevant parts of `models/medical_screening.py`, and the encryption
  migration.
- **New since the 2026-08-09 baseline:** `GET /compliance/me` +
  `MyComplianceSummary` (self-scoped compliance summary, counts only, no
  detail) and `try_advance_pipeline_stage` (a new integration point: a
  cleared screening result can auto-advance a prospect parked on a
  `MEDICAL_SCREENING` pipeline stage, via
  `MembershipPipelineService.try_auto_advance_current_step`). Both reviewed
  in full — see Verified good.
- **Not re-derived:** tenant isolation, access control, audit logging, cache
  exclusion, and the absence of raw SQL/unescaped LIKE — the prior passes
  already established these and this pass re-confirmed them directly against
  the current file rather than re-deriving them from scratch.
- **Frontend:** only the route-gating file
  (`modules/medical-screening/routes.tsx`) was in scope, because a
  `KNOWN_LIMITATIONS.md` entry claimed it was ungated — see MS-4. The rest of
  the frontend module was not read this pass.

## Route inventory

| Method | Path                               | Permission                                  | Org-scoped                 |
| ------ | ---------------------------------- | ------------------------------------------- | -------------------------- |
| GET    | /requirements                      | medical_screening.view                      | yes                        |
| GET    | /requirements/{requirement_id}     | medical_screening.view                      | yes                        |
| POST   | /requirements                      | medical_screening.manage                    | yes                        |
| PUT    | /requirements/{requirement_id}     | medical_screening.manage                    | yes                        |
| DELETE | /requirements/{requirement_id}     | medical_screening.manage                    | yes                        |
| GET    | /records                           | medical_screening.view                      | yes                        |
| GET    | /records/{record_id}               | medical_screening.view                      | yes                        |
| POST   | /records                           | medical_screening.manage                    | yes (+FK validation, MS-3) |
| PUT    | /records/{record_id}               | medical_screening.manage                    | yes                        |
| DELETE | /records/{record_id}               | medical_screening.manage                    | yes                        |
| GET    | /compliance/me                     | authenticated only (self-scoped — see note) | yes                        |
| GET    | /compliance/{user_id}              | medical_screening.view                      | yes                        |
| GET    | /compliance/prospect/{prospect_id} | medical_screening.view                      | yes                        |
| GET    | /expiring                          | medical_screening.view                      | yes                        |

**Note on `/compliance/me`:** no `require_permission` — deliberately, and
structurally safe rather than merely convention: the route takes no id
parameter at all, so the subject is always `current_user.id` and there is
nothing for a caller to substitute (no IDOR surface by construction). Covered
by a dedicated existing test file,
`tests/test_my_medical_compliance_route.py`, which also asserts the route is
registered **before** `/compliance/{user_id}` — FastAPI matches in
registration order, and reversed, `"me"` would be captured as a `user_id` by
the permission-gated route and a member's own read would 403.

## Verified good ✅

- **PHI encryption at rest (MS-1) is genuinely intact.**
  `models/medical_screening.py:181-194` — `provider_name`, `result_summary`,
  and `notes` are `Column(EncryptedText, ...)`; `result_data` is
  `Column(EncryptedJSON, ...)`. The migration
  (`20260810_0001_encrypt_medical_screening_phi.py`) widens the two columns
  whose type couldn't hold ciphertext (`provider_name` VARCHAR→TEXT,
  `result_data` JSON→TEXT) before encrypting existing rows in place, and its
  `downgrade()` decrypts and restores both types — genuinely reversible, not
  a one-way migration masquerading as one.
- **Tenant isolation holds throughout, re-confirmed directly against the
  current file.** Every by-id getter (`get_requirement`, `get_record`)
  filters `organization_id`; `update_*`/`delete_*` route through those
  getters. `create_record` validates all three client-supplied FKs
  (`user_id`, `prospect_id`, `requirement_id`) via `assert_in_org` with
  `allow_none=True` (MS-3) — a foreign or nonexistent id is refused with a
  400 before the row is written, not merely dangling.
- **`_resolve_names`/`attach_record_names` cannot leak a name across
  organizations.** Both batch-query `User`/`ProspectiveMember`/
  `ScreeningRequirement` filtered on `organization_id == organization_id`; an
  id belonging to another org is simply absent from the result map, so
  `.get()` yields `None` rather than another tenant's name.
- **`MyComplianceSummary` is a genuinely minimal, privacy-conscious
  response** — counts and a single days-until-next-lapse integer, no
  requirement name, screening type, date, or status. The schema's own
  docstring names the actual threat model (a kiosk tablet at a station,
  where a line like "Psychological evaluation expired" is legible to anyone
  walking past) rather than reading as boilerplate.
- **The new pipeline auto-advance integration
  (`try_advance_pipeline_stage`, `medical_screening_service.py:254-301`) is
  correctly scoped and gated.** It only fires for a `PASSED`/`COMPLETED`
  result on a record that already has a `prospect_id` — which was already
  validated in-org at record-creation time (MS-3) — and passes the
  **caller's** `organization_id` through unchanged to
  `MembershipPipelineService.try_auto_advance_current_step`
  (`membership_pipeline_service.py:3499`), which re-resolves the prospect
  org-scoped again, requires the prospect's _current_ stage to actually be
  `MEDICAL_SCREENING` typed, and requires the stage's own `auto_advance` opt-in
  before calling `complete_step` — which still enforces `_assert_movable`
  (the MP-08-reviewed closed-application gate) and the stage's own completion
  requirements. A `medical_screening.manage` holder cannot use this path to
  advance a prospect who is on hold, rejected, or on an unrelated stage type,
  and cannot reach a different organization's prospect.
- **No SQL injection surface.** No `.ilike()`/`.like()` calls in this
  service at all (re-confirmed by direct search of the full file); the
  expiring-soon cutoff is computed as a bound Python `date`.
- **`ScreeningRecordUpdate`/`ScreeningRequirementUpdate` cannot be used to
  reassign tenancy or subject.** Neither schema exposes `organization_id`,
  `user_id`, `prospect_id`, or `requirement_id` — the FK-reassignment
  protection lives at the schema level (a curated field allowlist) rather
  than a protected-fields skip-list, and both still correctly exclude those
  fields after this iteration's `apply_updates` rewrite (see MS-5).

## Findings

### MS-4 — LOW (doc accuracy) — Two docs claimed the frontend route was ungated after it was already fixed — ✅ FIXED (doc correction)

**What:** `docs/KNOWN_LIMITATIONS.md` and `APPLICATION_PAGES.md` both carried
an entry dated 2026-08-16 stating `getMedicalScreeningRoutes()` returned a
bare `<Route>` with no `<ProtectedRoute requiredPermission=…>` wrapper. Read
the current file directly:
`frontend/src/modules/medical-screening/routes.tsx:12-19` wraps the route in
`<ProtectedRoute requiredPermission="medical_screening.view">`. `git show
--stat 05b8275b -- frontend/src/modules/medical-screening/routes.tsx`
confirms the commit ("Stop seeding compliance.view to everyone; gate 21
officer pages", 2026-08-24) closed this alongside 20 other ungated officer
routes — one day before this review, and neither doc was updated to reflect
it.
**Why it matters even though the underlying gap is closed:** both docs were
actively wrong about the current state of an access-control control on a PHI
page, which is exactly the kind of doc a reviewer or an auditor would trust
without re-checking the code.
**Fix:** `KNOWN_LIMITATIONS.md`'s entry rewritten to state the resolution and
cite the fixing commit; `APPLICATION_PAGES.md`'s stale caveat block removed
so the table's existing `medical_screening.view` claim is simply correct
again.

### MS-5 — MED — Explicit null on a NOT NULL column 500'd instead of a clean 400 — ✅ FIXED

**What:** `update_record` and `update_requirement` built their update dict
via `data.model_dump(exclude_unset=True)` and wrote every key with a bare
`setattr(instance, key, value)` — no guard at all, so unlike the
`update_prospect` bug this rotation fixed in MP-08 (which _dropped_ an
explicit null), this one _wrote_ it. That sounds safer but isn't: `status`
and `screening_type` on `ScreeningRecord`, and `name`/`screening_type` on
`ScreeningRequirement`, are all `nullable=False` columns. The request
schemas' `_validate_enum` field validator returns `None` unchanged for a
`None` input (it only validates a _supplied_ enum value) — so
`{"status": null}` passes Pydantic validation cleanly, reaches
`setattr(record, "status", None)`, and only fails at `db.flush()` as a raw
MySQL `DataError`/`IntegrityError`. Neither `update_requirement`'s nor
`update_record`'s endpoint wrapped the call in a `try/except ValueError`
either, so there was no conversion path even if the service had raised one.
**Where:** `medical_screening_service.py` — `update_requirement` (then
lines 101-115), `update_record` (then lines 229-249);
`endpoints/medical_screening.py` — `update_requirement`, `update_record`.
**Failure scenario:** `PUT /medical-screening/records/{id}` with
`{"status": null}`, or `PUT /medical-screening/requirements/{id}` with
`{"name": null}`, from a `medical_screening.manage` holder — a legitimate,
privileged caller sending a plausible payload — 500s instead of getting a
clean rejection. This is the exact class CHECKLIST.md's schema-integrity
dimension calls out by name ("Update paths use `apply_updates` so an
explicit null clears the column instead of being silently dropped") and the
exact failure _shape_ MS2-5 already fixed for an out-of-enum string on these
same four write paths — just for the null case, which MS2-5's enum
validator doesn't cover since it explicitly passes `None` through.
**Impact:** a latent 500 on a privileged PHI write path, not an externally
reachable fault (same reasoning as MS2-5: only `medical_screening.manage`
reaches it, and the frontend's typed forms don't construct this payload) —
but worth closing for the same reason MS2-5 was.
**Fix:** both service methods now build with `apply_updates`
(`app/utils/model_updates.py`), which raises a clean `ValueError` for a null
against a `NOT NULL` column instead of writing it. Both endpoint handlers now
wrap their service call in `try/except ValueError → HTTPException(400,
safe_error_detail(...))`, matching `create_record`'s existing pattern. No
field-set or protected-field change: both schemas already omit every
tenancy/subject FK, so `apply_updates` is a like-for-like replacement of the
hand-rolled loop, not a behavior change for any valid payload.

### MS-6 — LOW (scale, unchanged) — Unbounded requirement/record lists — 🚩 FLAGGED, re-confirmed and mirrored

**What:** `list_requirements`/`list_records` run `.all()` with no SQL
`LIMIT`/`OFFSET`; the two endpoints slice the full result in Python via
`PaginationParams`, and `get_compliance_status`/`get_expiring_soon` build on
the same unbounded `list_requirements`/`list_records` calls internally. This
is the same class already tracked elsewhere in this rotation (FIN-9,
ELEC-12, USR-5, MP-10) and was already flagged as "Future dev" in
`docs/app-review/medical-screening.md` pass 3 — re-verified still true
against the current code, not previously mirrored into
`docs/KNOWN_LIMITATIONS.md`.
**Where:** `medical_screening_service.py` — `list_requirements`,
`list_records`.
**Failure scenario:** an organization that accumulates many years of
screening requirements/records pays a growing per-request cost on every
records/compliance/expiring load, with no ceiling — access control is sound
throughout (org-scoped, permission-gated), so this is a scaling concern, not
a leak.
**Fix:** not applied — same reasoning as the other three: a true SQL
`LIMIT`/`OFFSET` is a response-envelope/frontend-contract change needing an
owner decision, consistent with how this rotation has handled every other
instance of this class. Mirrored into `docs/KNOWN_LIMITATIONS.md` this
iteration (it previously existed only in the app-review doc).

### Re-verified open, not re-flagged (unchanged from app-review pass 3/4)

Two more LOW items from `docs/app-review/medical-screening.md`, re-checked
directly against the current code and still accurate; not given fresh finding
IDs since nothing material changed and app-review's own reasoning still
holds:

- **`create_record` doesn't enforce exactly-one-of `user_id`/`prospect_id`.**
  Both or neither are still accepted. A `@model_validator` on the create
  schema is the fix; deferred because it changes accept/reject behavior on a
  PHI write path.
- **`get_compliance_status` doesn't 404 an unknown subject.** Confirmed not
  an enumeration channel: querying a nonexistent id, an out-of-org id, and an
  in-org id with zero records all produce an identical-shaped response (empty
  `items`, `subject_name=""`) — there is no distinguishing signal a caller
  could use to test whether an id exists.

## Schema & migration notes

`20260810_0001_encrypt_medical_screening_phi.py` re-read in full this
iteration (see Verified good) — sound, reversible, no defect. One doc
inaccuracy noted in passing: `docs/app-review/medical-screening.md` pass 4
cites this migration as `20260809_0001`; the actual file on disk is dated
`20260810_0001`. Not worth its own finding — a one-day date transcription
error with no functional effect — but noted so a future reader searching by
the cited filename isn't puzzled when it doesn't exist.

No new migration this iteration. `screening_records`/`screening_requirements`
are created by `20260313_0101_create_medical_screening_tables.py` (a real
migration, not a `create_all`-only table), so Pitfall #26's table-existence
guard doesn't apply here.

## Guard tests added

- `backend/tests/test_medical_screening_update_guards.py` (new file, MS-5):
  `TestUpdateRecordExplicitNullGuard` and
  `TestUpdateRequirementExplicitNullGuard` — an explicit `null` on
  `status`/`name` raises a clean `ValueError` (not an unguarded flush
  failure) and leaves the row unmutated; an ordinary non-null update through
  the same method still works, pinning against a regression that makes
  `apply_updates` reject valid payloads.

## Completion gate

| Check                                                     | Result                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `flake8` (touched files)                                  | pass                                                                                |
| `black --check` (touched files)                           | pass                                                                                |
| `isort --check-only` (touched files)                      | 1 file needed reordering, fixed, re-check pass                                      |
| `python3 scripts/validate_migrations.py --strict`         | pass (357 migrations, single head)                                                  |
| `pytest` — medical-screening + related surface (11 files) | 274 passed                                                                          |
| `npx tsc --noEmit`                                        | not run — no frontend source changed (doc-only correction to an already-fixed file) |

Test files run: `test_medical_screening_service.py`,
`test_medical_screening_update_guards.py`, `test_pipeline_stage_auto_advance.py`,
`test_encrypted_types.py`, `test_admin_hub_db.py`, `test_admin_hub_metrics.py`,
`test_data_export.py`, `test_enum_normalization.py`,
`test_member_anonymization.py`, `test_my_medical_compliance_route.py`,
`test_require_permission_registry.py` — every file under `backend/tests/`
referencing `medical_screening` or `medical-screening`, run in full.
