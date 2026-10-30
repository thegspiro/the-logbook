# Security Review 19 — Skills Testing

**Prefix:** `SKT` · **Iteration:** 19 · **Reviewed:** 2026-10-19 (pass 9) ·
**PR:** see `PROGRESS.md`'s **Open PR** row

**Backend:** `app/api/v1/endpoints/skills_testing.py` (29 routes, 3,723 L — grown
2.6x from 1,412 L at the last module-audit pass), `app/services/skills_testing_service.py`
(1,207 L)
**Frontend:** `frontend/src/modules/training/` (skills-testing UI; not reviewed
this pass — endpoint + service only, per rotation scope)
**Migrations:** none touched this iteration

---

## Scope

Read in full, via two parallel background agents split across the endpoint
file (lines 1–1900, lines 1850–3723) and one agent for the full service file.
Compliance officer / compliance config (`compliance_officer.py`,
`compliance_config.py`) are **feature 20**, not this one, and are out of scope
here even though `skills_testing.py` shares some officer-recognition helpers
with them.

Prior context read first: `docs/module-audit/compliance-skills.md` (iteration
22, when the endpoint file was 1,412 L) and `docs/app-review/compliance-skills.md`
(4 passes: CS-1 through CS-11, CS2-1, CS-10). Both are carried forward, not
re-derived — see "Verified good" below for what was re-confirmed intact.

## Route inventory

All 29 routes carry either `Depends(get_current_user)` (open to any
authenticated member — examining is deliberately open to the whole
department) or `Depends(require_permission("training.manage"))` (officer-only
actions), with one exception noted below. Every query reviewed filters
`organization_id`.

| Method | Path                                 | Auth dependency    | Permission                                          | Org-scoped |
| ------ | ------------------------------------ | ------------------ | --------------------------------------------------- | ---------- |
| GET    | `/templates`                         | `get_current_user` | –                                                   | ✅         |
| POST   | `/templates`                         | –                  | `training.manage`                                   | ✅         |
| GET    | `/library`                           | –                  | `training.manage`                                   | ✅         |
| POST   | `/library/{slug}/import`             | –                  | `training.manage`                                   | ✅         |
| GET    | `/templates/{template_id}`           | `get_current_user` | –                                                   | ✅         |
| PUT    | `/templates/{template_id}`           | –                  | `training.manage`                                   | ✅         |
| DELETE | `/templates/{template_id}`           | –                  | `training.manage`                                   | ✅         |
| POST   | `/templates/{template_id}/publish`   | –                  | `training.manage`                                   | ✅         |
| POST   | `/templates/{template_id}/duplicate` | –                  | `training.manage`                                   | ✅         |
| GET    | `/candidates`                        | –                  | `training.view` OR `training.manage`                | ✅         |
| GET    | `/tests`                             | `get_current_user` | – (two-pass disclosure filter in-body)              | ✅         |
| POST   | `/tests`                             | `get_current_user` | – (SoD on create — CS-8)                            | ✅         |
| GET    | `/tests/{test_id}`                   | `get_current_user` | – (disclosure-gated in-body)                        | ✅         |
| PUT    | `/tests/{test_id}`                   | `get_current_user` | – (`_authorize_test_write`)                         | ✅         |
| POST   | `/tests/{test_id}/complete`          | `get_current_user` | – (`_authorize_test_write`)                         | ✅         |
| DELETE | `/tests/{test_id}`                   | –                  | `training.manage`                                   | ✅         |
| DELETE | `/tests/{test_id}/discard`           | `get_current_user` | – (own practice test only)                          | ✅         |
| POST   | `/tests/{test_id}/validate`          | –                  | `training.manage` (+ SoD, CS-8)                     | ✅         |
| POST   | `/tests/bulk-validate`               | –                  | `training.manage` (delegates to single)             | ✅         |
| POST   | `/tests/{test_id}/release`           | –                  | `training.manage`                                   | ✅         |
| GET    | `/tests/{test_id}/viewers`           | –                  | `training.manage`                                   | ✅         |
| POST   | `/tests/{test_id}/viewers`           | –                  | `training.manage`                                   | ✅         |
| DELETE | `/tests/{test_id}/viewers/{user_id}` | –                  | `training.manage`                                   | ✅         |
| POST   | `/tests/{test_id}/cancel`            | `get_current_user` | – (`_authorize_test_write`)                         | ✅         |
| POST   | `/tests/{test_id}/void`              | –                  | `training.manage` (+ **new** SoD, SKT-2)            | ✅         |
| POST   | `/tests/{test_id}/return`            | –                  | `training.manage` (+ **new** SoD, SKT-3)            | ✅         |
| POST   | `/tests/{test_id}/email-results`     | –                  | `training.manage`                                   | ✅         |
| GET    | `/tests/export/csv`                  | –                  | `training.manage`                                   | ✅         |
| GET    | `/summary`                           | `get_current_user` | – (org-wide stats; small-cohort disclosure, SKT4-3) | ⚠️         |

## Verified good ✅

Re-confirmed from the prior module-audit/app-review passes, against the
current 3,723-line file — these had drifted in line number but not in
substance:

- **CS-1** — a non-officer's `GET /tests` and `GET /tests/{id}` are confined to
  tests they are party to (candidate, examiner) or have an explicit viewer
  grant (`SkillTestViewer`), via the two-pass disclosure filter in
  `list_tests`/`get_test`.
- **CS-2** — template visibility (`all_members` / `officers_only` /
  `assigned_only`) is enforced in `list_templates`/`get_template`, not just in
  the frontend.
- **CS-8 / CS-10** — examiner ≠ candidate is enforced via
  `assert_different_person` on **both** `create_test` (line ~1292) and
  `validate_test` (line ~2031), and the self-check runs before the
  `training.manage` short-circuit would otherwise let an officer bypass it —
  confirmed the check fires regardless of caller's role.
- **Pitfall #25 (LIKE escaping)** — `search_candidates` builds its pattern with
  `like_pattern()` and passes `escape=LIKE_ESCAPE_CHAR` (line 964); a `%` or
  `_` in a search fragment does not widen the match.
- **Pitfall #15 (CSV injection)** — `export_tests_csv` uses `SafeCsvWriter`
  (line 3328), not raw `csv.writer`.
- **`_lock_test_for_transition`** — `validate`, `void`, and `return` all read
  the target row through a single `SELECT ... FOR UPDATE` helper before
  checking status, so two officers working the same review queue serialize
  onto the correct post-transition state instead of both passing a
  status-guard against a stale read.

Surface identified as **genuinely new since the last audit pass** (grown from
1,412 L to 3,723 L) and out of scope to fully re-derive this iteration, but
worth naming so it isn't silently skipped by a future pass assuming
"skills testing" means what it did at 1,412 L: the peer-examined submit/review
workflow (`complete_test` two-tier authority, `_authorize_test_write`), result
disclosure/release (`ResultDisclosure`, `ResultRelease`, `/release`,
`redact_test_for_view`), per-test viewer grants (`/viewers` endpoints),
`/cancel` and `/discard` (two distinct abandon paths), `/email-results`,
`/tests/export/csv`, and `/summary`'s org-wide aggregate stats. These were read
in full as part of this pass's line-by-line review (hence the findings below)
but do not each carry a dedicated "Verified good" line — no defect was found
in them beyond the four reported.

## Findings

### SKT-1 — MED — `update_template` used a blind `setattr` loop, no NOT-NULL guard — ✅ FIXED

**What:** `update_template` applied `SkillTemplateUpdate.model_dump(exclude_unset=True)`
with `for field, value in update_data.items(): setattr(template, field, value)`.
`SkillTemplateUpdate` declares `name`, `sections`, and `score_pass_fail_criteria`
as `Optional`, but the `SkillTemplate` model has all three `nullable=False`.
**Where:** `app/api/v1/endpoints/skills_testing.py:653` (was; now routed
through `apply_updates`).
**Failure scenario:** a client sends `PUT /templates/{id}` with
`{"name": null}` (or `sections`/`score_pass_fail_criteria`). The loop sets the
attribute, `db.commit()` flushes, MySQL rejects the NOT NULL write, and the
unhandled `IntegrityError` surfaces as a raw 500 with no clean error to the
caller — Pitfall #1/#4 in `CLAUDE.md`.
**Impact:** low severity (requires `training.manage`, and no data is actually
lost — the transaction rolls back) but a genuine unhandled-exception path that
leaks a stack trace shape to an officer-level caller and gives no actionable 400.
**Fix:** replaced the loop with `apply_updates(template, update_data)` inside a
`try/except ValueError` that raises a clean
`HTTPException(400, safe_error_detail(e))`, matching the established pattern
(`FacilitiesService`, FAC-7). Guard test:
`tests/test_skill_template_update_guard.py`.

### SKT-2 — HIGH — `void_test` had no separation-of-duties check — ✅ FIXED

**What:** `void_test` let any caller holding `training.manage` void any test,
including their own, with no check against `test.candidate_id`.
**Where:** `app/api/v1/endpoints/skills_testing.py:2616` (`void_test`).
**Failure scenario:** an officer-candidate (a training officer who is
themself being tested, or an examiner promoted to officer mid-cycle) fails a
skills test, then calls `POST /tests/{their_own_test_id}/void` with any
10+ character reason. The unfavorable result drops out of pass-rate and
average-score totals and off their record, with no second person involved —
exactly the risk `create_test` and `validate_test` already block under CS-8,
left open on the rejection-side sibling endpoint.
**Impact:** an officer can erase their own unfavorable official result
unilaterally. Same class as CS-8/FIN-4/AH-4/TR-5 in
`app/services/separation_of_duties.py`'s docstring — a fourth-then-fifth path
through the same gap.
**Fix:** added `assert_different_person(current_user.id, test.candidate_id,
action="void", record="skills test")` immediately after the "already voided"
guard and before any mutation. `SeparationOfDutiesError` → `HTTPException(400,
...)`, matching the sibling checks' pattern exactly. Guard test:
`TestVoidSelfDealingGuard` in `tests/test_skills_test_void.py`.

### SKT-3 — HIGH — `return_test_for_correction` had no separation-of-duties check — ✅ FIXED

**What:** Same gap as SKT-2, on the third exit from a pending submission.
**Where:** `app/api/v1/endpoints/skills_testing.py:2764`
(`return_test_for_correction`).
**Failure scenario:** an officer-candidate whose own submitted result is
unfavorable (but not yet validated) calls `POST
/tests/{their_own_test_id}/return` repeatedly. Each call reopens the test to
`in_progress` with `return_count` incremented but **no attempt spent** — the
cap in `assert_attempts_remaining` only counts _validated_ tests — so the
officer can force unlimited redo cycles on their own submission until a
result they like is finally validated, with the officer as both the person
re-scoring it (as examiner-of-record via re-completion) and the eventual
validator.
**Impact:** unlimited self-directed retries with no attempt cost and no
second person, undermining both the attempt cap and the validation control at
once.
**Fix:** added the identical `assert_different_person(..., action="return",
record="skills test")` check, placed after the "already validated" guard and
before the status mutation begins. Guard test:
`test_an_officer_may_not_return_their_own_submission` in
`tests/test_skill_test_return.py`.

### SKT-4 — HIGH — `assert_attempts_remaining` read-then-write with no row lock (Pitfall #27) — ✅ FIXED

**What:** the `max_attempts` cap counted validated `SkillTest` rows with a
plain `SELECT`, then let the caller proceed to validate (which credits the
requirement) with no lock serializing the read against a concurrent
validation of a different test for the same candidate+requirement.
**Where:** `app/services/skills_testing_service.py:576` (`assert_attempts_remaining`).
**Failure scenario:** a candidate capped at 2 attempts has 1 already validated
and 2 pending (member-run, awaiting sign-off). Two officers each open a
different pending test and hit "Validate" within the same instant. Both
transactions read `spent = 1` (still under the cap of 2), both pass the guard,
both validate — the candidate ends up with 3 validated attempts against a cap
of 2, and (if either was a pass credited late) a pipeline requirement marked
complete on a test run that should have been refused. This is the same shape
of bug documented for shift/event capacity in `CLAUDE.md` Pitfall #27,
independently corroborated by all three review agents on this pass.
**Impact:** an enforced-looking cap that races under real officer-queue usage
(bulk-validate makes concurrent validation calls the normal case, not a rare
one, per `_lock_test_for_transition`'s own docstring).
**Fix:** two changes, per Pitfall #27's "both halves are required" rule:
(1) added a lock-acquisition query, before either existing read, on the one
row guaranteed to exist for every capped test; (2) added
`.with_for_update(of=SkillTest)` to the existing `spent` count query itself,
since acquiring a lock elsewhere does not refresh an already-open
REPEATABLE-READ snapshot — a plain `SELECT` after the lock could still answer
from before the other transaction committed.

**Revised after Codex review** (two comments on the initial version of this
fix, both correct): the lock was originally acquired on the candidate's
`RequirementProgress` row, mirroring `training_program_service`'s existing
pattern for the same class of race. Codex found that pattern doesn't
transfer here — **(P1)** a `RequirementProgress` row only exists once the
candidate has an _active enrollment_, which nothing on the
link-a-requirement-to-a-test path requires (`_validate_requirement_link`
only checks the requirement belongs to the organization), so the lock could
silently lock nothing at all; **(P2)** `validate_test` locks the specific
`SkillTest` row being validated (`_lock_test_for_transition`) _before_
calling into the capacity check, so two officers validating different
pending tests for the same candidate+requirement could each hold their own
test row locked and then deadlock waiting on the capacity lock in the
opposite order — the `spent` count's own locking scan touches every test row
for that candidate+requirement, including whichever one the other
transaction is holding.

Fixed by locking `TrainingRequirement` instead (the row `assert_attempts_remaining`
already fetches first, and the one guaranteed to exist for every
`requirement_id` that reaches this point — extracted into a small
`lock_attempt_capacity` helper), and by having `validate_test` acquire that
lock via a non-locking peek at the test's `requirement_id` _before_ it locks
the test row — fixing the lock ordering, not just the lock target. Guard
tests: `TestCapacityLocking` in `tests/test_skill_test_attempt_limit.py`, asserting
both the lock query and the count query render `FOR UPDATE` against the
correct tables, and `tests/test_skill_test_validate_locking.py`, asserting
`validate_test` acquires the capacity lock before the per-test row lock (and
skips it entirely when the peek finds no linked requirement).

## Schema & migration notes

n/a — no model or migration changes this iteration.

## Guard tests added

- `tests/test_skill_template_update_guard.py` (new file) — `apply_updates`
  rejects an explicit null against `name`, `sections`, and
  `score_pass_fail_criteria` (NOT NULL columns); a nullable column
  (`description`) still clears; `update_template`'s source is inspected to
  assert it routes through `apply_updates` and does not regress to a
  hand-rolled `setattr` loop.
- `tests/test_skills_test_void.py::TestVoidSelfDealingGuard` — an officer
  whose id matches the test's `candidate_id` gets a 400 from `void_test`,
  never reaching the mutation.
- `tests/test_skill_test_return.py::TestGuards::test_an_officer_may_not_return_their_own_submission` —
  same assertion for `return_test_for_correction`.
- `tests/test_skill_test_attempt_limit.py::TestCapacityLocking` — asserts the
  `TrainingRequirement` lock query and the `SkillTest` spent-count query both
  compile with `FOR UPDATE` against the expected table, so a future edit that
  drops either half of the fix fails loudly rather than silently
  reintroducing the race.
- `tests/test_skill_test_validate_locking.py` (new file) — asserts
  `validate_test` acquires the capacity lock (via a non-locking peek at the
  test's `requirement_id`) before it locks the specific test row, and that it
  skips the capacity lock entirely when the peek finds no linked
  requirement. Guards against the lock-ordering deadlock Codex flagged
  (P2) reintroducing.
- Existing tests in `test_skill_test_attempt_limit.py` and
  `test_skill_test_validation.py` updated twice: once to account for the
  original fix's extra lock-acquisition `db.execute()` call, then again
  after the Codex-review revision collapsed that into the existing
  requirement fetch (mock result-queue reordering, not a behavior change to
  those tests' own assertions).

## Completion gate

| Check                                             | Result                         |
| ------------------------------------------------- | ------------------------------ |
| `flake8` (changed files)                          | clean                          |
| `black --check` (changed files)                   | clean                          |
| `isort --check-only` (changed files)              | clean                          |
| `python3 scripts/validate_migrations.py --strict` | PASSED (no migrations touched) |
| backend tests, skills-testing scope (`-k skill`)  | 391 passed, 1 skipped          |
| backend tests, full suite                         | 8816 passed, 22 skipped        |

---

## Pass 2 (2026-08-29)

**Prefix:** `SKT2` · **PR:** TBD

**Scope check:** diffed the current tree against `7a772a67` (the pass-1 merge
commit for PR #1901) across the full backend surface — endpoint file, service
file, schema file, model file, and the skill-sheet-library data module.
**All five are byte-for-byte unchanged.** No new migration touches a
skills-testing table (`git diff --stat` against `alembic/versions/` directly,
not scoped to source files — the SCH-15 lesson). Given zero backend diff going
in, this pass is re-verification of the four pass-1 fixes plus dimensions
pass 1's write-up did not explicitly enumerate (frontend, cache exclusions),
not a first-read of grown files — the file is 3,777 L now vs. the 3,723 L pass
1 recorded, a difference fully accounted for by this pass's own fix (SKT2-1)
plus intervening blank-line/docstring drift already present at the merge
commit, not by any change between passes.

### Re-verification of pass-1 fixes

Re-read the current code directly for each (not re-cited from the doc):

- **SKT-1** — `update_template` still routes through `apply_updates` inside a
  `try/except ValueError` (`skills_testing.py:678`); `test_skill_template_update_guard.py`
  still asserts an explicit null against `name`/`sections`/
  `score_pass_fail_criteria` is rejected.
- **SKT-2** — `void_test` still calls `assert_different_person(current_user.id,
test.candidate_id, action="void", ...)` immediately after the "already
  voided" guard and before any mutation (`skills_testing.py:2687`).
- **SKT-3** — `return_test_for_correction` still calls the identical guard
  before the status mutation begins (`skills_testing.py:2856`).
- **SKT-4** — both halves of the Pitfall #27 fix are intact:
  `lock_attempt_capacity` still locks `TrainingRequirement` with
  `.with_for_update()` (`skills_testing_service.py:605-611`), the `spent` count
  in `assert_attempts_remaining` still carries `.with_for_update(of=SkillTest)`
  (`skills_testing_service.py:715`), and `validate_test` still acquires the
  capacity lock via a non-locking peek at `requirement_id`
  (`skills_testing.py:1991-2000`) **before** `_lock_test_for_transition` locks
  the specific test row — the lock-ordering fix from Codex's review on PR #1901
  is still the code path taken, not reverted back to locking
  `RequirementProgress`.

**Route auth coverage re-enumerated independently** (a fresh AST walk over the
endpoint file, not a re-read of pass 1's prose): 29/29 routes still carry
either `Depends(get_current_user)` or a `Depends(require_permission(...))`
alongside `Depends(get_db)`, matching pass 1's inventory route-for-route (same
29 paths, same methods, same gate per route — diffed the walk's output against
the table in this doc's Route inventory section above). No `require_permission`
call in this feature uses an OR-gate on more than the single
`"training.view"`/`"training.manage"` pair already in that table (only
`search_candidates` uses an OR at all), so CLAUDE.md Pitfall #23's
broadly-seeded-grant shape does not newly apply.

**Org-scoping swept mechanically, not spot-checked.** Every `select(SkillTest)`,
`select(SkillTemplate)`, and `select(SkillTestViewer)` call site in the endpoint
file was extracted and checked for an `organization_id` filter in the
surrounding statement: every one either filters directly, or resolves through
a `test`/`template` row already fetched org-scoped earlier in the same function
(e.g. `select(SkillTemplate).where(SkillTemplate.id == test.template_id)` after
`test` was already loaded with an `organization_id` filter) — the "resolves
through an already-org-scoped parent" pattern the checklist allows. No by-id
query reachable from a client-supplied id skips the filter.

**Read the surface pass 1 named as new-but-not-individually-verified**
(`complete_test`, `cancel_test`, `delete_test`, `discard_practice_test`,
`bulk_validate_tests`, `release_test_results`, the three `/viewers` routes,
`email_test_results`, `export_tests_csv`) line by line this pass, not
sampled:

- **`bulk_validate_tests`** delegates to `validate_test` per id with no
  reimplementation, exactly as its docstring claims — confirmed by reading
  both functions side by side. `SkillTestBulkValidateRequest.test_ids` is
  `Field(..., min_length=1, max_length=50)` (`schemas/skills_testing.py:357`),
  so a single bulk-validate call cannot become an unbounded loop of
  side-effecting writes (dimension 6).
- **`add_test_viewer`** re-confirmed to validate `viewer_data.user_id` in-org
  before storing (Pitfall #14c, quoted in-code) and to refuse naming the
  candidate as their own viewer.
- **`export_tests_csv`** re-confirmed org-scoped, `SafeCsvWriter`-only (no bare
  `csv.writer`), and writes an audit event recording the exported row count —
  the CSV route this pass expected to need the most scrutiny turned out to
  already be the most carefully built one in the file.
- **`email_test_results`** re-confirmed every interpolated value
  (`template_name`, `candidate_name`, `examiner_name`) is `html.escape`d before
  entering the HTML body, and that the emailed scorecard is redacted through
  the same `resolve_result_view`/`redact_test_for_view` pipeline the API
  response uses — an officer cannot use "email results" to hand a candidate a
  scorecard the disclosure policy would otherwise withhold from them.
- **`discard_practice_test`** confirmed to check `is_practice` before checking
  identity — an officer, examiner, or candidate may discard only a _practice_
  test they are party to; an official test always 400s here regardless of who
  is calling, so there is no path from this route to deleting an official
  record.

No new backend finding in any of these.

### SKT2-1 — NIT — `is_practice == False` with a repo-wide-redundant `# noqa: E712` — ✅ FIXED

**What:** ten call sites compared `SkillTest.is_practice` against the Python
literal `False` and suppressed the resulting lint code inline:
`SkillTest.is_practice == False,  # noqa: E712`. `backend/setup.cfg` already
disables `E712`/`E711` for the whole project ("required by SQLAlchemy
filters"), so flake8 was never going to flag these lines — the ten `# noqa`
comments were dead weight, not a suppression doing any work. Not a
vulnerability: SQLAlchemy compiles `Column == False` to the same boolean
comparison as `Column.is_(False)` for a non-nullable-relevant boolean column,
so there was no behavioral defect underneath.

**Where:** `app/api/v1/endpoints/skills_testing.py` — `list_tests` (2 sites),
`export_tests_csv` (2 sites), `get_testing_summary` (6 sites).

**Why it's in scope for a security pass:** this exact class — `== True`/
`== False` on a SQLAlchemy boolean filter — was already the subject of a
dedicated finding in this feature's own audit lineage: **CS2-1**
(`docs/app-review/compliance-skills.md`, pass 3) swept and fixed the identical
pattern in `compliance_officer_service.py` and `skills_testing_service.py`,
converting both to `.is_(...)`. That sweep evidently covered the _service_
file but not the _endpoint_ file's own six-months-newer `list_tests`/
`export_tests_csv`/`get_testing_summary` additions, which carried the
pre-CS2-1 style forward with a `# noqa` that (per the flake8 config) was never
load-bearing to begin with. Left as-is, the inconsistency invites a future
`# noqa: E712` to be copy-pasted onto a genuinely-suppressed violation
elsewhere, on the reasoning "this file already does it" — CLAUDE.md's own
stance on `# noqa` is that it should be reserved for a "documented,
unavoidable reason," and ten copies of an unnecessary one is the opposite of
that.

**Fix:** all ten converted to `.is_(False)`, matching CS2-1's precedent and
`skills_testing_service.py`'s own current style; the ten now-redundant `# noqa:
E712` comments removed. Verified `black --check` and `flake8` both still pass
on the file (no reformatting needed — the replacement is same-width), and the
full skills-testing test scope (392 tests) still passes unchanged. No guard
test added: this mirrors CS2-1, which was disposed of as a same-pass cleanup
with no dedicated regression test, and `E712` cannot regress into a real
flake8 failure while `setup.cfg`'s ignore line stands, so a guard test here
would assert against config that already exists for an unrelated, documented
reason (SQLAlchemy filter ergonomics) rather than against this fix.

### Frontend scope — established for the first time this pass

Pass 1 was backend-only (endpoint + service, per its own scope note above).
Traced every frontend file that imports `skillsTestingService`,
`skillsTestingStore`, or a `skillsTesting`-typed export: 16 files, ~9,000 L
(`types/skillsTesting.ts`, `stores/skillsTestingStore.ts`,
`components/training/{SkillSheetLibraryModal,SkillTestOfficerActions,MySkillTestsList}.tsx`,
`utils/{skillTemplateSections,skillTestTallies}.ts`,
`pages/training/{SkillTestScorecardPrintPage,SkillSheetPrintPage}.tsx`,
`pages/{SkillsTestingTestRecordsTab,ActiveSkillTestPage,StartSkillTestPage,
SkillTemplateBuilderPage,SkillsTestingTemplatesTab,MySkillTestResultPage,
SkillsTestingPage}.tsx`).

- **`skillsTestingService`** (`services/trainingServices.ts:1382`) calls every
  skills-testing endpoint through the shared `api` client
  (`services/apiClient.ts`) — `withCredentials: true`, the CSRF
  double-submit interceptor, and the stale-while-revalidate GET cache all
  apply. Not a bespoke per-module axios instance, so CLAUDE.md Pitfall #7
  (module axios missing auth config) does not apply here.
- **Cache exclusions checked against the live route table, not assumed.** The
  full-detail PHI-adjacent surface (`/tests`, `/tests/{id}`, and everything
  nested under it — viewers, complete, validate, void, return, cancel,
  discard) is covered by the existing `'/training/skills-testing/tests'`
  prefix entry in `UNCACHEABLE_PREFIXES` (`utils/apiCache.ts:68`, present
  since before this rotation began), because the cache check is a
  `url.startsWith(prefix)` test and every one of those paths starts with that
  string. `GET /candidates` (name + id only, capped at 15 results, requires a
  2+ character fragment — deliberately minimal-PII by the endpoint's own
  design, see `skills_testing.py:915-934`) and `GET /templates`/`GET /library`
  (no member data) were checked and are correctly left cacheable. `GET
/summary` returns org-wide aggregates only (`SkillTestingSummaryResponse`
  has no per-member field) and is correctly left cacheable. **No cache-exclusion
  gap found** — unlike TR2-1/TRX2-1 in this feature's sibling training passes,
  this endpoint's PII surface was already fully covered before this pass.
- **Standard grep sweep, all 16 files: zero hits** for
  `window.confirm`/`window.alert`/`window.prompt` (the two comment mentions
  found are explanatory prose about _not_ using them, not the pattern
  itself), `dangerouslySetInnerHTML`, banned `.toLocale*`/`date-fns`/
  `new Date().toISOString().slice(0,10)`, direct `fetch(`, and
  `localStorage`/`sessionStorage` (no client-side persistence of test
  results, scores, or PII outside the shared `apiCache` machinery already
  covered above).
- **Confirmation dialogs** on every destructive action found
  (`SkillsTestingTemplatesTab.tsx`, `SkillsTestingTestRecordsTab.tsx`,
  `ActiveSkillTestPage.tsx`, `SkillTemplateBuilderPage.tsx`) render the `ux`
  library's `ConfirmDialog` component rather than `window.confirm` — consistent
  with Pitfall #16's ban on the suppressible native dialog. These four render
  `<ConfirmDialog>` directly rather than through the `useConfirm()` hook
  (53 files elsewhere in the codebase use the hook; 26, including these four,
  render the component directly) — a pre-existing, codebase-wide split that
  predates this feature and is not specific to it, so it is noted here rather
  than fixed: a targeted swap in one feature's four files would not close the
  other 22 sites, and CLAUDE.md's Pitfall #16 does not itself ban the direct
  form. Left for a dedicated frontend-shared pass (feature 34) to decide
  whether to standardize on one form codebase-wide.

No frontend finding this pass.

## Corrections to prior write-ups

None — pass 1's four findings and the "Verified good" claims are unchanged and
re-confirmed above; nothing in this pass contradicts anything pass 1 recorded.

## Completion gate (pass 2)

| Check                                             | Result                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                          |
| `black --check app/ tests/ alembic/`              | ✅ 1331 files unchanged                                                  |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (`isort==8.0.1`, CI's pin, already installed)                   |
| `python3 scripts/validate_migrations.py --strict` | ✅ 393 revisions, single head `a0af87c3904a`                             |
| `pytest tests/ -q -k "skill"`                     | ✅ 392 passed, 1 skipped (pre-existing optional-dependency skip)         |
| `pytest tests/ -q` (full backend suite)           | ✅ 9225 passed, 22 skipped (pre-existing Docker/no-MySQL/optional skips) |
| `cd frontend && npm run typecheck`                | ✅ 0 errors                                                              |
| `cd frontend && npx eslint .`                     | ✅ 0 errors, 10 pre-existing warnings (none in skills-testing files)     |

---

## Pass 3 (2026-09-04)

**Prefix:** `SKT3` · **PR:** [#2230](https://github.com/thegspiro/the-logbook/pull/2230)

**Scope check:** diffed the current tree against `793bbebb4b03ddbe8f65ca171de261a4dd13fb1f`
(the pass-2 merge commit, PR #2017). The full backend surface — endpoint file,
service file, schema file, model file — came back **byte-identical**
(`git diff --stat`, not assumed; the repo's shallow clone required fetching
that commit directly by SHA since it predates this clone's default depth).
`backend/app/models/training.py` did change since pass 2, but the diff is
entirely `Shift`/`ShiftTemplate` scheduling additions (`late_signup_until`,
`ShiftTemplateEquipmentCheck`) — confirmed by reading the diff directly, no
`SkillTest`/`SkillTemplate` class is defined in that file. No new migration
touches a skills-testing table. Given zero backend diff going in, this pass is
re-verification plus closing two frontend-inventory gaps pass 2 left, not a
first read of changed code.

**Frontend scope-completeness gap found and closed.** Pass 2's declared
16-file frontend inventory (`docs/security-review/SKT-19-skills-testing.md`,
Pass 2) missed two files that import `skillsTestingService` directly:
`components/training/ScoreBreakdownPanel.tsx` and
`components/training/TestViewersPanel.tsx` (plus their `.test.tsx` files) —
confirmed via a fresh `grep -rl` for `skillsTestingService\|skillsTestingStore`
across `frontend/src`, which returns 20 non-test source files where pass 2's
prose named 9. Both existed unchanged since before pass 1 (`git show
7a772a67:frontend/src/components/training/ScoreBreakdownPanel.tsx` resolves,
i.e. pre-dates even the pass-1 merge) — they were never new code slipping
through, just missing from the file list pass 2 wrote down. Read both in full
this pass:

- **`ScoreBreakdownPanel.tsx`** is pure presentation — takes a `ScoreBreakdown`
  prop, makes no API call, mutates nothing. Traced where its data originates:
  `SkillTest.score_breakdown` is built server-side by
  `build_score_breakdown()` (`skills_testing_service.py:266`) from
  `template.sections`' own step labels/names — structural template metadata,
  never examiner free-text — so it correctly is **not** stripped by
  `redact_test_for_view`'s `scores` branch (which strips only written
  commentary), while the `pending` branch does null it out
  (`skills_testing_service.py:1023`, with an explanatory comment: "the
  breakdown is the score restated as arithmetic — leaving it would hand over
  the very outcome the rest of this branch withholds"). Correct on both
  branches; no finding.
- **`TestViewersPanel.tsx`** calls `getTestViewers`/`addTestViewer`/
  `removeTestViewer` through the shared `services/api.ts` client
  (`withCredentials`, CSRF interceptor — not a bespoke module axios instance,
  Pitfall #7 doesn't apply) and its own member-search input reuses
  `useMemberSearch()`, which wraps the already-reviewed, rate-bounded
  `/candidates` endpoint. Confirmed both panels are additionally gated
  client-side: `ActiveSkillTestPage.tsx:1112` computes
  `isOfficer = checkPermission('training.manage')` and only renders
  `<TestViewersPanel>` when `isOfficer` is true (defense in depth on top of
  the backend's own `training.manage` gate on every `/viewers` route) — this
  is what led to the one real finding below, since defense in depth on the
  frontend picker turned out not to be mirrored by every check the backend
  docstring claimed.

### Re-verification of pass-1/2 fixes

Read the current code directly for each (not re-cited from either prior
write-up):

- **SKT-1** — `update_template` still routes through `apply_updates` inside a
  `try/except ValueError` (`skills_testing.py:678`).
- **SKT-2** — `void_test` still calls `assert_different_person(current_user.id,
test.candidate_id, action="void", ...)` before any mutation
  (`skills_testing.py:2687`).
- **SKT-3** — `return_test_for_correction` still calls the identical guard
  before the status mutation begins (`skills_testing.py:2857`).
- **SKT-4** — `lock_attempt_capacity` still locks `TrainingRequirement` with
  `.with_for_update()`, the `spent` count in `assert_attempts_remaining` still
  carries `.with_for_update(of=SkillTest)`, and `validate_test` still acquires
  the capacity lock via a non-locking peek at `requirement_id`
  (`skills_testing.py:2000`) **before** `_lock_test_for_transition` locks the
  specific test row.
- **SKT2-1** — the ten `SkillTest.is_practice == False` sites remain converted
  to `.is_(False)`, no `# noqa: E712` reintroduced.

**Route auth coverage re-enumerated from scratch**, via a small `ast`-walk
script (not a re-read of either prior table): every `@router.<verb>` decorator
plus every `Depends(...)` default among that function's arguments. Result:
**29/29 routes**, same paths, same methods, same `get_current_user` /
`require_permission(...)` gate as pass 1/2's table — this file's route surface
has not moved since pass 1. Cross-checked the disclosure-gated routes
(`/tests`, `/tests/{id}`) still carry `get_current_user` with the in-body
two-pass filter, not a bare permission gate, matching CS-1.

**Org-scoping** — re-swept `select(SkillTest)`/`select(SkillTemplate)`/
`select(SkillTestViewer)` call sites in `list_test_viewers`, `add_test_viewer`,
and `remove_test_viewer` by hand (the three `/viewers` routes, since they are
the routes this pass's one new finding lives in): all three resolve the test
via `SkillTest.id == test_id` **and** `SkillTest.organization_id ==
current_user.organization_id` before touching `SkillTestViewer`, and
`add_test_viewer` additionally re-validates the client-supplied
`viewer_data.user_id` against `User.organization_id` before storing it
(Pitfall #14c, in-code comment present) — unchanged from pass 2's finding of
no gap.

### Findings

### SKT3-1 — LOW — `add_test_viewer` did not reject naming the examiner, only the candidate — ✅ FIXED

**What:** `add_test_viewer` checked `str(viewer.id) == str(test.candidate_id)`
and rejected the grant with a 400, but had no matching check against
`test.examiner_id`. The examiner already holds `ResultDisclosure.FULL` on
their own test unconditionally — `resolve_result_view`'s very first branch is
`if str(test.examiner_id) == uid: return ResultDisclosure.FULL.value`, before
any viewer-grant lookup runs — so a stored viewer grant naming the examiner is
inert: it changes nothing about what they can see, exactly the same "no-op the
officer could not tell had done nothing" reasoning the code's own comment
gives for blocking the candidate case one line above.
**Where:** `app/api/v1/endpoints/skills_testing.py:2416` (was; now followed by
a second check at what is now line ~2422).
**Failure scenario:** the frontend's own `TestViewersPanel.tsx` docstring
states, of both the candidate and examiner: "Excluded from the picker — ...
the API rejects granting to them" (candidate) and "Excluded too: the examiner
always sees what they themselves recorded, so a grant would be a no-op the
officer could not tell had done nothing" (examiner) — and the picker's
`grantable` filter does exclude both client-side
(`m.id !== candidateId && m.id !== examinerId`). But a caller hitting `POST
/tests/{test_id}/viewers` directly (a script, an API client, a future frontend
change that forgets the exclusion) with `{"user_id": <examiner's id>}` would
succeed and receive a `201` and a stored `SkillTestViewer` row — the very
"docstring says the API rejects it" claim the frontend relies on was not
actually true at the API layer for the examiner half of the pair.
**Impact:** no data exposure (the examiner already sees everything a grant
could add) and no privilege escalation — this is a documentation/contract
inconsistency between the frontend's stated assumption and the backend's
actual behavior, not a live vulnerability. Included as a finding because a
future officer-facing "who can see this" audit view, or a future disclosure
rule that stops treating the examiner as an automatic FULL viewer, would
silently inherit a stored grant that was written on the (currently false)
assumption the backend already prevents it.
**Fix:** added a second self-dealing check mirroring the candidate one exactly
(`str(viewer.id) == str(test.examiner_id)` → `HTTPException(400, "The examiner
already sees this result in full")`), placed immediately after the candidate
check and before the existing-grant lookup. Guard tests:
`tests/test_skill_test_viewers.py` (new file) —
`TestAddViewerSelfDealingGuard::test_naming_the_examiner_is_rejected` (the new
behavior), `::test_naming_the_candidate_is_rejected` (mirrors the pre-existing
candidate check, which had no dedicated endpoint-level test of its own before
this pass — pass 2's claim that it was "re-confirmed" rested on reading the
code, not on an existing test), and
`::test_a_third_party_is_still_grantable` (a mentor who is neither candidate
nor examiner still reaches the grant path — guards the fix against
over-matching).

### SKT3-2 — LOW/MED — `GET /tests` has no pagination or result cap — ✅ FIXED 2026-10-05 (owner decision; see pass 4's entry)

**What:** `list_tests` (`GET /tests`, gated only by `get_current_user` — open
to every member, not `training.manage`) builds its `SkillTest` query with
filters but no `.limit()` anywhere in the function, then does two additional
full-width queries per call (a batch `User` fetch and a batch `SkillTemplate`
fetch keyed on every distinct id in the result set) and, for a non-officer, a
third and fourth query (named-viewer ids, position-granting templates) plus a
per-row `resolve_result_view()` call in a Python loop over every row returned.
`search_candidates` (the sibling lookup endpoint) has an explicit
`CANDIDATE_SEARCH_MAX_RESULTS` cap; `list_tests` has no equivalent.
**Where:** `app/api/v1/endpoints/skills_testing.py:978-1198` (`list_tests`).
**Failure scenario:** this is user-reachable today, not hypothetical — traced
the actual call path. `frontend/src/pages/SkillsTestingTestRecordsTab.tsx`
calls `loadTests(statusFilter ? { status: statusFilter } : undefined)`; the
default "All" status filter (the tab's initial state) sends **no filter at
all**, so every load of the Test Records tab with no status selected issues
`GET /tests` with zero query params — the entire org's non-practice skill-test
history in one response, every time. `skillsTestingService.getTests()`
(`services/trainingServices.ts:1447`) accepts no `limit`/`offset`/`page`
parameter for a caller to opt into bounding it even if it wanted to. A
department several years into using this feature, testing routinely across
multiple templates and candidates with repeat attempts, accumulates skill-test
rows the same way `training_submissions` or `shift` rows do — this is not a
small, bounded-by-nature table like `organizations` or `templates`.
**Impact:** primarily an abuse-resistance / resource-exhaustion concern
(CHECKLIST dimension 6: "List endpoints and exports are bounded — no `all()`
over an org-wide table"), not a data-exposure one — every row is already
org-scoped and disclosure-filtered before being returned, so this does not
let anyone see data they otherwise could not. The risk is request latency and
server memory/CPU (N+1-shaped batch fetches, then an O(n) Python
disclosure-resolution loop per non-officer request) scaling unboundedly with
the organization's accumulated testing history, on a route every authenticated
member — not just officers — can call with no filter at all.
**Why flagged, not fixed:** closing this properly needs a paging contract
(`limit`/`offset` or a cursor), a decision on a sane default page size and cap,
and — for it to actually bound anything — a change to
`skillsTestingService.getTests()` and `SkillsTestingTestRecordsTab.tsx`'s own
fetch/render loop, since a backend-only cap that silently truncates the "All"
view without frontend pagination UI would just make the tab quietly show a
partial roster with no indication rows are missing. That is a product decision
and a coordinated frontend change, not a same-commit, verifiable, behavior-
preserving fix — exactly the "changes behavior, needs a migration, or needs a
product decision" carve-out this rotation's own process reserves for
flagging. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### Corrections to prior write-ups

None to either pass's findings or fixes — all re-verified intact above. The
frontend-inventory gap (`ScoreBreakdownPanel.tsx`/`TestViewersPanel.tsx` missing
from pass 2's file list) is noted above under Scope rather than as a
correction to a claim, since pass 2 did not assert those two files were
reviewed — it simply omitted them from an inventory that turns out to have
under-counted by two.

### Guard tests added

- `tests/test_skill_test_viewers.py` (new file) —
  `TestAddViewerSelfDealingGuard`: naming the candidate is rejected (400,
  pre-existing behavior, now under an endpoint-level test for the first time),
  naming the examiner is rejected (400, the SKT3-1 fix), and a genuine third
  party still reaches the grant path and gets back the created
  `SkillTestViewer` (guards the fix against over-matching every viewer
  candidate).

### Completion gate (pass 3)

| Check                                             | Result                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                                                                                                                          |
| `black --check app/ tests/ alembic/`              | ✅ 1467 files unchanged                                                                                                                                                  |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (`isort==9.0.1`, CI's current pin — confirmed against `ci.yml`, updated from 8.0.1 since pass 2)                                                                |
| `python3 scripts/validate_migrations.py --strict` | ✅ 418 revisions, single head `c9f2a4b71d38`                                                                                                                             |
| `pytest tests/ -q -k "skill"`                     | ✅ 395 passed, 1 skipped (pre-existing optional-dependency skip) — 392 pass-2 count + 3 new SKT3-1 guard tests                                                           |
| `cd frontend && npx tsc --noEmit`                 | ✅ 0 errors                                                                                                                                                              |
| `cd frontend && npm run typecheck`                | ✅ 0 errors (the aliased TS 7.0.2 compiler, via `scripts/tsc-native.mjs`)                                                                                                |
| `cd frontend && npx eslint .` / `npm run lint`    | ✅ 0 errors; 1 pre-existing warning (`pages/scheduling/ShiftDetailPanel.test.tsx:257`, unrelated module, not skills-testing), well under the `--max-warnings 10` CI gate |

Full backend suite not re-run this pass beyond the `-k skill` scope (zero
backend diff against pass 2, which already ran and recorded the full suite
clean at 9225 passed); the skills-testing-scoped run above is the one new code
in this pass could plausibly affect.

**Environment note, not a finding:** this pass's isolated review worktree
initially had no `node_modules` installed at all (a fresh worktree checkout,
never `npm install`ed). Running `eslint`/`tsc` directly under that condition
resolved to a global fallback toolchain with `@types/node` unresolvable,
producing 942 spurious `@typescript-eslint/no-unsafe-*` warnings across 38
files in a dozen unrelated modules — none of it real, all of it an artifact of
the missing local install, not a defect on `main`. Caught by checking `npm run
lint`'s actual exit code (1, "too many warnings") against what should have
been a clean baseline per pass 2's own gate a week prior, then confirmed via
`npm ls @types/node` failing to resolve. `npm ci` from the worktree root fixed
it; the real numbers are recorded in the table above. Noted here so a future
pass with a similarly bare worktree doesn't misreport a phantom "CI is red on
main."

---

## Pass 4 (2026-09-10)

**Prefix:** `SKT4` · **PR:** [#2473](https://github.com/thegspiro/the-logbook/pull/2473)

**Scope check (pre-review snapshot — see "round 4" below for what this pass's
own fixes then added):** diffed the current tree against `d5b716ff8` (the
pass-3 merge commit for PR #2230), **before this pass made any fix of its
own.** Everything in this subsection describes that starting point, not the
merged state of this PR — round 4 below adds real diffs to
`app/schemas/skills_testing.py` and `app/services/skills_testing_service.py`
that this snapshot predates. **Backend: one line changed, in one file,** at
the time this pass started.
`app/api/v1/endpoints/skills_testing.py` gained the `SEC4-1` fix from
Feature 00's own pass 4 (`c91060f7a`, "security(cross-cutting): 3 fixes, 0
flagged") — `email_test_results`'s bare `except Exception as e: ... detail=
f"Failed to send email: {str(e)}"` now reads `detail=safe_error_detail(e,
fallback="Failed to send email")` at line 3167 (Codex review corrected a
first-draft citation of line 3157, which after this pass's own comment
additions is only the closing `)` of the preceding `send_email(...)` call —
the actual guarded block is lines 3158-3168), closing an SMTP-host/
credential-error disclosure that was this feature's own code but was found
and fixed by the cross-cutting sweep rather than this rotation. `app/services/
skills_testing_service.py`, `app/schemas/skills_testing.py`, and
`app/models/skills_testing.py` are all **byte-identical** to pass 3
(`git diff d5b716ff8 HEAD -- <each path>` empty). No new migration touches a
skills-testing table.

**Frontend: nine files changed — first draft undercounted at seven.** Read
each diff directly rather than trusting the diffstat: `SkillTestOfficerActions.tsx`,
`ActiveSkillTestPage.tsx`, `SkillsTestingTestRecordsTab.tsx` (green-600→700 /
amber-600→700 / yellow-500→700 shade bumps, the same AAA-contrast sweep
CLAUDE.md documents for `btn-success`/`btn-warning` and TRX4's sibling pass
found on its own frontend files the same day); `MySkillTestResultPage.tsx` and
`SkillsTestingPage.tsx` (a `<Breadcrumbs>` rollout); `SkillTemplateBuilderPage.tsx`
and `StartSkillTestPage.tsx` (`<main>` → `<div data-page-main>`, a
landmark-uniqueness fix) — those seven are genuinely cosmetic, no new API
call, input, or data-exposure surface. Codex review correctly flagged that
the first draft's "seven files" omitted `frontend/src/utils/apiCache.ts` and
`apiCache.test.ts`, which also changed since `d5b716ff8` and which pass 2
explicitly put in this feature's scope, since `UNCACHEABLE_PREFIXES`'
`/training/skills-testing/tests` entry is this feature's own PHI-cache
control. Read both diffs directly: every addition is a **different**
feature's cache-exclusion entry or test (apparatus operator/driver-exception
routes, inventory reorder-requests/colors/clearances, `operational-ranks/
validate`, `training/external/providers` and `training/multi-agency`, plus an
`/admin-hours/` test-coverage expansion) — `git diff d5b716ff8 HEAD --
frontend/src/utils/apiCache.ts` shows the `/training/skills-testing/tests`
line itself as unchanged context, not a `+`/`-` line, so this feature's own
exclusion is intact and unmodified. Confirmed, not assumed: no line touching
`skills-testing` appears in either diff hunk.

### Re-verification of pass 1–3 fixes

Read the current code directly for each (not re-cited from any prior write-up):

- **SKT-1** — `update_template` still routes through `apply_updates` inside a
  `try/except ValueError` (`skills_testing.py:678-680`).
- **SKT-2** — `void_test` still calls `assert_different_person(current_user.id,
str(test.candidate_id), action="void", ...)` immediately after the
  "already voided" guard and before any mutation (`skills_testing.py:2698-2706`).
- **SKT-3** — `return_test_for_correction` still calls the identical guard
  before the status mutation begins (`skills_testing.py:2863-2872`).
- **SKT-4** — `lock_attempt_capacity` (`skills_testing_service.py:576-609`)
  still locks `TrainingRequirement` with `.with_for_update()`; the `spent`
  count in `assert_attempts_remaining` still carries
  `.with_for_update(of=SkillTest)` (`:715`); `validate_test` still acquires
  the capacity lock via a non-locking peek at `requirement_id` before
  `_lock_test_for_transition` locks the specific test row.
- **SKT2-1** — all ten `SkillTest.is_practice` comparisons are still
  `.is_(False)`/`.is_(True)`; zero `# noqa: E712` in the file (`grep -c`
  confirms).
- **SKT3-1** — `add_test_viewer` still rejects naming the examiner
  (`str(viewer.id) == str(test.examiner_id)`, `skills_testing.py:2428-2432`),
  immediately after the pre-existing candidate check, both before the
  existing-grant lookup.

All six guard test files (`test_skill_template_update_guard.py`,
`test_skills_test_void.py`, `test_skill_test_return.py`,
`test_skill_test_attempt_limit.py`, `test_skill_test_validate_locking.py`,
`test_skill_test_viewers.py`) are present and pass (see completion gate).

**Route auth coverage re-enumerated from scratch**, via a fresh Python `ast`
walk over every `@router.<verb>` decorator and its function's `Depends(...)`
defaults (not a re-read of any prior table): **29/29 routes**, same paths,
same methods, same `get_current_user` / `require_permission(...)` gate as
pass 1–3's table. The file's route surface has not moved since pass 1.

### New checks this pass

**`GET /summary`'s "no per-row exposure" claim re-verified by reading the
handler, not by trusting the label — including the branches, per Codex
review catching a first-draft undercount.** `get_testing_summary`
(`skills_testing.py:3532-3658`) issues **up to eight** queries, not a flat
six: six unconditional (`total_templates`, `published_templates`,
`total_tests`, `tests_this_month`, `completed_tests`, `avg_score`), plus two
conditional ones — the passed-count query only when `completed_count > 0`,
and the pending-validation query only when `_can_manage_tests(current_user)`
is true. Every one of the eight, in every branch, is still a bare
`func.count`/`func.avg` filtered on `organization_id` (plus
`is_practice`/`status`/`validated_at`/`result` predicates) — no query selects
a `User` or a per-test row in any branch, and `pending_validation_count` is
gated to `_can_manage_tests(current_user)` before it is even computed, with
an in-code comment explaining why a member should not learn the org's
outstanding review queue depth. The query-shape claim holds in all branches
— but "no per-row exposure" is not the same guarantee as "no disclosure",
and Codex review correctly pointed out this pass's first draft conflated
the two: an aggregate over a cohort of one identifiable test still discloses
that test's own result. See **SKT4-3** below.

**Template visibility fail-direction checked, not assumed.** `list_templates`
and `get_template` both treat `visibility="assigned_only"` identically to
`"officers_only"` for a non-officer caller (`skills_testing.py:348-353`,
`:610-615`) — there is no code path anywhere in this file that resolves an
"assignment" and grants a non-officer access to an `assigned_only` template.
This is a functional gap (the visibility tier does nothing beyond what
`officers_only` already does), not a security one: the fail direction is
**more** restrictive than the label implies, never less, so no member sees a
template the officer who set `assigned_only` did not intend for them. Not
reported as a finding since nothing here can leak; noted so a future pass
implementing per-assignment visibility does not have to re-discover that the
non-officer branch currently no-ops on this value.

**Audit-log PII payloads checked against SEC-00's own precedent — first draft
mis-enumerated, corrected across two Codex review rounds.**
`SEC-00-cross-cutting-baseline.md`'s pass 4 swept `log_audit_event` payloads
app-wide for PII-shaped keys but explicitly scoped itself away from "the
module-level code each rotation feature owns" — so its "13 calls, all
justified" count does not cover this file's own sites that carry a named
member's identity alongside the id. This pass's first draft listed 8 sites
under a `candidate_name`/`examiner_name` framing and got three of them wrong:
it credited `email_test_results` with an audit-log call it does not have (the
function never calls `log_audit_event` at all — it only puts the candidate/
examiner name into the outgoing email body), mislabeled lines 2100-2102 as
`complete_test` when they belong to `validate_test`, and — round 1's own
fix — dropped `add_test_viewer` outright on the reasoning that its
`viewer_name` field isn't named `candidate_name`/`examiner_name`. Round 2 of
Codex review correctly rejected that last move: excluding a site because its
PII field has a different name, rather than evaluating it, is exactly the
"assessed" claim this section exists to make honest. Re-enumerated by reading
every one of the file's 18 `log_audit_event` call sites directly, evaluating
each by SEC-00's actual criterion (a named member's identity, whatever the
field is called) rather than by field-name pattern-matching: the actual count
is **8** — `complete_test:1809` (`candidate_name`), `delete_test:1899`
(`candidate_name`), `validate_test:2100-2102` (`candidate_name` +
`examiner_name`), `release_test_results:2270` (`candidate_name`) — omitted
from the first draft — `add_test_viewer:2462` (`viewer_name`, alongside a bare
`candidate_id`, not `candidate_name`), `cancel_test:2633` (`candidate_name`),
`void_test:2763` (`candidate_name`), `return_test_for_correction:2915-2917`
(`candidate_name` + `examiner_name`). Checked each against SEC-00's own
stated criterion for the pattern being acceptable ("the identifier is the
subject of the audited event... none incidental") rather than assuming it
transfers: every one of these events is specifically about an action taken on
or naming the candidate, examiner, or (for the viewer grant) the viewer being
named — a completion, a deletion, a validation, a release, a viewer grant, a
cancellation, a void, a return — the same shape as `deleted_full_name` on a
user deletion. No finding; recorded so this file's own audit payloads are
confirmed against the standard rather than left unverified because SEC-00's
sweep skipped feature-owned files by design, and so that a future pass does
not repeat round 1's mistake of dropping a site for not matching a field-name
pattern instead of evaluating it.

### SKT4-1 — LOW/MED — `sections`/`criteria` has no per-template item cap — ✅ FIXED (2026-10-05)

**Resolved (owner decision, generous caps):** `MAX_TEMPLATE_SECTIONS = 100`, `MAX_SECTION_CRITERIA = 200` and `MAX_CHECKLIST_ITEMS = 100` in `app/schemas/skills_testing.py`, on create and update. The largest shipped library sheet is 4 / 6 / 5. Test: `test_skill_sheet_item_caps.py`. As found:

`SkillTemplateCreate.sections: List[SkillTemplateSectionSchema] =
Field(..., min_length=1)` and `SkillTemplateSectionSchema.criteria` (default
empty list) both lack a `max_length`. First draft of this pass called this
"not a finding" on the reasoning that the route is `training.manage`-gated and
the global `RequestSizeLimitMiddleware` (`MAX_REQUEST_BODY_SIZE`) caps the
total request body regardless of section/criterion count — Codex review
correctly rejected that reasoning by pointing at this repository's own
precedent for the identical shape: `RankReorderRequest.ranks`
(`app/schemas/operational_rank.py:108-113`) caps its list at
`MAX_RANKS_PER_REORDER = 500` specifically _because_ the same request-body
budget can otherwise admit roughly a million items at ~60 bytes each — the
schema's own comment there states the byte ceiling is not a sane cardinality
bound. `SkillTemplateSectionSchema`/`SkillCriterionSchema` are the same shape:
an officer-gated caller can still submit a template with an unbounded number
of sections/criteria, each of which Pydantic fully materializes and the
create/update handlers persist, dump, and — in scoring and the CSV export path
— iterate. A malicious or merely mistaken officer client can submit a
several-hundred-thousand-entry template and force full materialization and
persistence of it. Reclassified from "verified good" to an open finding rather
than fixed in this pass: choosing `max_length` values for `sections` and
`criteria` needs a genuine content decision (what does the largest real
department's evaluation sheet actually look like) that this pass should not
guess at, matching this rotation's standing preference for flagging over
guessing on anything that changes accepted-input behavior. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

**Scope extended, round 4:** `SkillCriterionSchema.checklist_items:
Optional[List[str]] = None` (`app/schemas/skills_testing.py:42`) is the same
unbounded shape one level further in — a single criterion of type
`"checklist"` can carry an uncapped list of item strings, stored inside the
same `sections` JSON `sections`/`criteria` already covers. Capping only the
outer two lists would leave this finding trivially reproducible with one
section, one criterion, and millions of short `checklist_items` entries.
Included in this finding's scope (not filed separately, since it is the same
root cause and the same content-decision remedy) and in the
`docs/KNOWN_LIMITATIONS.md` entry.

### SKT4-2 — MED — `PUT /tests/{id}`'s result arrays have no per-field item cap, member-reachable — ✅ FIXED (2026-10-05)

**Resolved (owner decision, caps matched to the template's):** `section_results`, `criteria_results` and `checklist_completed` use the same three caps as the template lists they mirror, so a valid sheet always fits its results; `result_viewer_positions` is capped at `MAX_RESULT_VIEWER_POSITIONS = 100` on test and template create/update. Test: `test_skill_sheet_item_caps.py`. As found:

The same amplification shape as SKT4-1, one level deeper and reachable by a
broader population. `SkillTestUpdate.section_results:
Optional[List[SectionResultSchema]]`, `SectionResultSchema.criteria_results:
List[CriterionResultSchema]`, and `CriterionResultSchema.checklist_completed:
Optional[List[bool]]` (`app/schemas/skills_testing.py:236-296`) all lack a
`max_length`. `update_test` is gated by `_authorize_test_write`
(`skills_testing.py:196-228`), which is **not** `training.manage`-only: any
member who is the test's `examiner_id` on an unvalidated test may call it —
"examining is deliberately open to the whole department" per this file's own
route-inventory note — including a self-administered practice test where the
member is their own examiner. So an ordinary member, not just an officer, can
submit a near-`MAX_REQUEST_BODY_SIZE` `PUT` body containing a section list
whose `criteria_results` are each further unbounded, multiplying the same
cardinality problem across two nested list levels rather than SKT4-1's one.
Pydantic fully materializes it, `update_test` persists and dumps it, and
`complete_test`/scoring later iterate it. Flagged rather than fixed for the
same reason as SKT4-1 — choosing sane `max_length` values for a real
evaluation sheet's sections/criteria/checklist items is a content decision,
not a guess this pass should make — and because it reaches further than
SKT4-1 (member-writable, not officer-only), any chosen limits need to
accommodate the largest legitimate in-progress test, not just the largest
template. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Scope extended, round 4:** `SkillTestCreate.result_viewer_positions` and
`SkillTestUpdate.result_viewer_positions` (both `Optional[List[str]]`, no
`max_length`) are a third member-writable uncapped list this file's schemas
carry, missed by this finding's first draft because it only enumerated the
three result-shape fields. `_guard_official_test_policy_fields` deliberately
lets an ordinary member set policy fields — including this one — on their own
self-practice test, and `POST /tests` (create) accepts it, not only
`PUT /tests/{id}` (update). `list_tests` later reads every non-null per-test
`result_viewer_positions` list for a non-officer caller with any positions at
all, iterating whatever was stored. Included in this finding's scope, and its
`docs/KNOWN_LIMITATIONS.md` entry now names the create route too, not just
update.

### SKT4-3 — MED — `GET /summary`'s aggregates can disclose a single test's result in a small cohort — ✅ FIXED (2026-10-05)

**Resolved (owner decision, gate to `training.manage`):** `get_testing_summary` computes `pass_rate` and `average_score` only for a caller who can manage tests; everyone else gets the counts and `null` for both. Test: `test_skill_testing_summary_disclosure.py`. As found:

`get_testing_summary` (`skills_testing.py:3532-3658`) is open to
`get_current_user` — any authenticated member, no `training.manage`
requirement — and returns `pass_rate` and `average_score` computed only from
`SkillTest.organization_id`/`status`/`validated_at`/`is_practice` filters, with
no disclosure resolution (`resolve_result_view`, `result_disclosure`,
`ResultRelease`) applied anywhere in the handler. When an organization (or a
template/date range a future filtered variant might add) has exactly one
validated, non-practice, scored test, `pass_rate` is either 0% or 100% —
directly revealing that one test's pass/fail — and `average_score` is that
test's exact score, to a member with no relationship to the test and no
officer permission, even where the underlying test's own `result_disclosure`
would keep it hidden from everyone but the candidate and examiner. This
pass's first draft treated "no query selects a `User` or a per-test row" as
equivalent to "no disclosure," which Codex review correctly rejected — an
aggregate is not automatically anonymous; it is anonymous only above some
cohort size. Not fixed in this pass: the correct remedy (a minimum-cohort
suppression threshold, gating `pass_rate`/`average_score` specifically to
`training.manage` while leaving the count fields open, or something else) is
a product decision about what "org-wide stats" is supposed to mean, not a
same-commit fix. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### SKT4-4 — MED — `email-results` did not withhold an unvalidated official result — ✅ FIXED

`_ensure_test_results_emailable` only checked `test.status == "completed"` —
not the same gate as "decided". A completed, unvalidated official test
resolves to `RESULT_VIEW_PENDING` for its own candidate everywhere else in
this file (`GET /tests`, `GET /tests/{id}`), but `email_test_results`
computed that same `candidate_view` and then checked it only against
`ResultDisclosure.NONE.value` — not `RESULT_VIEW_PENDING` — so an officer
could email a candidate a scorecard the read endpoints were still
withholding pending validation. Worse than the read path in one respect:
`result_text`/`score_text`, the email's headline summary line, are computed
directly from `test.result`/`test.overall_score` rather than through
`redact_test_for_view`, so even the `scores`/`pending` redaction the read
endpoints apply to the JSON payload never touched the email's own pass/fail
and percentage line — only the detailed section breakdown was redacted.
**Fixed** by extracting the check into `_ensure_disclosure_allows_email()`
and calling it with the already-computed `candidate_view`, now testing
`candidate_view in (ResultDisclosure.NONE.value, RESULT_VIEW_PENDING)`. Guard
tests in `test_skill_test_email_security.py` pin the pending and none cases
as rejected and scores/full as accepted.

### SKT4-5 — MED/HIGH — `result_disclosure`/`result_release` accepted any string, fail-open on a typo — ✅ FIXED

Both fields were a bare `Optional[str]` on every write-side schema
(`SkillTemplateCreate`, `SkillTemplateUpdate`, `SkillTestCreate`,
`SkillTestUpdate`) with no validation against `ResultDisclosure`/
`ResultRelease`. `redact_test_for_view` only special-cases the literal
strings `"pending"` and `"scores"` — `if view != ResultDisclosure.SCORES.value:
return payload` is the last branch, so any other string, including a typo
like `"Full"` or `"on-release"`, returns the **unredacted** payload.
Independently, `resolve_result_view` only honours the release hold when
`release == ResultRelease.ON_RELEASE.value` exactly, so an unrecognised
release value behaves as immediate release, silently bypassing an
`on_release` policy. This is fail-open on the exact kind of input error a
human officer typing a policy value into a form (or a client bug) would
produce — a typo does not raise an error, it silently grants full
disclosure. **Fixed** by adding a `field_validator` to `result_disclosure`
and `result_release` on all four write schemas, rejecting any value outside
`{e.value for e in ResultDisclosure}` / `{e.value for e in ResultRelease}`
with a 422 (mirroring the existing `SkillCriterionSchema.type`/`score_mode`
validators' exact pattern in the same file) — `None` (inherit the default)
still passes. Response schemas (`SkillTemplateResponse`, `SkillTestResponse`)
are deliberately left unvalidated: they report already-accepted values via
`from_attributes`, and validating a response schema would make deserializing
any pre-existing row with a legacy or already-bad value raise instead of
serialize. Guard tests in `test_skill_result_disclosure_validation.py` pin
every enum member as accepted, several typo/case-mismatch values as
rejected on all four schemas, and that the schema's whitelist stays
identical to the enum (so the two cannot drift apart the way this bug's
absence let them).

**Round 5 follow-up — write-time validation alone was not the whole fix.**
Codex correctly pointed out that the four new `field_validator`s only stop a
_new_ bad value from being saved; they do nothing for a row already written
before the validators existed (a pre-fix bug, a direct DB edit, a migration
mistake), and `resolve_disclosure_policy` still read such a value verbatim.
**Fixed** by failing closed at resolution time too: `resolve_disclosure_policy`
now checks its resolved `disclosure`/`release` against the same enum
membership and substitutes the most restrictive safe default —
`ResultDisclosure.NONE.value` for an unrecognised disclosure,
`ResultRelease.ON_RELEASE.value` (requires an explicit release rather than
exposing immediately) for an unrecognised release — regardless of which of
the three sources (test, template, org config) the bad value came from. Three
new guard tests in `TestPolicyResolution` cover a corrupted test-level
disclosure, a corrupted release value, and a corrupted template-level value.

**Round 6 follow-up — the round-4 fix introduced its own new gap.** Codex
review on the same commit pointed out that `_validate_result_disclosure_value`/
`_validate_result_release_value` embed the rejected value verbatim in their
`ValueError` message, matching this file's own pre-existing `type`/
`score_mode` validator style — but unlike `type` (`Field("pass_fail",
max_length=50)`), `result_disclosure`/`result_release` had no `max_length`
before round 4's fix added the validators, so nothing capped how large that
embedded value could be. The global 422 handler (`main.py`) routes a custom
validator's `ValueError` through `sanitize_error_message`, which scans the
message against `_UNSAFE_PATTERNS` — including `\bSELECT\b.*\bFROM\b` — and
only checks its own 300-character cap _after_ that scan. A long adversarial
string containing repeated `"SELECT "` with no `"FROM"` makes that pattern's
backtracking superlinear in the input length: Codex measured 6.43 seconds for
a 64 KB payload, on an endpoint (`POST /tests`) open to every member, not
just officers. This is a regression introduced by round 4's own fix, not a
pre-existing gap — before that fix these fields accepted anything, so no
`ValueError` (and therefore no call into `sanitize_error_message`) was ever
reachable through them. **Fixed** by adding `max_length=50` to
`result_disclosure`/`result_release` on all four write schemas — ample for
the real enum values (`on_completion` is the longest, at 13 characters), far
too short for the regex behind this pattern to matter. Pydantic enforces
`max_length` before a field's `@field_validator` runs, so an overlong value
now fails with a `string_too_long` error, which the 422 handler maps to a
fixed constant message (`"Value is too long."`) — never reaching
`sanitize_error_message` at all. One new guard test asserts the failure type
is `string_too_long`, not the custom validator's `value_error`, on all four
schemas.

### SKT4-6 — MED — voiding an unvalidated test disclosed it in full to the candidate — ✅ FIXED

`void_test` overwrites `test.status` to `SkillTestStatus.VOIDED.value`
unconditionally — including for the exact case its own docstring names as
"the rejection path for a member-run result an officer declines to
validate," i.e. a completed test that was never validated. But
`is_pending_validation()` and `is_under_correction()` both key on
`status == "completed"`/`"in_progress"`, so once voided, **both** return
`False` regardless of whether `validated_at` was ever set —
`resolve_result_view` then fell through to `return disclosure`, the fully
open default. A candidate whose unvalidated submission an officer rejected
by voiding it could read the full scorecard, examiner notes, and
`void_reason` — directly contradicting `notify_candidate_result_voided`,
which explicitly refuses to notify on this exact case ("an unvalidated
official result was only a pending placeholder, so even its withdrawal ...
must remain undisclosed"): the read path and the notification path
disagreed about whether this event was disclosable. **Fixed** by adding a
check in `resolve_result_view` — `status == VOIDED and validated_at is
None` → `RESULT_VIEW_PENDING` — mirroring `notify_candidate_result_voided`'s
own rule exactly rather than inventing a new one. A test voided _after_
being validated is unaffected and still discloses normally: only a result
nobody ever accepted is protected. Five guard tests added to
`test_skill_result_disclosure.py`'s new `TestVoidedBeforeValidation` class,
covering the candidate, a named viewer, the previously-validated
counter-case, and that the examiner/officer are unaffected.

**Round 5 follow-up — the view alone was not the whole fix.** Codex correctly
pointed out that `_build_test_response` populates `status`, `void_reason`,
`voided_at`, `voided_by`, and `voided_by_name` from the raw test row
unconditionally, and `redact_test_for_view`'s `pending` branch — the one this
fix routes an unvalidated void through — clears `result`/`overall_score`/
`section_results`/`notes`/etc. but never touched any of those five fields. A
candidate reading the pending view of a voided-unvalidated test would still
see `status="voided"` plus the officer's reason and name, which is exactly
what this finding exists to prevent and exactly what `notify_candidate_result_voided`
already refuses to disclose. **Fixed** by extending `redact_test_for_view`'s
`pending` branch: when the withheld payload's `status` is `voided`, it is
rewritten to `completed` (an ordinary awaiting-validation submission, not a
tell) and the four void-specific fields are cleared, same as the ordinary
pending fields already were. Scoped to the `pending` branch only — a
previously-validated void reaching `full` view is unaffected, since that
withdrawal is legitimately disclosable. Two new tests: one drives a full
voided payload through `redact_test_for_view` directly and asserts every
void field is scrubbed alongside the ordinary pending redaction, one asserts
a `full`-view payload is untouched.

**Round 7 follow-up — the round-5 fix disguised the status but not the
consequence.** `_build_test_response` computes `pending_validation=
is_pending_validation(test)` **before** this redaction runs, and that helper
keys on `status == "completed"` — false for the still-`voided` ORM row, so
the response carried `pending_validation=False` regardless of what this
branch then rewrote `status` to. The round-5 fix left that combination
intact: a redacted payload reading `status="completed"` with
`pending_validation=False` is indistinguishable from a genuinely decided
result, and Codex traced that `MySkillTestResultPage` renders exactly that
combination as final, displaying the rewritten `"incomplete"` result as a
**failure** — the opposite of undisclosed, and arguably worse than the
original leak for a candidate whose test actually passed. **Fixed** by
setting `pending_validation = True` inside the same status-rewrite branch, so
the disguise is consistent across every field the frontend reads to decide
finality, not just the ones a human reviewer thinks to check by hand. One new
guard test.

### SKT4-7 — MED — `PUT /tests/{id}` lets a member-examiner set `status`/`result`/`overall_score` directly, bypassing `complete_test` — ✅ FIXED (2026-10-05)

**Resolved (owner decision):** `update_test` refuses `result`, `overall_score` and any `status` other than `in_progress` with a 400 ("… cannot be saved directly. Finish the test to record its outcome."); the outcome is recorded only by `complete_test`. `status: "in_progress"` stays, because the examiner screen sends it to start a draft. The frontend `SkillTestUpdate` type no longer carries the refused fields. Tests: `TestOutcomeIsNotSavedDirectly`. As found:

`_authorize_test_write` permits any member holding `examiner_id` on an
unvalidated test to call `update_test`, and `SkillTestUpdate.status`,
`.result`, and `.overall_score` are all plain, unrestricted optional fields
that the handler assigns directly to the ORM row. `complete_test` is the
dedicated endpoint that computes a result from `section_results` and sets
`completed_at` — but nothing requires going through it: an examiner can
`PUT` a test straight to `status="completed"` with a hand-picked `result`/
`overall_score` and no `section_results` to justify them, and the officer
`bulk_validate_tests`/`validate_test` path trusts and can credit that stored
result exactly as if `complete_test` had produced it honestly. This is a
data-integrity gap, not a disclosure one — an examiner (not necessarily the
candidate; the self-scoring guard in `_authorize_test_write` only blocks the
candidate from writing their own official test) could fabricate a result
without ever running the criteria that would justify it. **Not fixed in
this pass**: closing it means deciding which fields a bare `PUT` may still
set (in-progress fields like `notes`/`elapsed_seconds`/draft
`section_results`, presumably) versus which must route through
`complete_test`'s own computation — a state-machine and API-contract
decision, not a same-commit fix, and the kind of thing a wrong guess could
break every legitimate incremental-save flow this endpoint already serves.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### Corrections to prior write-ups

None to passes 1-3. Within this pass's own first draft, before this PR merged:
three Codex review rounds caught eight mis-scoped claims or missed findings,
all corrected in place rather than recorded as a separate historical
correction, since no inaccurate version of this document was ever the merged
state. Round 1: the JSON-body-size "no finding" call (reclassified as
SKT4-1), and the audit-log site enumeration's
`email_test_results`/`complete_test`-vs-`validate_test`/`release_test_results`
errors. Round 2: round 1's own fix to the audit-log enumeration had
overcorrected by dropping `add_test_viewer` instead of evaluating it (restored
as an 8th site, `viewer_name`); the `GET /summary` query count was a flat six
instead of the actual up-to-eight across its two conditional branches; the
`SEC4-1` line citation had drifted to the diff's own blank-comment-line
insertion (3157 → 3167); and the frontend scope count was seven instead of
nine, omitting two `apiCache.ts`/`apiCache.test.ts` changes this feature's own
PHI-cache control lives in (verified as other features' additions, not a
change to this feature's own exclusion line). Round 3: two genuinely new
findings this pass's "clean"/"no finding" first-draft language had missed
outright — **SKT4-2** (`PUT /tests/{id}`'s result arrays, member-reachable,
same shape as SKT4-1) and **SKT4-3** (`GET /summary`'s small-cohort
disclosure) — plus a scope gap in **SKT3-2** (below), which covered only
`GET /tests` when `GET /tests/export/csv` shares the identical unbounded-query
root cause. Round 4: three real code bugs (SKT4-4, SKT4-5, SKT4-6, all fixed
— see each finding's own section), plus SKT4-1/SKT4-2/SKT3-2 all widened
again (`checklist_items`, `result_viewer_positions` and its create route,
`GET /templates`), and one more flagged finding (SKT4-7). Round 5: SKT4-5's
and SKT4-6's round-4 fixes were each real but incomplete — SKT4-5 validated
new writes but left a stored legacy value fail-open, SKT4-6 hid the score
but left the void's own status/reason/officer-name visible — both closed
with a second, narrower fix (see each finding's "Round 5 follow-up"). Also
round 5: this section's own "Backend: one line changed" scope-check claim
was, without qualification, read as describing the merged state rather than
the pre-review starting point — annotated in place rather than reworded,
since it is an accurate description of that starting point and the
qualification is what was missing, not the claim itself. Round 6: round 4's
own fix to SKT4-5 had introduced a new gap rather than left one open — the
validators it added embedded the rejected value verbatim in a `ValueError`
with no `max_length` capping how large that value could be, and the global
422 handler's sanitizer scans such messages with a regex vulnerable to
superlinear backtracking on adversarial input before it enforces its own
length cap (see SKT4-5's "Round 6 follow-up"). Round 7: round 5's own fix to
SKT4-6 disguised `status` correctly but left `pending_validation` computed
from the pre-redaction row, so the redacted payload combined "completed"
with "not pending" — read by the frontend as a final, failed result rather
than the undisclosed one intended (see SKT4-6's "Round 7 follow-up").

### SKT3-2 — LOW/MED — `GET /tests`, `GET /tests/export/csv`, and `GET /templates` have no pagination or result cap — ✅ FIXED 2026-10-05 (owner decision)

Re-verified, not re-derived: read `list_tests` (`skills_testing.py:978-1198`)
directly end to end this pass. No `.limit()`/`.offset()` anywhere in the
function; the batch `User` and `SkillTemplate` fetches and the per-row
`resolve_result_view()` loop are unchanged from pass 3's description.
`skillsTestingService.getTests()` (frontend) still accepts no paging
parameter, and `SkillsTestingTestRecordsTab.tsx`'s default "All" filter still
calls `GET /tests` with zero query params. No code or scope change since
pass 3 — the finding, its severity, and its original scope all stand
unchanged. Left open for the same reason pass 3 gave: closing it needs a
paging contract, a chosen default/cap, and a coordinated frontend change — a
product decision, not a same-commit fix.

**Scope extended this pass, on Codex review:** `export_tests_csv`
(`skills_testing.py:3230-3325+`) builds the identical unbounded
`select(SkillTest).where(organization_id == ...)` shape — no `.limit()`,
optional filters (`status`, `candidate_id`, `template_id`, date range) that
default to none applied — then loads every matching row, resolves a batch
`User`/`SkillTemplate` map, and streams every row (or, for `detail=criteria`,
every criterion within every row) into a `StringIO` buffer. `training.manage`-
gated, unlike `GET /tests`, so the exposed population is smaller (officers
only) but the per-request cost is higher (row expansion into CSV text, held
in memory, then duplicated by `output.getvalue()`). This pass's first draft
described SKT3-2 as scoped to `GET /tests` alone and left the export
unexamined — the same root cause (no cap on the base query) reaches both
routes, so `docs/KNOWN_LIMITATIONS.md`'s entry now names both. Closing this
half needs the same kind of product decision as the list endpoint: a required
bounded filter (e.g. a mandatory date range past some org-size threshold) or
genuine streaming from the database rather than a fully-materialized query —
not a same-commit fix.

**Scope extended again, round 4:** `GET /templates` (`list_templates`,
`skills_testing.py:326-390`) shares the same root cause a third time. Its
query has no `.limit()` either, and it is worse than the two above in one
respect: it is open to `get_current_user` (every member, like `GET /tests`,
not officer-only like the export), and it loads each template's **full**
`sections` JSON — the exact structure SKT4-1 has no size cap on — before
doing visibility filtering and section/criteria counting in **Python**, so a
large template (or simply an accumulated catalog of them) costs every caller
the full deserialization, including for `officers_only`/`assigned_only`
templates a non-officer caller will have filtered out of the response
anyway. Included in this finding's scope and its `docs/KNOWN_LIMITATIONS.md`
entry, which now names all three routes. Closing it needs the same kind of
remedy as the others — paging, or selecting bounded summary columns instead
of the full row — not a same-commit fix.

**Resolved 2026-10-05, on the owner's decision: limit/offset with frontend
pagination, and a required date window on the export.**

- `GET /tests` now returns `{items, total}` instead of a bare list, takes
  `limit` (default 50, at most 200) and `offset`, and orders by
  `created_at DESC, id DESC` so a page boundary is stable. For an officer the
  page and the count are SQL `LIMIT`/`OFFSET` and `COUNT(*)`. For a non-officer
  the disclosure pass still cannot run in SQL, so the narrowed candidate rows
  (their own tests and the ones granted to them) are resolved first and then
  counted and sliced — `total` is what the reader may see, never a count that
  includes withheld results. Both paths load list columns only
  (`load_only`), not the template snapshot or section-result JSON, and the
  name lookups are for the page's rows only. New `search` (template,
  candidate or examiner name, through `like_pattern`) and `date_from`/
  `date_to` parameters move the records tab's filtering to the server, since a
  browser-side filter would only search the page on screen. Non-officer
  disclosure behaviour is unchanged: same grant clauses, same
  `resolve_result_view` per row, same pending redaction.
- `GET /tests/export/csv` refuses (400) without both `date_from` and
  `date_to`, or with a window over `EXPORT_MAX_SPAN_DAYS` (366, the finance
  export's synchronous ceiling). The list and the export share one filter
  helper (`_apply_test_filters`), so the file is the rows the tab shows. The
  date both filter on is `COALESCE(completed_at, created_at)` — completion for
  a finished test, as the export already used, and opening for an unfinished
  one, which a completion-only filter would have hidden from every dated view.
- `GET /templates` keeps its bare-list shape — every screen reading it
  searches the whole library client-side — but takes `limit` (default and
  cap 500) and `offset`, orders by `name, id`, and applies the member
  visibility rule in SQL before the limit rather than in Python after the
  fetch, so a member's page is never padded with templates they cannot see.
- Frontend: `SkillsTestingTestRecordsTab.tsx` pages through the server
  (`Pagination`, `DEFAULT_PAGE_SIZE`/`PAGE_SIZE_OPTIONS`), searches server-side,
  and gains a `DateRangePicker` defaulting to the last twelve months; Export
  carries that range and the tab's filters, and is a disabled button that says
  why when there is no range or it is over a year. The Needs Validation deep
  link opens undated so the queue still matches the tile's count. The member's
  My Results tab and `MySkillTestsList` on My Training page too.

Guard tests: `backend/tests/test_skill_test_list_paging.py` (paging, total,
cap, org scoping, member total, server search, date window, export refusal and
span cap, template paging and visibility-before-limit);
`SkillsTestingTestRecordsTab.test.tsx`, `SkillsTestingPage.test.tsx`,
`MySkillTestsList.test.tsx` and `skillsTestingStore.test.ts` on the client.

## Guard tests added

Round 4 turned up three real code bugs (SKT4-4, SKT4-5, SKT4-6), each fixed
with its own guard tests:

- `test_skill_test_email_security.py` — three new tests pinning
  `_ensure_disclosure_allows_email()`: a pending view is rejected, a none
  view is rejected, scores/full are accepted (SKT4-4).
- `test_skill_result_disclosure_validation.py` — new file. Every
  `ResultDisclosure`/`ResultRelease` member is accepted on all four
  write-side schemas, several typo/case/separator variants are rejected on
  all four with the expected error text, omitting either field is still
  accepted, and the schema's whitelist is asserted equal to the enum so the
  two cannot silently drift apart again (SKT4-5).
- `test_skill_result_disclosure.py` — new `TestVoidedBeforeValidation`
  class, five tests: the candidate and a named viewer both see
  `RESULT_VIEW_PENDING` for an unvalidated void, a previously-validated void
  still discloses normally, and the examiner/officer are unaffected (SKT4-6).

Round 5 found each of SKT4-5 and SKT4-6's first fixes was incomplete, not
wrong — both closed with a second, narrower fix and two more guard tests
apiece:

- `test_skill_result_disclosure.py`'s `TestPolicyResolution` — three new
  tests: a corrupted test-level disclosure, a corrupted release value, and a
  corrupted template-level disclosure all fail closed through
  `resolve_disclosure_policy` (SKT4-5 follow-up).
- `test_skill_result_disclosure.py`'s `TestVoidedBeforeValidation` — two new
  tests: `redact_test_for_view` scrubs `status`/`void_reason`/`voided_at`/
  `voided_by`/`voided_by_name` for a voided payload in the `pending` view,
  and leaves them alone in `full` view (SKT4-6 follow-up).

Round 6 found round 4's own SKT4-5 fix had opened a new gap, not left one
incompletely closed:

- `test_skill_result_disclosure_validation.py` — one new test: an overlong
  `result_disclosure` fails with Pydantic's `string_too_long` (a fixed,
  constant-message error type) on all four write schemas, not the custom
  validator's value-embedding `value_error` (SKT4-5 round-6 follow-up).

Round 7 found round 5's own SKT4-6 fix disguised `status` but left
`pending_validation` inconsistent with it:

- `test_skill_result_disclosure.py`'s `TestVoidedBeforeValidation` — one new
  test: `redact_test_for_view` flips a `False` `pending_validation` to `True`
  when it rewrites a voided payload's status (SKT4-6 round-7 follow-up).

The six pre-existing guard test files from passes 1–3 were re-run, not
re-written.

## Completion gate (pass 4, final)

| Check                                             | Result                                                                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations (`flake8==7.3.0`, CI's pin)                                                                                                                                                              |
| `black --check app/ tests/ alembic/`              | ✅ 1578 files unchanged (`black==26.5.1`, CI's pin — installed explicitly; a stale `26.3.1` shadowed it on `PATH` via `~/.local/bin`, invoked `/usr/local/bin/black` directly to get the pinned version) |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (`isort==9.0.1`, CI's current pin)                                                                                                                                                              |
| `python3 scripts/validate_migrations.py --strict` | ✅ 443 revisions, single head `0533644945cd` — no new migration (Pydantic-level validation only, no column/schema change)                                                                                |
| `pytest tests/ -q -k "skill"`                     | ✅ 435 passed, 1 skipped (pre-existing optional-dependency skip) — up from 405 at round 3, the 30 new guard tests above                                                                                  |
| `cd frontend && npm run typecheck`                | ✅ 0 errors (unaffected — no frontend file touched this pass)                                                                                                                                            |
| `cd frontend && npm run lint`                     | ✅ 0 errors, 0 warnings (unaffected — no frontend file touched this pass)                                                                                                                                |

Full backend suite not re-run beyond the `-k skill` scope: `app/schemas/
skills_testing.py` and `app/services/skills_testing_service.py` have no
consumer outside `app/api/v1/endpoints/skills_testing.py` itself (checked via
`grep -rl` for both modules across `app/`), so the skill-scoped run is the
full surface these fixes could affect.

**Final disposition: 3 real code fixes (SKT4-4, SKT4-5, SKT4-6, all MED or
MED/HIGH — SKT4-5 closed in three steps, SKT4-6 in three), 4 findings
flagged (SKT4-1, SKT4-2, SKT4-3, SKT4-7), 1 existing finding's scope extended
three times over (SKT3-2), across seven Codex review rounds.** All six pass
1–3 fixes re-verified intact by direct code read. None of this pass's
"clean"/"no finding" first-draft language survived review unchanged — every
one of rounds 1 through 7 found something the previous draft had gotten
wrong, missed outright, fixed only halfway, or broke while fixing something
else: an officer could email a candidate a result the read endpoints were
still withholding (SKT4-4); a typo in a disclosure-policy field silently
granted full disclosure instead of being rejected — including one already
sitting in the database, which round 5 caught the first fix had no answer
for, and the fix for _that_ introduced an unbounded field a regex-based error
sanitizer could be made to backtrack superlinearly against, which round 6
caught (SKT4-5); and voiding an unvalidated submission disclosed it in full
rather than staying undisclosed like the notification path already assumed —
round 5 caught that the first fix hid the score but not the withdrawal
notice itself, and round 7 caught that _that_ fix disguised `status` but left
`pending_validation` reading the payload as a final, failed result instead of
an undisclosed one (SKT4-6). This pass's actual value was almost entirely
produced by the review process rather than by the original re-verification
work — the backend surface itself had exactly one line of unrelated change
across three prior passes and roughly two weeks, and needed seven rounds of
adversarial review on a "nothing to see here" docs PR to surface three real
defects, get each genuinely and completely fixed rather than half-fixed or
newly-broken, and flag four more that need a product/content decision this
rotation correctly declined to guess at.

---

## Pass 5 (2026-09-15)

**Prefix:** `SKT5` · **PR:** TBD

**Scope check:** diffed the current tree against `4c4253cc0c77` (the pass-4
merge commit, PR #2473). `app/models/skills_testing.py` is byte-identical; no
new migration touches a skills-testing table. Unlike passes 2–4, this is
**not** a zero-diff pass: one real feature commit landed directly on `main`
since pass 4 — `7cf5f1cbb` ("Skills testing: block blank scorecards, state why
a test failed", 2026-09-12, not itself a security-review commit) — touching
`app/api/v1/endpoints/skills_testing.py` (+54/-7), `app/schemas/skills_testing.py`
(+56), and `app/services/skills_testing_service.py` (+152/-10), plus 12
frontend files and a `docs/UPGRADING.md` entry. Read the full diff directly
(`git diff 4c4253cc0c77..7cf5f1cbb -- <each backend path>`), not the commit
message alone.

**What the commit does:** completion (`POST /tests/{id}/complete`) now refuses
a scorecard with any unmarked, non-statement step (400, listing them), and
introduces a **waiver**: `CriterionResultSchema.waived: Optional[bool]` +
`waive_reason: Optional[str] = Field(None, max_length=500)`, letting an
examiner record a step as not-observed (excluded from both the earned and
available point pools) with a required reason. A **critical** step can never
be waived — `waived_critical_criteria()` blocks completion if one is. Also
added: `SkillCriterionSchema.validate_scoring_bounds` (rejects
`passing_score > max_score` and a `score`-type criterion with no positive
`max_score`, both previously silent at scoring time), and
`CriterionResultSchema.score` gained a `ge=0` floor (previously unbounded
below) with the earned total separately clamped to each step's point value in
`build_score_breakdown` (`min(float(recorded), point_value)`) so an
over-`max_score` submission can no longer push a percentage past 100. All new
numeric/enum validation lands on `model_validator`/`field_validator`s in the
same file and style as the existing `type`/`score_mode`/`result_disclosure`
validators — no parallel scoring path introduced (Pitfall #29: the single
`calculate_test_result` → `build_score_breakdown` pipeline still computes both
the stored `overall_score` and the displayed breakdown from the same
arithmetic; verified by reading `calculate_test_result`, which still just
calls `build_score_breakdown` and reads its `percentage`/`meets_threshold`/
`critical_failures` keys — nothing recomputes a score independently).

### Re-verification of pass 1–4 fixes

Read the current code directly for each:

- **SKT-1** — `update_template` still routes through `apply_updates`
  (`skills_testing.py:700`).
- **SKT-2** / **SKT-3** — `void_test` and `return_test_for_correction` still
  call `assert_different_person(...)` before any mutation (`:2762`, `:2932`,
  confirmed by direct grep of all four `assert_different_person` call sites:
  `create_test:1315`, `validate_test:2115`, `void_test:2762`,
  `return_test_for_correction:2932`).
- **SKT-4** — `lock_attempt_capacity`'s `TrainingRequirement` lock and
  `assert_attempts_remaining`'s `.with_for_update(of=SkillTest)` count are both
  still present (`skills_testing_service.py:751`, `:857`).
- **SKT2-1** — zero `is_practice ==` comparisons in the endpoint file (`grep -c`
  returns 0); still `.is_(...)`.
- **SKT3-1** — `add_test_viewer` still rejects naming the examiner
  (`skills_testing.py:2491`).

All standing guard-test files re-run clean (see completion gate). **Route
surface unchanged: 29/29**, re-enumerated with a fresh `ast` walk over every
`@router.<verb>` decorator and its `Depends(...)` defaults — same paths, same
methods, same gates as every prior pass's table.

### SKT5-1 — MED — the `scores` disclosure view did not redact the new `waive_reason` field — ✅ FIXED

**What:** `redact_test_for_view`'s `scores` branch (the tier a department can
configure so a candidate sees marks and points but not written commentary) has
scrubbed each criterion's `notes` field since before this rotation began, and
its own docstring states the contract: "removes every piece of written
commentary while leaving the marks and points intact." The 2026-09-12 commit
added a second free-text field to the exact same `criteria_results` entries —
`waive_reason`, the examiner's required explanation of why a step could not be
observed — but did not add it to this function's per-criterion scrub, which
still only clears `notes`.
**Where:** `app/services/skills_testing_service.py:1275-1277` (the
`criteria_results` loop inside `redact_test_for_view`'s `scores` branch).
**Failure scenario:** an organization configures (or a template/test sets)
`result_disclosure: "scores"`. An examiner marks a step `waived: true` with
`waive_reason: "Could not verify — candidate was on the roof, no visual"` (or
anything else an examiner might write believing it is reviewer-only
commentary, the same category `notes` already exists to protect). The
candidate requests their own result: `resolve_result_view` returns
`"scores"`, `redact_test_for_view` nulls `notes` at every level but leaves
`waive_reason` on the criterion untouched, and the candidate reads the
examiner's free-text explanation directly in the API response — precisely the
disclosure tier's own stated guarantee, broken for one specific field added
after the function was last touched.
**Impact:** a written-commentary leak under a `scores`-only disclosure policy,
the same class of defect `test_scores_view_drops_every_note` and
`test_scores_view_drops_the_section_review_note` exist to prevent for `notes`
— just not extended to the sibling field added three days before this pass.
No privilege escalation and no cross-tenant exposure; confined to a
candidate's own test, under one specific disclosure configuration, to one new
field.
**Fix:** added `scrubbed["waive_reason"] = None` immediately after
`scrubbed["notes"] = None` in the same loop — identical pattern, same
function, same branch. The `waived` boolean itself is left visible (a mark,
not commentary, matching how `passed`/`score` already survive this
redaction). Guard test:
`TestRedaction::test_scores_view_drops_the_waive_reason` in
`tests/test_skill_result_disclosure.py`, confirmed to fail against the
pre-fix code (`git stash push -u` on the service-file fix, re-run, restored)
before the fix landed.

### SKT4-7 — MED — pass 5 note: the new completion guard is also bypassed by `PUT /tests/{id}`

Re-read against the current code, not just re-cited: the finding stands
exactly as pass 4 described it (`_authorize_test_write` still lets any
member holding `examiner_id` on an unvalidated test call `update_test`, and
`SkillTestUpdate.status`/`.result`/`.overall_score` are still unrestricted
fields the handler assigns straight to the ORM row with no route through
`complete_test`). What changed since pass 4: `complete_test` now runs the
2026-09-12 commit's `unresolved_criteria`/`waived_critical_criteria` checks
(see the pass-5 scope note above) — but **only inside `complete_test`**.
`update_test` applies no equivalent check anywhere in its body. An examiner
who was already able to fabricate a result via a direct `PUT` (the original
SKT4-7 finding) can therefore also bypass the brand-new anti-blank-scorecard
and anti-waived-critical-step guards the same release built specifically to
stop a silently-wrong result from being filed — the two problems compound
rather than sitting side by side, since the new guard's entire purpose is to
catch exactly the kind of scorecard a bare `PUT`-to-`completed` can file
without ever passing it. Confirmed no frontend caller exercises this path: `ActiveSkillTestPage.tsx`
has two direct `updateTest(...)` calls (both send `status: 'in_progress'`)
and five more that go through its `saveTest()` wrapper (`section_results`/
`elapsed_seconds`/`notes`/`resumed`-shaped payloads only) — none of the
seven ever sends `status: 'completed'`; that transition is always requested
through the dedicated `completeTest()` call. So the gap is API-surface-only,
not something the shipped UI does today. Left **OPEN /
FLAGGED**, not fixed, for the same reason pass 4 gave: the correct remedy —
whether `update_test` should refuse `status: "completed"` outright and
require the dedicated endpoint, or should itself run the same two guard
functions before accepting that transition — is the state-machine/API-contract
decision pass 4 already declined to guess at, and this pass's finding is a
widening of that same open question rather than a new one requiring a
different remedy. `docs/KNOWN_LIMITATIONS.md`'s SKT4-7 entry updated to name
this.

### Corrections to prior write-ups

None. Passes 1–4's findings, fixes, and flagged items are all re-verified
intact above; nothing in this pass contradicts anything a prior pass recorded.

## Guard tests added

- `tests/test_skill_result_disclosure.py::TestRedaction::test_scores_view_drops_the_waive_reason` —
  asserts `redact_test_for_view(..., "scores")` clears `waive_reason` while
  leaving the `waived` flag itself visible (SKT5-1).

## Completion gate (pass 5)

| Check                                               | Result                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                       | ✅ 0 violations                                                                 |
| `black --check app/ tests/ alembic/`                | ✅ unchanged                                                                    |
| `isort --check-only app/ tests/ alembic/`           | ✅ clean                                                                        |
| `python3 scripts/validate_migrations.py --strict`   | ✅ 444 revisions, single head `6ab7d903fae5`                                    |
| `pytest tests/ -q -k "skill"`                       | ✅ 464 passed, 1 skipped (pre-existing optional-dependency skip)                |
| `pytest tests/ -q` (full backend suite)             | ✅ 12578 passed, 21 skipped (pre-existing Docker/no-MySQL/optional skips), 356s |
| `cd frontend && npm run typecheck` / `npm run lint` | not run — no frontend file touched this pass                                    |

**Final disposition: 1 real fix (SKT5-1, MED), 1 standing finding widened in
place (SKT4-7, still OPEN/FLAGGED, now also covers the new completion-guard
bypass), 0 findings closed, 0 new flags beyond the widening.** All six
pass 1–3 fixes and all four pass-4 fixes re-verified intact by direct code
read; all four still-open pass-3/pass-4 flags (SKT3-2, SKT4-1, SKT4-2,
SKT4-3) re-confirmed unchanged in scope (no code touching their surfaces
changed since pass 4, beyond the `score`/`checklist_completed`-adjacent
tightening this pass's SKT5-1/SKT4-7 sections already account for).

---

## Pass 6 (2026-10-02)

**Prefix:** `SKT6` · **PR:** TBD

**Scope check:** the backend surface has no merge-commit SHA to diff against
cleanly — this repository's branch-merge history for this file does not
resolve to a single prior commit via `git log --follow` (a pre-existing
artifact of how feature branches land here, unrelated to this feature), so
scope was established by walking every commit that has touched each of the
four backend files since pass 5 directly (`git log -- <path>`), not by a
`git diff <sha>..HEAD`. Result: **one** commit touched this feature's backend
surface since pass 5 — `6d2a24ec6` ("Redesign every email onto the solid-tab
shell", 2026-09-27), which rewrote `email_test_results`'s HTML construction
onto the new shared `wrap_email_body`/`facts()` email-theme kit (+34/-35 lines
in `app/api/v1/endpoints/skills_testing.py`). `app/services/skills_testing_service.py`,
`app/schemas/skills_testing.py`, and `app/models/skills_testing.py` are
**untouched** since pass 5 (`git log` on each shows no commit past the one
already covered by pass 5's own history). No new migration touches a
skills-testing table (`validate_migrations.py --strict`: 497 revisions, up
from pass 5's 444, entirely other features' work — single head, re-confirmed
below).

**Frontend:** re-swept the full call-site inventory from scratch
(`grep -rli "skillsTesting" frontend/src`, not reused from pass 3's list) —
**22 files**, up from pass 3's 20. The two new entries are
`components/training/ResultVerdictBanner.tsx` (added since pass 3 — read in
full below) and two route-wiring files (`pages/TrainingAdminPage.tsx`,
`modules/training/routes.tsx`) that only `lazyWithRetry()`-import the
already-reviewed tab/page components and make no API call of their own.

### Read in full: the one backend diff

`git show 6d2a24ec6 -- app/api/v1/endpoints/skills_testing.py` read directly,
not summarized from the commit message. The change replaces a hand-built
`<div>`/`<table>` HTML string with calls into the new `app/services/email_theme.py`
kit (`wrap_email_body`, `fact`, `facts`) that the rest of the application's
transactional email is moving onto. Checked specifically for the one thing a
template-system migration like this tends to break — whether escaping
survived the rewrite:

- `fact()`/`facts()` (`app/services/email_theme.py:595-640`) insert their
  `label`/`value` arguments into the returned HTML **verbatim** — confirmed by
  reading both functions directly; the module's own docstring says so
  ("Returned as literal markup... there is no macro for the editor to
  expand"). Escaping is therefore the caller's responsibility, same as before
  this kit existed.
- At the one call site this feature owns, every value derived from
  member-controlled text — `template_name`, `candidate_name`, `examiner_name`
  — is still wrapped in `html.escape(str(...))` before being passed to
  `fact()`, unchanged from the pre-redesign code (`skills_testing.py:3176-3183`).
  `result_text`/`score_text` are formatted from `test.result`/`test.overall_score`
  (an enum-like string and a rounded number), not free text, so they carry
  nothing to escape. The five `fact()` labels ("Template", "Candidate",
  "Examiner", "Result", "Score") are hardcoded literals.
- `sections_html` (the per-criterion result table, built separately and
  concatenated onto the `facts()` output) is untouched by this commit —
  still the same `html.escape(str(label))` per criterion this feature's own
  CS-6 finding fixed years ago.
- The disclosure check this email route depends on (SKT4-4's
  `_ensure_disclosure_allows_email(candidate_view)`, called before any HTML is
  built) is above the diff hunk and untouched.
- `test_type`, interpolated raw into the new heading
  (`f"Skills Test Results — {test_type}"`) and the subject line, is a
  hardcoded `"Practice"`/`"Official"` literal (`skills_testing.py:3065`), not
  client input — confirmed by reading its assignment, not assumed from the
  name.
- Subject-header injection (CRLF in `template_name`, which still reaches the
  subject line unescaped at `skills_testing.py:3205`, unchanged by this
  commit) is handled centrally, not per-caller: `EmailService.send_email`
  runs every subject through `_sanitize_header()` before it reaches the
  transport (`app/services/email_service.py:1385`), confirmed by reading that
  function, so this is not a gap specific to this redesign.

**No finding.** The migration onto the shared email kit preserved every
escaping guarantee this feature's own `email_test_results` route already
depended on; nothing in the new `facts()`/`wrap_email_body()` helpers does
anything this call site relies on them not doing.

### Re-verification of pass 1–5 fixes

Read the current code directly for each, not re-cited from any prior
write-up:

- **SKT-1** — `update_template` still routes through `apply_updates`
  (`skills_testing.py:700`).
- **SKT-2** / **SKT-3** / **create_test's SoD** / **validate_test's SoD** —
  all four `assert_different_person(...)` call sites re-grepped directly:
  `create_test:1315`, `validate_test:2115`, `void_test:2762`,
  `return_test_for_correction:2932` — same four, same lines as pass 5.
- **SKT-4** — `lock_attempt_capacity` (`skills_testing_service.py:718-751`)
  still locks `TrainingRequirement` with `.with_for_update()`; the `spent`
  count in `assert_attempts_remaining` still carries
  `.with_for_update(of=SkillTest)` (`:857`); `validate_test` still calls
  `lock_attempt_capacity` (`:810`) ahead of `_lock_test_for_transition`'s
  per-test lock.
- **SKT2-1** — zero `is_practice ==` comparisons in the endpoint file
  (`grep -c` returns 0); still `.is_(...)` throughout.
- **SKT3-1** — `add_test_viewer` still rejects naming the examiner
  (`str(viewer.id) == str(test.examiner_id)`, `skills_testing.py:2487-2491`),
  immediately after the candidate check, both before the existing-grant
  lookup.
- **SKT4-4** — `_ensure_disclosure_allows_email` still rejects both
  `ResultDisclosure.NONE.value` and the pending view, called with the
  already-resolved `candidate_view` before any HTML is built
  (`skills_testing.py:3098-3099`).
- **SKT4-5** — all four write schemas' `result_disclosure`/`result_release`
  fields still carry `field_validator`s rejecting any value outside the enum,
  **and** `max_length=50` (the round-6 fix) is present on all four
  (`app/schemas/skills_testing.py:200-201, 255-256, 381-382, 406-407`);
  `resolve_disclosure_policy`'s fail-closed substitution for a corrupted
  stored value is unchanged.
- **SKT4-6** — `redact_test_for_view`'s `pending` branch still rewrites a
  voided-before-validation payload's `status` to `"completed"`, clears the
  four void-specific fields, and flips `pending_validation` to `True`
  (`skills_testing_service.py`, the `TestVoidedBeforeValidation` guard class
  still passes — see completion gate).
- **SKT5-1** — `redact_test_for_view`'s `scores` branch still clears
  `scrubbed["waive_reason"]` immediately after `scrubbed["notes"]`
  (`skills_testing_service.py:1276-1281`).

All ten guard-test files from passes 1–5 re-run clean (see completion gate).

**Route surface re-enumerated with a fresh AST walk** (script written this
pass, not a re-read of any prior table — every `@router.<verb>` decorator plus
every `Depends(...)` default among its function's arguments): **29/29
routes**, identical paths, methods, and gates to every prior pass's table.
The file has grown to 3,855 L (from pass 5's size, driven by the
`email_theme.py` migration's net +132 L and ordinary docstring/comment
growth elsewhere) with no new route.

**Org-scoping re-swept mechanically.** Extracted all 82 `select(` call sites
in the endpoint file (`grep -n "select("`) and checked each against the
checklist's two accepted shapes: a direct `organization_id` filter, or
resolution through a `test`/`template` row already fetched org-scoped earlier
in the same function. Every one of the 82 is one of these two shapes — no new
bare by-id query reachable from a client-supplied id. `create_test`'s
`template_id`/`candidate_id`/`requirement_id` in-org validation
(Pitfall #14c) is unchanged.

### Standing flags re-confirmed unchanged, not re-cited

Each read directly against current code rather than trusted from the prior
write-up or `KNOWN_LIMITATIONS.md`:

- **SKT3-2** — `list_tests` (`:1000-1228`), `export_tests_csv` (`:3285-3420`),
  and `list_templates` (`:330-412`) still carry no `.limit()`/`.offset()`.
  Still open, still a product decision (paging contract + frontend change).
  _(Fixed 2026-10-05 on the owner's decision — see pass 4's SKT3-2 entry.)_
- **SKT4-1** — `SkillTemplateCreate.sections`, `SkillTemplateSectionSchema.criteria`,
  and `SkillCriterionSchema.checklist_items` still have no `max_length`
  (confirmed by grepping every `max_length=` in `app/schemas/skills_testing.py`
  and finding none attached to these three fields). Still open.
- **SKT4-2** — `SkillTestUpdate.section_results`, `SectionResultSchema.criteria_results`,
  `CriterionResultSchema.checklist_completed`, and
  `SkillTestCreate`/`SkillTestUpdate.result_viewer_positions` are all still
  uncapped `List[...]` fields; `result_viewer_positions` is confirmed still
  one of the four `_OFFICER_CONTROLLED_TEST_FIELDS` (`skills_testing.py:107-111`),
  so the officer-gate-on-official-tests / member-writable-on-practice-tests
  split this finding describes is unchanged. Still open.
- **SKT4-3** — `get_testing_summary` (`:3592-3690`) still computes `pass_rate`
  and `average_score` from plain aggregate queries with no cohort-size
  suppression and no disclosure resolution. Still open.
- **SKT4-7** — `update_test` (`:1477-1620`) still allows any member holding
  `examiner_id` on an unvalidated test to set `status`/`result`/`overall_score`
  directly; `status`, `result`, and `overall_score` are confirmed absent from
  `_OFFICER_CONTROLLED_TEST_FIELDS`, and the only guard against a bare
  `PUT`-to-`completed` is the already-completed field allowlist, which does
  not fire on the transition itself. `complete_test`'s `unresolved_criteria`/
  `waived_critical_criteria` guards (added 2026-09-12, widened into this
  finding by pass 5) are confirmed to still run **only** inside
  `complete_test` (`:1753-1773`) — `update_test` calls neither. Still open,
  unchanged in scope since pass 5.

### New frontend file read in full: `ResultVerdictBanner.tsx`

Added since pass 3's inventory. Pure presentation: takes `result`, `breakdown`
(`ScoreBreakdown` from the server), `overallScore`, and `isVoided` as props;
makes no API call, holds no state, mutates nothing. Every string it renders —
`criterion_label`, `section_name` from `breakdown.critical_failures` — goes
through JSX text interpolation (auto-escaped), never `dangerouslySetInnerHTML`.
Confirmed these labels are structural template metadata computed server-side
by `build_score_breakdown()` from the template's own step names, the same
category pass 3 already traced and found is correctly _not_ stripped by the
`scores`-view redaction (it is restated arithmetic, not examiner commentary) —
this component does not change what data reaches the client, only how the
verdict headline is laid out. No finding.

### Corrections to prior write-ups

None. Passes 1–5's findings, fixes, and flagged items are all re-verified
intact above; nothing in this pass contradicts anything a prior pass
recorded.

## Guard tests added

None this pass — zero backend behavior changed (the one commit in scope was a
shared-infrastructure migration this feature's own call site already
satisfied), so there is no new class to pin against reintroduction. All ten
standing guard-test files from passes 1–5 re-run clean.

## Completion gate (pass 6)

| Check                                                       | Result                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (`flake8==7.3.0`)                                                                                              |
| `black --check app/ tests/ alembic/`                        | ✅ 1798 files unchanged (`black==26.5.1`)                                                                                      |
| `isort --check-only app/ tests/ alembic/`                   | ✅ clean (`isort==9.0.1`, confirmed against CI's pin in `ci.yml`)                                                              |
| `python3 scripts/validate_migrations.py --strict`           | ✅ 497 revisions, single head `f73b449bdb8b`                                                                                   |
| `pytest tests/ -q -k "skill or skill_testing or evaluator"` | ✅ 464 passed, 1 skipped (pre-existing optional-dependency skip) — identical count to pass 5, confirming no test added or lost |
| `cd frontend && npm run typecheck`                          | ✅ 0 errors (aliased 7.0.2 compiler via `scripts/tsc-native.mjs`)                                                              |
| `cd frontend && npm run lint`                               | ✅ 0 errors, 0 warnings                                                                                                        |

Full backend suite not re-run beyond the `-k skill` scope: zero lines changed
in `app/services/skills_testing_service.py` or `app/schemas/skills_testing.py`
this pass (the one in-scope commit touched only the endpoint file's email
construction, already covered by the skill-scoped run), and neither file has
any consumer outside this feature's own endpoint file (`grep -rl` across
`app/`, unchanged from pass 4's finding). No source file is modified by this
pass at all — every check above is a re-verification against code already on
`main`, not a fix, so there is no diff for a behavior-neutrality comparison.

**Final disposition: 0 fixed, 0 newly flagged, 0 findings closed.** One real
backend commit landed in this feature's files since pass 5 (the email-theme
migration) and was read in full rather than assumed safe from its commit
message; it preserved every escaping guarantee `email_test_results` depended
on. The route surface (29/29), all ten passes 1–5 fixes, and all five
standing flags (SKT3-2, SKT4-1, SKT4-2, SKT4-3, SKT4-7) were re-verified
directly against current code rather than re-cited from this document's own
prior prose. One new frontend file (`ResultVerdictBanner.tsx`) was read in
full and found to introduce no new data-exposure surface.

## New surface (2026-10-06) — offline scoring

Owner decisions skills-offline-read-path / skills-offline-queue-design
(see `docs/SKILLS_TESTING_OFFLINE_PLAN.md` §11). What the next pass should
check, and what the design relies on:

- **Data at rest on a shared device.** Live tests the examiner is examining
  (scorecard, notes, candidate name) are held in IndexedDB
  `logbook-offline-skills`, unencrypted, owner-tagged, and served only to their
  owner. They are cleared by every `purgeLocalMemberData` run, and a finished
  test's copy is deleted. `/api/*` remains `NetworkOnly` in the service worker.
- **No client-side authority.** The queue replays the same `PUT /tests/{id}`
  and `POST /complete` an online examiner sends, with `expected_version`, so
  every server-side rule — the write guard, separation of duties, the attempt
  cap, voided/completed refusals, disclosure — applies on sync unchanged. No
  score is computed on the device.
- **Owner check at send time.** The drain lists only the signed-in member's
  entries and re-checks ownership per entry before sending (FE3-34-5).
- **Refusals are retained.** A refused step keeps its payload for the examiner
  to read or discard; nothing is dropped automatically (offline plan §3.1).
- **Client-minted test ids (2026-10-06, cold start).** `POST /tests` accepts a
  caller-supplied UUID. A replay is honoured only for the same examiner,
  template, candidate and mode in the caller's own department; every other
  holder of the id gets the same 409, so the endpoint cannot be used to probe
  for another department's test ids. Template lookup is org-scoped before the
  id check, separation of duties and the attempt cap run as before, and
  `expected_template_version` refuses a create scored against a sheet that has
  since changed. Guarded by `tests/test_skill_test_client_minted_id.py`.
- **Logout guard (2026-10-06).** An interactive sign-out with unsent
  evaluations is blocked behind a confirmation; choosing to sign out still
  runs the full purge. The idle timeout and expired-session paths purge without
  asking — deliberately unchanged, recorded as an open owner question.

## Pass 7 (2026-10-06)

**Prefix:** `SKT7` · **PR:** TBD

**Scope check:** `git log 8d80b628..HEAD -- app/api/v1/endpoints/skills_testing.py
app/services/skills_testing_service.py app/schemas/skills_testing.py
app/models/skills_testing.py` (8d80b628 = pass 6's merge commit) against the
now-unshallowed history — six commits touched this feature's declared backend
surface since pass 6, all real behavior changes, none a merge-commit
artifact. `app/services/skills_testing_service.py` and
`app/models/skills_testing.py` are untouched (no commit in the range names
either path).

### Read in full, each against current code rather than trusted from its commit message

- **`2b00fdbec` — SKT3-2, paging and export bounds.** `GET /tests` now returns
  `{items, total}`, paged (`limit` 50/200 cap, `offset`), with server-side
  search (`like_pattern(...)`, `escape=LIKE_ESCAPE_CHAR` — Pitfall #25) and a
  `date_from`/`date_to` window shared with `GET /tests/export/csv` via one
  `_apply_test_filters` helper, so the two cannot drift the way EV-16's
  export once did. `GET /templates` gained the same `limit`/`offset` with its
  visibility filter moved into SQL (previously filtered in Python after the
  fetch). For an officer, paging and counting happen in SQL
  (`select(func.count()).select_from(query.subquery())`, then
  `.limit().offset()`), each inheriting the same `organization_id` filter as
  the base query. For a non-officer, the disclosure pass still cannot run in
  SQL (it depends on per-row viewer grants and org config), so the filtered
  rows are resolved first — bounded by the same org/practice/date/search
  predicates, further narrowed to tests the reader is party to or named on
  (`or_(*grant_clauses)`, unchanged from pass 1), loaded via `load_only(*_TEST_LIST_COLUMNS)`
  rather than the full row (skips the JSON template-snapshot and section-result
  columns no list item renders) — then sliced with `visible[offset:offset+limit]`
  after the disclosure filter, so `total` is the count the reader may actually
  see, not the pre-filter row count. `export_tests_csv` now 400s without both
  `date_from`/`date_to` or with a window over 366 days (`EXPORT_MAX_SPAN_DAYS`),
  closing the unbounded in-memory CSV build. Verified the shared
  `_apply_test_filters` is used by both routes (not reimplemented in one) by
  reading both call sites directly. **SKT3-2: FIXED, confirmed.**

- **`5bd06118e` — SKT4-7, a save cannot set a test's outcome.** `update_test`
  now rejects `result`, `overall_score`, and any `status` other than
  `in_progress` with a 400 before any field is applied, closing the path
  where an examiner-holding member could `PUT` a hand-picked `result`/
  `overall_score`/`status="completed"` and skip `complete_test`'s
  unresolved/waived-critical-criteria refusal. Read `update_test` in full
  (`skills_testing.py:1477-1620` region, shifted by the paging diff but same
  function): the refusal runs ahead of the existing "completed tests only
  allow notes" branch and ahead of `_authorize_test_write`'s field-level
  checks, so it cannot be bypassed by an already-completed test's narrower
  allowlist. `status="in_progress"` is still accepted, matching the examiner
  screen's save-draft call. **SKT4-7: FIXED, confirmed.**

- **`5f364b3bc` — SKT4-3, summary outcome figures gated to officers.**
  `get_testing_summary` now computes `pass_rate` and `average_score` only
  when `_can_manage_tests(current_user)`; every other caller gets `None` for
  both, same gate the pending-validation count already used. Read the
  current function: the two aggregate queries (completed+validated count,
  pass count, average score) are now inside the `if` block, not computed
  unconditionally and then withheld — so a non-officer's request never runs
  the query that would have exposed the figure, not merely discarded its
  result. Closes the small-cohort disclosure gap where one validated test
  made the org-wide average exactly that member's score. **SKT4-3: FIXED,
  confirmed.**

- **`2dde9be91` — SKT4-1 / SKT4-2, item caps on sheets and results.** Added
  `max_length` to `SkillCriterionSchema.checklist_items` (100),
  `SkillTemplateSectionSchema.criteria` (200),
  `SkillTemplateCreate`/`Update.sections` (100), `result_viewer_positions` on
  all four schemas (100), and the mirrored result-side fields
  (`CriterionResultSchema.checklist_completed`,
  `SectionResultSchema.criteria_results`, and — confirmed by reading past the
  diff's visible hunk — `SkillTestUpdate.section_results`) at the same caps
  the template side uses, so a valid sheet's result always fits. Confirmed by
  grepping `max_length=` in the current `app/schemas/skills_testing.py`: all
  eight fields SKT4-1/SKT4-2 named now carry one. **SKT4-1, SKT4-2: FIXED,
  confirmed.**

- **`58547c170` — client-minted test ids (offline cold start), reviewed fresh
  rather than accepted from pass 6's addendum.** `create_test` now accepts an
  optional `id` and `expected_template_version`. The id-replay lookup
  (`select(SkillTest).where(SkillTest.id == str(test_data.id))`) is a bare
  by-id query with **no `organization_id` filter at the SQL level** — the
  shape Pitfall #14a and this file's own checklist flag. Read the branch that
  follows it before accepting this: if the fetched row's org, examiner,
  template, candidate and practice-flag don't _all_ match the caller's
  request, the handler raises a generic 409 ("That test id is already in
  use") with no field of the existing row in the response — so a cross-org
  hit returns the same message as a same-org/different-request hit, and
  leaks nothing beyond "this id is taken," which a random v4 UUID does not
  make guessable. The design is deliberate, not an oversight: adding an
  `organization_id` filter to the query would make a cross-org id collision
  invisible to this check, and the subsequent `INSERT` would then fail on
  the primary-key collision with a raw `IntegrityError` instead of a clean
  409 — worse, not safer. The one subsequent read keyed off the existing
  row (`select(User).where(User.id == existing.candidate_id)`) is the
  accepted shape (an id read off a row already confirmed in-org by the match
  check above it), not a second instance of the same pattern. Recorded here
  as **Verified good**, not fixed or flagged, so a future pass does not
  re-flag it without this reasoning. `expected_template_version` refusal and
  the frontend's UUID-minting/replay queue were not re-derived — matches pass
  6's addendum description exactly on reading the diff directly.
  `tests/test_skill_test_client_minted_id.py` covers the cross-org-refusal
  case by name.

- **`f92fbd927` — preferred-name search (incidental touch).** `search_candidates`
  gained an `or_()` branch matching `preferred_name` the same way as
  `first_name`, still `.like(..., escape=LIKE_ESCAPE_CHAR)`, still
  `organization_id`-filtered, still capped at `CANDIDATE_SEARCH_MAX_RESULTS`.
  The response's `name` field changed from `_format_user_name(u)` (legal name)
  to `u.display_name or u.username`, but this endpoint is a test-creation
  candidate picker, not a record of anything — the test itself still files
  the candidate under `_format_user_name` wherever a result is rendered,
  confirmed unchanged at every `_format_user_name` call site in this file.
  No finding.

### Standing flags re-confirmed closed

SKT3-2, SKT4-1, SKT4-2, SKT4-3 and SKT4-7 — every standing flag pass 6 left
open — are fixed by the five commits above. **No standing flags remain open
in this feature.**

### Route surface and org-scoping, re-swept

AST walk (written fresh this pass): **29/29 routes**, identical paths,
methods and `Depends(...)` gates to pass 6's table — no new route. Every
`select(` call site (87, up from pass 6's 82 — the five new subqueries the
paging/export fix introduces: `matching_users`, `matching_templates`, the
count subquery, `_templates_for`, and the client-minted-id lookup) checked
against the two accepted shapes. 86 of 87 carry an `organization_id` filter
or resolve through an already-org-scoped row; the one exception
(the client-minted-id lookup) is the deliberate, data-safe design discussed
above. `tests/test_org_scoping_ratchet.py`'s AST matcher does not flag it —
correctly, per the file's own documented scope: the comparison's right side
is `test_data.id` (an attribute access), not a bare name, which the ratchet's
docstring excludes by design (id read off another object).

### Frontend

Not re-swept this pass — pass 6 re-did the full `grep -rli "skillsTesting"`
inventory (22 files) and read the one new file in full; nothing in this
pass's six commits touches a file outside that inventory (the paging/export
and preferred-name frontend changes are in already-inventoried files; the
client-minted-id store change was already read in pass 6's addendum).

### Cross-feature scope note (not reviewed this pass — out of scope for SKT)

`feat(training): online knowledge tests with a question bank and auto-grading`
(`b310f532`, 2026-10-06) added a new, substantial, unreviewed surface:
`app/api/v1/endpoints/knowledge_tests.py` (1,147 L, new router mounted at
`/training/knowledge-tests`), `app/models/knowledge_test.py`,
`app/schemas/knowledge_test.py`, and migration `7c2e9a41b6d3` (three new
tables). This is training-adjacent, not skills-testing — it shares no file
with this feature's declared scope (`skills_testing.py`,
`skills_testing_service.py`, `app/schemas/skills_testing.py`,
`app/models/skills_testing.py`) and was not read as part of this pass. It
also lands outside Feature 17 (Training core) and Feature 18 (Training
extended)'s own declared file lists (`training.py`/`training_programs.py`/
`training_sessions.py` and `training_submissions.py`/`training_enhancements.py`/
`training_waivers.py`/`external_training.py`/`course_cohorts.py`/
`course_syllabus.py` respectively), and it merged (09:32 UTC) before TRX-18
pass 7 merged (16:09 UTC) without being added to either feature's scope line
in this file's sibling findings docs. **Flagged for the rotation, not this
feature:** `knowledge_tests.py` needs an owning feature (recommend adding it
to Feature 17's declared scope, since it is a sibling of `training_programs.py`'s
requirement-credit path) and a first security pass before the rotation can
call Training core/extended's current ✅ complete. Not reviewed, not fixed,
not counted in this feature's findings — recorded in `PROGRESS.md`'s log
entry and `KNOWN_LIMITATIONS.md` for the rotation to pick up explicitly
rather than silently skip.

### Corrections to prior write-ups

None. Pass 6's "New surface" addendum on client-minted ids is confirmed
accurate on a fresh read of the diff, not merely re-cited.

## Guard tests added

None by this pass — all behavior changes landed (and were guard-tested) in
the five commits reviewed above, each already covered by its own test file
(`test_skill_test_list_paging.py`, `test_skill_test_export_csv.py`,
`test_skill_test_update_guard.py`, `test_skill_testing_summary_disclosure.py`,
`test_skill_sheet_item_caps.py`, `test_skill_test_client_minted_id.py`). This
pass is verification, not new code.

## Completion gate (pass 7)

| Check                                                       | Result                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (`flake8==7.3.0`)                                                                        |
| `black --check app/ tests/ alembic/`                        | ✅ 2027 files unchanged (`black==26.5.1`)                                                                |
| `isort --check-only app/ tests/ alembic/`                   | ✅ clean (`isort==9.0.1`)                                                                                |
| `python3 scripts/validate_migrations.py --strict`           | ✅ 538 revisions, single head `8c4f2a6e1d93`                                                             |
| `python3 scripts/check_route_permissions.py --strict`       | ✅ 251 routes, 0 errors/warnings                                                                         |
| `pytest tests/ -q -k "skill or skill_testing or evaluator"` | ✅ 512 passed, 1 skipped (pre-existing optional-dependency skip), up from pass 6's 464 (new guard tests) |
| `cd frontend && npm run typecheck`                          | ✅ 0 errors (aliased 7.0.2 compiler via `scripts/tsc-native.mjs`)                                        |
| `cd frontend && npm run lint`                               | ✅ 0 errors, 0 warnings                                                                                  |

No source file is modified by this pass — every fix landed in the six
commits reviewed above, already on `main` before this pass started. This
pass's own diff is documentation only (this findings file, `PROGRESS.md`,
`KNOWN_LIMITATIONS.md`).

**Final disposition: 0 fixed by this pass (five standing findings — SKT3-2,
SKT4-1, SKT4-2, SKT4-3, SKT4-7 — were fixed by ordinary feature commits
between passes and verified fixed here), 0 newly flagged against this
feature, 1 cross-feature scope gap flagged for the rotation
(`knowledge_tests.py`, unowned and unreviewed). Every standing flag this
feature carried into pass 7 is now closed; no open findings remain in
`SKT-19-skills-testing.md`.**

---

## Pass 8 (2026-10-16)

**Prefix:** `SKT8` · **PR:** recorded in `PROGRESS.md`'s Open PR row.
Watchdog pickup — the dedicated `/loop 30m /security-review` session had no
open PR or branch for this feature at pickup time (confirmed via
`gh api repos/.../pulls?state=open`, not the tracker); PR #3302 (Feature 18,
Training extended, pass 8) had already merged with nothing started since.

**Scope check.** Diffed the current tree against `0066c60c9` (the pass-7
merge commit for PR #2976), fetched directly by SHA since this checkout's
default shallow clone does not reach it:

```
backend/app/api/v1/endpoints/skills_testing.py  | 30 +++++++++++---------------  (13+/17-)
backend/app/services/skills_testing_service.py  | 161 +++++++++++++++++++++++--  (151+/10-)
backend/app/schemas/skills_testing.py           | 10 ++++++++++
backend/app/models/skills_testing.py            | 182 ++++++++++++++++++++++-------------  (116+/66-)
```

Read every diff directly, not summarized from a commit message.

- **Endpoint file:** cosmetic mypy-narrowing (an `if`-assigned local given an
  explicit type instead of returning the expression directly; a `bool(...)`
  cast on `test.is_practice`) plus a real DRY fix — `_apply_test_filters`'s
  review-queue predicate and `get_testing_summary`'s pending-validation count
  now both call one new `pending_validation_criteria(organization_id)`
  helper instead of each hand-writing the same four-clause filter, closing
  the exact "two places compute the same rule and can drift" shape Pitfall
  #29 warns about (there was no drift today — the two clause lists were
  identical before this change — but the extraction means a future edit to
  one can no longer silently miss the other). `create_template`/
  `duplicate_template` gained `valid_for_months=...` passthroughs for the
  schema field below.
- **Service/schema/model files:** a genuine new feature, **skill expiration
  tracking**. `SkillTemplate.valid_for_months` (nullable `Integer`, migration
  `a17a47c5a871` — table-existence-guarded, confirmed by reading it directly)
  is how long a passing official test stays valid; `skill_test_expiration()`
  computes the lapse date with `dateutil.relativedelta` (clamped to a
  shorter month correctly: Jan 31 + 1 month = Feb 28, not an invalid date);
  `member_skill_expirations()` lists a member's own upcoming lapses. The rest
  of the models diff is mechanical `Column` → `Mapped`/`mapped_column`
  typing (part of the repo-wide mypy remediation effort), read in full and
  confirmed behavior-neutral — every `nullable`/`ondelete`/`server_default`
  is unchanged, so Pitfall #2 is not newly at risk.

**New surface reviewed against the checklist, not accepted from its own
test file's coverage:**

- **Tenant isolation.** `member_skill_expirations(db, organization_id,
user_id, ...)` takes both ids as plain parameters (never a client-supplied
  id from the route it is reached through — see below) and filters
  `SkillTest.organization_id == organization_id` **and**
  `SkillTemplate.organization_id == organization_id` on the join, not just
  one side. Confirmed by reading the query directly.
- **Self-scoping, at the one caller.** The only call site
  (`app/api/v1/endpoints/training_module_config.py:503`, `GET
/training/my-training` — outside this feature's declared scope, read anyway
  since it is this function's only consumer) passes
  `org_id = str(current_user.organization_id)` and `user_id =
str(current_user.id)` — the caller's own identity, not a path/query
  parameter. There is no route anywhere that lets one member request another
  member's expirations through this function.
- **Disclosure gating, not merely a cosmetic filter.** Before an entry is
  built, `resolve_result_view(...)` is called with the member's own id and
  the entry is skipped unless the result is `view in (SCORES, FULL)` —
  reusing the same disclosure machinery `list_tests`/`get_test` depend on,
  not a parallel reimplementation (Pitfall #29's "do not re-derive" rule).
  Confirmed this actually withholds data, not just computes it and discards
  it: `test_a_withheld_result_is_not_announced_by_its_expiry` and
  `test_a_result_awaiting_release_is_not_listed` in
  `tests/test_skill_test_expirations.py` both construct a test whose
  disclosure/release policy would hide it and assert the expirations list
  comes back empty, i.e. the query that would reveal the pass date is never
  exposed, not redacted after the fact.
- **`is_officer` is the one existing short-circuit, applied consistently.**
  `resolve_result_view` returns `FULL` unconditionally when `is_officer` is
  true, same as every other caller in this file — an officer viewing their
  own "My Training" page sees their own result in full regardless of the
  org's disclosure policy, which is the documented, pre-existing behavior
  ("the policy exists to govern what the person _being evaluated_ sees, not
  to hide an officer's own record-keeping from them"), not a new gap this
  feature introduces.
- **Bounded, not a scan.** The query is `WHERE organization_id = ... AND
candidate_id = ...` — one member's rows, not an org-wide table — so dimension
  6 (abuse resistance) does not apply the way it did to the pre-paging
  `list_tests`/`export_tests_csv`/`list_templates` (SKT3-2).
- **`today` is server-resolved, not client-supplied** — `resolve_org_today`
  at the one caller, confirmed by reading its assignment; a caller cannot
  skew "days until expiry" by sending an arbitrary date.

**No finding.** The new surface was built against this feature's own
established disclosure and org-scoping machinery rather than beside it, and
the one DRY fix in the endpoint file closes a latent two-copies-of-one-rule
risk before it had the chance to drift, rather than after.

### Re-verification of pass 1–7 fixes

Read the current code directly for each, not re-cited from any prior
write-up:

- **SKT-1** — `update_template` still routes through `apply_updates` inside a
  `try/except ValueError`.
- **SKT-2 / SKT-3 / create_test's SoD / validate_test's SoD** — all four
  `assert_different_person(...)` call sites still present
  (`skills_testing.py:1574` `create_test`, `:2402` `validate_test`, `:3049`
  `void_test`, `:3219` `return_test_for_correction` — line numbers shifted by
  this pass's own typing/helper diff, same four functions as every prior
  pass).
- **SKT-4** — `lock_attempt_capacity` (`skills_testing_service.py:752`) still
  locks `TrainingRequirement` with `.with_for_update()`; the `spent` count in
  `assert_attempts_remaining` still carries `.with_for_update(of=SkillTest)`
  (`:891`); `validate_test` still calls `lock_attempt_capacity` (confirmed at
  `skills_testing.py:2350`) ahead of `_lock_test_for_transition`'s per-test
  lock.
- **SKT2-1** — zero `is_practice ==` comparisons (`grep -c` returns 0); still
  `.is_(...)` throughout both files.
- **SKT3-1** — `add_test_viewer` still rejects naming both the candidate and
  the examiner before the existing-grant lookup.
- **SKT3-2 / SKT4-1 / SKT4-2 / SKT4-3 / SKT4-7** — all five re-confirmed
  fixed and unchanged since pass 7 (paging/export bounds, item caps on
  sheets and results, summary figures gated to officers, `update_test`
  refusing to set an outcome directly) — no commit in this pass's diff
  touches any of their call sites.
- **SKT4-4 / SKT4-5 / SKT4-6 / SKT5-1** — the email disclosure guard, the
  enum `field_validator`s + `max_length` caps + fail-closed resolution, the
  voided-before-validation redaction (status, the four void fields, and
  `pending_validation` all flipped together), and the `waive_reason` scrub
  in the `scores` view are all still present, re-grepped directly.

All twelve standing guard-test files from passes 1–7 re-run clean (see
completion gate). **Route surface re-enumerated with a fresh AST walk**
(script written this pass, not a re-read of any prior table — every
`@router.<verb>` decorator plus every `Depends(...)` default among its
function's arguments): **29/29 routes**, identical paths, methods and gates
to every prior pass's table — no new route, no new permission string.
**Org-scoping re-swept**: 87 `select(` call sites (unchanged count from pass
7 — this pass's diff adds no new query), every one either carries an
`organization_id` filter or resolves through an already-org-scoped parent
row, matching pass 7's sweep exactly (including the one deliberate
exception, the client-minted-id lookup, re-confirmed unchanged).

### Cross-feature scope note (not reviewed this pass — tracked for the rotation)

`docs/KNOWN_LIMITATIONS.md`'s "Training — Online Knowledge Tests Have No
Owning Feature In The Security Rotation" entry (filed by this feature's pass 7) is still accurate as of TR-17 pass 8 (2026-10-16): that pass's own
declared nine-file scope list still does not name
`knowledge_tests.py`/`knowledge_test.py`. No action taken here — this
remains a rotation-process gap for Feature 17 or 18's next pass to pick up,
not a defect in this feature's own files.

### Corrections to prior write-ups

None. Passes 1–7's findings, fixes, and flagged items are all re-verified
intact above; nothing in this pass contradicts anything a prior pass
recorded.

## Guard tests added

None by this pass — the one real feature in scope (`valid_for_months`/skill
expirations) landed already guard-tested
(`tests/test_skill_test_expirations.py`, 20 tests covering the expiry
arithmetic, the schema bounds, and — read in full above —
`TestMemberSkillExpirations`'s org-scoping, disclosure-gating, and
newest-pass-wins coverage). This pass found a stale local database (the
session's MariaDB had been built against an older migration head, before
`a17a47c5a871` added `valid_for_months`) rather than a code defect; running
`alembic upgrade head` + `scripts/repair_schema.py` resolved it, and every
test that had errored on the missing column passed afterward with no code
change. Not a finding, since nothing in the application or its migrations
was wrong — the review environment's database was simply behind.

## Completion gate (pass 8)

| Check                                                 | Result                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations (`flake8==7.3.0`, CI's pin, reinstalled to match)                      |
| `black --check app/ tests/ alembic/`                  | ✅ 2356 files unchanged (`black==26.5.1`, CI's pin, reinstalled to match)              |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean (`isort==9.0.1`, CI's pin, reinstalled to match)                              |
| `python3 scripts/validate_migrations.py --strict`     | ✅ 606 revisions, single head `361a40316340`                                           |
| `python3 scripts/check_route_permissions.py --strict` | ✅ 270 routes, 0 errors/warnings                                                       |
| `pytest tests/ -q -k "skill or skt"`                  | ✅ 565 passed, 1 skipped (pre-existing optional-dependency skip), up from pass 7's 512 |
| `cd frontend && npm run typecheck`                    | ✅ 0 errors (`npm ci` run first — this worktree had no `node_modules` at all)          |
| `cd frontend && npm run lint`                         | ✅ 0 errors, 0 warnings (`--max-warnings 10`)                                          |

No source file is modified by this pass — the one feature commit in scope
(skill expiration tracking) was already on `main`, already guard-tested, and
reviewed clean against all seven checklist dimensions above. This pass's own
diff is documentation only (this findings file, `PROGRESS.md`).

**Final disposition: 0 fixed, 0 newly flagged, 0 findings closed.** One real
feature landed in this feature's files since pass 7 (`valid_for_months`/skill
expirations) and was read in full rather than assumed safe from its own test
coverage; it is correctly org-scoped, self-scoped at its one caller, gated by
the existing disclosure machinery, and bounded to one member's rows. The
route surface (29/29), the org-scoping sweep (87/87), and all standing
fixes from passes 1–7 were re-verified directly against current code. No
open findings remain in this feature.

## Pass 9 (2026-10-19) — watchdog pickup, true zero delta, 0 new findings

**Prefix:** `SKT9` · **PR:** see `PROGRESS.md`'s **Open PR** row.

**Watchdog note.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`-equivalent `list_pull_requests`
check, 0 results) and the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was not reachable via `ListAgents`. PR
#3444 (Feature 18, Training extended, pass 9) had just merged, docs-only, and
is not independently recordable. Rotation row 19 (Skills testing) was the
next pending feature.

### Scope check — zero delta since pass 8

Pass 8 (PR #3307) diffed against base commit `cef8a679` and found no finding;
this pass diffs against that **same** commit (PR #3307 made no application
source change — its own diff was documentation only, confirmed by reading
the PR body directly), since it is the most recent commit at which this
feature's files are known-reviewed-clean.

```
git diff cef8a67945932ab59cf63f7a2bf9e948e5a393dc..origin/main -- \
  backend/app/api/v1/endpoints/skills_testing.py \
  backend/app/services/skills_testing_service.py \
  backend/app/schemas/skills_testing.py \
  backend/app/models/skills_testing.py
```

Empty output — byte-identical across all four declared scope files. 504
commits landed on `main` in that window across the rest of the application;
zero touched any of these four files. Also checked this feature's one
external caller noted at pass 8, `training_module_config.py`'s
`GET /training/my-training` (the sole consumer of `member_skill_expirations`):
also zero commits since the same baseline. This is a stronger result than a
"near-zero delta" pass — nothing to diff, read, or re-verify line-by-line
beyond confirming the baseline itself is still what pass 8 said it was.

### Re-verification, by direct grep against current code (not re-cited)

Since the files are provably unchanged, every standing mechanism pass 8
confirmed is unchanged by construction. Spot-confirmed anyway, directly
against current line numbers (all match pass 8's own citations exactly,
consistent with the zero diff):

- **SKT-1** — `update_template` still routes through `apply_updates`.
- **SKT-2/SKT-3 and all four separation-of-duties sites** —
  `assert_different_person(...)` still present at `skills_testing.py:1574`
  (`create_test`), `:2402` (`validate_test`), `:3049` (`void_test`), `:3219`
  (`return_test_for_correction`) — identical line numbers to pass 8's
  citation.
- **SKT-4** — `lock_attempt_capacity` (`skills_testing_service.py:752`) still
  locks with `.with_for_update()`; the capacity count's own
  `.with_for_update(of=SkillTest)` still at `:891`; `validate_test` still
  calls `lock_attempt_capacity` ahead of the per-test lock
  (`skills_testing.py:2350`).
- **SKT2-1** — zero `is_practice ==` comparisons (`grep -c`), `.is_(...)`
  throughout.
- **SKT3-1** — `add_test_viewer` still rejects naming both candidate and
  examiner before the grant lookup.
- **SKT3-2 / SKT4-1 / SKT4-2 / SKT4-3 / SKT4-7 / SKT4-4 / SKT4-5 / SKT4-6 /
  SKT5-1** — all re-confirmed present (paging/export bounds, item caps,
  officer-gated summary figures, `update_test`'s outcome-setting refusal,
  the email disclosure guard, enum `field_validator`s with `max_length`
  caps and fail-closed resolution, voided-before-validation redaction,
  `waive_reason` scrub in the `scores` view).
- **Pass 8's own new surface** (skill expiration tracking —
  `valid_for_months`, `skill_test_expiration()`, `member_skill_expirations()`)
  — unchanged; its 20 guard tests in `tests/test_skill_test_expirations.py`
  still collected and passing (see gate below), including the two
  disclosure-withholding tests pass 8 named directly.

**Route surface.** Fresh AST walk (every `@router.get/post/put/patch/delete`
decorator plus its function's `Depends(...)` defaults, written this pass, not
reused from any prior script): **29/29 routes**, 0 with no auth dependency —
identical count to passes 7–8.

**Org-scoping sweep.** `grep -c "select("` across the two backend files:
**87** in `skills_testing.py` (unchanged from pass 8's cited count) + 6 in
`skills_testing_service.py` = 93 total call sites; the endpoint-file count
(87) is the one pass 7/8 tracked and it is unchanged. Since the files are
provably byte-identical to the pass-8-reviewed state, every one of these is
still org-filtered or resolves through an already-org-scoped parent, exactly
as pass 8 verified by direct read.

### Cross-feature scope note (unchanged, not this feature's to fix)

`docs/KNOWN_LIMITATIONS.md`'s "Training — Online Knowledge Tests Have No
Owning Feature In The Security Rotation" entry is still accurate:
`knowledge_tests.py`/`knowledge_test.py` still carry no declared owning
feature in the rotation (checked against Feature 17's pass 9 scope, PR #3440,
and Feature 18's pass 9 scope, PR #3444 — neither names these files). No
action taken here; this remains a rotation-process gap for Feature 17 or 18
to pick up, not a defect in Feature 19's own files.

### Corrections to prior write-ups

None.

## Guard tests added

None — no code change in scope.

## Completion gate (pass 9)

| Check                                                        | Result                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations (`flake8==7.3.0`, CI's pin)                                                 |
| `black --check app/ tests/ alembic/`                         | ✅ 2471 files unchanged (`black==26.5.1`, CI's pin)                                         |
| `isort --check-only app/ tests/ alembic/`                    | ✅ clean (`isort==9.0.1`, CI's pin)                                                         |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 631 revisions, single head `ca0c2111466f`                                                |
| `python3 scripts/check_route_permissions.py --strict` (root) | ✅ 273 routes, 0 errors, 0 warnings                                                         |
| `pytest tests/ -q -k "skill or skt"`                         | ✅ 565 passed, 1 skipped (pre-existing `pywebpush` optional-dep skip) — identical to pass 8 |
| `cd frontend && npm run typecheck`                           | ✅ 0 errors                                                                                 |
| `cd frontend && npm run lint`                                | ✅ 0 errors, 0 warnings (`--max-warnings 10`)                                               |

**Final disposition: 0 fixed, 0 newly flagged, 0 findings closed.** A true
zero-delta pass — no commit touched any of the four declared scope files, or
the feature's one external caller, since pass 8's reviewed baseline. Every
standing fix from passes 1–8 re-confirmed present at identical line numbers.
Route surface (29/29) and org-scoping sweep (87 endpoint-file call sites)
unchanged. No open findings remain in this feature.

---

## Pass 10 (2026-10-24) — watchdog pickup

**Prefix:** `SKT10` · **PR:** see `PROGRESS.md`'s **Open PR** row

**Watchdog note.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results) and the
dedicated `/loop 30m /security-review` session was not reachable via
`ListAgents`. PR #3629 (Feature 18, Training extended, pass 10) had just
merged. Rotation row 19 (Skills testing) was confirmed the next `⬜` by
reading `PROGRESS.md` directly.

### Scope check — real delta since pass 9

Pass 9 found the feature's four declared backend files byte-identical back to
`cef8a679` (pass 8's reviewed baseline). This pass diffs against that same
commit:

```
git diff cef8a679..origin/main -- \
  backend/app/api/v1/endpoints/skills_testing.py \
  backend/app/services/skills_testing_service.py \
  backend/app/schemas/skills_testing.py \
  backend/app/models/skills_testing.py
```

Real diff this time: 69 insertions / 19 deletions across the endpoint,
schema, and model files (`skills_testing_service.py` unchanged). All of it
read directly, not from a commit message.

### Changes reviewed (all traced safe, 0 fixes needed)

- **`SkillTest.examiner_id` relaxed to nullable, `ondelete` CASCADE → SET
  NULL** (`models/skills_testing.py`) — part of a cross-cutting change
  (commit `78a6a57e`, migration `cbe0de50f202`) keeping a candidate's test
  record when the examiner who scored it is later permanently deleted.
  Correctly Pitfall #2-compliant (nullable paired with SET NULL), and the
  migration itself (`20261021_1421_cbe0de50f202_attribution_fks_set_null_on_member_.py`)
  guards table existence (Pitfall #26), is idempotent, and only restores
  `NOT NULL` on downgrade when no row actually holds a NULL. This feature's
  own files were swept for every place that assumed a non-null
  `examiner_id`/`examiner`:
  - Every `select(User).where(User.id == test.examiner_id)` call site
    (10 of them) already uses `scalar_one_or_none()`, which safely resolves
    to `None` when `examiner_id` is `None` (no row matches `User.id ==
NULL`) — no crash, no unhandled exception.
  - `_build_test_response` already guarded `examiner_name=... if examiner
else None`; `list_tests`' batch name-lookup and CSV export's `name_of()`
    helper are typed `str | None` and return `""`/`None` rather than
    indexing a dict with `None`.
  - The four `assert_different_person` separation-of-duties checks (SKT-2,
    SKT-3, and the two on create/validate) all compare against
    `test.candidate_id`, never `examiner_id` — unaffected by the
    nullability change.
  - `resolve_result_view`'s examiner-FULL-disclosure branch
    (`str(test.examiner_id) == uid`) and `add_test_viewer`'s SKT3-1
    self-dealing guard (`str(viewer.id) == str(test.examiner_id)`) both
    fail safe on `None` — `str(None)` is the literal string `"None"`, which
    never equals a real UUID, so a test with a deleted examiner simply
    grants no one that branch's privilege rather than mismatching open.
  - `_authorize_test_write`'s examiner-self-service branch
    (`test.examiner_id == str(user.id)`) also fails closed on `None`: once
    an examiner is deleted, only `training.manage` can still write the test
    (the officer short-circuit above it), which is a narrowing of access,
    not a widening — correct fail-direction.
  - `email_test_results` (the one call site this cross-cutting commit
    itself touched inside this feature) renders "Former member" when
    `test.examiner_id is None`, distinct from "Unknown" (examiner_id present
    but the `User` row query somehow came back empty) — a real distinction,
    not cosmetic.
- **`search_candidates`'s `User.status == UserStatus.ACTIVE` →
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`** — the repo-wide Pitfall #32
  sweep reaching this feature's one remaining literal-status comparison.
  Correct: a probationary member is a current member and belongs in the
  examiner/viewer-grant candidate search.
- **New `_assert_skills_testing_offered` gate on `create_test`**
  (`skills_testing.py`) — refuses `POST /tests` with a 409 when the
  department's `practical_skills_method` (read via the already-reviewed,
  org-scoped `get_practical_skills_method`, filtered on
  `TrainingModuleConfig.organization_id`) is `"shift_signoffs"`. Not a
  security control — a business-rule gate between two product workflows,
  and its fail direction is the safe one (an unset/unrecognized method
  reads as Skills Testing, i.e. the gate does _not_ fire, same as every
  other reader of this column). Validating, releasing, voiding, returning
  and every read path are deliberately left unguarded by this check per its
  own docstring, so a test already open when a department switches methods
  is never left stuck half-scored. No tenant-isolation or auth concern:
  the check runs after the existing in-org visibility/create authorization,
  purely narrows one more case to a 409.
- **Column-bounds hardening** (`schemas/skills_testing.py`) —
  `le=INT32_MAX`/`le=FLOAT32_MAX` added to `sort_order`, `passing_score`,
  `time_limit_seconds`, `score`, and `elapsed_seconds` — defensive only,
  same pattern as TRX-18's identical sweep on the sibling training schemas;
  narrows a silent DB-level truncation into a clean 422.
- **`list_tests`'s batch name lookup** — `{i for t, _ in page for i in
(t.candidate_id, t.examiner_id) if i}` now filters falsy ids before the
  batch `User` fetch, and the per-row examiner lookup is guarded
  (`if t.examiner_id else None`) — both are the frontend-visible half of
  the nullable-examiner change, not a new independent code path.

**Frontend — 16 files changed, all consistent with the same backend
change plus an AA/AAA contrast and touch-target sweep.** Traced each diff
directly:

- **`attributionName(name, id)`** (`utils/memberName.ts`, a shared,
  already-existing helper — not new to this pass) renders a stored name,
  else `"Former member"` when the id is `null`, else `"Unknown"` — the
  frontend mirror of the backend's new None-examiner handling. Used at
  every `examiner_name` display site this pass touched
  (`MySkillTestsList.tsx`, `ActiveSkillTestPage.tsx`,
  `MySkillTestResultPage.tsx`, `SkillsTestingPage.tsx`). Plain string
  interpolation into JSX text content (React-escaped), not
  `dangerouslySetInnerHTML` — no injection surface.
- **`SkillsTestingRoute.tsx`** (gates the module's routes on
  `practicalSkillsStore`) had its own doc comment corrected to say the
  _server_ refuses opening a new test for a sign-offs department — this
  route guard was already documented as "not an access control" and
  remains exactly that; no behavior change, a comment-accuracy fix only.
- **`practicalSkillsStore.ts`** reads `trainingModuleConfigService` from
  the shared `services/api.ts` client (`withCredentials`, CSRF
  interceptor) — not a bespoke per-module axios instance, so Pitfall #7
  does not apply.
- **Header/breadcrumb rollout** (`TrainingPageHeader` on
  `MySkillTestResultPage.tsx`/`SkillTemplateBuilderPage.tsx`) and an
  AA/AAA contrast shade bump (`green-600`→`green-700`,
  `amber-600`→`amber-700`, `yellow-600`→`yellow-700` across
  `ActiveSkillTestPage.tsx`/`SkillsTestingPage.tsx`) plus
  `touch:min-h-11`/`aria-label`/`aria-expanded` additions on
  `SkillTemplateBuilderPage.tsx`'s icon-only buttons — cosmetic/
  accessibility, no new API call, input, or data-exposure surface.
- **Standard banned-pattern sweep, all 16 changed files: zero hits** for
  `window.confirm`/`alert`/`prompt` (two comment mentions found are
  explanatory prose about _not_ using them), `dangerouslySetInnerHTML`,
  banned `.toLocale*`/`date-fns`/`new Date().toISOString().slice`, a bare
  `fetch(`, and `localStorage`/`sessionStorage`.

### Re-verification of standing fixes

Re-read directly against current line numbers (all moved slightly from
pass 9's citations, consistent with the real diff above, not re-cited from
any prior write-up):

- **SKT-1** — `update_template` still routes through `apply_updates`.
- **SKT-2/SKT-3 and all four separation-of-duties sites** —
  `assert_different_person(...)` present on `create_test`, `validate_test`,
  `void_test`, `return_test_for_correction`, each still checked against
  `candidate_id` before any mutation.
- **SKT-4** — `lock_attempt_capacity` still locks `TrainingRequirement`
  with `.with_for_update()`; the capacity count still carries
  `.with_for_update(of=SkillTest)`; `validate_test` still acquires the
  capacity lock ahead of the per-test row lock.
- **SKT2-1** — zero `is_practice ==` comparisons; `.is_(...)` throughout.
- **SKT3-1/SKT3-2** — `add_test_viewer` still rejects naming both
  candidate and examiner; `list_tests`' pagination/cap (SKT3-2's owner-
  accepted fix) is unchanged.
- **SKT4-1 through SKT4-7, SKT5-1** — all re-confirmed present (item caps,
  officer-gated summary figures, `update_test`'s outcome-setting refusal,
  the email disclosure guard, enum validators with bounds, voided-before-
  validation redaction, `waive_reason` scrub).

**Route surface.** Fresh AST walk (`ast.parse` over every
`@router.get/post/put/patch/delete` decorator and its function's
`Depends(...)` defaults): **29/29 routes**, 0 with no recognized auth
dependency — identical count to passes 7–9.

**Org-scoping.** Every `select(SkillTest)`/`select(SkillTemplate)`/
`select(SkillTestViewer)`/`select(User)` call site touched by this pass's
diff was checked by hand (not assumed from the "unchanged" files): all
either filter `organization_id` directly or resolve through an
already-org-scoped parent (`test`/`template` fetched org-scoped earlier in
the same function). `search_candidates`'s widened status filter adds no new
cross-tenant surface — it is still scoped to
`User.organization_id == current_user.organization_id` on the same line.

### Findings

**0 new findings.** The cross-cutting attribution-FK change and the new
practical-skills gate were both already implemented correctly and
consistently across backend and frontend before this pass began; nothing
needed fixing. No standing finding reopened.

### Guard tests added

None — no defect found to guard against. The cross-cutting migration
(`cbe0de50f202`) and its own tests belong to the commit that introduced
them, outside this feature's declared scope.

### Completion gate (pass 10)

| Check                                                             | Result                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.3.0`, CI's pin)         | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/` (`black==26.5.1`)            | ✅ 2606 files unchanged                                               |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`)        | ✅ clean                                                              |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 649 revisions, single head `a0195b397bf3`                          |
| `python3 scripts/check_route_permissions.py --strict` (root)      | ✅ 273 routes, 0 errors, 0 warnings                                   |
| `pytest tests/ -q -k "skill or skt"` (via `python3.13 -m pytest`) | ✅ 579 passed, 1 skipped (pre-existing `pywebpush` optional-dep skip) |
| `cd frontend && npm run typecheck`                                | ✅ 0 errors                                                           |
| `cd frontend && npm run lint`                                     | ✅ 0 errors, 0 warnings (`--max-warnings 10`)                         |

**Environment note, not a finding:** this sandbox resolves plain `python3`/
`pip`/`flake8`/`black`/`isort` to a mix of Python 3.11 and 3.13 installs
with mismatched package sets (`python3 -m pytest` failed with
`ModuleNotFoundError: sqlalchemy`; a bare `flake8` on `PATH` resolved to an
unpinned 7.4.1 ahead of the correctly CI-pinned 7.3.0 at
`/usr/local/bin/flake8`). The backend itself runs under 3.13
(`python3.13`); every check above was re-run against the explicit
3.13 interpreter/binary before being recorded. Noted so a future pass in
the same sandbox doesn't misreport a phantom failure or trust an
unpinned linter's silence.

**Final disposition: 0 fixed, 0 newly flagged, 0 findings closed.** Real
delta since pass 9 (69/19 lines across endpoint/schema/model files, 16
frontend files), all traced to a single, already-correct cross-cutting
change plus independent cosmetic/defensive sweeps. No open findings
remain in this feature.

## Pass 11 (2026-10-26) — watchdog pickup, real delta, 0 new findings

**Prefix:** `SKT11` · **PR:** see `PROGRESS.md`'s **Open PR** row

**Watchdog note.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results); PR #3759
(Feature 18, Training extended, pass 11) had just merged. The dedicated
`/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
was not reachable via `ListAgents`. Rotation row 19 (Skills testing) was
confirmed the next pending feature by reading the rotation table directly
on a freshly fetched `main`.

### Scope check — real delta since pass 10

Baseline: `28410795` (pass 10's own merge, on `main`). 315 non-merge/merge
commits landed in the window; across the four-file declared backend scope
(`skills_testing.py`, `skills_testing_service.py`, `schemas/skills_testing.py`,
`models/skills_testing.py`), only the schema file changed (+12/-8). Both
real (non-merge) commits touching it read in full:

- **`e5e8a477`** — adds `RefusesNull` to `SkillTemplateUpdate` for
  `visibility`/`require_all_critical`: a stored `NULL` on either (both plain
  `bool`/`str` response fields with no nullable variant) previously wrote
  successfully and then failed to serialize on every later read of the
  template. The same `apply_updates`/`RefusesNull` discipline this rotation
  has applied repeatedly elsewhere (TR-17, TRX-18) — correctness, not a
  security surface.
- **`dd4ba98a`** — the same repo-wide numeric-bounds sweep TRX-18 pass 11
  saw on the sibling training schemas: `le=FLOAT32_MAX`/`le=INT32_MAX` added
  to six previously-unbounded fields (`max_score`, `deduction_points`,
  `time_seconds`, `section_score`, `expected_template_version`,
  `expected_version`). Narrows what was previously accepted into a clean
  422; not a vulnerability.

No migration landed inside this feature's four backend files this window.

### Frontend surface

A substring search for this feature's service/store imports
(`skillsTestingService`, `skillsTestingStore`, `practicalSkillsStore`)
turned up 28 candidate files; diffed all of them against `28410795`. Eight
changed, and six are false positives from the shared-import substring match,
not this feature's own surface, each traced to confirm:

- `SideNavigation.tsx`/`TopNavigation.tsx`/`CommandPalette.tsx` — a new "ID
  Cards" nav entry and command-palette items, Feature 13 (Apparatus & NFC)'s
  own change (`members.manage_id_cards`/`locations.manage_nfc_tags`
  permissions, nothing skills-testing touches).
- `TrainingAdminPage.tsx` — a shared `AdminHubAreaNav` component rollout
  replacing the training-specific `TrainingAdminNav`, plus a `view` query
  param letting the "pipelines" tab choose between the program wizard and a
  programs list page. A Training-admin-area-wide UI/routing change, not
  skills-testing's own authorization surface — the server-side permission
  gates on every route are unaffected by which component renders client-side.
- `scheduling/ShiftReportsTab.tsx` — Feature 14 (Equipment check & shifts)'s
  own file; a `canCompleteDraft` helper mirroring that feature's own
  `update_report` backend check (explicitly commented as such), a date-
  formatting cleanup, and a dead `members` state removal. Not this feature's
  scope.

The two genuinely skills-testing files, plus one page that embeds
`MySkillTestsList`, are cosmetic only:

- **`SkillsTestingTemplatesTab.tsx`/`SkillsTestingTestRecordsTab.tsx`** — a
  `StatusBadge`'s raw `status.replace('_', ' ')` replaced with an explicit
  label map (falling back to the same regex replace for an unmapped status),
  plus a `sm:flex-wrap`/`field-min` toolbar-layout tweak. Pure display
  formatting — the map is a superset of what the bare replace already
  rendered, so no status reads differently to a user than before.
- **`MyTrainingPage.tsx`** — the same label-map pattern applied via a new
  shared `getTrainingStatusLabel` helper at three call sites that render
  `TrainingRecord`/enrollment/submission status badges. Cosmetic only.

Grep-swept all eight changed files for `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`/`date-fns`, and a bare
`fetch(` — zero hits.

### Route re-enumeration

AST-walked every `@router.get/post/put/patch/delete` decorator in
`skills_testing.py` directly: **29 routes**, unchanged from pass 10, every
one carrying a recognized `Depends(...)` auth dependency (verified by
walking parameter defaults, not counting decorators). `python3
scripts/check_route_permissions.py --strict` (repo root): **279 total
application routes, 0 errors, 0 warnings** — up from pass 10's 273 from
other features in the rotation merging in the interim, confirming no new
top-level page from this feature (Pitfall #30a n/a).

### Standing findings re-verified at their current citation

Re-grepped directly rather than re-cited: `update_template` still routes
through `apply_updates` (SKT-1); all four `assert_different_person(...)`
call sites (`create_test`, `validate_test`, `void_test`,
`return_test_for_correction`) still present, each checked against
`candidate_id` (SKT-2/SKT-3); `lock_attempt_capacity`'s
`.with_for_update()` and the capacity count's `.with_for_update(of=SkillTest)`
both still present (SKT-4); zero `is_practice ==` literal comparisons
remain (SKT2-1); `add_test_viewer` re-read in full — still resolves `test`
through an org-scoped query (`SkillTest.organization_id ==
current_user.organization_id`) before granting a viewer, and still behind
`training.manage` (SKT3-1 unaffected, file unchanged this window). No OPEN
or FLAGGED item exists as of pass 10 (confirmed by grep before starting
this pass); none is reopened by this pass's one-file backend diff.

### Findings

**0 new findings.** A small, real delta since pass 10 — a schema-layer
null-serialization fix and a numeric-bounds sweep, both correctness-only —
plus cosmetic frontend label-formatting changes in this feature's own two
files. The six other frontend files the substring search surfaced all
belong to other features (Apparatus & NFC, Training admin nav, Equipment
check & shifts), confirmed by reading each diff rather than assumed from
the import match. Every standing SKT finding re-verified unchanged.

## Completion gate (pass 11)

| Check                                                        | Result                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`                         | ✅ 2682 files unchanged                                               |
| `isort --check-only app/ tests/ alembic/`                    | ✅ clean                                                              |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 658 revisions, single head `1ad0b594f3fb`                          |
| `pytest tests/ -q -k "skill or skt"` (via `python3.13`)      | ✅ 635 passed, 1 skipped (pre-existing `pywebpush` optional-dep skip) |
| `python3 scripts/check_route_permissions.py --strict` (root) | ✅ 279 routes, 0 errors, 0 warnings                                   |
| `cd frontend && npm run typecheck`                           | ✅ 0 errors                                                           |
| `cd frontend && npm run lint`                                | ✅ 0 errors, 0 warnings                                               |

---

## Pass 12 (2026-10-30) — watchdog pickup, true zero delta, 0 new findings

**Prefix:** `SKT12` · **PR:** see `PROGRESS.md`'s **Open PR** row.

**Watchdog note.** The dedicated `/loop 30m /security-review` session remains
unreachable (per this iteration's own task framing). No open PR's head branch
starts with `claude/security-review-` — checked both `list_pull_requests`
(state=open) and `search_pull_requests` (`is:open head:claude/security-review-`),
0 results each; the one open PR at the time (#3839) is unrelated layout work on
branch `ccr-ba1682dc-g25b70`. PR #3843 (Feature 18, Training extended, pass 12)
had already merged (`28c7d924`), and its own tend commit had already fixed the
rows-12-14 stale-checkbox bug — confirmed the rotation table's checkbox cells
for rows 12–18 all correctly read ✅ before starting (not just the narrative),
so there was nothing left to ride along at Step 0 this time. Rotation row 19
(Skills testing) confirmed the next `⬜` by reading the rotation table directly
on a freshly fetched `main` (`28c7d924`).

### Scope check — zero backend delta since pass 11

Baseline: `e0deb09d` (pass 11's own merge, PR #3760).

```
git diff e0deb09d..origin/main -- \
  backend/app/api/v1/endpoints/skills_testing.py \
  backend/app/services/skills_testing_service.py \
  backend/app/schemas/skills_testing.py \
  backend/app/models/skills_testing.py
```

Empty output — byte-identical across all four declared scope files. No new
migration touches a skills-testing table.

**Frontend — re-swept the call-site inventory from scratch**
(`grep -rliE "skillsTestingService|skillsTestingStore|practicalSkillsStore"
frontend/src`, not reused from pass 11's list): 54 candidate files (up from
pass 11's 28, mostly broader substring recall — `practicalSkillsStore` alone
pulls in every file that merely checks `offersShiftSignoffs`). Diffed every one
against `e0deb09d`: only 4 changed, and all 4 are false positives, each traced
directly rather than assumed:

- **`frontend/src/services/trainingServices.ts`** — the one hunk that changed
  is `complianceConfigService.getAvailablePositions()`, a new method on a
  sibling service object in the same file; it does not touch
  `skillsTestingService` (confirmed by reading the diff — the only `+` lines
  are inside `complianceConfigService`). Feature 20 (Compliance)'s surface,
  not this one's.
- **`frontend/src/services/api.ts`** — a one-line type re-export addition
  (`ActiveWeatherAlert`), unrelated to skills testing.
- **`frontend/src/pages/MyTrainingPage.tsx`** — a single CSS-class rename
  (`alert-error` → `alert-danger`) on a config-load error banner. Cosmetic.
- **`frontend/src/modules/scheduling/components/ShiftReportsSettingsPanel.tsx`**
  — matched only because it imports `offersShiftSignoffs` from
  `practicalSkillsStore`; the diff itself rewords a shift-completion-report
  settings description (Feature 14, Equipment check & shifts' own change) and
  makes no skills-testing API call or touches no skills-testing field.

No genuine skills-testing frontend file changed. `UNCACHEABLE_PREFIXES`'
`/training/skills-testing/tests` entry (`frontend/src/utils/apiCache.ts:82`)
re-confirmed present and unchanged.

### Re-verification, by direct grep against current code (not re-cited)

Since the backend files are provably byte-identical to pass 11's reviewed
state, every standing mechanism is unchanged by construction. Spot-confirmed
anyway, directly against current line numbers:

- **SKT-1** — `update_template` still routes through `apply_updates`
  (`skills_testing.py:763`).
- **SKT-2/SKT-3 and all four separation-of-duties sites** —
  `assert_different_person(...)` present at `create_test` (`:1609`),
  `validate_test` (`:2437`), `void_test` (`:3084`),
  `return_test_for_correction` (`:3254`).
- **SKT-4** — `lock_attempt_capacity` still locks with `.with_for_update()`
  (`skills_testing_service.py:785`); the capacity count's own
  `.with_for_update(of=SkillTest)` still present (`:891`).
- **SKT2-1** — zero `is_practice ==` literal comparisons (`grep -c` returns
  0); `.is_(...)` throughout.
- **SKT3-1** — `add_test_viewer` still rejects naming the examiner
  ("The examiner already sees this result in full", `:2816`), after the
  pre-existing candidate check.
- **SKT5-1** — `redact_test_for_view`'s `scores` branch still scrubs
  `waive_reason` alongside `notes` (`skills_testing_service.py:1315`).
- **Pitfall #32** — `search_candidates`'s `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`
  still present (`skills_testing.py:1054`), not a literal `== ACTIVE`.

**Route surface.** Fresh AST walk (own script, not reused from any prior
pass): **29/29 routes**, every one carrying a recognized `Depends(...)` auth
dependency (`get_current_user` or `require_permission`/`require_all_permissions`)
— identical count to passes 1–11. `python3 scripts/check_route_permissions.py
--strict` (repo root): **280 total application routes, 0 errors, 0 warnings**
— up from pass 11's 279 from other features merging in the interim, confirming
no new top-level page from this feature (Pitfall #30a n/a).

### Findings

**0 new findings.** No code in this feature's declared backend scope changed
since pass 11; the four frontend files the broadened substring sweep surfaced
all belong to other features or are cosmetic, confirmed by reading each diff
directly rather than assumed from the import match. Every standing SKT fix
re-verified present at its current citation. No open or flagged item existed
coming into this pass (per pass 10/11's own closing dispositions), and none is
newly opened.

### Corrections to prior write-ups

None.

## Guard tests added

None — no code change in scope.

## Completion gate (pass 12)

| Check                                                                                                                           | Result                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.4.1`, CI's pin)                                                                       | ✅ 0 violations                                                                             |
| `black --check app/ tests/ alembic/` (`black==26.10.1`, CI's pin, installed this pass — the ambient `black` resolved to 26.5.1) | ✅ 2743 files unchanged                                                                     |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`, CI's pin)                                                            | ✅ clean                                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                               | ✅ 678 revisions, single head `f90b1124e6f4`                                                |
| `python3 scripts/check_route_permissions.py --strict` (root)                                                                    | ✅ 280 routes, 0 errors, 0 warnings                                                         |
| `pytest tests/ -q -k "skill or skt"` (via `python3.13`)                                                                         | ✅ 635 passed, 1 skipped (pre-existing `pywebpush` optional-dep skip), identical to pass 11 |
| `cd frontend && npm run typecheck`                                                                                              | ✅ 0 errors                                                                                 |
| `cd frontend && npm run lint`                                                                                                   | ✅ 0 errors, 0 warnings                                                                     |

**Environment note, not a finding:** this worktree had no `node_modules`
installed at all at the start of this pass (neither root nor `frontend/`) —
`npm run typecheck` first failed with `TS2307: Cannot find module
'react-hot-toast'` across every page importing it, which is the same
missing-local-install artifact pass 3 and pass 10 each recorded in their own
sandboxes, not a real break on `main`. Fixed with `npm ci` from the repo root
(the committed lockfile, not a fresh `npm install`), after which typecheck and
lint both came back clean. Likewise, the ambient `black` on `PATH` resolved to
`26.5.1` against CI's pinned `26.10.1`; installed the pinned version via
`python3.13 -m pip install --user 'black==26.10.1'` before trusting the
`--check` result, per CLAUDE.md's "install the CI-pinned version rather than
noting it as unavailable" instruction. `flake8` (7.4.1) and `isort` (9.0.2)
already matched CI's pins on `PATH`.

**Final disposition: 0 fixed, 0 newly flagged, 0 findings closed.** A true
zero-delta pass on the backend — no commit touched any of the four declared
scope files since pass 11's reviewed baseline. Every standing fix from passes
1–11 re-confirmed present at its current citation. Route surface (29/29) and
route-permission registry (280, 0 errors) unchanged in shape. No open findings
remain in this feature.
