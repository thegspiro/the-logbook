# Skills Testing Feature — Requirements Specification

## Overview

A digital skills testing module that mirrors NREMT-style psychomotor examinations. The examiner uses a tablet or computer to read prompts, time the exercise, score individual steps, flag issues, and record fail points — replacing paper skill sheets with a structured, auditable digital workflow.

This feature lives within the existing Training module and integrates with Training Requirements (`SKILLS_EVALUATION` type), Training Records, Training Sessions, and the compliance pipeline.

---

## 1. Skill Sheet Templates

Templates are the reusable definitions of a skills test. They are the digital equivalent of a blank NREMT skill sheet (e.g., "Patient Assessment/Management — Trauma").

### 1.1 Template Metadata

| Field | Description |
|---|---|
| **Name** | e.g., "Patient Assessment/Management — Trauma" |
| **Code** | Short identifier, e.g., `NREMT-TRAUMA-ASSESS` |
| **Description** | Purpose and scope of this skill test |
| **Version** | Template versioning (v1, v2, etc.) to track changes over time |
| **Source/Standard** | Origin standard: NREMT, NFPA 1001, state registry, or department-defined |
| **Registry Code** | Links to `TrainingRequirement.registry_code` (e.g., "NREMT", "NFPA 1001") |
| **Certification Level** | EMR, EMT, AEMT, Paramedic, Firefighter I/II, etc. |
| **Category** | Links to existing `TrainingCategory` (EMS, Fire, Hazmat, etc.) |
| **Time Limit** | Optional maximum duration in **minutes** (e.g., 10 for NREMT trauma). Changed from seconds to minutes as of 2026-02-28 for more intuitive configuration |
| **Total Possible Points** | Auto-calculated from step point values |
| **Passing Score** | Minimum points to pass (if no critical criteria are triggered) |
| **Passing Percentage** | Alternative: minimum percentage to pass |
| **Equipment/Materials Required** | List of supplies/equipment needed for the exam station |
| **Scenario Prompt** | Text the examiner reads aloud to the candidate to set up the scenario |
| **Supplemental Prompts** | Keyed prompt-response pairs the examiner can give when the candidate asks or performs specific actions (e.g., "If candidate assesses breathing: 'Breathing is labored at 24/min'") |
| **Active** | Whether this template is currently available for use |

### 1.2 Template Sections

Each template is divided into ordered sections that group related steps. Sections map to the bold-header groups on the NREMT sheet.

| Field | Description |
|---|---|
| **Section Name** | e.g., "Scene Size-Up", "Primary Survey/Resuscitation", "Secondary Assessment" |
| **Sort Order** | Display order within the template |
| **Instructions** | Optional examiner-facing instructions for this section |
| **Integration Note** | Notation like the NREMT's "**" flag indicating steps may be integrated within the flow of another section (e.g., history taking during primary survey) |

### 1.3 Section Steps (Scored Items)

Each section contains individual scored steps. These are the line items on the NREMT sheet.

| Field | Description |
|---|---|
| **Step Description** | What the candidate must do, e.g., "Determines scene/situation safety" |
| **Point Value** | Points awarded if completed correctly (typically 1, but can be higher for complex steps) |
| **Sort Order** | Display order within the section |
| **Required** | Whether this step must be attempted (vs. optional/conditional) |
| **Conditional On** | Optional: step only appears if a prior step had a specific outcome |
| **Examiner Prompt** | Optional prompt text the examiner reads when the candidate reaches this step |
| **Scoring Type** | `binary` (done/not done), `partial` (0 to max points), `scaled` (rubric-based), or `statement` (open-ended text response) |
| **Point Value** | Configurable point value for weighted scoring (default 1). Enables point-based scoring where criteria can carry different weights |
| **Rubric** | For `scaled` scoring: criteria descriptions for each point level |

> **Note on Scoring Types (updated 2026-02-28):**
> - `binary`: Simple pass/fail (done / not done) — most common
> - `partial`: Award 0 to max points with a slider or increment buttons
> - `scaled`: Select from a rubric with predefined score levels
> - `statement`: Open-ended text box for the candidate to describe their response (e.g., "Describe the patient's chief complaint"). Can be marked as required or optional, and scored or informational

### 1.4 Critical Criteria (Auto-Fail Conditions)

Separate from scored steps, these are conditions that result in automatic failure regardless of score. Directly mirrors the "Critical Criteria" section at the bottom of NREMT sheets.

| Field | Description |
|---|---|
| **Description** | e.g., "Failure to initiate or call for transport of the patient within the 10 minute time limit" |
| **Sort Order** | Display order |
| **Category** | Optional grouping: safety, airway, assessment, procedural, timing |

If **any** critical criterion is checked, the overall result is **FAIL** regardless of the point total.

### 1.5 Template Management

- **CRUD operations** for templates, sections, steps, and critical criteria
- **Version control**: When a template is modified after being used in evaluations, a new version is created; historical evaluations reference the version they were administered under
- **Import/export**: Templates can be imported/exported as JSON for sharing between organizations
- **Duplication**: Clone an existing template as a starting point for customization
- **NREMT presets**: Seed data with standard NREMT skill sheets (Trauma Assessment, Medical Assessment, Cardiac Arrest, BVM Ventilation, Spinal Immobilization, Bleeding Control/Shock, Oxygen Administration, Joint Immobilization, etc.)
- **Permissions**: Only training officers/admins can create or modify templates

---

## 2. Skills Test Administration (Examiner Workflow)

This is the real-time interface the examiner uses on a tablet or laptop during the actual skill station.

### 2.1 Test Session Setup

Before the candidate begins:

| Field | Description |
|---|---|
| **Template** | Select which skill sheet to administer |
| **Template Version** | Locked to the current active version at time of administration |
| **Candidate** | Select member from roster (links to `users` table) |
| **Examiner** | Auto-populated from logged-in user; can be overridden |
| **Scenario Number** | Optional scenario variant identifier |
| **Date** | Defaults to today |
| **Training Session** | Optional link to a `TrainingSession` if this is part of a scheduled event |
| **Attempt Number** | Auto-incremented for the candidate on this template |

### 2.2 Timer

- **Start Timer**: Examiner taps to begin when candidate starts
- **Pause Timer**: For interruptions (equipment failure, etc.) with required reason
- **Stop Timer**: When candidate finishes or time expires
- **Time Limit Warning**: Visual/audible alert at configurable thresholds (e.g., 2 minutes remaining, 1 minute remaining)
- **Auto-flag on Expiry**: If a time limit exists and is exceeded, auto-check the relevant critical criterion (e.g., "Failure to complete within time limit")
- **Elapsed Time Display**: Prominent, always-visible countdown or count-up display

### 2.3 Step Scoring Interface

The primary examiner interaction during the test:

- **Section-by-section layout** matching the template structure
- For each step:
  - **Toggle scored/not scored** (tap to award points, tap again to remove)
  - For `partial` scoring: slider or increment buttons (0 to max)
  - For `scaled` scoring: select rubric level
  - **Step-level notes**: Tap to add a text note to any individual step
  - **Flag step**: Mark a step for follow-up or review (different from scoring)
- **Running score**: Live display of current points / total possible points
- **Section subtotals**: Points earned per section vs. possible
- **Critical criteria panel**: Accessible at any time; checkboxes for each fail condition
- **Scroll/swipe navigation** between sections
- **Undo last action**: Reverse the most recent scoring change

### 2.4 Examiner Notes & Flags

- **Overall notes field**: Free-text notes about the candidate's performance
- **Step-level notes**: Attached to individual steps
- **Issue flags**: Categorized flags (safety concern, equipment issue, candidate question, environmental factor)
- **Voice-to-text**: Optional speech-to-text for hands-free note entry (browser API)

### 2.5 Completion & Submission

When the test concludes:

1. **Auto-calculate results**:
   - Total points scored vs. total possible
   - Percentage score
   - Pass/Fail determination based on: (a) score meets passing threshold AND (b) no critical criteria triggered
2. **Result summary screen**:
   - Score breakdown by section
   - List of missed steps
   - Critical criteria triggered (if any)
   - Time taken
   - Examiner notes
3. **Examiner signature**: Digital signature capture or PIN confirmation
4. **Submit**: Locks the evaluation as final; creates/updates the linked `TrainingRecord`
5. **Save as draft**: Allow saving incomplete evaluations to resume later (e.g., if interrupted)

### 2.6 Post-Completion Review (Added 2026-02-28)

After the test is completed and scores are calculated, the examiner sees a **post-completion review screen** before the test is finalized:

- **Section-by-section review**: Each section displayed with all criteria, scores, and any examiner notes
- **Section notes**: Text field per section for the examiner to add feedback specific to that portion of the evaluation
- **Overall notes**: Final comments about the candidate's performance
- **Score summary**: Running total, percentage, pass/fail determination, and critical criteria status
- **Auto-stopped timer**: The clock automatically stops when the test is completed, preventing inflated elapsed times
- **Full detail view**: Completed tests show the complete section-by-section detail (replacing the previous summary-only view)

### 2.7 Practice Mode (Added 2026-02-28)

Tests can be administered in **practice mode** for training purposes without affecting official records:

- **Practice flag**: When creating a test, toggle "Practice Mode" on. Practice tests are clearly badged throughout the UI
- **Non-graded**: Practice test results do not count toward training compliance or certification requirements
- **Post-practice flow**: After completing a practice test, the candidate/examiner can:
  - **Email results**: Send the practice results summary to the candidate via email
  - **Discard results**: Delete the practice test record entirely
  - **Retake**: Start a new test with the same template and candidate
- **Visibility**: Practice tests appear in the test list with a "Practice" badge and can be filtered separately

### 2.8 Test Visibility Controls (Added 2026-02-28)

Training officers can control which test results are visible to candidates:

- **Visibility toggle**: Per-test toggle on the tests list to show/hide results from the candidate
- **Default visibility**: Configurable default (visible or hidden) for new tests
- **Officer-only view**: Tests marked as hidden are visible to training officers but not to the candidate member
- **Bulk visibility**: Officers can toggle visibility for multiple tests at once

### 2.9 Test Record Deletion (Added 2026-02-28)

Training officers with `training.manage` permission can permanently delete test records:

- **Confirmation dialog**: Requires explicit confirmation before deletion
- **Audit trail**: Deletion is logged via `log_audit_event` for accountability
- **Cascade**: Deleting a test removes all associated section results, criteria scores, and notes

---

## 3. Data Model (Conceptual)

These are the new entities needed, designed to integrate with the existing training models.

### 3.1 `SkillSheetTemplate`

The reusable template definition.

```
SkillSheetTemplate
├── id (PK)
├── organization_id (FK → organizations)
├── name
├── code (unique per org)
├── description
├── version (integer, auto-increment per code)
├── source_standard (NREMT, NFPA, state, department)
├── registry_code
├── certification_level
├── category_id (FK → training_categories)
├── time_limit_minutes (nullable)
├── total_possible_points (calculated)
├── passing_score (nullable)
├── passing_percentage (nullable)
├── equipment_required (JSON array)
├── scenario_prompt (text)
├── supplemental_prompts (JSON object)
├── is_current_version (boolean)
├── previous_version_id (FK → self, nullable)
├── active (boolean)
├── created_at, updated_at, created_by
```

### 3.2 `SkillSheetSection`

Ordered groups within a template.

```
SkillSheetSection
├── id (PK)
├── template_id (FK → skill_sheet_templates)
├── name
├── sort_order
├── instructions (nullable)
├── integration_note (nullable)
├── created_at, updated_at
```

### 3.3 `SkillSheetStep`

Individual scored items within a section.

```
SkillSheetStep
├── id (PK)
├── section_id (FK → skill_sheet_sections)
├── description
├── point_value (integer or float)
├── sort_order
├── required (boolean, default true)
├── conditional_on_step_id (FK → self, nullable)
├── examiner_prompt (nullable)
├── scoring_type (enum: binary, partial, scaled)
├── rubric (JSON, nullable — for scaled scoring)
├── created_at, updated_at
```

### 3.4 `SkillSheetCriticalCriterion`

Auto-fail conditions attached to a template.

```
SkillSheetCriticalCriterion
├── id (PK)
├── template_id (FK → skill_sheet_templates)
├── description
├── sort_order
├── category (nullable — safety, airway, assessment, procedural, timing)
├── created_at, updated_at
```

### 3.5 `SkillTestSession`

A single administration of a skill test to a candidate.

```
SkillTestSession
├── id (PK)
├── organization_id (FK → organizations)
├── template_id (FK → skill_sheet_templates)
├── template_version (integer — snapshot)
├── candidate_id (FK → users)
├── examiner_id (FK → users)
├── training_session_id (FK → training_sessions, nullable)
├── training_record_id (FK → training_records, nullable)
├── requirement_id (FK → training_requirements, nullable)
├── scenario_number (string, nullable)
├── attempt_number (integer)
├── status (enum: not_started, in_progress, paused, completed, cancelled, draft)
├── started_at (datetime, nullable)
├── completed_at (datetime, nullable)
├── time_elapsed_seconds (integer)
├── timer_pauses (JSON — array of {paused_at, resumed_at, reason})
├── total_points_scored (float)
├── total_possible_points (float)
├── percentage_score (float)
├── critical_fail (boolean)
├── passed (boolean)
├── overall_notes (text, nullable)
├── examiner_signature (text/blob, nullable)
├── submitted_at (datetime, nullable)
├── created_at, updated_at
```

### 3.6 `SkillTestStepResult`

Per-step scoring results within a test session.

```
SkillTestStepResult
├── id (PK)
├── test_session_id (FK → skill_test_sessions)
├── step_id (FK → skill_sheet_steps)
├── section_id (FK → skill_sheet_sections)
├── points_awarded (float — 0 to step.point_value)
├── scored (boolean)
├── flagged (boolean, default false)
├── flag_reason (string, nullable)
├── notes (text, nullable)
├── scored_at (datetime, nullable)
├── created_at, updated_at
```

### 3.7 `SkillTestCriticalResult`

Per-criterion results within a test session.

```
SkillTestCriticalResult
├── id (PK)
├── test_session_id (FK → skill_test_sessions)
├── criterion_id (FK → skill_sheet_critical_criteria)
├── triggered (boolean, default false)
├── notes (text, nullable)
├── created_at, updated_at
```

---

## 4. Integration with Existing Training Module

### 4.1 Training Requirements

- A `TrainingRequirement` with `requirement_type = SKILLS_EVALUATION` can reference one or more `SkillSheetTemplate` IDs in its `required_skills` JSON field
- When a candidate passes a `SkillTestSession` for a referenced template, the requirement progress is updated automatically
- Compliance dashboards already support the `SKILLS_EVALUATION` type — the new feature provides the actual evaluation mechanism

### 4.2 Training Records

- Upon submission of a completed `SkillTestSession`, a `TrainingRecord` is created (or updated if one already exists for this session):
  - `training_type` = `skills_practice` or `certification` (depending on context)
  - `score` = percentage score
  - `passing_score` = template passing percentage
  - `passed` = true/false
  - `status` = `completed` or `failed`
  - `notes` = examiner notes summary
- The `SkillTestSession.training_record_id` back-references the created record

### 4.3 Training Sessions (Events)

- Skills testing can be scheduled as a `TrainingSession` event
- Multiple candidates can be tested at the same event, each getting their own `SkillTestSession`
- The training session's attendee list populates the candidate queue for the examiner

### 4.4 Training Programs

- Skills evaluations can be assigned as phase requirements within a `TrainingProgram`
- Example: Recruit Academy Phase 3 requires passing "Patient Assessment — Trauma" and "Cardiac Arrest Management"
- Progress tracking in `RequirementProgress` is updated when tests are passed

### 4.5 Approval Workflow

- Optionally route completed skill test results through the existing `TrainingApproval` workflow
- Training officers can review the detailed step-by-step results before approving the record

---

## 5. UI/UX Screens

### 5.1 Template Management (Admin)

**Template List Page**
- Table/grid of all skill sheet templates for the organization
- Filter by: category, certification level, source standard, active/inactive
- Actions: create new, duplicate, edit, deactivate, export

**Template Builder/Editor**
- Form-based editor for template metadata
- Drag-and-drop section and step ordering
- Inline editing of step descriptions, point values, scoring types
- Critical criteria list editor
- Scenario prompt rich-text editor
- Supplemental prompts key-value editor
- Live preview of how the sheet will look to the examiner
- Save, publish, and version controls

### 5.2 Test Administration (Examiner)

**Candidate Queue** (when linked to a training session)
- List of candidates scheduled for testing
- Status indicators: waiting, in progress, completed, failed
- Tap a candidate to begin or resume their test

**Active Test Screen** (the primary examiner interface)
- **Top bar**: Candidate name, template name, timer (prominent), running score
- **Main content**: Scrollable sections with step checkboxes/toggles
  - Each step shows description and point value
  - Tap to toggle scored/not-scored
  - Long-press or secondary tap for notes/flags
  - Section headers with subtotals
- **Bottom bar or slide-up panel**: Critical criteria checklist
- **Action buttons**: Pause timer, add note, complete test
- Design priority: Large touch targets, minimal scrolling per section, high-contrast readability for outdoor/bay use

**Completion/Review Screen**
- Score summary with pass/fail indicator
- Section-by-section breakdown
- Missed steps highlighted
- Critical criteria results
- Examiner notes
- Signature pad
- Submit or save as draft

### 5.3 Results & History

**Individual Test Result View**
- Full recreation of the scored sheet (viewable by examiner, training officer, and candidate)
- Printable/exportable as PDF (formatted to look like the original NREMT paper sheet)
- Linked training record

**Candidate History**
- All skill test attempts for a member, grouped by template
- Attempt-over-attempt comparison (which steps improved/regressed)
- Pass rate trends

**Reporting Dashboard** (Training Officer)
- Aggregate pass/fail rates by template, category, time period
- Most commonly missed steps (identifies training gaps)
- Examiner activity and consistency
- Upcoming skills evaluations due (from requirements)
- Overdue evaluations

---

## 6. Permissions & Roles

| Action | Roles |
|---|---|
| Create/edit templates | Training Officer, Admin |
| Administer a test (examiner) | Training Officer, designated examiner, Officer |
| View own results | Any member (candidate) |
| View all results | Training Officer, Admin, assigned officers |
| Approve test results | Training Officer, Admin |
| Export/print results | Training Officer, Admin, Examiner (own tests) |
| View reporting dashboard | Training Officer, Admin |

---

## 7. Offline & PWA Considerations

Since the app is a PWA and skills testing often occurs in field environments (training grounds, apparatus bays) with unreliable connectivity:

- **Offline-capable test administration**: The active test screen must work fully offline once the template is loaded
- **Local storage**: In-progress test sessions are persisted to IndexedDB
- **Sync on reconnect**: Completed tests queue for submission when connectivity returns
- **Conflict resolution**: If the same test is somehow modified on two devices, last-write-wins with full audit log
- **Template caching**: Downloaded templates are cached for offline use via service worker

---

## 8. Seed Data — Standard NREMT Skill Sheets

The following NREMT psychomotor examination sheets should be included as preset templates that organizations can adopt or customize:

1. Patient Assessment/Management — Trauma
2. Patient Assessment/Management — Medical
3. Cardiac Arrest Management / AED
4. BVM Ventilation of an Apneic Adult Patient
5. Oxygen Administration by Non-Rebreather Mask
6. Spinal Immobilization (Supine Patient)
7. Spinal Immobilization (Seated Patient)
8. Bleeding Control / Shock Management
9. Long Bone Immobilization
10. Joint Immobilization

Each preset includes the full section/step/point structure and critical criteria as defined by the NREMT.

---

## 9. API Endpoints (Conceptual)

### Templates
- `GET    /api/v1/training/skill-sheets` — List templates
- `POST   /api/v1/training/skill-sheets` — Create template
- `GET    /api/v1/training/skill-sheets/{id}` — Get template with sections/steps/criteria
- `PUT    /api/v1/training/skill-sheets/{id}` — Update template
- `DELETE /api/v1/training/skill-sheets/{id}` — Soft-delete template
- `POST   /api/v1/training/skill-sheets/{id}/duplicate` — Clone template
- `POST   /api/v1/training/skill-sheets/{id}/publish` — Publish new version
- `GET    /api/v1/training/skill-sheets/{id}/versions` — Version history
- `POST   /api/v1/training/skill-sheets/import` — Import template from JSON
- `GET    /api/v1/training/skill-sheets/{id}/export` — Export template as JSON

### Test Sessions
- `GET    /api/v1/training/skill-tests` — List test sessions (with filters)
- `POST   /api/v1/training/skill-tests` — Start a new test session
- `GET    /api/v1/training/skill-tests/{id}` — Get test session with all results
- `PUT    /api/v1/training/skill-tests/{id}` — Update test session (save draft)
- `POST   /api/v1/training/skill-tests/{id}/submit` — Submit completed test
- `POST   /api/v1/training/skill-tests/{id}/cancel` — Cancel test
- `PUT    /api/v1/training/skill-tests/{id}/steps/{step_id}` — Score a step
- `PUT    /api/v1/training/skill-tests/{id}/criteria/{criterion_id}` — Toggle critical criterion
- `POST   /api/v1/training/skill-tests/{id}/timer/start` — Start timer
- `POST   /api/v1/training/skill-tests/{id}/timer/pause` — Pause timer
- `POST   /api/v1/training/skill-tests/{id}/timer/resume` — Resume timer
- `POST   /api/v1/training/skill-tests/{id}/timer/stop` — Stop timer

### Results & Reporting
- `GET    /api/v1/training/skill-tests/member/{user_id}` — Member's test history
- `GET    /api/v1/training/skill-tests/{id}/pdf` — Generate printable PDF
- `GET    /api/v1/training/skill-tests/reports/pass-rates` — Aggregate pass rates
- `GET    /api/v1/training/skill-tests/reports/missed-steps` — Common missed steps
- `GET    /api/v1/training/skill-tests/reports/examiner-activity` — Examiner stats

---

## 10. Implementation Phases

### Phase 1 — Foundation
- Database models and migrations for all skill sheet/test entities
- Template CRUD API endpoints
- Template management UI (list, create, edit)
- Seed data for NREMT preset templates

### Phase 2 — Test Administration
- Test session API endpoints
- Active test screen UI (step scoring, timer, critical criteria)
- Test completion and submission flow
- TrainingRecord integration on submission

### Phase 3 — Results & Integration
- Results viewing and PDF export
- Candidate history views
- Integration with TrainingRequirement (SKILLS_EVALUATION) compliance
- Integration with TrainingProgram phase requirements
- Approval workflow integration

### Phase 4 — Reporting & Offline
- Reporting dashboard (pass rates, missed steps, examiner stats)
- Offline/PWA support for test administration
- Template import/export between organizations

---

## 11. Open Questions

1. **Partial re-testing**: Should examiners be able to re-test only failed sections, or must the entire sheet be re-administered? (NREMT requires full re-test, but departments may differ)
2. **Multi-examiner support**: Can a test be scored by multiple examiners simultaneously (e.g., one per station in a multi-station scenario)?
3. **Candidate self-assessment**: Should candidates be able to fill out a self-assessment version for practice purposes?
4. **Video recording integration**: Should there be a hook to link a video recording of the test to the session record?
5. **Inter-rater reliability**: Should the system support having two examiners independently score the same test and flag discrepancies?
6. **Custom scoring formulas**: Beyond simple sum-of-points, do any departments need weighted scoring or category minimums (e.g., must score at least 50% in each section)?
