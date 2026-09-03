# Security Review — Medical Screening

**Prefix:** `MS` · **Iteration:** 9 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3) · **PR:** [#1816](https://github.com/thegspiro/the-logbook/pull/1816) (pass 1), [#1952](https://github.com/thegspiro/the-logbook/pull/1952) (pass 2), (this PR) (pass 3)

---

## Pass 3 (2026-09-02)

**Backend:** `endpoints/medical_screening.py` (429 L, 14 routes), `services/medical_screening_service.py` (605 L), `models/medical_screening.py` (215 L), `schemas/medical_screening.py` (255 L)
**Frontend:** `modules/medical-screening/` (full module this pass, not just route gating)
**Migrations:** `20260313_0101_create_medical_screening_tables.py`, `20260707_0001_lowercase_screening_and_shift_enums.py`, `20260810_0001_encrypt_medical_screening_phi.py` — re-verified, none new this pass

### Scope

`git diff a14bf441 HEAD` (pass 2's merge commit) against all four declared
backend files and the entire `modules/medical-screening/` frontend directory
returns **nothing** — byte-identical. A broader search of the full
`backend/app`/`frontend/src` diff since that commit for
`medical_screening`/`ScreeningRecord`/`ScreeningRequirement`/
`screening_record`/`screening_requirement` turns up exactly one hit, an
unrelated test fixture listing `medical_screening` as one of several enabled
modules. No migration touching `screening_records`/`screening_requirements`
landed either.

Given that, this pass did not re-derive pass 1/2's conclusions — it re-ran
the seven-dimension checklist directly against the current files (all four
backend files and the full endpoint/service/model/schema read in full,
plus the frontend module: `routes.tsx`, `services/api.ts`,
`store/medicalScreeningStore.ts`, `pages/MedicalScreeningPage.tsx`,
`components/ScreeningRequirementForm.tsx`,
`components/ScreeningRecordForm.tsx`, `components/ComplianceDashboard.tsx`),
plus `admin_hub_service.py`'s medical-screening metric resolvers (outside the
four declared files, but the one place in the app besides this feature's own
service that queries `ScreeningRecord` directly — confirmed by
`grep -rn MedicalScreeningService backend/app` returning no callers outside
the endpoint file, i.e. the service itself has no other consumer to check).
`app/core/permissions.py`'s `medical_screening.view`/`.manage` definitions
and every `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry were checked for a
baseline grant (none exists — see Verified good).

Not re-read this pass: `createApiClient` (the shared axios factory this
module's `services/api.ts` uses) — a cross-cutting utility with its own
established auth contract, out of scope for a per-feature pass.

### Route inventory

Unchanged from pass 1 — re-confirmed directly against the current file, not
copied from the prior doc.

| Method | Path                                 | Auth dependency                                      | Permission                 | Org-scoped                 | Notes                                                              |
| ------ | ------------------------------------ | ---------------------------------------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------ |
| GET    | `/requirements`                      | `require_permission`                                 | `medical_screening.view`   | yes                        | unbounded (MS-6)                                                   |
| GET    | `/requirements/{requirement_id}`     | `require_permission`                                 | `medical_screening.view`   | yes (`get_requirement`)    |                                                                    |
| POST   | `/requirements`                      | `require_permission`                                 | `medical_screening.manage` | yes (org-stamped)          |                                                                    |
| PUT    | `/requirements/{requirement_id}`     | `require_permission`                                 | `medical_screening.manage` | yes (routes through get)   | `apply_updates`, 400 on bad null (MS-5, pass 1)                    |
| DELETE | `/requirements/{requirement_id}`     | `require_permission`                                 | `medical_screening.manage` | yes (routes through get)   |                                                                    |
| GET    | `/records`                           | `require_permission`                                 | `medical_screening.view`   | yes                        | unbounded (MS-6)                                                   |
| GET    | `/records/{record_id}`               | `require_permission`                                 | `medical_screening.view`   | yes (`get_record`)         |                                                                    |
| POST   | `/records`                           | `require_permission`                                 | `medical_screening.manage` | yes (+FK validation, MS-3) | no reviewer distinct from subject/creator (MS-7)                   |
| PUT    | `/records/{record_id}`               | `require_permission`                                 | `medical_screening.manage` | yes (routes through get)   | `apply_updates`, 400 on bad null (MS-5, pass 1); MS-7 also applies |
| DELETE | `/records/{record_id}`               | `require_permission`                                 | `medical_screening.manage` | yes (routes through get)   |                                                                    |
| GET    | `/compliance/me`                     | `get_current_user` (no permission string — see note) | n/a — self-scoped          | yes                        | takes no id parameter; structurally IDOR-free                      |
| GET    | `/compliance/{user_id}`              | `require_permission`                                 | `medical_screening.view`   | yes                        | doesn't 404 an unknown/foreign subject (re-verified, not a leak)   |
| GET    | `/compliance/prospect/{prospect_id}` | `require_permission`                                 | `medical_screening.view`   | yes                        | same as above                                                      |
| GET    | `/expiring`                          | `require_permission`                                 | `medical_screening.view`   | yes                        | unbounded — builds on `list_records`/`list_requirements`           |

All 14 routes enumerated directly from the router; no route lacks an auth
dependency. `/compliance/me` is registered **before**
`/compliance/{user_id}` (`test_my_medical_compliance_route.py` pins this),
so FastAPI's registration-order matching can't let the permission-gated
route capture `"me"` as a `user_id`.

### Verified good ✅

- **No baseline grant.** `medical_screening.view`/`.manage` are defined only
  in `app/core/permissions.py` (lines 267–276) and referenced nowhere else in
  the backend — not in `DEFAULT_POSITIONS`, not in `OPERATIONAL_RANKS`, not
  in any seed migration (`grep -rn "medical_screening\." backend/app/core/permissions.py backend/app/api/dependencies.py backend/app/models/*.py backend/alembic/versions/*.py` returns only the two definitions). Neither
  permission is seeded to any position by default — including `member` and
  `firefighter` — so PHI access requires an administrator to explicitly
  assign the permission to a role, not a permission every volunteer holds
  out of the box the way CLAUDE.md Pitfall #23 describes for rank grants.
- **Tenant isolation holds throughout, re-traced directly.** Every by-id
  getter (`get_requirement`, `get_record`) filters `organization_id` in the
  same `select(...).where(and_(id==, org==))`; every `update_*`/`delete_*`
  routes through those getters rather than re-fetching by id alone.
  `create_record` validates all three client-supplied FKs (`user_id`,
  `prospect_id`, `requirement_id`) via `assert_in_org(..., allow_none=True)`
  before the row is constructed — read `assert_in_org`/`is_in_org`
  (`app/utils/org_scoping.py`) directly: it fails **closed** (a falsy id or a
  row that exists in another org both return `False`, never a pass), matching
  the shared helper's documented contract.
- **PHI encryption at rest is genuinely intact
  (`models/medical_screening.py:181-187`).** `provider_name`,
  `result_summary`, `notes` are `EncryptedText`; `result_data` is
  `EncryptedJSON`. SEC-00's JSON-column sweep (round 8) specifically added
  `EncryptedJSON` to its type-name set after finding `result_data` had been
  silently excluded by name-literal matching — re-confirmed that fix is
  still in place and `result_data` is correctly covered.
- **No in-place JSON mutation risk on `result_data`, re-verified.** SEC-00
  traced both direct `.result_data =` reassignment sites
  (`create_record`'s constructor call on a brand-new unpersisted row;
  `update_record`'s `apply_updates` reading straight from the incoming
  payload dict) and found neither aliases a prior committed value. Nothing
  in this pass's diff (there is none) changes that.
- **`SET NULL` FKs are nullable.** `ScreeningRecord.requirement_id`
  (`ondelete="SET NULL"`) and `.reviewed_by` (`ondelete="SET NULL"`) are both
  `nullable=True` (models/medical_screening.py:141-143, 188-192).
- **Update paths cannot reassign tenancy or subject.** `ScreeningRecordUpdate`
  and `ScreeningRequirementUpdate` simply don't declare `organization_id`,
  `user_id`, `prospect_id`, or `requirement_id` fields — the protection is a
  curated allowlist at the schema level, not a skip-list `apply_updates` has
  to enforce, and both schemas were re-read in full to confirm this still
  holds.
- **No SQL injection surface.** No `.like()`/`.ilike()` call anywhere in the
  service (confirmed by direct search of the full file); the
  expiring-soon cutoff is a bound Python `date`, never an interval fragment.
- **No unescaped output.** No HTML/ICS/vCard rendering in this feature; no
  CSV/spreadsheet export endpoint exists (14-route inventory has none), so
  `SafeCsvWriter` (checklist §4) doesn't apply.
- **Cache exclusion covers the module.** `frontend/src/utils/apiCache.ts`
  lists `/medical-screening/`, `/training/waivers` (medical/health waivers),
  and `/admin-hub/` (whose attention items surface medical-screening lapse
  counts) in `UNCACHEABLE_PREFIXES` — re-confirmed by direct read of the
  current file.
- **Module gate re-verified sound.** `medical_screening.router` is registered
  with `dependencies=module_gate("medical_screening", ...)`
  (`api/v1/api.py:273-276`); every one of its 14 routes independently
  requires `get_current_user` or `require_permission(...)`, so the module
  gate's anonymous-passthrough clause (reserved for routers that also carry
  token-scoped public routes) is a no-op here, not a gap — this router has no
  such route.
- **`admin_hub_service.py`'s medical-screening resolvers are org-scoped and
  PHI-minimal, re-read in full.** `_members_screening_current`,
  `_members_attention`'s expired/overdue blocks all filter
  `ScreeningRecord.organization_id == ctx.organization_id` and
  `User.organization_id == ctx.organization_id` on every query, and surface
  only aggregate counts and generic titles ("3 medical screenings expired")
  — never a member name, screening type, or result. Gated on
  `attention_permission="medical_screening.view"` and
  `requires_module="medical_screening"`.
- **`applies_to_roles`/`grace_period_days` audited for enforcement, not just
  storage** — see MS-9. Neither leaks anything; both are read-nowhere config
  fields, which is a correctness/honesty gap (fixed this pass), not a
  security exposure.
- **Audit event payloads carry no PHI.** `record_created`'s `event_data`
  includes `record_id`/`record_user_id`/`screening_type` — never
  `provider_name`, `result_summary`, `result_data`, or `notes`. Re-confirmed
  by reading all six `log_audit_event` calls in the file.

## Findings

### MS-7 — MED — No reviewer distinct from the subject or the creator on screening records — 🚩 FLAGGED

**What:** `create_record` and `update_record` place no constraint on the
relationship between `current_user` (the caller, who must hold
`medical_screening.manage`) and `data.user_id` (the record's subject).
Checklist §2 names this pattern explicitly: "Separation of duties: the
approver cannot be the requester; the reviewer cannot be the subject." There
is none here — a `.manage` holder can `POST /medical-screening/records` with
`user_id` equal to their own id and `status="passed"` directly, with no
review step in between. `update_record` sets `reviewed_by`/`reviewed_at` to
`current_user`/`now()` whenever the new `status` is `passed`/`failed`/
`waived` (`medical_screening_service.py:246-250`), which reads like a
review-tracking mechanic but doesn't gate anything: `get_compliance_status`
(the only place `status` is consulted for compliance) checks membership in
`{PASSED, COMPLETED, WAIVED}` and never looks at `reviewed_by` at all
(`medical_screening_service.py:344-351`), so a self-administered `PASSED` on
create — never touching `update_record`/`reviewed_by` — counts exactly the
same as a genuinely reviewed one.
**Where:** `endpoints/medical_screening.py` — `create_record` (237-271);
`services/medical_screening_service.py` — `create_record` (170-229, no
`user_id != caller` check), `get_compliance_status` (314-412, no
`reviewed_by` gate).
**Failure scenario:** a member holding `medical_screening.manage` (assigned
by an administrator to, say, an EMS coordinator or a department officer who
is also line staff) can self-certify a drug screening, psychological
evaluation, or fitness assessment as `passed` with no external clearance —
the write succeeds, is audit-logged (so the action is discoverable after the
fact, but not prevented), and the record is indistinguishable in shape from
one entered by someone else on the subject's behalf.
**Impact:** an integrity/trust-boundary gap on fitness-for-duty and
compliance-critical PHI, not a cross-tenant leak or an unauthenticated
exposure — the population that can reach it is already narrow
(`.manage` is not baseline-granted; see Verified good), and the audit trail
means self-certification is discoverable, not silent.
**Fix:** not applied. Blocking `data.user_id == current_user.id` outright
would be a behavior change with real operational cost for small departments
where the same person may legitimately be both the only person authorized to
log screenings and a line member who needs their own screening recorded (the
department still had a real external exam; the app is just where the result
gets typed in) — and a full second-approver workflow (draft by one person,
approved by another) is a feature, not a same-day fix, matching the
"needs a product decision" disposition this rotation has used consistently
for USR-8/MP-10/MS-6 and similar. Mirrored into `KNOWN_LIMITATIONS.md`.

### MS-8 — LOW (audit completeness) — `record_created`/`requirement_created` audit events omitted the new row's id — ✅ FIXED

**What:** `update_requirement`/`delete_requirement`/`update_record`/
`delete_record`'s `log_audit_event` calls all include `requirement_id`/
`record_id` in `event_data`. `create_requirement` and `create_record` did
not — `create_requirement`'s `event_data` was `{"requirement_name":
data.name}` and `create_record`'s was `{"record_user_id": data.user_id,
"screening_type": data.screening_type}`, neither naming the row that was
just created, even though both `requirement`/`record` were already
available (freshly inserted and refreshed) at the call site.
**Where:** `endpoints/medical_screening.py` — `create_requirement` (then
line 101), `create_record` (then lines 259-262).
**Failure scenario:** not an access-control gap — a discoverability gap on
the HIPAA §164.312(b) audit trail this call exists for. An auditor
investigating "what happened to screening record X" cannot find its own
creation event by id, only by correlating user + timestamp + type, which is
ambiguous the moment the same subject gets two screenings of the same type
close together (e.g. a redo after a failed attempt, or MS-7's
self-certification scenario above, where knowing _which_ record was
self-created is exactly what an auditor needs).
**Fix:** both `event_data` dicts now include `requirement_id`/`record_id`
(the freshly created row's own id), alongside the fields they already
carried — additive only, no field removed, no response-shape change, no
migration. Guarded by
`tests/test_medical_screening_create_audit_includes_id.py` (4 tests: the two
fixed sites, plus the two update/delete sites pinned so a future edit can't
regress them while "fixing" the create side), confirmed to fail on exactly
the two intended assertions pre-fix via `git stash`.

### MS-9 — LOW (config-switch honesty, CLAUDE.md Pitfall #19) — `grace_period_days` and `applies_to_roles` are stored, editable, and read by nothing — ✅ FIXED (UI notice, not wired)

**What:** `ScreeningRequirement.grace_period_days` ("Days past due before
flagging non-compliant") and `.applies_to_roles` ("JSON list of role names
this requirement applies to") are both writable through
`ScreeningRequirementForm.tsx` with plain, unqualified labels — "Grace Period
(days past expiration)" and "Applies to Roles (comma-separated)" (the latter
captioned "Leave blank to apply to all members", which asserts a targeting
behavior that doesn't exist) — and both are silently ignored by
`get_compliance_status`, the only place compliance is computed:

- `is_compliant = latest.expiration_date >= today` (`medical_screening_service.py:362`)
  applies a hard cutoff the instant `expiration_date` passes; `grace_period_days`
  is never read anywhere outside the model/schema/the one write site in
  `create_requirement`. `applies_to_roles` defaults to 30 for **every**
  requirement (`Column(..., default=30, server_default="30")`), so this is
  not a rare opt-in — every existing and future requirement already carries
  a nonzero value that has never once been consulted.
- `list_requirements(organization_id, is_active=True)` (`medical_screening_service.py:325`)
  pulls **every** active requirement for **every** subject regardless of
  role — `applies_to_roles` is read exactly once in the whole backend, at
  the point it's written into the model constructor, and never again. A
  requirement scoped to `["emt"]` still applies to a member with no EMT
  role, who gets flagged non-compliant for a screening their role never
  needed.

Same shape CLAUDE.md Pitfall #19 describes ("a config switch must have a
reader before it has a UI"), and the same shape this codebase already found
and fixed once for a _different_ table's identically-named column
(`compliance_configs.grace_period_days`,
`tests/test_compliance_grace_period_is_unwired.py`) — that fix's own
`_OTHER_OWNERS` exclusion list carried a stale, incorrect comment claiming
`medical_screening_service.py`'s usage was a legitimate, separate "own"
reader; it is not one, it's the same unwired-config bug on a different
table, and the comment is corrected as part of this fix.
**Where:** `services/medical_screening_service.py:89,325,344-351` (writes
but never reads `grace_period_days`; `list_requirements`/
`get_compliance_status` never filter or extend by either field);
`frontend/src/modules/medical-screening/components/ScreeningRequirementForm.tsx:164-191`
(both fields presented with no caveat).
**Impact:** not a security exposure — no PHI or cross-tenant data involved —
but a real correctness/trust gap on a compliance-critical surface: an
officer who sets a 14-day grace period, or scopes a requirement to a
specific role, gets a success toast and zero change in who
`admin_hub_service.py` flags with `severity="critical"` and the label
"blocks duty assignment," or who shows non-compliant on the dashboard.
**Fix:** matching the established remedy for the sibling finding — an
honest "not enforced" notice on both fields (`amber` warning text, same
styling as `ComplianceRequirementsConfigPage.tsx`'s precedent), **not**
wiring the reader. Wiring either is a product decision this pass declines to
make unilaterally: `grace_period_days` defaults to 30 for every requirement,
so wiring it would relax the non-compliance cutoff on every installation
that has ever created a requirement, not just ones that deliberately set a
non-default value; wiring `applies_to_roles` changes which requirements even
apply to which subjects, again on every existing installation. Guarded by
new `tests/test_medical_screening_requirement_fields_are_unwired.py`
(3 tests: an AST sweep of `medical_screening_service.py` asserting no
attribute read of either field exists outside the one known
`data.<field>` write site in `create_requirement`, plus two source-regex
checks that the form's "Not enforced" notice is present for each field),
confirmed to fail on the two notice-presence assertions pre-fix via
`git stash` (the AST-sweep assertion correctly passes both before and after
— the gap itself is unchanged, only its disclosure is fixed).
`test_compliance_grace_period_is_unwired.py`'s `_OTHER_OWNERS` comment for
`medical_screening_service.py` corrected to describe the real, separate
finding instead of asserting a reader that doesn't exist.

### Re-verified open, not re-flagged (unchanged from pass 1/2)

- **MS-6 — LOW (scale) — Unbounded requirement/record lists.** Re-confirmed
  directly: `list_requirements`/`list_records` still run bare `.all()`, with
  the endpoints slicing in Python via `PaginationParams`, and
  `get_compliance_status`/`get_expiring_soon` still build on the same
  unbounded calls. Already mirrored into `KNOWN_LIMITATIONS.md` (pass 1);
  not re-mirrored.
- **`create_record` still doesn't enforce exactly-one-of `user_id`/
  `prospect_id`.** Both or neither are still accepted — re-read
  `ScreeningRecordCreate` and `create_record` directly; no
  `@model_validator` was added since pass 1. Deferred for the same reason as
  before: it changes accept/reject behavior on a PHI write path and needs a
  product decision on whether "neither" (an orphaned record with no subject
  at all) should be a hard reject or stays legal for some workflow this pass
  isn't aware of.
- **`get_compliance_status` still doesn't 404 an unknown subject.**
  Re-verified not an enumeration channel: a nonexistent id, an out-of-org
  id, and an in-org id with zero records all produce the identically-shaped
  response (`items=[]`, `subject_name=""`) — still no signal a caller could
  use to test id existence.

## Schema & migration notes

No migration this pass — `screening_records`/`screening_requirements` are
still created by the real migration `20260313_0101_create_medical_screening_tables.py`
(not a `create_all`-only table, so Pitfall #26's guard doesn't apply), and
`20260810_0001_encrypt_medical_screening_phi.py` is unchanged since pass 1's
re-read (reversible, alters `provider_name`/`result_data` before encrypting
in place). `validate_migrations.py --strict` re-run clean this pass (see
Completion gate) — no new revision, single head, unchanged count.

## Guard tests added

- `backend/tests/test_medical_screening_create_audit_includes_id.py` (new,
  MS-8, 4 tests) — AST-inspects the two `_created` `log_audit_event` calls
  for the new row's id key, plus pins the two `_updated`/`_deleted` sites
  that already carried it so a future edit can't drop the invariant there
  while "fixing" the create side.
- `backend/tests/test_medical_screening_requirement_fields_are_unwired.py`
  (new, MS-9, 3 tests) — AST sweep of `medical_screening_service.py`
  asserting no attribute read of `grace_period_days`/`applies_to_roles`
  exists outside the known write site, plus two regex checks that
  `ScreeningRequirementForm.tsx` still tells the officer each field has no
  effect.
- `backend/tests/test_compliance_grace_period_is_unwired.py` — no new test,
  but its `_OTHER_OWNERS` comment for `medical_screening_service.py`
  corrected (MS-9) to stop asserting a reader that doesn't exist.

## Completion gate

| Check                                                                          | Result                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (with `flake8-pytest-style`, CI's plugin set)    | 0 violations — caught 1 real `PT006` (parametrize argnames must be a tuple) in the new MS-9 test via the pre-commit hook's `python -m flake8`; a stray unplugged `flake8` binary elsewhere on this sandbox's `PATH` had missed it. Fixed, re-verified 0 violations. |
| `black --check app/ tests/ alembic/`                                           | 1 file reformatted (new audit-id test file), clean on re-check                                                                                                                                                                                                      |
| `isort --check-only app/ tests/ alembic/`                                      | clean                                                                                                                                                                                                                                                               |
| `python3 scripts/validate_migrations.py --strict`                              | pass — 410 revisions, single head (unchanged; no migration this pass)                                                                                                                                                                                               |
| `pytest tests/ -q -k "medical_screening or medical-screening or grace_period"` | **50 passed, 1 skipped** (pre-existing — optional `py_vapid` dep), 0 failed                                                                                                                                                                                         |
| `pytest tests/ -q` (full backend suite)                                        | **9892 passed, 21 skipped** (pre-existing/environmental: Docker unavailable, optional dep, opt-in API-contract suite), 0 failed                                                                                                                                     |
| `npx tsc --noEmit`                                                             | 0 errors                                                                                                                                                                                                                                                            |
| `npx eslint .`                                                                 | 0 errors/warnings (exit 0)                                                                                                                                                                                                                                          |

Frontend gates were run because this pass touched
`ScreeningRequirementForm.tsx` (MS-9's notice text) — the first frontend
change to this feature since pass 1.

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
