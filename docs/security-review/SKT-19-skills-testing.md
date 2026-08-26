# Security Review — Skills Testing

**Prefix:** `SKT` · **Iteration:** 19 · **Reviewed:** 2026-08-26 · **PR:** TBD

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
(1) added a `SELECT RequirementProgress.id ... FOR UPDATE` lock-acquisition
query on the candidate's `RequirementProgress` row for this requirement,
before either existing read — the one stable parent shared by every attempt
against the requirement, mirroring the pattern already used in
`training_program_service.update_requirement_progress`; (2) added
`.with_for_update(of=SkillTest)` to the existing `spent` count query itself,
since acquiring a lock elsewhere does not refresh an already-open
REPEATABLE-READ snapshot — a plain `SELECT` after the lock could still answer
from before the other transaction committed. Guard tests:
`TestCapacityLocking` in `tests/test_skill_test_attempt_limit.py`, asserting
both the lock query and the count query render `FOR UPDATE` against the
correct tables.

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
  `RequirementProgress` lock query and the `SkillTest` spent-count query both
  compile with `FOR UPDATE` against the expected table, so a future edit that
  drops either half of the fix fails loudly rather than silently
  reintroducing the race.
- Existing tests in `test_skill_test_attempt_limit.py` and
  `test_skill_test_validation.py` updated to account for the new
  lock-acquisition `db.execute()` call now running earlier in
  `assert_attempts_remaining`'s call sequence (mock result-queue reordering,
  not a behavior change to those tests' own assertions).

## Completion gate

| Check                                             | Result                         |
| ------------------------------------------------- | ------------------------------ |
| `flake8` (changed files)                          | clean                          |
| `black --check` (changed files)                   | clean                          |
| `isort --check-only` (changed files)              | clean                          |
| `python3 scripts/validate_migrations.py --strict` | PASSED (no migrations touched) |
| backend tests, skills-testing scope (`-k skill`)  | 380 passed, 1 skipped          |
| backend tests, full suite                         | 8814 passed, 22 skipped        |
