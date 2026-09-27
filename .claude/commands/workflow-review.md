---
description: Drive the next pending activity of the workflow review in a real browser
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, TaskCreate, TaskUpdate
---

Run **exactly one** activity of the workflow review, then stop. This command is
the unit of work for `/loop /workflow-review`: the next activity starts only
when this one is finished, so do not batch activities and do not leave one
half-driven.

## Steps

1. **Pick the activity.** Read `docs/workflow-review/PROGRESS.md` and take the
   first activity marked ⬜. If an argument was passed (`$ARGUMENTS`, e.g.
   `W23`), take that one instead. If none is ⬜, say the rotation is complete
   and stop. Mark the chosen activity 🔄. Read its **Leads** entries, and
   `docs/workflow-review/CHECKLIST.md`.

2. **Bring the application up.** From the repository root:

   ```sh
   scripts/workflow-review/start.sh            # keeps the data earlier runs made
   node scripts/workflow-review/seed.mjs        # a no-op once seeded
   node scripts/workflow-review/driver.mjs >.workflow-review/driver.log 2>&1 &
   ```

   Reset (`start.sh --reset`, then the seed) only when the database cannot
   serve this activity — say why in the log entry. If the servers will not
   start or the seed fails, that failure **is** the finding: record it, mark
   the activity ⛔, and stop rather than working around it.

3. **Learn the activity from the code before driving it.** Find its pages,
   the endpoints they call, and the permission each endpoint requires, so you
   know which roles should succeed and which should be refused.

4. **Drive it.** Send short scripts through `scripts/workflow-review/send.sh`
   (see `docs/workflow-review/README.md` for the `wr` helpers). Work through
   every checklist section as the roles in the row, reading the returned
   `events` on every step. Check results from the other role's session and
   after a reload, never from a toast. Repeat the core step at 390×844.

5. **Fix what is safe; flag the rest.** A clear, verifiable defect gets fixed
   with a regression test at the lowest level that reproduces it (a Vitest
   component test, a pytest), then re-driven in the browser to confirm. A
   change someone may rely on, a migration, or a product decision gets
   **flagged**, not implemented. Never silence an error — no `# noqa`, no
   `@ts-ignore`, no cast to `any`, no deleted or skipped test.

6. **Write the findings file** at `docs/workflow-review/W<nn>-<slug>.md` from
   `docs/workflow-review/_TEMPLATE.md`. Every finding has an id (`W<nn>-<n>`),
   a severity, what was done and seen, a file and line, and a disposition.

7. **Run the completion gate** and record it in the findings file:

   ```sh
   cd frontend && npm run typecheck && npm run lint
   cd backend  && flake8 <changed files> && black --check <changed files>
   ```

   plus the tests covering what you changed, and the registries of CLAUDE.md
   pitfall 30 if a route was added. Fix every failure, including pre-existing
   ones, per CLAUDE.md; if one genuinely exceeds this run, stop and report the
   full list. Do not report a check you did not run as clean.

8. **Update the tracker.** Mark the activity ✅ (or ⛔) in `PROGRESS.md`, remove
   the leads this run resolved, add any new leads seen in passing for other
   activities, and add a log entry: roles driven, what held, fixes, flags by
   severity, gate result, next activity. Mirror flagged owner decisions into
   `docs/KNOWN_LIMITATIONS.md`. Do **not** write to `CHANGELOG.md`.

9. **Commit and push** the current branch:

   ```sh
   git add -A
   git commit -m "docs(workflow-review): W<nn> <activity> — <n> fixed, <m> flagged"
   git push -u origin HEAD
   ```

   Retry a failed push up to 4 times with exponential backoff (2s, 4s, 8s,
   16s). Leave the servers running for the next run; `start.sh --stop` ends
   them.

10. **Report** a short summary: the activity, what held, fixes, findings by
    severity, gate status, and the next activity. Then end the turn.

## Rules

- One activity per run, finished completely.
- Drive, do not infer. A claim in the findings file is something the browser
  showed, or it is labelled as read from code.
- Prefer flagging to guessing, above all in permissions, money and member
  records.
- Sign-ins are rate limited (five a minute, then a half-hour lockout). Resume
  sessions with `wr.as(role)`; call `wr.login(role)` only when one has expired.
- Never point the harness at the application or test database, and never
  commit anything from `.workflow-review/`.
