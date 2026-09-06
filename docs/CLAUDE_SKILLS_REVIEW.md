# Claude Skills Review — The Logbook

**Date:** 2026-09-06
**Scope:** Which Claude Code skills would measurably improve how this
repository is worked on — both the skills already available to this account and
the project-local skills worth authoring.
**Status:** Review complete. Steps 2, 3 and 6 of the sequencing below are implemented, and step 4 is under way. Two project skills exist: `repo-migrations` and `repo-tenancy`. One rule has since been moved by writing the guard it lacked (§10).

---

## 1. Method

Surveyed the repository's agent-facing configuration (`.claude/`, `CLAUDE.md`,
`AGENTS.md`, `.github/workflows/`), the shape and volume of recurring work
(git history, `docs/` rotations, module/service/migration counts), and the
skills currently synced to this account. Every measurement below was taken from
the working tree at `claude/claude-skills-review-w7nip7`.

---

## 2. Current state

### What exists

| Asset                      | Location                                          | Notes                                                                                                                                      |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionStart` hook        | `.claude/hooks/session-start.sh` (10.4 KB)        | Starts MariaDB + Redis, runs `alembic upgrade head`, then `repair_schema`. Correct and load-bearing — backend tests cannot run without it. |
| `/app-review` command      | `.claude/commands/app-review.md` (83 lines)       | One iteration of the feature review rotation.                                                                                              |
| `/security-review` command | `.claude/commands/security-review.md` (139 lines) | One iteration of the security rotation, with PR-tending as a distinct iteration type.                                                      |
| `settings.json`            | `.claude/settings.json`                           | Hooks only. **No `permissions` block.**                                                                                                    |
| Account skills             | `~/.claude/skills/synced/`                        | Anthropic set: `docx`, `xlsx`, `pptx`, `pdf`, `skill-creator`, `morning`, `import-memory`, plus the built-ins listed in §3.                |

### What does not exist

**There are no project skills.** `.claude/skills/` is absent. Every piece of
repository-specific guidance is delivered by always-on context instead.

### The context budget

| Region                                           |     Lines |      Bytes |    ≈ tokens |
| ------------------------------------------------ | --------: | ---------: | ----------: |
| `CLAUDE.md` header → Error Handling (1–468)      |       468 |     33,864 |      ~8.5 k |
| **`## Common Pitfalls & Prevention` (469–1505)** | **1,037** | **58,730** | **~14.7 k** |
| Environment Variables (1506–end)                 |        73 |      5,391 |      ~1.3 k |
| **Total `CLAUDE.md`**                            | **1,578** | **97,985** | **~24.5 k** |

`AGENTS.md` adds a further 13.3 KB. Every session — a one-line CSS fix included
— pays ~25 k tokens before reading a single source file, and roughly 60 % of
that is 30 numbered pitfalls of which a typical task touches two or three.

That is the central finding. It is also the finding that must be acted on most
carefully, for the reason in §5.

### The work this repository actually does

From the last 400 commits: **49 docs**, **48 fix**, **45 security**, 3 feat.
The dominant loop is the security-review rotation, and it is expensive —
`MSUP-13` alone went ten Codex review rounds, `MSG-13` four. Scale: 30 frontend
modules, 69 endpoint files, 111 services, 432 migrations, 651 backend test
files, 44 security-review findings documents, 42 app-review documents.

---

## 3. Part A — Skills already available

### Adopt now

**`code-review`** — the highest-return item in this review, and it costs
nothing to start. It reviews the current diff (or a PR/branch/path) for
correctness bugs plus reuse/simplification findings, at a selectable effort
level, and can post inline PR comments (`--comment`) or apply fixes (`--fix`).

The commit history shows fix rounds being driven by an external reviewer after
the push — ten rounds on one finding. Every round is a push, a CI run, and a
context reload. Running `/code-review high` _before_ the first push moves those
findings to the cheapest point in the cycle. Even a 30 % reduction in review
rounds on the security rotation is the largest single saving available here.

**`simplify`** — quality-only companion to the above (reuse, altitude,
efficiency; it does not hunt bugs). Useful on the larger service refactors.

**`skill-creator`** — the tool for building Part B. It matters here beyond
convenience: it carries an eval harness, so a project skill's _triggering_ can
be measured rather than assumed. Given §5's risk, a skill that fails to trigger
is the failure mode to design against, and this is what tests for it.

**`fewer-permission-prompts`** — `.claude/settings.json` has no `permissions`
block, so every `pytest`, `flake8`, `npx tsc --noEmit`, `alembic`, and `git`
invocation is a prompt. This skill reads actual transcripts and proposes a
scoped allowlist. Low risk, immediate friction reduction, and it makes the
review rotations meaningfully less interactive.

**`session-start-hook`** — not needed to build the hook (it exists and works),
but it is the right reference when the hook is next amended, and the hook is
now the only thing standing between a fresh container and a runnable test
suite.

### Situational

| Skill                                                                             | Verdict                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loop`                                                                            | Already in use (`/loop /app-review`, `/loop 30m /security-review`). Worth confirming it is still the right driver now that `.github/workflows/application-review-rotation.yml` exists — running both is how a rotation outruns its own review queue.                |
| `run`                                                                             | Generic launch patterns. A project skill that knows `docker-compose.yml`, the 3000/3001 split, and the seeded-org login would be strictly better; see Part B.                                                                                                       |
| `docx` / `pdf` / `xlsx`                                                           | For documents **Claude authors**, not app code. Genuinely relevant to `docs/policies/`, `SECURITY_AUDIT.md`, and the ISO assessment when those need to leave the repo as deliverables. Irrelevant to the app's own export code — that goes through `SafeCsvWriter`. |
| `dataviz`                                                                         | Only if Claude is producing charts (review dashboards, coverage trends). Its palette method does not automatically satisfy this app's AAA contrast rule, which is stricter; do not import its palette into `styles/index.css` without re-measuring.                 |
| `artifact-*` (`artifact-design`, `artifact-capabilities`, `artifact-diagramming`) | For publishing review output to people who do not read the repo — a chief, a board. Marginal for engineering work.                                                                                                                                                  |
| `update-config`, `keybindings-help`                                               | Utility. `update-config` is the correct route for the permissions work above if `fewer-permission-prompts` is not used.                                                                                                                                             |

### Skip

`claude-api` — no LLM dependency in `backend/requirements.txt` or
`frontend/package.json`; revisit only if that changes. `init` — would produce a
`CLAUDE.md` far weaker than the existing one. `design`, `pptx`, `morning`,
`import-memory` — no fit.

---

## 4. Part B — Project skills worth authoring

Ranked by expected return. Each entry names what it would absorb from
`CLAUDE.md` and what already enforces that content in CI, because §5 makes the
second column a precondition, not a nicety.

### 1. Alembic migrations — highest value

- **Triggers on:** authoring or altering a migration, adding a column, seed data.
- **Absorbs:** pitfalls 8 (seed ordering / `SEED_DATA_FILES`), 12 (JSON column
  mutation), 20 (canonical JSON shape + frozen migration bodies), 23 (seeded
  grants reaching the DB through a position; supersede, never edit), 26 (guard
  tables only `create_all` builds). Plus the `create_all` + `repair_schema`
  deployment model and the downgrade/rollback expectation.
- **≈ 250 lines** of `CLAUDE.md`, currently loaded for every session.
- **Machine checks behind it:** `test_migration_create_all_tables.py`,
  `test_alembic_migrations.py`, `test_migration_cleanup.py`, and the
  `migration-chain` CI job — plus ~20 per-migration tests.
- **Why first:** 432 migrations, the rules are intricate and empirical (pitfall
  26 was live in production CI), and the enforcement is the strongest in the
  repository.

### 2. Multi-tenant endpoint & service work

- **Triggers on:** adding or editing an endpoint, service, or by-id query.
- **Absorbs:** pitfall 14a/b/c (org-scoped by-id reads, `require_permission`
  does not scope the object, validate client-supplied FKs), 5 (schema
  contract), 15 (`SafeCsvWriter`), 25 (`like_pattern` + `ESCAPE`), 27 (capacity
  = locked parent **and** locking count), 9 (bounded caches), 18 (email-first
  notifications), 19 (a config switch needs a reader).
- **Machine checks:** `test_org_scoping.py` and ~10 sibling scoping tests,
  `test_like_escaping.py`, `test_capacity_locking.py`, `test_csv_export.py`,
  `test_notification_rules_gate_senders.py`, `test_baseline_*_grants.py`.
- **Caveat:** this is the dominant finding class in the 2026-07 audit. Its
  one-line summary stays in `CLAUDE.md` regardless of what moves (§5).

### 3. Frontend forms & dialogs

- **Triggers on:** editing a form, modal, or settings screen.
- **Absorbs:** pitfall 1 (`||` on create, `blankToNull` on update — the
  most-cited bug in the repo), 3 (`noUncheckedIndexedAccess`), 16
  (`useConfirm`), 17 (`form-*` utilities), 21 (height cap on the panel),
  7 (module axios auth), 11 (re-fetch after create), 29 (report, don't
  re-derive).
- **Machine checks:** ESLint `noBlockingBrowserDialogs` and the locale-method
  bans (`eslint.config.js:180–219`), `dialogScrollIntegrity.test.ts`,
  `localDateTimeIntegrity.test.ts`, `themeTokenIntegrity.test.ts`,
  `primaryFillContrast.test.ts`.
- **Note:** pitfall 1 has **no machine check**. It stays in `CLAUDE.md` (§5).

### 4. Test authoring

- **Triggers on:** writing or repairing tests.
- **Absorbs:** pitfall 13 (`toHaveBeenCalledWith()` and why the lint rule is
  `off`), 22 (never hold one `patch()` open in two coroutines), 28 (`mockReset`
  vs `clearAllMocks`), 28a (name the viewport), plus the pytest markers,
  `db_session` fixture, and coverage-ratchet conventions.
- **Machine checks:** `tests/conftest.py` patch-leak guard,
  `test_patch_leak_guard.py`.
- **Why it earns a slot:** 651 backend test files and a suite whose failures
  have historically been non-deterministic under `pytest-randomly`. The rules
  are subtle and the diagnosis cost when they are missed is very high — a day
  of alternating CI, in the recorded case.

### 5. Review-rotation mechanics (shared by both commands)

`app-review.md` (83 lines) and `security-review.md` (139 lines) duplicate the
completion gate, findings-file format, tracker update, and push discipline.
Extract the shared half into one skill both commands reference.

**Keep both as commands.** A rotation is invoked deliberately; auto-triggering
it would be wrong. The skill is the shared body, not the entry point.

One item to check while there: `app-review.md` step 8 pushes to a fixed branch,
`claude/app-review-checklist-tdif23`. If that branch's PR has merged, pitfall 24
in this repo's own `CLAUDE.md` says not to reuse the name.

### 6. Docs upkeep

- **Triggers on:** finishing a user-visible change.
- **Covers:** which of `CHANGELOG.md`, `docs/change-audit/`,
  `docs/KNOWN_LIMITATIONS.md`, `APPLICATION_PAGES.md`, `ARCHITECTURE.md`, and
  the module doc a given change must touch, and the `docs-links` CI job.
- **Justification:** 49 of the last 400 commits are `docs:`, and several are
  corrections to docs that went stale — exactly the class a checklist prevents.

### 7. Run & verify locally

Wraps `docker-compose`, the 3000/3001 port split, `db:migrate` +
`repair_schema`, and the seeded-org login, so "confirm it works in the app"
does not get re-derived. Lower value than the above, but it converts a
frequently-fumbled setup into one step.

### 8. New module scaffolding

30 frontend modules share a rigid layout (`index.ts`, `routes.tsx`, `pages/`,
`components/`, `services/api.ts` with its own axios instance, `store/`,
`types/`) with a backend counterpart. Only 3 of the last 400 commits are
`feat:`, so the frequency is low — worth building last, if at all.

### Naming hazard

The application has its own **skills** domain (`compliance-skills`, skills
testing, `docs/SKILLS_TESTING_*.md`). Do not name a project skill `skills`,
`skill-review`, or similar. Prefix Claude-facing ones unambiguously
(`repo-migrations`, `repo-tenancy`) so a prompt about firefighter skill
records cannot pull in a Claude skill about migrations, or vice versa.

---

## 5. The constraint that governs all of Part B

Two hard limits sit on top of the context saving, and both point the same way.

**AGENTS.md delegates to CLAUDE.md, and Codex cannot read `.claude/skills/`.**
`AGENTS.md:7` states that `CLAUDE.md`'s rules are "repository rules, not
Claude-only rules", and ten further lines route agents into specific `CLAUDE.md`
sections. The commit history shows Codex performing many of the review rounds.
Moving a pitfall out of `CLAUDE.md` and into `.claude/skills/` therefore does
not relocate it — **it deletes it for every non-Claude agent in the loop.**

**A trigger miss is a silent regression.** `CLAUDE.md` records this happening:
the `window.confirm` ban held across 58 call sites on review discipline alone,
then regressed the moment a change was made without it in mind, "because unlike
every other invariant in this document it had no machine check behind it."
Progressive disclosure reintroduces exactly that failure mode for any rule
whose skill does not fire.

### The design that satisfies both

Put the **content** where every agent can read it, and make the skill a
pointer:

```
docs/rules/migrations.md      <- the prose, moved verbatim from CLAUDE.md
docs/rules/tenancy.md
docs/rules/forms.md
docs/rules/tests.md

.claude/skills/repo-migrations/SKILL.md   <- ~15 lines: when to load, then
                                             "read docs/rules/migrations.md"
```

- `CLAUDE.md` keeps a **one-line index** per rule — the invariant in a
  sentence, and the path to its full text. A reader who never loads the skill
  still knows the rule exists and where it lives.
- `AGENTS.md` points at `docs/rules/` by path, so Codex and human contributors
  reach the same words.
- Claude gets the ~12 k-token saving, because the pointer loads and the prose
  does not, until it is relevant.

### What may move, and what may not

A rule qualifies for the pointer treatment only if **it has a machine check**
(a test, an ESLint rule, or a CI job). Then a missed trigger costs a red build,
not a shipped defect.

Rules that must stay in full in `CLAUDE.md`, because nothing enforces them:

- **Pitfall 1** (`||` vs `??`, and `blankToNull` on update) — self-described as
  the project's most common bug, with no check behind it.
- **Pitfall 13's residue** — a hand-written zero-argument
  `toHaveBeenCalledWith()` is caught only in review, by design.
- **Pitfall 24** (branch reuse) — process, unenforceable.
- **The Fix All Errors section and the Completion Gate** — these govern whether
  a task is finished at all, so they cannot be conditional on a trigger.
- **Pitfall 14's summary** — cross-tenant leakage is the highest-severity class
  here; keep the one-line rule always on even though the detail moves.

Applied strictly, roughly **8–12 k tokens** of the 14.7 k pitfalls section can
move behind pointers. That is a real saving and it is smaller than a naive
migration would claim — which is the point.

### The part that is not a skill at all

Some of what `CLAUDE.md` carries is better as a **hook** than as a skill,
because a hook cannot fail to trigger:

- The completion gate (`tsc --noEmit`, `flake8`, `black --check`, `eslint`) as
  a `Stop` hook, so a turn cannot end over a red gate.
- A `PreToolUse` check on writes to `backend/alembic/versions/` that reminds
  about the table-existence guard.

Prefer a hook wherever the rule is mechanical and the cost of a miss is high.
Skills are for judgement; hooks are for gates.

---

## 6. Recommended sequencing

1. **Adopt `code-review` in the rotation now.** Run it before the first push on
   every security-review and app-review iteration. No files change; measure the
   effect on review rounds over two or three features.
2. **Run `fewer-permission-prompts`** and commit the resulting `permissions`
   block to `.claude/settings.json`.
3. **Build one project skill — migrations — via `skill-creator`,** using the
   `docs/rules/` split in §5. It is the best-enforced rule set, so it is the
   safest place to prove the pattern, and the eval harness can measure whether
   it triggers.
4. **Measure before extending.** If the migrations skill triggers reliably
   across a few real tasks, do tenancy, then forms, then tests. If it does not,
   the pointer pattern is wrong for this repository and the ~12 k tokens are the
   correct price for always-on rules.
5. **Extract the shared review-rotation body** into a skill both commands read.
6. **Move the completion gate into a `Stop` hook** — independent of all of the
   above and worth doing regardless.

Steps 1, 2 and 6 are reversible in minutes and carry no risk to the
cross-agent contract. Step 3 is the first one that changes where a rule lives,
and it is deliberately scoped to a single rule set so the pattern can be judged
on evidence.

---

## 7. What was implemented

Steps 2 and 6 only — the two that are reversible in minutes and touch nothing
about where a repository rule lives. Steps 1, 3, 4 and 5 remain open.

### `permissions.allow` in `.claude/settings.json`

156 rules covering read-only and verification commands: the npm scripts
(`lint`, `typecheck`, `validate`, `build`, `test`), `npx tsc` / `eslint` /
`prettier --check` / `vitest run`, the Python checkers (`flake8`,
`black --check`, `isort --check-only`, `mypy`, `pytest`), the read-only
`alembic` subcommands, `scripts/check_docs_links.py`,
`scripts/check_ci_gate.py`, inspection-only git verbs, and a short list of
shell reads.

Two deliberate exclusions:

- **Nothing that writes.** `find` (`-delete`, `-exec`), `awk` (redirection),
  `sort` (`-o FILE`) and `uniq` (`uniq IN OUT`) are all capable of writing a
  file, so none of them is in a list whose premise is that it is read-only.
  `alembic upgrade` / `downgrade`, `git push`, `git commit` and
  `prettier --write` are absent for the same reason — those should keep
  prompting.
- **Three spellings per command.** The accepted prefix syntax has differed
  across Claude Code versions (`Bash(git status *)` vs `Bash(git status:*)`),
  and this was not verifiable from inside the session. A rule that does not
  match simply never fires, so carrying the exact form plus both wildcard
  forms is inert where one is unsupported and is what makes the list work
  either way. Once `/permissions` confirms which form this CLI parses, the
  other two can be dropped.

### `Stop` hook — `.claude/hooks/completion-gate.sh`

Runs the completion gate when a turn ends and returns
`{"decision": "block", "reason": ...}` while it is red, so the turn cannot end
over a failing check. The gate stops depending on an agent remembering it at
the one moment they are least likely to.

How it decides what to run:

| Behaviour                                                                                  | Why                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exits immediately when `stop_hook_active` is true                                          | A blocked stop re-enters the model, which stops again. Without this the pair loops.                                                                                                                                                       |
| Scope is **unpushed** work (working tree + commits not on any remote), not the branch diff | A clone with a stale `origin/main` reports its whole recent history as the branch diff — 396 files here — which would run a full frontend typecheck at the end of every docs-only turn. Commits already on a remote have been through CI. |
| Runs only the checks whose file types changed                                              | A docs-only turn costs 0.03s.                                                                                                                                                                                                             |
| `npm run typecheck`, never a bare `tsc`                                                    | The wrapper resolves the aliased TypeScript 7 the project builds with; `tsc` on `PATH` is the 5.9.3 typescript-eslint pins. See CLAUDE.md § "Two TypeScript installs".                                                                    |
| `eslint` on changed files; `flake8` / `black --check` on changed files                     | `npm run lint` over the whole project took minutes — an unacceptable per-turn tax. CI still lints the full tree, and `--max-warnings 10` on a subset is stricter than CI, never looser.                                                   |
| Caches a pass, keyed on a hash of **file content**                                         | `git status --porcelain` prints the same line (`?? file`) for two different edits to one file, so a status-only key would treat a second, broken edit as the tree that already passed.                                                    |
| A missing tool reports and does **not** write the pass marker                              | CLAUDE.md is explicit that an unavailable tool is reported, never silently passed. It does not block: a missing interpreter is not something the model can fix by working longer.                                                         |

Measured on this repository: ~10s when frontend files changed (whole-project
typecheck plus scoped lint), ~2s for backend-only changes, 0.03s when neither
changed, 0.05s on a cached pass.

Verified by piping synthetic Stop payloads through the hook: the loop guard,
the no-op path, a green pass and its cache, cache invalidation on a
same-filename content change, a `flake8`/`black` failure, a `tsc` failure, an
`eslint` failure (the pitfall-16 `window.confirm` ban), and the
missing-tooling path.

**Two caveats for whoever picks this up.** The hook fires outside the turn
that installs it, so it could not be proven live from the session that wrote
it — open `/hooks` once, or restart, if it does not fire. And it is committed
to project settings, so it applies to every contributor using Claude Code on
this repository, not just one machine.

---

## 8. The migrations skill, as built

Step 3. Built on the `docs/rules/` + thin-pointer split from §5, on one rule
set, so the pattern can be judged on evidence before anything else moves.

### What moved, and what did not

The gate in §5 is that a rule may only be reached through a skill if a missed
trigger costs a red build rather than a shipped defect. Applying it decided the
split, and it excluded more than expected:

| Rule                                                                                                                    | Machine check                                                                                         | Outcome                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pitfall #26 — guard a table only `create_all` builds                                                                    | `test_migration_create_all_tables.py`, 1,533 lines of static analysis over every migration            | **Moved**                                                                              |
| Pitfall #23 — a seeded rank grant reaches the DB through a position                                                     | `test_baseline_member_grants.py`, `test_seeded_position_grants.py`, `test_rank_registry_agreement.py` | **Moved**                                                                              |
| Alembic hygiene — single head, complete chain, non-empty `downgrade()`, `DROP TABLE IF EXISTS`, chronological revisions | `test_alembic_migrations.py`                                                                          | **Documented for the first time**; the test was the only place these were written down |
| Pitfall #8 — seed ordering and `SEED_DATA_FILES`                                                                        | none — `grep -rn SEED_DATA_FILES backend/tests/` returns nothing                                      | **Stayed in CLAUDE.md**                                                                |
| Pitfall #12 — JSON column shallow copies                                                                                | behavioural tests per feature; nothing flags a new `dict()` copy                                      | **Stayed** (and is a service rule, not a migration one)                                |
| Pitfall #20 — canonical JSON shape                                                                                      | its migration half is inseparable from its write-path half                                            | **Stayed** — splitting a coherent rule is how the halves drift                         |

Pitfall #8 is the one worth noting: it reads like a migration rule and sits in
the middle of the ones that moved, and it is precisely the kind of rule the
gate exists to hold back. Give it a guard and it can move.

### Files

| File                                          | Role                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/rules/migrations.md`                    | The prose. How the schema is actually built (`create_all` + `repair_schema` + Alembic), the hygiene rules CI enforces, pitfalls #26 and #23 verbatim, and what stayed behind. |
| `.claude/skills/repo-migrations/SKILL.md`     | ~45 lines. When to load, the two rules that cost most, the pre-finish checklist, and the link.                                                                                |
| `CLAUDE.md`                                   | Pitfalls #23 and #26 keep their headings and numbers — ~20 code comments cite them by number — and now carry the rule in a paragraph plus a link. 97,985 → 92,176 bytes.      |
| `AGENTS.md`                                   | Points at `docs/rules/migrations.md` by path, so Codex and human contributors reach the same words.                                                                           |
| `.gitignore`                                  | `!.claude/skills/` added to the existing negation block.                                                                                                                      |
| `backend/tests/test_claude_skill_pointers.py` | The guard on the arrangement itself.                                                                                                                                          |

### Why the prose is not in the skill

`AGENTS.md:7` states CLAUDE.md's technical rules are "repository rules, not
Claude-only rules", and the commit history shows Codex running many of the
review rounds. Codex cannot read `.claude/skills/`. Filing the prose there
would not have relocated it — it would have deleted it for the other half of
the agents that act on it. `docs/rules/` is a path every reader can open.

### What guards the arrangement

- `scripts/check_docs_links.py` (the `docs-links` CI job) walks
  `git ls-files "*.md"`, which now includes `SKILL.md` — so a pointer that
  stops resolving fails the build. This is why the skill had to be committed
  rather than left gitignored.
- `backend/tests/test_claude_skill_pointers.py` covers the failures that are
  **not** broken links and would otherwise be silent: missing or malformed
  frontmatter, a `name` that no longer matches its directory, an empty
  `description` (the skill loads and never triggers), and a `docs/rules/` file
  that `CLAUDE.md` has stopped linking to. Each was verified by mutation —
  breaking the name, the link, and the CLAUDE.md pointer each failed exactly
  its own test and nothing else.

### Measuring it before extending it

§6 step 4 stands: this is one rule set, chosen because it is the best-enforced
one in the repository, and the question it exists to answer is whether the
skill actually triggers on real migration work. Run a few migrations through
it before moving tenancy, forms or tests. If it does not trigger reliably, the
pointer pattern is wrong here and ~12 k tokens of always-on rules is the
correct price.

---

## 9. The tenancy skill, as built

The second rule set (§4 item 2). Applying the §5 gate to it produced the most
useful finding in this whole exercise, and it is not a good one.

### The centrepiece could not move

**Pitfall #14 — org-scope every by-id query and every client-supplied FK — has
no repo-wide machine check.** It is the dominant finding class in the 2026-07
module audit and the highest-severity rule in the backend, and nothing scans
for a `select(Model).where(Model.id == x)` that forgot its `organization_id`
filter.

What exists is narrower than it looks:

- `test_org_scoping.py` tests the **helper** (`assert_in_org` and friends) —
  159 lines against a fake DB. It proves the helper fails closed. It says
  nothing about whether any call site uses it.
- `test_scheduling_org_scoping.py`, `test_audit_org_scoping.py`,
  `test_event_attachment_org_scoping.py`, `test_external_training_org_scoping.py`
  and their siblings cover the features they name, and only those.
- `test_endpoint_auth_coverage.py` sweeps every v1 endpoint — for
  **authentication**, not for org scoping. An authenticated handler that reads
  another org's row passes it.

So #14 stays in `CLAUDE.md` in full. A skill that quietly took the repository's
worst-consequence rule out of always-on context in exchange for ~1 k tokens
would be a bad trade, and the gate is what caught it.

`docs/rules/tenancy.md` opens by saying so, rather than leaving a reader to
infer that a file named after tenancy covers tenancy.

### What did move

| Rule                                                                                                    | Machine check                                                                                                                                                   | Outcome                                                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pitfall #25 — `like_pattern` + `escape=LIKE_ESCAPE_CHAR`                                                | `test_like_escaping.py` — two repo-wide static sweeps (`test_every_like_call_declares_the_escape_character`, `test_wildcard_escaping_lives_only_in_sql_search`) | **Moved**                                                                                      |
| Pitfall #27 — lock the parent **and** make the count a locking read                                     | `test_capacity_locking.py`, 499 lines: a static extractor plus per-site assertions at every known cap                                                           | **Moved**                                                                                      |
| The `org_scoping` helper API                                                                            | `test_org_scoping.py`                                                                                                                                           | **Documented for the first time** — it is the tool #14c mandates and it was written up nowhere |
| Endpoint auth coverage, permission-registry reachability, scheduled-task wiring, per-org loop isolation | `test_endpoint_auth_coverage.py`, `test_require_permission_registry.py`, `test_scheduled_task_coverage.py`, `test_cron_org_loop_isolation.py`                   | **Documented for the first time** — four enforced rules whose only written form was the test   |
| Pitfall #14 — org scoping                                                                               | none, repo-wide                                                                                                                                                 | **Stayed**                                                                                     |
| Pitfall #15 — `SafeCsvWriter`                                                                           | `test_csv_export.py` tests the writer, 50 lines; nothing scans for a bare `csv.writer`                                                                          | **Stayed**                                                                                     |
| Pitfall #9 — unbounded caches                                                                           | none                                                                                                                                                            | **Stayed**                                                                                     |
| Pitfall #18 — SMS behind `SmsAlert`                                                                     | resolver behaviour only; nothing flags a direct `SMSService` call                                                                                               | **Stayed**                                                                                     |
| Pitfall #19 — a config switch needs a reader                                                            | one mechanism guarded, the general rule not                                                                                                                     | **Stayed**                                                                                     |

Five of nine stayed. That ratio is the honest state of enforcement in this
area, and it is worth more than the token saving: it is a list of the five
places where a reviewer is the only thing standing between a rule and a
regression.

### The cheapest guard to add next — since written

A static sweep for `csv.writer` used outside `app/utils/csv_export.py`. This
was written the same day; see §10. Pitfall #15 moved out of the table above as
a direct result, which is the pattern behaving as intended.

### Files

`docs/rules/tenancy.md`, `.claude/skills/repo-tenancy/SKILL.md`, pointers in
`CLAUDE.md` (#25 and #27 keep their headings and numbers — **#27 alone is cited
160 times** across services and tests), `AGENTS.md`, and `docs/README.md`.
`backend/tests/test_claude_skill_pointers.py` needed no change: it walks
`.claude/skills/*/SKILL.md`, so it picked the new skill up on its own, verified
by breaking the new pointer and watching it fail.

CLAUDE.md is now 89,026 bytes, from 97,985 before any of this — about 2.2 k
tokens off every session, for two rule sets.

---

## 10. Closing a gap instead of relaxing the gate

§9 left a list of five rules that could not move because nothing enforced them,
and named the cheapest to fix. `backend/tests/test_csv_writer_sweep.py` is that
fix, and pitfall #15 moved into `docs/rules/tenancy.md` the same day.

This is the part of the arrangement worth keeping. The gate is not a filing
rule about where prose lives — it is a standing list of the places where a
reviewer is the only thing between a rule and a regression, and the way to
shorten it is to write the missing check.

### What the sweep does

An AST sweep over `backend/app/` and `backend/scripts/` failing on any
`csv.writer` or `csv.DictWriter` outside `app/utils/csv_export.py`, plus the
`from csv import writer` form that would otherwise walk around it. Readers are
untouched: `csv.reader` and `csv.DictReader` parse input and cannot inject a
formula.

**AST, not grep, and that is not a style preference.** The correct guidance
names the banned call — `csv_export.py`'s own docstring says "use this instead
of `csv.writer`", and so do comments at half the call sites. A line-based sweep
would flag the documentation telling you to comply, and the usual fix for that
is an allowlist, which is how a guard stops guarding.

`scripts/` is in scope alongside `app/` because an ops script that dumps a CSV
someone opens in Excel carries exactly the risk an endpoint export does. There
are no violations in either today, so including it cost nothing.

### Why it is 10 tests and not 1

A sweep that finds nothing looks identical to a sweep that has stopped
looking. Two things guard against that, both borrowed from
`test_migration_create_all_tables.py` and `test_capacity_locking.py`, which
already carry `TestTheDetectionItself` / `TestTheExtractionItself` for the same
reason:

- `TestTheDetectionItself` — eight cases proving the detector fires on the
  attribute call, the `DictWriter`, the import form and an unbound
  `w = csv.writer` reference, and does **not** fire on readers, on the safe
  wrappers, on an unrelated `self.writer`, or on prose naming the banned call.
- `test_the_sweep_actually_looks_at_the_exporters` — asserts four known
  exporters are still within the sweep's reach, so a `_python_sources()` that
  stopped covering them fails rather than passing silently. Anchored on named
  files, not a count, so adding an exporter does not fail it.

Verified end to end as well as at unit level: replacing a real
`SafeCsvWriter(output)` in `admin_hours_service.py` with `csv.writer(output)`
failed exactly one test, naming `app/services/admin_hours_service.py:1187`.

### Where that leaves the table

Four rules still have no machine check and stay in `CLAUDE.md`: **#14** (org
scoping — repo-wide, and the highest-severity of the lot), **#9** (unbounded
caches), **#18** (SMS behind the allowlist) and **#19** (a config switch needs
a reader).

**#14 is the one worth attacking next, and it is not cheap.** The others are
narrow; #14 needs a sweep that can tell an org-scoped query from an unscoped
one across 111 services, distinguish a client-supplied id from an internal one,
and recognise resolution through an already-scoped parent. A naive version
would be noisy enough to get allowlisted into uselessness. It is worth scoping
as its own piece of work rather than bolting on to this one.

CLAUDE.md is now 88,780 bytes, from 97,985.
