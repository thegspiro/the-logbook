# Member Performance Evaluations

Yearly (and interim) performance evaluations of members, built from a form the
department designs for each kind of member, with figures pulled from the rest
of the Logbook, a fixed workflow of steps, typed and re-verified signatures,
and a frozen PDF carrying the department's logo and name.

This page is the developer reference. The administrator and member guide is
[`wiki/Module-Evaluations.md`](../wiki/Module-Evaluations.md).

Shipped in #3875, #3888, #3921, #3925, #3928, #3929, #3933, #3936 and #3938
(November 2026).

## Design rules that everything else follows

These are recorded in `backend/app/models/evaluation.py` and are load-bearing.

- **What was signed never changes.** A template is edited as a draft version
  and frozen when published; an evaluation points at the version it started
  on. The figures are copied into `evaluations.data_snapshot` when drafted
  (and may be refreshed until the evaluator locks their part), never
  recomputed on view. Each signature carries the SHA-256 of the record it was
  given on, and the finalized PDF is generated once and served as that file.
- **Steps only move forward.** A completed step is never reopened. The one way
  back is an amendment, which starts a new revision with its own steps, parts
  and signatures.
- **Removal is never silent.** Deleting an evaluation leaves a deletion record
  with the reason on the member's history, and the member is emailed.
- **Nothing is kept about a member that the member cannot read.** There is no
  supervisor-only commentary (procedural bill-of-rights statutes such as Cal.
  Gov. Code 3255–3256). Calibration keeps ticks, never notes.

## Architecture

```
backend/app/
├── models/evaluation.py                      # all evaluation tables
├── schemas/evaluation.py                     # template definition, workflow, API shapes
├── api/v1/endpoints/evaluations.py           # /api/v1/evaluations/...
├── services/
│   ├── evaluation_template_service.py        # templates, versions, publishing
│   ├── evaluation_data_sources.py            # the catalogue of figures
│   ├── evaluation_data_service.py            # coverage + computing each figure
│   ├── evaluation_service.py                 # drafting, parts, workflow, signing,
│   │                                         #   bulk drafting, deletion, amendments,
│   │                                         #   responses, calibration
│   ├── evaluation_document_service.py        # the frozen PDFs
│   ├── evaluation_notice_service.py          # every email, and the daily scan
│   └── email_templates_evaluations.py        # the seven editable email templates
└── utils/evaluation_pdf.py                   # ReportLab layout (election letterhead)

frontend/src/modules/reports/
├── pages/
│   ├── EvaluationsPage.tsx                   # /reports/evaluations — templates and periods
│   ├── EvaluationTemplateBuilderPage.tsx     # /reports/evaluations/templates/:templateId
│   ├── EvaluationListPage.tsx                # /reports/evaluations/conduct
│   ├── MyEvaluationsPage.tsx                 # /reports/evaluations/mine
│   └── EvaluationDetailPage.tsx              # /reports/evaluations/:evaluationId
├── components/evaluations/                   # form, figures, steps, dialogs
├── services/evaluationsApi.ts
└── types/evaluations.ts
```

## Data model

| Table                          | One row per                              | Notes                                                                                                                                                     |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluation_templates`         | form a department uses                   | `kind` (`annual` or `interim`), and optionally the `member_class` / `member_status` it applies to                                                         |
| `evaluation_template_versions` | draft or published version of a template | `definition` (sections and items) and `workflow` (steps) as JSON; `published_at` freezes it                                                               |
| `evaluation_periods`           | review period                            | start and end dates; closed periods take no new drafts                                                                                                    |
| `evaluations`                  | member per period                        | unique per member and period; `revision`, `status` (`in_progress`, `finalized`), coverage, `data_snapshot`                                                |
| `evaluation_steps`             | workflow step per revision               | `status` (`pending`, `open`, `completed`, `skipped`), `due_date`, `reminder_sent_at`, `overdue_notice_sent_at`, and `flagged_items` on a calibration step |
| `evaluation_parts`             | written part per revision                | `kind`: `evaluator`, `self_evaluation` or `member_response`; `status` `draft` or `submitted`                                                              |
| `evaluation_signatures`        | signature per step per revision          | typed name, disposition (`signed`, `acknowledged`, `refused`), comment, `content_hash`, IP and user agent (audit only, never printed)                     |
| `evaluation_documents`         | frozen PDF per revision                  | `includes_response` separates the signed PDF from the one carrying the member's response; file SHA-256 and the record hash                                |
| `evaluation_amendments`        | amendment                                | from and to revision, reason, who and when                                                                                                                |
| `evaluation_deletion_records`  | deleted evaluation                       | names copied at deletion, reason, whether it was finalized; no foreign key to the deleted row                                                             |

`member_id` is `RESTRICT` on `evaluations` and `evaluation_deletion_records`:
a member with evaluation history cannot be hard-deleted, only archived.

## Permissions

| Permission              | Grants                                                                                                                                                                                                    | Seeded to |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `evaluations.configure` | build templates and their workflows                                                                                                                                                                       | Chief     |
| `evaluations.manage`    | open and close periods, draft for anyone and pick the evaluator, bulk drafting, amending, naming who takes a step, handing over a person's open work in a period                                          | Chief     |
| `evaluations.conduct`   | be assigned as an evaluator; draft an evaluation they conduct themselves                                                                                                                                  | Chief     |
| `evaluations.view_all`  | read every member's evaluations; complete calibration; see finalized grades on the conduct list, the grades by evaluator and a member's review history; export a period as CSV or as a zip of signed PDFs | Chief     |
| `evaluations.delete`    | delete an evaluation, with a reason                                                                                                                                                                       | Chief     |

There is no `view_own`: a member reaches their own evaluations on sign-in
alone. Nobody reads, amends or deletes their own evaluation through an
officer's grant. A manager runs the process but does not read personnel
content on `manage` alone; reading needs `view_all`, being the evaluator, or
being an approver at an open approval step. Approval steps are signed by
holders of the step's position.

**Separation of duties** _(owner decision 2026-11-16, ADV2-4)_. The evaluator
never approves or calibrates their own evaluation, and nobody signs two
approval steps on one revision. Where that leaves a step with nobody
eligible -- a department whose only Captain wrote the evaluation, say -- a
`manage` holder names who takes it (`PUT /{id}/steps/{key}/assignee`, with
step-up). The person named replaces the step's position holders (or the
`view_all` holders, for calibration) on that one evaluation, reads it as an
approver does, and is emailed if the step is already open. Any current
member may be named except the member and the evaluator, and, on an
approval, anyone who signed another approval on the revision. Clearing the
name hands the step back. An amendment's new revision starts with no names.
A position holder replaced by a name no longer sees the evaluation unless
they have another part in it.

The member's supervisor today, by the dated Reports To assignments, also
reads their evaluations, by relationship rather than by grant (owner decision
2026-11-01, built 2026-11-04). `GET /crew` lists every evaluation of the
members the caller supervises, and `GET /{id}` shows a supervisor what the
member may read: the status and steps at once, the parts, figures and
signatures once the evaluation is released to the member. The check is made
on each read, so an assignment that has ended grants nothing. No write path
reads it: a supervisor cannot draft, write, sign, calibrate, amend or delete
on the relationship alone.

Signing, deleting, naming who takes a step, handing over a person's open work
and downloading a period's signed PDFs require a recently re-verified session
(step-up); `STEPUP_HANDLERS` in `tests/test_mfa_policy.py` is the list that is
enforced.

## Templates

A template version holds a **definition** and a **workflow**.

**Definition:** up to 30 sections of up to 40 items. Sections may be
`officer_only`, shown only to members whose rank is in `officer_ranks`. Each
item has a tool:

| Tool            | Answer                                             | Scored |
| --------------- | -------------------------------------------------- | ------ |
| `labeled_scale` | one of the item's labelled levels                  | yes    |
| `numeric_scale` | one of the item's numbered levels                  | yes    |
| `meets`         | meets or does not meet                             | yes    |
| `checklist`     | the options ticked                                 | no     |
| `narrative`     | free text                                          | no     |
| `goals`         | a list of goals, each with an optional target date | no     |
| `goal_review`   | a result for each of the last review's goals       | no     |

Items can allow N/A, require an example for given levels, require or forbid a
comment, be left out of the self-evaluation, carry a weight, and carry a
**data block**: a figure from the catalogue below, with optional score bands
that turn the figure into a suggested rating. An evaluator whose rating
departs from the suggestion must say why (`justification`).

`overall_mode` is `sectioned`, `weighted` (the weighted average of scored
items, weights summing to 100), `evaluator` (the evaluator picks from the
fixed five-level scale: Unsatisfactory, Needs improvement, Meets expectations,
Exceeds expectations, Outstanding), or `none`.

**Grading by section** (`sectioned`, 2026-11-04) grades by section instead of
one weighted percentage. Section weights sum to 100, and item weights are
shares of their section. Each rating is placed on a 1 to 5 scale, a section is
the weighted average of its rated items, and the overall is the weighted
average of the sections. Per-form `grade_bands` turn a score into a grade
(defaults: Outstanding 4.5, Exceeds 3.5, Meets 2.5, Needs improvement 1.5),
read from the score as shown to one decimal. The evaluator may regrade a
section or the overall with a required reason; both grades are reported. The
one definition is `services/evaluation_grading.py`, used by the detail
response, the PDF and the stateless `POST /evaluations/grades` the screen and
builder preview call. `GET /evaluations/attention` feeds the counts on the
section strip.

**Workflow:** up to 12 steps, in this order of type: self-evaluation,
evaluator, calibration, approvals (any number, each signed by a position's
holders), member acknowledgement. Each step is due a number of days after the
period ends. The workflow also sets `reminder_days_before` (default 3),
`evaluator_may_proceed_without_self_evaluation` (default yes) and
`response_window_days` (default 30). An annual evaluation must end with the
member's acknowledgement; an interim check-in has only the self-evaluation and
evaluator steps and no signatures.

A form may have one `goal_review` item (see "Last year's goals" below). It
takes no data block and cannot be marked N/A as a whole.

**Starters:** a new template may start from a ready-made form
(`GET /templates/starters`, `starter` on `POST /templates`): the annual member
evaluation, the annual evaluation with officer sections, and the probationary
check-in. Each publishes as it stands. Since 2026-11-21 the annual forms open
their Development section with a "Last year's goals" item, and the check-in its
Next steps with "Since the last check-in"; templates made from a starter before
then are unchanged. The officer one adds an officer-only
Leadership and supervision section and needs `officer_ranks` on the create
request: required for it, refused for any other, and checked against the
department's ranks. A member without one of those ranks is graded on the other
sections alone, which keep nearly the plain annual form's shares.

**Matching:** when drafting without naming a template, the most specific
active, published template of the kind is used (class and status beats either,
which beats neither); two equally specific fits are refused rather than
guessed between.

## Figures

`evaluation_data_sources.py` is the catalogue; `evaluation_data_service.py`
computes each figure over the member's **coverage**, not the nominal period:
coverage starts at the first full month after the member joined or rejoined,
and gaps between stints of membership and approved leaves of absence are left
out. A member who served no full month of the period cannot be evaluated for
it. Where another screen already computes a figure, the data service calls
that code (pitfall #29).

| Key                                | Figure                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `training.hours`                   | hours of completed training records                                                 |
| `training.requirements_met_pct`    | share of applicable training requirements met (dashboard rules)                     |
| `training.session_attendance_pct`  | sessions counting toward the member's attendance requirement, its rule              |
| `events.meeting_attendance_pct`    | business meetings attended out of those held                                        |
| `events.attended_count`            | department events checked in to                                                     |
| `events.attended_by_type`          | department events checked in to, one line per event type                            |
| `shifts.hours`                     | hours on shifts worked                                                              |
| `shifts.count`                     | shifts worked                                                                       |
| `shifts.external_hours`            | hours worked for other agencies that the department counted, with how many shifts   |
| `shifts.performance_rating_avg`    | average 1–5 rating on shift completion reports                                      |
| `shifts.field_evaluation_averages` | average rating per field shift evaluation form, one line each (shown, never scored) |
| `calls.responses`                  | calls responded to                                                                  |
| `calls.response_pct`               | calls responded to out of all calls (not available when call tracking is off)       |
| `admin_hours.hours`                | approved administrative hours                                                       |
| `skills.tests_passed`              | skills tests passed                                                                 |
| `training.knowledge_tests_passed`  | knowledge tests passed, each once, with its best score                              |
| `apparatus.equipment_checks`       | equipment checks the member signed off, with how many found a failed item           |
| `inventory.overdue_at_period_end`  | items checked out past their due date and not returned on the period's last day     |
| `certifications.current`           | qualifications held at the period's end, with expiry dates                          |
| `certifications.expiring_soon`     | qualifications held at period end that expire within 90 days after it               |
| `positions.held`                   | offices and committee seats held at any time during the period                      |

A figure that cannot honestly be given is reported unavailable with a note,
never as zero or 100%.

**Four sources added on 2026-11-21**, each reusing the rule the owning module
already applies:

- `shifts.external_hours` reads the same month totals as `shifts.hours`, whose
  detail line has reported these hours as "not included" since 2026-11-01;
  only hours the department counted are included, as everywhere else.
- `training.knowledge_tests_passed` counts a submitted attempt marked passed,
  the program-milestone rule. A test passed twice counts once.
- `apparatus.equipment_checks` counts checks whose `checked_by` is the member,
  on a shift or standalone, by `checked_at`.
- `inventory.overdue_at_period_end` asks inventory's overdue rule
  (`overdue_checkout_clause`) as of the end of the period instead of now:
  checked out and due before then, and not checked in by then. That rule falls
  back to the stored overdue flag for a loan with no due date, which only
  describes today, so such loans are not counted. Temporary item assignments
  are not loans and are not counted either.

Their detail is the stored `breakdown`. None is marked turned off in the
builder: the Apparatus and Inventory modules are not switches that certainly
stop the data, and the training and scheduling ones follow their groups.

`calls.response_pct` _(2026-11-13)_ divides over `Coverage.included()`, the
stretches no exclusion touches: calls during a leave or a gap in membership
count on neither side. `calls.responses`, `shifts.hours` and `shifts.count`
still use the whole coverage. A rate already frozen into a snapshot keeps its
old value.

**Counts behind a figure** _(2026-11-13)_. Each source stores its supporting
counts beside its value (`met` / `total`, `attended` / `held`, `responses` /
`department_calls`, `capped`, `external_hours`, a waiver `breakdown`).
`figureDetail()` in `utils/evaluationRecord.ts` and `figure_detail()` in
`evaluation_document_service.py` word them alike ("75% · 6 of 8 meetings
attended"); change both together. Older snapshots that hold the counts show
them on screen; stored PDFs stay as signed.

**In the builder** _(2026-11-14)_:

- **Data shown with this item** groups sources by their catalogue `module`
  (`groupDataSources()`), in catalogue order; an unknown module goes under
  "Other". `events.meeting_attendance_pct` is tagged `meetings`; its key is
  unchanged.
- `GET /data-sources` sets `unavailable_reason` when the Training module is
  off (training sources), the Scheduling module is off (shift and call
  sources) or call tracking is off (call sources). Such a source reads
  "(turned off)" and stays selectable, since a published template may use it.
- `scoringGaps()` reports values no score band covers (below the first band,
  between bands, above a closed top band, and an exclusive upper bound such
  as exactly 100%) as "No rating is suggested for values …". Overlapping
  bands are still refused by the backend.
- The PDF's "Left out" dates use the page's date format.

### Waiver requests

Four more sources show the member's requests to be excused from a session
(owner decisions, 2026-11-10):

| Key                                | Figure                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `training.session_waivers_summary` | requests to be excused from a training session, and what became of them |
| `training.session_waiver_history`  | one line per training-session waiver request                            |
| `meetings.waivers_summary`         | requests to be excused from a business meeting, and what became of them |
| `meetings.waiver_history`          | one line per business-meeting waiver request                            |

Each reads `attendance_waiver_requests` for one workflow, counting a request
by the date of the session it excuses, within the review period and the
member's coverage: a session held between stints of membership is dropped, one
held during a leave is kept.

The summary's value is the number of requests; beside it are `approved` (what
counts toward the cap, a Chief's override of a denial included), `overridden`
(the part of `approved` that came by override), `denied` (standing denials),
`withdrawn`, `pending`, `voided` and `expired` (closed undecided seven days
after the session, an absence rather than a denial; owner decision,
2026-11-13), and a `breakdown` sentence. A withdrawn
request and its resubmission are two requests. Each history line carries the
session date and title, the status, the outcome in order ("denied by A, then
approved on the Chief's override by B"), the category, the decider,
`chief_override`, `attachment_on_file`, and the decision log's steps with
actor and local date.

They are **never scored** (`DataSource.scored=False`: a count of waivers is not
a grade), and they **never carry the member's reason, a decider's note or an
attachment**: an evaluation is permanent, the member reads it, and any of the
three may be medical. The rows are read column by column, so neither text is
loaded at all. `attachment_on_file` says whether at least one document is
on file for the request, read from `attendance_waiver_attachments`
(`_waiver_attachments_on_file`), and nothing else about it: not its name,
type, size or how many. Attachments are deleted `attachment_retention_days`
after a request closes, so the flag reports what was on file when the snapshot
was taken. The evaluation screens and PDF show the summary's `breakdown`
beside its count, and the history lines say what became of each request.
Adding these sources changed the stored shape of no existing entry, so
`SNAPSHOT_VERSION` stays 2.

## Workflow

1. **Drafting** (`POST /evaluations`, or `/bulk` for a whole period) takes
   the snapshot and opens the self-evaluation and evaluator steps together.
   With no evaluator named, a manager's draft goes to the member's supervisor
   when the supervisor holds `conduct`, otherwise to the drafter.
2. **Parts** are saved as drafts and submitted separately. The evaluator never
   sees an unsubmitted self-evaluation. If the member misses the
   self-evaluation's due date and the template allows it, the evaluator may
   lock without it (the step is marked skipped and the PDF says so).
3. **Calibration**, when the workflow has it, opens when the evaluator first
   submits. A `view_all` holder other than the evaluator, or the person a
   manager named on the step, completes it, optionally ticking items for the
   evaluator to revisit; the evaluator then submits again. While it is open,
   the evaluator's step is neither reminded nor reported overdue, and the
   evaluation reads as waiting on calibration _(2026-11-24)_.
4. **Approvals** are signed by the step's position holders, or by the person
   a manager named on the step, in order.
5. **The member** reads the evaluation once everything before the
   acknowledgement is done, and acknowledges receipt or refuses with a reason.
   Either finalizes it. Acknowledging is not agreement, and the PDF says so.
6. **Finalization** freezes the PDF (`ensure_document`; built on first
   download if building it at finalization failed). Since 2026-11-20 it is
   footed "Page X of Y": `render_evaluation_pdf` lays the record out twice,
   the first pass counting the pages. A PDF frozen earlier keeps "Page N".

A signature needs the signer's name typed as on their account (case and
spacing ignored), an intent checkbox, and step-up. The step is read under the
evaluation's row lock, and the unique key on (evaluation, revision, step) backs
that up.

## Handing over open work

When an evaluator or approver leaves or changes role, a holder of
`evaluations.manage` hands their open work in one review period to someone
else (owner decision 2026-11-21) from the conduct list's **Hand over work**:

- `GET /periods/{id}/reassign-options` lists who holds open work in the period,
  a former member included, with how many evaluations each.
- `GET /periods/{id}/reassign-preview?from_user_id=&to_user_id=` says what
  would move and what would be skipped and why, and changes nothing.
- `POST /periods/{id}/reassign` (step-up) does it, deciding each evaluation
  again under its row lock by the same rule, so it does what the preview said.

What moves, on evaluations still in progress: the evaluator's part while the
evaluator has not submitted (their draft stays, for the new evaluator to
finish and submit as theirs), and approval and calibration steps not yet done
that name the person. A step that goes to a position's holders follows the
position and is not moved. An evaluation moves whole or not at all: it is
skipped when the new person is its member, cannot conduct evaluations (for the
evaluator's part), is named on its approval or calibration (for the
evaluator's part), or is the evaluator or signed another approval (for an
approval). The new evaluator or assignee gets the usual "Evaluation waiting on
you" email for a step already open; the member is not emailed and sees the new
name. Each evaluation moved is audited as `evaluation_work_reassigned` at
`warning` with both people and what moved.

## Self-evaluation beside the evaluation

Once the member has submitted their self-evaluation, the evaluation screen
lists each rated item they answered beside the evaluator's rating of it, and
marks the items **far apart**: two or more levels on a scale, or opposite
answers on meets / does not meet. Those are the points worth raising when the
review is discussed. An unrated item or one marked not applicable is never
marked. For the evaluator writing their part it follows their unsaved ratings.
Only the scored items the self-evaluation includes are listed, and **Show only
those** narrows the list to the far-apart ones.

It is drawn on the screen from the two parts the server already sends, so it
shows nobody anything new: the evaluator sees the self-evaluation only once it
is submitted, and the member sees the evaluator's ratings only once they are
released (`compareSelfEvaluation` in `utils/evaluationRecord.ts`). It is not
printed on the PDF, which carries both parts in full.

## After finalization

- **Response** (`PUT /{id}/response`, `POST /{id}/response/submit`): the
  member, within `response_window_days` of finalization, writes a response that
  only they see until they submit it. Submitting is final. The response is
  printed in a second PDF (`includes_response`), and the signed PDF is kept as
  it was. The response is outside the record hash, so both PDFs carry the hash
  the signatures attested to. `GET /{id}/document` serves the latest PDF;
  `?version=signed` serves the signed one.
- **Amendment** (`POST /{id}/amend`, `manage`): reopens a finalized
  evaluation as revision N+1 from the evaluator onward. The self-evaluation
  carries over; the evaluator's part returns as a draft holding their previous
  answers; calibration, approvals and the acknowledgement run again; due dates
  restart from the amendment date with the template's spacing. The previous
  revision's parts (including any response) and PDFs are removed; its
  signatures stay. The reason is shown on the evaluation and printed in an
  Amendments section of the next PDF.
- **Deletion** (`POST /{id}/delete`, `delete` + step-up): writes the deletion
  record, removes the evaluation, its child rows and its stored PDFs, and emails
  the member. Records are listed at `GET /removed` (officers) and
  `GET /mine/removed` (the member).

## The last review

Every evaluation read (`GET /{id}` and each write that returns the evaluation)
carries `previous_review`: the member's most recent finalized evaluation on the
same template, whatever its version, whose period ended before this one began.
It holds that review's period, the overall grade and each section's grade that
stood (the evaluator's where they changed the calculated one; a weighted form
gives its percentage, an evaluator-rated form its overall rating), and the goals
its Goals items set, one entry per goal with its target date where it has one
(`goals_set`, the same reading the goal review copies), so this year's review
can say whether they were met.

It is read through `EvaluationService.detail` as the caller, so it shows exactly
what the caller could see by opening that review, and is `null` when they could
see none of it. An evaluator who could not open last year's review (a different
evaluator without `evaluations.view_all`) gets nothing. It is shown on the
screen beside the form and is not printed on the PDF: the PDF is the record of
this review alone.

## Last year's goals

A `goal_review` item rates each goal the member's previous review set. The
previous review is the one the last-review panel shows: the most recent
finalized evaluation on the same template, whatever its version, whose period
ended before this one began. Its goals are the goals on each `goals` item in
its evaluator's part, one entry per goal, keyed `<item>:<goal id>`. When the
item holds more than one goal each is labelled with its place in the item
("Goals for the coming year, goal 2"); a single goal takes the item's label.

**Goals are a list since 2026-11-22.** A `goals` item holds up to 20 goals
(`ItemAnswer.goals`), each with an id the form chooses, its text and an
optional target date. Every save stores that shape: an answer sent as free
`text` is stored as one goal (`goal-1`), and a goal still blank is left out
(`as_goal_list`). A part saved before then keeps its `text`, because a
submitted part is in the record hash its signatures attest to; it reads as one
goal keyed by the item alone, the key goal copies and ratings taken before
then already use. The PDF prints the list numbered, with "(by <date>)", and a
goal review prints each goal's target.

**The goals are copied into the evaluation** when it is drafted, under
`data_snapshot.previous_goals`, and copied again when the figures are
refreshed, which is allowed until the evaluator locks their part. A review
amended later does not change the copy once locked. Because the copy is part of
the record:

- it is read without regard to who is looking, unlike the last-review panel:
  everyone who reads this evaluation's content (the member, the evaluator,
  approvers, calibration and `view_all`) sees the goals it rates, even an
  evaluator who could not open last year's review. A manager without
  `view_all` does not, as with the rest of the content. The department chose
  this on 2026-11-21 so the record and its PDF can carry the goals they rate;
- it is in the record hash, so a signature attests to the goals as rated. The
  hash includes the copy only when there is one, so evaluations signed before
  goal reviews existed still verify;
- it is printed on the PDF beside each result.

Each goal gets a result, `met`, `partly_met`, `not_met` or `not_applicable`
("No longer applies", for a goal an assignment change made moot), and an
optional comment, stored in the item's answer as `goal_ratings` keyed by the
previous review's goals item. Submitting needs a result for every copied goal;
a rating for a goal not in the copy is refused. When the previous review set no
goals, or there is none, the item has nothing to rate and asks for nothing. If
the item is in the self-evaluation, the member rates them too. The results are
recorded and printed but do not count toward any grade.

## Review history

`GET /evaluations/{id}/history` (`view_all`) lists the member's other
finalized reviews, newest first, on any form: each one's form, period and the
overall result that stood (`standing_overall`, as on the conduct list). Each
is read through `EvaluationService.detail` as the caller, so a review the
caller could not open is left out, and an evaluation of another department
answers 404. The evaluation screen shows it as a Review history panel below
Last review, for `view_all` holders only. Grades from different forms are
listed side by side with the form's name, since the department may have moved
a member from one form to another.

## Period results

For a holder of `evaluations.view_all`, the conduct list (`GET /evaluations`)
gives each finalized evaluation its `overall_grade`: the result that stood, from
`standing_overall` (a sectioned form's overall grade, the evaluator's override
where they changed it; a weighted form's percentage; an evaluator-rated form's
overall rating). Anyone else gets `null`, and so does a review still in
progress, whose grade is not settled. A manager runs the process without
reading personnel content, so `evaluations.manage` alone does not show grades.

On the screen, choosing a period on the list shows how many of its reviews are
complete and how many stand at each grade, counted from the rows the server
sent. `GET /evaluations/export?period_id=` (view_all) downloads the period as
CSV, one row per evaluation with its grade, written with `SafeCsvWriter`. Each
export is audited as `evaluation_period_exported`. The caller's own evaluation
is left out of both, as the list leaves it out.

### Grades by evaluator

Below the period counts, a holder of `evaluations.view_all` sees how each
evaluator's finalized reviews in the period fall across the five grades, beside
the whole department's (`GET /evaluations/grade-spread?period_id=`). It is
counted from the rows and grades `list_evaluations` gives the conduct list and
the export, so the three agree, the caller's own evaluation left out as they
leave it out; reviews are grouped by the evaluator they stand under today. A
weighted form's percentage, or a form with no overall, has no place on the five
grades and is counted as "Not on the five grades". The spread is shown and not
judged: nothing flags an evaluator (owner decision 2026-11-22).

### Signed PDFs for a period

Beside Export CSV, **Download signed PDFs** (`GET /evaluations/export-pdfs?period_id=`)
gives a holder of `evaluations.view_all` one zip holding the signed PDF of every
finalized evaluation in the period: the copy the signatures attest to, without
any response the member added later (owner decision 2026-11-22). The
evaluations are those the conduct list and the export give the caller, so their
own is left out; a PDF never built is built first. It needs a recently
re-verified session, since it hands over a period's personnel records at once,
is audited as `evaluation_period_pdfs_exported` with the count, and is watched
by `SecurityMonitoringMiddleware` as a bulk export. Each file is named
"Member - Form - period end.pdf", reduced to letters, digits, spaces and
`.()-_` so no entry can point outside the folder it unpacks into. A PDF missing
from storage is listed in `NOT INCLUDED.txt` inside the zip, and logged, rather
than failing the download or silently dropping out.

## Emails

All seven are editable templates under Communications → Email Templates →
Performance Evaluations, and none carries a rating, comment, response or reason:
they name the member, the period and the step, and link to the Logbook.

| Template                  | Sent to                                                               | When                                             |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Evaluation Waiting on You | whoever acts on the step that opened; the evaluator after calibration | a step opens                                     |
| Evaluation Step Due Soon  | whoever acts on the step                                              | `reminder_days_before` days ahead, once per step |
| Evaluation Step Overdue   | whoever acts on the step, and `manage` holders                        | the day after the due date, once per step        |
| Evaluation Finalized      | the member and the evaluator                                          | finalization                                     |
| Evaluation Amended        | the member and everyone who signed the previous revision              | an amendment                                     |
| Evaluation Response       | the evaluator and `manage` holders                                    | a response is submitted                          |
| Evaluation Deleted        | the member                                                            | a deletion                                       |

Mail about the member's own evaluation is `EmailKind.PERFORMANCE_EVALUATIONS`
(always sent); mail an officer gets because of a role is
`EmailKind.EVALUATION_DUTIES` (optional). The reminders and overdue notices
come from the daily scheduled task `evaluation_due_notices`, which stamps each
step after sending so a second run sends nothing; a step whose recipients all
failed is left unstamped and retried the next day.

## Endpoints

All under `/api/v1/evaluations`.

| Method and path                                                                                                               | Who                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET/POST /templates`, `GET/PATCH/DELETE /templates/{id}`, `PUT/DELETE /templates/{id}/draft`, `POST /templates/{id}/publish` | `configure` (reading also `manage`)                                                           |
| `GET /templates/starters`, `GET /templates/preview-options`, `POST /templates/preview`                                        | `configure`                                                                                   |
| `GET /data-sources`, `GET /builder-options`                                                                                   | `configure`                                                                                   |
| `GET/POST /periods`, `PATCH/DELETE /periods/{id}`                                                                             | `manage` (reading also `configure`)                                                           |
| `GET ""`                                                                                                                      | `conduct`, `view_all` or `manage`                                                             |
| `GET /draft-options`, `POST ""`                                                                                               | `conduct` or `manage`                                                                         |
| `GET /bulk-preview`, `POST /bulk`                                                                                             | `manage`                                                                                      |
| `GET /periods/{id}/reassign-options`, `GET /periods/{id}/reassign-preview`                                                    | `manage`                                                                                      |
| `POST /periods/{id}/reassign`                                                                                                 | `manage`, with step-up                                                                        |
| `POST /grades`                                                                                                                | `conduct`, `manage` or `configure`; a stateless calculation, nothing stored                   |
| `GET /removed`                                                                                                                | `view_all`, `manage` or `delete`                                                              |
| `GET /grade-spread?period_id=`                                                                                                | `view_all`                                                                                    |
| `GET /export-pdfs?period_id=`                                                                                                 | `view_all`, with step-up                                                                      |
| `GET /export?period_id=`                                                                                                      | `view_all`                                                                                    |
| `GET /{id}/history`                                                                                                           | `view_all`; each review as the caller could open it                                           |
| `GET /mine`, `/mine/live-data`, `/mine/removed`                                                                               | sign-in                                                                                       |
| `GET /attention`                                                                                                              | sign-in; counts for the section strip                                                         |
| `GET /crew`                                                                                                                   | sign-in; lists only the evaluations of members the caller supervises today                    |
| `GET /{id}` and its actions                                                                                                   | anyone with a part in it; the service decides who may do what, and answers 404 to anyone else |
| `PUT /{id}/parts/{kind}`, `POST /{id}/parts/{kind}/submit`                                                                    | the part's author: the member for the self-evaluation, the evaluator for theirs               |
| `POST /{id}/refresh-data`                                                                                                     | the evaluator or `manage`, until the evaluator locks their part                               |
| `GET /{id}/document`                                                                                                          | anyone who may read the evaluation; each download is audited                                  |
| `POST /{id}/sign`                                                                                                             | the signer the open step waits on, with step-up                                               |
| `POST /{id}/calibration/complete`                                                                                             | the person named on the step, else `view_all`; never the evaluator                            |
| `GET /{id}/steps/{key}/assignee-candidates`                                                                                   | `manage`                                                                                      |
| `PUT /{id}/steps/{key}/assignee`                                                                                              | `manage`, with step-up                                                                        |
| `POST /{id}/amend`                                                                                                            | `manage`                                                                                      |
| `POST /{id}/delete`                                                                                                           | `delete`, with step-up                                                                        |
| `PUT /{id}/response`, `POST /{id}/response/submit`                                                                            | the member                                                                                    |

## Migrations

In order: `3fbd0fe30e5b` (tables), `b65eaef983b9` and `1476abf56dd3`
(Chief grants), `0ebd6603289b` (documents), `38e0f552242d` (notices, step
stamps), `857291750c67` (delete grant, deleted email), `6b2f0c9d4e71`
(amended email), `9d3a71c5e2b8` (response PDF, response email),
`4c8e2f61a9d7` (calibration flags), `a6c3e8d17f42` (step assignee). Each is safe to run twice and tolerates a
table `create_all` has not built (pitfall #26).

## Tests

- `tests/test_evaluation_workflow.py`: drafting, visibility, the workflow,
  figures, signing, notices and the daily scan, bulk drafting, deletion,
  amendments, responses and calibration flags, review history, grades by
  evaluator and the period's signed-PDF zip, driven over HTTP.
- `tests/test_evaluation_waiver_sources.py`: the four waiver-request sources.
- `tests/test_evaluation_rules.py`, `test_evaluation_template_schema.py`,
  `test_evaluation_models.py`: definition, workflow and model rules.
- `tests/test_evaluation_pdf.py`: the PDF text.
- `tests/test_evaluation_goal_list.py`: a Goals item stored as a list, the
  free-text answer turned into one goal, and parts saved before then read as
  they are.
- `tests/test_evaluation_pdf_bundle_names.py`: the period zip's entry names.
- `tests/test_evaluation_*_grant_migration.py`: the Chief grants.
- Frontend: `modules/reports/pages/Evaluation*.test.tsx`,
  `MyEvaluationsPage.test.tsx` and the component tests beside them.
