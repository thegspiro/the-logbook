# Skills Testing — Seed Data and Data-Lifecycle Review

> Reviewed: the skills-testing module end to end — template creation, the
> in-person examiner screen, officer validation, and how the resulting records
> are stored — against the module's own documentation screenshots in
> `docs/training/images/09-*.png`.

Related: [SKILLS_TESTING_FEATURE.md](./SKILLS_TESTING_FEATURE.md) ·
[SKILLS_TESTING_OFFLINE_PLAN.md](./SKILLS_TESTING_OFFLINE_PLAN.md) ·
[DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md](./DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md) ·
[Skills Testing Guide](./training/09-skills-testing.md)

---

## 1. A defect the screenshots were already showing

`docs/training/images/09-01-skill-templates.png` reports **2 templates, 7 tests
this month, Avg Score 0%**. Zero is not a plausible average across seven
evaluations, and it is not a rendering artefact — it is the correct answer for
that data.

The demo seeder wrote every criterion as `{"type": "checkbox"}`. `checkbox` is
not one of the five types the system understands:

```
pass_fail · score · time_limit · checklist · statement
```

Three things follow, and they compound:

1. **`ActiveSkillTestPage` renders no control for it.** The criterion branches
   are a chain of equality tests with no fallback
   (`ActiveSkillTestPage.tsx:680–716`), so an unknown type draws its label and
   a notes box and nothing to mark it with. The examiner physically cannot
   score the step.
2. **It carries no points.** `_criterion_point_value` returns `None` for
   anything that is not `score` or an opted-in `pass_fail`, so the point pool
   is empty and the percentage falls through to averaging section scores.
3. **It fails the test.** The seeder also set `required: True` (critical) on
   every criterion with `require_all_critical` on. `_criterion_outcome` returns
   `not_scored` for an unmarked step, and `build_score_breakdown` counts
   `not_scored` on a critical step as a **critical failure**
   (`skills_testing_service.py:262–273`).

So every seeded template produced evaluations that could not be scored, were
worth 0%, and failed on every single criterion. The templates list, the
picker and the member's "Available Tests" tab all looked healthy — the failure
only became visible as a number nobody was reading.

**Why nothing caught it.** `SkillCriterionSchema.type` was a bare
`str = Field("pass_fail", max_length=50)` with the valid values listed only in
a trailing comment. Nothing tied the stored value to the set of values the
rendering and scoring code actually branch on, and no test carried a template
blueprint through to a score.

### Fixed in this change

| Layer | Change |
| ----- | ------ |
| API | `CRITERION_TYPES` whitelist + a `model_validator` on `SkillCriterionSchema`. An unknown type is now a 422 naming the offending step and the accepted values. |
| Frontend | `hydrateTemplateSections` normalizes an unrecognized stored type to `pass_fail`, so templates already written into existing databases become scorable instead of silently failing. `??` could not do this — the stored value is a non-null string. |
| Seed data | Blueprints moved to `backend/app/data/skill_sheet_library.py` with `C_*` constants, so a typo is an `AttributeError` at import rather than an unscorable sheet in production. |
| Tests | `test_skill_criterion_type_validation.py` holds the whitelist closed; `test_seed_skill_sheet_library.py` validates every blueprint against the real create-template schema and then **scores it with the real scorer** — a clean run must pass with a non-zero percentage, and failing one critical step must fail the test. |

---

## 2. Seed data delivered

**`backend/app/data/skill_sheet_library.py`** — ten skill sheets, pure data, no
I/O, so the API, the general seeder, the screenshot harness and the test suite
all share one definition:

| Sheet | Category | Exercises |
| ----- | -------- | --------- |
| Patient Assessment / Management — Medical | Emergency Medical | NREMT critical steps, a scored hand-off |
| SCBA Donning — Timed Evolution | Fire Suppression | `statement` with `starts_timer`, `time_limit` |
| Bleeding Control and Shock Management | Emergency Medical | mid-evolution statement prompt |
| 24' Extension Ladder — Two-Firefighter Raise | Fire Suppression | `checklist` + timed raise |
| 1¾" Handline — Advance and Flow | Fire Suppression | critical PPE checklist, scored stream work |
| Pump Operations — Draft and Relay Supply | Apparatus Operations | point-scored rubric, 75% threshold |
| Emergency Vehicle Operations — Driving Course | Apparatus Operations | scored manoeuvres, course time limit |
| Primary Search — Limited Visibility | Rescue | staged statements, air-management critical |
| Hazmat — Level A Suit Donning and Doffing | Hazardous Materials | checklist-heavy safety gates |
| Company Officer — Incident Size-Up and Initial IAP | Command | `score_pass_fail_criteria` on, 80% threshold |

103 criteria: 77 `pass_fail`, 13 `score`, 6 `statement`, 4 `checklist`,
3 `time_limit`. Every rendering path has a worked example behind it.

**`scripts/seed_skills_testing.py`** — drives the public API as an
administrator (so it cannot drift from the schema or skip a service rule) and
produces a record in every state the UI renders differently:

```
draft · in progress · validated pass · validated fail (critical) ·
practice run · voided · pending validation
```

The last one needs a **non-officer** examiner, because an officer's own
completion validates in the same step. Pass `--examiner-username` /
`--examiner-password` to seed it; without them the script prints that it
skipped that state rather than leaving an empty validation queue unexplained.

`scripts/screenshots/seed_demo_data.py` now builds its templates from the same
library, so re-running the screenshot harness fixes the 0% in `09-01`.

---

## 3. Creation — what the test author hits

**3a. `score` with no `max_score` — fixed.** The builder showed a Max Score
field without requiring it, and `_criterion_point_value` returns `None` when
`max_score` is absent or zero: an author picked "Score", left the box empty, and
the step contributed nothing to the percentage — silently, exactly like
`checkbox`.

Now blocked at save with the offending section and criterion named, and warned
inline while the box is still empty. Deliberately *not* enforced in the API
schema: the template PUT resends every section, so a 422 would block edits to
templates saved before the rule existed, with no way to see which step was at
fault. The seeded library is held to the same rule by a test.

**3b. Every department typed NREMT sheets from scratch — fixed.** A new
organization saw an empty table and a New Template button.

`GET /training/skills-testing/library` now offers the ten sheets and
`POST /library/{slug}/import` copies one in, reachable from an "Add from
library" button and from the empty state itself.

Copy-on-demand rather than system-level seed rows, for the reason the review
identified: `SkillTemplate.organization_id` is `nullable=False`, and making a
tenancy column nullable to hold shared records is a bigger change than the
feature needs. Copying also gets the ownership right — an imported sheet is the
department's own, not a shared row that shifts under them on upgrade. It lands
as a **draft**: a published template can be selected for a live evaluation, and
a sheet nobody has read yet should not be.

**3c. Template sharing between departments.** Covered by
[DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md](./DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md),
which already lists `skill_templates` as JSON-structural with `created_by`
nulled. No new work needed here — worth confirming the criterion-type whitelist
is applied on **import**, since an import path that bypasses
`SkillTemplateCreate` would reintroduce §1 wholesale. The starter-library
import added in §3b goes through `SkillTemplateCreate` for exactly that
reason, and a test pins it.

**3d. No preview.** An author cannot see what the examiner will see without
publishing and starting a live test. Given that section and criterion identity
is positional and template edits rewrite `sections` in place, a preview is also
the cheapest place to surface "this edit changes what historical results mean".
**Medium.**

---

## 4. In-person usage — what the examiner hits

The examiner screen is in better shape than the rest of the flow: autosave is
wired (`useAutoSave`), every write carries `expected_version` so a concurrent
edit gets a 409 and a reload banner instead of a silent overwrite, and the
timer deliberately keeps running until review is actually entered so a
time-limited evolution is not under-recorded.

**4a. No connectivity, no evaluation.** Already scoped in
[SKILLS_TESTING_OFFLINE_PLAN.md](./SKILLS_TESTING_OFFLINE_PLAN.md) — not
re-litigated here. It remains the single largest in-person risk, and it is
blocked on **two owner decisions, not on engineering**:

- §5 — shared-station devices: logout currently purges unsynced work, and
  storing a named member's scorecard in IndexedDB on a shared browser profile
  is a new exposure. The plan's cheapest option (block logout while skills work
  is pending) should probably ship regardless of the other two.
- §6 — whether the real failure mode is "signal drops mid-drill" (Option A) or
  "we drive to a county facility with no coverage" (needs A+B). This changes
  whether the queue is keyed on server or client ids, which is structural.

Until that lands, `saveState: 'failed'` is the only signal that an evaluation
exists solely in browser memory — worth making louder than a status word.

**4b. Drill night is a batch — fixed.** The app knew about one test at a time,
so twelve people through one SCBA evolution meant twelve trips back to Start
Skill Test, re-picking the same sheet each time.

The candidate step now takes a list: picking someone adds them and leaves the
search open, each can be removed, and the button says how many evaluations it
is about to create. Tests are created one at a time and *sequentially* — the
attempt cap is checked against tests already recorded, so firing a squad's
worth together could let a candidate past a cap two racing requests both read
as not yet reached. One refusal does not discard the rest of the squad.

**4c. The candidate picker is typing-only.** `09-07` shows "Type at least 2
characters of a name to search". On a phone with gloves at a burn tower, a
recent-candidates row or a station/company roster shortcut beats typing. The
2-character floor is deliberate (it stops a single letter being used as a
roster export — see the endpoint comment at `skills_testing.py:731`) and should
stay; this is about adding a browse path beside it, not widening the search.
**Small.**

**4d. The viewers panel disagreed with the picker — fixed.** `09-13` granted
access through a plain `<select>` of the whole roster while the candidate step
used a typeahead: same task, two controls, and the `<select>` degraded badly
past a few dozen members.

Both now go through a shared `useMemberSearch` over the search-only candidates
endpoint. That matters beyond consistency — the endpoint requires a fragment
and caps its results, so the panel no longer pulls the full member payload to
name one person.

---

## 5. Validation — what the officer hits

**5a. The queue was a filter, not an inbox — fixed.** Pending results were
reached by setting a dropdown on the Test Records tab, and the tile in `09-01`
counted them without linking anywhere. The tile is now the way into the work it
counts.

**5b. No bulk validate — fixed.** An officer signed off a drill night's worth
of peer-run results one at a time, while every other approval surface in the
product has a bulk path.

`POST /tests/bulk-validate` delegates to `validate_test` per id rather than
reimplementing it, so separation of duties, the attempt cap, the pipeline apply
and the notification all behave identically — there is no second implementation
to drift, and what it would drift on is who gets credited for what. Partial
success is the normal outcome and each refusal is reported: an officer who
selected ten and got eight would otherwise walk away believing the queue is
clear. Selection is keyed by id, dropped on filter change, and select-all
covers exactly what the search has left on screen.

**5c. No way back to the examiner — fixed, owner-approved.** The only exits
from pending were `/validate` and `/void`, and the endpoint docstring was
explicit that "the rejection path is `/void`". Right for a result that was
*wrong* — the record survives with its reason, which is what a candidate who
sat the evaluation is owed — and a heavy instrument for "Engine 2's captain
mis-scored step 4, have him redo it", where the void is permanent and
candidate-visible and the correction becomes a second test.

`POST /tests/{id}/return` reopens the submission to its examiner with every
mark intact. It is refused on a validated result — that has credited a
requirement, spent an attempt and been shown to the candidate, and undoing it
is a void, which releases all three. The candidate is not notified: nothing has
been claimed about them, and "your evaluation was returned" discloses both that
they were tested and that something was wrong with it. `return_count` persists,
because one return is a slip and a third is a training conversation.

This reverses a documented design decision and was built on the owner's
explicit approval.

---

## 5d. Paper — the fallback that had no support at all

Training ships three print pages (`MemberTrainingPrintPage`,
`ProgramPrintPage`, `CompliancePrintPage`) and scheduling ships two. Skills
testing shipped none, which is odd for the one module whose work happens
furthest from a desk.

**Blank skill sheet — built in this change.** `SkillSheetPrintPage`
(`/training/skills-testing/print/template?id=…`, printer icon on each row of
the Templates tab) renders a published *or* draft template as the paper form an
examiner carries on a clipboard: a candidate/examiner/date block, the scoring
rules stated before the first mark, one marking affordance per criterion type
(P/F boxes, `___ / max` with the passing floor, a stopwatch blank with the
ceiling, a box per checklist item, and no box at all on a statement — it is
read aloud and marks itself), critical steps flagged `★ CRITICAL`, and
signature lines.

It exists because full offline support (§4a) is blocked on two owner decisions
and could sit for a while, while paper is what departments already fall back
to. Printing the department's *own* sheet rather than a generic one means what
gets marked in the field matches what gets transcribed afterwards — sections and
criteria are numbered exactly as the examiner screen numbers them, so a paper
mark maps onto one field with no interpretation in between. It goes through the
same `hydrateTemplateSections` the examiner screen uses, so a legacy
unrenderable type falls back to a P/F box here too rather than printing a step
with nothing to mark.

The sheet says of itself, in a boxed notice, that it is **not** the record and
must be entered in the app — because until it is entered and validated it
credits no requirement, consumes no attempt, and the candidate sees nothing.

**Completed scorecard — built in this change.**
`SkillTestScorecardPrintPage` (`/training/skills-testing/print/scorecard?id=…`)
prints a finished evaluation: who was tested and by whom, the verdict, the
server's own score breakdown section by section, what was recorded against
each step, and the officer sign-off the result rests on. Reachable from a Print
button on the member's own result page.

Two things it deliberately does *not* do. It derives nothing the API withheld —
`GET /tests/{id}` already runs the test → template → organization disclosure
chain and redacts before the payload leaves the server, so a candidate under
`scores` disclosure gets marks with the examiner's notes stripped and the print
page simply renders what arrived. And it refuses to print a result still
awaiting validation: the API withholds the outcome on those, so printing one
would hand the candidate a document reading as a failure nobody recorded.

The critical-failure box is what makes the page worth printing. A test can
score 80% and read FAIL, and on paper — with no tooltip to hover — the reason
has to be on the page or the record looks like an arithmetic error.

**CSV export — built in this change.** `GET
/training/skills-testing/tests/export/csv` with `detail=summary` (one row per
test) or `detail=criteria` (one row per evaluated step, which is what a state
or ISO reviewer asks for), filterable by status, candidate, template and
completion date. Export button on the Test Records tab.

Written with `SafeCsvWriter`, non-negotiably: criterion labels, examiner notes
and void reasons are all free text a member can influence, and the file is
opened in Excel by whoever assembles the packet (Pitfall #15). A test pins the
neutralization against those exact values rather than trusting the call site.

Officer-only (`training.manage`), deliberately. The list endpoint runs a
two-pass disclosure filter so a member sees only what policy allows; an export
honouring the same rules would silently produce a different file per reader,
which is the opposite of what an audit hand-off needs. Officers already see
every result in full, so the restriction makes the file's contents one
explainable thing. The export is audit-logged — a bulk read of every member's
evaluation results leaving the system is exactly the access an audit trail is
for.

Flattening is shared with the scorecard through `iter_criterion_rows` in the
service, so the outcomes in the CSV cannot drift from the ones on screen. The
matching rules are not obvious — positional with a label fallback, statements
not judged, non-critical scored steps reported as points rather than a verdict
— and a second implementation of them would diverge the first time one side was
fixed.

**Position ordering in the disclosure picker — fixed, but not for the reason
first recorded here.** The earlier note said the list was "rendered in whatever
order it returns". That was wrong: `list_roles` orders by `priority DESC, name`,
and it was working. The cause is that `priority` is an **authorization**
ranking — "higher priority = more powerful" — not an org chart, and **IT Manager
is seeded at 100, above Fire Chief at 95**. Rank order therefore opens the list
with the most privileged account rather than the most senior officer, which
reads as a recommendation and isn't one.

Now sorted by name. Rank order earns nothing in a checkbox list someone is
scanning for a specific title; alphabetical is the order you can predict before
you look.

---

## 6. Storage — how the records hold up

This is the strongest part of the module, and mostly needs confirming rather
than changing:

- **`template_snapshot`** freezes the template's structure *and* its scoring
  rules at test creation. Because criterion identity is positional, without
  this an edit to a published template would silently re-bind historical
  results to different criteria. Correct, and the reasoning is documented at
  the column.
- **Void, never delete.** Official results are evaluation records a
  certification may rest on. Voiding keeps the row, its reason and its author,
  stops it counting toward stats, and releases any pipeline requirement it
  credited. The mandatory ≥10-character reason is right.
- **`version`** as an integer rather than `updated_at` — MySQL `DATETIME`
  carries no fractional seconds by default, so two writes in the same second
  compare equal and the conflict goes undetected. Right call.
- **SET NULL on every people-column** (`validated_by`, `released_by`,
  `voided_by`, `granted_by`), all `nullable=True` per CLAUDE.md Pitfall #2, so
  a departing officer cannot un-validate a result or erase a void record.
- **Practice attempts** have a dedicated purge sweep and a matching
  `idx_skill_test_practice_created` index.

Two things to watch:

**6a. `section_results` is a plain `Column(JSON)` keyed positionally.** The
snapshot makes this safe for *reading back* a finished test. It is worth an
explicit test that a template edited between a test's creation and its
completion still scores against the snapshot — the failure mode is silent and
would only show up as a scorecard that reads slightly wrong months later.

**6b. Nothing in the schema ties a stored `type` to the code that branches on
it.** §1 is fixed at the API boundary, but the same shape of drift is available
to any future writer that bypasses `SkillTemplateCreate` — a migration, an
import path, a direct-SQL fix. `test_seed_skill_sheet_library.py` guards the
seed data; the import path (§3c) is the next one to cover.

---

## 7. Priority

| # | Item | Effort | Why now |
| - | ---- | ------ | ------- |
| 1 | ~~Unknown criterion type is unscorable~~ | — | **Fixed** |
| 2 | ~~No printable blank skill sheet~~ (§5d) | — | **Built** — the paper fallback while offline waits |
| 3 | ~~No printable completed scorecard~~ (§5d) | — | **Built** — audit hand-off and paper training file |
| 4 | ~~No CSV export of results~~ (§5d) | — | **Built** — `SafeCsvWriter`, officer-only, audit-logged |
| 5 | ~~Position ordering in the disclosure picker~~ (§5d) | — | **Fixed** — sorted by name, not by authorization rank |
| 6 | ~~`score` with no `max_score`~~ (§3a) | — | **Fixed** — blocked in the builder, warned inline |
| 7 | ~~Review queue is a filter, not an inbox~~ (§5a, §5b) | — | **Built** — tile links in, selection, bulk accept |
| 8 | ~~No batch testing~~ (§4b) | — | **Built** — one sheet against a squad |
| 9 | ~~No starter template library~~ (§3b) | — | **Built** — copy-on-demand, lands as a draft |
| 10 | ~~Return for correction~~ (§5c) | — | **Built** — approved by the owner; third exit from a pending result |
| 11 | ~~Viewers panel used a roster `<select>`~~ (§4d) | — | **Fixed** — same typeahead as the candidate picker |
| 12 | **Offline (§4a)** | L | **Partly started.** Scope decided (A+B); the logout guard shipped; Phases 1–3 blocked on §5 — see below |

### What offline still needs

The owner has chosen **plan options A+B**: persist an in-progress evaluation
locally and replay writes in order on reconnect, *and* allow starting a test
from a device that has never had signal for it.

**The logout guard has shipped** (plan §5.3). It was the one piece worth
building ahead of the rest: cheap, correct whichever way the retention question
goes, and it prevents a loss that already happens today with no offline queue
at all. An examiner whose saves are failing now gets a banner naming the
consequence rather than the words "Not saved", and logout names the evaluation
and offers *Stay signed in* / *Sign out and lose it*. It does not save the
work — it converts a silent loss into an informed choice.

What still blocks Phases 1–3 is the rest of **§5, shared-station devices.**
A+B means a named member's scorecard sits in IndexedDB on a browser profile the
whole watch shares, which is a new exposure on a module carrying PHI-adjacent
data. Encrypt the queue at rest, or accept the exposure as a decision recorded
in COMPLIANCE.md? That is a retention policy question, not an engineering one,
and it should be answered before implementation rather than during it.

Two things have already narrowed the gap this feature was closing:

- **The printable blank sheet** (§5d) covers the no-coverage case today. An
  examiner at a county training ground has a working fallback rather than a
  screen that cannot save.
- **Autosave plus optimistic concurrency** already covers the common
  same-signal loss: a locked phone, a killed tab, a second examiner on the
  same test.

What remains uncovered is the signal *dropping mid-evolution*, which is what
A+B is for.

### Not fixed, noted while passing

- **The criterion editor's labels are not associated with their controls.**
  `<label>Type</label>` sits beside its `<select>` with no `htmlFor`, so the
  type, max-points, time-limit and checklist inputs have no accessible name —
  a screen-reader user tabbing the builder hears nothing. Small, and worth
  doing across the whole editor rather than one field at a time.
