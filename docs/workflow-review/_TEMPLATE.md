# Workflow Review — W<nn> <Activity>

**Driven:** <YYYY-MM-DD> · **As:** <roles> · **Viewports:** 1280×900, 390×844
**Commit:** `<short sha the servers ran>` · **Database:** fresh / continued from W<nn>

---

## What was driven

Numbered steps, each naming the role, the screen and the input — short enough
to repeat. Say what was _not_ driven and why, so a reader can tell which parts
carry a verdict.

1. As `<role>`, from `<where they start>`: …

## Held up ✅

Concrete, observed claims only — "the new member appeared in the directory for
`member` after a reload", not "adding a member works". Note the requests behind
each claim when the `events` list was clean.

## Findings

### W<nn>-1 — <SEVERITY> — <one-line title> — <✅ FIXED | OPEN | FLAGGED>

**Did:** the steps, as whom, at what viewport.
**Saw:** what the screen showed, and what the driver's `events` reported.
**Expected:** what a person doing this job needed instead.
**Where:** `path/to/file.tsx:123` (and the endpoint, if the fault is there).
**Fix:** what was changed and the test that now covers it — or, if not fixed,
why not and the options.

<!-- Severity: CRITICAL / HIGH / MED / LOW / NIT, by what happens to the
     department. FIXED = changed in this run, with a regression test.
     OPEN = should be fixed, not yet. FLAGGED = needs an owner decision;
     mirror it into docs/KNOWN_LIMITATIONS.md. -->

## Checklist

| Section                 | Result |
| ----------------------- | ------ |
| 1. The job gets done    |        |
| 2. The right people     |        |
| 3. Wrong input, failure |        |
| 4. Browser signals      |        |
| 5. Coming back to it    |        |
| 6. On a phone           |        |
| 7. Everyone can use it  |        |
| 8. What happens around  |        |

## Completion gate

| Check                    | Result |
| ------------------------ | ------ |
| npm run typecheck        |        |
| npm run lint             |        |
| flake8 (changed files)   |        |
| black --check            |        |
| frontend tests (touched) |        |
| backend tests (touched)  |        |
