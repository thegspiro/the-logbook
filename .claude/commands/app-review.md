---
description: Review the next pending feature in the application review rotation
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, TaskCreate, TaskUpdate
---

Run **exactly one** iteration of the feature-by-feature application review, then
stop. This command is the unit of work for `/loop /app-review` — the next
feature starts only when this one is finished, so do not batch several features
into one run and do not leave a feature half-reviewed.

## Steps

1. **Pick the feature.** Read `docs/app-review/PROGRESS.md` and take the first
   feature marked ⬜. If an argument was passed (`$ARGUMENTS`), review that
   feature instead. If every feature is ✅, say the rotation is complete, reset
   Tier B to ⬜ for a fresh pass, and stop. Mark the chosen feature 🔄.

2. **Load context.** Read `docs/app-review/CHECKLIST.md`. For a Tier B feature,
   also read `docs/module-audit/<module>.md` and start from its open findings —
   do not re-derive what it already fixed. Read
   `docs/module-audit/CROSS-CUTTING.md` for the XC-1/XC-2/XC-3 patterns.

3. **Review** the feature against all six checklist dimensions. Read the actual
   code — endpoints, service, models, schemas, frontend module. Enumerate the
   endpoints and check each one's auth and permission gate rather than
   spot-checking. For a large feature, read the service in sections rather than
   skimming; a truncated read that reports "clean" is worse than an honest
   partial-scope note.

4. **Apply safe fixes only.** Clearly-correct, low-risk, verifiable changes:
   real bugs, security hardening, dead-code removal, doc corrections. Anything
   that changes behavior, needs a migration, or needs a product decision gets
   **flagged**, not implemented. Never suppress an error to make a check pass —
   no `# noqa`, no `@ts-ignore`, no casting to `any`, no deleting a failing test.

5. **Write the findings file** at `docs/app-review/<feature>.md` following
   `docs/app-review/_TEMPLATE.md`. Every finding gets an id, a severity, a file
   and line, a concrete impact, and a disposition (FIXED / OPEN / FLAGGED).

6. **Run the completion gate** and record the results in the findings file:

   ```bash
   cd frontend && npx tsc --noEmit
   cd backend  && flake8 app/ tests/        # from backend/, for .flake8
   cd backend  && black --check app/ tests/
   cd frontend && npx eslint .
   ```

   Plus the tests covering what you touched. Fix every failure, including
   pre-existing ones, per CLAUDE.md. If a fix genuinely exceeds this iteration's
   scope, stop and report the full list rather than continuing past it. If a
   tool is unavailable in the sandbox, say so explicitly — do not report a clean
   gate you did not run.

7. **Update the tracker.** Mark the feature ✅ in `PROGRESS.md` and append a log
   entry summarizing: what was verified good, fixes applied (with ids), findings
   flagged, and the next feature. Mirror owner-decision items into
   `docs/KNOWN_LIMITATIONS.md` and user-visible changes into `CHANGELOG.md`.

8. **Commit and push** to `claude/app-review-checklist-tdif23`:

   ```
   git add -A
   git commit -m "docs(app-review): <feature> — <n> fixes, <m> flagged"
   git push -u origin claude/app-review-checklist-tdif23
   ```

   Retry a failed push up to 4 times with exponential backoff (2s, 4s, 8s, 16s).
   Do not open a pull request unless asked.

9. **Report** a short summary to the user: feature, fixes applied, findings
   flagged by severity, gate status, next feature. Then end the turn.

## Rules

- One feature per run. Finish it completely.
- Prefer flagging over guessing. A wrong "fix" in a payments or permissions path
  is worse than an accurate finding.
- Findings must be verifiable: cite `file.py:line` and state the failure
  scenario concretely enough to reproduce.
- Do not re-report a finding already recorded and fixed in `docs/module-audit/`.
  Do re-verify ones left open there.
</content>
