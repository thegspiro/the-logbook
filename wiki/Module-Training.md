# Training Module

The Training module tracks courses, certifications, training requirements,
program enrollments, external training integrations, and compliance reporting.

---

> **Developers:** routes, API endpoints, the data model and the frontend
> architecture are on [Training Module — Developer Reference](Module-Training-Developer).

## Key Features

- **Training Requirements** — Hours, courses, certifications, shifts, calls,
  skills evaluations, checklists, and knowledge tests with annual, biannual,
  quarterly, monthly or one-time frequencies (plus rolling, certification-period
  and fixed-date due dates). Requirements target member categories (Active,
  Administrative, Probationary, Life, Retired, Honorary), ranks or positions, or
  apply to all members. See [Training Requirements](#training-requirements)
- **Requirement Templates** — Ten built-in templates for common standards that
  pre-fill the create form for review
- **Course-Library Requirement Links** — Course and certification requirements
  pick from the department's course catalog rather than taking free text
- **Requirement Freshness Window** — `recency_days` demands that the completion
  itself be recent ("CPR taken within the last 180 days")
- **Requirement Grandfathering** — Exempt members who joined before a cutoff, or
  give them a catch-up deadline
- **Department-Date Grading** — The compliance engine, program deadlines, recert
  windows and qualification/EVOC expiry judge "today" as the department's date,
  not the UTC server date
- **Training Programs (Pipelines)** — Structured multi-phase curricula with
  phase gating, milestone tracking, recert cycles, expiry and self-service
  withdrawal. See [Training Programs (Pipelines)](#training-programs-pipelines)
- **Multi-Class Courses & Cohorts** — A syllabus of classes per course, and a
  cohort generator that creates every class's event, session and RSVPs at once
- **Event-Driven Session Credit** — Finalizing a Training event's attendance
  writes each attendee's training record
- **Self-Reported Training** — Members submit training (with a certificate
  attached) for officer review; approved training can be applied to a pipeline
  requirement
- **Shift Completion Reports** — Officers file post-shift reports that
  auto-credit hours/shifts/calls/skills toward program requirements
- **Skills Testing** — NREMT-style psychomotor skill sheets with result
  disclosure rules, officer validation and offline scoring
- **Knowledge Tests** — Online written tests with a question bank and
  auto-grading, plus officer-entered scores
- **Compliance Matrix** — A triage rail: members grouped by standing
  (non-compliant, at risk, compliant), each requirement's figure on opening a
  member, and a By requirement view. Existing members inside a catch-up period
  show a neutral **Catching up** mark
- **First-Run Guidance** — The Training Officer Dashboard shows a dismissible
  **Set up training for your department** checklist (courses, requirements,
  first session, optional program); compliance with no active requirements reads
  **Not set up** instead of 100%; My Training, Programs and Course Library
  explain themselves to a member with nothing in them
- **Competency Matrix** — Department readiness heat-map with color-coded
  proficiency levels
- **Expiring Certifications** — Tiered alerts at 90/60/30/7 days with
  escalation for expired certs
- **Compliance Summary** — Per-member green/yellow/red compliance card on
  profiles
- **Training Waivers** — Leave of Absence auto-linking, waiver management,
  proportional requirement adjustment. Supports permanent waivers (no end date),
  a New Member waiver type, and multi-select "Applies To" (Training + Meetings +
  Shifts can be combined)
- **Bulk Record Creation** — Up to 500 records per request with duplicate
  detection (same member + course name + completion date within ±1 day)
- **Rank & Station Snapshots** — `rank_at_completion` and
  `station_at_completion` captured on every record
- **External Integrations** — Vector Solutions, Target Solutions, Lexipol,
  iAmResponding and Custom API providers with category and user mapping. See
  [External Training Integration](Module-Training-Developer#external-training-integration)
- **Historical Import** — CSV import with preview and per-row validation
- **Registry Integration** — NFPA Standards, NREMT Certifications and Pro Board
  one-click import with source URL citations and last-updated timestamps
- **National Registry Standard Linkage** — Training categories link to NREMT
  NCCR codes via `registry_code`, enabling compliance tracking against national
  continued competency requirements
- **Registry Generator Tool** — Standalone CLI tool (`generate_registry.py` at
  the repository root) for generating registries from standards bodies, with a
  `--list` flag to show available registries
- **Source Tracking on Imports** — Imported requirements carry `source`,
  `source_url`, and `last_updated` for traceability
- **Training Record Attachments** — Certificates, transcripts, and completion
  letters stored against a record
- **Member Self-Export & Officer Exports** — CSV/PDF exports of a member's own
  history and of department reports. See
  [Member & Officer Exports](#member--officer-exports)
- **Print Pages** — Paper-formatted member history, program and compliance
  matrix. See [Print Pages](#print-pages)
- **Recertification Tracking** — Recertification pathways and renewal tasks
  generated for members
- **Instructor Management** — Instructor qualifications (instructor, evaluator,
  lead_instructor, mentor), availability, and assignment to sessions with
  validation. Qualification create/update validate that the referenced
  `user_id`, `course_id`, `skill_evaluation_id` and `category_id` belong to the
  caller's organization, and list joins are org-scoped
- **Effectiveness Scoring** — Training effectiveness measured on the Kirkpatrick
  model (reaction, learning, behavior, results)
- **Multi-Agency Training** — Joint training coordination across departments
  with shared records and mutual aid tracking
- **xAPI (Tin Can) Integration** — Learning Record Store integration; statements
  are queued and sent by `POST /training/xapi/process`
- **Compliance Officer Tools** — ISO readiness, compliance attestations, annual
  compliance reports, compliance forecasting, and record completeness checks
- **Recurring Training Sessions** — Sessions recur using the events
  infrastructure (daily, weekly, biweekly, monthly, monthly_weekday, annually,
  annually_weekday, custom)
- **Manual Shift Report Page** — `/training/log-shift`, for departments without
  the Scheduling module
- **Manual Entry Admin Config** — `ManualEntrySettingsPanel` (Training Admin →
  Settings & Data → Manual Entry Rules) controls manual entry availability,
  allowed apparatus types, default start times, and default shift duration

---

## Training Requirements

### Types, frequency and targeting

A requirement has a `requirement_type` (hours, courses, certification, shifts,
calls, skills_evaluation, checklist, knowledge_test), a `frequency` (annual,
biannual, quarterly, monthly, one_time) and a `due_date_type`
(calendar_period, rolling, certification_period, fixed_date). `due_date` only
means anything for `fixed_date`: create and update clear it for every other
type, and compliance ignores it there, so a deadline comes entirely from the
period/anchor calculation.

Targeting is `applies_to_all`, membership types, ranks (`required_roles`
holds rank slugs) and positions (`required_positions` holds position slugs).
`include_current_month` on the requirement overrides the organization's
default (`compliance_configs.include_current_month`) for whether the
in-progress month counts; `NULL` inherits.

### Create/edit form

- **Per-type quantity fields** — the form collects `required_hours`,
  `required_courses`, `required_shifts`, `required_calls`, `checklist_items`,
  and `passing_score`/`max_attempts` for the matching requirement types, with
  client-side validation mirroring the backend `TrainingRequirementCreate`
  validator.
- **Applies-to-nobody guard** — saving is blocked when "Applies to all
  members" is unchecked and no member category is selected (unless the record
  targets by rank/position set elsewhere).
- **Duplicate copies all fields**, including shifts/calls/skills/checklist,
  passing score and registry fields.
- **Shift Credit** checkbox (`shift_credited`). Scheduling's Shift Compliance
  report grades only shift-credited requirements. A SHIFTS requirement is
  shift-credited by default; an HOURS requirement only when an officer ticks
  the box, so a training-hours requirement does not read compliant from
  ordinary duty shifts.

### Requirement templates

Selecting a template pre-fills the create form, so officers confirm hours, due
dates and assignment before a requirement starts counting against members. The
ten built-in templates:

| Template                               | Target                           |
| -------------------------------------- | -------------------------------- |
| NFPA 1001 Firefighter Annual Training  | 36 hrs, annual                   |
| NFPA 1500 Occupational Safety Training | 8 hrs, annual                    |
| NREMT EMT Recertification              | 40 hrs, 24-month rolling         |
| CPR/BLS Certification                  | 24-month rolling                 |
| Hazmat Operations Refresher            | OSHA 29 CFR 1910.120             |
| Bloodborne Pathogens Annual Refresher  | OSHA 29 CFR 1910.1030            |
| HIPAA Privacy & Security Awareness     | 45 CFR 164.530(b)                |
| SCBA Fit Test & Respiratory Protection | Checklist, OSHA 29 CFR 1910.134  |
| NIMS/ICS Initial Certification         | Courses: ICS-100/200, IS-700/800 |
| New Member Orientation Checklist       | Checklist, probationary members  |

Standards-based templates carry `source: national` with the registry name
(NFPA, NREMT, OSHA, HIPAA, FEMA) and the standard or CFR citation as
`registry_code`, so requirement cards show a source badge and (for loaded
registries) a citation link.

### Course-library links

Course and certification requirements pick from the department's course catalog
(`CourseLibraryPicker`, shared by the create-pipeline wizard, the pipeline
requirement modal, and the department requirements page); every evaluator
compares against a record's `course_id`. Certification requirements use the
link as an _additional_ exact match on top of the name/`training_type`/
registry-code heuristics. Every write path validates the ids against the
caller's organization via `assert_all_in_org`, reporting only "invalid" so it
cannot be used to probe another tenant. Changing a requirement's type away from
courses/certification clears the links.

**Certification name matching** is limited to legacy records
(`name_match_until`); see
[Compliance](Module-Compliance#one-definition-of-who-is-graded-and-how-2026-10-05).

### Freshness window

`recency_days` demands that the completion itself be recent ("CPR taken within
the last 180 days"), off by default. It is distinct from
`rolling_period_months`: that sets a recurring **obligation**, this is a
validity window on an **individual record**, so a department's one-time
requirement and a recruit pipeline's 180-day one can point at the same course
and disagree about the same record. It narrows the record pool _before_ the
frequency window in every evaluator, so it can only remove records.

It also gates the officer apply-training-record path (an explicit sign-off that
bypasses `allows_external_credit` by design, but not this). A record with no
completion date fails closed there with "That training has no completion date,
so it can't be credited toward this requirement's N-day window", matching the
read-path evaluator. `recency_days` is in the update path's clearable set.

### Existing-member exemption and catch-up

A requirement can separate members who joined before a cutoff from those who
joined after. Join date is `hire_date`, else account creation. All three
columns are nullable; `NULL` means no split.

| Field                      | Meaning                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new_member_cutoff_date`   | Members who joined before it are "existing"                                                                                                              |
| `existing_member_deadline` | With a cutoff: existing members have until this date; an unmet requirement is `catch_up` and counts neither way. Without it: existing members are exempt |
| `applies_to_joined_before` | Set on the preserved original when a change is saved **for new members only**; a copy carries the change                                                 |

Saving an edit "for new members only" keeps the original for existing members
and creates a copy for new ones. Adding a requirement to a program can **waive**
it for members already enrolled (`apply_to_current_enrollments: false`). Every
screen that decides which requirements grade a member goes through the shared
helper with the join date and rank; a sweep test fails on a call that omits the
join date. Splits and grandfathering changes are audited. Exports and the
forecast print N/A where a requirement does not apply.

---

## Training Records

- **Paging.** `GET /training/records` pages with `skip`/`limit` (at most 500)
  and returns `X-Total-Count`. Officers may list any member's records; others
  see only their own. **My Training** keeps records awaiting approval visible
  (undated records pass the date range and sort first).
- **Editing and voiding.** A `PATCH` tells the member what changed (optional
  `?reason=`). A `DELETE` requires a `reason`, marks the record `cancelled`
  rather than removing it, un-applies any pipeline credit and tells the member,
  so the correction stays auditable and its evidence stays with it.
- **Import validates per row.** A bad `training_type` or `status` fails that
  row with "Row N: Invalid <field> 'x'. Valid values: …" instead of failing the
  batch; case and spacing are forgiven. A bad `default_training_type` or
  `default_status` on the historical-import request fails the whole import.
- **Categories.** A record's `category_id` links it to a `training_categories`
  row (Fire, EMS, Hazmat, Rescue, …); categories carry an optional
  `registry_code` for NREMT NCCR areas, and category-based compliance (NCCR
  hours, the compliance matrix) reads it.
- **Start time.** `start_time` is stored on self-reported submissions and on
  the record an approval creates. A record without one reads blank rather than
  a guessed time.

### Attachments

`POST /training/records/{id}/attachments` stores the uploaded file (≤25MB; PDF,
JPEG, PNG, GIF, WEBP, DOC or DOCX, detected by magic bytes and malware-scanned)
through `FileStorageService` under
`/app/uploads/<org_id>/training-records/<record_id>/<uuid><ext>`, with metadata
in the `TrainingRecord.attachments` JSON column. `GET .../attachments/{index}/download`
streams a stored file. Access is the record owner or `training.manage`; server
file paths are never returned. The record download route also accepts the
self-reports storage area, because approving a submission copies its
attachment entries onto the record verbatim.

---

## Training Sessions & Attendance Credit

**Event attendance is the source of training credit.** A Training event's
Finalize Attendance writes each attendee's training record itself, crediting
the times set with Edit Times, else the measured check-out, else check-in to the
event's end. The record carries `source_event_id` (unique with `user_id`), so
reopening, correcting and re-finalizing updates that row in place. `/finalize`
and `/reopen` on a session run the event's own finalize/reopen under the event
lock. A member's check-in record is promoted to their completed record rather
than duplicated. Training events do not credit admin hours. Officer guide:
[Finalizing a Training Session](https://github.com/thegspiro/the-logbook/blob/main/docs/training/02-training.md#finalizing-a-training-session).

**Sign-off is governed by `require_completion_confirmation`.** When `false`
(the default), finalizing completes the records immediately with no officer
email. When `true`, members read **In Progress** until a `training.manage`
holder approves at `/training/approve/:token`, which can set each member's
approved minutes (0 = no credit). The submit must cover the roster exactly once
and is refused once the event is reopened, cancelled or re-typed.

**Certification eligibility.** A session has a "Counts toward certification
requirements" toggle (on by default). When off, attendance still records the
member's hours (general credit) but does not feed the linked
pipeline/certificate requirements, so hours a certifying body (NFPA/NREMT)
would not accept do not inflate a member's certificate.

**Recurring sessions** use the events recurrence patterns; the backend creates
the recurring events via `EventService` and links a `TrainingSession` to each
occurrence.

**Session form helpers:**

- **Course auto-populate** — selecting a course fills training type, credit
  hours, instructor, expiration months, and max participants, with a details
  preview card.
- **Quarter-hour time picker** — the `DateTimeQuarterHour` UX component splits
  date/time into a native date picker and a select restricted to `:00`, `:15`,
  `:30`, `:45` (browser `datetime-local` inputs ignore `step="900"`).
- **Quick duration buttons** — 1, 2, 4 and 8 hours, matching EventForm. They
  appear once a start date is set and fill the end date/time.

---

## Self-Reported Training

`/training/submit` asks for the training, a start time and a length (a
`DurationStepper`; hours are derived from the pair), and the certificate. A
revision request, a submission checklist and a receipt are distinct surfaces.

### The certificate travels with the submission

The form sends the file with the submission as multipart
(`POST /training/submissions/with-attachment`). PDF, JPG or PNG, up to 10 MB,
validated by magic bytes and stored under a server-generated name, so a double
extension cannot survive the trip and nothing is executed server-side. Files
are stored by `FileStorageService` in the organization's self-reports area
(`/app/uploads/<org_id>/self-reports/...`).

**Deleting or withdrawing a submission unlinks its file.** That is safe only
because a submission is deletable in `draft`, `pending_review` and
`revision_requested` alone — never after approval, the one state where a
`TrainingRecord` also references the same file. **If that guard is ever
widened, the delete must stop unlinking.** A voided record keeps its file by
design.

### Malware scanning

Every upload path, both certificate routes included, streams the file to a
ClamAV daemon (`app/services/malware_scan_service.py`, clamd `INSTREAM` over
TCP) after the magic-byte check and **before anything is written to disk**.
`CLAMAV_ENABLED` defaults to `true`, and the bundled daemon is the `clamav`
service every compose file starts.

| Outcome                    | Response                                 | Stored? | Audit                                                      |
| -------------------------- | ---------------------------------------- | ------- | ---------------------------------------------------------- |
| Clean                      | normal response                          | yes     | —                                                          |
| Infected                   | `400`, `LB-UPLD-004`                     | no      | `upload_malware_detected` — signature, type, size, SHA-256 |
| clamd unreachable/slow/err | `503` + `Retry-After: 60`, `LB-UPLD-005` | no      | — (logged at ERROR)                                        |
| Scanning disabled          | normal response; clamd never called      | yes     | —                                                          |

The outage row **fails closed**: accepting unscanned files whenever the scanner
is down is the state an attacker wants (the same reasoning as CAPTCHA). Files
stored while scanning was disabled are not rescanned. See
[Security Configuration](Configuration-Security#malware-scanning-of-uploads).

### Certificate retention

**Review Submissions → Settings → Certificate Files** sets how many days after
a decision (90 minimum) an approved or rejected submission's files are deleted
(`attachment_retention_days`). Unset (the default) keeps them indefinitely. The
daily `self_report_attachment_retention` task unlinks the files and removes the
references from the submission and the member's training records; the
submission and record rows stay. Audited per organization as
`self_report_attachment_retention`; changes to the period as
`self_report_attachment_retention_updated`.

### Review, notifications and integrity

A submission entering review notifies every active Training Officer (category
`training_submission`, **Review Submission**), archived for all of them once
anyone decides it. The member gets `training_submission_update` (**View My
Submissions**) when the outcome differs from what they sent — rejected,
approved with changes, revision requested, approval reversed — never on a plain
approval or a self-decision.

An officer cannot approve their own submission (a second officer must sign it
off). On approval (or retroactively from an approved submission) the officer
can apply the training toward a specific pipeline requirement in one of the
member's active enrollments — useful for make-up sessions with no scheduled
date. Hours accrue, a course counts as one completion, and status-based
requirements are marked complete; it is an explicit sign-off, so it bypasses
the `allows_external_credit` opt-in. Credit is recorded in an idempotency
ledger keyed on the submission, so a re-approval cannot double-credit, and
reversing an approval un-applies that credit and voids the spawned record.

---

## Training Programs (Pipelines)

Training programs run as **pipelines**: a program is broken into ordered
**phases**, each phase holds **requirements** (hours, courses, shifts, calls,
skills evaluation, certification, checklist, or knowledge test) and optional
**milestones**. Members are **enrolled**, and their progress is tracked from
enrollment through completion.

**Structure.** New programs choose between **phases** and a single flat list
(`flexible`); choosing the flat list skips the Phases step of the wizard.
`sequential` remains a valid stored value so existing programs load, but it is
not offered in the pickers: nothing enforces an order, so it behaves exactly
like `flexible`.

### Building & enrolling

- **Atomic wizard build** — the create-pipeline wizard saves the whole program
  (phases, requirements, milestones, program code, version and each phase's
  "require officer approval to advance" flag) in one request via
  `POST /training/programs/programs/build`. A failure part-way rolls back.
- **Enrollments tab** — the program detail page lists enrolled members by name
  with their progress percentage
  (`GET /training/programs/programs/{id}/enrollments`, `training.view_all` or
  `training.manage`).
- **Searchable member picker** — enroll a member by searching by name.
- **Guarded bulk enroll** — bulk enrollment checks prerequisite and
  concurrent-enrollment rules and blocks members who fail them, returning a
  per-member error list alongside the successful enrollments.
- **Export/import** — a program (phases, requirements, milestones) exports as a
  shareable JSON package; import validates the structure and auto-creates
  missing courses/requirements.

### Tracking progress

An officer opens an enrolled member and works one requirement at a time
(`PATCH /training/programs/progress/{id}`):

- **Log numeric progress** — hours, shifts, calls, or courses accrue toward the
  requirement's target (waiver-adjusted where applicable).
- **Set status** — mark a requirement **complete**, **in progress**, **reopen**
  it, or **verify** it. `requirement_progress.started_at` records when it went
  in progress.
- **Completing any requirement counts fully.** Marking a requirement
  completed/verified/waived sets it to 100%, including non-numeric types
  (checklist, skills evaluation, certification, knowledge test).
- **Overall %** is the **average of the required items** in the program.

### Phases that gate

- A **phase is complete** when all of its _required_ requirements are at 100%
  (a phase with no required items is trivially complete).
- **Auto-advance** — after any progress update, the member automatically moves
  through each consecutive completed phase.
- **Officer-approval phases stop auto-advance.** A phase flagged
  `requires_manual_advancement` halts the auto-advance and surfaces an
  **"Advance to next phase"** button for officers
  (`POST /training/programs/enrollments/{id}/advance-phase`; `force=true`
  overrides an incomplete phase).
- **Notifications** — on advancement, the member is notified, and so is their
  **mentor** if the enrollment has one.
- **Reopen on regression** — a completed enrollment that drops below 100% (a
  new required requirement is added, or an over-count is corrected downward) is
  set back to **active** and its completion cleared.

### What updates pipeline progress automatically

- **Shift completion reports** — an approved (non-draft) report credits shifts
  / calls / hours / observed skills to matching requirements.
- **Approved training sessions** — approving a session linked to a program
  advances the session's **linked requirement**; if the session is linked to a
  program **and a category** (with no explicit requirement), it advances all of
  that program's requirements in that category.
- **Passing a linked skills test** — once validated, completes the linked
  requirement (see [Skills Testing](Module-Training-Developer#skills-testing)).
- **Knowledge tests** — an online attempt or an officer-entered score.
- **External imports** — only for requirements an officer has opted in via the
  per-requirement `allows_external_credit` toggle (off by default): a synced
  course then advances a matching active-enrollment requirement (HOURS accrues
  hours, COURSES accrues one completion); in-house-only requirements are never
  checked off by an import.
- **Officer apply** — `POST /training/programs/apply-training-record` (see
  [Self-Reported Training](#review-notifications-and-integrity)).

Every automated accrual writes one `requirement_progress_credits` row, unique on
(progress, source type, source id), so a training is never double-credited and
a credit can be cleanly reversed.

### Knowledge-test scores

For a `knowledge_test` requirement, a score arrives either from an online
attempt (see [Knowledge Tests](Module-Training-Developer#knowledge-tests)) or from an officer recording a
**pass/fail** or a **score percentage** on the progress record. Both take the
same path:

- Pass/fail is derived from the requirement's **passing score** (default
  **70%**).
- A **pass** completes the requirement (which then rolls up and can advance the
  phase); a fail is recorded and leaves the requirement **in progress**.
- The requirement's **max attempts** are enforced — once all attempts are used
  and the requirement is not already satisfied, further scores are rejected.
- **Attempt history** (each score, pass/fail, timestamp, and recording officer)
  and the latest score are kept in the progress record's notes.

### Student progress view

From **My Training**, a member opens **"View full progress"** for an enrollment
to reach a read-only progression page (`/training/my-progress/:enrollmentId`).
It shows:

- **Current phase**, badged **"You are here"**
- **Overall %** and completed / total required items
- **Time remaining** (or days overdue) and a **behind-schedule** indicator
- **Next milestones** with their completion thresholds
- **Every requirement grouped by phase** with its status (not started, in
  progress, completed, verified, waived) and latest test score where relevant

Members may read their own enrollment; officers need `training.view_all` or
`training.manage` to view another member's.

### Attendance phase warning

When a member **RSVPs to** or **self-checks-into** a training session that
belongs to a phase **ahead** of their current phase, they get a **soft warning**
and can **proceed anyway** — the check-in retries with the override flag after
confirmation. Officers checking members in are **not** warned; the gate is a
nudge for self-service actions, not a hard block.

### Recert cycle

Pipelines can reset an enrolled member's accumulated progress for a new
certification cycle. Officers reset a single requirement or a whole enrollment
manually. A pipeline can also carry a stored recurring deadline (cycle length in
months plus an optional fixed anchor date, e.g. NREMT's March 30) that
auto-resets each enrollment when it passes — applied lazily on progress load
and by the daily 05:00 `recert_resets` scheduled task (also exposed as
`POST /training/programs/recert/run-due`).

### Withdrawal

A member can leave a program from their progression view (e.g. after
downgrading from Paramedic to EMT); officers can withdraw anyone. Withdrawal is
soft: the record is kept but removed from the active dashboard and its warnings,
and the member can be re-enrolled later.

### Enrollment expiry and reopen

An enrollment past its `target_completion_date` moves to `expired`.

| Transition           | Trigger                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active` → `expired` | **On read** — the progress endpoint transitions an overdue enrollment the moment anyone opens it (as `auto_reset_if_due` does) — and in the daily `enrollment_expiry` task (05:15), which covers records nobody opens |
| `expired` → `active` | `POST /enrollments/{id}/reopen` (`training.manage`), with an optional new `target_completion_date`                                                                                                                    |

- Both the member and the training officers are notified on expiry.
- Recertification treats `expired` as a renewable state.
- **Reopen leaves progress rows untouched** — the member keeps everything they
  finished — and re-runs the rollup, so someone who completed the work while
  expired is marked complete rather than waiting for the next edit.
- Expiry is **its own daily task**, separate from the weekly
  `enrollment_deadline_warnings` sweep, so a member-visible state change does
  not wait on the cadence of a reminder.

**See also:** [Compliance Module](Module-Compliance) |
[Scheduling Module](Module-Scheduling)

---

## Multi-Class Courses & Cohorts

A recruit school is one _course_ made of many _classes_ — different subjects on
an irregular cadence, not the same class repeating (which is what recurring
sessions cover). A course carries a syllabus; a cohort is one scheduled run of
it.

### Building a syllabus

**Course Library → Manage classes.** A class links to a catalog course — that
link supplies its credit hours, certification settings and category tagging —
and is timed _relative to the course start_ rather than on a calendar date:

| Field                         | Meaning                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `day_offset`                  | Days after the course start; 0 is the first day                               |
| `start_time`                  | Local wall clock, e.g. `19:00`                                                |
| `duration_minutes`            | Length of the class                                                           |
| `section_name`                | Optional grouping; becomes a pipeline phase when one is generated             |
| `counts_toward_certification` | Off for an informal drill: hours still count, the certificate doesn't advance |

The builder shows the gap between consecutive classes the way officers describe
them ("next day", "2 days later"), and **Fill from pattern** derives every offset
from a weekly cadence — fifteen classes on Tue/Thu becomes offsets 1, 3, 8,
10, … Because a class _must_ link to a catalog course, the builder can create
one inline.

### Generating a cohort

**Training → Records → Course Cohorts → New cohort.** The wizard runs Course →
Schedule → **Preview** → Roster → Generate.

Preview is the point of the wizard. Generating drops N events onto the
department calendar and RSVPs the roster to each, so the officer first sees
every computed date, every date that had to move around a weekend or blackout
day, any archived catalog course, and any room already booked — and can edit or
skip any individual class before anything is created. US federal holidays inside
the course span are offered as one-click blackout dates.

Generation creates **one Event + one linked TrainingSession per class**, all
under one transaction. Attendance then rides the existing chain: QR check-in →
`TrainingRecord` → session approval → requirement progress. Optionally the
wizard also builds the matching pipeline (phases from the syllabus sections, one
`courses` requirement per class), recording it on `training_courses.program_id`
so later cohorts of the same course reuse it.

### Running a cohort

| Action                  | Effect                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Reschedule a class      | Moves the class _and_ its event; RSVPs are preserved                                                                         |
| Cancel a class          | Cancels the event rather than deleting it, so anyone signed up sees the change; the class stays on the cohort for the record |
| Add class               | An ad-hoc make-up session that was never on the syllabus; the roster is invited automatically                                |
| Shift remaining         | Slides upcoming classes by N local days; past and cancelled classes are left alone                                           |
| Cancel cohort           | Cancels the cohort and its remaining classes; a class already cancelled from the calendar is left alone                      |
| Create N missing events | Shown only when classes lack an event. Repairs a class whose event failed to create or was deleted; idempotent               |
| Add member (Roster tab) | Enrols the member and invites them to the classes still to come                                                              |

**Shift** and **Cancel** on a cohort are all-or-nothing: a finalized class or a
taken room refuses the whole operation and nothing moves.

**Late joiners.** A member added with classes already held gets "N classes
held before they joined — decide". Each missed class is either **credited** (a
completed record) or given a **make-up** session for that member alone
(recorded in `course_cohort_missed_classes`; the make-up class carries
`makeup_for_class_id`).

### Roster privacy

A roster member's read of `GET /training/cohorts/{id}` is peer-safe. A
non-officer (no `training.manage` / `training.view_all`) receives the cohort
metadata and class timeline only — `members` is empty, `member_count` reads
`0`, and per-class `rsvp_count` / `checked_in_count` are `null` (withheld,
distinguishable from a genuine zero). The withheld data is never _queried_, not
filtered after the fact. `/mine` does not disclose roster sizes either.
Officers see everything, org-scoped; a non-member gets a 404 rather than
confirmation the cohort exists. Every query in the detail path (classes, roster
joins, RSVP aggregates) is org-scoped.

### Design points

**The cohort class row is the stable identity, not the event.** The Event and
TrainingSession are its current realization. That separation lets a class be
rescheduled or cancelled without losing the cohort's record of it, and makes
regeneration idempotent: `uq_cohort_class_source` on (`cohort_id`,
`course_class_id`) means re-running generation can never duplicate a class, and
`event_id` is `SET NULL` rather than `CASCADE` so an event deleted through the
Events UI leaves a repairable gap rather than erasing the class.

**Class times are local wall clock**, resolved against the organization timezone
at generation — not a stored UTC offset. A recruit school running from September
into December crosses a DST boundary; storing an offset would move the last
third of the course by an hour.

### Edge cases

The syllabus is a **template**; a cohort is a **materialized copy**. Nearly every
surprise comes from that distinction. The full table lives in
[docs/TRAINING_PROGRAMS.md](https://github.com/thegspiro/the-logbook/blob/main/docs/TRAINING_PROGRAMS.md#edge-cases--things-that-surprise-people);
the ones that come up most:

- **Reordering changes the order, not the dates.** `sequence` and `day_offset`
  are independent. Re-space with Fill from pattern or by editing offsets.
- **Editing the syllabus does not change a running cohort**, so an in-flight
  school is never re-scheduled underneath its students.
- **A second cohort of the same course reuses the pipeline**, and a member
  already enrolled keeps their existing progress.
- **Adding a member mid-course invites them only to classes still to come**;
  withdrawing one clears their upcoming RSVPs but keeps their records.

---

## Knowledge Tests

Officers (`training.manage`) write a test and its question bank in the admin
hub (Evaluations → Knowledge Tests) and publish it; any member may then sit a
published test from `/training/knowledge-tests`. The server draws the paper,
keeps the answers to itself until the attempt is submitted, grades it, and
records the score on the member's linked `knowledge_test` requirement through
the same path an officer's typed-in score takes, so `passing_score` and
`max_attempts` hold the same way for both. Each attempt is scoped to the member
who sat it (or an officer).

---

## Skills Testing

The Training module includes a **Skills Testing** sub-module for conducting
structured psychomotor evaluations (NREMT-style skill sheets).

### Key Capabilities

- **Skill Sheet Templates** — Reusable evaluation definitions with sections,
  criteria, scoring configuration, versioning, and lifecycle (draft → published
  → archived). A built-in library of sheets can be imported as templates
- **Statement Criteria** — Open-ended text-box criterion type for descriptive
  responses (e.g., "Describe the patient's chief complaint")
- **Critical Criteria** — Required criteria that trigger automatic failure,
  mirroring NREMT auto-fail rules
- **Point-Based Scoring** — Criteria with configurable point values for weighted
  scoring. Section point subtotals and overall percentage calculated from total
  points
- **Test Administration** — Examiner selects template + candidate, scores
  criteria in real time, system calculates pass/fail
- **Practice Mode** — Non-graded practice tests with discard and retake flow.
  Any member may run one on a peer; the candidate can see and discard their
  own; retained one year
- **Result Disclosure** — Three axes resolved test → template → organization:
  **what** (`full` / `scores` / `none`), **when** (`on_completion` /
  `on_release`), and **who** (candidate, named viewers, position holders).
  Defaults are `full` / `on_completion`
- **Post-Completion Review** — Section-by-section review screen with notes
  before finalizing, auto-stop clock
- **Result Lifecycle** — **Delete** (practice only), **Void** (withdraw a scored
  official result with a required reason, reverting the pipeline requirement it
  credited), **Cancel** (close out an unscored, abandoned evaluation), **Return**
  (send an unvalidated submission back to its examiner)
- **Template Snapshots** — Each test freezes the template structure and scoring
  rules it was created against, so editing a published template cannot shift,
  drop or re-grade a completed scorecard
- **Autosave & Optimistic Concurrency** — Scoring saves itself while a test is
  live; a save against a stale version is refused with `409` and autosave
  suspends rather than silently losing one examiner's work
- **Offline Scoring** — An examiner can run an evaluation with no network; see
  [Offline administration](#offline-administration)
- **Measured Elapsed Time** — The examiner's stopwatch is recorded; wall clock
  is only a fallback. Time limits are pass/fail criteria, and `started_at` is
  stamped once, so wall clock would over-report
- **Attempt Limits** — A linked requirement's `max_attempts` is checked on
  create and spent at **validation**. Voided results, practice attempts and
  unvalidated submissions do not consume an attempt
- **Member-Facing Results** — **My Training → Skills Tests** plus a read-only
  detail page at `/training/my-skill-tests/:testId`
- **Member Examining & Officer Validation** — **Any member may examine**,
  because departments routinely use senior members as evaluators. The officer's
  authority is at `POST /tests/{id}/validate` (or `bulk-validate`, up to 50 per
  request): until a result is validated it is a **submission, not a record** —
  no pipeline credit, no attempt spent, excluded from the pass rate and average
  score, and shown to the candidate as _awaiting validation_ with the outcome
  withheld. An officer's own completion validates in the same step. Rejection is
  the **void** path; a result that was simply not finished properly is
  **returned** instead (see below). An officer cannot validate a test they are
  the candidate in
- **Return for Correction** — `POST /tests/{id}/return` reopens an unvalidated
  submission to its examiner at `in_progress` with every mark intact, spending
  no void. Only an unvalidated submission can be returned. The candidate is not
  notified
- **Candidate Lookup** — `GET /skills-testing/candidates?q=` returns
  `{ id, name }` only. A **lookup, not a listing**: `q` is required (min 2
  chars), `LIKE` wildcards are escaped, results cap at 15, and it is gated on
  `training.view` or `training.manage`. It exists because `GET /users` needs
  `users.view`, which the baseline member position does not carry
- **Per-Template Disclosure Editor** — The template builder exposes the
  disclosure override. Fields default to **Inherit**, and the option names what
  it resolves to, read from the department's training configuration. Inherit
  sends `null` (not an omitted field) so an override can actually be cleared
- **Named-Viewer Panel** — `TestViewersPanel` grants one person sight of a
  **single** test's result — a preceptor, an FTO, a mentor. Per test, not per
  template: the relationship is to the person tested, not the skill. A grantee
  never sees more than the candidate does
- **Scoring Engine** — Automatic section scores, overall percentage, critical
  criteria compliance, elapsed time (`skills_testing_service.calculate_test_result`,
  a pure function)
- **Summary Dashboard** — Department-wide statistics (pass rate, average score,
  tests this month, `pending_validation` count)

### Pass/Fail Determination

A candidate **passes** if ALL of the following are true:

1. Their percentage score meets or exceeds the template's **passing percentage**
2. If "Require All Critical" is enabled, ALL required criteria were scored as
   passed

A candidate **fails** if ANY of the following are true:

1. Their percentage score is below the passing percentage
2. Any required criterion was not passed (when "Require All Critical" is
   enabled)

### Offline administration

Autosave covers a locked phone or killed tab while the device has signal; the
offline queue covers an evaluation run with **no connectivity at all** (see
[SKILLS_TESTING_OFFLINE_PLAN.md](https://github.com/thegspiro/the-logbook/blob/main/docs/SKILLS_TESTING_OFFLINE_PLAN.md)):

- **Queue** — `frontend/src/utils/skillsTestOffline.ts`, its own IndexedDB
  database `logbook-offline-skills`, one entry per test. On reconnect each
  entry drains in order: create, the merged `PUT` against the version it was
  made from, then `POST /complete`. A 4xx (including a `409` from a concurrent
  edit, or the attempt cap) marks the entry failed with the server's reason and
  keeps it; nothing is discarded.
- **Cold start** — every create carries a client-minted id; a replay by the same
  examiner returns the existing test, and anyone else using that id gets `409`.
  A create queued offline sends `expected_template_version`, so a sheet edited
  before the device reconnects is refused.
- **Read path** — the store caches a live test its examiner opens and reads that
  copy, with queued scoring laid over it, when the network is unavailable.
- **UX** — a banner on the scoring and review screens, "Saved on this device" as
  the save state, a "Submitted on this device" screen for a queued submission
  (no provisional score), a named toast when the server refuses one, and the
  pending count in the nav pill.
- **Sign-out** — Sign Out sends what it can, then warns before the local purge
  deletes unsent evaluations. The idle timeout and an expired session purge
  without asking.

### Edge Cases

- Even if a candidate scores above the passing percentage, a single missed
  critical criterion results in automatic FAIL when "Require All Critical" is
  enabled
- Practice tests do not count toward training compliance or certification
  requirements
- Archived templates cannot be used for new tests, but historical test results
  always reference the template version they were administered under
- Non-critical criteria that are unchecked display as "Not Completed" (not
  "FAIL")
- Score is calculated from points, not simple criterion count — criteria with
  higher point values carry more weight
- **Passing Points renders only on critical criteria.** A non-critical criterion
  cannot fail the test on its own, so the scorer never reads its threshold.
  Un-marking Critical **keeps** the stored value rather than clearing it — the
  threshold falls back to `0` when absent, so clearing would leave an
  accidentally-toggled criterion passing at any score
- **A named viewer never sees more of a result than the candidate does** —
  sharing resolves to the candidate's tier, not the officer's
- **A withheld result is dropped from the member's list entirely** and reads as
  `404`, not `403`; "no results" therefore does not reliably mean "none taken",
  and the member's empty state says so
- **Emailing results resolves disclosure for the recipient**, so it cannot be
  used as a one-click bypass of a department's decision to withhold or redact
- **Practice attempts are exempt from the release gate** — they are the
  candidate's own drill notes, not the department's record to hold back

---

## Shift Completion Reports

Officers file a report per trainee after a shift; an approved report credits
hours, shifts, calls and observed skills to the trainee's pipeline
requirements. Filing needs `training.manage`, or being the linked shift's own
Shift Officer.

### Report lifecycle

- **Drafts.** `save_as_draft` on `ShiftCompletionReportCreate` saves an
  incomplete report; drafts are also auto-created when a shift is finalized for
  trainees with active program enrollments. Drafts do not trigger pipeline
  progress and appear in the officer's **Drafts** view in `ShiftReportsTab`.
  Validation is deferred until final submission.
- **Submission.** A report (or **submit all drafts**) goes to `pending_review`
  when the org's `report_review_required` is on, else straight to `approved`.
  Pipeline progress is applied only on approval.
- **Review.** Reviewers see full report content in the review modal (hours,
  calls, rating, strengths, areas for improvement, narrative, skills with
  scores, tasks). A **Flagged** view surfaces flagged reports, which can be
  re-reviewed and approved (applying deferred pipeline progress).
- **Batch review.** `training.manage` holders select multiple reports in the
  pending-review or flagged views and approve or flag them in one action via
  `POST /training/shift-reports/batch-review` — up to 100 per batch, returning
  `{reviewed, failed}` counts. Valid reports in a mixed batch are still
  reviewed.
- **Names.** `ShiftCompletionReport` has `trainee` and `officer` relationships;
  the response includes `trainee_name` and `officer_name`. Report cards show
  "Trainee Name — Date" in headers and the officer name in footers.

### Access

`GET /training/shift-reports/{id}` is open to the trainee, the filing officer,
or a `training.manage` holder; anyone else gets `404`. A trainee without
`training.manage` sees only an **approved** report, with visibility-filtered
fields (the module's `show_*` settings) and `reviewer_notes` always stripped.
Department-wide analytics (`officer-analytics?scope=department`) additionally
need `training.view_analytics`.

### Audit events

`shift_report_created`, `shift_report_batch_created`, `shift_report_updated`,
`shift_report_reviewed`, `shift_report_acknowledged`,
`shift_reports_bulk_submitted` — each captures the acting user, report ID, and
relevant metadata.

### Form section toggles

Seven `form_show_*` booleans on `training_module_configs` control which
optional sections appear on the report **creation form**. They are separate
from the `show_*` columns, which control what **trainees** see after approval.

| Toggle                            | Default | Controls                       |
| --------------------------------- | ------- | ------------------------------ |
| `form_show_performance_rating`    | `true`  | Performance rating stars/scale |
| `form_show_areas_of_strength`     | `true`  | Strengths text field           |
| `form_show_areas_for_improvement` | `true`  | Improvement areas text field   |
| `form_show_officer_narrative`     | `true`  | Free-form officer assessment   |
| `form_show_skills_observed`       | `true`  | Structured skills checklist    |
| `form_show_tasks_performed`       | `true`  | Structured tasks list          |
| `form_show_call_types`            | `true`  | Call type selection            |

With every section off, the core fields (trainee, date, hours, calls) remain and
the form is still submittable.

### Per-apparatus-type skills and tasks

- **`apparatus_type_skills`** — maps apparatus types to skill lists (e.g.,
  `{"engine": ["Pump operations", "Hose deployment"]}`)
- **`apparatus_type_tasks`** — maps apparatus types to task lists (e.g.,
  `{"engine": ["Pump test", "Hose load inventory"]}`)

When filing a report linked to a shift with an assigned apparatus, the form
fills the skills and tasks checklist from the apparatus type mapping, falling
back to the org-wide defaults (`shift_review_default_skills` /
`shift_review_default_tasks`) and to an empty list if none are configured.
Managed via **ShiftReportsSettingsPanel** in Scheduling Settings, with a
per-type accordion editor. New organizations are seeded with sample skills,
tasks and apparatus-type mappings (engine, ladder, rescue, ambulance, tanker,
brush, hazmat, tower).

**Skill linkage status.** The settings panel shows a colour-coded tag per
apparatus-type skill, powered by `GET /training/module-config/skill-names`:

- **Green** — matches a `SkillEvaluation` record: tracks competency, creates
  checkoffs, progresses pipeline requirements
- **Amber** — no matching `SkillEvaluation`: observed on reports but not
  formally tracked (every skill is amber in an org with no skill evaluations)

### Skill scoring

Officers assign a 1–5 score to each observed skill (`SkillObservation.score`,
`Field(ge=1, le=5)` — out-of-range values are a 422). Scores flow through to
`SkillCheckoff` records, feeding the competency score history.

| Score | Label      |
| ----- | ---------- |
| 1     | Needs work |
| 2     | Developing |
| 3     | Competent  |
| 4     | Proficient |
| 5     | Excellent  |

Labels appear as tooltips on score buttons and inline text in display views,
in `ShiftReportPage` and `ShiftReportsTab`.

### Rating scale

| Setting               | Default              | Description                                                                  |
| --------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `rating_label`        | "Performance Rating" | Custom label for the rating input                                            |
| `rating_scale_type`   | "stars"              | "stars" (star icons) or "descriptive" (labeled buttons)                      |
| `rating_scale_labels` | `null`               | Custom labels per level (e.g., `{1: "Needs Improvement", 5: "Exceptional"}`) |

A descriptive scale with no labels falls back to numeric display (1–5).

### Other behaviour

| Scenario                                        | Behavior                                                    |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Trainee list when linked to a shift             | Filters to shift members; ad-hoc reports show the full list |
| Report `shift_date` vs linked shift date        | Mismatch is a validation error                              |
| Trainee with shift assignment but no attendance | Manual hour entry allowed; auto-populate returns zeros      |

### Manual shift report page

`/training/log-shift` (`training.manage`) serves departments without the
Scheduling module. Officers enter shift date, start/end times, apparatus, crew
members, and trainee evaluations, with apparatus-specific skill/task
auto-population. Availability, allowed apparatus types, default start times and
default duration come from **Manual Entry Rules** in the admin hub.

---

## External Training Integration

Providers: Vector Solutions, Target Solutions, Lexipol, iAmResponding and
Custom API, each with category, course and user mappings. Imports preserve CE
credit hours (`external_training_imports.credit_hours`); the provider's
category catalog can be fetched up front (`sync-categories`). Imports feed
pipeline progress only where a requirement allows external credit (see
[What updates pipeline progress automatically](#what-updates-pipeline-progress-automatically)).

**Target Solutions** reads its Training Records API
(`reportType=completionsall`, key and secret as query parameters, CSV).
Members are matched on the report's Email column, Transcript ID is the record
key, and the credentials are redacted from logs, Sentry and officer-facing
errors. Its scheduled sync is an hourly pull plus a daily 30-day **review** at
`config.review_time` (default 02:00, department time); the review ledger is the
sync log (`sync_type = "review"`). Detail:
[16-integrations › Setting up Target Solutions](https://github.com/thegspiro/the-logbook/blob/main/docs/training/16-integrations.md#setting-up-target-solutions).

---

## Member & Officer Exports

- **Member self-export** of own training history (CSV/PDF) via
  `GET /training/module-config/my-training/export`. Gated by the org
  `allow_member_report_export` setting and by `show_training_history` (403 when
  either is off). Omitting `start_date` returns the member's entire history.
- **Officer exports** (`POST /training/reports/export`, `training.manage`):
  `compliance`, `individual`, `member_records` (bulk, all active members),
  `hours_summary`, and `certification` as CSV. PDF is available only for
  `individual`, `member_records`, and `compliance`; bulk PDFs are merged with
  `pypdf` (an empty result gets a placeholder page). An unknown `report_type`
  returns 400.
- **Personal-data exports** apply the module's result-visibility setting to
  `ShiftCompletionReport` fields: officer-only evaluation data hidden from the
  trainee in the application is also omitted from a newly generated export;
  completion history remains available. Exports already downloaded are not
  recalled when the setting changes.

---

## Print Pages

Three print-formatted pages give officers and administrators paper copies of
training data for audits, regulatory filings, reviews, and member records. Each
opens the browser print dialog automatically; if the browser blocks it, the page
stays visible for a manual Ctrl+P.

| Source Page                 | Print Button Location    | Target Print Page            |
| --------------------------- | ------------------------ | ---------------------------- |
| `ComplianceMatrixTab`       | Toolbar above the matrix | `/training/print/compliance` |
| `MemberTrainingHistoryPage` | Page header actions      | `/training/print/member`     |
| `PipelineDetailPage`        | Page header actions      | `/training/print/program`    |

### Member Training History Print Page

**Route:** `/training/print/member?id=<user_id>&name=<name>`

- The member's name and one overall compliance label. The name comes from the
  `?name=` query parameter rather than the record, and reads "Member" when the
  caller omits it — rank, station and membership dates are not on the sheet.
  The label is coloured by standing — green for `green`, red for `red`, amber
  for `yellow`, grey for `not_applicable`. An **exempt** member has no modifier
  rule of its own, so it falls back to the base
  `.member-training-print__compliance` colour, the same `#92400e` amber
  `yellow` uses: exempt and yellow are indistinguishable on the sheet
- Four counts: Total Hours, Hours This Year, Active Certifications, Completed
  Courses
- One aggregate compliance row — Requirements Met (`met / total`), Expiring
  Soon, Expired. There is no per-requirement breakdown on this page; the
  [Compliance Matrix](#compliance-matrix-print-page) is where a
  requirement-by-requirement view lives
- Program Enrollments, with each program's status, progress percentage,
  enrolment date and target completion
- Certifications, with number, issuing agency, completion date, expiry and
  status
- Training History in reverse-chronological order, with course, type, date,
  hours, instructor and status

The last three sections are each omitted when they have no rows. A member with
no training records still prints the header, the four stat tiles (all zero) and
the compliance row, which come from their own endpoints.

> **A record can appear in both tables.** The two lists are split from one set of
> training records, and the two filters are not complements. Certifications takes
> a record carrying a certification number **or** typed `certification`; Training
> History takes one that is **not** typed `certification` **or** carries no
> number. Two combinations satisfy both and print twice: a certification
> recorded without a number, and a non-certification record that carries one.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Member Training Print Page showing the letter-size layout: the "Training Record" heading with the member's name beneath it and the generated date and `Compliance: <label>` line at the top right; the four stat tiles (Total Hours, Hours This Year, Active Certifications, Completed Courses); the Requirements Met / Expiring Soon / Expired summary row; and the Program Enrollments, Certifications and Training History tables. Shoot a member with an enrollment, a certification, **and at least one non-certification record** — each of those three tables is omitted when it has no rows, and Training History takes only records that are not a numbered certification, so a member holding nothing but numbered certifications prints without it._

### Training Program Print Page

**Route:** `/training/print/program?id=<program_id>`

- Program name and description, with the program's code and version beside the
  generated date
- A four-cell strip: Structure (the stored `structure_type` — `sequential`,
  `phases` or `flexible` — with underscores replaced by spaces, not
  title-cased), Target Position, Time Limit and the enrolment count. The
  program's own status is not on the sheet
- **Program Phases** — number, name, description, time limit and a count of the
  requirements in each phase
- **Program Requirements** — requirement, the phase it belongs to, whether it is
  required or optional, and its description. This is a **flat table with a
  Phase column**, not requirements nested under the phase rows above
- **Enrolled Members** — member, status, progress percentage, enrolment date,
  target date and current phase

The roster comes from a separate call
(`GET /training/programs/programs/{id}/enrollments`) that needs
`training.view_all` or `training.manage`, while the page itself is gated on the
module alone. A member without those permissions still gets the rest of the
sheet; the strip reads `Enrolled: —` and no Enrolled Members table prints. The
Phases, Requirements and Enrolled Members tables are each omitted when empty,
and Milestones are not printed.

> **[SCREENSHOT NEEDED]:** _Screenshot of the Program Print Page, taken as a training officer, showing the "Training Program" heading with the program name and description, and the generated date, code and version at the top right; the Structure / Target Position / Time Limit / Enrolled strip; the Program Phases table (number, name, description, time limit, requirement count); the Program Requirements table (requirement, phase, required, description); and the Enrolled Members table. Shoot a phase-based program with at least one enrolled member — the Program Phases table is not rendered for a program with no phases._

### Compliance Matrix Print Page

**Route:** `/training/print/compliance`
**Permission:** `training.manage`

Renders the department-wide compliance matrix (all members × all requirements)
as a printable grid:

- Four counts across the top: **Compliant**, **At Risk**, **Non-Compliant** and
  the number of **Requirements**. They are counted from the API's `standing`
  per member — the department's thresholds, exactly as the on-screen matrix
- Members as rows — sorted by completion, least complete first — and
  requirements as columns. Headings **wrap** to the full requirement name
- A **Completion** column carrying each member's percentage, coloured by value:
  green at 100%, amber above zero, red at zero
- Per-requirement cells carrying one mark each — **glyphs, not colour and not
  percentages** — with a legend printed under the table:

  | Cell  | Means                                                          |
  | ----- | -------------------------------------------------------------- |
  | `✓`   | `completed`                                                    |
  | `◐`   | `in_progress`                                                  |
  | `✗`   | `not_started` (or any other unmet status)                      |
  | `Exp` | `expired`                                                      |
  | `Due` | `catch_up` — an existing member before their catch-up deadline |
  | `—`   | **only** "does not apply to this member" — no cell was sent    |

  A dash means the member is not graded on that requirement (a compliance
  profile, membership type, role or join-date rule excluded it)

- A signature block for the Training Officer and the Chief / Department Head
- Letter landscape. Column headings repeat on each printed page because the
  grid uses a real `<thead>`, so 100+ members paginate cleanly, but nothing
  constrains the width: past roughly twenty requirements the columns run off
  the right edge of the sheet
- Designed for annual reviews, regulatory audits, and compliance filing

> **[SCREENSHOT NEEDED]:** _Screenshot of the Compliance Print Page in landscape, as a training officer (training.manage), showing the four summary counts (Compliant, At Risk, Non-Compliant, Requirements); the grid with member names down the left, a colour-coded Completion percentage beside each, and one column per requirement — headings wrapped to the full name, cells carrying `✓`, `◐`, `✗`, `Exp` or `—`; the legend under the table; and the Training Officer / Chief signature block at the foot. Use a demo department with few enough requirements that the grid fits the sheet; past roughly twenty the columns run off the right edge._

### Members on leave

Only the **quantitative** requirements bend for leave: a waiver lowers that
requirement's own numeric target for hours, shifts and calls. A course,
certification or knowledge test is unchanged by leave, and the member's
requirement _count_ never moves. No print page shows the leave period, the
waived months or the adjusted target — the sheet reports the outcome, not the
allowance behind it.

---

## Cross-Module Connections

| Source            | Target             | Connection                                                                                                                                         | Mechanism                                                               |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Events            | Training           | Finalizing a Training event's attendance writes each attendee's training record                                                                    | `training_session.event_id`, `training_records.source_event_id`         |
| Course Cohorts    | Events             | Generating a cohort creates one Event per syllabus class, in one transaction                                                                       | `course_cohort_classes.event_id` (`SET NULL`)                           |
| Course Cohorts    | Training Sessions  | Each generated event carries a linked session with the class's credit hours and pipeline linkage                                                   | `course_cohort_classes.training_session_id`                             |
| Course Cohorts    | Training Pipelines | The roster is enrolled in the cohort's program; a generated pipeline mirrors the syllabus (phases = sections, one `courses` requirement per class) | `course_cohort_members.enrollment_id`, `training_courses.program_id`    |
| Course Cohorts    | Events (RSVP)      | Roster members are RSVP'd to every class so it lands on their calendar; a late joiner gets only the classes still to come                          | `event_rsvps` written at generation / add-member                        |
| Events            | Training           | RSVP / self-check-in to a session in a phase ahead of the member's current phase → soft override warning                                           | Pipeline phase gate                                                     |
| Training Sessions | Training Pipelines | Approved session advances its linked requirement (or the program's requirements in the session's category)                                         | `training_session.program_id` / `requirement_id` / `category_id`        |
| Skills Testing    | Training Pipelines | A validated pass on a skills test linked to a requirement completes that pipeline requirement                                                      | Requirement linkage                                                     |
| Knowledge Tests   | Training Pipelines | A graded attempt records its score on the linked `knowledge_test` requirement                                                                      | `update_requirement_progress`                                           |
| Training          | Users              | Compliance per member                                                                                                                              | `GET /training/compliance-summary/{user_id}`                            |
| Training          | Scheduling         | Shift completion reports → Training credit; Shift Compliance grades shift-credited requirements                                                    | `POST /training/shift-reports`, `shift_credited`                        |
| Training          | Apparatus          | EVOC levels link to the training program that certifies them                                                                                       | `evoc_levels.training_program_id`                                       |
| Locations         | Training           | Training session location                                                                                                                          | `training_session.location` FK                                          |
| Member Leaves     | Training Waivers   | Auto-create waiver from LOA                                                                                                                        | `leave.exempt_from_training_waiver` → auto-link                         |
| Training          | Dashboard          | Training compliance metrics, expiring certs                                                                                                        | `GET /dashboard/stats` includes training data                           |
| Training          | Reports            | Cross-module report generation                                                                                                                     | `POST /reports/generate` with training report types                     |
| Training          | Notifications      | Submission, approval, cert expiry alerts                                                                                                           | In-app + email notifications                                            |
| Training          | Multi-Agency       | Joint sessions across organizations                                                                                                                | `POST /training/multi-agency`                                           |
| Training          | External LRS       | xAPI statement delivery                                                                                                                            | `POST /training/xapi/statements`, sent by `POST /training/xapi/process` |
| Training          | Compliance         | ISO readiness, attestations, annual reports                                                                                                        | `GET /compliance/iso-readiness`                                         |

---

## Permissions

| Permission                | Scope                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `training.view`           | View training records, courses, programs (own data); skills-test candidate lookup                                              |
| `training.manage`         | Full training admin: requirements, sessions approval, submissions review, compliance, skills templates and validation, exports |
| `training.view_all`       | View all members' training data (enrollments, cohort rosters, instructor qualifications, multi-agency)                         |
| `training.configure`      | Configure module settings (chiefly member visibility); `PUT /module-config/config` accepts it or `training.manage`             |
| `training.view_analytics` | Department-wide shift report analytics (`officer-analytics?scope=department`)                                                  |

Session creation, finalize and relinking use `events.manage`; reopening uses
`events.reopen_attendance`.

### Skills testing gates

| Action                                                             | Gate                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Create / edit / publish / duplicate / delete a template            | `training.manage`                                     |
| Browse / import the skill sheet library                            | `training.manage`                                     |
| Start, score, complete or cancel a test — **practice or official** | Authenticated member                                  |
| Discard a practice attempt                                         | Authenticated member (candidate, examiner or officer) |
| **Validate** an official result (single or bulk)                   | `training.manage`                                     |
| **Return** a submission to its examiner                            | `training.manage`                                     |
| **Void** an official result (the rejection path)                   | `training.manage`                                     |
| **Release** a withheld result                                      | `training.manage`                                     |
| Grant / list / revoke a **named viewer**                           | `training.manage`                                     |
| **Delete** a test record (practice only)                           | `training.manage`                                     |
| Email results                                                      | `training.manage`                                     |
| CSV export                                                         | `training.manage`                                     |
| Look up a candidate by name (`GET /candidates`)                    | `training.view` **or** `training.manage`              |

The React routes match: `/training/skills-testing`, `.../test/new`,
`.../test/:testId` and `.../test/:testId/active` are `<ProtectedRoute>` with no
`requiredPermission`. Per-record read access is enforced by the API, so a member
reaching a test they are not party to gets a **`404`** rather than a route they
should not have been able to open.

---

## Related Documentation

- **[Skills Testing Training Guide](https://github.com/thegspiro/the-logbook/blob/main/docs/training/09-skills-testing.md)** — Skills testing user guide with realistic NREMT example
- **[Skills Testing Feature Spec](https://github.com/thegspiro/the-logbook/blob/main/docs/SKILLS_TESTING_FEATURE.md)** — Full requirements and data model
- **[Skills Testing Offline Support](https://github.com/thegspiro/the-logbook/blob/main/docs/SKILLS_TESTING_OFFLINE_PLAN.md)** — Design and build record for offline scoring
- **[Training User Guide](https://github.com/thegspiro/the-logbook/blob/main/docs/training/02-training.md)** — End-user training guide
- **[Training Compliance Calculations](https://github.com/thegspiro/the-logbook/blob/main/docs/training-compliance-calculations.md)** — Formula details and edge cases
- **[Training Waivers & LOA](https://github.com/thegspiro/the-logbook/blob/main/backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system documentation
- **[Training Programs](https://github.com/thegspiro/the-logbook/blob/main/docs/TRAINING_PROGRAMS.md)** — Comprehensive training programs guide
- **[Training Integrations](https://github.com/thegspiro/the-logbook/blob/main/docs/training/16-integrations.md)** — External provider setup
