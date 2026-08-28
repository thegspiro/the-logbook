# AGENTS.md — Repository Instructions for Coding Agents

This file contains repository-wide instructions for coding agents working on The Logbook.

These requirements apply regardless of whether a change is created by Codex, Claude Code, a human contributor, Dependabot, or another automation.

`CLAUDE.md` contains the detailed project context, architecture, conventions, recurring pitfalls, and historical engineering decisions for this repository. **Read `CLAUDE.md` before making substantive changes.** Its technical rules are repository rules, not Claude-only rules, unless a section explicitly says otherwise.

If this file and `CLAUDE.md` appear to conflict, stop and surface the conflict rather than guessing. Repository configuration and executable tests are the final authority for behavior.

## Core Principle: Do Not Work Around Errors

Never silently ignore an error you encounter. Compilation errors, type errors, lint violations, warnings treated as failures, test failures, build failures, migration failures, and CI failures must be handled explicitly.

There are two acceptable outcomes:

1. **Fix the root cause.** This is the default.
2. **Stop and escalate.** If a correct fix genuinely exceeds the task's reasonable scope or cannot be completed because of permissions/environment limitations, stop and report the complete blocker.

Do not continue past a known failure while describing it as "pre-existing," "unrelated," or "outside the files changed." If you encounter it, either fix it or surface it.

Never make a check green by weakening the check. In particular, do not:

- delete or skip a failing test merely to obtain a passing run;
- disable lint/type rules to hide a violation;
- add broad `any`, `unknown`, ignore directives, or suppression comments merely to silence errors;
- catch and discard errors merely to hide runtime failures;
- lower coverage thresholds to make a change pass;
- remove validation or security checks because they expose a failure.

Narrow suppressions that are already documented as intentional repository conventions in `CLAUDE.md` remain permitted.

## Before You Change Code

1. Read this file.
2. Read `CLAUDE.md`, especially sections relevant to the files being changed.
3. Inspect the current implementation and its tests before editing.
4. Inspect relevant package scripts, workflow files, configuration, migrations, and shared utilities instead of guessing repository conventions.
5. Check the current Git branch and working tree.
6. Keep the change focused on the requested outcome; do not perform unrelated refactors unless they are required to correctly resolve an encountered failure.

## Git and Branch Hygiene

Before considering work complete:

1. Inspect `git status`.
2. Inspect the complete diff against the intended base branch.
3. Verify that every changed file is intentional.
4. Verify that no generated, temporary, environment-specific, secret, or unrelated file entered the diff.
5. When the environment permits, fetch the latest target branch (normally `origin/main`) and determine whether the working branch has diverged.
6. If synchronization with the target branch is required, resolve ordinary text conflicts carefully and preserve the intent of both sides.

Do not blindly resolve conflicts by selecting all of "ours" or all of "theirs." Read the surrounding implementation and tests and produce the correct combined result.

Never rewrite `main` or another protected/shared branch. Never force-push a shared branch. If a rebased task branch must be updated and force-pushing is permitted, prefer `--force-with-lease`, never an unconditional `--force`.

Do not claim a branch is up to date, conflict-free, or mergeable unless you actually verified it.

## Existing Pull Requests and Work Created by Other Agents

A pull request does **not** need to have been created by the current agent in order for its code to be diagnosed or repaired.

When asked to repair an existing PR:

1. Identify the PR's head branch/commit and target branch.
2. Treat the PR head as the code state to diagnose.
3. Inspect its diff, failing checks, review comments, and conflicts when those are accessible.
4. Reproduce failures locally when practical.
5. Make the smallest correct repair.
6. Run the applicable validation suite after the repair.

If platform permissions or agent tooling prevent modifying the original PR branch, **do not treat that as a reason to abandon diagnosis.** Instead:

- diagnose the PR from its branch/HEAD;
- produce a repair commit or repair branch when the environment permits;
- clearly identify what must be applied to the original PR; and
- report the exact permission/tooling limitation.

Do not claim that a PR "cannot be fixed" merely because it was created by another user or agent.

## Merge Conflicts

When a PR or task branch conflicts with its target branch:

1. Fetch/update the target branch when possible.
2. Identify every conflicted file.
3. For text files, inspect both versions and the surrounding code.
4. Resolve according to current repository behavior, tests, schemas, migrations, and documented conventions.
5. Re-run relevant tests after resolution because a syntactically clean merge can still be semantically wrong.
6. Re-check the final diff for accidental deletion or duplication introduced during conflict resolution.

### Binary conflicts

Do not attempt to synthesize or manually merge binary data.

For an intentional tracked binary conflict, determine whether the target-branch version, task-branch version, or a deliberately regenerated version is correct. If that cannot be established safely, stop and report the binary conflict for human review.

## Generated, Binary, and Temporary Files

Before every commit, inspect `git status` and the full diff for unintended artifacts.

Do not commit files created incidentally by development or validation, including, unless explicitly required by the repository:

- local databases or SQLite files;
- caches;
- logs;
- coverage output;
- compiled bytecode;
- build output;
- temporary files;
- test artifacts;
- downloaded archives;
- editor/IDE state;
- OS metadata;
- local environment/configuration files;
- screenshots or other binary output created only while debugging.

If a normal test/build/development command repeatedly creates an untracked artifact inside the repository:

1. determine what creates it;
2. remove it from the proposed change;
3. add an appropriate `.gitignore` rule if the file should never be tracked; and/or
4. change the test/build configuration so generated output is written to an appropriate temporary or ignored location.

Do not add a broad ignore rule that could conceal legitimate source files.

Before intentionally adding a new binary file, verify that it is actually required. Prefer source/text fixtures when they provide equivalent test coverage.

## CI Is Part of the Definition of Done

GitHub Actions and repository validation are not a post-processing step. Treat them as part of implementation.

Before considering a task complete:

1. Inspect the relevant workflows under `.github/workflows/` and package/config scripts.
2. Determine which checks apply to the change.
3. Run the closest locally reproducible equivalents.
4. Fix failures at their root cause.
5. Re-run failed checks after each fix.
6. Run broader regression checks appropriate to the impact of the change.
7. Clearly report any CI-only check that cannot be reproduced locally.

When diagnosing CI, start with the **first meaningful failure**, not the final non-zero exit-code message. Later failures may be cascading symptoms.

Do not repeatedly rerun a deterministic failed job without changing anything. A rerun is appropriate when evidence indicates an infrastructure, network, runner, timing, or known flaky-test failure. Otherwise diagnose the failure first.

## Repository Validation Commands

The repository is an npm-workspaces monorepo. Follow `CLAUDE.md` and the current package scripts as the authoritative command reference.

Common root commands include:

```bash
npm run test
npm run lint
npm run build
```

Frontend tests can be run with:

```bash
npm run test:frontend
# or
cd frontend && npm test
```

Backend tests can be run with:

```bash
npm run test:backend
# or
cd backend && pytest
```

For Python files, run the applicable formatting/lint/type checks described by repository configuration and `CLAUDE.md`. For frontend changes, run the applicable ESLint, TypeScript/typecheck, test, and build checks.

Do not substitute a different TypeScript compiler for the repository's configured scripts. The repository intentionally carries separate TypeScript installations for lint compatibility and compilation; see `CLAUDE.md` before modifying or "simplifying" that setup.

## Tests

Changes to behavior should normally include tests that prove the intended behavior and protect against regression.

A good regression test should fail before the fix and pass after it.

Do not overfit a test to implementation details when externally observable behavior can be tested instead.

Do not change an existing assertion simply because the implementation fails it. First determine whether the test or implementation represents the intended behavior.

Observe all repository-specific testing rules in `CLAUDE.md`, including the documented Vitest mock patterns, pytest configuration, coverage ratchet, and concurrency/mock-patching constraints.

## Security and Data Integrity

The Logbook is multi-tenant and handles operational/member information. Security and tenant isolation are correctness requirements.

Before changing backend queries, relationships, foreign keys, exports, authentication, authorization, cookies, middleware, or user-controlled data handling, review the corresponding rules in `CLAUDE.md`.

In particular:

- preserve organization scoping for client-supplied IDs and by-ID queries;
- validate cross-resource foreign keys against the caller's organization;
- do not weaken permission checks;
- preserve httpOnly-cookie/CSRF authentication conventions;
- use the repository's safe CSV/export mechanisms;
- preserve UTC storage and timezone-aware presentation conventions;
- use existing shared utilities for model updates and other documented integrity-sensitive operations.

If a proposed fix makes a failing test pass by weakening tenant isolation, authorization, validation, or export safety, it is not a valid fix.

## Database and Migrations

When a schema or persisted data shape changes:

1. determine whether an Alembic migration is required;
2. consider both existing installations and fresh installs;
3. preserve migration ordering and seed-data requirements;
4. verify upgrade behavior;
5. provide a downgrade when safe and meaningful, or explicitly document intentional irreversibility where repository conventions permit it;
6. do not edit an already-deployed migration merely to change current behavior unless repository policy explicitly calls for that.

Review the migration, JSON-column, foreign-key, and seed-data pitfalls documented in `CLAUDE.md` before modifying persistence behavior.

## Reuse Existing Architecture

Before adding a new helper, component, hook, service, utility, dialog, formatter, API client, or pattern, search the repository for an existing implementation.

Prefer established shared abstractions over parallel implementations. `CLAUDE.md` documents important examples, including shared form controls, dialogs, date/time formatting, API/auth behavior, CSV safety, model updates, and frontend UX components.

Do not "simplify" unusual code until you understand why it exists. Several repository patterns intentionally work around upstream limitations or previously diagnosed production/CI failures.

## Comments and Documentation

Comments should explain **why**, not restate **what** the code visibly does.

Document non-obvious business rules, safety/security invariants, external quirks, and intentional departures from convention.

When a change introduces a durable repository convention or resolves a subtle recurring failure, update the appropriate documentation so future contributors and agents do not rediscover it.

Avoid adding transient debugging narratives to production source comments.

## Completion Gate

A task is complete only when all of the following are true, or an explicit blocker has been reported:

- the requested behavior is implemented;
- the implementation follows the repository architecture and conventions;
- appropriate tests were added or updated;
- relevant tests pass;
- relevant lint/type/build checks pass;
- no newly encountered error has been silently ignored;
- the branch/diff has been reviewed;
- no unintended generated or binary artifacts are present;
- migrations/data changes have been handled where required;
- security and tenant-isolation requirements remain intact;
- merge/conflict status has been checked when the environment permits;
- limitations and checks that could not be performed are explicitly reported.

When reporting completion, summarize:

1. what changed;
2. why;
3. tests/checks run and their results;
4. any migration or deployment considerations; and
5. any remaining blocker or limitation.

Never report "done," "fixed," "green," or "ready to merge" when known failures remain.