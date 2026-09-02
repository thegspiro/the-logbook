# Security Review 19 — Skills Testing

**Prefix:** `SKT` · **Iteration:** 19 · **Reviewed:** 2026-08-26 (pass 1) ·
**PR:** [#1901](https://github.com/thegspiro/the-logbook/pull/1901) (pass 1)

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

| Method | Path                                 | Auth dependency    | Permission                               | Org-scoped |
| ------ | ------------------------------------ | ------------------ | ---------------------------------------- | ---------- |
| GET    | `/templates`                         | `get_current_user` | –                                        | ✅         |
| POST   | `/templates`                         | –                  | `training.manage`                        | ✅         |
| GET    | `/library`                           | –                  | `training.manage`                        | ✅         |
| POST   | `/library/{slug}/import`             | –                  | `training.manage`                        | ✅         |
| GET    | `/templates/{template_id}`           | `get_current_user` | –                                        | ✅         |
| PUT    | `/templates/{template_id}`           | –                  | `training.manage`                        | ✅         |
| DELETE | `/templates/{template_id}`           | –                  | `training.manage`                        | ✅         |
| POST   | `/templates/{template_id}/publish`   | –                  | `training.manage`                        | ✅         |
| POST   | `/templates/{template_id}/duplicate` | –                  | `training.manage`                        | ✅         |
| GET    | `/candidates`                        | –                  | `training.view` OR `training.manage`     | ✅         |
| GET    | `/tests`                             | `get_current_user` | – (two-pass disclosure filter in-body)   | ✅         |
| POST   | `/tests`                             | `get_current_user` | – (SoD on create — CS-8)                 | ✅         |
| GET    | `/tests/{test_id}`                   | `get_current_user` | – (disclosure-gated in-body)             | ✅         |
| PUT    | `/tests/{test_id}`                   | `get_current_user` | – (`_authorize_test_write`)              | ✅         |
| POST   | `/tests/{test_id}/complete`          | `get_current_user` | – (`_authorize_test_write`)              | ✅         |
| DELETE | `/tests/{test_id}`                   | –                  | `training.manage`                        | ✅         |
| DELETE | `/tests/{test_id}/discard`           | `get_current_user` | – (own practice test only)               | ✅         |
| POST   | `/tests/{test_id}/validate`          | –                  | `training.manage` (+ SoD, CS-8)          | ✅         |
| POST   | `/tests/bulk-validate`               | –                  | `training.manage` (delegates to single)  | ✅         |
| POST   | `/tests/{test_id}/release`           | –                  | `training.manage`                        | ✅         |
| GET    | `/tests/{test_id}/viewers`           | –                  | `training.manage`                        | ✅         |
| POST   | `/tests/{test_id}/viewers`           | –                  | `training.manage`                        | ✅         |
| DELETE | `/tests/{test_id}/viewers/{user_id}` | –                  | `training.manage`                        | ✅         |
| POST   | `/tests/{test_id}/cancel`            | `get_current_user` | – (`_authorize_test_write`)              | ✅         |
| POST   | `/tests/{test_id}/void`              | –                  | `training.manage` (+ **new** SoD, SKT-2) | ✅         |
| POST   | `/tests/{test_id}/return`            | –                  | `training.manage` (+ **new** SoD, SKT-3) | ✅         |
| POST   | `/tests/{test_id}/email-results`     | –                  | `training.manage`                        | ✅         |
| GET    | `/tests/export/csv`                  | –                  | `training.manage`                        | ✅         |
| GET    | `/summary`                           | `get_current_user` | – (org-wide stats, no per-row exposure)  | ✅         |

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
