# Security Review — Medical Screening

**Prefix:** `MS` · **Iteration:** 9 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-16 (pass 6), 2026-10-06 (pass 7), 2026-10-13 (pass 8), 2026-10-15 (pass 9, PR [#3256](https://github.com/thegspiro/the-logbook/pull/3256) — corrected here from "(this PR)", which pass 9's own section never filled in after merge), 2026-10-18 (pass 10, PR [#3427](https://github.com/thegspiro/the-logbook/pull/3427)), 2026-10-23 (pass 11, PR [#3577](https://github.com/thegspiro/the-logbook/pull/3577)), 2026-10-25 (pass 12, PR [#3711](https://github.com/thegspiro/the-logbook/pull/3711)), 2026-10-28 (pass 13, PR [#3813](https://github.com/thegspiro/the-logbook/pull/3813)), 2026-11-01 (pass 14) · **PR:** [#1816](https://github.com/thegspiro/the-logbook/pull/1816) (pass 1), [#1952](https://github.com/thegspiro/the-logbook/pull/1952) (pass 2), [#2180](https://github.com/thegspiro/the-logbook/pull/2180) (pass 3), [#2409](https://github.com/thegspiro/the-logbook/pull/2409) (pass 4), [#2557](https://github.com/thegspiro/the-logbook/pull/2557) (pass 5), [#2608](https://github.com/thegspiro/the-logbook/pull/2608) (pass 6) — corrected here from "(this PR)", which pass 6's own section never filled in after merge, [#2957](https://github.com/thegspiro/the-logbook/pull/2957) (pass 7) — likewise never filled in after merge, corrected here, [#2978](https://github.com/thegspiro/the-logbook/pull/2978) (pass 8) — also never filled in after merge; found via its own PR title ("security(medical-screening): 0 fixes, 1 flagged (MS-15)") rather than assumed, [#3256](https://github.com/thegspiro/the-logbook/pull/3256) (pass 9), [#3427](https://github.com/thegspiro/the-logbook/pull/3427) (pass 10), [#3577](https://github.com/thegspiro/the-logbook/pull/3577) (pass 11), [#3711](https://github.com/thegspiro/the-logbook/pull/3711) (pass 12), [#3813](https://github.com/thegspiro/the-logbook/pull/3813) (pass 13), pass 14 (this PR)

---

## Pass 14 (2026-11-01) — watchdog pickup: 0 fixed, 0 new findings; cosmetic-only delta since pass 13 (one repo-wide CSS layout commit); corrects a stale MS-16 claim carried since pass 12 — `frequency_months` is read, only `grace_period_days` remains open; MS-14/MS-15 re-confirmed unchanged

**Step 0.** 0 open PRs with a head branch starting `claude/security-review-`
(checked directly against GitHub). PR #3910 (Feature 08, Membership
pipeline, pass 15) had already merged (`f57fd5a6`) with no open rotation PR
behind it. The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was confirmed unreachable via
`ListAgents` ("No reachable agents"); this is a watchdog pickup. Row 09
(Medical screening, PHI) was confirmed the next `⬜` on a freshly pulled
`main` and by PR #3910's own "Next feature" note.

**Scope.** Baseline `7ac356b4` (PR #3813's merge, pass 13). `git log
--no-merges 7ac356b47..HEAD` over the five declared backend files
(`endpoints/medical_screening.py`, `services/medical_screening_service.py`,
`models/medical_screening.py`, `schemas/medical_screening.py`,
`mcp/tools/medical.py`) plus the full `frontend/src/modules/
medical-screening/` directory: **1 non-merge commit** (`cf8fdae3`, "fix(layout):
one page-header layout that wraps on its content"), read in full. It is a
repo-wide shared-CSS-utility change; its only touch inside this feature's
scope is `MedicalScreeningPage.tsx`'s header `<div>`, swapping
`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` /
`flex items-center gap-3` for the new `page-header`/`page-header-title`
utility classes — same elements, same content, no change to any
`ProtectedRoute` gate, data fetch, or rendered field. All five backend files
and `mcp/tools/medical.py` are byte-identical to pass 13. No
medical-screening-table migration landed in the window: scanned every new
migration body (17 non-merge commits touching `alembic/versions/` in the
window) for `medical_screening`/`screening_requirement`/`screening_record` —
zero matches.

**All 16 routes re-enumerated by AST** (`ast.walk` over every
`@router.{get,post,put,delete,patch}` decorator), exactly matching pass 13's
count and table. Re-read every `Depends`/`require_permission` argument
directly against the current file rather than diffing: unchanged from pass
13's table, including the `/compliance/me` self-scoping shape and the MS-17
`is_in_org` guards on `/compliance/{user_id}` and
`/compliance/prospect/{id}`.

**Tenant isolation and PHI encryption, re-confirmed by direct read** (the
backend has zero diff since pass 13, so this re-reads the same code, not a
delta): `get_requirement`/`get_record` still filter `organization_id` in the
same `and_()` (`medical_screening_service.py:343,454`); `create_record`'s
three client-supplied FKs still route through `assert_in_org(...,
allow_none=True)` (`:523-539`); `ScreeningRecordUpdate` still carries no
`user_id`/`prospect_id`/`requirement_id` field; `provider_name`/
`result_summary`/`notes` are still `EncryptedText`, `result_data` still
`EncryptedJSON` (`models/medical_screening.py:198-202,226`); the two
`ondelete="SET NULL"` FKs (`requirement_id`, `reviewed_by`) are both
`nullable=True`. Re-grepped all five backend files plus the frontend module
for `.ilike(`/`.like(`, `csv.writer`, and `window.confirm`/`alert`/`prompt` —
zero matches; Pitfalls #15, #25, #31 still don't apply. `grep
alias_generator=to_camel backend/app/schemas/medical_screening.py` — still no
match, consistent with this module's snake_case convention on both sides.

**Documentation correction, found while re-verifying the standing items, not
re-derived from scratch:** pass 12 and pass 13 both state "`grace_period_days`
and `frequency_months` are still written on create/update and read by nothing
in `_grade()`." That is only half true today, and — checked directly against
`_effective_expiration` (`medical_screening_service.py:185-211`), which
`_grade()` calls at line 251 — was already only half true when pass 13 ran,
since the backend is byte-identical since that pass. `frequency_months` IS
read: `_effective_expiration` falls a record with no `expiration_date` due
`frequency_months` after its `completed_date` (the requirement it is linked
to, or the one it is being graded against), and `KNOWN_LIMITATIONS.md`'s own
MS-16 entry already records this correctly — "`frequency_months` resolved
2026-10-25 (W71-1 above)" — so the mirror in `KNOWN_LIMITATIONS.md` was
right and only this file's pass 12/13 narrative drifted from it.
`grace_period_days` genuinely remains unread: grepped every reference in the
three backend files (`services/schemas/models`) and the only hits are the
write path (`create_requirement`'s `data.grace_period_days` assignment,
`:367`) and the schema/model field declarations — no call site in `_grade`,
`_effective_expiration`, or anywhere else reads it back. This is a narrative
correction, not a new finding and not a code change: the pass 12/13 sections
above are left as written, consistent with this file's own pass-9 precedent
for documentation-accuracy corrections, since they record what pass 12/13's
authors believed at the time, not a claim this pass is re-asserting.
**MS-16's remaining open half is `grace_period_days` only** — `frequency_months`
is resolved and should no longer be cited alongside it.

**Standing items re-verified, unchanged (backend byte-identical to pass 13):**

- **MS-14** (`medical_screening.view` grants full narrative PHI with no
  finer-grained read tier, LOW, FLAGGED, owner decision) — unchanged.
  `ScreeningRecordResponse` still inherits `provider_name`/`result_summary`/
  `notes` from `ScreeningRecordBase`, and `GET /records`/`{id}` are still
  gated on `.view` alone.
- **MS-15** (the compliance roster loads every screening record in the
  organization, unbounded, LOW, FLAGGED, same class as MS-6/FIN-9/ELEC-12/
  USR-5/MP-10/DOC-9) — `get_compliance_roster` (`:794,801`) still calls
  `list_requirements(..., is_active=True)` and `list_records(organization_id)`
  with `limit=None` on both. Unchanged.
- **MS-16, corrected scope** — see above: `grace_period_days` remains unread
  by `_grade()`; `frequency_months` is resolved (was already resolved as of
  pass 13, mis-stated in that pass's own text).

**0 application-code defects found, 0 fixes needed, 0 new findings.** This
pass's own contribution is the documentation correction above, found by
re-verifying a standing claim directly against current code rather than
carrying it forward — exactly what this file's own precedent (pass 9) says
to do, and exactly what passes 12/13 did not do for this one claim.

### Completion gate (pass 14)

| Check                                                                    | Result                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.4.1`)                          | ✅ 0 violations                                         |
| `black --check app/ tests/ alembic/` (`black==26.10.1`)                  | ✅ 2776 files unchanged                                 |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`)               | ✅ clean                                                |
| `python3 scripts/validate_migrations.py --strict`                        | ✅ 684 revisions, single head `5781476f2012`            |
| `pytest tests/ -q -k "medical_screening or medical_screen or screening"` | ✅ 171 passed, 1 skipped (environment-only, `py_vapid`) |
| `cd frontend && npm run typecheck`                                       | ✅ clean (`tsc-native.mjs --noEmit`)                    |
| `cd frontend && npm run lint` (`eslint --max-warnings 10`)               | ✅ clean, 0 warnings                                    |
| `npx vitest run src/modules/medical-screening`                           | ✅ 62 passed (11 files)                                 |

---

## Pass 13 (2026-10-28) — watchdog pickup: 0 fixed, 0 new findings; near-zero delta since pass 12 (one non-rotation correctness fix, one non-rotation bundling change, both reviewed in full); MS-14/MS-15 re-confirmed unchanged

**Step 0.** `list_pull_requests` (state=open) against `thegspiro/the-logbook`
returned 0 results. PR #3811 (Feature 08, Membership pipeline, pass 14) had
already merged (`af51a42e`) with no open rotation PR behind it. The dedicated
`/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`) was
confirmed unreachable via `ListAgents` ("No reachable agents"); this is a
watchdog pickup. Rotation row 09 (Medical screening, PHI) was confirmed the
next `⬜` by reading `PROGRESS.md` directly — PR #3811's own body names
Feature 09 as next.

**Scope.** Baseline `170405c1` (PR #3711's merge, pass 12).
`git log --no-merges 170405c1..origin/main` over the five declared backend
files (`endpoints/medical_screening.py`, `services/medical_screening_service.py`,
`models/medical_screening.py`, `schemas/medical_screening.py`,
`mcp/tools/medical.py`) plus `frontend/src/modules/medical-screening/` found
**2 non-merge commits**, both read in full, including their test/doc deltas.
No medical-screening-table migration landed in the window (current head
`b74bcce55c11` is an unrelated leave/training-waiver encryption migration;
scanned its body — no reference to `medical_screening`/`screening_requirement`/
`screening_record`).

Neither commit was made through the security-review rotation (no
`claude/security-review-*` branch ancestry, no "Merge pull request" bubble for
this rotation's naming convention):

- **`8b841ff7`** (session `session_01V3sx5bNDnFJ6AMSSb6sBDh`, "Claude Opus
  5.5") — a correctness fix, not security: `get_expiring_soon` named every
  satisfying record in the window including one a newer record of the same
  type had already superseded, so a renewed physical could still read
  "expiring in 10 days" beside a compliance count of zero (the Pitfall #29
  class — a derived view disagreeing with the count that drives it). The fix
  factors the MCP tool's existing superseded-record predicate out into a
  shared `superseded_record_clause()` (`medical_screening_service.py:130-179`)
  and applies it to both `get_expiring_soon` (`:919`) and the pre-existing
  frequency-based due list (`:1000`), so there is one definition rather than
  two that could drift. Read the full diff: the predicate still filters
  `later.organization_id == ScreeningRecord.organization_id` (no tenant
  leakage introduced) and matches on `user_id` when the record names a member,
  else `prospect_id` — same subject-matching shape the rest of this file uses.
  Three new tests (`test_medical_screening_frequency_fallback.py::
TestSupersededRecords`) cover: a renewed member's old record dropped, a
  renewed prospect's old record dropped, and — the case that actually proves
  the join is scoped to the right subject — another member's newer record
  does **not** hide this member's own expiring one. Ran clean as part of this
  pass's scoped test run (below). `docs/KNOWN_LIMITATIONS.md`'s matching entry
  was updated from "Still open" to "Resolved 2026-10-25" by the same commit;
  re-read, matches the code.
- **`61576727`** ("Halve what every page downloads before its first paint") —
  a repo-wide frontend code-splitting change; its only touch inside this
  feature's scope is `frontend/src/modules/medical-screening/routes.tsx`,
  switching `MedicalScreeningPage` from a static import to
  `lazyWithRetry(() => import(...))`. Read the full current file (reproduced
  below): the `<Route>` element, `ProtectedRoute` wrapper,
  `requiredPermission="medical_screening.view"` and
  `requiredModule="medical_screening"` are byte-identical to pass 12's read —
  only _when_ the page's JS downloads changed, not what gates reaching it.

No other change in the window: `models/medical_screening.py`,
`schemas/medical_screening.py`, and `mcp/tools/medical.py`'s own route-facing
logic otherwise unchanged from pass 12's read (the one `mcp/tools/medical.py`
hunk touched by `8b841ff7` is covered above).

**All 16 routes re-enumerated, this time by AST** (`ast.walk` over every
`@router.{get,post,put,delete,patch}` decorator, not `grep -c`) rather than
trusting pass 12's count: 16, exactly matching pass 12 and pass 11. Every
route's permission string and org-scoping re-read directly against the
current file — all `.view`/`.manage` strings and the `/compliance/me`,
`/compliance/{user_id}`, `/compliance/prospect/{id}` auth shapes are
unchanged from the table pass 12 already recorded above.

**Tenant isolation and PHI encryption, re-confirmed by direct read:**
`get_requirement`/`get_record` still filter `organization_id` in the same
`and_()`; `create_record`'s three client-supplied FKs still route through
`assert_in_org(..., allow_none=True)`; `ScreeningRecordUpdate` still carries
no `user_id`/`prospect_id`/`requirement_id` field; `provider_name`/
`result_summary`/`notes`/`result_data` are still `EncryptedText`/
`EncryptedJSON`. Re-grepped all five backend files plus the frontend module
for `.ilike(`/`.like(`, `csv.writer`, and `window.confirm`/`alert`/`prompt` —
zero matches, Pitfalls #15, #25, #31 still don't apply here. `grep
alias_generator=to_camel backend/app/schemas/medical_screening.py` — still no
match; this module stays snake_case on the wire, consistent with its frontend
types.

**Standing items re-verified, unchanged (neither touched by this window's two
commits):**

- **MS-14** (`medical_screening.view` grants full narrative PHI with no
  finer-grained read tier, LOW, FLAGGED, owner decision) — unchanged.
- **MS-15** (the compliance roster loads every screening record in the
  organization, unbounded, LOW, FLAGGED, same class as MS-6/FIN-9/ELEC-12/
  USR-5/MP-10/DOC-9) — `get_compliance_roster` still calls
  `self.list_requirements(..., is_active=True)` and
  `self.list_records(organization_id)`, both `limit=None`. Unchanged.
- **MS-16's remaining open half** — `grace_period_days`/`frequency_months`
  still unread by `_grade()`. Unchanged.

**0 application-code defects found, 0 fixes needed, 0 new findings.** The
only two commits in this window were both already reviewed, tested, and
landed by sessions outside this rotation; this pass's job was verifying that
delta holds up directly against current code rather than taking it on the
commit messages, which it does.

### Completion gate (pass 13)

| Check                                                                    | Result                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.4.1`)                          | ✅ 0 violations                                         |
| `black --check app/ tests/ alembic/` (`black==26.5.1`)                   | ✅ 2714 files unchanged                                 |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`)               | ✅ clean                                                |
| `python3 scripts/validate_migrations.py --strict`                        | ✅ 667 revisions, single head `b74bcce55c11`            |
| `pytest tests/ -q -k "medical_screening or medical_screen or screening"` | ✅ 171 passed, 1 skipped (environment-only, `py_vapid`) |
| `frontend: npm run typecheck`                                            | ✅ clean                                                |
| `frontend: npm run lint`                                                 | ✅ clean, 0 warnings                                    |
| `npx vitest run src/modules/medical-screening`                           | ✅ 62 passed (11 files)                                 |

---

## Pass 12 (2026-10-25) — watchdog pickup: MS-17/MS2-7 already fixed by a direct, non-rotation commit; 0 fixed, 0 new findings; MS-14/MS-15 re-confirmed unchanged

**Step 0.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results. PR #3702 (Feature 08, Membership pipeline, pass 13) had
already merged (`507ae1d0`). The dedicated `/loop 30m /security-review`
session (`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable; this is a
watchdog pickup. Rotation row 09 (Medical screening, PHI) was confirmed the
next `⬜` by reading `PROGRESS.md`'s Rotation table directly (row 08 ✅, row 09
⬜, pass-11 lap).

**Scope.** Baseline `ca2233e5` (PR #3577's merge, pass 11). `git log
--no-merges ca2233e5..HEAD` over the five declared backend files
(`endpoints/medical_screening.py`, `services/medical_screening_service.py`,
`models/medical_screening.py`, `schemas/medical_screening.py`,
`mcp/tools/medical.py`) plus the full `frontend/src/modules/
medical-screening/` directory: **1 non-merge commit** (`2f2b8cc6`), read in
full, including its test file and both doc files it touched. No
medical-screening-table migration landed in the window (the latest head,
`3f2593e8071e`, is an unrelated membership-pipeline DOB/emergency-contact
encryption migration from pass 13 — scanned its body too; it does not
reference `medical_screening`/`screening_requirement`/`screening_record`).

**`2f2b8cc6` was not made through the security-review rotation.** It carries
no `claude/security-review-*` branch name in its ancestry, is not a "Merge
pull request" bubble (a direct commit onto `main`, or a squash-merge from a
differently-named branch), and its co-author line names a different session
(`session_01V3sx5bNDnFJ6AMSSb6sBDh`, "Claude Opus 5.5") than this rotation
uses. It is the owner-directed fix for two items this rotation had already
flagged and tracked — MS-17 (app-review's mirror of this file's
"Compliance-404" finding, pass 9) and MS2-7 (app-review pass 5) — and it
already self-annotated both the app-review doc and **this file** (the pass 9
and pass 7 sections above now read "✅ FIXED 2026-10-25") before this pass
started. Re-verifying an already-landed, already-documented fix is still this
pass's job per Step 3's enumerate-everything instruction, so both are
re-checked below against the current code and tests rather than taken on the
commit message or the doc's own claim.

- **MS-17, re-verified fixed.** `get_user_compliance`
  (`endpoints/medical_screening.py:539-542`) and `get_prospect_compliance`
  (`:568-573`) each call `is_in_org` (`app/utils/org_scoping.py`) against
  `User`/`ProspectiveMember` and the caller's `organization_id` before any
  grading, audit write, or name lookup, and raise 404 on a `False`. `is_in_org`
  fails closed on a falsy id and returns the same `False` for "does not exist"
  and "exists in another org" — confirmed by reading the function
  (`org_scoping.py:24-42`) — so the 404 cannot be used to distinguish a
  made-up id from a real one belonging to a different department (not a new
  cross-tenant enumeration oracle). `test_medical_screening_compliance_
subjects.py::TestComplianceSubjectMustExist` drives both routes directly
  (not through a mocked session) with four cases per subject type — in-org,
  random uuid, and a real id seeded into a second, separately-inserted
  organization — and the foreign-org case is the one that matters: it proves
  the check is a real org filter, not merely "does this row exist anywhere."
  Ran clean (below).
- **MS2-7, re-verified fixed.** `_grade` and `get_expiring_soon`
  (`services/medical_screening_service.py:146-153`, `:805`) both now read the
  single module-level `_SATISFYING_STATUSES` tuple
  (`PASSED`/`COMPLETED`/`WAIVED`) rather than each hard-coding its own subset
  — checked directly that there is exactly one definition in the file, not
  two that happen to agree today. `ExpiringScreening.status` is a new
  `Optional[str]` field (`schemas/medical_screening.py:364`) carrying the
  record's status so the UI can tell a lapsing waiver from a lapsing passed
  screening; `ComplianceDashboard.tsx` renders a `Waived` badge only when
  `status === ScreeningStatus.WAIVED`. `test_medical_screening_compliance_
subjects.py::TestALapsingWaiverIsCountedAndListed` seeds a waived record
  expiring in 10 days and asserts both `get_compliance_status`'s
  `expiring_soon_count == 1` and that `get_expiring_soon` lists that exact
  record with `status == "waived"` — i.e. it asserts the two methods agree on
  the same waiver, not merely that each runs without erroring.

No other change in the window: `endpoints/medical_screening.py` beyond the
MS-17 hunk, `models/medical_screening.py`, and `mcp/tools/medical.py` are
unchanged from pass 11's own read.

**All 16 routes re-enumerated by decorator** (`grep -c '^@router\.'` → 16,
matching pass 11's count exactly) and each one's auth dependency read
directly rather than assumed:

| Route                       | Method | Auth dependency                                                              |
| --------------------------- | ------ | ---------------------------------------------------------------------------- |
| `/requirements`             | GET    | `require_permission("medical_screening.view")`                               |
| `/requirements/{id}`        | GET    | `.view`                                                                      |
| `/requirements`             | POST   | `.manage`                                                                    |
| `/requirements/{id}`        | PUT    | `.manage`                                                                    |
| `/requirements/{id}`        | DELETE | `.manage`                                                                    |
| `/records`                  | GET    | `.view`                                                                      |
| `/subjects`                 | GET    | `.manage`                                                                    |
| `/records/{id}`             | GET    | `.view`                                                                      |
| `/records`                  | POST   | `.manage`                                                                    |
| `/records/{id}`             | PUT    | `.manage`                                                                    |
| `/records/{id}`             | DELETE | `.manage`                                                                    |
| `/compliance`               | GET    | `.view`                                                                      |
| `/compliance/me`            | GET    | `get_current_user` (self-scoped by construction — no id param to substitute) |
| `/compliance/{user_id}`     | GET    | `.view` + the new MS-17 org check                                            |
| `/compliance/prospect/{id}` | GET    | `.view` + the new MS-17 org check                                            |
| `/expiring`                 | GET    | `.view`                                                                      |

Unchanged from every prior pass: no route lacks an auth dependency; no
permission string changed; the router itself still sits behind
`module_gate("medical_screening", ...)` in `api/v1/api.py:350-353`; neither
`medical_screening.view` nor `.manage` is baseline-granted (re-confirmed:
`grep -rn medical_screening backend/alembic/versions/` matches nothing, and
neither string appears in `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS`).

**Tenant isolation and PHI encryption, re-confirmed by direct read:** every
by-id getter (`get_requirement`, `get_record`) still filters
`organization_id` in the same `and_()`; `create_record`'s three
client-supplied FKs (`user_id`, `prospect_id`, `requirement_id`) still route
through `assert_in_org(..., allow_none=True)`
(`medical_screening_service.py:427-450`); `ScreeningRecordUpdate`
(`schemas/medical_screening.py:176-197`) still has no `user_id`/`prospect_id`/
`requirement_id` field, so an update cannot reassign a record's subject;
`provider_name`/`result_summary`/`notes` are still `EncryptedText` and
`result_data` still `EncryptedJSON` (`models/medical_screening.py:198-204`,
`226`), backed by real AES-256-GCM (`core/encrypted_types.py`'s
`process_bind_param`/`process_result_value` call `app.core.security.
encrypt_data`/`decrypt_data`); grepped all five backend files plus the
frontend module for `.where(`/`.filter(`/`.ilike(`/`order_by(` against
`provider_name`/`result_summary`/`notes`/`result_data` — zero matches, so
nothing compares or sorts on an encrypted column in SQL (the DOB-style bug
PR #3702 fixed in membership pipeline does not recur here). Also re-grepped
for `.like(`/`.ilike(`, `csv.writer`, `logger.`, and
`window.confirm`/`alert`/`prompt` across the same files — zero matches on
every pattern, so Pitfalls #15, #25, #31 and #33 do not apply to this
feature's current code.

**Schema casing (CLAUDE.md #5):** `grep alias_generator=to_camel
backend/app/schemas/medical_screening.py` — no match. This module is
snake_case on the wire (unlike apparatus/etc.); the frontend types in
`frontend/src/modules/medical-screening/types/index.ts` are written
snake_case to match, consistent with every prior pass.

**Standing items re-verified, unchanged (neither site touched by this
window's one commit):**

- **MS-14** (`medical_screening.view` grants full narrative PHI with no
  finer-grained read tier, LOW, FLAGGED, owner decision) — unchanged. Still
  five routes gated on `.view` return the narrative fields
  (`GET /records`/`{id}`); still no permission tier narrower than `.manage`
  exists to separate "sees compliance" from "sees the clinical detail."
- **MS-15** (the compliance roster loads every screening record in the
  organization, unbounded, LOW, FLAGGED, same class as MS-6/FIN-9/ELEC-12/
  USR-5/MP-10/DOC-9) — `get_compliance_roster`
  (`medical_screening_service.py:658-750`) still calls
  `self.list_requirements(..., is_active=True)` (unbounded `limit=None`) and
  `self.list_records(organization_id)` (also `limit=None`, no filter) to
  build `by_user`/`by_prospect` for grading every subject at once. Unchanged.
- **MS-16's remaining open half** — `grace_period_days` and
  `frequency_months` are still written on create/update and read by nothing
  in `_grade()` (`applies_to_roles` was wired in pass 11; these two were not).
  Re-confirmed: `_grade` (`:128-199`) references neither name.

**0 application-code defects found, 0 fixes needed, 0 new findings.** This
pass's own finding is that the two items pass 9/app-review pass 5 had flagged
for a product decision were, in fact, decided and correctly implemented
(including their own guard tests) by a session outside this rotation, and
that the fix holds up under direct re-verification against current code
rather than being taken on the commit message.

### Completion gate (pass 12)

| Check                                                                                                                                                                                    | Result                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (CI-pinned `flake8==7.4.1`, `/usr/local/bin/flake8`, which matches CI — a `flake8-pytest-style`-shadowing `~/.local/bin/flake8` is older and was bypassed) | ✅ 0 violations                                         |
| `black --check app/ tests/ alembic/` (CI-pinned `black==26.10.1`, `/usr/local/bin/black` — `~/.local/bin/black` resolves to a stale `26.5.1` uv-tool install and was bypassed)           | ✅ 2649 files unchanged                                 |
| `isort --check-only app/ tests/ alembic/` (CI-pinned `isort==9.0.2`)                                                                                                                     | ✅ clean                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                        | ✅ 652 revisions, single head `3f2593e8071e`            |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                        | ✅ 276 routes, 0 errors, 0 warnings                     |
| `pytest tests/ -q -k "medical_screening or screening"`                                                                                                                                   | ✅ 154 passed, 1 skipped (environment-only, `py_vapid`) |
| `frontend: npm run typecheck`                                                                                                                                                            | ✅ clean                                                |
| `frontend: npm run lint` (`eslint --max-warnings 10`)                                                                                                                                    | ✅ clean, 0 warnings                                    |
| `npx vitest run src/modules/medical-screening`                                                                                                                                           | ✅ 61 passed (11 files)                                 |

---

## Pass 11 (2026-10-23) — watchdog pickup: real delta (screening requirements now scoped to the positions they name), 0 fixed, 0 new findings; MS-14/MS-15 re-confirmed unchanged

**Step 0.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results, checked before starting. `ListAgents` found no other
reachable session. PR #3574 (Feature 08, Membership pipeline, pass 12) had
already merged. Rotation row 09 (Medical screening, PHI) was confirmed the
next `⬜` by reading `PROGRESS.md`'s table directly.

**Scope.** Baseline `d22f8693` (PR #3427's merge, pass 10). `git log
--no-merges d22f8693..HEAD` over the five declared files
(`endpoints/medical_screening.py`, `services/medical_screening_service.py`,
`models/medical_screening.py`, `schemas/medical_screening.py`,
`mcp/tools/medical.py`) plus the full `frontend/src/modules/
medical-screening/` directory: **5 non-merge commits**, all read in full.
`endpoints/medical_screening.py`, `models/medical_screening.py`, and
`mcp/tools/medical.py` are byte-identical to pass 10 — no route, no
permission string, no model/column change. No medical-screening-table
migration landed (scanned every new migration body in the window, not just
by pathspec — none references `medical_screening`/`screening_requirement`/
`screening_record`).

**The real delta: `applies_to_roles` is now read, not just stored
(`70c2845c`).** Before this commit the column existed and was writable from
the requirement form, but nothing read it back — every active requirement
graded every member, administrative staff included, regardless of what the
form saved. Read in full, not taken on the commit message:

- **`_requirement_roles()`** treats anything that is not a list of non-blank
  strings as "not scoped" — the fail-open direction for a compliance check:
  a malformed stored value (or the default empty list) grades the
  requirement for everyone rather than silently dropping a screening a
  member actually owes. `_role_key()` folds a position's name and its slug
  to one comparable form (casefold, whitespace/hyphen/underscore
  normalized), so "Safety Officer" and `safety_officer` match the same
  stored entry.
- **`_applicable_requirements()` is the single helper both compliance paths
  call** — `get_compliance_status` (one subject) and `get_compliance_roster`
  (the whole department) — so the two screens this feature's own Pitfall
  #29 precedent (MS-29, cited in pass 9's history) exists to guard against
  cannot drift: there is one definition of "applies to this person," not
  two independently re-derived ones. Checked directly, not assumed from the
  shared name.
- **A prospect (no positions) is graded on every requirement** —
  `_applicable_requirements` takes `held_positions: Optional[Set[str]]` and
  returns the full list unfiltered when it is `None`, which is what a
  prospect's lookup produces. This is the same fail-toward-more-screening
  direction as the malformed-value case: a role-scoped requirement cannot
  be shown not to apply to someone who holds no role yet, so the pipeline
  gate that reads this compliance status never silently loses a screening
  for an applicant.
- **A member left with nothing that applies reads `not_applicable`, never
  `compliant`** — the roster's `standing` computation was already guarded
  against a department with zero active requirements reporting everyone
  compliant (MS-26, pass 7); this commit extends the same `not applicable`
  guard to the per-member case (zero _applicable_ requirements), confirmed
  by reading the updated condition (`if not applicable` in place of
  `if not requirements`) rather than trusting the docstring's claim.
- **`_position_keys()` is org-scoped.** `Position.organization_id ==
organization_id` is in the `WHERE` clause of the one query the whole
  feature uses to resolve "which positions does this member hold" — a
  position id from another organization (there is none here; positions are
  joined by the org-scoped `Position` row, not trusted from a client-
  supplied id) cannot leak another tenant's role assignments into the
  calculation.
- **No schema change.** `applies_to_roles` already existed (added before
  pass 9, stored and validated, simply unread); this commit is a reader,
  not a new column — confirmed `models/medical_screening.py` has zero diff
  in this window.
- **Frontend changes are display-only, not a second copy of the rule.**
  `ComplianceDashboard.tsx`/`MedicalScreeningPage.tsx` route raw
  `expiration_date`/`scheduled_date`/`completed_date` strings through the
  existing `formatCalendarDate()` wrapper instead of interpolating them
  directly (closes a W71 workflow-review finding: a raw `"2026-11-01"` in
  running prose, not a security issue); `ScreeningRequirementForm.tsx`
  relabels the field and drops a stale "Not enforced yet" notice now that
  the backend reads it; `ScreeningRecordForm.tsx` adds a same-page
  expiration-date _suggestion_ (editable, never silently substituted — the
  suggestion only pre-fills a blank field or one still holding the form's
  own prior suggestion, confirmed by reading the guard condition) derived
  from the requirement's `frequency_months`, closing a W71 finding where a
  record saved with no expiration graded as compliant indefinitely. None of
  these five files re-implement `_applicable_requirements`'s rule
  client-side; they only format or suggest values the backend already
  computed or will validate.

**Numeric bounds (`74638250`, cross-cutting)** add `INT32_MIN`/`INT32_MAX`
caps to `frequency_months`/`grace_period_days` on both the base and update
schemas — closes a 500 on MySQL `INT` overflow, no auth/tenancy change.
**One `a11y` commit (`ef140b8e`)** retints two icon colors
(green-600→green-700, amber-600→amber-700) for AA contrast in
`SubjectCompliancePanel.tsx`/`MedicalScreeningPage.tsx` — styling only,
touches no auth, permission, or data-fetching path.

**All 16 routes re-enumerated** (unchanged from pass 10 — `endpoints/
medical_screening.py` has zero diff in this window). No new unescaped
`.ilike()`/`.like()`, raw `csv.writer`, or `window.confirm`/`alert`/
`prompt`.

**Tenant isolation and PHI encryption, re-confirmed present by direct read
of the files this window's delta did not touch:** every by-id getter still
filters `organization_id` in the same `and_()`; `create_record`'s three
client-supplied FKs (`user_id`, `prospect_id`, `requirement_id`) still route
through `assert_in_org(..., allow_none=True)`; `provider_name`/
`result_summary`/`notes` are still `EncryptedText`, `result_data` still
`EncryptedJSON`.

**Standing items re-verified, unchanged (neither site touched by this
window's delta):**

- **MS-14** (`medical_screening.view` grants full narrative PHI with no
  finer-grained read tier, FLAGGED, owner decision) — unchanged.
- **MS-15** (the compliance roster loads every screening record in the
  organization, unbounded, FLAGGED, same class as MS-6/FIN-9/ELEC-12/USR-5/
  MP-10/DOC-9) — `get_compliance_roster` still calls `list_subjects`/
  `list_records` with no `limit`/`offset`; this window's own change to that
  function (the `_applicable_requirements` filter) narrows which
  requirements a row is graded against, not how many subjects or records
  are loaded. Unchanged.

**0 application-code defects found, 0 fixes needed, 0 new findings.** This
pass's own finding is that a real, substantial feature change — wiring a
previously-dead column into every compliance calculation — was already
implemented with the correct fail-open direction, org-scoping, and a single
shared rule for both consuming screens.

### Completion gate (pass 11)

| Check                                                             | Result                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (CI-pinned 7.3.0)                   | ✅ 0 violations                                          |
| `black --check app/ tests/ alembic/` (CI-pinned 26.5.1)           | ✅ 2567 files unchanged                                  |
| `isort --check-only app/ tests/ alembic/` (CI-pinned 9.0.1)       | ✅ clean                                                 |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 640 revisions, single head `cc8c16cb6d98`             |
| `python3 scripts/check_route_permissions.py --strict` (repo root) | ✅ 273 routes, 0 errors, 0 warnings                      |
| `pytest tests/ -q -k "medical_screening or screening"`            | ✅ 147 passed, 1 skipped (environment-only, `pywebpush`) |
| `frontend: npm run typecheck`                                     | ✅ clean                                                 |
| `frontend: npm run lint`                                          | ✅ clean                                                 |
| `npx vitest run src/modules/medical-screening`                    | ✅ 59 passed (10 files)                                  |

---

## Pass 10 (2026-10-18) — watchdog pickup: near-zero delta (one frontend-only form-validation fix), 0 fixed, 0 new findings; MS-14/MS-15 re-confirmed unchanged

**Scope.** Pass 9 merged as `7a16ea19c` (PR #3256). `git log --no-merges
7a16ea19c..HEAD` over the five declared files
(`endpoints/medical_screening.py`, `services/medical_screening_service.py`,
`models/medical_screening.py`, `schemas/medical_screening.py`,
`mcp/tools/medical.py`) plus the full `frontend/src/modules/
medical-screening/` directory: exactly **1 non-merge commit**
(`7468e9f9e`), read in full. No medical-screening-table migration landed
(no new migration references `medical_screening`/`screening_requirement`/
`screening_record`, confirmed by scanning each new migration body, not
just by pathspec).

**The one commit is frontend-only and carries no security implication.**
`7468e9f9e` ("Fix edit forms that refused to save…") touches
`ScreeningRequirementForm.tsx` plus its own new test file — none of the
five backend files, no migration. It fixes a classic falsy-coercion bug:
the save payload built `grace_period_days` as `Number(gracePeriodDays) ||
30`, which silently turned an intentionally-entered `0` into `30` (the
same family of bug CLAUDE.md Pitfall #1 describes for empty strings, here
hitting a falsy number instead). The fix drops the `|| 30` fallback and
adds client-side validation requiring the field (the column is `NOT
NULL` server-side). No backend change, no PHI handling touched, no
route, no permission string. Confirmed by reading the full diff, not
inferred from the commit message.

**All 16 routes re-enumerated, unchanged from pass 9** — none of their
`Depends`/`require_permission` arguments were touched by this window's
one commit (which changed no backend file at all).

**Re-verified unchanged, by direct read (no file in this window's
delta touches either):**

- **MS-14** (`medical_screening.view` grants full narrative PHI with no
  finer-grained read tier, FLAGGED, owner decision) — unchanged.
- **MS-15** (the compliance roster loads every screening record in the
  organization, unbounded, FLAGGED, same class as MS-6/FIN-9/ELEC-12/
  USR-5/MP-10/DOC-9) — unchanged.

**Tenant isolation and PHI encryption, re-confirmed present by direct
read of the unchanged files** (not re-copied from pass 9's own account):
every by-id getter still filters `organization_id` in the same `and_()`;
`create_record`'s three client-supplied FKs (`user_id`, `prospect_id`,
`requirement_id`) still route through `assert_in_org(...,
allow_none=True)`; `provider_name`/`result_summary`/`notes` are still
`EncryptedText`, `result_data` still `EncryptedJSON`.

**0 application-code defects found, 0 fixes needed, 0 new findings.**

**Unrelated, repo-wide issue found and fixed separately, not folded into
this pass:** this pass's own `validate_migrations.py --strict` run
surfaced a 3-way forked Alembic chain
(`6dc58d6997df`/`7e5d6cf3292c`/`e99f068be43e`, three independently-merged
PRs that each revised the same parent) — unrelated to medical screening,
blocking `alembic upgrade head` for every PR, not just this one. Fixed in
its own standalone PR (#3426, a no-op merge revision, per the repo's own
precedent) rather than bundled into this docs-only security-review PR,
since it is a repo-wide build issue, not a medical-screening finding.
The migration-validation row below was re-run after applying that fix
locally (`alembic upgrade head` against the real database, then
`validate_migrations.py --strict` against the merged chain) to confirm
this feature's own migration history is still a clean single chain
underneath the unrelated fork.

### Completion gate (pass 10)

| Check                                                             | Result                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                     | ✅ 0 violations                                                                              |
| `black --check app/ tests/ alembic/`                              | ✅ 2445 files unchanged                                                                      |
| `isort --check-only app/ tests/ alembic/`                         | ✅ clean                                                                                     |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ single head, after separately fixing the unrelated 3-way fork (PR #3426) — see note above |
| `python3 scripts/check_route_permissions.py --strict` (repo root) | ✅ 272 routes, 0 errors, 0 warnings                                                          |
| `pytest tests/ -q -k "medical_screening or screening"`            | ✅ 122 passed, 1 skipped (environment-only, `pywebpush`)                                     |
| `frontend: npm run typecheck`                                     | ✅ clean                                                                                     |
| `frontend: npm run lint`                                          | ✅ clean                                                                                     |
| `npx vitest run src/modules/medical-screening`                    | ✅ 54 passed (9 files)                                                                       |

---

## Pass 9 (2026-10-15)

**Step 0.** `search_pull_requests` (`is:open head:claude/security-review-`) returned
0 results; PR #3255 (Feature 08, Membership pipeline, pass 10) had merged
docs-only (confirmed via its own Changes section), so it is not a recordable
event — the `PROGRESS.md` Open PR row is cleared with no new log entry for
it. Row 09 (Medical screening) was the next `⬜`.

**Backend:** `endpoints/medical_screening.py` (598 L, 16 routes),
`services/medical_screening_service.py` (841 L), `models/medical_screening.py`
(265 L), `schemas/medical_screening.py` (355 L), `mcp/tools/medical.py`
(214 L) — all five read in full, not diffed.
**Frontend:** full `modules/medical-screening/` directory (14 files) —
confirmed via `git log` that none has changed since pass 8's merge commit
(`df4fd720`), so pass 8's full read stands; not re-read line-by-line, but
every behavior claimed below (cache exclusion, dialog-dismiss, snake_case
types, no client-side re-grading) was re-verified directly against the
current files rather than carried forward on the strength of the claim.
**Migrations:** none new; `validate_migrations.py --strict` re-run clean
(596 revisions, single head `f2c5e55e7dda`).

### Scope — real delta since pass 8's baseline (`df4fd720`, PR #2978's merge commit)

Unlike several prior passes, `df4fd720` is a genuine ancestor of `HEAD` (no
orphan/squash-merge problem this time) — confirmed with
`git merge-base --is-ancestor df4fd720 HEAD`. `git log df4fd720..HEAD` against
the five declared backend files and the frontend directory returns exactly
two commits, both mechanical mypy-typing work, read in full rather than
taken on their commit message's word:

- **`668fca63`** (2026-10-13) adds a `None`-narrowing guard to
  `list_expiring_screenings` (`mcp/tools/medical.py:195-210`): the loop now
  skips a record whose `user_id`/`expiration_date` is `None` before building
  its dict, where the old comprehension built the dict first and let mypy's
  type inference be wrong about it. The `criteria` tuple above the query
  already excludes both cases in SQL (`user_id.isnot(None)`,
  `expiration_date.isnot(None)`), so the guard is unreachable in practice —
  a type-only change, not a behavior change, and not a new filter.
- **`265a26be`** (2026-10-14) adds a `TYPE_CHECKING`-only block to
  `ScreeningRecord` (`models/medical_screening.py:246-253`) declaring
  `user_name`/`prospect_name`/`reviewer_name`/`requirement_name` as the type
  checker's view of the plain instance attributes `attach_record_names`
  already sets at runtime (pass 7/8 both verified this mechanism). Not a
  mapped column, not visible to SQLAlchemy, no schema or migration
  implication — confirmed by reading the diff directly rather than assuming
  `if TYPE_CHECKING` implies no runtime effect.

Neither commit touches auth, permissions, org-scoping, PHI handling, or any
route. No new finding from this delta.

### Route inventory — re-enumerated directly, 16 routes, unchanged from pass 8

Walked `endpoints/medical_screening.py` top to bottom, each `Depends`/
`require_permission` argument read individually rather than diffed against
pass 8's table:

| Method | Path                        | Auth dependency                  | Permission |
| ------ | --------------------------- | -------------------------------- | ---------- |
| GET    | `/requirements`             | `require_permission`             | `.view`    |
| GET    | `/requirements/{id}`        | `require_permission`             | `.view`    |
| POST   | `/requirements`             | `require_permission`             | `.manage`  |
| PUT    | `/requirements/{id}`        | `require_permission`             | `.manage`  |
| DELETE | `/requirements/{id}`        | `require_permission`             | `.manage`  |
| GET    | `/records`                  | `require_permission`             | `.view`    |
| GET    | `/subjects`                 | `require_permission`             | `.manage`  |
| GET    | `/records/{id}`             | `require_permission`             | `.view`    |
| POST   | `/records`                  | `require_permission`             | `.manage`  |
| PUT    | `/records/{id}`             | `require_permission`             | `.manage`  |
| DELETE | `/records/{id}`             | `require_permission`             | `.manage`  |
| GET    | `/compliance` (roster)      | `require_permission`             | `.view`    |
| GET    | `/compliance/me`            | `get_current_user` (self-scoped) | n/a        |
| GET    | `/compliance/{user_id}`     | `require_permission`             | `.view`    |
| GET    | `/compliance/prospect/{id}` | `require_permission`             | `.view`    |
| GET    | `/expiring`                 | `require_permission`             | `.view`    |

Identical to pass 8's table. No route added, removed, or re-permissioned.
Every route carries an auth dependency; the one unauthenticated-looking
route (`/compliance/me`) is self-scoped by construction (no id parameter to
substitute).

### Re-verified good ✅ (re-confirmed against current code, not copied forward)

- **Tenant isolation.** Every by-id getter (`get_requirement`, `get_record`)
  filters `organization_id` in the same `and_()`
  (`services/medical_screening_service.py:190-201,297-306`); `update_*`/
  `delete_*` route through those getters, so there is no separate unscoped
  path. `create_record`'s three client-supplied FKs (`user_id`,
  `prospect_id`, `requirement_id`) go through `assert_in_org(...,
allow_none=True)` before the row is built (lines 370-393). `list_subjects`
  and `list_records`/`list_requirements` filter `organization_id` on every
  branch; `get_compliance_roster` filters it via `list_subjects`/
  `list_records`, both already org-scoped.
- **PHI encryption at rest.** `provider_name`, `result_summary`, `notes` are
  `EncryptedText`; `result_data` is `EncryptedJSON`
  (`models/medical_screening.py:198-204,226`) — re-confirmed directly
  against the current model, not re-derived from a prior pass's claim.
- **`SET NULL` FKs are nullable.** `requirement_id`
  (`ondelete="SET NULL"`, line 158) and `reviewed_by` (`ondelete="SET
NULL"`, line 207) are both `nullable=True`.
- **Update schemas omit every tenancy/subject FK.**
  `ScreeningRecordUpdate`/`ScreeningRequirementUpdate`
  (`schemas/medical_screening.py:169-190,84-98`) carry no `organization_id`,
  `user_id`, `prospect_id`, or `requirement_id` field, so no update path can
  reassign tenancy or subject — confirmed by reading both class bodies, not
  grepped for field names.
- **No raw exception reaches the client.** `create_record`/`update_record`/
  `update_requirement` each wrap their service call in
  `except ValueError as exc: raise HTTPException(400,
safe_error_detail(exc))` (`endpoints/medical_screening.py:169-173,342-346,
388-392`).
- **No injection/export surface.** `grep -n "\.like(\|\.ilike("` and
  `grep -n "csv\.writer\|csv\.DictWriter"` across all five backend files
  plus `mcp/tools/medical.py`: 0 matches, confirmed this pass rather than
  taken on a prior pass's word.
- **Audit logging** present on all six writes
  (`requirement_created/updated/deleted`, `record_created/updated/deleted`);
  the five PHI-bearing reads each call `_audit_phi_read` with ids/filters
  only, never a narrative field — re-read `_audit_phi_read`'s five call
  sites directly (`endpoints/medical_screening.py:253-269,311-320,
474-488,540-545,564-569,588-597`) and confirmed none passes
  `provider_name`/`result_summary`/`notes`/`result_data`. `/subjects` and
  `/compliance/me` remain unlogged by design (names-only / caller's-own-
  counts).
- **PHI cache exclusion.** `/medical-screening/` is in `UNCACHEABLE_PREFIXES`
  (`frontend/src/utils/apiCache.ts:38`), and the broader `/admin-hub/`
  aggregate-queue prefix is also present (line 140) — grepped directly this
  pass.
- **No `window.confirm`/`alert`/`prompt`** anywhere in
  `modules/medical-screening/` (grep, 0 matches); both form dialogs
  (`ScreeningRecordForm.tsx`, `ScreeningRequirementForm.tsx`) carry no
  click handler on their `modal-overlay` div — re-read both render blocks
  directly; Escape and the header close button remain the only ways out
  (Pitfall #31).
- **MCP explicit-projection discipline (MS-11) intact.** Neither
  `get_member_medical_compliance` nor `list_expiring_screenings` builds its
  return dict from a model/schema dump — both hand-pick fields, and neither
  includes `notes`/`result_summary`/`provider_name`/`result_data` or the
  record's raw `status` (re-read `mcp/tools/medical.py` in full, including
  this pass's own `668fca63` delta above).
- **Frontend types match the backend's snake_case convention.**
  `grep alias_generator=to_camel backend/app/schemas/medical_screening.py`:
  0 matches, confirming snake_case is still this module's real convention on
  both sides (per CLAUDE.md Pitfall #5's per-module casing rule).
- **No baseline permission grant.** `app/core/permissions.py:267-276` is
  still the only backend reference to either `medical_screening.view`/
  `.manage`; re-checked directly against `DEFAULT_POSITIONS`,
  `OPERATIONAL_RANKS`, and every seed migration (`grep -rn
medical_screening backend/alembic/versions/`: only the `create_all`-table
  model file, no seed migration grants it).

### Documentation correction (not a new security finding) — MS-16, MS-17 mirrored into `KNOWN_LIMITATIONS.md` for the first time

Every pass since pass 3 (2026-09-02) described two open items —
`grace_period_days`/`applies_to_roles`/`frequency_months` going unread by
`_grade()`, and `get_compliance_status` not 404ing an unknown subject — as
"already in `KNOWN_LIMITATIONS.md`". Checked directly rather than repeated:
**neither ever was.** Six consecutive passes copied the claim forward
without grep-ing the file it names. Both are real, both are correctly
disposed (flagged, not fixed, for the reasons each pass already gave), and
neither needed re-deriving — only the mirror was missing. Added as
`KNOWN_LIMITATIONS.md`'s **MS-16** and **MS-17** this pass (full text there);
the per-pass sections below are left exactly as written, since they record
what was true — about the code — when each one ran, and the inaccuracy was
in this file's cross-reference, not in the finding itself.

### Re-verified open, not re-flagged (unchanged from pass 8)

- **MS-14 — LOW.** `medical_screening.view` still grants the full narrative
  PHI on `GET /records`/`{id}` with no finer-grained read tier. Unchanged;
  in `KNOWN_LIMITATIONS.md`.
- **MS-15 — LOW.** `get_compliance_roster` still calls
  `self.list_records(organization_id)` with no filter and `limit=None`
  (`services/medical_screening_service.py:588`) — re-confirmed directly
  against the current line. Unchanged; in `KNOWN_LIMITATIONS.md`.
- **MS-9 (now mirrored as MS-16) — LOW.** `grace_period_days`/
  `applies_to_roles`/`frequency_months` still read by nothing in `_grade()`
  — re-confirmed by reading `_grade()`
  (`services/medical_screening_service.py:70-146`) line by line: no
  reference to any of the three. `test_medical_screening_requirement_
fields_are_unwired.py` still passes (below).
- **Compliance-404 (now mirrored as MS-17) — LOW. ✅ FIXED 2026-10-25
  (owner-directed):** both compliance routes answer 404 for an id that is not
  a member/prospect of the caller's org (`test_medical_screening_compliance_subjects.py`).
  As found: `get_compliance_status`
  still returns 200 for a nonexistent/out-of-org subject rather than 404.
  Re-confirmed not an enumeration channel: both the records query and
  `_resolve_names` filter `organization_id`, so a foreign or made-up id
  simply resolves to an empty summary, not another org's data.
- **MS2-7 — LOW. ✅ FIXED 2026-10-25 (owner chose "list it"):** the two
  methods share `_SATISFYING_STATUSES`, the expiring list carries each row's
  `status`, and the Compliance tab marks a waiver. As found: The waived-screening divergence between
  `get_compliance_status`'s `expiring_soon_count` and `get_expiring_soon`'s
  listing is still live, and the code now says so explicitly — the comment
  at `services/medical_screening_service.py:111-119` names MS2-7 as the
  other half of the "expiring soon" definition. Owner decision still
  pending; in `KNOWN_LIMITATIONS.md`.

## Schema & migration notes

No migration, no model/schema field change this pass. `validate_migrations.py
--strict` re-run clean: 596 revisions, single head `f2c5e55e7dda`.

## Guard tests added

None new — the only change this pass makes is the `KNOWN_LIMITATIONS.md`
mirror correction above, which is prose, not behavior; MS-9's existing
`test_medical_screening_requirement_fields_are_unwired.py` and MS-15's
standing `test_medical_screening_compliance_roster.py` already cover the two
re-verified-open findings and were re-run clean below.

## Completion gate

| Check                                                                                         | Result                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (CI-pinned `flake8==7.3.0` in a fresh venv)                     | 0 violations                                                               |
| `black --check app/ tests/ alembic/` (CI-pinned `black==26.5.1`)                              | clean, 2310 files unchanged                                                |
| `isort --check-only app/ tests/ alembic/` (CI-pinned `isort==9.0.1`)                          | clean                                                                      |
| `python3 scripts/validate_migrations.py --strict`                                             | pass — 596 revisions, single head `f2c5e55e7dda`                           |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                             | pass — 270 routes checked, 0 errors, 0 warnings                            |
| `pytest tests/ -q -k "medical or screening or phi"`                                           | **239 passed**, 0 skipped, 0 failed                                        |
| `pytest tests/ -m "not integration and not slow and not docker" -q` (full backend unit suite) | **14855 passed**, 3 skipped (pre-existing — nginx not installed), 0 failed |
| `npm run typecheck`                                                                           | clean                                                                      |
| `npm run lint`                                                                                | clean (`eslint --max-warnings 10`)                                         |
| `npx vitest run src/modules/medical-screening` (scoped frontend suite)                        | **50 passed** (8 files)                                                    |

---

## Pass 8 (2026-10-13)

**Watchdog pickup.** PR #3149 (Feature 08, Membership pipeline, pass 9) had
merged (`a7a7c47d`, the merge commit) with no `claude/security-review-*` PR
or branch open anywhere (`search_pull_requests`, `is:open
head:claude/security-review-`, 0 results; no stray remote branch). Row 09
was the next feature per `PROGRESS.md`'s own Open-PR narrative pointer.

### A dating/attribution error in this file, found before the review itself

The **"Owner decisions"** section further down (between the Pass 7 and
Pass 6 sections) read "(2026-10-05)" and stated its four fixes (MS-6, MS-12,
MS-13, MS-7) were "implemented on the same branch" as pass 7, "one commit
each." Both halves were wrong,
confirmed against the actual history rather than taken on the file's word,
because the date sits suspiciously _before_ the pass (2026-10-06) it claims
to follow:

- Pass 7's own PR (**#2957**, branch `claude/security-review-medical-screening`)
  merged 2026-10-06T01:14:12Z with a 4-file, 419-line diff — its body
  explicitly lists MS-6/MS-7/MS-12/MS-13 under "Re-verified open, unchanged
  (no action this pass)". None of the four was touched on that branch.
- The actual implementation is **PR #2965** ("Owner decisions, continued:
  medical screening, portal, PayPal backfill, …"), opened directly by the
  repository owner (not a security-review branch), which merged
  2026-10-06T18:26:21Z — seventeen hours _after_ pass 7, not the day before
  it. Its own description names all four fixes verbatim (the migration id,
  the subject-picker endpoint, the audit event names, the `self_recorded`
  column) and matches the current code exactly.
- `git log`/`git blame` could not independently date this (this repo's
  orphan/squash-merge history issue, documented since pass 1, applies here
  too — the commit both landed in is a root commit with no parent), so the
  correction rests on the GitHub PR records (`pull_request_read` on #2957
  and #2965), not on git history.

Corrected to **2026-10-06, PR #2965** below. This is a documentation
accuracy fix only — re-verified in the review that follows that the actual
code those four fixes describe is genuinely present and correct; nothing
about the fixes themselves was in question, only when and where they
landed.

### Scope — real delta since pass 7's baseline (`0e848aff`, PR #2957's merge commit)

`git log --oneline 0e848aff..HEAD -- <each of the 5 backend files + the
frontend module>` (reliable here — `0e848aff` is a real ancestor of
`HEAD`, unlike the older squash-merge heads prior passes had to work
around). Nine commits, three of them substantive, grouped by the PR that
actually carried them (found via `git rev-list --ancestry-path <sha>..HEAD
--merges | tail -1`, since commit authorship here doesn't map 1:1 to the
PR that merged it):

| PR                                                                                                                                                             | Merged                | What it changed here                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#2965** (2026-10-06T18:26)                                                                                                                                   | directly by the owner | MS-6/7/12/13's four fixes (see correction above) — reviewed fresh this pass, below                                                                                          |
| mechanical mypy-typing commits (`69d88b7f`, `c1b61de6`, `17e28941`, folded into later merges)                                                                  | 2026-10-09            | `Mapped`/`mapped_column` annotations on the model; a type-only pass, re-read in full, no behavior change                                                                    |
| `25d4345f`                                                                                                                                                     | 2026-10-09            | touches `schemas/medical_screening.py` only for an unrelated import; no medical-screening behavior change                                                                   |
| **#3086** "Docket builds: inventory, medical, forms, events, …" (2026-10-11T22:02)                                                                             | directly by the owner | `GET /medical-screening/compliance` (department roster, `?standing=` filter), `SubjectCompliancePanel`/`ComplianceRoster`/`SelfRecordedBadge` frontend, `_grade` extraction |
| `61819263` "fix(medical,equipment-checks): settle the roster and report races; no compliant-by-default" (same-day Codex review fix, folded into #3086's merge) | 2026-10-11            | roster-filter race, subject-panel race, "no active requirement" no longer grading everyone compliant                                                                        |

**None of this had been reviewed by the security-review rotation before
now.** Pass 7 (2026-10-06, early) predates both #2965 and #3086; no Pass 8
section existed until this one. #2965's own PR body and #3086's "Risk
checks" section cover org-scoping/PHI-caching/config-switch basics
reasonably, but neither is a seven-dimension pass, and PHI-adjacent surface
getting its first dedicated security read five-plus days after merging is
exactly the gap this rotation exists to close — recorded here, not as a
finding against either PR (both are sound, below), but as the reason this
pass has real work to do despite the rotation table already reading row 09
✅ from a prior full cycle.

### Route inventory — re-enumerated directly, 16 routes (+2 since pass 7)

Walked `endpoints/medical_screening.py` top to bottom (598 lines, up from
430 at pass 7):

| Method | Path                        | Auth dependency                                  | Permission | New this pass  |
| ------ | --------------------------- | ------------------------------------------------ | ---------- | -------------- |
| GET    | `/requirements`             | `require_permission`                             | `.view`    |                |
| GET    | `/requirements/{id}`        | `require_permission`                             | `.view`    |                |
| POST   | `/requirements`             | `require_permission`                             | `.manage`  |                |
| PUT    | `/requirements/{id}`        | `require_permission`                             | `.manage`  |                |
| DELETE | `/requirements/{id}`        | `require_permission`                             | `.manage`  |                |
| GET    | `/records`                  | `require_permission`                             | `.view`    |                |
| GET    | `/subjects`                 | `require_permission`                             | `.manage`  | ✅ new (#2965) |
| GET    | `/records/{id}`             | `require_permission`                             | `.view`    |                |
| POST   | `/records`                  | `require_permission`                             | `.manage`  |                |
| PUT    | `/records/{id}`             | `require_permission`                             | `.manage`  |                |
| DELETE | `/records/{id}`             | `require_permission`                             | `.manage`  |                |
| GET    | `/compliance` (roster)      | `require_permission`                             | `.view`    | ✅ new (#3086) |
| GET    | `/compliance/me`            | `get_current_user` (self-scoped by construction) | n/a        |                |
| GET    | `/compliance/{user_id}`     | `require_permission`                             | `.view`    |                |
| GET    | `/compliance/prospect/{id}` | `require_permission`                             | `.view`    |                |
| GET    | `/expiring`                 | `require_permission`                             | `.view`    |                |

Every route carries an auth dependency; none is unintentionally public. No
route removed or re-permissioned since pass 1.

### New this pass, reviewed against all seven checklist dimensions

**`GET /medical-screening/subjects` (#2965).** `.manage`-gated (appropriate:
it backs the Add Record subject picker, a `.manage`-only action). Returns
names and ids only (`ScreeningSubjects` — confirmed against
`schemas/medical_screening.py:325-339`, no PHI field). Org-scoped on both
queries (`services/medical_screening_service.py:308-351`, filters
`organization_id` on both `User` and `ProspectiveMember`). Not audit-logged
— correct, per the same reasoning as every other names-only read in this
file (MS-11/MS-12's own distinction). No `.like()`; bounded by the roster
and open-pipeline size, not paged — acceptable for a picker (an omitted
entry is worse than a long list, and this mirrors `MemberPickerModal`'s own
convention elsewhere in the app).

**`POST /records`'s exactly-one-of-subject validator (#2965, MS-13's
fix).** `ScreeningRecordCreate._exactly_one_subject`
(`schemas/medical_screening.py:150-166`) rejects a payload naming neither or
both of `user_id`/`prospect_id` — verified this is a real Pydantic
`@model_validator(mode="after")`, not a docstring claim: traced it directly
against the current file, confirmed `ScreeningRecordUpdate` deliberately
carries neither field (so this is the only place either can be set, exactly
as the docstring states), and confirmed the frontend's
`ScreeningRecordForm.subjectPicker.test.tsx` exercises it end to end.

**`screening_records.self_recorded` (#2965, MS-7's fix).** Column
(`models/medical_screening.py:219-225`), `nullable=False` with
`server_default="0"` — not a `SET NULL` FK, so Pitfall #2 doesn't apply, and
a boolean default needs no nullability. Migration
`9c1445489666_screening_record_self_recorded_flag.py` is table-existence-
guarded (`screening_records` is `create_all`-only, confirmed via
`_tables()`/`_columns()` helpers matching the Pitfall #26 shape exactly) and
has a real `downgrade()`. Set on write: `create_record` marks it when the
caller is the record's own subject (`_is_self`,
`services/medical_screening_service.py:65-67,409`); `update_record`
recomputes it only when the payload carries a `status`
(`services/medical_screening_service.py:445-446`), matching the documented
rule ("whoever submits the status owns it"). Surfaced consistently
everywhere compliance is read: `ScreeningRecordResponse.self_recorded`,
`ComplianceItem.self_recorded`, `ComplianceSummary.self_recorded_count`,
`ExpiringScreening.self_recorded`, and the MCP tool's own projection
(`mcp/tools/medical.py:77,87`) — checked each of the five independently
rather than assuming the one I read first implies the rest.

**`GET /medical-screening/compliance` — the department roster (#3086).**
`.view`-gated — proportionate: the response (`ComplianceRoster` /
`ComplianceRosterRow`) carries counts and a `standing` enum only, never a
narrative field, same shape discipline as the other four `.view` routes
MS-14 already found acceptable. Graded by `_grade()`
(`services/medical_screening_service.py:70-146`), the same function
`get_compliance_status` uses, so a roster row and the per-subject detail it
opens cannot disagree — verified this directly rather than taking the
docstring's word: `test_a_row_matches_the_per_subject_summary` in
`backend/tests/test_medical_screening_compliance_roster.py` asserts the two
paths produce identical counts for the same subject. Audited
(`medical_screening.compliance_roster_viewed`) with the filter and the
disclosed subject ids — consistent with every other PHI-adjacent read in
this file. The "no active requirement grades nobody" fix (`61819263`) is in
place and tested: `test_no_active_requirement_grades_nobody` confirms every
row reads `not_applicable` and every total is zero rather than the old
compliant-by-default bug.

**Frontend (`ComplianceRoster.tsx`, `SubjectCompliancePanel.tsx`,
`SelfRecordedBadge.tsx`, plus the `ComplianceDashboard.tsx`/
`MedicalScreeningPage.tsx` wiring) — all read in full, not diffed.** Renders
the server's `ComplianceSummary`/`ComplianceRoster` directly — no client-side
grading (Pitfall #29 holds: a comment in `SubjectCompliancePanel.tsx` names
the rule it is following and why). Both race-condition fixes from `61819263`
are in place: `ComplianceRoster.tsx`'s `latestRequest` ref and the store's
`latestComplianceRequest` counter + `clearCompliance()` retiring an
in-flight read on panel close. No dialog in the new components (they are
panels, not modals) so Pitfall #31 doesn't apply to them; the two existing
form dialogs (`ScreeningRecordForm.tsx`, `ScreeningRequirementForm.tsx`)
were re-checked and still carry no click handler on `modal-overlay`. Types
(`types/index.ts`) match the backend's snake_case field-for-field — confirmed
`schemas/medical_screening.py` still carries no `alias_generator=to_camel`
(`grep` returned nothing), so snake_case is the correct convention here, not
a mismatch. `UNCACHEABLE_PREFIXES` still covers both new routes via the
existing `/medical-screening/` prefix entry — no new entry needed.

**MCP tool (`mcp/tools/medical.py`) — re-read in full.** Unaffected by
either PR's new fields beyond projecting `self_recorded`/
`self_recorded_count` (booleans, not PHI) in `get_member_medical_compliance`.
No new tool, no permission change. Explicit-projection discipline (MS-11)
still holds for both tools.

### New finding

### MS-15 — LOW (scale, same class as MS-6/FIN-9/ELEC-12/USR-5/MP-10/DOC-9) — the compliance roster loads every screening record in the organization, unbounded — 🚩 FLAGGED

**What:** `MedicalScreeningService.get_compliance_roster`
(`services/medical_screening_service.py:588`) calls
`self.list_records(organization_id)` with no `user_id`, `prospect_id`,
`status`, or date filter and no `skip`/`limit` — `list_records`'s own
`limit=None` default then returns _every_ screening record ever created
for the organization, loaded into Python to be grouped into `by_user`/
`by_prospect` dicts for grading (lines 591-599).

**Why this is real:** this runs on every `GET /medical-screening/compliance`
request — i.e., every time an officer opens or re-filters the Compliance
tab's roster (new in #3086, 2026-10-11) — not on an admin batch job. For a
department that has used this module for years, the table accumulates one
row per member per screening type per cycle indefinitely (no purge/archival
path exists for a compliant, superseded record), so the load grows
unboundedly with the organization's history even though only the single
_latest_ record per subject/screening-type is ever used by `_grade()`.

**Why this is the same class, not a new category:** this is exactly the
"no SQL-level pagination on an org-wide table" pattern already tracked
under FIN-9/ELEC-12/USR-5/MP-10/DOC-9/MS-6 — but it is a genuinely new call
site: MS-6's own fix (owner decision, PR #2965) added `skip`/`limit` to the
_public_ `GET /records` list; it did not and could not reach this _internal_
call, which by design needs every subject's history to grade correctly (the
same reason `get_compliance_status`'s single-subject call also passes
`limit=None` — accepted there, since one person's history is small; `
get_compliance_roster` is the same shape applied to the whole org at once).

**Not fixed here:** narrowing the query (e.g., a SQL-level "latest record
per subject per screening_type" using the same `exists()`/`aliased()`
superseded-record pattern already written for the MCP tool's
`list_expiring_screenings`, `mcp/tools/medical.py:131-167`) is a grading
_implementation_ change on a PHI-adjacent, department-wide read — exactly
the kind of change this feature's established discipline (MS-6, MS-9,
MS-13) declines to make without a product decision, because a subtle
off-by-one in the "latest" definition would silently change who reads
compliant for the whole roster at once, not just one subject. It is also
plausible the owner judges the real-world scale fine as-is: this is a
volunteer fire department's own roster (the target deployment is tens to
low hundreds of members per `ARCHITECTURE.md`), not an enterprise table,
and `list_subjects`/`list_requirements` are bounded by the same roster size.

**Disposition:** flagged for the application owner, same remedy shape as
MS-6: either accept the cost at the department scale this app targets, or
add the bounded SQL query described above. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### Re-verified good ✅ (re-confirmed against current code)

Everything pass 7 verified good, re-confirmed directly against the current
(larger) files rather than carried forward: no baseline permission grant for
either `medical_screening.view`/`.manage` (`app/core/permissions.py:270,275`
are still the only references, confirmed against `DEFAULT_POSITIONS`/
`OPERATIONAL_RANKS`/every seed migration); tenant isolation intact on every
by-id query and all three client-supplied FKs on `create_record`
(`assert_in_org`, `services/medical_screening_service.py:370-393`); PHI
encryption at rest intact on all four columns
(`provider_name`/`result_summary`/`result_data`/`notes`, confirmed
`EncryptedText`/`EncryptedJSON` in `models/medical_screening.py:198-226`);
`SET NULL` FKs (`requirement_id`, `reviewed_by`) both `nullable=True`;
update schemas (`ScreeningRequirementUpdate`, `ScreeningRecordUpdate`) still
omit every tenancy/subject FK field; no raw exception reaches the client
(`except ValueError as exc: raise HTTPException(400, safe_error_detail(exc))`
on both update paths and `create_record`); no CSV/spreadsheet export; no
`.like()`/`.ilike()` anywhere in this feature's files (`grep` over all five
backend files plus the frontend module, 0 matches); no unbounded in-memory
cache/tracker; no JSON-column shallow-copy mutation risk (`applies_to_roles`
is a plain assignment via `apply_updates`, not a nested mutate-and-reassign);
audit logging present on all six writes, absent only on the names-only
`/subjects` read and the caller's-own-counts `/compliance/me` (both by
design, MS-12's own rationale); MCP tools' explicit-projection discipline
intact; cache exclusion and the route/module gate both re-confirmed; both
form dialogs still carry no click-outside-to-close handler (Pitfall #31).

### Re-verified open, not re-flagged (unchanged from pass 7)

- **MS-14 — LOW.** `medical_screening.view` still grants the full narrative
  PHI on `GET /records`/`{id}` with no finer-grained read tier. Unchanged;
  already in `KNOWN_LIMITATIONS.md`.
- **MS-9's `grace_period_days`/`applies_to_roles`/`frequency_months`
  remain unenforced** ("Not enforced yet" notices unchanged in substance).
- **`get_compliance_status` still doesn't 404 an unknown subject**
  (re-confirmed not an enumeration channel — identical response shape for a
  nonexistent/out-of-org/zero-record subject).

## Schema & migration notes

One migration since pass 7: `9c1445489666` (self-recorded flag, part of the
#2965 delta reviewed above) — table-existence-guarded, reversible,
`validate_migrations.py --strict` clean (578 revisions, single head). No
other model/schema change in scope this pass.

## Guard tests added

None new by this pass — the one new finding (MS-15) is flagged, not fixed,
so there is no behavior change to pin; the #2965/#3086 fixes already carry
their own guard tests (`test_medical_screening_record_subject.py`,
`test_medical_screening_self_recorded.py`,
`test_medical_screening_read_audit.py`,
`test_medical_screening_list_pagination.py`,
`test_medical_screening_compliance_roster.py`, plus the frontend
`*.test.tsx` files named above), all re-run and passing below.

## Completion gate

| Check                                                                                         | Result                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                 | 0 violations                                                   |
| `black --check app/ tests/ alembic/`                                                          | clean, 2209 files unchanged                                    |
| `isort --check-only app/ tests/ alembic/`                                                     | clean                                                          |
| `python3 scripts/validate_migrations.py --strict`                                             | pass — 578 revisions, single head                              |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                             | pass — 267 routes checked, 0 errors, 0 warnings                |
| `pytest tests/ -q -k "medical or screening or phi"`                                           | **220 passed**, 1 skipped (pre-existing, `py_vapid`), 0 failed |
| `pytest tests/ -m "not integration and not slow and not docker" -q` (full backend unit suite) | **14355 passed**, 1 skipped (pre-existing), 0 failed           |
| `npm run typecheck`                                                                           | clean                                                          |
| `npm run lint`                                                                                | clean (`eslint --max-warnings 10`, 0 warnings)                 |
| `npx vitest run src/modules/medical-screening` (scoped frontend suite)                        | **50 passed** (8 files)                                        |

---

## Pass 7 (2026-10-06)

**Watchdog pickup.** Step 0 was re-verified fresh per this rotation's own
instructions: `git fetch origin main` clean, `mcp__github__list_pull_requests`
(state=open) returned no `claude/security-review-*` head branch (only #2953
and #2954, both unrelated feature PRs), confirming no security-review PR to
tend. Proceeded to Step 1: Feature 09 (Medical screening) was the next `⬜`
row in `PROGRESS.md`.

**Backend:** `endpoints/medical_screening.py` (430 L, 14 routes),
`services/medical_screening_service.py` (620 L), `models/medical_screening.py`
(223 L), `schemas/medical_screening.py` (255 L), `mcp/tools/medical.py`
(204 L, 2 tools) — all read in full.
**Frontend:** full `modules/medical-screening/` directory read in full (all
14 files, not just the ones a diff flagged), per this rotation's own
discipline of not treating "diff is empty/small" as license to skip the
re-read.
**Migrations:** none new for this feature; `validate_migrations.py --strict`
re-run clean (525 revisions, single head).

### A correction before the review itself: the working tree was stale, and pass 6's PR link was never filled in

Two housekeeping notes, neither a security finding:

1. **This session's checked-out branch was 104 commits behind `origin/main`**
   (a stale leftover from the prior iteration's Feature 08 branch, already
   merged as PR #2955). Line counts read against it did not match pass 6's
   documented state for reasons that turned out to be "wrong branch," not
   "undocumented change" — caught by comparing `wc -l` against pass 6's
   table before trusting it, and fixed by `git checkout -B
claude/security-review-medical-screening origin/main` before any further
   reading. Recorded here because the discrepancy could otherwise read as a
   finding about drift that was actually just a stale checkout.
2. **Pass 6's own header line still read `(this PR)` for its PR link.** That
   pass's PR merged as [#2608](https://github.com/thegspiro/the-logbook/pull/2608)
   seven hours after it was opened, but nothing ever came back to fill in the
   number — there is no mechanism in this rotation that revisits a merged
   pass's own header. Corrected above.

### Scope — git log is unreliable here, confirmed again, so the delta was found by content, not by diffing a resolved baseline

Found PR #2608 (pass 6) via `search_pull_requests` (its title isn't
`"medical-screening" in:title`-findable by number alone) and its head SHA
(`e988a4ae1...`) is **not a valid object in this repository's history** —
`git show` on it fails outright. This is the same "squash/orphan merge"
unreliability pass 1 and pass 4 already hit and documented (MP-08's note);
it is confirmed again here, on a fresh example, rather than assumed from the
prior write-up. Consequently the baseline for "what changed since pass 6"
could not be established as `git log <sha>..origin/main`.

What worked instead, and is the actual method this pass used: per-path
`git log -- <file>` on each of the five declared backend files and the full
frontend directory, which (unlike the orphaned merge commits) correctly
surfaces the real authoring commits that touched each path, confirmed by
reading every one in full rather than trusting its title. That turned up
**four backend commits and three frontend commits** since the content pass 6
documented:

| Commit      | Date       | File(s)                                                                                        | Reviewed by                                                                                                                                                            |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2f18127c7` | 2026-09-26 | `mcp/tools/medical.py`                                                                         | app-review pass 5 did **not** mention this one (its own sweep was scoped to the service/endpoint files); reviewed fresh here                                           |
| `25cf5c01a` | 2026-09-26 | `services/medical_screening_service.py`                                                        | app-review pass 5 (named directly)                                                                                                                                     |
| `78f52e4ae` | 2026-09-29 | `models/medical_screening.py`                                                                  | app-review pass 5 (named directly)                                                                                                                                     |
| `dd438dd88` | 2026-10-04 | `services/medical_screening_service.py`                                                        | **not reviewed by any prior pass** — landed the day before app-review pass 5's own write-up commit, but that pass's delta description names only the two commits above |
| `84262b4b1` | 2026-09-29 | `ComplianceDashboard.tsx`, `MedicalScreeningPage.tsx`                                          | not previously reviewed (copy-only)                                                                                                                                    |
| `92617c5af` | 2026-09-29 | `ScreeningRecordForm.tsx`, `ScreeningRequirementForm.tsx`, `ScreeningFormClearGuards.test.tsx` | not previously reviewed (copy-only)                                                                                                                                    |
| `bd49adf76` | 2026-09-29 | `MedicalScreeningPage.tsx`                                                                     | not previously reviewed (copy-only)                                                                                                                                    |

Each read in full via `git show <sha> -- <path>`, not summarized from its
commit message:

- **`2f18127c7`** ("Judge equipment checks and stock expiry on the
  department's date") swaps `date.today()` for
  `await resolve_org_today(db, principal.organization_id)` in
  `list_expiring_screenings`. Org-scoped, same fix shape SEC-00/app-review
  already verified for the two service-layer call sites — no new surface.
- **`25cf5c01a`** and **`78f52e4ae`** — re-read directly rather than taken on
  app-review's word, both exactly as that pass described: the former is the
  `resolve_org_today` swap in `get_compliance_status`/`get_expiring_soon`;
  the latter drops `cascade="all, delete-orphan"` for `passive_deletes=True`
  on `ScreeningRequirement.records`, with `requirement_id` already
  `ondelete="SET NULL"` + `nullable=True` (confirmed directly against the
  current model, not re-derived from the commit message).
- **`dd438dd88`** ("Name members on medical screening records by their
  preferred name") — the one genuinely new-to-security-review commit.
  `_resolve_names`'s user query gained `User.preferred_name` and now calls
  the shared `format_display_name(first, last, preferred)` helper
  (`app/utils/member_names.py`) instead of the inline `f"{first} {last}"`
  join. Checked directly: the query is still filtered on
  `User.id.in_(user_ids)` **and** `User.organization_id == organization_id`
  (unchanged), so the org-scoping that keeps a name from crossing tenants is
  untouched — only which of two already-org-scoped columns gets used as the
  given name changed. `format_display_name` itself (read in full) is a
  documented, repo-wide convention (member-facing screens use the preferred
  name; legal/exported documents use `format_legal_name`) with no PHI
  implication — it is a display-name choice, not a new data exposure.
  Prospects are explicitly unchanged (no `preferred_name` column on
  `ProspectiveMember`). Clean.
- **`84262b4b1`, `92617c5af`, `bd49adf76`** — all three are copy-only
  (button labels, placeholder text, empty-state copy, a delete-confirmation
  message that was first widened to warn about the cascade-delete bug
  `78f52e4ae` was about to fix, then correctly narrowed back down once that
  fix landed). Checked specifically for two things given this feature's
  history: whether the MS-13 orphaned-record amber notice survived the
  rewording in `92617c5af` (it did — the notice is shorter but says the
  same thing, and the dedicated guard test
  `ScreeningRecordForm.linkageNotice.test.tsx` matches on the substring
  "not linked to a member or prospect", which is still present verbatim),
  and whether the MS-9 "Not enforced yet" notices on `grace_period_days`/
  `applies_to_roles` survived (both do, confirmed against the current file
  and against `test_medical_screening_requirement_fields_are_unwired.py`'s
  own substring check, which only requires the fragment `"Not enforced"`
  inside each field's block — unaffected by the wording trim). One
  side-effect of `92617c5af` is addressed below (a stale doc citation, not a
  behavioral issue).

No migration, no model/schema field change, no permission or route change in
any of the seven commits.

### Route inventory — re-enumerated directly against the current file

All 14 routes walked again (not diffed against the pass 3 table and assumed
unchanged): identical in path, method, auth dependency, and permission
string to every prior pass's table. No route added, removed, or
re-permissioned since pass 1.

### Re-verified good ✅ (re-confirmed against current code, not copied forward)

- No baseline grant for either permission —
  `app/core/permissions.py:267-276` is still the only reference in the
  backend; re-checked directly (not grep'd from memory) against
  `DEFAULT_POSITIONS`, `OPERATIONAL_RANKS`, and every seed migration.
- Tenant isolation intact throughout: every by-id getter filters
  `organization_id`; `create_record`'s three client-supplied FKs still
  route through `assert_in_org(..., allow_none=True)`.
- PHI encryption at rest intact — `provider_name`/`result_summary`/`notes`
  (`EncryptedText`), `result_data` (`EncryptedJSON`), re-confirmed against
  the current model file.
- `SET NULL` FKs (`requirement_id`, `reviewed_by`) both `nullable=True`.
- Update schemas still omit every tenancy/subject FK field.
- No raw exception reaches the client; `create_record`/`update_record`/
  `update_requirement` still wrap in
  `except ValueError as exc: raise HTTPException(400, safe_error_detail(exc))`.
- No CSV/spreadsheet export; no `.like()`/`.ilike()` anywhere in this
  feature's files.
- No unbounded in-memory cache/tracker; no JSON-column shallow-copy
  mutation risk — re-traced both `create_*`/`update_*` write paths on
  `applies_to_roles`/`result_data` directly.
- Audit logging present on all six writes, absent on the five PHI-bearing
  reads (MS-12, still flagged, unchanged).
- MCP tools' explicit-projection discipline (MS-11) still holds: neither
  tool's return dict includes `notes`/`result_summary`/`provider_name`/
  `result_data`, or the record's raw `status`. `require_member` and
  `member_names` (`app/mcp/tools/_common.py`, read directly) are both
  org-scoped and fail closed (`ValueError` on a missing/foreign member).
- Cache exclusion (`/medical-screening/`, `/admin-hub/` in
  `UNCACHEABLE_PREFIXES`) and the route/module gate
  (`requiredPermission="medical_screening.view"` +
  `requiredModule="medical_screening"` on the one frontend route,
  `require_permission(...)` independently on all 14 backend routes) both
  re-confirmed against the current files.
- The dialog overlays in both `ScreeningRecordForm.tsx` and
  `ScreeningRequirementForm.tsx` carry no click handler on the
  `modal-overlay` div — Pitfall #31 (no dialog closes on an outside click)
  holds; Escape and the header close button are the only ways out.

### New this pass

### MS-14 — LOW (authorization proportionality, PHI "minimum necessary") — `medical_screening.view` grants full narrative PHI with no finer-grained read tier — 🚩 FLAGGED

**What:** this pass was asked to specifically re-examine whether a `.view`
permission on a PHI feature is proportionate, per Checklist §2's framing
that a `.view` gate on data warranting `.manage`-level sensitivity is the
XC-2 pattern. Re-checked directly rather than carried forward from six prior
passes all saying "access control: present" without separately asking this
question.

Five routes are gated on `medical_screening.view`: `GET /requirements`
(configuration, not PHI), `GET /requirements/{id}` (same), `GET /records`,
`GET /records/{id}` (both return the full `ScreeningRecordResponse`,
including the three `EncryptedText` columns and the one `EncryptedJSON`
column — `provider_name`, `result_summary`, `notes`, `result_data` — decrypted
transparently before serialization), `GET /compliance/{user_id}`,
`GET /compliance/prospect/{prospect_id}`, `GET /expiring` (these three return
`ComplianceSummary`/`ExpiringScreening`, which carry a requirement name,
screening type, dates and a `passed`/`failed`/`waived`-shaped status, but
**not** the narrative fields — confirmed directly against
`schemas/medical_screening.py`).

**Why this is a real, if narrow, consideration and not a false alarm:**
anyone an administrator grants `medical_screening.view` to — without also
granting `.manage` — can read a member's examining provider's name, a
free-text result summary, and reviewer notes for every screening in the
organization, with no separate tier between "can see who is compliant" and
"can see the clinical narrative." HIPAA's minimum-necessary principle would
be better served by a finer split (e.g., a role that can see compliance
status for scheduling purposes without seeing `provider_name`/
`result_summary`/`notes`/`result_data`), which does not exist today.

**Why this is not escalated to "the permission model is wrong" or fixed
outright:**

- The `view`/`manage` split here is the **same pattern used uniformly
  across every other resource in this codebase** (finance, apparatus,
  elections, inventory, …) — view reads, manage writes. Singling out this
  one feature for a three-tier model would be an inconsistent special case,
  not a drop-in fix, and is a product decision about the permission schema,
  not a same-day code change.
- **Neither permission is baseline-granted** (re-confirmed this pass — see
  above), so the exposure requires an administrator to deliberately assign
  `.view` to a role. This is a materially different posture than, say,
  MS-4's historical bug (a PHI route reachable by every member by default)
  or a genuinely mismatched permission string copy-pasted from a
  lower-sensitivity resource.
- Splitting `GET /records`/`GET /records/{id}` onto a new, narrower
  permission (or trimming their response shape for `.view`-only callers)
  would change who can read what for any organization that has already
  assigned `.view` without `.manage` — a behavior change on a PHI read path,
  which this feature's own established disposition (MS-7, MS-9, MS-13) is to
  flag rather than guess at.

**Disposition:** flagged for the application owner. If an organization wants
a "can see compliance, cannot see clinical detail" role, the fix is a new
permission (e.g. `medical_screening.view_detail`) gating only the narrative
fields, with `.view` alone continuing to carry the five derived-status
routes. Not implemented here — it is a new permission string, a schema
split, and a decision about which existing `.view`-only grants (if any, per
organization) should be left as-is versus upgraded, which only the owner can
make. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### Minor doc correction (not a security finding)

`backend/tests/test_medical_screening_requirement_fields_are_unwired.py`'s
own docstring cited the `applies_to_roles` field as sitting under literal
copy reading "Leave blank to apply to all members" — true when MS-9 wrote
it, no longer true since `92617c5af` (pass 7's own delta, above) trimmed
that caption as redundant with the "Not enforced yet" notice beside it. The
test's actual assertion only checks for the substring `"Not enforced"` in
each field's block, so this was a comment-accuracy gap, not a test
correctness one — fixed by rewording the docstring to describe the original
motivation in the past tense rather than asserting current copy. No test
behavior changed.

### Re-verified open, not re-flagged (unchanged from pass 3/4/5/6)

- **MS-6 — LOW (scale).** `list_requirements`/`list_records` still run bare
  `.all()`. Unchanged; already in `KNOWN_LIMITATIONS.md`.
- **MS-7 — MED.** `create_record`/`update_record` still place no constraint
  between `current_user` and `data.user_id`; `get_compliance_status` still
  never reads `reviewed_by`. Unchanged; still needs a product decision;
  already in `KNOWN_LIMITATIONS.md`.
- **MS-12 — LOW (audit completeness).** The five PHI-bearing `GET` routes
  still call no `log_audit_event`. Unchanged; already in
  `KNOWN_LIMITATIONS.md`.
- **MS-13 — MED.** The "Add Record" dialog still has no `user_id`/
  `prospect_id` control; every UI-created record is still orphaned. The
  interim honesty notice (on the create dialog, and now also on the Records
  tab's list rows per `84262b4b1`, this pass's own delta) is unchanged in
  substance. Unchanged; already in `KNOWN_LIMITATIONS.md`.
- **`create_record` still doesn't enforce exactly-one-of `user_id`/
  `prospect_id`.** Both ids are still plain `Optional[str] = None` on
  `ScreeningRecordCreate`; no `@model_validator` added. Unchanged — and
  still moot for every UI-originated record per MS-13.
- **`get_compliance_status` still doesn't 404 an unknown subject.**
  Re-confirmed not an enumeration channel.
- **`grace_period_days`/`applies_to_roles` (MS-9) and `frequency_months`
  still unenforced.** The "Not enforced" notices are unchanged in substance
  (reworded, not removed — see the doc correction above).

## Schema & migration notes

No migration this pass; no model/schema change. `validate_migrations.py
--strict` re-run clean: 525 revisions, single head.

## Guard tests added

None new — MS-14 is a flagged consideration with no safe same-day fix to
pin, and the doc correction above is a comment-only edit to an existing
test's docstring with no assertion change.

## Completion gate

| Check                                                                                         | Result                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                 | 0 violations                                                                                                                                                                                                                                            |
| `black --check app/ tests/ alembic/`                                                          | clean, 1944 files unchanged                                                                                                                                                                                                                             |
| `isort --check-only app/ tests/ alembic/`                                                     | clean                                                                                                                                                                                                                                                   |
| `python3 scripts/validate_migrations.py --strict`                                             | pass — 525 revisions, single head                                                                                                                                                                                                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                             | pass — 245 routes checked, 0 errors, 0 warnings                                                                                                                                                                                                         |
| `pytest tests/ -q -k "medical_screening or medical-screening or grace_period"`                | **58 passed, 1 skipped** (pre-existing — optional `py_vapid` dep), 0 failed                                                                                                                                                                             |
| `pytest tests/ -m "not integration and not slow and not docker" -q` (full backend unit suite) | **12930 passed, 1 skipped** (pre-existing/environmental), 0 failed                                                                                                                                                                                      |
| `npm run typecheck` / `npm run lint`                                                          | not run — no frontend file was changed by this pass (only a backend test docstring); per CLAUDE.md "Match the Verification to the Change," and consistent with pass 4/5's own precedent of skipping frontend gates when nothing frontend-facing changed |

---

## Owner decisions (2026-10-06, PR #2965)

**Corrected by pass 8 (2026-10-13):** this section previously read "(2026-10-05)"
and said the four fixes below were "implemented on the same branch" as pass 7
— both wrong. Pass 7 is PR #2957 (merged 2026-10-06T01:14Z); its own diff
touches only this findings doc, `PROGRESS.md`, `KNOWN_LIMITATIONS.md`, and one
test docstring, and its own PR body lists all four of these as "unchanged, no
action this pass." The actual fixes landed in **PR #2965** ("Owner decisions,
continued: medical screening, …"), opened directly by the repository owner on
a separate, non-security-review branch, merged 2026-10-06T18:26Z — seventeen
hours _after_ pass 7, not the day before it. See pass 8's own section above
for how this was found and verified. The fixes themselves were re-verified
intact against current code this pass and are accurately described below.

Four findings this rotation had flagged for a product decision were decided by
the owner and implemented on PR #2965, one commit each. Earlier pass sections
below are left as written; they record what was true when each pass ran.

### MS-6 — ✅ FIXED — the requirement and record lists page in SQL

Owner choice: push `LIMIT`/`OFFSET` into SQL, keeping the response shape.
`list_requirements`/`list_records` take `skip`/`limit` and apply them to the
query (`_page` in `medical_screening_service.py`); the two endpoints pass
`PaginationParams` through instead of slicing a full `.all()` in Python. Both
orderings gained an `id` tie-breaker so a page boundary cannot shuffle rows
that share a name or a one-second `created_at`. The response is still a bare
list, so no frontend change. `limit=None` keeps the full set for
`get_compliance_status`, which grades one subject's history and is bounded by
that subject; `get_expiring_soon` is bounded by its date window. Guarded by
`backend/tests/test_medical_screening_list_pagination.py` (integration —
asserts the page returned and that the SQL MySQL receives carries the
`LIMIT`).

### MS-12 — ✅ FIXED — PHI reads write one audit event per request

Owner choice: log once per request, naming the subject(s) or the filter.
The five PHI-bearing reads now call `_audit_phi_read` in
`endpoints/medical_screening.py`, which writes one `medical_screening`-category
event and commits it before the response is returned:

| Route                           | Event type                            | `event_data`                                                   |
| ------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `GET /records`                  | `medical_screening.records_viewed`    | `filters` (incl. skip/limit), `record_count`, subject id lists |
| `GET /records/{id}`             | `medical_screening.record_viewed`     | `record_id`, `record_user_id`, `record_prospect_id`            |
| `GET /compliance/{user_id}`     | `medical_screening.compliance_viewed` | `subject_type: "user"`, `subject_id`                           |
| `GET /compliance/prospect/{id}` | `medical_screening.compliance_viewed` | `subject_type: "prospect"`, `subject_id`                       |
| `GET /expiring`                 | `medical_screening.expiring_viewed`   | `filters.days`, `record_count`, subject id lists               |

The list events carry the distinct member and prospect ids on the returned
page, so "who saw member X's results" is answerable without one row per
record. A 404 is not logged as a view. `GET /compliance/me` stays unlogged —
it is the caller's own counts, loaded on every dashboard visit — and the two
MCP tools were already audited by the MCP registry. Guarded by
`backend/tests/test_medical_screening_read_audit.py` (integration, 8 tests
against real `audit_logs` rows).

### MS-13 — ✅ FIXED — Add Record files the record against exactly one member or prospect

Owner choice: a picker with exactly one of member or prospect, so records
count toward compliance. Three parts:

- `ScreeningRecordCreate` gained a `model_validator` rejecting a payload
  naming neither or both (`user_id` / `prospect_id`; a blank string counts as
  absent) — a 422. This also closes the long-tracked "`create_record` doesn't
  enforce exactly-one-of" gap listed under every pass since pass 1.
- New `GET /medical-screening/subjects` (`medical_screening.manage`,
  org-scoped) returns `{members, prospects}` as `{id, name}` — current
  members (active, probationary, leave, suspended; not deleted) and prospects
  still open (active, on hold). Names only, so not audit-logged. It exists
  because the `.manage` holder need not hold `users.view` or the pipeline
  permissions, and `MemberPickerModal`'s inventory-scoped source covers
  neither that nor prospects.
- `ScreeningRecordForm` replaces the amber "not linked" notice with a
  **Record is for** Member/Prospect choice and a name list; submit is disabled
  until a subject is chosen, a load failure is shown as an alert, and the
  payload carries only the chosen id.

Records created before the fix remain unattached — nothing records whom they
were about — and are left to the residual note in `KNOWN_LIMITATIONS.md`.
Guarded by `backend/tests/test_medical_screening_record_subject.py` (unit
schema tests + integration tests of the subject list and a prospect create)
and `ScreeningRecordForm.subjectPicker.test.tsx` (replaces
`ScreeningRecordForm.linkageNotice.test.tsx`).

### MS-7 — ✅ FIXED (allow but flag) — a self-recorded screening is marked in the compliance views

Owner choice: allow but flag. A `.manage` holder can still record or clear
their own screening — blocking it would break the department where one person
logs everyone's results — but the result is no longer indistinguishable from
an independently recorded one:

- New column `screening_records.self_recorded` (migration `9c1445489666`,
  guarded — `screening_records` is a `create_all`-only table — with a real
  downgrade). True when the record's status was last set by its own subject:
  `create_record` marks it when the caller is `user_id`; `update_record`
  recomputes it whenever the payload carries a status (the edit form always
  does), so a colleague's save clears it and an edit that omits the status
  keeps it. Backfill marks rows where `reviewed_by = user_id`, and rows with no
  reviewer whose `medical_screening.record_created` audit event (record id on
  it since MS-8) was written by the subject.
- Surfaced in every compliance view: `ScreeningRecordResponse.self_recorded`,
  `ComplianceItem.self_recorded`, `ComplianceSummary.self_recorded_count`,
  `ExpiringScreening.self_recorded`, and the MCP member-compliance tool's
  projection. The Records tab and the Compliance tab's expiring list show an
  amber **Self-recorded** badge (`SelfRecordedBadge.tsx`). Compliance still
  counts the record.
- `record_created` / `record_updated` audit events carry `self_recorded`.

`MyComplianceSummary` (the member's own dashboard counts) is unchanged — it is
the subject's own view. A second-approver workflow was not chosen and is not
built. Guarded by `backend/tests/test_medical_screening_self_recorded.py`
(integration, 8 tests) and `SelfRecordedBadge.test.tsx`.

---

## Pass 6 (2026-09-16)

**Watchdog pickup.** This iteration ran directly (not through the
`/loop 30m /security-review` session, which had gone 3.5+ hours with no
commit to `main` and no open security-review PR). Step 0 was re-verified
fresh: `git fetch origin main` clean, `mcp__github__list_pull_requests`
(state=open) returned `[]`, and `PROGRESS.md`'s Open PR row read "None" with
"Next: Feature 09 (Medical screening, PHI)" — matching the prompt's own
pre-check. No PR to tend; proceeded to this feature.

**Backend:** `endpoints/medical_screening.py` (431 L, 14 routes),
`services/medical_screening_service.py` (606 L), `models/medical_screening.py`
(216 L), `schemas/medical_screening.py` (256 L), `mcp/tools/medical.py`
(191 L, 2 tools) — read in full, byte-for-byte identical to pass 5's
documented content.
**Frontend:** full `modules/medical-screening/` directory re-read in full
(not assumed unchanged from a diff, given this pass's finding below was
missed by every prior diff-scoped read).
**Migrations:** unchanged since pass 5; `validate_migrations.py --strict`
re-run clean (444 revisions, single head).

### Scope

`git log --oneline b7fa066..origin/main` (pass 5's merge commit) shows 82
commits on `main` since pass 5. `git diff b7fa066..origin/main --stat` against
all five declared backend files and the full `modules/medical-screening/`
frontend directory returns **nothing** — byte-identical. A broader search of
the full diff for `medical_screening`/`ScreeningRecord`/`ScreeningRequirement`
turns up exactly two hits, both outside this feature: a docstring/comment edit
in `membership_pipeline_service.py` (the bulk-advance `unobserved` flag,
"Hold a bulk advance to the meeting-attendance gate", `70affbf`) that
mentions "a screening result" only in prose explaining an unrelated gate, and
a `DEFAULT_STAGE_CONFIGS` comment in `prospective-members/types/index.ts`
unrelated to medical screening. Neither touches
`try_advance_pipeline_stage`/`try_auto_advance_current_step`, the feature's
one integration point (confirmed directly: no diff hunk in either commit
mentions either function name). Dependency files re-checked for drift since
pass 5: `app/utils/org_scoping.py`, `app/utils/model_updates.py`,
`app/core/permissions.py`, `frontend/src/utils/apiCache.ts`,
`app/mcp/redaction.py` — no diff against any of them.

Rather than treat the empty diff as license to skip re-reading (this
rotation's established discipline — see pass 3–5's own notes), all five
backend files and the entire frontend module were read in full this pass.
The frontend re-read is what surfaced MS-13 below: every prior pass since
pass 1 scoped its frontend read to the routes/store/API-shape level, or to
the specific component a fix touched (pass 4: `MedicalScreeningPage.tsx`'s
new tabs; this pass 5: nothing, diff was accessibility-only) — no pass had
read `ScreeningRecordForm.tsx`'s actual field list against what
`ScreeningRecordCreate` accepts since pass 3, and pass 3's own frontend read
predates `docs/KNOWN_LIMITATIONS.md`'s 2026-08-08 "Add Record Form Attaches
to Nobody" entry only in the sense that neither cross-referenced the other —
the KNOWN_LIMITATIONS entry existed the whole time, filed under app-review,
and no security-review pass's "prior art" step (CHECKLIST.md Step 2) had
pulled it in because it carries no `MS-*` id and wasn't in
`docs/app-review/medical-screening.md`, the doc pass 1 explicitly consulted.

### Re-verified good ✅ (unchanged from pass 5, re-confirmed against current code)

- No baseline grant for either permission — `app/core/permissions.py:269,274`
  still the only references.
- Tenant isolation intact throughout: every by-id getter filters
  `organization_id`; `create_record`'s three client-supplied FKs still route
  through `assert_in_org(..., allow_none=True)`.
- PHI encryption at rest intact — `provider_name`/`result_summary`/`notes`
  (`EncryptedText`), `result_data` (`EncryptedJSON`).
- `SET NULL` FKs (`requirement_id`, `reviewed_by`) both `nullable=True`.
- Update schemas still omit every tenancy/subject FK field.
- `apply_updates` (MS-5) and the audit-id fields on `*_created` events (MS-8)
  both still present and unchanged.
- No CSV/spreadsheet export; no raw exception reaches the client (both
  `create_record`/`update_record`/`update_requirement` still wrap in
  `except ValueError as exc: raise HTTPException(400, safe_error_detail(exc))`).
- No unbounded in-memory cache/tracker; no JSON-column shallow-copy mutation
  risk (re-traced both `create_*`/`update_*` write paths on
  `applies_to_roles`/`result_data` directly, same conclusion as every prior
  pass).
- Audit logging present on all six writes, absent on the five PHI-bearing
  reads (MS-12, still flagged, unchanged — see below).
- `mcp/tools/medical.py`'s explicit-projection discipline (MS-11's subject)
  still holds: neither tool's return dict includes `notes`/`result_summary`/
  `provider_name`/`result_data` or the record's raw `status`; the corrected
  module docstring from MS-11 is unchanged.
- Cache exclusion (`/medical-screening/`, `/admin-hub/`) and the route/module
  gate (`requiredPermission="medical_screening.view"` +
  `requiredModule="medical_screening"` on the one frontend route,
  `require_permission(...)` independently on all 14 backend routes) both
  re-confirmed against the current files.

### New this pass

### MS-13 — MED (data integrity / availability, PHI-adjacent) — The "Add Record" dialog has no control for `user_id` or `prospect_id`, so every UI-created screening record is orphaned — 🚩 FLAGGED (interim honesty notice ✅ FIXED; ✅ fully fixed 2026-10-05, see "Owner decisions" at the top)

**What:** `ScreeningRecordForm.tsx`'s create-mode payload
(`handleSubmit`, the `else` branch) builds a `ScreeningRecordCreate` from nine
fields — `screening_type`, `status`, `requirement_id`, three dates,
`provider_name`, `result_summary`, `notes` — and never sets `user_id` or
`prospect_id`. Neither field has a form control anywhere in the component:
there is no member dropdown, no prospect field, nothing. `MedicalScreeningPage.tsx`
is the form's only caller (`grep -rln "ScreeningRecordForm"
frontend/src --include="*.tsx"` returns exactly those two files) and no other
entry point pre-fills either id — `grep -rln "createRecord\b" frontend/src`
turns up only this module's own store/page and an unrelated
`trainingServices.ts` hit. Every record the "Add Record" button creates
therefore has both fields `undefined`, forever.
**Where:** `frontend/src/modules/medical-screening/components/ScreeningRecordForm.tsx`
(no `user_id`/`prospect_id` state or control at all, prior to this pass's fix
below); `pages/MedicalScreeningPage.tsx` (the only caller, passes the payload
straight through with no enrichment).
**Failure scenario:** an officer holding `medical_screening.manage` clicks
"Add Record" on the Records tab, fills in a real physical exam's date,
provider and result, and clicks Create. The write succeeds — the row exists,
is audit-logged, encrypted at rest like any other — but `user_id` and
`prospect_id` are both `NULL`. `get_compliance_status`/`get_my_compliance_summary`
key every match on `screening_type` **and** `r.user_id == user_id` /
`r.prospect_id == prospect_id` (`medical_screening_service.py:341-344,
list_records`'s own `user_id`/`prospect_id` filters): a record with neither
set can never be `matching_records` for anyone, so the member it was actually
about keeps reading as non-compliant. `admin_hub_service.py` labels an
unresolved medical-screening lapse `severity="critical"`, "blocks duty
assignment" — so a firefighter who completed a real, documented physical
exam can still be flagged and blocked, with the officer who entered it having
no indication anything went wrong (`record.user_name ?? record.prospect_name
?? 'Unknown'` on the Records tab is the only visible symptom, and it reads as
a display quirk, not a compliance-breaking one).
**Impact:** not an access-control or cross-tenant gap — `.manage` is not
baseline-granted, the write is org-scoped and audit-logged the same as every
other write on this feature — a correctness/availability defect on the
primary write path of a fitness-for-duty compliance system. Rated MED rather
than HIGH because nothing crashes, no data is exposed, and the record is
still there (recoverable by an admin re-entering it with an id, or, per the
existing KNOWN_LIMITATIONS entry, by posting directly to the API) — but it is
not an edge case: it is the default and only outcome of the UI's one write
path for records, which is why `docs/training/13-medical-screening.md`'s own
walkthrough already documents a "member dropdown" that does not exist.
**Why not previously found by security review:** filed under app-review
(`docs/KNOWN_LIMITATIONS.md`, dated 2026-08-08, predating security-review
pass 1) with no `MS-*` id, so `docs/app-review/medical-screening.md` — the
doc pass 1's Step 2 explicitly consulted — never carried it, and no pass
since read `ScreeningRecordForm.tsx`'s field list against the schema closely
enough to independently rediscover it (pass 3's "full module" read predates
detailed per-field scrutiny; pass 4 touched the file for MS-10's edit-path
fix without auditing the create branch's field set; pass 5's frontend diff
was accessibility-only, so the file wasn't re-read at all).
**Fix (interim, applied this pass):** wiring an actual member/prospect
picker is a real feature addition — it needs a new data source (this
module's store has no members/prospects list today; reusing
`MemberPickerModal` would pull in an inventory-scoped endpoint and response
shape (`MemberInventorySummary`) built for a different permission and data
model, and covers members only, not prospects), and a decision on whether
both, either, or neither id may be set — which is the same open question as
the separately-tracked "`create_record` doesn't enforce exactly-one-of
`user_id`/`prospect_id`" gap below. That is a product decision, not a
same-day fix, and is **flagged**, not implemented, consistent with how this
feature's MS-7 and MS-9 handled equivalently-shaped gaps. What was fixed:
the create dialog now shows an amber notice — the same "not enforced yet"
idiom `ScreeningRequirementForm.tsx` already uses for its own unwired fields
— stating plainly that the record cannot be attached to anyone from this
form, so a "Record created" success toast can no longer imply the record is
usable. Documentation/UI-honesty only; no payload, schema, or backend
behavior changed. Guarded by
`ScreeningRecordForm.linkageNotice.test.tsx` (2 tests: the notice renders in
create mode, and is absent in edit mode, since `ScreeningRecordUpdate` never
accepts either field so editing can't touch this).
**Mirrored to `docs/KNOWN_LIMITATIONS.md`** — its existing 2026-08-08 entry
("Medical Screening — The Add Record Form Attaches to Nobody") is
re-verified still accurate and now cross-referenced to this finding and its
interim fix, rather than filing a duplicate entry.

### Re-verified open, not re-flagged (unchanged from pass 3/4/5)

- **MS-6 — LOW (scale).** `list_requirements`/`list_records` still run bare
  `.all()`. Unchanged; already in `KNOWN_LIMITATIONS.md`.
- **MS-7 — MED.** `create_record`/`update_record` still place no constraint
  between `current_user` and `data.user_id`; `get_compliance_status` still
  never reads `reviewed_by`. Unchanged; still needs a product decision;
  already in `KNOWN_LIMITATIONS.md`.
- **MS-12 — LOW (audit completeness).** The five PHI-bearing `GET` routes
  still call no `log_audit_event`. Unchanged; already in
  `KNOWN_LIMITATIONS.md`.
- **`create_record` still doesn't enforce exactly-one-of `user_id`/
  `prospect_id`.** Unchanged — and, per MS-13 above, moot for every
  UI-originated record today since neither is ever set at all.
- **`get_compliance_status` still doesn't 404 an unknown subject.**
  Re-confirmed not an enumeration channel.
- **`grace_period_days`/`applies_to_roles` (MS-9) and `frequency_months`
  still unenforced.** The "Not enforced" notices are unchanged and still
  present.

## Schema & migration notes

No migration this pass; no model/schema change. `validate_migrations.py
--strict` re-run clean: 444 revisions, single head, unchanged count from
pass 5.

## Guard tests added

- `frontend/src/modules/medical-screening/components/
ScreeningRecordForm.linkageNotice.test.tsx` (new, MS-13, 2 tests) — the
  create dialog shows the orphaned-record notice; the edit dialog does not.

## Completion gate

| Check                                                                          | Result                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                  | 0 violations (no backend file changed this pass; run as sanity check)                                                            |
| `black --check app/ tests/ alembic/`                                           | clean, 1598 files unchanged                                                                                                      |
| `isort --check-only app/ tests/ alembic/`                                      | clean                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                              | pass — 444 revisions, single head (no migration this pass)                                                                       |
| `pytest tests/ -q -k "medical_screening or medical-screening or grace_period"` | **50 passed, 1 skipped** (pre-existing — optional `py_vapid` dep), 0 failed                                                      |
| `pytest tests/ -q` (full backend suite)                                        | **12612 passed, 21 skipped** (pre-existing/environmental: Docker unavailable, optional dep, opt-in API-contract suite), 0 failed |
| `npm run typecheck` (whole repo, via `tsc-native.mjs`)                         | 0 errors                                                                                                                         |
| `npm run lint` (whole repo, `eslint --max-warnings 10`)                        | exit 0                                                                                                                           |
| `npx vitest run src/modules/medical-screening/`                                | **31 passed** (5 test files, including the 2 new MS-13 guard tests)                                                              |
| `npx vitest run` (whole repo)                                                  | **7591 passed** (534 test files), 0 failed                                                                                       |

---

## Pass 5 (2026-09-14)

**Backend (declared scope, per `PROGRESS.md`'s rotation table row):**
`endpoints/medical_screening.py` (431 L, 14 routes), `services/medical_screening_service.py` (606 L) — read in full, byte-for-byte identical to pass 4's documented content. `models/medical_screening.py` (216 L) and `schemas/medical_screening.py` (256 L) also re-read in full as import dependencies of the two declared files (same discipline as every prior pass) — likewise unchanged.
**Scope addition, this pass:** `backend/app/mcp/tools/medical.py` (191 L, 2 tools) — this rotation's established precedent (see `PROGRESS.md`, Feature 11 pass 4 correction) is that a feature-owned MCP surface belongs to the owning feature's pass, and no prior Feature 09 pass had enumerated it into scope. Read in full this pass, along with its shared infrastructure (`app/mcp/registry.py`, `app/mcp/principal.py`, `app/mcp/redaction.py`, `app/mcp/tools/_common.py`) to the extent needed to verify this feature's two tools, not as a review of the MCP surface generally (which has its own extensive, separately-tracked review history — "Thirtieth review round on the Claude MCP integration" and similar commits).
**Frontend:** not re-read in full this pass — `git diff` since pass 4's merge (`f8fdd1a07`) shows only accessibility/styling changes (`aria-labelledby` on two dialogs, `btn-primary` utility class adoption, a `data-mobile-scroll-region` marker on the tab strip), part of a repo-wide mobile-accessibility sweep, not feature-specific. Confirmed no security-relevant line in that diff (no handler, payload, or permission-check code touched).
**Migrations:** unchanged since pass 4; `validate_migrations.py --strict` re-run clean (444 revisions, single head, no schema change this pass).

### Scope

`git log --oneline f8fdd1a07..origin/main -- <4 backend files>` returns nothing — confirmed no commit touched any of them since pass 4 merged. Rather than treat that as license to skip re-reading, all four files were read in full end to end and compared structurally against pass 4's documented content (route list, permission strings, `assert_in_org`/`apply_updates` call sites, encrypted column list): identical in every respect. Also checked, since a security posture can shift without a diff to the feature's own files: every direct dependency import (`app/utils/org_scoping.py`, `app/utils/model_updates.py`, `app/core/audit.py`, `app/core/permissions.py`) — none changed since pass 4 either. Two onboarding commits landed in this window that touch `app/core/permissions.py` (`92c8cb574`, `fb3ba0279`, both about the **Medical Supplies** inventory module's checkbox-to-permission mapping) — confirmed by direct grep that neither adds `medical_screening.*` to `_MODULE_CHECKBOX_GRANTS`/`_CHECKBOX_CONFERRED_BY`; they are a same-named-sounding but unrelated feature (Feature 23, Medical Supplies/inventory, not Feature 09, Medical Screening/PHI).

Every other consumer of `MedicalScreeningService`/`ScreeningRecord`/`ScreeningRequirement` outside the four declared files was enumerated (`grep -rln` across `backend/app`) and checked for changes since pass 4: `admin_hub_service.py`, `member_anonymization_service.py`, `membership_pipeline_service.py`, `org_template_registry.py`, `data_export_service.py`, `app/mcp/tools/medical.py`. Only `membership_pipeline_service.py` changed in this window — entirely Feature 08 (Membership pipeline) work, already independently re-reviewed end to end in that feature's own pass 5/6 (PR #2555, merged the same day as this pass began); the one integration point on this feature's side, `try_advance_pipeline_stage`'s call into `try_auto_advance_current_step`, is unchanged and was re-confirmed still passing the same three arguments in the same shape.

### Re-verified good ✅ (unchanged from pass 4, re-confirmed against current code, not copied forward)

- No baseline grant for either permission — `app/core/permissions.py` still references `medical_screening.view`/`.manage` nowhere but their own definitions (267–276); the two onboarding commits above don't touch this feature.
- Tenant isolation intact throughout: every by-id getter filters `organization_id`; `create_record`'s three client-supplied FKs still route through `assert_in_org(..., allow_none=True)` before the row is built (CLAUDE.md Pitfall #14a/14c).
- PHI encryption at rest intact — `provider_name`/`result_summary`/`notes` (`EncryptedText`), `result_data` (`EncryptedJSON`).
- `SET NULL` FKs (`requirement_id`, `reviewed_by`) both `nullable=True` (CLAUDE.md Pitfall #2).
- Update schemas still omit every tenancy/subject FK field — no update path can reassign organization, subject, or requirement.
- `apply_updates` (MS-5) and the audit-id fields on `*_created` events (MS-8) both still present and unchanged.
- No CSV/spreadsheet export exists on this feature (`SafeCsvWriter`, CLAUDE.md Pitfall #15, doesn't apply — re-confirmed by the same 14-route inventory).
- No raw exception reaches the client — both `create_record`/`update_record`/`update_requirement` wrap their service call in `except ValueError as exc: raise HTTPException(400, safe_error_detail(exc))`; nothing here raises or lets through an unguarded `Exception`.
- No unbounded in-memory cache/tracker on this feature (CLAUDE.md Pitfall #9 doesn't apply — there is no request-scoped or process-scoped dict here at all, bounded or not).
- No JSON-column shallow-copy mutation risk (CLAUDE.md Pitfall #12): `applies_to_roles` and `result_data` are only ever set from a freshly-deserialized Pydantic value on `create_*` (a brand-new row, nothing to alias) or via `apply_updates`' `setattr` on `update_*` (the incoming dict's value, never a shallow copy of the column's own prior value) — re-traced both write paths directly.
- Audit logging present on every write (six `log_audit_event` calls: requirement/record × created/updated/deleted), absent on reads — unchanged from every prior pass; see "Flagged, not fixed" below for why this pass treats that as accepted rather than a new gap.

### New this pass

**MS-11 — LOW (doc accuracy on a PHI-adjacent surface, first review of `mcp/tools/medical.py`) — ✅ FIXED**

**What:** the module's own docstring claimed "Never a result, a provider or a
note: those columns are encrypted at rest **and on the redaction
denylist**." Checked directly against `app/mcp/redaction.py`'s
`DENIED_FIELDS`: `provider_name`, `result_summary`, and `result_data` are
indeed named there. `notes` is not, and cannot be added the way the other
three were — `grep -n '"notes"' backend/app/mcp/tools/*.py` shows the plain
key `"notes"` is a live, legitimate field in `finance.py`, `meetings.py`,
`scheduling.py`, and `writes.py`; the redaction module works by bare key
name at every depth of the returned value with no source-model context, so
adding `"notes"` to the global denylist would silently strip real content
from four unrelated, non-PHI tools rather than protect this one.
**Where:** `app/mcp/tools/medical.py:1-6` (module docstring).
**Why it's a real, if narrow, gap and not a false alarm:** the redaction
module's own architecture doc names its purpose precisely — "Tools already
project explicit allowlists of fields; this is the second net, so that a
field added to a model or a service response later cannot leak through a
tool nobody remembered to update." That guarantee does not actually extend
to `ScreeningRecord.notes` (PHI, encrypted at rest, the third of the three
fields this file's own docstring names as never-shared) the way the
docstring claimed. **No live leak exists today**: both tools in this file
build their return dicts from explicit, closed field lists —
`get_member_medical_compliance` projects `ComplianceSummary`/
`ComplianceItem` fields, neither of which has a `notes`/`result_summary`/
`provider_name`/`result_data` attribute at all; `list_expiring_screenings`
hand-picks eight named fields off each `ScreeningRecord` row and never
touches `.notes`. `grep -n "notes" app/mcp/tools/medical.py` returns
nothing. The gap is that the _stated_ second-net guarantee for `notes`
specifically does not hold, which is exactly the situation that invites a
future tool addition to this file to trust redaction for a field it does
not actually cover.
**Fix:** corrected the docstring to state the truth — which three fields
are named on the denylist, why `notes` deliberately is not (shared,
legitimate use elsewhere; redaction has no per-tool or per-model scoping
mechanism to add), and what actually keeps `notes` out today (the explicit-
projection discipline both handlers already follow) — with an explicit note
to keep any future addition to this file on the same discipline rather than
relying on the denylist to catch a broader serialization. Documentation-only
change; no runtime behavior, gating, or redaction rule modified.
**Why not a broader fix:** giving the redaction module a per-tool or
per-model-qualified denylist (so `notes` could be denied only when it
originates from `ScreeningRecord`) would be a real architectural capability
add to a shared module used by every other reviewed feature's MCP tools —
out of scope for a same-day fix on a single feature's pass, and not
warranted today since no live leak exists to justify the added complexity.
Left for a future pass if a second PHI-adjacent tool needs the same
guarantee redaction doesn't currently provide.

### MS-12 — LOW (audit completeness, HIPAA §164.312(b)) — PHI reads are not audit-logged, only writes are — 🚩 FLAGGED (✅ fixed 2026-10-05, see "Owner decisions" at the top)

The assignment brief for this pass calls out that "an access log for PHI
views is itself often a compliance requirement" under HIPAA §164.312(b).
Re-confirmed directly: none of the five `GET` routes that can return
PHI-bearing fields (`/records`, `/records/{id}`, `/compliance/{user_id}`,
`/compliance/prospect/{prospect_id}`, `/expiring`) call `log_audit_event` —
only the six write routes do (MS-8 already closed the one gap in _those_
six: the row now always carries its own id). This is unchanged from every
prior pass, which reviewed the same six writes as "audit logging: present"
without separately naming the seven reads as a gap. Considered explicitly
this pass rather than re-confirmed silently:

- **Not a new regression** — this has been the shape of the endpoint file
  since pass 1; nothing shifted it.
- **Not fixed here** — instrumenting five read routes with an audit write is
  a real, deliberate feature addition (a new audit event type per route, a
  volume/retention decision for what could be a high-frequency call —
  `/records` and `/expiring` back the main list views, not just detail
  drill-downs — and a decision on whether a _list_ of N records logs once
  or N times), not a same-day scoped fix, and CLAUDE.md's own guidance is to
  flag rather than guess at that shape of change.
- **Mirrored to `docs/KNOWN_LIMITATIONS.md`** this pass (new entry) so the
  gap has one place a future pass or the application owner can find it,
  rather than staying implicit in four passes' worth of "audit logging
  present" language that was true of writes only.

### Re-verified open, not re-flagged (unchanged from pass 3/4)

- **MS-6 — LOW (scale).** `list_requirements`/`list_records` still run bare
  `.all()`. Unchanged; already in `KNOWN_LIMITATIONS.md`.
- **MS-7 — MED.** `create_record`/`update_record` still place no
  constraint between `current_user` and `data.user_id`; `get_compliance_
status` still never reads `reviewed_by`. Unchanged; still needs a product
  decision; already in `KNOWN_LIMITATIONS.md`.
- **`create_record` still doesn't enforce exactly-one-of `user_id`/
  `prospect_id`.** Unchanged.
- **`get_compliance_status` still doesn't 404 an unknown subject.**
  Re-confirmed not an enumeration channel (identical response shape for a
  nonexistent, out-of-org, and zero-record subject).
- **`grace_period_days`/`applies_to_roles` (MS-9) and `frequency_months`
  (noted, not folded into MS-9) still unenforced.** The "Not enforced"
  notices in `ScreeningRequirementForm.tsx` are unchanged and still present.

## Schema & migration notes

No migration this pass; no model/schema change. `validate_migrations.py
--strict` re-run clean: 444 revisions, single head, unchanged count from
Feature 08 pass 5's merge earlier the same day.

## Guard tests added

None new. MS-11 is a comment-only change with no behavioral surface to pin;
the existing static sweep (`tests/test_mcp_redaction.py::
TestToolModulesNeverProjectDeniedFields::test_module_is_clean`, which globs
every file in `app/mcp/tools/` including `medical.py`) already asserts no
tool module projects a denied field by name, and `test_mcp_tools.py`
already has direct coverage of both `medical.py` tools (`test_medical_
compliance_refuses_an_unknown_member`,
`test_medical_compliance_never_carries_the_record_status`, and the
superseded-record ordering tests around line 4334) confirming neither tool
returns the record's raw `status`/detail fields, only derived compliance
booleans and counts. Re-ran both files clean (see Completion gate).

## Completion gate

| Check                                                                                                                                           | Result                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `black --check app/mcp/tools/medical.py`                                                                                                        | clean                                                                                                                            |
| `flake8 app/mcp/tools/medical.py`                                                                                                               | 0 violations                                                                                                                     |
| `isort --check-only app/mcp/tools/medical.py`                                                                                                   | clean                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                               | pass — 444 revisions, single head (no migration this pass)                                                                       |
| `pytest tests/ -q -k "medical_screening or medical-screening or grace_period"`                                                                  | **50 passed, 1 skipped** (pre-existing — optional `py_vapid` dep), 0 failed                                                      |
| `pytest tests/test_mcp_tools.py tests/test_mcp_redaction.py tests/test_mcp_keys.py tests/test_mcp_key_endpoints.py tests/test_mcp_transport.py` | **274 passed**, 0 failed                                                                                                         |
| `pytest tests/ -q` (full backend suite)                                                                                                         | **12563 passed, 21 skipped** (pre-existing/environmental: Docker unavailable, optional dep, opt-in API-contract suite), 0 failed |

Frontend gates not run this pass — no frontend file touched (the diff since
pass 4 is a repo-wide accessibility sweep, reviewed and confirmed not
security-relevant, not a change made by this pass).

---

## Pass 4 (2026-09-08)

**Backend:** `endpoints/medical_screening.py` (430 L, 14 routes), `services/medical_screening_service.py` (605 L), `models/medical_screening.py` (215 L), `schemas/medical_screening.py` (255 L) — read in full, byte-for-byte structural match to pass 3's documented fixed state (MS-5/MS-3/MS-8's `apply_updates`/`assert_in_org`/audit-id fixes all present and unchanged)
**Frontend:** full `modules/medical-screening/` directory, including two files added since pass 3 (`MedicalScreeningPage.banner.test.tsx`, `MedicalScreeningPage.tab.test.tsx`) and a real UI change to `MedicalScreeningPage.tsx` (tabs became URL-addressable via `?tab=`, matching the 2026-09-05 CLAUDE.md convention for settings-style tab screens) — not present in pass 3's byte-identical diff
**Migrations:** `20260313_0101_create_medical_screening_tables.py`, `20260707_0001_lowercase_screening_and_shift_enums.py`, `20260810_0001_encrypt_medical_screening_phi.py` — re-verified, none new this pass

### Scope

The repo's `git log` for these paths returns a single squash/orphan merge
commit (`b267ee1`, no resolvable parent) — the same git-history unreliability
prior passes have hit (see pass 1's note on MP-08). Rather than trust it, all
four backend files were read in full and compared structurally against pass
3's documented content: identical. The frontend module was re-read in full
rather than assumed unchanged, since pass 3's byte-identical claim was against
pass 2's merge commit, not this session's `HEAD` — and it was not unchanged:
`MedicalScreeningPage.tsx` gained URL-addressable tabs (a UX change, reviewed
below and found not security-relevant), plus two new test files. Every other
frontend file (`routes.tsx`, `services/api.ts`,
`store/medicalScreeningStore.ts`, `ComplianceDashboard.tsx`) is unchanged.

Worked the full seven-dimension checklist directly rather than re-deriving
pass 1-3's conclusions: enumerated all 14 routes and re-confirmed each one's
auth dependency/permission string (unchanged from the pass 3 table); re-traced
every by-id query and `create_record`'s FK validation for org-scoping;
re-confirmed no baseline `medical_screening.view`/`.manage` grant in
`app/core/permissions.py` or any `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS`
entry; re-confirmed PHI encryption (`EncryptedText`/`EncryptedJSON`) intact on
all four columns; re-confirmed the frontend cache exclusion
(`UNCACHEABLE_PREFIXES`) and the backend module gate; re-read
`admin_hub_service.py`'s medical-screening resolvers (still org-scoped,
aggregate-only, no PHI in the surfaced text).

### Route inventory

Unchanged from pass 1/3 — re-confirmed directly against the current file, not
copied forward. See pass 3's table above for the full 14-route list; nothing
added, removed, or re-permissioned.

### Verified good ✅ (re-confirmed, not re-derived)

- No baseline grant for either permission (`app/core/permissions.py:267-276`
  is the only reference in the backend).
- Tenant isolation holds throughout: every by-id getter filters
  `organization_id`; `create_record`'s three client-supplied FKs
  (`user_id`, `prospect_id`, `requirement_id`) still go through
  `assert_in_org(..., allow_none=True)` before the row is built.
- PHI encryption at rest genuinely intact — `provider_name`, `result_summary`,
  `notes` (`EncryptedText`), `result_data` (`EncryptedJSON`).
- `SET NULL` FKs (`requirement_id`, `reviewed_by`) are both `nullable=True`.
- Update schemas (`ScreeningRecordUpdate`/`ScreeningRequirementUpdate`) still
  omit every tenancy/subject FK field, so no update path can reassign
  organization, subject, or requirement.
- No SQL injection surface, no CSV export, no unescaped HTML/output.
- Cache exclusion (`/medical-screening/`, `/admin-hub/`) and the module gate
  (`module_gate("medical_screening", ...)` on the router, independently
  backed by every route's own `get_current_user`/`require_permission`) both
  re-confirmed against the current files.
- `admin_hub_service.py`'s medical-screening resolvers (`_members_screening_
current`, `_members_attention`'s expired/overdue blocks) filter
  `organization_id` on every query and surface only aggregate counts/generic
  titles, never a member name or screening detail.
- The new URL-addressable tabs on `MedicalScreeningPage.tsx` are UI-only —
  no new endpoint, no new data exposed in the URL beyond which of the three
  already-permission-gated tabs is open (`?tab=requirements|records|
compliance`), matching the pattern already reviewed and accepted for the
  Organization/Events settings screens.

### Findings

### MS-10 — MED (PHI integrity) — Clearing a screening record's provider name, result summary, or notes field did not persist — ✅ FIXED

**What:** `ScreeningRecordForm.tsx` and `ScreeningRequirementForm.tsx` built
one payload shape for both the create and the edit submission, using the
create-path idiom (`value.trim() || undefined`) unconditionally. That idiom
is correct on create — CLAUDE.md pitfall #1 — and wrong on edit: the backend
dumps update payloads with `exclude_unset` (`ScreeningRecordUpdate`/
`ScreeningRequirementUpdate` via `data.model_dump(exclude_unset=True)` in
`medical_screening_service.py:115,245`), so a key that never leaves the
browser as JSON (which is what `undefined` produces) means "leave this alone,"
not "clear it." An officer who blanked `provider_name`, `result_summary`, or
`notes` on an existing screening record — three PHI-bearing `EncryptedText`
columns — to correct or remove entered information got a "Record updated"
success toast while the old value stayed in the database. The same shape hit
`ScreeningRecordUpdate`'s three date fields, and on the requirement form,
`description`, `applies_to_roles`, and — because the "One-time requirement"
checkbox is exactly this pattern with an extra layer — `frequency_months`:
unchecking "recurring" on an already-recurring requirement sent
`frequency_months: undefined` rather than clearing it, so the stored value
silently survived the toggle.
**Where:** `frontend/src/modules/medical-screening/components/
ScreeningRecordForm.tsx` (`handleSubmit`, edit branch); `.../
ScreeningRequirementForm.tsx` (`handleSubmit`, single unbranched payload).
**Failure scenario:** a `medical_screening.manage` holder edits a screening
record to remove a `result_summary` entered in error (which may itself be
misattributed PHI — e.g. copy-pasted onto the wrong member's record) or a
`notes` field, sees the field go blank in the form and a success toast, closes
the modal — and the PHI is still there, readable by anyone who next opens
that record, with nothing in the UI indicating the clear didn't take.
**Impact:** not a new access-control gap (only existing `.manage` holders
reach this path, same population as every other write on this feature) — a
correctness/data-integrity defect on a PHI write path where the failure mode
is silent persistence of information staff believed they had removed.
**Fix:** both forms now branch their payload construction on whether they are
editing (`record`/`requirement` is non-null): the edit branch sends an
explicit `null` for a blanked optional field (`blankToNull` from
`utils/formValues.ts`, or a plain `value || null` for date/array fields — the
same file's `formCoercions` helper wasn't reusable verbatim here because the
Create and Update TypeScript interfaces are declared separately in this
module, and `formCoercions`'s return type is the union of both branches);
the create branch is untouched, still `|| undefined`. `ScreeningRecordUpdate`
and `ScreeningRequirementUpdate` widened to accept `| null` on the affected
fields (matching CLAUDE.md's `exactOptionalPropertyTypes` guidance: widen the
target type rather than cast) — `screening_type`/`status`/`name`/
`is_active`/`grace_period_days` were not touched, either because they are
NOT NULL columns `apply_updates` would reject a null for, or because the UI
control (a `<select>`/checkbox/number-with-fallback) can never actually
produce a blank in the first place. Guarded by
`ScreeningFormClearGuards.test.tsx` (6 tests: edit sends null for each
affected field, an untouched value round-trips unchanged, create still omits
rather than nulls), confirmed to fail on exactly the 3 edit-path assertions
pre-fix via `git stash` (`toBeNull()` receiving `undefined`).

### Re-verified open, not re-flagged (unchanged from pass 3)

- **MS-6 — LOW (scale) — Unbounded requirement/record lists.** Re-confirmed:
  `list_requirements`/`list_records` still run bare `.all()`. Already in
  `KNOWN_LIMITATIONS.md`.
- **MS-7 — MED — No reviewer distinct from the subject or the creator.**
  Re-confirmed: `create_record`/`update_record` still place no constraint
  between `current_user` and `data.user_id`; `get_compliance_status` still
  never reads `reviewed_by`. Still needs a product decision (see pass 3's
  writeup); already in `KNOWN_LIMITATIONS.md`.
- **`create_record` still doesn't enforce exactly-one-of `user_id`/
  `prospect_id`.** Unchanged.
- **`get_compliance_status` still doesn't 404 an unknown subject.**
  Re-confirmed not an enumeration channel.
- **`grace_period_days`/`applies_to_roles` are still unenforced (MS-9).** The
  "Not enforced" notices in `ScreeningRequirementForm.tsx` are unchanged and
  still present. Noted in passing while fixing MS-10: `frequency_months` is
  in the same position — written in `create_requirement` and read nowhere in
  `get_compliance_status` or anywhere else in the backend
  (`grep -rn frequency_months backend/app/` returns only the write site and
  the two schema/model declarations) — but this pass does not add it to MS-9
  or its guard test's AST sweep, since MS-9's own scope and guard test were
  written and reviewed against exactly two named fields; widening that
  finding is a separate, deliberate edit for a future pass rather than a
  drive-by expansion of someone else's finding while fixing an unrelated bug.

## Schema & migration notes

No migration this pass. No model/schema change — MS-10 is a frontend-only fix;
the backend's `ScreeningRecordUpdate`/`ScreeningRequirementUpdate` schemas
already accepted `null` on every affected field (that's what made the frontend
omission the bug — the backend was always ready to clear on an explicit null).

## Guard tests added

- `frontend/src/modules/medical-screening/components/
ScreeningFormClearGuards.test.tsx` (new, MS-10, 6 tests) — component-level:
  renders each form in edit mode, blanks the affected fields, asserts the
  `onSave` payload carries explicit `null`s (not `undefined`, not omitted);
  a second test per form confirms an untouched value round-trips unchanged;
  a third confirms the create path still omits rather than nulls. Confirmed
  to fail (3 of 6) against the pre-fix code via `git stash`.

## Completion gate

| Check                                                                          | Result                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                  | n/a — no backend file changed this pass                                                                                          |
| `black --check app/ tests/ alembic/`                                           | n/a — no backend file changed this pass                                                                                          |
| `isort --check-only app/ tests/ alembic/`                                      | n/a — no backend file changed this pass                                                                                          |
| `python3 scripts/validate_migrations.py --strict`                              | not re-run — no migration touched this pass (last clean run: pass 3, 410 revisions, single head)                                 |
| `pytest tests/ -q -k "medical_screening or medical-screening or grace_period"` | **50 passed, 1 skipped** (pre-existing — optional `py_vapid` dep), 0 failed                                                      |
| `pytest tests/ -q` (full backend suite, sanity check)                          | **11855 passed, 21 skipped** (pre-existing/environmental: Docker unavailable, optional dep, opt-in API-contract suite), 0 failed |
| `npx tsc --noEmit` (whole repo)                                                | 0 errors                                                                                                                         |
| `npx eslint .` (whole repo)                                                    | 0 errors, 2 pre-existing warnings in an unrelated file (`CallTypeChips.tsx`), well under max-warnings-10                         |
| `npx vitest run src/modules/medical-screening/`                                | **29 passed** (4 test files, including the 6 new guard tests)                                                                    |

No backend file was touched this pass, so the backend linters/migration
validator were not run (nothing for them to check) — the scoped and full
backend suites were still run as a sanity check on the read-only re-review
above and came back clean. Frontend gates were run in full because this pass
touched three frontend files plus added a fourth.

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

### MS-7 — MED — No reviewer distinct from the subject or the creator on screening records — 🚩 FLAGGED (✅ allow-but-flag fixed 2026-10-05, see "Owner decisions" at the top)

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

### MS-6 — LOW (scale, unchanged) — Unbounded requirement/record lists — 🚩 FLAGGED, re-confirmed and mirrored (✅ fixed 2026-10-05, see "Owner decisions" at the top)

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
