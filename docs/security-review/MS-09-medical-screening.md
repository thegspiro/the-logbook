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
