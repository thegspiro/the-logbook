# Claude Skills Review — The Logbook

**Date:** 2026-09-06
**Scope:** Which Claude Code skills would measurably improve how this
repository is worked on — both the skills already available to this account and
the project-local skills worth authoring.
**Status:** Review only. No skills were created; see "Recommended sequencing".

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
