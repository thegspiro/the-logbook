---
description: Run one iteration of the application-wide security review rotation
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, TaskCreate, TaskUpdate
---

Run **exactly one** iteration of the feature-by-feature security review, then
stop. This command is the unit of work for `/loop 30m /security-review`.

An iteration is **either** tending the open pull request **or** reviewing the
next feature — never both. A feature is not started while a security-review PR
is still open, so the rotation cannot outrun its own review queue.

## Step 0 — Is there an open security-review PR?

Read `docs/security-review/PROGRESS.md` → **Open PR** row.

- **A PR is open and not yet merged** → this iteration is a *tend* iteration:
  1. Fetch its state, CI result on the **current head SHA**, and unresolved
     review threads.
  2. Merge conflict → merge the base branch in and resolve it. Never rebase or
     force-push. Regenerate lockfiles and generated files with the repo's own
     tooling.
  3. CI red → root-cause it and push a fix. Never skip, disable, or quarantine
     a test; never push an empty commit to kick CI. If it is red on the base
     branch too, say so once and stop pushing for it.
  4. Review comments → implement small, local asks and push; resolve the
     threads you addressed. Reply with a proposal instead of pushing for
     anything architectural, then leave it to the owner.
  5. Update the **Open PR** row with what changed, and end the turn. Do **not**
     start the next feature.
- **The PR merged since the last iteration** → record it in the log, clear the
  **Open PR** row, mark the feature ✅, and continue to Step 1.
- **No PR open** → continue to Step 1.

## Step 1 — Pick the feature

Take the first feature marked ⬜ in `docs/security-review/PROGRESS.md`, or the
one named in `$ARGUMENTS`. Mark it 🔄. If every feature is ✅, say the rotation
is complete, reset all rows to ⬜ for a fresh pass, and stop.

## Step 2 — Load prior art before reading any code

Read, in this order, and do **not** re-derive what they already settled:

- `docs/security-review/CHECKLIST.md` — the seven dimensions.
- `docs/security-review/SEC-00-cross-cutting-baseline.md` — the whole-app sweeps
  and which invariants already have a guard test.
- `docs/module-audit/<module>.md` and `docs/app-review/<feature>.md` if they
  exist — start from their **open** findings.

Re-verify findings those left open. Do not re-report ones they fixed.

## Step 3 — Review

Work the feature against all seven checklist dimensions. Read the real code —
endpoints, service, models, schemas, migrations, frontend module. **Enumerate**
the endpoints and check each one's auth dependency and permission string rather
than spot-checking. Read a large service in sections; a truncated read reported
as "clean" is worse than an honest partial-scope note.

## Step 4 — Fix what is safe, flag what is not

Apply only clearly-correct, low-risk, verifiable changes. Anything that changes
behavior, needs a migration, or needs a product decision gets **flagged**, not
implemented. Never suppress an error to make a check pass — no `# noqa`, no
`@ts-ignore`, no cast to `any`, no deleted test.

When a fix closes a whole class, add a guard test that fails on reintroduction
(see `backend/tests/test_like_escaping.py` for the shape) so the next iteration
inherits the invariant instead of re-checking it by hand.

## Step 5 — Write the findings file

`docs/security-review/<feature>.md`, following `_TEMPLATE.md`. Every finding
gets an id, a severity, a `file.py:line`, a concrete failure scenario, and a
disposition (FIXED / OPEN / FLAGGED).

## Step 6 — Completion gate

```bash
cd backend  && flake8 app/ tests/ alembic/
cd backend  && black --check app/ tests/ alembic/
cd backend  && isort --check-only app/ tests/ alembic/
cd backend  && python3 scripts/validate_migrations.py --strict
cd backend  && python3 -m pytest tests/ -q -k "<what you touched>"
cd frontend && npx tsc --noEmit
cd frontend && npx eslint .
```

Run **all three** linters, and against `alembic/` as well as `app/` and
`tests/` — that is the path CI takes. **`isort` is the one that bites**, because
it is not installed in a fresh sandbox and `flake8` and `black` both pass
without it: SEC-00 shipped a green local gate and CI failed on a single
misordered import. If a linter is missing, `pip install` it at CI's pinned
version (see `.github/workflows/ci.yml` → Backend Lint) rather than noting it as
unavailable — an import inserted programmatically is exactly the change `isort`
exists to catch.

Record each result in the findings file. Fix every failure, including
pre-existing ones, per CLAUDE.md. If a tool genuinely cannot be installed, say
so explicitly — never report a gate you did not run.

## Step 7 — Update the docs

- Mark the feature ✅ (pending PR merge) in `PROGRESS.md` and append a log entry.
- Mirror owner-decision items into `docs/KNOWN_LIMITATIONS.md`.
- Mirror user-visible changes into `CHANGELOG.md`.
- If a finding contradicts `CLAUDE.md` or a module doc, correct it there too.

## Step 8 — Branch, commit, PR

Each iteration gets its **own** branch — never reuse a branch whose PR has
merged (CLAUDE.md Pitfall #24):

```bash
git checkout -b claude/security-review-<feature>
git add -A
git commit -m "security(<feature>): <n> fixes, <m> flagged"
git push -u origin claude/security-review-<feature>
```

Retry a failed push up to 4 times with backoff (2s, 4s, 8s, 16s). Open a PR
whose body lists every finding with severity and disposition, then subscribe to
its activity so CI and review events wake the loop. Record the PR number and
branch in the **Open PR** row of `PROGRESS.md`.

## Step 9 — Report

A short summary to the user: feature, fixes applied, findings flagged by
severity, gate status, PR link, next feature. Then end the turn.

## Rules

- One feature per run, or one tend pass. Finish it completely.
- Never start a new feature while a security-review PR is open.
- Prefer flagging over guessing. A wrong "fix" in a payments or permissions path
  is worse than an accurate finding.
- Findings must be verifiable: cite `file.py:line` and a reproducible scenario.
- A claim in "Verified good" must name the mechanism that makes it true.
