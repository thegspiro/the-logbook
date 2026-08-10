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
| Seed data | Blueprints moved to `scripts/skill_sheet_library.py` with `C_*` constants, so a typo is an `AttributeError` at import rather than an unscorable sheet in production. |
| Tests | `test_skill_criterion_type_validation.py` holds the whitelist closed; `test_seed_skill_sheet_library.py` validates every blueprint against the real create-template schema and then **scores it with the real scorer** — a clean run must pass with a non-zero percentage, and failing one critical step must fail the test. |

---

## 2. Seed data delivered

**`scripts/skill_sheet_library.py`** — ten skill sheets, pure data, no I/O, so
the general seeder, the screenshot harness and the test suite share one
definition:

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

**3a. `score` with no `max_score` is the same bug, still open.** The builder
shows a Max Score field but does not require it
(`SkillTemplateBuilderPage.tsx:530–561` validates checklist items and statement
text, not this), and `_criterion_point_value` returns `None` when `max_score`
is absent or zero. An author picks "Score", leaves the box empty, and the step
contributes nothing to the percentage — silently, exactly like `checkbox`.

Deliberately *not* fixed here: enforcing it in the schema would 422 on every
subsequent edit of a template saved before the rule existed, because the
template PUT resends every section. The right fix is at the point of authoring
— a builder-level validation error, plus a "this step carries no points" note
on the criterion row. **Small; do this one.**

**3b. Every department types NREMT sheets from scratch.** There is no starter
library — a new organization sees an empty table and a New Template button.
`scripts/skill_sheet_library.py` is now the raw material for shipping one.

One concrete blocker: `SkillTemplate.organization_id` is `nullable=False`
(`models/skills_testing.py:112`), so system-level rows in the style of the
facility seed data cannot exist yet. Shipping a library means either the same
`nullable=True` + `is_system` treatment the facility tables got (CLAUDE.md
Pitfall #2 and #8 — make the column nullable *before* the seed migration, and
register the file in `SEED_DATA_FILES`), or a "copy from library" action that
clones into the caller's org on demand. **The second is cheaper and avoids
touching the tenancy column.**

**3c. Template sharing between departments.** Covered by
[DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md](./DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md),
which already lists `skill_templates` as JSON-structural with `created_by`
nulled. No new work needed here — worth confirming the criterion-type whitelist
is applied on **import**, since an import path that bypasses
`SkillTemplateCreate` would reintroduce §1 wholesale.

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

**4b. Drill night is a batch, and the app only knows about one test at a
time.** Twelve people through one SCBA evolution means twelve trips back to
Start Skill Test, re-picking the same template each time. A "test the next
candidate against this sheet" action from the completed-test screen, or a
multi-select on the candidate step that queues a run per person, removes the
repetition where it actually hurts. **Medium, high value.**

**4c. The candidate picker is typing-only.** `09-07` shows "Type at least 2
characters of a name to search". On a phone with gloves at a burn tower, a
recent-candidates row or a station/company roster shortcut beats typing. The
2-character floor is deliberate (it stops a single letter being used as a
roster export — see the endpoint comment at `skills_testing.py:731`) and should
stay; this is about adding a browse path beside it, not widening the search.
**Small.**

**4d. The viewers panel disagrees with the picker.** `09-13` grants access
through a plain `<select>` of the whole roster
(`TestViewersPanel.tsx:167–179`) while the candidate step uses a typeahead.
Same task, two controls, and the `<select>` degrades badly past ~50 members.
Reuse the typeahead. **Small.**

---

## 5. Validation — what the officer hits

**5a. The queue is a filter, not an inbox.** `09-11` reaches pending results by
setting a dropdown on the Test Records tab to "Needs Validation". The summary
tile in `09-01` counts them, and the two are not obviously connected. A
first-class review queue — reachable from the tile, defaulting to pending,
showing the score and any critical failure inline — is the difference between a
workflow and a filter someone has to remember.

**5b. There is no bulk validate.** After a drill night an officer signs off
each result individually. Every other approval surface in the product
(purchase requests, submissions) has a bulk path. **Small once 5a exists.**

**5c. There is no way back to the examiner.** The only exits from pending are
`/validate` and `/void`, and the endpoint docstring is explicit that "the
rejection path is `/void`". That is a defensible design for a *wrong* result —
the record survives with its reason, which is right for something a candidate
sat for. But it is a heavy instrument for "Engine 2's captain mis-scored step
4, have him redo it": the void is permanent and visible on the candidate's
history, and the correction becomes a second test.

A `return_for_correction` transition — clears `validated_at`, reopens the test
to its examiner, records who returned it and why, credits nothing — would cover
the common case without spending a void. It should still be an auditable
transition, not a silent reopen. **Medium; worth a product decision first,
since it deliberately reverses a documented choice.**

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
| 1 | ~~Unknown criterion type is unscorable~~ | — | **Fixed in this change** |
| 2 | `score` with no `max_score` (§3a) | S | Same silent-zero failure, still live |
| 3 | Review queue as an inbox + bulk validate (§5a, §5b) | S–M | Officer-facing friction every drill night |
| 4 | Batch testing (§4b) | M | The actual shape of drill night |
| 5 | Starter template library (§3b) | M | First-run experience; the data now exists |
| 6 | Offline (§4a) | L | Blocked on two owner decisions, not engineering |
| 7 | Return for correction (§5c) | M | Needs a product decision first |
| 8 | Picker/viewer control consistency (§4c, §4d) | S | Cheap, and the panel degrades with roster size |
