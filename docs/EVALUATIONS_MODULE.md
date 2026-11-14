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

| Permission              | Grants                                                                                   | Seeded to |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------- |
| `evaluations.configure` | build templates and their workflows                                                      | Chief     |
| `evaluations.manage`    | open and close periods, draft for anyone and pick the evaluator, bulk drafting, amending | Chief     |
| `evaluations.conduct`   | be assigned as an evaluator; draft an evaluation they conduct themselves                 | Chief     |
| `evaluations.view_all`  | read every member's evaluations; complete calibration                                    | Chief     |
| `evaluations.delete`    | delete an evaluation, with a reason                                                      | Chief     |

There is no `view_own`: a member reaches their own evaluations on sign-in
alone. Nobody reads, amends or deletes their own evaluation through an
officer's grant. A manager runs the process but does not read personnel
content on `manage` alone; reading needs `view_all`, being the evaluator, or
being an approver at an open approval step. Approval steps are signed by
holders of the step's position.

The member's supervisor today, by the dated Reports To assignments, also
reads their evaluations, by relationship rather than by grant (owner decision
2026-11-01, built 2026-11-04). `GET /crew` lists every evaluation of the
members the caller supervises, and `GET /{id}` shows a supervisor what the
member may read: the status and steps at once, the parts, figures and
signatures once the evaluation is released to the member. The check is made
on each read, so an assignment that has ended grants nothing. No write path
reads it: a supervisor cannot draft, write, sign, calibrate, amend or delete
on the relationship alone.

Signing and deleting require a recently re-verified session (step-up), as
listed in `wiki/Security-Authentication.md`.

## Templates

A template version holds a **definition** and a **workflow**.

**Definition:** up to 30 sections of up to 40 items. Sections may be
`officer_only`, shown only to members whose rank is in `officer_ranks`. Each
item has a tool:

| Tool            | Answer                            | Scored |
| --------------- | --------------------------------- | ------ |
| `labeled_scale` | one of the item's labelled levels | yes    |
| `numeric_scale` | one of the item's numbered levels | yes    |
| `meets`         | meets or does not meet            | yes    |
| `checklist`     | the options ticked                | no     |
| `narrative`     | free text                         | no     |
| `goals`         | free text for goals               | no     |

Items can allow N/A, require an example for given levels, require or forbid a
comment, be left out of the self-evaluation, carry a weight, and carry a
**data block**: a figure from the catalogue below, with optional score bands
that turn the figure into a suggested rating. An evaluator whose rating
departs from the suggestion must say why (`justification`).

`overall_mode` is `weighted` (the weighted average of scored items, weights
summing to 100), `evaluator` (the evaluator picks from the fixed five-level
scale: Unsatisfactory, Needs improvement, Meets expectations, Exceeds
expectations, Outstanding), or `none`.

**Workflow:** up to 12 steps, in this order of type: self-evaluation,
evaluator, calibration, approvals (any number, each signed by a position's
holders), member acknowledgement. Each step is due a number of days after the
period ends. The workflow also sets `reminder_days_before` (default 3),
`evaluator_may_proceed_without_self_evaluation` (default yes) and
`response_window_days` (default 30). An annual evaluation must end with the
member's acknowledgement; an interim check-in has only the self-evaluation and
evaluator steps and no signatures.

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
| `shifts.hours`                     | hours on shifts worked                                                              |
| `shifts.count`                     | shifts worked                                                                       |
| `shifts.performance_rating_avg`    | average 1–5 rating on shift completion reports                                      |
| `shifts.field_evaluation_averages` | average rating per field shift evaluation form, one line each (shown, never scored) |
| `calls.responses`                  | calls responded to                                                                  |
| `calls.response_pct`               | calls responded to out of all calls (hidden when call tracking is off)              |
| `admin_hours.hours`                | approved administrative hours                                                       |
| `skills.tests_passed`              | skills tests passed                                                                 |
| `certifications.current`           | qualifications held at the period's end, with expiry dates                          |
| `certifications.expiring_soon`     | qualifications held at period end that expire within 90 days after it               |
| `positions.held`                   | offices and committee seats held at any time during the period                      |

A figure that cannot honestly be given is reported unavailable with a note,
never as zero or 100%.

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
held during a leave is kept. Business-meeting requests read zero until that
workflow writes them.

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
loaded at all. `attachment_on_file` reads false until the attachments table
exists (`_waiver_attachments_on_file`). The evaluation screens show the
summary's count only; the breakdown is in the stored entry, and the history
lines say what became of each request. Adding these sources changed the stored
shape of no existing entry, so `SNAPSHOT_VERSION` stays 2.

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
   submits. A `view_all` holder completes it, optionally ticking items for the
   evaluator to revisit; the evaluator then submits again.
4. **Approvals** are signed by the step's position holders, in order.
5. **The member** reads the evaluation once everything before the
   acknowledgement is done, and acknowledges receipt or refuses with a reason.
   Either finalizes it. Acknowledging is not agreement, and the PDF says so.
6. **Finalization** freezes the PDF (`ensure_document`; built on first
   download if building it at finalization failed).

A signature needs the signer's name typed as on their account (case and
spacing ignored), an intent checkbox, and step-up. The step is read under the
evaluation's row lock, and the unique key on (evaluation, revision, step) backs
that up.

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
| `GET /data-sources`, `GET /builder-options`                                                                                   | `configure`                                                                                   |
| `GET/POST /periods`, `PATCH/DELETE /periods/{id}`                                                                             | `manage` (reading also `configure`)                                                           |
| `GET ""`                                                                                                                      | `conduct`, `view_all` or `manage`                                                             |
| `GET /draft-options`, `POST ""`                                                                                               | `conduct` or `manage`                                                                         |
| `GET /bulk-preview`, `POST /bulk`                                                                                             | `manage`                                                                                      |
| `GET /removed`                                                                                                                | `view_all`, `manage` or `delete`                                                              |
| `GET /mine`, `/mine/live-data`, `/mine/removed`                                                                               | sign-in                                                                                       |
| `GET /crew`                                                                                                                   | sign-in; lists only the evaluations of members the caller supervises today                    |
| `GET /{id}` and its actions                                                                                                   | anyone with a part in it; the service decides who may do what, and answers 404 to anyone else |
| `POST /{id}/sign`                                                                                                             | the signer the open step waits on, with step-up                                               |
| `POST /{id}/calibration/complete`                                                                                             | `view_all`                                                                                    |
| `POST /{id}/amend`                                                                                                            | `manage`                                                                                      |
| `POST /{id}/delete`                                                                                                           | `delete`, with step-up                                                                        |
| `PUT /{id}/response`, `POST /{id}/response/submit`                                                                            | the member                                                                                    |

## Migrations

In order: `3fbd0fe30e5b` (tables), `b65eaef983b9` and `1476abf56dd3`
(Chief grants), `0ebd6603289b` (documents), `38e0f552242d` (notices, step
stamps), `857291750c67` (delete grant, deleted email), `6b2f0c9d4e71`
(amended email), `9d3a71c5e2b8` (response PDF, response email),
`4c8e2f61a9d7` (calibration flags). Each is safe to run twice and tolerates a
table `create_all` has not built (pitfall #26).

## Tests

- `tests/test_evaluation_workflow.py`: drafting, visibility, the workflow,
  figures, signing, notices and the daily scan, bulk drafting, deletion,
  amendments, responses and calibration flags, driven over HTTP.
- `tests/test_evaluation_waiver_sources.py`: the four waiver-request sources.
- `tests/test_evaluation_rules.py`, `test_evaluation_template_schema.py`,
  `test_evaluation_models.py`: definition, workflow and model rules.
- `tests/test_evaluation_pdf.py`: the PDF text.
- `tests/test_evaluation_*_grant_migration.py`: the Chief grants.
- Frontend: `modules/reports/pages/Evaluation*.test.tsx`,
  `MyEvaluationsPage.test.tsx` and the component tests beside them.
