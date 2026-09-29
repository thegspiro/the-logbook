# Workflow Review — W28 Skills Testing: Build a Sheet, Run a Test, the Member Sees the Result

**Driven:** 2026-09-29 · **As:** `training_officer`, `member`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `cf793988b` plus this run's changes · **Database:** continued from W27

---

## What was driven

1. As `training_officer`: Training → Skills Testing shows the member's view
   (Available Tests / My Results). The officer's tools are in Training
   Administration → Skills Testing.
2. There: New Template. Name "SCBA Donning & Doffing", category Fire
   Operations, section "SCBA", two criteria ("Dons SCBA within 60 seconds",
   Critical; "Performs seal check"). Create Template was double-clicked, then
   the template was published.
3. Start Skill Test: the template, Official Evaluation, candidate Jordan
   Avery (`member`), then Begin Evaluation double-clicked. Scored both steps
   PASS, then Finish & Review → Submit Test (double-clicked) → confirmed.
4. As `member` at 390×844: Skills Testing → My Results, and the test's API.
5. As `member2`: the test and the test list.

Not driven:

- An official test examined by a plain member, which goes to an officer's validation queue.
- A template set to release results only after an officer's release.

Both are deliberate policy with their own reasoning in
`skills_testing.py`. W28 took the officer-examined path.

## Held up ✅

- **Creating and running:**
  - A double-clicked Create Template made **one** template, and publishing asked first, saying what it does.
  - A double-clicked Begin Evaluation made **one** test.
  - A double-clicked Submit filed **one** result, after a confirmation that says the marks can't be changed afterwards.
- **The scoring screen:** PASS and FAIL carry `aria-pressed`, the section progress has an accessible name, and it saves as it goes.
- **The result page:**
  - It explains the result ("Judged on its critical steps — this sheet carries no scored steps, so there is no percentage").
  - It shows the completion time in the department's zone (3:50 AM Central for 08:50 UTC).
- **Validation:** an officer-examined official test is validated on submission.
- **What `member` sees:** their result on My Results ("pass", with the examiner and date), readable at 390px.
- **What `member2` sees:** 404 for `member`'s test, and an empty list.

## Findings

### W28-1 — LOW — The template builder's fields had no accessible names — ✅ FIXED

**Did:** `training_officer`, New Template.
**Saw:**

- Template Name, Category, Visibility, the linked requirement, Description, the time limit, Passing Percentage and Tags were named only by placeholders, or not at all.
- So was every criterion field: label, type, points, time limit, checklist, statement, and the failure effect.
- The section name and description had placeholders only.

**Where:** `frontend/src/pages/SkillTemplateBuilderPage.tsx:136`, `:1002` and
the fields around them.
**Fix:**

- Each label is tied to its control. Criterion ids are keyed to the criterion's `localId`, so ids stay unique across criteria.
- The section fields are named.

Covered by a new case in `SkillTemplateBuilderPage.test.tsx` (fails against
the old page). Re-driven: the whole template was built by label.

### W28-2 — LOW — Starting a test: unnamed fields, and a mode chosen only by colour — ✅ FIXED

**Did:** `training_officer`, Start Skill Test.
**Saw:**

- The candidate search, the requirement select and the notes box were named by placeholders only.
- Official Evaluation and Practice Run showed which was chosen only by a coloured border and a dot.

**Where:** `frontend/src/pages/StartSkillTestPage.tsx:339`, `:443`.
**Fix:**

- The three fields are named.
- The two mode buttons carry `aria-pressed`.

Covered by a new case in `StartSkillTestPage.test.tsx` (fails against the
old page).

### W28-3 — LOW — "Avg Score 0%" for a department whose only test passed — ✅ FIXED

**Did:** `training_officer`, Training Administration → Skills Testing, after
the test.
**Saw:**

- "Pass Rate 100%" beside "Avg Score 0%".
- The API sent `average_score: null`, because nothing tested carried points, and the tile rendered `?? 0`.
- Before any test, "Pass Rate 0%" likewise read as every test failing.

This is the "an empty set is not a passing set" corollary of CLAUDE.md
pitfall 29, in the other direction.
**Where:** `frontend/src/pages/SkillsTestingTemplatesTab.tsx:54`.
**Fix:** both tiles show "—" when the API has no figure. Covered by the new
`SkillsTestingTemplatesTab.test.tsx` (fails against the old tab). Re-driven:
"Pass Rate 100%", "Avg Score —".

## Checklist

| Section                 | Result                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ build, publish, examine, submit; the member sees the result                  |
| 2. The right people     | ✅ another member gets 404 and an empty list                                    |
| 3. Wrong input, failure | ✅ three double-clicks each acted once; confirmations before publish and submit |
| 4. Browser signals      | ✅ clean `events`; fixed W28-3 (0% for no data)                                 |
| 5. Coming back to it    | ✅ the result persists and is locked after submission                           |
| 6. On a phone           | ✅ My Results at 390×844                                                        |
| 7. Everyone can use it  | Fixed W28-1, W28-2; the scoring screen was already right                        |
| 8. What happens around  | Member-examined validation and delayed release not driven (see above)           |

## Completion gate

| Check                    | Result                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                          |
| npm run lint             | clean on the changed files, after two `no-node-access` warnings in the new test were removed                   |
| flake8 (changed files)   | no Python changed                                                                                              |
| black --check            | no Python changed                                                                                              |
| frontend tests (touched) | `SkillsTestingTemplatesTab`, `StartSkillTestPage`, `SkillTemplateBuilderPage`, `TrainingAdminPage` — 74 passed |
| backend tests (touched)  | none touched                                                                                                   |
