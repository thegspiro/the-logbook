# Training Module

The Training module tracks courses, certifications, training requirements, program enrollments, external training integrations, and compliance reporting.

---

## Key Features

- **Training Requirements** — Hours, courses, certifications, shifts, calls, skills evaluations, checklists, and knowledge tests with annual/quarterly/monthly/rolling frequencies. Requirements can target specific member categories (Active, Administrative, Probationary, Life, Retired, Honorary) or apply to all members. *(2026-07-08)* The create form collects the matching quantity field per type and blocks requirements that would apply to nobody
- **Requirement Templates** — *(2026-07-08)* Ten built-in templates for common standards (NFPA 1001/1500, NREMT recertification, CPR/BLS, OSHA hazmat/bloodborne pathogens/respiratory protection, HIPAA awareness, NIMS/ICS courses, new-member onboarding checklist). Selecting a template pre-fills the create form for review; standards-based templates carry source attribution with the standard or CFR citation as registry code
- **Training Programs** — Structured multi-phase curricula (Flexible, Sequential, Phase-based) with milestone tracking
- **Pipeline Recert Cycle** — *(2026-07-15)* Training pipelines can reset an enrolled member's accumulated progress for a new certification cycle. Officers reset a single requirement or a whole enrollment manually; a pipeline can also carry a stored recurring deadline (cycle length in months plus an optional fixed anchor date, e.g. NREMT's March 30) that auto-resets each enrollment when it passes — applied lazily on progress load and via a daily 5 AM scheduled sweep (`recert_resets`, also exposed as the `recert/run-due` endpoint)
- **Self-Service Withdrawal** — *(2026-07-16)* A member can leave a program from their progression view (e.g. after downgrading from Paramedic to EMT); officers can withdraw anyone. Soft withdrawal keeps the record but removes it from the active dashboard and its warnings, and the member can be re-enrolled later
- **Session Certification Eligibility** — *(2026-07-16)* A training session has a "Counts toward certification requirements" toggle (on by default). When off, attendance still records the member's hours (general credit) but does not feed the linked pipeline/certificate requirements, so hours a certifying body (NFPA/NREMT) wouldn't accept don't inflate a member's certificate
- **Self-Reported Training** — Members submit training records for officer review and approval
- **Shift Completion Reports** — Officers file post-shift reports that auto-credit hours/shifts/calls toward program requirements
- **Compliance Matrix** — Grid view of all members vs. all active requirements (green/yellow/red)
- **Competency Matrix** — Department readiness heat-map with color-coded proficiency levels
- **Expiring Certifications** — Tiered alerts at 90/60/30/7 days with escalation for expired certs
- **Compliance Summary** — Per-member green/yellow/red compliance card on profiles
- **Training Waivers** — Leave of Absence auto-linking, waiver management, proportional requirement adjustment. Supports permanent waivers (no end date), New Member waiver type, and multi-select "Applies To" (Training + Meetings + Shifts can be combined)
- **Bulk Record Creation** — Up to 500 records per request with duplicate detection (same member + course name + completion date within ±1 day)
- **Rank & Station Snapshots** — `rank_at_completion` and `station_at_completion` captured on every record
- **External Integrations** — Connect external training providers (Vector Solutions, Target Solutions, Lexipol, iAmResponding, Custom API) with category and user mapping. *(2026-04-11)* Vector Solutions integration now includes upfront category catalog fetch, credit hours preservation, and improved type mapping with auto-sync
- **Historical Import** — CSV import with preview and validation
- **Registry Integration** — NFPA Standards, NREMT Certifications, Pro Board one-click import with source URL citations and last-updated timestamps. *(2026-04-11)* NREMT NCCR hour distributions corrected to match official requirements; "Cardiovascular" renamed to "Cardiology" per NREMT terminology
- **National Registry Standard Linkage** — *(2026-04-11)* Training categories can be linked to NREMT NCCR codes via the `registry_code` column, enabling automatic compliance tracking against national continued competency requirements
- **Registry Generator Tool** — Standalone CLI tool (`scripts/generate_registry.py`) for generating registries from standards bodies, with `--list` flag to show available registries
- **Source Tracking on Imports** — Imported requirements include `source`, `source_url`, and `last_updated` fields for traceability
- **Training Record Attachments** — Upload certificates, transcripts, and completion letters to training records. *(2026-05-29)* Files are now really stored (the endpoint was previously a stub): multipart upload ≤25MB, MIME validated by magic bytes (PDF/JPEG/PNG/GIF/WEBP/DOC/DOCX), stored under `/app/uploads/training_attachments/{org_id}/{uuid}{ext}` with metadata in the `TrainingRecord.attachments` JSON column; server file paths are never returned. Access is gated to the record owner or `training.manage`
- **Member Self-Export** — *(2026-05-29)* Members can export their own training history as CSV or PDF via `GET /training/module-config/my-training/export`, gated by the org `allow_member_report_export` setting (403 when disabled). Omitting `start_date` returns the member's entire lifetime history
- **Officer Member-Record Exports** — *(2026-05-29)* `POST /training/reports/export` (permission `training.manage`) gained `member_records` (bulk export of all active members), `hours_summary`, and `certification` CSV report types. Unknown report types now return 400 instead of silently falling through to a compliance report; bulk PDFs are merged with `pypdf` (empty result → placeholder page)
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
- **Training Program Export/Import** — *(2026-04-11)* Export training programs (including phases, requirements, milestones) as shareable JSON packages for cross-department sharing. Import validates structure and auto-creates missing courses/requirements
- **Manual Shift Report Page** — *(2026-04-11)* Standalone page at `/training/manual-shift-report` for departments without the Scheduling module. Officers manually enter shift date, start/end times, apparatus, crew members, and trainee evaluations. Supports apparatus-specific skill/task auto-population
- **Manual Entry Admin Config** — *(2026-04-11)* `ManualEntrySettingsPanel` on the Training Admin page controls manual entry availability, allowed apparatus types, default start times, and default shift duration
- **Category Tracking Fixes** — *(2026-04-11)* Training record creation now properly captures and persists training category through the event/session pipeline, ensuring accurate NCCR and compliance matrix calculations

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
| `/training/my-progress/:enrollmentId` | My Program Progress (read-only student view) | Authenticated |
| `/training/admin` | Training Admin Hub | `training.manage` |
| `/training/skills-testing` | Skills Testing Hub | Authenticated |
| `/training/skills-testing/templates/new` | Template Builder (new) | `training.manage` |
| `/training/skills-testing/templates/:id` | Template Builder (view) | `training.manage` |
| `/training/skills-testing/templates/:id/edit` | Template Builder (edit) | `training.manage` |
| `/training/skills-testing/test/new` | Start Skill Test | Authenticated |
| `/training/skills-testing/test/:testId` | Active Skill Test | Authenticated |
| `/training/skills-testing/test/:testId/active` | Active Skill Test (alias) | Authenticated |
| `/training/manual-shift-report` | Manual Shift Report | `training.manage` |
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
POST   /api/v1/training/programs/programs/build            # Build program + phases + requirements + milestones atomically (wizard) (2026-07-14)
GET    /api/v1/training/programs/programs/{id}/enrollments # List enrolled members with name + progress (Enrollments tab) (2026-07-14)
GET    /api/v1/training/programs/programs/{id}/phases      # Get program phases
POST   /api/v1/training/programs/programs/{id}/phases      # Create phase
GET    /api/v1/training/programs/programs/{id}/requirements # Get program requirements
POST   /api/v1/training/programs/programs/{id}/requirements # Add requirement to program
POST   /api/v1/training/programs/programs/{id}/milestones  # Create milestone
POST   /api/v1/training/programs/enrollments               # Enroll member
GET    /api/v1/training/programs/enrollments/me            # My enrollments
GET    /api/v1/training/programs/enrollments/user/{user_id} # User enrollments
GET    /api/v1/training/programs/enrollments/{id}          # Get enrollment detail (member-readable own; officers need view_all/manage)
POST   /api/v1/training/programs/enrollments/{id}/advance-phase  # Officer advances member to next phase (force= override) (2026-07-14)
PATCH  /api/v1/training/programs/progress/{id}             # Update progress (log value, mark complete/in-progress/reopen, verify, record test score)
POST   /api/v1/training/programs/progress/{id}/reset       # Reset one requirement's progress for a new recert cycle (2026-07-15)
POST   /api/v1/training/programs/enrollments/{id}/reset    # Reset a member's whole enrollment for a new recert cycle (2026-07-15)
POST   /api/v1/training/programs/enrollments/{id}/withdraw # Withdraw from a program (self or officer; soft) (2026-07-16)
POST   /api/v1/training/programs/recert/run-due            # Auto-reset every enrollment past its stored recert deadline (scheduled sweep) (2026-07-15)
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
GET    /api/v1/training/external/providers/{id}/categories   # Fetch provider category catalog (2026-04-11)
```

### Training Program Export/Import *(2026-04-11)*

```
POST   /api/v1/training/programs/programs/{id}/export        # Export program as shareable JSON
POST   /api/v1/training/programs/import                      # Import program from JSON package
```

### Shift Completion Reports

```
POST   /api/v1/training/shift-reports                      # Submit shift report
GET    /api/v1/training/shift-reports/my-reports            # My reports (trainee)
GET    /api/v1/training/shift-reports/my-stats              # My aggregate stats (trainee)
GET    /api/v1/training/shift-reports/by-officer            # Reports filed by current officer
GET    /api/v1/training/shift-reports/all                   # All reports (filterable, training.manage)
GET    /api/v1/training/shift-reports/officer-analytics     # Org-wide shift report analytics (training.manage)
GET    /api/v1/training/shift-reports/trainee/{user_id}     # Reports for specific trainee (training.manage)
GET    /api/v1/training/shift-reports/trainee/{user_id}/stats  # Trainee aggregate stats (training.manage)
GET    /api/v1/training/shift-reports/pending-review        # Reports awaiting review (training.manage)
GET    /api/v1/training/shift-reports/flagged               # Flagged reports for follow-up (training.manage)
GET    /api/v1/training/shift-reports/drafts                # Auto-created draft reports (training.manage)
POST   /api/v1/training/shift-reports/drafts/submit-all    # Submit all drafts at once (training.manage)
GET    /api/v1/training/shift-reports/{id}                  # Get report detail (auth: trainee, officer, or training.manage)
PUT    /api/v1/training/shift-reports/{id}                  # Update draft report (training.manage)
POST   /api/v1/training/shift-reports/{id}/acknowledge     # Trainee acknowledges report
POST   /api/v1/training/shift-reports/{id}/review          # Review/approve/flag report (training.manage)
POST   /api/v1/training/shift-reports/batch-review         # Batch approve/flag up to 100 reports (training.manage)
GET    /api/v1/training/shift-preview/{shift_id}/{trainee_id}  # Preview auto-populated shift data (training.manage)
```

### Module Configuration

```
GET    /api/v1/training/module-config/config               # Get module config
PUT    /api/v1/training/module-config/config               # Update module config
GET    /api/v1/training/module-config/visibility           # Get member visibility settings
GET    /api/v1/training/module-config/my-training          # Get my training summary config
GET    /api/v1/training/module-config/my-training/export   # Export my own training history (CSV/PDF; gated by allow_member_report_export) (2026-05-29)
GET    /api/v1/training/module-config/skill-names          # Get active SkillEvaluation names for skill linkage
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
GET    /api/v1/training/records/{id}/attachments                       # List attachments (metadata only, no file paths)
POST   /api/v1/training/records/{id}/attachments                       # Upload attachment (multipart, ≤25MB, magic-byte MIME) (2026-05-29)
GET    /api/v1/training/records/{id}/attachments/{index}/download       # Download a stored attachment by index (2026-05-29)
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
| `training_categories` | TrainingCategory | Course categories (EMS, Fire, Hazmat, etc.) with custom colors and optional `registry_code` for NREMT NCCR linkage *(2026-04-11)* |
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
| `external_training_imports` | ExternalTrainingImport | Individual import records with status and `credit_hours` for CE credit preservation *(2026-04-11)* |
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
| Events | Training | RSVP / self-check-in to a session in a phase ahead of the member's current phase → soft override warning | Pipeline phase gate |
| Training Sessions | Training Pipelines | Approved session advances its linked requirement (or the program's requirements in the session's category) | `training_session.program_id` / `requirement_id` / `category_id` |
| Skills Testing | Training Pipelines | Passing a skills test linked to a requirement completes that pipeline requirement | Requirement linkage |
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
Officer enrolls member → POST /training/programs/enrollments (searchable picker)
  → RequirementProgress records created for each program requirement
  → Status: active
Member progresses (any of):
  → Officer logs hours/shifts/calls/courses, or marks a requirement
    complete / in progress / reopened / verified (PATCH .../progress/{id})
  → Shift report submitted (shifts/calls/hours/skills)
  → Training session approved (advances linked requirement, or the program's
    requirements in the session's category)
  → Skills test passed against a linked requirement
  → Knowledge-test score recorded by an officer
Each update recalculates overall % (average of required items) and
  auto-advances any completed phases (unless phase requires officer approval)
All required items met → Status: completed
  (falls back to active if progress later drops below 100%)
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

## Shift Report Form Customization (2026-04-04)

### Report Form Section Toggles

Seven new `form_show_*` boolean columns on `training_module_configs` control which optional sections appear on the shift completion report **creation form**. These are separate from the existing `show_*` columns, which control what **trainees** see after submission.

| Toggle | Default | Controls |
|--------|---------|----------|
| `form_show_performance_rating` | `true` | Performance rating stars/scale |
| `form_show_areas_of_strength` | `true` | Strengths text field |
| `form_show_areas_for_improvement` | `true` | Improvement areas text field |
| `form_show_officer_narrative` | `true` | Free-form officer assessment |
| `form_show_skills_observed` | `true` | Structured skills checklist |
| `form_show_tasks_performed` | `true` | Structured tasks list |
| `form_show_call_types` | `true` | Call type selection |

### Per-Apparatus-Type Skills and Tasks

Two new JSON columns map apparatus types to specific skills and tasks:

- **`apparatus_type_skills`** — Maps apparatus types to skill lists (e.g., `{"engine": ["Pump operations", "Hose deployment"]}`)
- **`apparatus_type_tasks`** — Maps apparatus types to task lists (e.g., `{"engine": ["Pump test", "Hose load inventory"]}`)

When filing a report linked to a shift with an assigned apparatus, the form auto-populates the skills and tasks checklist from the apparatus type mapping. Falls back to org-wide defaults (`shift_review_default_skills` / `shift_review_default_tasks`) when no type-specific mapping exists.

Managed via the **ShiftReportsSettingsPanel** in Scheduling Settings, with a per-type accordion UI for editing.

### Rating Scale Customization

| Setting | Default | Description |
|---------|---------|-------------|
| `rating_label` | "Performance Rating" | Custom label for the rating input |
| `rating_scale_type` | "stars" | "stars" (star icons) or "descriptive" (labeled buttons) |
| `rating_scale_labels` | `null` | Custom labels per level (e.g., `{1: "Needs Improvement", 5: "Exceptional"}`) |

### Save as Draft

The `save_as_draft` flag on `ShiftCompletionReportCreate` allows officers to save incomplete reports. Drafts:
- Do not trigger training pipeline progress
- Appear in the officer's **Drafts** view in ShiftReportsTab
- Transition to `approved` or `pending_review` on final submission, triggering deferred pipeline progress

### Auto-Filter Trainee List

When a shift report is linked to a shift, the trainee dropdown filters to shift members only. Ad-hoc reports show the full member list.

### Seed Defaults

New organizations are seeded with sample skills, tasks, and apparatus-type mappings via a seed migration. Sample data includes fire service skills by apparatus type (engine, ladder, rescue, ambulance, tanker, brush, hazmat, tower).

### New Database Columns (2026-04-04)

| Table | Column | Type | Description |
|-------|--------|------|-------------|
| `training_module_configs` | `form_show_performance_rating` | Boolean | Toggle rating on report form |
| `training_module_configs` | `form_show_areas_of_strength` | Boolean | Toggle strengths on report form |
| `training_module_configs` | `form_show_areas_for_improvement` | Boolean | Toggle improvement on report form |
| `training_module_configs` | `form_show_officer_narrative` | Boolean | Toggle narrative on report form |
| `training_module_configs` | `form_show_skills_observed` | Boolean | Toggle skills on report form |
| `training_module_configs` | `form_show_tasks_performed` | Boolean | Toggle tasks on report form |
| `training_module_configs` | `form_show_call_types` | Boolean | Toggle call types on report form |
| `training_module_configs` | `apparatus_type_skills` | JSON | Per-type skill lists |
| `training_module_configs` | `apparatus_type_tasks` | JSON | Per-type task lists |
| `training_module_configs` | `rating_label` | String | Custom rating label |
| `training_module_configs` | `rating_scale_type` | String | Rating display type |
| `training_module_configs` | `rating_scale_labels` | JSON | Custom labels per level |
| `requirement_progress` | `started_at` | DateTime(tz) | When requirement transitioned to IN_PROGRESS |

### Training Admin Enhancements (2026-04-04)

- Create modals wired up on the Enhancements tab for recertification pathways, instructor qualifications, effectiveness evaluations, and multi-agency sessions
- Effectiveness scoring section connected to the evaluation API

### Edge Cases (2026-04-04)

| Scenario | Behavior |
|----------|----------|
| All form sections toggled off | Core fields (trainee, date, hours, calls) remain; form submittable |
| Apparatus type with no mapped skills | Falls back to org-wide defaults; empty if none configured |
| Draft saved with missing fields | Validation deferred until final submission |
| Trainee list when linked to a shift | Auto-filters to shift members; ad-hoc reports show full list |
| Descriptive rating with no labels | Falls back to numeric display (1-5) |
| Report shift_date vs linked shift date mismatch | Returns validation error |
| Trainee with shift assignment but no attendance | Allows manual hour entry; auto-populate returns zeros |

## Skill Scoring, Batch Review & Security Hardening (2026-04-07)

### 1-5 Skill Scoring on Shift Completion Reports

Officers can now assign a 1-5 numeric score to each observed skill when filing shift completion reports. Scores are stored in the `SkillObservation.score` field and flow through to `SkillCheckoff` records, feeding the competency score history.

**Score labels:**

| Score | Label |
|-------|-------|
| 1 | Needs work |
| 2 | Developing |
| 3 | Competent |
| 4 | Proficient |
| 5 | Excellent |

Labels appear as tooltips on score buttons and inline text in display views. Buttons use a consistent violet color theme across both `ShiftReportPage` and `ShiftReportsTab`.

### Batch Review

Officers with `training.manage` can select multiple reports in the pending-review or flagged views and batch approve or flag them in a single action via `POST /training/shift-reports/batch-review`. Up to 100 reports per batch. Returns `{reviewed, failed}` counts.

### Flagged Reports View

A new "Flagged" tab in `ShiftReportsTab` surfaces reports flagged by reviewers. Flagged reports can be re-reviewed and approved, allowing recovery. Backed by `GET /training/shift-reports/flagged`.

### Trainee and Officer Names on Reports

`ShiftCompletionReport` model now has `trainee` and `officer` relationships to `User`. Response schema includes `trainee_name` and `officer_name`. Report cards show "Trainee Name — Date" in headers and officer name in footers.

### Report Content in Review Modal

Review modal now renders full report content (hours, calls, rating, strengths, areas for improvement, narrative, skills with scores, tasks) so reviewers have complete context when approving or flagging.

### Skill Linkage Status in Apparatus Settings

`ShiftReportsSettingsPanel` shows color-coded tags for each apparatus-type skill:
- **Green**: Skill matches a `SkillEvaluation` record → tracks competency, creates checkoffs, progresses pipeline requirements
- **Amber**: No matching `SkillEvaluation` → skill observed on reports but not formally tracked

Powered by `GET /training/module-config/skill-names`.

### Authorization Fix on `GET /shift-reports/{report_id}`

Previously any authenticated user in the same org could read any report by ID, exposing sensitive performance data. Now enforces that the requester is the trainee, the filing officer, or has `training.manage` permission. Trainees see visibility-filtered data; `reviewer_notes` are always stripped for trainees.

### Audit Logging for Shift Reports

All shift completion report operations now log audit events: `shift_report_created`, `shift_report_updated`, `shift_report_reviewed`, `shift_report_acknowledged`, `shift_reports_bulk_submitted`. Each captures the acting user, report ID, and relevant metadata.

### Bug Fixes (2026-04-07)

| Issue | Fix |
|-------|-----|
| Decimal TypeError in weekly/monthly calendar | MySQL `SUM()` returns `Decimal`; wrapped in `float()` before division |
| `??` → `||` for optional form fields | 35 instances in prospective-members and apparatus modules |
| `ShiftCompletionReportCreate.shift_date` type mismatch | Changed from optional to required in TypeScript to match backend |
| Unused `LogOut` import in `MyShiftsTab` | Removed (F401) |
| `tsconfig.json` TS5101 deprecation error | Added `ignoreDeprecations: "5.0"` for `baseUrl` |
| `form.shift_date` fallback missing | Added `?? ''` fallback for `noUncheckedIndexedAccess` |
| Trainee summary table numeric alignment | Center-aligned headers and data columns |

### Edge Cases (2026-04-07)

| Scenario | Behavior |
|----------|----------|
| Skill score outside 1-5 range | Rejected by Pydantic `Field(ge=1, le=5)` with 422 |
| Batch review with >100 report IDs | Rejected by `max_length=100` constraint |
| Batch review with mix of valid/invalid IDs | Valid reports reviewed; failed count returned |
| Flagged report re-reviewed to approved | Triggers deferred pipeline progress if applicable |
| Non-trainee/non-officer accessing report by ID | 403 unless user has `training.manage` |
| Trainee accessing own report | Sees visibility-filtered data; `reviewer_notes` stripped |
| No SkillEvaluation records in org | All skills show amber "unlinked" tags |

---

## Related Documentation

- **[Skills Testing Training Guide](../docs/training/09-skills-testing.md)** — Skills testing user guide with realistic NREMT example
- **[Skills Testing Feature Spec](../docs/SKILLS_TESTING_FEATURE.md)** — Full requirements and data model
- **[Training User Guide](../docs/training/02-training.md)** — End-user training guide
- **[Training Compliance Calculations](../docs/training-compliance-calculations.md)** — Formula details and edge cases
- **[Training Waivers & LOA](../backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system documentation
- **[Training Programs](../docs/TRAINING_PROGRAMS.md)** — Comprehensive training programs guide

---

---

## Training Record Categories & EVOC Certification (2026-03-24)

- **Training record categories**: Records now include a `category` field (Fire, EMS, Hazmat, Rescue, etc.) aligned with state reporting requirements
- **Virginia NCCR standards**: Virginia National Continued Competency Requirements (NCCR) recertification standards added with required categories and hour minimums per category
- **EVOC certification levels**: EVOC levels (Basic, Intermediate, Advanced) tracked per member, validated for driver/operator positions, and integrated across training, apparatus, and scheduling modules
- **Schema alignment**: Training record schemas unified across backend and frontend — missing fields added to bulk entry and individual record forms

### Data Model Changes

| Field | Type | Description |
|-------|------|-------------|
| `training_records.category` | String (nullable) | Training category classification |
| `users.evoc_level` | String (nullable) | EVOC certification level |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Record with no category | Excluded from category-based compliance reports |
| EVOC level not set for member | Can be assigned to driver position but warning shown |
| Virginia NCCR with incomplete categories | Flagged in compliance dashboard |

---

## Print Support for Training Records, Programs & Compliance (2026-04-08)

Three new print-formatted pages allow officers and administrators to generate paper copies of training data for audits, regulatory filings, reviews, and member records.

### Member Training History Print Page

**Route:** `/training/print/member`

Renders a paper-formatted member training record including:

- Member name, rank, station, and membership dates
- Training hours summary (current period and all-time)
- Certification status and expiration dates
- Compliance indicators (green/yellow/red) for all active requirements
- Complete chronological list of training records with course, date, hours, and category

> **[SCREENSHOT NEEDED]:** _Screenshot of the Member Training Print Page showing the letter-size layout with member info header, hours summary cards, certification table, compliance status badges, and the training records table._

### Training Program Print Page

**Route:** `/training/print/program`

Renders a training program detail for paper:

- Program name, description, type (Flexible/Sequential/Phase-based), and status
- Phase breakdown with requirements listed under each phase
- Milestones with completion criteria
- Enrollment roster with per-member progress percentages

> **[SCREENSHOT NEEDED]:** _Screenshot of the Program Print Page showing the program header, phase accordion expanded with requirements and progress bars, milestone checkpoints, and enrollment table._

### Compliance Matrix Print Page

**Route:** `/training/print/compliance`  
**Permission:** `training.manage`

Renders the department-wide compliance matrix (all members × all requirements) as a printable grid:

- Members listed as rows, requirements as columns
- Color-coded cells (green/yellow/red) with percentage values
- Optimized for letter-size landscape printing with repeat headers across pages
- Designed for annual reviews, regulatory audits, and compliance filing

> **[SCREENSHOT NEEDED]:** _Screenshot of the Compliance Print Page showing the grid with member names on the left, requirement names across the top, and colored cells with percentages. Show the landscape orientation and page break indicators._

### Print Buttons on Source Pages

Each source page now includes a **Print** button that navigates to the corresponding print page:

| Source Page | Print Button Location | Target Print Page |
|-------------|----------------------|-------------------|
| `ComplianceMatrixTab` | Toolbar above the matrix | `/training/print/compliance` |
| `MemberTrainingHistoryPage` | Page header actions | `/training/print/member` |
| `PipelineDetailPage` | Page header actions | `/training/print/program` |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Member with no training records | Print page shows empty table with "No records found" message |
| Program with no enrollments | Enrollment section shows "No members enrolled" |
| Compliance matrix with 100+ members | Paginated across multiple printed pages with repeated column headers |
| Browser blocks auto-print dialog | Page remains visible for manual Ctrl+P |
| Print page for member on leave | Leave period shown with pro-rated requirement adjustments |

---

## Recent Changes (2026-05-29)

### Session Finalize & Sign-Off

- **`require_completion_confirmation` now gates finalize sign-off.** When
  `false` (the default), finalizing a session **auto-approves and completes**
  the training records immediately with no officer email. When `true`, records
  are left pending and the training officers are notified for confirmation
- **Finalize promotes the existing in-progress check-in record** instead of
  creating a duplicate, so a member's check-in becomes their completed record
- **Dead `TrainingSession.approval_required` column removed** (migration
  `20260502_0004`). Any earlier docs implying finalize "always requires
  approval" or referencing `approval_required` are stale — sign-off is governed
  **solely** by `require_completion_confirmation`

### Member & Officer Exports

- **Member self-export** of own training history (CSV/PDF) via
  `GET /training/module-config/my-training/export`, gated by the org
  `allow_member_report_export` setting (403 when disabled); lifetime history when
  `start_date` is omitted
- **Officer exports** (`POST /training/reports/export`, `training.manage`) gained
  `member_records` (bulk all active members), `hours_summary`, and
  `certification` CSV types. Unknown `report_type` now returns 400 (no silent
  compliance fallthrough). PDF export is available only for `individual`,
  `member_records`, and `compliance`; bulk PDFs are merged with `pypdf` (empty →
  placeholder page)
- **Mislabeled officer reports fixed** so per-member exports reflect the correct
  member's records

### Real Attachment Storage

- `POST /training/records/{id}/attachments` now stores the uploaded file
  (≤25MB, magic-byte MIME PDF/JPEG/PNG/GIF/WEBP/DOC/DOCX) under
  `/app/uploads/training_attachments/{org_id}/{uuid}{ext}`, with metadata in the
  `TrainingRecord.attachments` JSON column. `GET .../attachments/{index}/download`
  streams a stored file. Access is the record owner or `training.manage`; server
  file paths are never returned

### Internal

- **Skills-test scoring extracted** to a pure function
  `skills_testing_service.calculate_test_result` for direct unit testing
- **Compliance admin tabs wired up** on the Enhancements/compliance UI

### Data Model Changes (2026-05-29)

| Table | Column | Type | Migration | Description |
|-------|--------|------|-----------|-------------|
| `compliance_configs` | `include_current_month` | Boolean (NOT NULL, server_default `1`) | `20260503_0001` | Org default: count the in-progress month toward compliance |
| `training_requirements` | `include_current_month` | Boolean (nullable) | `20260503_0002` | Per-requirement override; `NULL` inherits the org default |
| `training_sessions` | `approval_required` | — (dropped) | `20260502_0004` | Removed dead column; finalize is gated by `require_completion_confirmation` |

---

## Requirement Templates & Per-Type Create Form (2026-07-08)

### Requirement Templates Rework

- **Template selection now pre-fills the create form** instead of saving
  immediately, so officers confirm hours, due dates, and assignment before a
  requirement starts counting against members
- **Broken targeting fixed** — three of the four previous templates set
  `applies_to_all: false` with no member targeting, which the compliance filter
  treats as applying to nobody; requirements created from them never appeared
  in any member's compliance view
- **Template data corrected** — NREMT EMT recertification is 40 hours per
  2-year cycle (was 24 hours); CPR/BLS is a 2-year certification cycle (was
  12 months)
- **Template list expanded to ten**: NFPA 1001 (36 hrs annual), NFPA 1500
  (8 hrs annual), NREMT EMT recert (40 hrs / 24-month rolling), CPR/BLS
  (24-month rolling), Hazmat Operations refresher (OSHA 29 CFR 1910.120),
  Bloodborne Pathogens refresher (OSHA 29 CFR 1910.1030), HIPAA Privacy &
  Security awareness (45 CFR 164.530(b)), SCBA Fit Test & Respiratory
  Protection checklist (OSHA 29 CFR 1910.134), NIMS/ICS initial certification
  courses (ICS-100/200, IS-700/800), and a New Member Orientation checklist
  (probationary members)
- **Registry attribution on templates** — standards-based templates carry
  `source: national` with the registry name (NFPA, NREMT, OSHA, HIPAA, FEMA)
  and the standard or CFR citation as `registry_code`, so requirement cards
  show a source badge and (for loaded registries) a citation link

### Create/Edit Form

- **Per-type quantity fields** — the form now collects `required_courses`,
  `required_shifts`, `required_calls`, `checklist_items`, and
  `passing_score`/`max_attempts` for the matching requirement types, with
  client-side validation mirroring the backend `TrainingRequirementCreate`
  validator (previously only hours were collected, so other types failed with
  a generic 422)
- **`knowledge_test` type added to the UI** — supported by the backend since
  migration `20260218_0100` but missing from the type dropdown
- **Applies-to-nobody guard** — saving is blocked when "Applies to all
  members" is unchecked and no member category is selected (unless the record
  targets by role/position set elsewhere)
- **Duplicate copies all fields** — duplicating a requirement previously
  dropped shifts/calls/skills/checklist/passing-score/registry fields, which
  either failed validation or silently lost data

### Known Limitation

- Registry imports (Training Programs page) set `required_positions`, but the
  compliance filter only matches `applies_to_all`, membership types, and
  roles — position-targeted imported requirements currently apply to nobody

---

## Training Pipelines: Building, Progress & Phase Gating (2026-07-14)

Training programs run as **pipelines**: a program is broken into ordered
**phases**, each phase holds **requirements** (hours, courses, shifts, calls,
skills evaluation, certification, checklist, or knowledge test) and optional
**milestones**. Members are **enrolled**, and their progress is tracked from
enrollment through completion. This release makes the full pipeline reliable
end-to-end — building, enrolling, tracking, and phase gating.

### Building & Enrolling

- **Atomic wizard build** — the create-pipeline wizard now saves the whole
  program (phases, requirements, milestones) in one request via
  `POST /training/programs/programs/build`. A failure part-way rolls back, so
  a half-built program is never left behind. The wizard also now correctly
  persists the **program code**, the phase **"require officer approval to
  advance"** flag, and the **version** — all three were previously dropped.
- **Enrollments tab** — the program detail page lists enrolled members by
  **name** with their progress percentage (`GET
  /training/programs/programs/{id}/enrollments`, requires `training.view_all`
  or `training.manage`).
- **Searchable member picker** — enroll a member by searching for them by
  name instead of pasting a user ID.
- **Guarded bulk enroll** — bulk enrollment now checks prerequisite and
  concurrent-enrollment rules and blocks members who fail them, returning a
  per-member error list alongside the successful enrollments.

### Tracking Progress

An officer opens an enrolled member and works one requirement at a time
(`PATCH /training/programs/progress/{id}`):

- **Log numeric progress** — hours, shifts, calls, or courses accrue toward the
  requirement's target (waiver-adjusted where applicable).
- **Set status** — mark a requirement **complete**, **in progress**, **reopen**
  it, or **verify** it.
- **Completing any requirement counts fully.** Marking a requirement
  completed/verified/waived sets it to 100%, including non-numeric types
  (**checklist, skills evaluation, certification, knowledge test**) that don't
  accrue a numeric value. Previously only hours/shifts/calls ever moved a
  member's overall progress off 0%.
- **Overall %** is the **average of the required items** in the program.

### Phases That Gate

- A **phase is complete** when all of its *required* requirements are at 100%
  (a phase with no required items is trivially complete).
- **Auto-advance** — after any progress update, the member automatically moves
  through each consecutive completed phase.
- **Officer-approval phases stop auto-advance.** A phase flagged **requires
  officer approval** (`requires_manual_advancement`) halts the auto-advance and
  surfaces an **"Advance to next phase"** button for officers
  (`POST /training/programs/enrollments/{id}/advance-phase`; `force=true`
  overrides an incomplete phase).
- **Notifications** — on advancement, the member is notified, and their
  **mentor** (if the enrollment has one) is notified too.
- **Reopen on regression** — a completed enrollment that later drops below 100%
  (e.g. a new required requirement is added, or an over-count is corrected
  downward) is automatically set back to **active** and its completion cleared.

### Things That Automatically Update Pipeline Progress

Beyond an officer editing progress directly, pipeline progress advances from:

- **Shift completion reports** — an approved (non-draft) report credits
  shifts / calls / hours / observed skills to matching requirements.
- **Approved training sessions** — approving a session linked to a program
  advances the session's **linked requirement**; if the session is linked to a
  program **and a category** (with no explicit requirement), it advances all of
  that program's requirements in that category. *(Session attendance previously
  did not move pipeline progress — now fixed.)*
- **Passing a linked skills test** — passing a skills test that is linked to a
  requirement completes that requirement (see **Skills Testing** above).

### Knowledge Tests (officer-entered scores)

For a `knowledge_test` requirement, an officer records either a **pass/fail** or
a **score percentage** on the progress record:

- Pass/fail is derived from the requirement's **passing score** (default
  **70%**).
- A **pass** completes the requirement (which then rolls up and can advance the
  phase); a fail is recorded and leaves the requirement **in progress**.
- The requirement's **max attempts** are enforced — once all attempts are used
  and the requirement isn't already satisfied, further scores are rejected.
- **Attempt history** (each score, pass/fail, timestamp, and recording officer)
  and the latest score are kept in the progress record's notes.

> This is deliberately lightweight — officer-entered scores only. A full online
> test-taking engine is future work.

### Student Progress View

From **My Training**, a member can open **"View full progress"** for an
enrollment to reach a read-only progression page
(`/training/my-progress/:enrollmentId`). It shows:

- **Current phase**, badged **"You are here"**
- **Overall %** and completed / total required items
- **Time remaining** (or days overdue) and a **behind-schedule** indicator
- **Next milestones** with their completion thresholds
- **Every requirement grouped by phase** with its status (not started, in
  progress, completed, verified, waived) and latest test score where relevant

Members may read their own enrollment; officers need `training.view_all` or
`training.manage` to view another member's.

### Attendance Phase Warning

When a member **RSVPs to** or **self-checks-into** a training session that
belongs to a phase **ahead** of their current phase, they get a **soft warning**
and can **proceed anyway** (override) — the check-in retries with the override
flag after confirmation. Officers checking members in are **not** warned; the
gate is a nudge for self-service actions, not a hard block.

---

**See also:** [Compliance Module](Module-Compliance) | [Scheduling Module](Module-Scheduling)
