# Training Module

The Training module tracks courses, certifications, training requirements, program enrollments, external training integrations, and compliance reporting.

---

## Key Features

- **Training Requirements** — Hours, shifts, calls, course completions, and certifications with annual/quarterly/monthly/rolling frequencies. Requirements can target specific member categories (Active, Administrative, Probationary, Life, Retired, Honorary) or apply to all members
- **Training Programs** — Structured multi-phase curricula (Flexible, Sequential, Phase-based) with milestone tracking
- **Self-Reported Training** — Members submit training records for officer review and approval
- **Shift Completion Reports** — Officers file post-shift reports that auto-credit hours/shifts/calls toward program requirements
- **Compliance Matrix** — Grid view of all members vs. all active requirements (green/yellow/red)
- **Competency Matrix** — Department readiness heat-map with color-coded proficiency levels
- **Expiring Certifications** — Tiered alerts at 90/60/30/7 days with escalation for expired certs
- **Compliance Summary** — Per-member green/yellow/red compliance card on profiles
- **Training Waivers** — Leave of Absence auto-linking, waiver management, proportional requirement adjustment. Supports permanent waivers (no end date), New Member waiver type, and multi-select "Applies To" (Training + Meetings + Shifts can be combined)
- **Bulk Record Creation** — Up to 500 records per request with duplicate detection (same member + course name + completion date within ±1 day)
- **Rank & Station Snapshots** — `rank_at_completion` and `station_at_completion` captured on every record
- **External Integrations** — Connect external training providers (Vector Solutions, Target Solutions, Lexipol, iAmResponding, Custom API) with category and user mapping
- **Historical Import** — CSV import with preview and validation
- **Registry Integration** — NFPA Standards, NREMT Certifications, Pro Board one-click import with source URL citations and last-updated timestamps
- **Registry Generator Tool** — Standalone CLI tool (`scripts/generate_registry.py`) for generating registries from standards bodies, with `--list` flag to show available registries
- **Source Tracking on Imports** — Imported requirements include `source`, `source_url`, and `last_updated` fields for traceability
- **Training Record Attachments** — Upload certificates, transcripts, and completion letters to training records
- **Recertification Tracking** — *(2026-03-05)* Automated recertification reminders with configurable lead times. Scheduled Celery task sends tiered notifications before certification expiry
- **Instructor Management** — *(2026-03-05)* Track instructor qualifications (instructor, evaluator, lead_instructor, mentor), availability, and assignment to training sessions with validation
- **Effectiveness Scoring** — *(2026-03-05)* Training effectiveness measurement using Kirkpatrick model (reaction, learning, behavior, results)
- **Multi-Agency Training** — *(2026-03-05)* Joint training session coordination across departments with shared records and mutual aid tracking
- **xAPI (Tin Can) Integration** — *(2026-03-05)* Learning Record Store integration for standardized training activity tracking. Async statement delivery via Celery
- **Compliance Officer Dashboard** — *(2026-03-05)* ISO readiness tracking, compliance attestations, annual compliance reports, compliance forecasting, and record completeness checks
- **Recurring Training Sessions** — *(2026-03-15)* Training sessions can recur using the same infrastructure as events (daily, weekly, biweekly, monthly, monthly_weekday, annually, annually_weekday, custom). Backend creates recurring events via `EventService` and links a `TrainingSession` to each occurrence. Selecting a course auto-populates training type, credit hours, instructor, expiration months, and max participants
- **Quarter-Hour Time Picker** — *(2026-03-15)* New `DateTimeQuarterHour` UX component replacing browser `datetime-local` inputs (which ignore `step="900"`). Splits date/time into a native date picker and a select dropdown restricted to `:00`, `:15`, `:30`, `:45`
- **Quick Duration Buttons** — *(2026-03-15)* 1-hour, 2-hour, 4-hour, and 8-hour buttons on the training session form, matching the pattern in EventForm. Appear once a start date is set and auto-populate end date/time
- **Course Auto-Populate** — *(2026-03-15)* Selecting an existing course in the session creation form auto-fills training type, credit hours, instructor, expiration months, and max participants with a details preview card

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/training` | My Training | Authenticated |
| `/training/my-training` | My Training (alias) | Authenticated |
| `/training/submit` | Submit Training | Authenticated |
| `/training/courses` | Course Library | Authenticated |
| `/training/programs` | Training Programs | Authenticated |
| `/training/programs/:id` | Program Detail | Authenticated |
| `/training/admin` | Training Admin Hub | `training.manage` |
| `/training/skills-testing` | Skills Testing Hub | Authenticated |
| `/training/skills-testing/templates/new` | Template Builder (new) | `training.manage` |
| `/training/skills-testing/templates/:id` | Template Builder (view) | `training.manage` |
| `/training/skills-testing/templates/:id/edit` | Template Builder (edit) | `training.manage` |
| `/training/skills-testing/test/new` | Start Skill Test | Authenticated |
| `/training/skills-testing/test/:testId` | Active Skill Test | Authenticated |
| `/training/skills-testing/test/:testId/active` | Active Skill Test (alias) | Authenticated |
| `/members/:userId/training` | Member Training History | Authenticated |

### Training Admin Tabs

| Tab | Description |
|-----|-------------|
| Officer Dashboard | Department-wide overview, completion rates, members behind schedule |
| Training Waivers | All training waivers with summary cards, status filtering, source tracking (Auto LOA / Manual) |
| Review Submissions | Pending member submissions for approval/rejection |
| Requirements | Create and manage training requirements with type, frequency, due date, role targeting |
| Create Session | Create training sessions linked to events with instructor assignment |
| Compliance Matrix | All members x all requirements grid (green/yellow/red cells) |
| Competency Matrix | Department readiness heat-map with proficiency levels |
| Expiring Certs | Certifications expiring within 90 days with alert processing |
| Pipelines | Training program management (create, phases, milestones, enrollment) |
| Shift Reports | Shift officer reports with auto-progression toward program requirements |
| Integrations | External training provider connections with sync and mapping |
| Import History | CSV import records with preview and validation |
| Enhancements | Recertification pathways, instructor management, effectiveness scoring, multi-agency, compliance officer |

### Legacy Redirects

| Old URL | Redirects To |
|---------|-------------|
| `/training/officer` | `/training/admin?page=dashboard&tab=overview` |
| `/training/submissions` | `/training/admin?page=records&tab=submissions` |
| `/training/requirements` | `/training/admin?page=setup&tab=requirements` |
| `/training/sessions/new` | `/training/admin?page=records&tab=sessions` |
| `/training/programs/new` | `/training/admin?page=setup&tab=pipelines` |
| `/training/shift-reports` | `/training/admin?page=records&tab=shift-reports` |
| `/training/integrations` | `/training/admin?page=setup&tab=integrations` |

---

## API Endpoints

### Core Training

```
GET    /api/v1/training/records                            # List training records (filterable)
POST   /api/v1/training/records                            # Create a training record
POST   /api/v1/training/records/bulk                       # Bulk create (up to 500, with duplicate detection)
POST   /api/v1/training/records/import-csv                 # CSV import with parse and preview
PATCH  /api/v1/training/records/{id}                       # Update a training record
GET    /api/v1/training/compliance-summary/{user_id}       # Member compliance card (green/yellow/red)
GET    /api/v1/training/compliance-matrix                  # All members x requirements grid
GET    /api/v1/training/competency-matrix                  # Department readiness heat-map
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
PATCH  /api/v1/training/courses/{id}                       # Update course
GET    /api/v1/training/stats/user/{user_id}               # User training stats
GET    /api/v1/training/reports/user/{user_id}             # User training report
GET    /api/v1/training/requirements/progress/{user_id}    # User requirement progress
GET    /api/v1/training/certifications/expiring            # Expiring certifications list
GET    /api/v1/training/expiring-certifications            # Expiring certifications (alias)
POST   /api/v1/training/certifications/process-alerts/all-orgs  # Run cert alert cron
```

### Training Programs

```
GET    /api/v1/training/programs/requirements              # List program requirements
GET    /api/v1/training/programs/requirements/{id}         # Get single requirement
POST   /api/v1/training/programs/requirements              # Create requirement
PATCH  /api/v1/training/programs/requirements/{id}         # Update requirement
GET    /api/v1/training/programs/programs                  # List programs
GET    /api/v1/training/programs/programs/{id}             # Get program detail
POST   /api/v1/training/programs/programs                  # Create program
GET    /api/v1/training/programs/programs/{id}/phases      # Get program phases
POST   /api/v1/training/programs/programs/{id}/phases      # Create phase
GET    /api/v1/training/programs/programs/{id}/requirements # Get program requirements
POST   /api/v1/training/programs/programs/{id}/requirements # Add requirement to program
POST   /api/v1/training/programs/programs/{id}/milestones  # Create milestone
POST   /api/v1/training/programs/enrollments               # Enroll member
GET    /api/v1/training/programs/enrollments/me            # My enrollments
GET    /api/v1/training/programs/enrollments/user/{user_id} # User enrollments
GET    /api/v1/training/programs/enrollments/{id}          # Get enrollment detail
PATCH  /api/v1/training/programs/progress/{id}             # Update progress
POST   /api/v1/training/programs/programs/{id}/duplicate   # Duplicate program
POST   /api/v1/training/programs/programs/{id}/bulk-enroll # Bulk enroll members
GET    /api/v1/training/programs/requirements/registries   # List available registries
POST   /api/v1/training/programs/requirements/import/{name} # Import from registry
```

### Training Sessions

```
GET    /api/v1/training/sessions/calendar                  # Session calendar
POST   /api/v1/training/sessions                           # Create session
POST   /api/v1/training/sessions/{id}/finalize             # Finalize session
GET    /api/v1/training/sessions/approve/{token}           # Get approval by token
POST   /api/v1/training/sessions/approve/{token}           # Submit approval by token
```

### Self-Reported Training (Submissions)

```
GET    /api/v1/training/submissions/config                 # Get submission config
PUT    /api/v1/training/submissions/config                 # Update submission config
POST   /api/v1/training/submissions                        # Submit training
GET    /api/v1/training/submissions/my                     # My submissions
GET    /api/v1/training/submissions/{id}                   # Get submission detail
PATCH  /api/v1/training/submissions/{id}                   # Update submission
DELETE /api/v1/training/submissions/{id}                   # Delete submission
GET    /api/v1/training/submissions/pending                # Pending submissions (officer)
GET    /api/v1/training/submissions/pending/count          # Pending count
GET    /api/v1/training/submissions/all                    # All submissions (officer)
POST   /api/v1/training/submissions/{id}/review            # Review submission (approve/reject)
```

### Training Waivers

```
GET    /api/v1/training/waivers                            # List training waivers
POST   /api/v1/training/waivers                            # Create training waiver
PATCH  /api/v1/training/waivers/{id}                       # Update waiver
DELETE /api/v1/training/waivers/{id}                       # Deactivate waiver
GET    /api/v1/training/waivers/{id}                       # Get waiver detail
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
GET    /api/v1/training/external/providers/{id}/sync-logs  # Sync logs
GET    /api/v1/training/external/providers/{id}/category-mappings  # Category mappings
PATCH  /api/v1/training/external/providers/{id}/category-mappings/{mappingId}  # Update mapping
GET    /api/v1/training/external/providers/{id}/user-mappings  # User mappings
PATCH  /api/v1/training/external/providers/{id}/user-mappings/{mappingId}  # Update mapping
GET    /api/v1/training/external/providers/{id}/imports    # Import records list
POST   /api/v1/training/external/providers/{id}/imports/{importId}/import  # Import single
POST   /api/v1/training/external/providers/{id}/imports/bulk  # Bulk import
```

### Shift Completion Reports

```
POST   /api/v1/training/shift-reports                      # Submit shift report
GET    /api/v1/training/shift-reports                      # List reports
GET    /api/v1/training/shift-reports/{id}                 # Get report detail
PATCH  /api/v1/training/shift-reports/{id}                 # Update report
POST   /api/v1/training/shift-reports/{id}/review          # Review report
GET    /api/v1/training/shift-reports/trainee/{user_id}    # Reports for trainee
GET    /api/v1/training/shift-reports/stats/{user_id}      # Trainee stats
```

### Module Configuration

```
GET    /api/v1/training/module-config/config               # Get module config
PUT    /api/v1/training/module-config/config               # Update module config
GET    /api/v1/training/module-config/visibility           # Get member visibility settings
GET    /api/v1/training/module-config/my-training          # Get my training summary config
```

### Skills Testing

```
GET    /api/v1/training/skills-testing/templates              # List templates
POST   /api/v1/training/skills-testing/templates              # Create template
GET    /api/v1/training/skills-testing/templates/{id}         # Get template detail
PUT    /api/v1/training/skills-testing/templates/{id}         # Update template
DELETE /api/v1/training/skills-testing/templates/{id}         # Archive template
POST   /api/v1/training/skills-testing/templates/{id}/publish # Publish template
POST   /api/v1/training/skills-testing/templates/{id}/duplicate # Duplicate template
GET    /api/v1/training/skills-testing/tests                  # List tests
POST   /api/v1/training/skills-testing/tests                  # Create test
GET    /api/v1/training/skills-testing/tests/{id}             # Get test detail
PUT    /api/v1/training/skills-testing/tests/{id}             # Update test (save progress)
POST   /api/v1/training/skills-testing/tests/{id}/complete    # Complete test & calculate results
DELETE /api/v1/training/skills-testing/tests/{id}             # Delete test record (training.manage)
DELETE /api/v1/training/skills-testing/tests/{id}/discard     # Discard practice test
POST   /api/v1/training/skills-testing/tests/{id}/email-results  # Email test results
GET    /api/v1/training/skills-testing/summary                # Department-wide statistics
```

### Recertification Tracking

```
GET    /api/v1/training/recertification/pathways           # List recertification pathways
POST   /api/v1/training/recertification/pathways           # Create pathway
PATCH  /api/v1/training/recertification/pathways/{id}      # Update pathway
GET    /api/v1/training/recertification/tasks/me           # My renewal tasks
POST   /api/v1/training/recertification/generate-tasks     # Generate tasks for members
```

### Instructor Management

```
GET    /api/v1/training/instructors/qualifications         # List instructor qualifications
POST   /api/v1/training/instructors/qualifications         # Create qualification
PATCH  /api/v1/training/instructors/qualifications/{id}    # Update qualification
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
GET    /api/v1/training/multi-agency                       # List multi-agency sessions
POST   /api/v1/training/multi-agency                       # Create multi-agency session
PATCH  /api/v1/training/multi-agency/{id}                  # Update session
```

### xAPI Integration

```
POST   /api/v1/training/xapi/statements                    # Send xAPI statement
POST   /api/v1/training/xapi/statements/batch              # Batch send statements
POST   /api/v1/training/xapi/process                       # Process pending statements
```

### Competency Management

```
GET    /api/v1/training/competency/matrices                # List competency matrices
POST   /api/v1/training/competency/matrices                # Create competency matrix
PATCH  /api/v1/training/competency/matrices/{id}           # Update matrix
GET    /api/v1/training/competency/members/{userId}        # Member competencies
GET    /api/v1/training/competency/me                      # My competencies
```

### Training Reports

```
POST   /api/v1/training/reports/export                     # Export report (returns file)
GET    /api/v1/training/reports/compliance-forecast         # Compliance forecast
```

### Training Record Attachments

```
GET    /api/v1/training/records/{id}/attachments           # List attachments
POST   /api/v1/training/records/{id}/attachments           # Upload attachment
```

### Compliance Officer

```
GET    /api/v1/compliance/iso-readiness                    # ISO readiness assessment
POST   /api/v1/compliance/attestations                     # Submit attestation
GET    /api/v1/compliance/attestations                     # List attestations
GET    /api/v1/compliance/annual-report                    # Generate annual report
POST   /api/v1/compliance/annual-report/export             # Export annual report (returns file)
GET    /api/v1/compliance/record-completeness              # Check record completeness
GET    /api/v1/compliance/incomplete-records                # List incomplete records
```

---

## Data Model

### Database Tables

| Table | Model | Description |
|-------|-------|-------------|
| `training_categories` | TrainingCategory | Course categories (EMS, Fire, Hazmat, etc.) with custom colors |
| `training_courses` | TrainingCourse | Course definitions with hours, certification flag, expiration months |
| `training_records` | TrainingRecord | Individual training completions with rank/station snapshots |
| `training_requirements` | TrainingRequirement | Requirement definitions with type, frequency, role targeting |
| `training_sessions` | TrainingSession | Scheduled training events with instructor assignment and location |
| `training_approvals` | TrainingApproval | Session approval workflow with token-based email approval |
| `training_programs` | TrainingProgram | Structured curricula (sequential, phases, flexible) |
| `program_phases` | ProgramPhase | Ordered phases within programs |
| `program_requirements` | ProgramRequirement | Requirements linked to program phases |
| `program_milestones` | ProgramMilestone | Key checkpoints in program progression |
| `program_enrollments` | ProgramEnrollment | Member enrollment in programs with status tracking |
| `requirement_progress` | RequirementProgress | Per-member progress toward program requirements |
| `skill_evaluations` | SkillEvaluation | Skills evaluation records |
| `skill_checkoffs` | SkillCheckoff | Individual skill check-off completions |
| `skill_templates` | SkillTemplate | Skills testing template definitions (sections, criteria, scoring) |
| `skill_tests` | SkillTest | Skills test sessions with scores and results |
| `external_training_providers` | ExternalTrainingProvider | External provider configurations |
| `external_category_mappings` | ExternalCategoryMapping | Map external categories to internal |
| `external_user_mappings` | ExternalUserMapping | Map external users to internal members |
| `external_training_sync_logs` | ExternalTrainingSyncLog | Sync history and status |
| `external_training_imports` | ExternalTrainingImport | Individual import records with status |
| `shifts` | Shift | Shift definitions (used by shift completion reports) |
| `shift_attendance` | ShiftAttendance | Shift attendance records |
| `shift_calls` | ShiftCall | Calls responded during shifts |

### Key Relationships

```
Organization (1) ─┬─< TrainingCategory (many)
                   ├─< TrainingCourse (many) ─< TrainingRecord (many)
                   ├─< TrainingRequirement (many)
                   ├─< TrainingProgram (many) ─< ProgramPhase ─< ProgramRequirement
                   │                           └─< ProgramEnrollment ─< RequirementProgress
                   ├─< TrainingSession (many) ─< TrainingApproval
                   ├─< SkillTemplate (many) ─< SkillTest (many)
                   └─< ExternalTrainingProvider (many) ─< ExternalTrainingSyncLog

User (1) ─┬─< TrainingRecord (many)
           ├─< ProgramEnrollment (many)
           ├─< SkillTest (as candidate or examiner)
           └─< RequirementProgress (many)

TrainingSession ─── Event (via event_id FK)
TrainingSession ─── Location (via location)
TrainingRecord ─── TrainingCourse (via course_id FK)
MemberLeaveOfAbsence ──auto-link──> TrainingWaiver (unless exempt_from_training_waiver)
```

### Key Enums

| Enum | Values |
|------|--------|
| `TrainingType` | certification, continuing_education, skills_practice, orientation, refresher, specialty |
| `TrainingStatus` | scheduled, in_progress, completed, cancelled, failed |
| `RequirementType` | hours, courses, certification, shifts, calls, skills_evaluation, checklist, knowledge_test |
| `RequirementFrequency` | annual, biannual, quarterly, monthly, one_time |
| `DueDateType` | calendar_period, rolling, certification_period, fixed_date |
| `ProgramStructureType` | sequential, phases, flexible |
| `EnrollmentStatus` | active, completed, expired, on_hold, withdrawn, failed |
| `RequirementProgressStatus` | not_started, in_progress, completed, verified, waived |
| `SubmissionStatus` | draft, pending_review, approved, rejected, revision_requested |
| `ExternalProviderType` | vector_solutions, target_solutions, lexipol, i_am_responding, custom_api |
| `SyncStatus` | pending, in_progress, completed, failed, partial |
| `ImportStatus` | pending, imported, failed, skipped, duplicate |
| `InstructorQualificationType` | instructor, evaluator, lead_instructor, mentor |
| `SkillTemplateStatus` | draft, published, archived |
| `SkillTestStatus` | not_started, in_progress, completed, cancelled |

---

## Skills Testing

The Training module includes a **Skills Testing** sub-module for conducting structured psychomotor evaluations (NREMT-style skill sheets).

### Key Capabilities

- **Skill Sheet Templates** — Reusable evaluation definitions with sections, criteria, scoring configuration, versioning, and lifecycle (draft → published → archived)
- **Statement Criteria** — Open-ended text-box criterion type for descriptive responses (e.g., "Describe the patient's chief complaint")
- **Critical Criteria** — Required criteria that trigger automatic failure, mirroring NREMT auto-fail rules
- **Point-Based Scoring** — Criteria with configurable point values for weighted scoring. Section point subtotals and overall percentage calculated from total points
- **Test Administration** — Examiner selects template + candidate, scores criteria in real time, system calculates pass/fail
- **Practice Mode** — Non-graded practice tests with email results, discard, and retake flow
- **Test Visibility Controls** — Admin-controlled visibility toggle per test to show/hide results from candidates
- **Post-Completion Review** — Section-by-section review screen with notes before finalizing, auto-stop clock
- **Test Record Deletion** — Training officers can permanently delete test records with audit logging
- **Scoring Engine** — Automatic section scores, overall percentage, critical criteria compliance, elapsed time
- **Summary Dashboard** — Department-wide statistics (pass rate, average score, tests this month)

### Pass/Fail Determination

A candidate **passes** if ALL of the following are true:
1. Their percentage score meets or exceeds the template's **passing percentage**
2. If "Require All Critical" is enabled, ALL required criteria were scored as passed

A candidate **fails** if ANY of the following are true:
1. Their percentage score is below the passing percentage
2. Any required criterion was not passed (when "Require All Critical" is enabled)

### Edge Cases

- Even if a candidate scores above the passing percentage, a single missed critical criterion results in automatic FAIL when "Require All Critical" is enabled
- Practice tests do not count toward training compliance or certification requirements
- Archived templates cannot be used for new tests, but historical test results always reference the template version they were administered under
- Non-critical criteria that are unchecked display as "Not Completed" (not "FAIL")
- Score is calculated from points, not simple criterion count — criteria with higher point values carry more weight

---

## Cross-Module Connections

| Source | Target | Connection | Mechanism |
|--------|--------|------------|-----------|
| Events | Training | Event attendance → Training session/records | `training_session.event_id` FK |
| Training | Users | Compliance per member | `GET /training/compliance-summary/{user_id}` |
| Training | Scheduling | Shift completion reports → Training credit | `POST /training/shift-reports` |
| Locations | Training | Training session location | `training_session.location` FK |
| Member Leaves | Training Waivers | Auto-create waiver from LOA | `leave.exempt_from_training_waiver` → auto-link |
| Training | Dashboard | Training compliance metrics, expiring certs | `GET /dashboard/stats` includes training data |
| Training | Reports | Cross-module report generation | `POST /reports/generate` with training report types |
| Training | Notifications | Submission, approval, cert expiry alerts | In-app + email notifications |
| Training | Multi-Agency | Joint sessions across organizations | `POST /training/multi-agency` |
| Training | External LRS | xAPI statement delivery | `POST /training/xapi/statements` (async via Celery) |
| Training | Compliance | ISO readiness, attestations, annual reports | `GET /compliance/iso-readiness` |

---

## Data Flows

### Self-Reported Training Flow

```
Member submits training → POST /training/submissions
  → Status: pending_review
  → Notification sent to officers with training.manage permission
Officer reviews → POST /training/submissions/{id}/review
  → If approved: TrainingRecord created, counts toward compliance
  → If rejected: Notification sent to member with reason
  → If revision_requested: Member can update and resubmit
```

### Program Enrollment Flow

```
Officer enrolls member → POST /training/programs/enrollments
  → RequirementProgress records created for each program requirement
  → Status: active
Member completes training → Training records created
  → Shift reports auto-progress matching requirements
  → Progress updated in RequirementProgress
  → Phase completion tracked in ProgramEnrollment
All requirements met → Status: completed
```

### Skills Testing Flow

```
Admin creates template → POST /training/skills-testing/templates
  → Status: draft (cannot be used for testing yet)
Admin publishes → POST /training/skills-testing/templates/{id}/publish
  → Status: published (available for testing)
Examiner starts test → POST /training/skills-testing/tests
  → Select template + candidate
  → Timer starts, criteria loaded for scoring
Examiner scores criteria → PUT /training/skills-testing/tests/{id}
  → Real-time section scores and running total
Examiner completes → POST /training/skills-testing/tests/{id}/complete
  → Score calculated, pass/fail determined
  → Post-completion review screen with notes
  → Training record created if linked to requirement
```

### Certification Expiry Alert Flow

```
Daily scheduled task → check_expiring_certifications
  → Scans all certifications across all organizations
  → For each certification approaching expiration:
    90 days → alert to member (in-app + email)
    60 days → alert to member (in-app + email)
    30 days → alert to member + training officer (in-app + email CC)
    7 days  → alert to member + training + compliance (in-app + email CC)
    Expired → escalation to all officers (in-app + email CC)
  → Each tier sent only once (tracked by alert_*_sent_at)
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

The training module uses 16 exported service objects in `frontend/src/services/trainingServices.ts`:

| Service | API Prefix | Key Operations |
|---------|------------|----------------|
| `trainingService` | `/training` | CRUD for records, courses, categories, requirements; compliance summary/matrix; stats |
| `externalTrainingService` | `/training/external` | Provider CRUD, connection testing, sync, mappings, imports |
| `trainingProgramService` | `/training/programs` | Programs, phases, milestones, enrollments, progress, registry import |
| `trainingSessionService` | `/training/sessions` | Session calendar, creation, finalization, token-based approval |
| `trainingSubmissionService` | `/training/submissions` | Self-reported submissions, config, review workflow |
| `trainingModuleConfigService` | `/training/module-config` | Module visibility and configuration |
| `skillsTestingService` | `/training/skills-testing` | Templates, tests, completion, deletion, practice mode |
| `recertificationService` | `/training/recertification` | Pathways, renewal tasks |
| `competencyService` | `/training/competency` | Competency matrices, member competencies |
| `instructorService` | `/training/instructors` | Qualifications, validation, qualified instructor lookup |
| `effectivenessService` | `/training/effectiveness` | Evaluations, course summaries |
| `multiAgencyService` | `/training/multi-agency` | Joint session CRUD |
| `xapiService` | `/training/xapi` | Statement delivery, batch processing |
| `reportExportService` | `/training/reports` | Report export, compliance forecast |
| `documentService` | `/training/records/{id}` | Record attachments |
| `complianceOfficerService` | `/compliance` | ISO readiness, attestations, annual report, record completeness |

---

## Frontend State Management

### Zustand Store: `useSkillsTestingStore`

**File:** `frontend/src/stores/skillsTestingStore.ts`

| State | Type | Description |
|-------|------|-------------|
| `templates` | `SkillTemplateListItem[]` | All templates for the org |
| `currentTemplate` | `SkillTemplate \| null` | Currently viewed/edited template |
| `tests` | `SkillTestListItem[]` | All tests for the org |
| `currentTest` | `SkillTest \| null` | Currently active test session |
| `activeTestTimer` | `number` | Timer seconds for active test |
| `activeTestRunning` | `boolean` | Whether timer is running |
| `activeSectionIndex` | `number` | Current section in active test |
| `summary` | `SkillTestingSummary \| null` | Department statistics |

**26 actions** covering template/test CRUD, scoring, timer management, and summary loading.

---

## Permissions

| Permission | Scope |
|------------|-------|
| `training.view` | View training records, courses, programs (own data) |
| `training.manage` | Full training admin: requirements, sessions, submissions review, compliance, skills templates, module config |
| `training.evaluate` | Evaluate training (examiner role) |
| `training.view_all` | View all members' training data |

---

## Related Documentation

- **[Skills Testing Training Guide](../docs/training/09-skills-testing.md)** — Skills testing user guide with realistic NREMT example
- **[Skills Testing Feature Spec](../docs/SKILLS_TESTING_FEATURE.md)** — Full requirements and data model
- **[Training User Guide](../docs/training/02-training.md)** — End-user training guide
- **[Training Compliance Calculations](../docs/training-compliance-calculations.md)** — Formula details and edge cases
- **[Training Waivers & LOA](../backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system documentation
- **[Training Programs](../docs/TRAINING_PROGRAMS.md)** — Comprehensive training programs guide

---

**See also:** [Compliance Module](Module-Compliance) | [Scheduling Module](Module-Scheduling)
