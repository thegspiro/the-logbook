# Training Module — Developer Reference

Routes, API endpoints, data model and frontend architecture for the
training module. What the module does and how departments use it is on
[Training Module](Module-Training).

## Pages

| URL                                             | Page                                         | Permission                               |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| `/training`                                     | My Training                                  | Authenticated                            |
| `/training/my-training`                         | My Training (alias)                          | Authenticated                            |
| `/training/submit`                              | Submit Training                              | Authenticated                            |
| `/training/courses`                             | Course Library                               | Authenticated                            |
| `/training/programs`                            | Training Programs                            | Authenticated                            |
| `/training/programs/:programId`                 | Program Detail                               | Authenticated                            |
| `/training/my-progress/:enrollmentId`           | My Program Progress (read-only student view) | Authenticated                            |
| `/training/my-skill-tests/:testId`              | My Skill Test result (read-only)             | Authenticated                            |
| `/training/knowledge-tests`                     | My Knowledge Tests                           | Authenticated                            |
| `/training/knowledge-tests/attempts/:attemptId` | Knowledge Test attempt                       | Authenticated                            |
| `/training/cohorts`                             | Course Cohorts                               | `training.manage`                        |
| `/training/cohorts/:cohortId`                   | Cohort Detail                                | `training.manage`                        |
| `/training/admin`                               | Training Admin Hub                           | `training.manage`                        |
| `/training/skills-testing`                      | Skills Testing Hub                           | Authenticated                            |
| `/training/skills-testing/templates/new`        | Template Builder (new)                       | `training.manage`                        |
| `/training/skills-testing/templates/:id`        | Template Builder (view)                      | `training.manage`                        |
| `/training/skills-testing/templates/:id/edit`   | Template Builder (edit)                      | `training.manage`                        |
| `/training/skills-testing/test/new`             | Start Skill Test                             | Authenticated                            |
| `/training/skills-testing/test/:testId`         | Active Skill Test                            | Authenticated                            |
| `/training/skills-testing/test/:testId/active`  | Active Skill Test (alias)                    | Authenticated                            |
| `/training/skills-testing/print/template`       | Skill sheet print                            | Authenticated                            |
| `/training/skills-testing/print/scorecard`      | Skill test scorecard print                   | Authenticated                            |
| `/training/log-shift`                           | Manual Shift Report                          | `training.manage`                        |
| `/training/approve/:token`                      | Approve training credit (emailed link)       | `training.manage`                        |
| `/training/compliance-config`                   | Compliance Requirements Config               | `compliance.manage` or `settings.manage` |
| `/training/print/member`                        | Member Training History print                | Authenticated                            |
| `/training/print/program`                       | Training Program print                       | Authenticated                            |
| `/training/print/compliance`                    | Compliance Matrix print                      | `training.manage`                        |
| `/members/:userId/training`                     | Member Training History                      | Authenticated                            |

All routes also require the Training module to be enabled for the
organization.

### Training Admin Hub

The hub shows seven areas as cards. `?page=` selects the area and `&tab=` the
destination; the areas are declared in
`frontend/src/components/training/trainingAdminAreas.ts`.

| Area (`?page=`)                         | Destinations (`&tab=`)                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Overview** (`dashboard`)              | Dashboard (`overview`), Compliance Matrix, Expiring Certs, Training Waivers                            |
| **Records** (`records`)                 | Submissions to Review, Sessions, Course Cohorts, Shift Reports, Monthly Status                         |
| **Curriculum** (`curriculum`)           | Requirements, Course Library, Programs (`pipelines`)                                                   |
| **Evaluations** (`evaluations`)         | Skill Evaluations, Knowledge Tests, Skills Test Templates (`templates`), Skills Test Records (`tests`) |
| **Program Management** (`enhancements`) | Recertification, Competency, Instructors, Effectiveness, Multi-Agency, Reports                         |
| **Compliance Reporting** (`compliance`) | Annual Report, ISO Readiness, Record Quality, Attestations, Forecast                                   |
| **Settings & Data** (`settings`)        | Manual Entry Rules, Integrations, Import History, Headline Metrics (`metrics`)                         |

Destination ids are unique across the hub, so a link is resolved by its
`&tab=` first. Links that name the `setup` and `skills-testing` section ids, or
carry only a flat `?tab=`, open the area that holds that destination. A bare
`?page=setup` opens Curriculum and `?page=skills-testing` opens Evaluations. A
red count on an area card or destination is the number of open items in the
hub's Needs Attention queue that link to it.

### Legacy Redirects

| Old URL                   | Redirects To                                     |
| ------------------------- | ------------------------------------------------ |
| `/training/officer`       | `/training/admin?page=dashboard&tab=overview`    |
| `/training/submissions`   | `/training/admin?page=records&tab=submissions`   |
| `/training/requirements`  | `/training/admin?page=setup&tab=requirements`    |
| `/training/sessions/new`  | `/training/admin?page=records&tab=sessions`      |
| `/training/programs/new`  | `/training/admin?page=setup&tab=pipelines`       |
| `/training/shift-reports` | `/training/admin?page=records&tab=shift-reports` |
| `/training/integrations`  | `/training/admin?page=setup&tab=integrations`    |

The `page=setup` targets resolve through the `&tab=` rule above.

### Write controls on member-facing screens

The Course Library and Training Programs pages are readable by every member;
their write affordances render only for `training.manage` holders, matching
the server, where every write behind them requires that permission.

- **Course Library** — Add, Edit, Delete (Deactivate) and Manage classes are
  gated on `training.manage`. The gate is on the component, not the route,
  because the same page is mounted inside the admin hub where the officer holds
  the grant.
- **Training Programs** — Creating, importing and exporting a pipeline, adding
  a sample template, and creating, importing or editing a requirement render
  only for training managers. Members do not request the manager-only registry
  list, and the Requirements and Templates tabs are hidden for them, so a member
  sees the Programs list on its own. With no programs to show, a member sees an
  empty panel; a search that matches nothing reports "No programs found" to
  everyone.

---

## API Endpoints

All paths below are under `/api/v1`. Every `/training/*` router is behind the
Training module gate.

### Core Training

```
GET    /api/v1/training/records                            # List records (filterable); paged: skip/limit (max 500), X-Total-Count header
POST   /api/v1/training/records                            # Create a training record
POST   /api/v1/training/records/bulk                       # Bulk create (up to 500, with duplicate detection)
POST   /api/v1/training/records/import-csv                 # CSV import with parse and preview
GET    /api/v1/training/records/member-status              # Monthly Status roster: each active member's activity in a period (training.manage)
PATCH  /api/v1/training/records/{id}                       # Update a record (member is told what changed; optional ?reason=)
DELETE /api/v1/training/records/{id}?reason=…              # Void a record, reason required (cancels, un-applies pipeline credit, tells the member) (training.manage)
POST   /api/v1/training/import/parse                       # Historical import: parse CSV and preview (training.manage)
POST   /api/v1/training/import/confirm                     # Historical import: execute (training.manage)
GET    /api/v1/training/dashboard-summary                  # Officer dashboard widget data
GET    /api/v1/training/compliance-summary/{user_id}       # Member compliance card (green/yellow/red)
GET    /api/v1/training/compliance-matrix                  # Members x requirements standing
GET    /api/v1/training/competency-matrix                  # Department readiness heat-map
GET    /api/v1/training/category-hours/{user_id}           # Per-category hour breakdown for a member
GET    /api/v1/training/requirements                       # List requirements (filterable by source, type)
POST   /api/v1/training/requirements                       # Create requirement
PATCH  /api/v1/training/requirements/{id}                  # Update requirement
DELETE /api/v1/training/requirements/{id}                  # Permanently delete requirement
GET    /api/v1/training/categories                         # List training categories
GET    /api/v1/training/categories/{id}                    # Get single category
POST   /api/v1/training/categories                         # Create category
PATCH  /api/v1/training/categories/{id}                    # Update category
DELETE /api/v1/training/categories/{id}                    # Delete category
GET    /api/v1/training/courses                            # List courses
GET    /api/v1/training/courses/{id}                       # Get single course
POST   /api/v1/training/courses                            # Create course
PATCH  /api/v1/training/courses/{id}                       # Update course (also how a course is deactivated)
GET    /api/v1/training/courses/{id}/classes               # List a course's syllabus, in order (authenticated)
POST   /api/v1/training/courses/{id}/classes               # Add a class to the syllabus (training.manage)
PATCH  /api/v1/training/courses/{id}/classes/{class_id}    # Update one syllabus class (training.manage)
DELETE /api/v1/training/courses/{id}/classes/{class_id}    # Remove a class; generated cohorts keep their copy (training.manage)
POST   /api/v1/training/courses/{id}/classes/reorder       # Set the syllabus order (order only, not the dates) (training.manage)
POST   /api/v1/training/courses/{id}/classes/autofill      # Recompute every day offset from a meeting pattern (training.manage)
POST   /api/v1/training/enrollments                        # Enroll a member into a training program (training.manage)
GET    /api/v1/training/stats/user/{user_id}               # User training stats
GET    /api/v1/training/reports/user/{user_id}             # User training report
GET    /api/v1/training/requirements/progress/{user_id}    # User requirement progress
GET    /api/v1/training/certifications/expiring            # Expiring certifications list
GET    /api/v1/training/expiring-certifications            # Expiring certifications (alias)
POST   /api/v1/training/certifications/process-alerts      # Run cert alerts for this organization
POST   /api/v1/training/certifications/process-alerts/all-orgs  # Run cert alerts for every organization
```

### Training Programs

The router is mounted at `/training/programs`, and program resources sit at
`/programs/...` inside it, so program paths read `/training/programs/programs/`.

```
GET    /api/v1/training/programs/requirements              # List program requirements
GET    /api/v1/training/programs/requirements/{id}         # Get single requirement
POST   /api/v1/training/programs/requirements              # Create requirement
PATCH  /api/v1/training/programs/requirements/{id}         # Update requirement
GET    /api/v1/training/programs/requirements/registries   # List available registries (training.manage)
GET    /api/v1/training/programs/requirements/registries/{name}/preview  # Preview a registry import (training.manage)
POST   /api/v1/training/programs/requirements/import/{name} # Import from registry (training.manage)
GET    /api/v1/training/programs/sample-templates          # Sample program templates (training.manage)
POST   /api/v1/training/programs/sample-templates/{key}/instantiate  # Create a program from a sample (training.manage)
GET    /api/v1/training/programs/programs                  # List programs
GET    /api/v1/training/programs/programs/{id}             # Program with phases, requirements, milestones
POST   /api/v1/training/programs/programs                  # Create program
PATCH  /api/v1/training/programs/programs/{id}             # Update program
DELETE /api/v1/training/programs/programs/{id}             # Delete program
POST   /api/v1/training/programs/programs/build            # Build program + phases + requirements + milestones atomically (wizard)
POST   /api/v1/training/programs/programs/{id}/duplicate   # Duplicate program
GET    /api/v1/training/programs/programs/{id}/export      # Export program as shareable JSON (training.manage)
POST   /api/v1/training/programs/programs/import           # Import program from JSON package (training.manage)
GET    /api/v1/training/programs/programs/{id}/enrollments # Enrolled members with name + progress (training.view_all or training.manage)
POST   /api/v1/training/programs/programs/{id}/bulk-enroll # Bulk enroll members
GET    /api/v1/training/programs/programs/{id}/eligibility # Enrollment eligibility check (training.manage)
GET    /api/v1/training/programs/programs/{id}/phases      # Program phases
POST   /api/v1/training/programs/programs/{id}/phases      # Create phase
POST   /api/v1/training/programs/programs/{id}/phases/reorder  # Reorder phases
PATCH  /api/v1/training/programs/programs/{id}/phases/{phase_id}   # Update phase
DELETE /api/v1/training/programs/programs/{id}/phases/{phase_id}   # Delete phase
GET    /api/v1/training/programs/programs/{id}/requirements # Program requirements
POST   /api/v1/training/programs/programs/{id}/requirements # Add requirement to program (apply_to_current_enrollments)
PATCH  /api/v1/training/programs/programs/{id}/requirements/{pr_id} # Update program requirement
DELETE /api/v1/training/programs/programs/{id}/requirements/{pr_id} # Remove program requirement
POST   /api/v1/training/programs/programs/{id}/requirements/reorder # Reorder program requirements
POST   /api/v1/training/programs/programs/{id}/milestones  # Create milestone
PATCH  /api/v1/training/programs/programs/{id}/milestones/{milestone_id}  # Update milestone
DELETE /api/v1/training/programs/programs/{id}/milestones/{milestone_id}  # Delete milestone
POST   /api/v1/training/programs/enrollments               # Enroll member
GET    /api/v1/training/programs/enrollments/me            # My enrollments
GET    /api/v1/training/programs/enrollments/user/{user_id} # User enrollments (training.view_all)
GET    /api/v1/training/programs/enrollments/{id}          # Enrollment detail (own; others need view_all/manage)
POST   /api/v1/training/programs/enrollments/{id}/advance-phase  # Officer advances member to next phase (force= override)
POST   /api/v1/training/programs/enrollments/{id}/reset    # Reset a whole enrollment for a new recert cycle
POST   /api/v1/training/programs/enrollments/{id}/withdraw # Withdraw (self or officer; soft)
POST   /api/v1/training/programs/enrollments/{id}/reopen   # Put an EXPIRED enrollment back to active, optionally on a new deadline (training.manage)
PATCH  /api/v1/training/programs/progress/{id}             # Update progress (log value, mark complete/in-progress/reopen, verify, record test score)
POST   /api/v1/training/programs/progress/{id}/reset       # Reset one requirement's progress for a new recert cycle
POST   /api/v1/training/programs/recert/run-due            # Auto-reset every enrollment past its stored recert deadline
POST   /api/v1/training/programs/apply-training-record     # Apply an approved training record toward a pipeline requirement (training.manage)
```

### Training Sessions

```
GET    /api/v1/training/sessions/calendar                  # Session calendar
POST   /api/v1/training/sessions                           # Create session (events.manage)
POST   /api/v1/training/sessions/recurring                 # Create a recurring series (events.manage)
GET    /api/v1/training/sessions/by-event/{event_id}       # The session behind a Training event
POST   /api/v1/training/sessions/by-event/{event_id}       # Attach training details to a Training event (events.manage)
GET    /api/v1/training/sessions/by-event/{event_id}/approval  # Where the event's approval stands (events.manage or training.manage)
PATCH  /api/v1/training/sessions/{id}                      # Relink course/program/requirement (events.manage; locked while attendance is finalized)
POST   /api/v1/training/sessions/{id}/finalize             # Runs the event's Finalize Attendance (events.manage)
POST   /api/v1/training/sessions/{id}/reopen               # Runs the event's Reopen Attendance (events.reopen_attendance)
GET    /api/v1/training/sessions/approve/{token}           # Approval roster (training.manage)
POST   /api/v1/training/sessions/approve/{token}           # Submit approval (training.manage)
```

### Course Cohorts

One scheduled run of a multi-class course. Every route is `training.manage`
except `GET /{cohort_id}` and `/mine`, which a roster member may read for their
own cohort (see [Roster privacy](Module-Training#roster-privacy)).

```
POST   /api/v1/training/cohorts/preview                    # Compute the dates a cohort would get — creates nothing
GET    /api/v1/training/cohorts                            # List cohorts (filter by course_id, status)
GET    /api/v1/training/cohorts/mine                       # Cohorts the signed-in member is on the roster for
POST   /api/v1/training/cohorts                            # Generate: N events + N sessions + roster enrollment + RSVPs, in one transaction
GET    /api/v1/training/cohorts/{id}                       # Cohort with its class timeline and roster
PATCH  /api/v1/training/cohorts/{id}                       # Update cohort details (not the schedule)
POST   /api/v1/training/cohorts/{id}/regenerate            # Create events for classes that have none; idempotent
POST   /api/v1/training/cohorts/{id}/shift                 # Shift upcoming classes by N local days; all-or-nothing
POST   /api/v1/training/cohorts/{id}/cancel                # Cancel the cohort and its remaining classes; all-or-nothing
POST   /api/v1/training/cohorts/{id}/classes               # Add an ad-hoc class (make-up session)
PATCH  /api/v1/training/cohorts/{id}/classes/{class_id}    # Reschedule one class; the linked event moves with it
POST   /api/v1/training/cohorts/{id}/classes/{class_id}/cancel  # Cancel one class (cancels the event, never deletes it)
POST   /api/v1/training/cohorts/{id}/members               # Add roster members (enrolled + invited to remaining classes)
GET    /api/v1/training/cohorts/{id}/members/{user_id}/missed-classes   # Classes held before the member joined, and what was decided
POST   /api/v1/training/cohorts/{id}/members/{user_id}/missed-classes/{class_id}/credit   # Credit it: writes a completed record
POST   /api/v1/training/cohorts/{id}/members/{user_id}/missed-classes/{class_id}/makeup   # Schedule a make-up session for that member alone
DELETE /api/v1/training/cohorts/{id}/members/{user_id}     # Withdraw a member; clears their upcoming RSVPs
```

### Self-Reported Training (Submissions)

```
GET    /api/v1/training/submissions/config                 # Get submission config
PUT    /api/v1/training/submissions/config                 # Update submission config, including attachment_retention_days (training.manage)
POST   /api/v1/training/submissions                        # Submit training
POST   /api/v1/training/submissions/with-attachment        # Submit training with its certificate (multipart)
GET    /api/v1/training/submissions/my                     # My submissions
GET    /api/v1/training/submissions/{id}                   # Get submission detail
PATCH  /api/v1/training/submissions/{id}                   # Update submission
DELETE /api/v1/training/submissions/{id}                   # Delete submission (draft, pending_review, revision_requested only)
POST   /api/v1/training/submissions/{id}/submit            # Hand a saved draft to the department (submitter only)
POST   /api/v1/training/submissions/{id}/attachments       # Add a certificate to a submission
GET    /api/v1/training/submissions/{id}/attachments       # List a submission's attachments
GET    /api/v1/training/submissions/{id}/attachments/{index}/download  # Download one attachment
DELETE /api/v1/training/submissions/{id}/attachments/{index}  # Remove one attachment
GET    /api/v1/training/submissions/pending                # Pending submissions (training.manage)
GET    /api/v1/training/submissions/pending/count          # Pending count (training.manage)
GET    /api/v1/training/submissions/all                    # All submissions (training.manage)
POST   /api/v1/training/submissions/{id}/review            # Review submission (approve/reject/request revision) (training.manage)
POST   /api/v1/training/submissions/{id}/reverse-approval  # Undo an approval (voids record, un-applies credit, reopens) (training.manage)
```

### Training Waivers

```
GET    /api/v1/training/waivers                            # List training waivers (training.manage)
GET    /api/v1/training/waivers/me                         # My waivers
POST   /api/v1/training/waivers                            # Create training waiver (training.manage)
PATCH  /api/v1/training/waivers/{id}                       # Update waiver (training.manage)
DELETE /api/v1/training/waivers/{id}                       # Deactivate waiver (training.manage)
```

### External Training Integration

```
GET    /api/v1/training/external/providers                 # List providers
GET    /api/v1/training/external/providers/{id}            # Get provider detail
POST   /api/v1/training/external/providers                 # Create provider
PATCH  /api/v1/training/external/providers/{id}            # Update provider
DELETE /api/v1/training/external/providers/{id}            # Delete provider
POST   /api/v1/training/external/providers/{id}/test       # Test connection
POST   /api/v1/training/external/providers/{id}/sync       # Trigger sync
POST   /api/v1/training/external/providers/{id}/sync-categories  # Fetch the provider's category catalog
POST   /api/v1/training/external/providers/{id}/upload-report    # Import a provider report file
GET    /api/v1/training/external/providers/{id}/sync-logs  # Sync logs
GET    /api/v1/training/external/providers/{id}/category-mappings  # Category mappings
PATCH  /api/v1/training/external/providers/{id}/category-mappings/{mappingId}  # Update mapping
GET    /api/v1/training/external/providers/{id}/course-mappings    # Course mappings
PATCH  /api/v1/training/external/providers/{id}/course-mappings/{mappingId}    # Update course mapping
GET    /api/v1/training/external/providers/{id}/user-mappings  # User mappings
PATCH  /api/v1/training/external/providers/{id}/user-mappings/{mappingId}  # Update mapping
GET    /api/v1/training/external/providers/{id}/imports    # Import records list
POST   /api/v1/training/external/providers/{id}/imports/{importId}/import  # Import single
POST   /api/v1/training/external/providers/{id}/imports/bulk  # Bulk import (up to 500 ids)
```

### Shift Completion Reports

```
POST   /api/v1/training/shift-reports                      # File a shift report (training.manage, or the shift's own Shift Officer)
POST   /api/v1/training/shift-reports/batch                # Create reports for every crew member on a shift
GET    /api/v1/training/shift-reports/shift-crew/{shift_id}  # Crew on a shift with enrollment and report status
GET    /api/v1/training/shift-reports/shift-preview/{shift_id}/{trainee_id}  # Preview auto-populated shift data (training.manage)
GET    /api/v1/training/shift-reports/my-reports            # My reports (trainee)
GET    /api/v1/training/shift-reports/my-stats              # My aggregate stats (trainee)
GET    /api/v1/training/shift-reports/by-officer            # Reports filed by current officer (training.manage)
GET    /api/v1/training/shift-reports/all                   # All reports (filterable, training.manage)
GET    /api/v1/training/shift-reports/by-status             # Reports by review status (training.manage)
GET    /api/v1/training/shift-reports/officer-analytics     # Analytics; scope=mine (default) or scope=department (+training.view_analytics)
GET    /api/v1/training/shift-reports/trainee/{user_id}     # Reports for specific trainee (training.manage)
GET    /api/v1/training/shift-reports/trainee/{user_id}/stats  # Trainee aggregate stats (training.manage)
GET    /api/v1/training/shift-reports/pending-review        # Reports awaiting review (training.manage)
GET    /api/v1/training/shift-reports/flagged               # Flagged reports for follow-up (training.manage)
GET    /api/v1/training/shift-reports/drafts                # Auto-created drafts (all with training.manage; otherwise the caller's own)
POST   /api/v1/training/shift-reports/drafts/submit-all    # Submit all drafts at once
GET    /api/v1/training/shift-reports/{id}                  # Report detail (trainee, filing officer, or training.manage)
PUT    /api/v1/training/shift-reports/{id}                  # Update a draft (filing officer)
POST   /api/v1/training/shift-reports/{id}/acknowledge     # Trainee acknowledges report
POST   /api/v1/training/shift-reports/{id}/review          # Review/approve/flag report (training.manage)
POST   /api/v1/training/shift-reports/batch-review         # Batch approve/flag up to 100 reports (training.manage)
```

### Module Configuration

```
GET    /api/v1/training/module-config/config               # Get module config
PUT    /api/v1/training/module-config/config               # Update module config (training.configure or training.manage)
GET    /api/v1/training/module-config/visibility           # Get member visibility settings
GET    /api/v1/training/module-config/my-training          # Get my training summary
GET    /api/v1/training/module-config/my-training/export   # Export my own training history (CSV/PDF)
GET    /api/v1/training/module-config/skill-names          # Active SkillEvaluation names for skill linkage (training.configure or training.manage)
```

### Skills Testing

```
GET    /api/v1/training/skills-testing/templates              # List templates — limit (max 500)/offset
POST   /api/v1/training/skills-testing/templates              # Create template
GET    /api/v1/training/skills-testing/templates/{id}         # Get template detail
PUT    /api/v1/training/skills-testing/templates/{id}         # Update template
DELETE /api/v1/training/skills-testing/templates/{id}         # Archive template
POST   /api/v1/training/skills-testing/templates/{id}/publish # Publish template
POST   /api/v1/training/skills-testing/templates/{id}/duplicate # Duplicate template
GET    /api/v1/training/skills-testing/library                # Built-in skill sheet library (training.manage)
POST   /api/v1/training/skills-testing/library/{slug}/import  # Import a library sheet as a template (training.manage)
GET    /api/v1/training/skills-testing/candidates?q=          # Candidate lookup by name (training.view or training.manage)
GET    /api/v1/training/skills-testing/tests                  # List tests — paged {items, total}; limit (50, max 200)/offset, search, date_from/date_to, pending_validation
GET    /api/v1/training/skills-testing/tests/export/csv       # CSV export — date_from + date_to required, at most 366 days apart (training.manage)
POST   /api/v1/training/skills-testing/tests                  # Create test
GET    /api/v1/training/skills-testing/tests/{id}             # Get test detail
PUT    /api/v1/training/skills-testing/tests/{id}             # Update test (save progress; accepts expected_version)
POST   /api/v1/training/skills-testing/tests/{id}/complete    # Complete test & calculate results
POST   /api/v1/training/skills-testing/tests/{id}/validate    # Validate a member-run official result (training.manage)
POST   /api/v1/training/skills-testing/tests/bulk-validate    # Validate up to 50 results in one action (training.manage)
POST   /api/v1/training/skills-testing/tests/{id}/return      # Send an unvalidated result back to its examiner (training.manage)
DELETE /api/v1/training/skills-testing/tests/{id}             # Delete — PRACTICE ONLY (refuses official tests) (training.manage)
DELETE /api/v1/training/skills-testing/tests/{id}/discard     # Discard practice test (candidate, examiner or officer)
POST   /api/v1/training/skills-testing/tests/{id}/release     # Release a withheld result (idempotent) (training.manage)
POST   /api/v1/training/skills-testing/tests/{id}/cancel      # Close out an UNSCORED evaluation
POST   /api/v1/training/skills-testing/tests/{id}/void        # Withdraw a SCORED official result; reason required (training.manage)
GET    /api/v1/training/skills-testing/tests/{id}/viewers     # Named viewers (training.manage)
POST   /api/v1/training/skills-testing/tests/{id}/viewers     # Add a named viewer (training.manage)
DELETE /api/v1/training/skills-testing/tests/{id}/viewers/{user_id}  # Remove a named viewer (training.manage)
POST   /api/v1/training/skills-testing/tests/{id}/email-results  # Email test results; disclosure resolved for the RECIPIENT (training.manage)
GET    /api/v1/training/skills-testing/summary                # Department-wide statistics (excludes voided)
```

> **`PUT /tests/{id}` accepts `expected_version`.** A stale value is refused
> with **`409`**; clients that omit it are not version-checked. **A refusal to
> read a withheld or out-of-scope test is always `404`, never `403`** — a 403
> would announce that a result exists and is being withheld. **Creating a test
> needs no `training.manage`** — practice or official. What an official test
> needs is an officer's **validation** before it counts, and that is where the
> requirement's `max_attempts` is spent; creation still checks the cap so an
> examiner is refused before running an evaluation that could not count.

### Knowledge Tests

```
GET    /api/v1/training/knowledge-tests                    # List tests
POST   /api/v1/training/knowledge-tests                    # Create test (training.manage)
GET    /api/v1/training/knowledge-tests/{id}               # Test detail (questions only for authors)
PATCH  /api/v1/training/knowledge-tests/{id}               # Update / publish test
DELETE /api/v1/training/knowledge-tests/{id}               # Delete test
POST   /api/v1/training/knowledge-tests/{id}/questions     # Add a question
PUT    /api/v1/training/knowledge-tests/{id}/questions/{question_id}  # Update a question
DELETE /api/v1/training/knowledge-tests/{id}/questions/{question_id}  # Remove a question
POST   /api/v1/training/knowledge-tests/{id}/attempts      # Start an attempt (server draws the paper)
GET    /api/v1/training/knowledge-tests/{id}/attempts      # Attempts on a test
GET    /api/v1/training/knowledge-tests/attempts/{attempt_id}          # One attempt
PUT    /api/v1/training/knowledge-tests/attempts/{attempt_id}/answers  # Save answers
POST   /api/v1/training/knowledge-tests/attempts/{attempt_id}/submit   # Submit for grading
```

### Skill Evaluations

```
GET    /api/v1/training/skill-evaluations                  # List skill evaluation definitions
POST   /api/v1/training/skill-evaluations                  # Create
GET    /api/v1/training/skill-evaluations/{id}             # Get one
PATCH  /api/v1/training/skill-evaluations/{id}             # Update
DELETE /api/v1/training/skill-evaluations/{id}             # Delete
POST   /api/v1/training/skill-evaluations/{id}/check-evaluator  # Can the caller evaluate this skill?
```

### Recertification Tracking

```
GET    /api/v1/training/recertification/pathways           # List recertification pathways
POST   /api/v1/training/recertification/pathways           # Create pathway (training.manage)
PATCH  /api/v1/training/recertification/pathways/{id}      # Update pathway (training.manage)
GET    /api/v1/training/recertification/tasks/me           # My renewal tasks
POST   /api/v1/training/recertification/generate-tasks     # Generate tasks for members (training.manage)
```

### Instructor Management

```
GET    /api/v1/training/instructors/qualifications         # List instructor qualifications (training.view_all or training.manage)
POST   /api/v1/training/instructors/qualifications         # Create qualification (training.manage)
PATCH  /api/v1/training/instructors/qualifications/{id}    # Update qualification (training.manage)
GET    /api/v1/training/instructors/qualifications/{courseId}/qualified  # Find qualified instructors
GET    /api/v1/training/instructors/validate/{userId}/{courseId}  # Validate instructor
```

### Training Effectiveness

```
POST   /api/v1/training/effectiveness/evaluations          # Submit evaluation
GET    /api/v1/training/effectiveness/evaluations          # List evaluations
GET    /api/v1/training/effectiveness/summary/{courseId}    # Course effectiveness summary
```

### Multi-Agency Training

```
GET    /api/v1/training/multi-agency                       # List multi-agency sessions (training.view_all or training.manage)
POST   /api/v1/training/multi-agency                       # Create multi-agency session (training.manage)
PATCH  /api/v1/training/multi-agency/{id}                  # Update session (training.manage)
```

### xAPI Integration

```
POST   /api/v1/training/xapi/statements                    # Queue an xAPI statement (training.manage)
POST   /api/v1/training/xapi/statements/batch              # Queue a batch of statements (training.manage)
POST   /api/v1/training/xapi/process                       # Send pending statements to the LRS (training.manage)
```

### Competency Management

```
GET    /api/v1/training/competency/matrices                # List competency matrices
POST   /api/v1/training/competency/matrices                # Create competency matrix (training.manage)
PATCH  /api/v1/training/competency/matrices/{id}           # Update matrix (training.manage)
GET    /api/v1/training/competency/department              # Department competency heat-map (training.manage)
GET    /api/v1/training/competency/members/{userId}        # Member competencies (training.manage)
GET    /api/v1/training/competency/me                      # My competencies
```

### Training Reports

```
POST   /api/v1/training/reports/export                     # Export report (returns file) (training.manage)
GET    /api/v1/training/reports/compliance-forecast         # Compliance forecast (training.manage)
```

### Training Record Attachments

```
GET    /api/v1/training/records/{id}/attachments                       # List attachments (metadata only, no file paths)
POST   /api/v1/training/records/{id}/attachments                       # Upload attachment (multipart, ≤25MB, magic-byte type check, malware scan)
GET    /api/v1/training/records/{id}/attachments/{index}/download       # Download a stored attachment by index
```

Access is the record owner or `training.manage`.

### Compliance Officer

```
GET    /api/v1/compliance/iso-readiness                    # ISO readiness assessment
POST   /api/v1/compliance/attestations                     # Submit attestation
GET    /api/v1/compliance/attestations                     # List attestations
GET    /api/v1/compliance/annual-report                    # Generate annual report
POST   /api/v1/compliance/annual-report/export             # Export annual report (returns file)
GET    /api/v1/compliance/contributed-hours                # Contributed hours (training.manage, reports.view or compliance.view)
GET    /api/v1/compliance/record-completeness              # Check record completeness
GET    /api/v1/compliance/incomplete-records                # List incomplete records
```

Every route here other than `contributed-hours` requires `training.manage`.

---

## Data Model

### Database Tables

| Table                                | Model                           | Description                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_categories`                | TrainingCategory                | Course categories (EMS, Fire, Hazmat, etc.) with custom colors and optional `registry_code` for NREMT NCCR linkage                                                                                          |
| `training_courses`                   | TrainingCourse                  | Course definitions with hours, certification flag, expiration months. `program_id` (nullable) records the pipeline this course's cohorts enrol into                                                         |
| `course_classes`                     | CourseClass                     | Syllabus of a multi-class course: ordered classes, each linked to a catalog course (`class_course_id`, NOT NULL) and timed by `day_offset` + local `start_time`. Unique on (`course_id`, `sequence`)        |
| `course_cohorts`                     | CourseCohort                    | One scheduled run of a multi-class course: start date, meeting days, date-roll policy, blackout dates, linked pipeline                                                                                      |
| `course_cohort_classes`              | CourseCohortClass               | A syllabus row materialized onto real UTC dates, linked to its `event_id` (`SET NULL`, unique) and `training_session_id`; `makeup_for_class_id` marks a make-up. Unique on (`cohort_id`, `course_class_id`) |
| `course_cohort_members`              | CourseCohortMember              | Cohort roster; `enrollment_id` ties each member to the ProgramEnrollment tracking their progress. Unique on (`cohort_id`, `user_id`)                                                                        |
| `course_cohort_missed_classes`       | CohortMissedClass               | The decision (credit or make-up) for each class held before a late joiner was added                                                                                                                         |
| `training_records`                   | TrainingRecord                  | Individual completions with rank/station snapshots, `category_id`, `start_time`, `source_event_id`, `attachments` JSON and `alert_{90,60,30,7}_sent_at` / `escalation_sent_at` expiry-alert stamps          |
| `training_requirements`              | TrainingRequirement             | Requirement definitions with type, frequency, targeting, `recency_days`, `include_current_month`, `shift_credited`, `name_match_until`, grandfathering dates, `allows_external_credit`                      |
| `training_sessions`                  | TrainingSession                 | Scheduled training events with instructor assignment, location, `counts_toward_certification`                                                                                                               |
| `training_approvals`                 | TrainingApproval                | Session approval workflow with token-based email approval                                                                                                                                                   |
| `training_programs`                  | TrainingProgram                 | Structured curricula (phases, flexible; sequential as a legacy stored value)                                                                                                                                |
| `program_phases`                     | ProgramPhase                    | Ordered phases within programs; `requires_manual_advancement`                                                                                                                                               |
| `program_requirements`               | ProgramRequirement              | Requirements linked to program phases                                                                                                                                                                       |
| `program_milestones`                 | ProgramMilestone                | Key checkpoints in program progression                                                                                                                                                                      |
| `program_enrollments`                | ProgramEnrollment               | Member enrollment in programs with status tracking and `target_completion_date`                                                                                                                             |
| `requirement_progress`               | RequirementProgress             | Per-member progress toward program requirements; `started_at` stamps the move to in progress                                                                                                                |
| `requirement_progress_credits`       | RequirementProgressCredit       | Idempotency ledger — one row per automated accrual, unique on (progress, source type, source id)                                                                                                            |
| `skill_evaluations`                  | SkillEvaluation                 | Skill evaluation definitions (also the target of shift-report skill linkage)                                                                                                                                |
| `skill_checkoffs`                    | SkillCheckoff                   | Individual skill check-off completions                                                                                                                                                                      |
| `skill_templates`                    | SkillTemplate                   | Skills testing template definitions (sections, criteria, scoring, disclosure overrides)                                                                                                                     |
| `skill_tests`                        | SkillTest                       | Skills test sessions with scores, results, template snapshot, `version`, validation stamps                                                                                                                  |
| `skill_test_viewers`                 | SkillTestViewer                 | Named viewers granted sight of one test's result                                                                                                                                                            |
| `knowledge_tests`                    | KnowledgeTest                   | Online written tests                                                                                                                                                                                        |
| `knowledge_test_questions`           | KnowledgeTestQuestion           | A test's question bank                                                                                                                                                                                      |
| `knowledge_test_attempts`            | KnowledgeTestAttempt            | One member's sitting of a test                                                                                                                                                                              |
| `training_module_configs`            | TrainingModuleConfig            | Member visibility (`show_*`), report form toggles (`form_show_*`), apparatus-type skills/tasks, rating scale, `report_review_required`, `allow_member_report_export`                                        |
| `self_report_configs`                | SelfReportConfig                | Self-report form configuration, including `attachment_retention_days`                                                                                                                                       |
| `training_submissions`               | TrainingSubmission              | Self-reported training awaiting review, with `start_time` and attachments                                                                                                                                   |
| `shift_completion_reports`           | ShiftCompletionReport           | Post-shift trainee reports                                                                                                                                                                                  |
| `training_waivers`                   | TrainingWaiver                  | Waivers (type, period — `end_date` NULL = permanent, `requirement_ids` NULL = all)                                                                                                                          |
| `external_training_providers`        | ExternalTrainingProvider        | External provider configurations                                                                                                                                                                            |
| `external_category_mappings`         | ExternalCategoryMapping         | Map external categories to internal                                                                                                                                                                         |
| `external_course_mappings`           | ExternalCourseMapping           | Map external courses to internal                                                                                                                                                                            |
| `external_user_mappings`             | ExternalUserMapping             | Map external users to internal members                                                                                                                                                                      |
| `external_training_sync_logs`        | ExternalTrainingSyncLog         | Sync history and status (including Target Solutions `review` runs)                                                                                                                                          |
| `external_training_imports`          | ExternalTrainingImport          | Individual import records with status and `credit_hours` for CE credit preservation                                                                                                                         |
| `recertification_pathways`           | RecertificationPathway          | Recertification pathway definitions                                                                                                                                                                         |
| `renewal_tasks`                      | RenewalTask                     | Per-member renewal tasks                                                                                                                                                                                    |
| `competency_matrices`                | CompetencyMatrix                | Competency matrix definitions                                                                                                                                                                               |
| `member_competencies`                | MemberCompetency                | Per-member competency levels                                                                                                                                                                                |
| `instructor_qualifications`          | InstructorQualification         | Instructor qualifications                                                                                                                                                                                   |
| `training_effectiveness_evaluations` | TrainingEffectivenessEvaluation | Kirkpatrick-level evaluations                                                                                                                                                                               |
| `multi_agency_trainings`             | MultiAgencyTraining             | Joint training exercises                                                                                                                                                                                    |
| `xapi_statements`                    | XAPIStatement                   | Queued and sent xAPI statements                                                                                                                                                                             |
| `shifts`                             | Shift                           | Shift definitions (used by shift completion reports)                                                                                                                                                        |
| `shift_attendance`                   | ShiftAttendance                 | Shift attendance records                                                                                                                                                                                    |
| `shift_calls`                        | ShiftCall                       | Calls responded during shifts                                                                                                                                                                               |

`include_current_month` is also an organization default on
`compliance_configs` (NOT NULL, default true); the per-requirement column
overrides it. EVOC levels are defined in the Apparatus module (`evoc_levels`,
each optionally linked to the training program that certifies it).

### Key Relationships

```
Organization (1) ─┬─< TrainingCategory (many)
                   ├─< TrainingCourse (many) ─┬─< TrainingRecord (many)
                   │                           └─< CourseClass (many, the syllabus)
                   ├─< CourseCohort (many) ─┬─< CourseCohortClass (many)
                   │                        └─< CourseCohortMember (many)
                   ├─< TrainingRequirement (many)
                   ├─< TrainingProgram (many) ─< ProgramPhase ─< ProgramRequirement
                   │                           └─< ProgramEnrollment ─< RequirementProgress
                   ├─< TrainingSession (many) ─< TrainingApproval
                   ├─< SkillTemplate (many) ─< SkillTest (many)
                   ├─< KnowledgeTest (many) ─┬─< KnowledgeTestQuestion (many)
                   │                         └─< KnowledgeTestAttempt (many)
                   └─< ExternalTrainingProvider (many) ─< ExternalTrainingSyncLog

User (1) ─┬─< TrainingRecord (many)
           ├─< CourseCohortMember (many)
           ├─< ProgramEnrollment (many)
           ├─< SkillTest (as candidate or examiner)
           └─< RequirementProgress (many)

TrainingSession ─── Event (via event_id FK)
TrainingSession ─── Location (via location)
TrainingRecord ─── TrainingCourse (via course_id FK)
TrainingRecord ─── TrainingCategory (via category_id FK)
TrainingRecord ─── Event (via source_event_id; unique with user_id)
CourseClass ─── TrainingCourse (via class_course_id FK — the course this class teaches)
CourseCohortClass ─── Event + TrainingSession (SET NULL: the cohort class is the
                      stable identity, the event is its current realization)
CourseCohortMember ─── ProgramEnrollment (via enrollment_id FK)
MemberLeaveOfAbsence ──auto-link──> TrainingWaiver (unless exempt_from_training_waiver)
```

### Key Enums

| Enum                        | Values                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `TrainingType`              | certification, continuing_education, skills_practice, orientation, refresher, specialty, policy_acknowledgment |
| `TrainingStatus`            | scheduled, in_progress, completed, cancelled, failed                                                           |
| `RequirementType`           | hours, courses, certification, shifts, calls, skills_evaluation, checklist, knowledge_test                     |
| `RequirementFrequency`      | annual, biannual, quarterly, monthly, one_time                                                                 |
| `DueDateType`               | calendar_period, rolling, certification_period, fixed_date                                                     |
| `ProgramStructureType`      | sequential (legacy; not offered in the pickers), phases, flexible                                              |
| `EnrollmentStatus`          | active, completed, expired, on_hold, withdrawn, failed                                                         |
| `RequirementProgressStatus` | not_started, in_progress, completed, verified, waived                                                          |
| `ProgressCreditSource`      | training_session, shift_report, external_import, officer_apply                                                 |
| `SubmissionStatus`          | draft, pending_review, approved, rejected, revision_requested                                                  |
| `ExternalProviderType`      | vector_solutions, target_solutions, lexipol, i_am_responding, custom_api                                       |
| `SyncStatus`                | pending, in_progress, completed, failed, partial                                                               |
| `TrainingWaiverType`        | leave_of_absence, medical, military, personal, administrative, new_member, other                               |
| `SkillTemplateStatus`       | draft, published, archived                                                                                     |
| `SkillTestStatus`           | draft, in_progress, completed, cancelled, voided                                                               |

Two status fields are plain strings rather than enums:
`external_training_imports.import_status` (pending, imported, failed, skipped,
duplicate) and `instructor_qualifications.qualification_type` (instructor,
evaluator, lead_instructor, mentor).

---

## Data Flows

### Self-Reported Training Flow

```
Member submits training → POST /training/submissions/with-attachment
  → Status: pending_review
  → In-app notification to every active Training Officer
Officer reviews → POST /training/submissions/{id}/review
  → If approved: TrainingRecord created (attachments copied), counts toward compliance
      → optional: apply toward a pipeline requirement
  → If rejected: member notified with reason
  → If revision_requested: member can update and resubmit
Officer reverses → POST /training/submissions/{id}/reverse-approval
  → record voided, credit un-applied, submission reopened
```

### Program Enrollment Flow

```
Officer enrolls member → POST /training/programs/enrollments (searchable picker)
  → RequirementProgress records created for each program requirement
  → Status: active
Member progresses (any of):
  → Officer logs hours/shifts/calls/courses, or marks a requirement
    complete / in progress / reopened / verified (PATCH .../progress/{id})
  → Shift report approved (shifts/calls/hours/skills)
  → Training session approved (advances linked requirement, or the program's
    requirements in the session's category)
  → Skills test passed and validated against a linked requirement
  → Knowledge-test score recorded (online attempt or officer entry)
  → External import, where the requirement allows external credit
Each update recalculates overall % (average of required items) and
  auto-advances any completed phases (unless phase requires officer approval)
All required items met → Status: completed
  (falls back to active if progress later drops below 100%)
Past target_completion_date → Status: expired (on read, or daily 05:15 task)
  → POST .../enrollments/{id}/reopen returns it to active
```

### Skills Testing Flow

```
Admin creates template → POST /training/skills-testing/templates
  → Status: draft (cannot be used for testing yet)
Admin publishes → POST /training/skills-testing/templates/{id}/publish
  → Status: published (available for testing)
Examiner starts test → POST /training/skills-testing/tests
  → Any member may examine (auth-only)
  → Candidate chosen via GET /training/skills-testing/candidates?q=<name>
  → Timer starts, criteria loaded for scoring
Examiner scores criteria → PUT /training/skills-testing/tests/{id}
  → Real-time section scores and running total
  → Autosaves; a stale expected_version is refused with 409
  → Offline: queued on the device and sent on reconnect
Examiner completes → POST /training/skills-testing/tests/{id}/complete
  → Score calculated, pass/fail determined
  → Post-completion review screen with notes
  → If the examiner holds training.manage: validated in the same step
  → Otherwise: validated_at stays NULL — a submission, not a record
```

**Validation step (member-run tests only)**

```
Officer opens the review queue → GET /training/skills-testing/tests?pending_validation=true
  → Badge count comes from GET /summary → pending_validation

Officer accepts → POST /training/skills-testing/tests/{id}/validate
               (or POST /tests/bulk-validate, up to 50)
  → Requires training.manage; idempotent
  → Refused (400) if the officer is the candidate — separation of duties
  → Refused (400) for practice, voided, or not-yet-completed tests
  → Spends one attempt against the requirement's max_attempts
  → Credits the linked pipeline requirement if the test passed
  → Result becomes visible to the candidate under the template's
    disclosure rules, and enters the pass rate / average score

Officer returns → POST /training/skills-testing/tests/{id}/return
  → Back to the examiner at in_progress, marks intact; candidate not notified

Officer rejects → POST /training/skills-testing/tests/{id}/void
  → Keeps the submission and the reason it was refused
```

### Certification Expiry Alert Flow

```
Daily scheduled task (06:00) → cert_expiration_alerts
  → Runs CertAlertService.process_alerts for each organization
    (gated by the org's TRAINING_EXPIRY notification rule)
  → For each certification approaching expiration:
    90 days → alert to member (in-app + email)
    60 days → alert to member (in-app + email)
    30 days → alert to member + training officer (in-app + email CC)
    7 days  → alert to member + training + compliance (in-app + email CC)
    Expired → escalation to all officers (in-app + email CC)
  → Each tier sent only once (tracked by alert_{90,60,30,7}_sent_at, escalation_sent_at)
```

### Waiver Adjustment Flow

```
Leave of Absence created → auto-creates linked training waiver
  (unless exempt_from_training_waiver = true)
Waiver active during evaluation period →
  → Count months with ≥15 days covered as "waived"
  → active_months = MAX(total_months - waived_months, 1)
  → adjusted_required = base_required × (active_months / total_months)
  → Applies to hours, shifts, calls requirements
  → Does NOT apply to certification or course completion requirements
```

---

## Frontend Services

The training module's service objects live in
`frontend/src/services/trainingServices.ts` (18 exported services), plus
`shiftCompletionService` and the waiver calls in
`frontend/src/services/adminServices.ts`:

| Service                       | API Prefix                       | Key Operations                                                                        |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `trainingService`             | `/training`                      | CRUD for records, courses, categories, requirements; compliance summary/matrix; stats |
| `externalTrainingService`     | `/training/external`             | Provider CRUD, connection testing, sync, mappings, imports                            |
| `trainingProgramService`      | `/training/programs`             | Programs, phases, milestones, enrollments, progress, registry import, export/import   |
| `trainingSessionService`      | `/training/sessions`             | Session calendar, creation, finalization, token-based approval                        |
| `trainingSubmissionService`   | `/training/submissions`          | Self-reported submissions, attachments, config, review workflow                       |
| `trainingModuleConfigService` | `/training/module-config`        | Module visibility and configuration                                                   |
| `skillsTestingService`        | `/training/skills-testing`       | Templates, tests, completion, validation, viewers, practice mode                      |
| `recertificationService`      | `/training/recertification`      | Pathways, renewal tasks                                                               |
| `competencyService`           | `/training/competency`           | Competency matrices, member competencies                                              |
| `instructorService`           | `/training/instructors`          | Qualifications, validation, qualified instructor lookup                               |
| `effectivenessService`        | `/training/effectiveness`        | Evaluations, course summaries                                                         |
| `multiAgencyService`          | `/training/multi-agency`         | Joint session CRUD                                                                    |
| `reportExportService`         | `/training/reports`              | Report export, compliance forecast                                                    |
| `documentService`             | `/training/records/{id}`         | Record attachments                                                                    |
| `complianceOfficerService`    | `/compliance`                    | ISO readiness, attestations, annual report, record completeness                       |
| `complianceConfigService`     | `/compliance/config`             | Compliance thresholds and profiles                                                    |
| `courseSyllabusService`       | `/training/courses/{id}/classes` | Syllabus classes, reorder, autofill                                                   |
| `courseCohortService`         | `/training/cohorts`              | Cohort preview, generation, schedule changes, roster, missed classes                  |
| `shiftCompletionService`      | `/training/shift-reports`        | Shift report filing, review, drafts, preview (in `adminServices.ts`)                  |

---

## Frontend State Management

### Zustand Store: `useSkillsTestingStore`

**File:** `frontend/src/stores/skillsTestingStore.ts`

| State                | Type                          | Description                                         |
| -------------------- | ----------------------------- | --------------------------------------------------- |
| `templates`          | `SkillTemplateListItem[]`     | All templates for the org                           |
| `currentTemplate`    | `SkillTemplate \| null`       | Currently viewed/edited template                    |
| `tests`              | `SkillTestListItem[]`         | The current page of tests                           |
| `testsTotal`         | `number`                      | Total matching tests (for paging)                   |
| `currentTest`        | `SkillTest \| null`           | Currently active test session                       |
| `activeTestTimer`    | `number`                      | Timer seconds for active test                       |
| `activeTestRunning`  | `boolean`                     | Whether timer is running                            |
| `activeSectionIndex` | `number`                      | Current section in active test                      |
| `summary`            | `SkillTestingSummary \| null` | Department statistics                               |
| `offlineState`       | `SkillsOfflineState \| null`  | Whether the test on screen has work waiting to sync |

**30 actions** covering template/test CRUD, scoring, validation (single and
bulk), return, void, release, timer management, summary loading and offline
sync (`handleSynced`).

`loadTests` accepts a `pending_validation` filter (the officer review queue).
`validateTest(id)` patches the matching list row in place — clearing
`pending_validation`, stamping `validated_at`, and writing through `result` and
`overall_score`, because the row carried a **withheld** outcome while the test
was pending and the validated response is the first time this reader sees the
real one.

---
