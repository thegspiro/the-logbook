# Skills Testing Feature — Requirements Specification

## Overview

A digital skills testing module that mirrors NREMT-style psychomotor examinations. The examiner uses a tablet or computer to read prompts, time the exercise, score individual steps, flag issues, and record fail points — replacing paper skill sheets with a structured, auditable digital workflow.

This feature lives within the existing Training module and integrates with Training Requirements (`SKILLS_EVALUATION` type), Training Records, Training Sessions, and the compliance pipeline.

---

## 1. Skill Sheet Templates

Templates are the reusable definitions of a skills test. They are the digital equivalent of a blank NREMT skill sheet (e.g., "Patient Assessment/Management — Trauma").

### 1.1 Template Metadata

| Field                            | Description                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                         | e.g., "Patient Assessment/Management — Trauma"                                                                                                                                     |
| **Code**                         | Short identifier, e.g., `NREMT-TRAUMA-ASSESS`                                                                                                                                      |
| **Description**                  | Purpose and scope of this skill test                                                                                                                                               |
| **Version**                      | Template versioning (v1, v2, etc.) to track changes over time                                                                                                                      |
| **Source/Standard**              | Origin standard: NREMT, NFPA 1001, state registry, or department-defined                                                                                                           |
| **Registry Code**                | Links to `TrainingRequirement.registry_code` (e.g., "NREMT", "NFPA 1001")                                                                                                          |
| **Certification Level**          | EMR, EMT, AEMT, Paramedic, Firefighter I/II, etc.                                                                                                                                  |
| **Category**                     | Links to existing `TrainingCategory` (EMS, Fire, Hazmat, etc.)                                                                                                                     |
| **Time Limit**                   | Optional maximum duration in **minutes** (e.g., 10 for NREMT trauma). Changed from seconds to minutes as of 2026-02-28 for more intuitive configuration                            |
| **Total Possible Points**        | Auto-calculated from step point values                                                                                                                                             |
| **Passing Score**                | Minimum points to pass (if no critical criteria are triggered)                                                                                                                     |
| **Passing Percentage**           | Alternative: minimum percentage to pass                                                                                                                                            |
| **Equipment/Materials Required** | List of supplies/equipment needed for the exam station                                                                                                                             |
| **Scenario Prompt**              | Text the examiner reads aloud to the candidate to set up the scenario                                                                                                              |
| **Supplemental Prompts**         | Keyed prompt-response pairs the examiner can give when the candidate asks or performs specific actions (e.g., "If candidate assesses breathing: 'Breathing is labored at 24/min'") |
| **Active**                       | Whether this template is currently available for use                                                                                                                               |

### 1.2 Template Sections

Each template is divided into ordered sections that group related steps. Sections map to the bold-header groups on the NREMT sheet.

| Field                | Description                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section Name**     | e.g., "Scene Size-Up", "Primary Survey/Resuscitation", "Secondary Assessment"                                                                            |
| **Sort Order**       | Display order within the template                                                                                                                        |
| **Instructions**     | Optional examiner-facing instructions for this section                                                                                                   |
| **Integration Note** | Notation like the NREMT's "\*\*" flag indicating steps may be integrated within the flow of another section (e.g., history taking during primary survey) |

### 1.3 Section Steps (Scored Items)

Each section contains individual scored steps. These are the line items on the NREMT sheet.

| Field                | Description                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Step Description** | What the candidate must do, e.g., "Determines scene/situation safety"                                                             |
| **Point Value**      | Points awarded if completed correctly (typically 1, but can be higher for complex steps)                                          |
| **Sort Order**       | Display order within the section                                                                                                  |
| **Required**         | Whether this step must be attempted (vs. optional/conditional)                                                                    |
| **Conditional On**   | Optional: step only appears if a prior step had a specific outcome                                                                |
| **Examiner Prompt**  | Optional prompt text the examiner reads when the candidate reaches this step                                                      |
| **Scoring Type**     | `binary` (done/not done), `partial` (0 to max points), `scaled` (rubric-based), or `statement` (open-ended text response)         |
| **Point Value**      | Configurable point value for weighted scoring (default 1). Enables point-based scoring where criteria can carry different weights |
| **Rubric**           | For `scaled` scoring: criteria descriptions for each point level                                                                  |

> **Note on Scoring Types (updated 2026-02-28):**
>
> - `binary`: Simple pass/fail (done / not done) — most common
> - `partial`: Award 0 to max points with a slider or increment buttons
> - `scaled`: Select from a rubric with predefined score levels
> - `statement`: Open-ended text box for the candidate to describe their response (e.g., "Describe the patient's chief complaint"). Can be marked as required or optional, and scored or informational

### 1.4 Critical Criteria (Auto-Fail Conditions)

Separate from scored steps, these are conditions that result in automatic failure regardless of score. Directly mirrors the "Critical Criteria" section at the bottom of NREMT sheets.

| Field           | Description                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Description** | e.g., "Failure to initiate or call for transport of the patient within the 10 minute time limit" |
| **Sort Order**  | Display order                                                                                    |
| **Category**    | Optional grouping: safety, airway, assessment, procedural, timing                                |

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

| Field                | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| **Template**         | Select which skill sheet to administer                                    |
| **Template Version** | Locked to the current active version at time of administration            |
| **Candidate**        | Select member from roster (links to `users` table)                        |
| **Examiner**         | Auto-populated from logged-in user; can be overridden                     |
| **Scenario Number**  | Optional scenario variant identifier                                      |
| **Date**             | Defaults to today                                                         |
| **Training Session** | Optional link to a `TrainingSession` if this is part of a scheduled event |
| **Attempt Number**   | Auto-incremented for the candidate on this template                       |

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

1. **Auto-calculate results** (now performed by the pure
   `skills_testing_service.calculate_test_result(test, template)` helper — see
   §13):
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

> **Superseded by §16 (2026-08-08).** The single show/hide toggle is now the
> coarsest of three axes — _what_ is shown, _when_ it is shown, and _who_ may see
> it — resolved test → template → organization. Read §16 for the model that
> actually governs disclosure.

### 2.9 Test Record Deletion (Added 2026-02-28)

Training officers with `training.manage` permission can permanently delete test records:

- **Confirmation dialog**: Requires explicit confirmation before deletion
- **Audit trail**: Deletion is logged via `log_audit_event` for accountability
- **Cascade**: Deleting a test removes all associated section results, criteria scores, and notes

> **Narrowed by §15 (2026-08-08).** `DELETE` now refuses **official** tests — a
> scored evaluation is a record, not a draft. It is withdrawn with
> `POST /tests/{id}/void`, which keeps the row and its reason. Deletion remains
> the right verb for a **practice** attempt, which is nobody's record. An
> unscored evaluation abandoned mid-session is closed with
> `POST /tests/{id}/cancel`, which is neither.

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
├── requirement_id (FK → training_requirements, nullable — default pipeline link)
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

| Action                       | Roles                                          |
| ---------------------------- | ---------------------------------------------- |
| Create/edit templates        | Training Officer, Admin                        |
| Administer a test (examiner) | Training Officer, designated examiner, Officer |
| View own results             | Any member (candidate)                         |
| View all results             | Training Officer, Admin, assigned officers     |
| Approve test results         | Training Officer, Admin                        |
| Export/print results         | Training Officer, Admin, Examiner (own tests)  |
| View reporting dashboard     | Training Officer, Admin                        |

**As built, 2026-08-08 (revised).** The gate moved. Skills testing was
officer-only end to end, which does not match how departments run these — a
senior member is routinely the one holding the clipboard. **Examining is now
open to every member**, and the officer's authority sits at a second step:
**validating** the result against the candidate's account (§19).

| Action                                                                         | Gate                                 | Why                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Create / edit / publish / duplicate / delete a **template**                    | `training.manage`                    | Authoring the standard is an officer act                                                                                             |
| Run a **practice** test on a peer or yourself                                  | Authenticated member                 | A drill is not an evaluation. Template visibility still applies, so an `officers_only` sheet is not exposed (§15.1)                  |
| Start, score and complete an **official** test                                 | Authenticated member                 | Departments routinely use senior members as evaluators. The result does not count until validated, so this is not an authority grant |
| **Validate** an official result (§19)                                          | `training.manage`                    | This is the step that makes a result count. Blocked when the officer is the candidate                                                |
| **Void** an official result (the rejection path)                               | `training.manage`                    | Keeps the submission and the reason it was refused                                                                                   |
| **Release** a withheld result                                                  | `training.manage`                    | §16.2                                                                                                                                |
| Grant / list / revoke a **named viewer**                                       | `training.manage`                    | §16.3                                                                                                                                |
| **Cancel** an unscored evaluation                                              | Authenticated member                 | Closing out an abandoned session is not a scoring decision                                                                           |
| **Delete** a test record                                                       | `training.manage`                    | Practice only — official results are voided, never deleted (§15)                                                                     |
| **Discard** a practice attempt                                                 | Authenticated member                 | Candidate, examiner or officer                                                                                                       |
| Look up a **candidate** by name (`GET /candidates`)                            | `training.view` or `training.manage` | A lookup, not a listing (§20). A position with no training access has no business searching test candidates                          |
| Read **your own** results (`/training/my-skill-tests/:testId`)                 | Authenticated member                 | The API already scopes non-officers to tests they are party to, so the route needs no permission of its own (§18)                    |
| Read a result you are a **named viewer** of, or hold a listed **position** for | Authenticated member                 | Bounded by §16.3, and never above the candidate's own tier (§16.4)                                                                   |

> **The route guards match.** `/training/skills-testing`, `.../test/new`,
> `.../test/:testId` and `.../test/:testId/active` are now
> `<ProtectedRoute>` with no `requiredPermission`. Per-record read access is
> enforced by the API, so a member reaching a test they are not party to gets a
> **`404` from the API** rather than a route they should not have been able to
> open. Template authoring routes still carry `requiredPermission="training.manage"`.

---

## 7. Offline & PWA Considerations

Since the app is a PWA and skills testing often occurs in field environments (training grounds, apparatus bays) with unreliable connectivity:

- **Offline-capable test administration**: The active test screen must work fully offline once the template is loaded
- **Local storage**: In-progress test sessions are persisted to IndexedDB
- **Sync on reconnect**: Completed tests queue for submission when connectivity returns
- **Conflict resolution**: If the same test is somehow modified on two devices, last-write-wins with full audit log
- **Template caching**: Downloaded templates are cached for offline use via service worker

> **Status (2026-08-08) — read this before quoting the list above.** It is the
> original target, not what ships. What exists today is **autosave** (§17.3) and
> **optimistic-concurrency detection** (§17.4) — not last-write-wins — which
> together cover the common data-loss case: a locked phone or a killed tab with
> signal still up. Genuine no-connectivity operation is **not** implemented; the
> obstacle is the _read_ path, not the write path, since `/api/*` is
> `NetworkOnly` in the service worker by design and `GET /tests/{id}` is the only
> source of the template structure. Scope, the two decisions it needs from an
> owner, and a 4–6 day estimate are in
> [SKILLS_TESTING_OFFLINE_PLAN.md](./SKILLS_TESTING_OFFLINE_PLAN.md) and summarized
> in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

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

### As Built _(verified 2026-08-08)_

The routes above are the original design sketch. The shipped router is mounted at
**`/api/v1/training/skills-testing`** and is the authoritative list:

| Method   | Path                                 | Gate                                | Notes                                                                                                                     |
| -------- | ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/templates`                         | Auth                                | List                                                                                                                      |
| `POST`   | `/templates`                         | `training.manage`                   | Create. Accepts the disclosure override (§16.1); `null` means _inherit_                                                   |
| `GET`    | `/templates/{template_id}`           | Auth                                | Detail; `officers_only` templates are filtered here                                                                       |
| `PUT`    | `/templates/{template_id}`           | `training.manage`                   | Update. Send `null` — not an omitted field — to clear an override back to inherit                                         |
| `DELETE` | `/templates/{template_id}`           | `training.manage`                   |                                                                                                                           |
| `POST`   | `/templates/{template_id}/publish`   | `training.manage`                   |                                                                                                                           |
| `POST`   | `/templates/{template_id}/duplicate` | `training.manage`                   |                                                                                                                           |
| `GET`    | `/candidates`                        | `training.view` / `training.manage` | **Name lookup** for the start-test picker. `q` **required**, min 2 chars, capped at 15 results (§20)                      |
| `GET`    | `/tests`                             | Auth                                | List; filter by `candidate_id`, `template_id`, status, `include_practice`, **`pending_validation`** (§19)                 |
| `POST`   | `/tests`                             | Auth                                | Create. **Official is now open to any member** (§19); the attempt-limit guard moved to validation (§14.5, §19.3)          |
| `GET`    | `/tests/{test_id}`                   | Auth                                | Detail; redacted per §16                                                                                                  |
| `PUT`    | `/tests/{test_id}`                   | Auth                                | Update / autosave. Accepts `expected_version`; stale → **`409`** (§17.4). Refuses `elapsed_seconds` on a completed test   |
| `POST`   | `/tests/{test_id}/complete`          | Auth                                | Scores. An **officer's** completion validates in the same step; a member's leaves the result pending (§19)                |
| `DELETE` | `/tests/{test_id}`                   | `training.manage`                   | **Practice only** — refuses official tests (§15)                                                                          |
| `DELETE` | `/tests/{test_id}/discard`           | Auth                                | Practice discard — candidate, examiner or officer                                                                         |
| `POST`   | `/tests/{test_id}/validate`          | `training.manage`                   | **Accept a member-run result against the candidate's record** (§19). Idempotent                                           |
| `POST`   | `/tests/{test_id}/release`           | `training.manage`                   | Release a withheld result (§16.2). Idempotent                                                                             |
| `GET`    | `/tests/{test_id}/viewers`           | `training.manage`                   | Named viewers (§16.3)                                                                                                     |
| `POST`   | `/tests/{test_id}/viewers`           | `training.manage`                   | Add a named viewer                                                                                                        |
| `DELETE` | `/tests/{test_id}/viewers/{user_id}` | `training.manage`                   | Remove one                                                                                                                |
| `POST`   | `/tests/{test_id}/cancel`            | Auth                                | Close out an **unscored** evaluation (§15)                                                                                |
| `POST`   | `/tests/{test_id}/void`              | `training.manage`                   | Withdraw a **scored official** result; requires a reason; reverts the pipeline (§15). Also the **rejection** path for §19 |
| `POST`   | `/tests/{test_id}/email-results`     | Auth                                | Disclosure resolved **for the recipient** (§16.5)                                                                         |
| `GET`    | `/summary`                           | Auth                                | Dashboard aggregates; excludes voided **and unvalidated** results. Carries `pending_validation` (§19.4)                   |

> A refusal to read a withheld or out-of-scope test is always **`404`**, never
> `403` (§16.4).

## 15. Result Lifecycle: Void, Cancel, Delete _(2026-08-08)_

Three different things can happen to a test that should not stand as a normal
result, and they are deliberately three different verbs rather than one
"delete".

| Verb       | Endpoint                  | Applies to                                     | Effect                                                                                                                                                                                                          |
| ---------- | ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Delete** | `DELETE /tests/{id}`      | **Practice only**                              | Row removed. Refused for official tests.                                                                                                                                                                        |
| **Void**   | `POST /tests/{id}/void`   | Completed **official** tests                   | Row kept, with a **required reason** and its author. Dropped from totals, pass rate and average score. Releases any pipeline requirement the pass had credited. The member sees the reason on their own result. |
| **Cancel** | `POST /tests/{id}/cancel` | **Unscored** evaluations abandoned mid-session | Partial results kept, test closed out.                                                                                                                                                                          |

Why they are distinct: an unscored test has no result to withdraw and nothing to
release from the pipeline, so cancelling is not voiding; and a scored evaluation
is a record of what an examiner observed, so it is withdrawn rather than erased.
`cancelled` had been a dead status since the feature shipped — the filter option
and the badge rendered it, but nothing ever set it.

The records tab offers exactly one of the three per row: **delete** for practice,
**void** for scored, **cancel** for unscored.

**Void releases the pipeline.** `revert_test_pass_from_pipeline` is the mirror of
`apply_test_pass_to_pipeline` (§14.4): a requirement completed by a pass that is
later voided returns to incomplete, with the same downstream recalculation.

### 15.1 Practice Attempts Are the Member's Own Notes

- **Any member may run a practice test on a peer** — no `training.manage`.
  Official tests still require it. Practice creation follows the same visibility
  rule as reading a template, since the test response carries the full template
  body and would otherwise leak an `officers_only` sheet.
- **Discardable by the candidate, the examiner, or an officer.** Previously only
  the examiner could, which is why a member could never clear their own record.
- **Retained one year**, via a `practice_skill_tests` retention class registered
  with the records-retention service. Official results share the table and are
  excluded by a row filter.
- **Exempt from the release gate** (§16.2). They are the candidate's own drill
  notes, not the department's evaluation record to hold back.

---

## 16. Result Disclosure _(2026-08-08)_

Completing a test used to make the whole scorecard visible to the candidate at
once, including every criterion note. That is right for a routine drill and wrong
for a promotional evaluation — and examiner notes are often candid working notes
for the training file ("hesitant, needed two prompts") rather than feedback
drafted for the member to read.

Disclosure is now **three independent axes**, each resolved **test → template →
organization**, so a department sets a norm and a single skill, or a single test,
can depart from it.

### 16.1 What — `result_disclosure`

| Value    | The candidate sees                                        |
| -------- | --------------------------------------------------------- |
| `full`   | Every mark, every point, every written note. **Default.** |
| `scores` | Every mark and point. **All written commentary removed.** |
| `none`   | Nothing — the result does not appear at all.              |

### 16.2 When — `result_release`

| Value           | Behaviour                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `on_completion` | Visible as soon as the test is completed. **Default.**                                                                               |
| `on_release`    | The finished result stays invisible until an officer releases it, so a chief can review it — or deliver a failure in person — first. |

This mirrors the shift-report review workflow, which already gates trainee
visibility the same way.

`POST /tests/{id}/release` releases one. It is **idempotent**, and refuses tests
whose results are never shown (`result_disclosure: none`), so the UI offers it on
any unreleased official result rather than making an officer work out which mode
a given template inherits before they can act.

### 16.3 Who

- **The candidate.**
- **Anyone named on the test** — `skill_test_viewers`, e.g. a preceptor or an
  FTO. Managed via `GET/POST/DELETE /tests/{id}/viewers`.
- **Holders of listed corporate positions** — `result_viewer_positions`,
  mirroring `InventoryItem.restricted_to_positions`.

> **Named viewers have a UI as of 2026-08-08.** `TestViewersPanel` on the test
> screen (officer-facing, `training.manage`) grants and revokes sight of a
> **single** test's result.
>
> Named **per test** rather than per template, deliberately: the relationship is
> to the person tested, not to the skill. A trainee's FTO changes, and a
> standing template-wide grant would quietly follow the skill onto every other
> candidate's results.
>
> The candidate and the examiner are **excluded from the picker** — the
> candidate already sees the result as policy allows and the API rejects
> granting to them, and the examiner always sees what they themselves recorded,
> so a grant would be a no-op the officer could not tell had done nothing. The
> panel states outright that a grantee sees the result at the candidate's
> disclosure level and never more, rather than implying it hands out full
> access.

### 16.4 Two Rules the Implementation Holds To

1. **A viewer never sees more than the candidate.** Sharing a result has no
   reading under which the observer sees more of it than its subject, so named
   viewers and position holders get the _candidate's_ tier, not the officer's.
2. **Withheld reads as absent, never as forbidden.** Every refusal is a `404`,
   never a `403` — a 403 on a withheld result announces "you were evaluated and
   may not know how it went." A withheld test is dropped from the list entirely,
   since an entry that cannot be opened only invites the member to ask why.

### 16.5 Where Redaction Lives

Redaction is applied in `_build_test_response` — the single point every read
funnels through — rather than at each endpoint. A new endpoint that forgets to
redact is a leak, and this way there is nothing to forget. It **rebuilds**
section results rather than editing them, so the ORM's loaded JSON is never
mutated (see Pitfall #12 in `CLAUDE.md`), and it drops the per-section review
note entirely: that one is stored as a pseudo-criterion, so clearing the obvious
`notes` keys alone would leak it.

**Emailing results obeys the same policy**, resolved for the _recipient_ rather
than for the officer sending it. Otherwise "email results" is a one-click bypass
of the department's decision to withhold or redact them.

### 16.6 Configuration

| Level                  | Where                                                      | Fields                                                           |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Organization (default) | Training configuration editor → **Skills-Test Results**    | `skills_result_disclosure`, `skills_result_release`              |
| Template               | **Template builder → Result Disclosure** _(UI 2026-08-08)_ | `result_disclosure`, `result_release`, `result_viewer_positions` |
| Test                   | Per test — `TestViewersPanel` for the named grants (§16.3) | same three, plus `skill_test_viewers`                            |

Unset at a level means "inherit". Defaults are `full` / `on_completion` — exactly
what members saw before this shipped — so the change is additive and nobody
silently loses sight of a result they can currently read.

The "when" question is hidden in the editor when disclosure is `none`, since
there is then nothing to time. The member's empty state reads honestly: a
withheld result is omitted from the list entirely, so "no results" no longer
reliably means "none taken" — the copy says results the department does not share
will not appear, without asserting that one is being withheld, which usually it
is not.

#### The per-template editor _(2026-08-08)_

The template builder exposes the override the API has accepted since disclosure
shipped. Three behaviors are worth knowing:

- **Every field defaults to "Inherit", and the inherit option names what it
  resolves to** — "Inherit — Scores only (pass/fail and points, no written
  notes)" — read from the department's training configuration. An officer can
  tell what leaving a template alone actually does without opening another page.
  When the configuration cannot be read, the option falls back to the **platform
  default** rather than rendering a blank promise.
- **"Inherit" sends `null`, not an omitted field.** The backend's
  `exclude_unset` drops an undefined field, so clearing an override back to
  inherit would otherwise silently keep the old value. `SkillTemplateCreate`
  types these three as `T | null | undefined` for the same reason — `null` is a
  meaningful value here, not merely an absent one.
- **Positions come from the roles API.** `Role` is an alias of `Position` in the
  model layer (`Role = Position`, `user_roles = user_positions`), so a role's
  `slug` is exactly what the backend checks against a member's positions. The
  picker is **omitted entirely** when an organization has no positions to offer,
  rather than showing an empty box.

---

## 17. Scorecard Integrity _(2026-08-08)_

### 17.1 Every Test Freezes Its Template

Criterion identity is **positional** (`criterion-{section}-{index}`), and
updating a template rewrites `skill_templates.sections` **in place on the one
row**. The version counter incremented but no prior version was kept, so every
completed test read its structure from the _live_ template. The consequences were
silent and severe:

- Inserting a criterion **shifted recorded pass/fail marks onto their
  neighbours**.
- Deleting one **dropped its recorded result off the scorecard** while leaving it
  in the stored JSON.
- Raising `passing_percentage` could **turn a recorded pass into a fail**.

Each test now carries a **`template_snapshot`** — structure plus scoring rules,
deep-copied so it cannot alias the template's own JSON — written at creation and
used for scoring, for the API response, and for the emailed scorecard. Rows
predating the column fall back to the live template.

The migration backfills from the current template. The structure those tests were
actually scored against was overwritten in place and is unrecoverable, so the
current template is the best available value **and is already what they
display** — the backfill changes nothing visible; it freezes them against future
edits.

> A useful side effect: the client now holds the full test structure locally,
> which is most of what offline support would need to cache.

### 17.2 The Examiner's Stopwatch Is Trusted

`complete_test` unconditionally overwrote `elapsed_seconds` with
`completed_at - started_at`, throwing away the timer reading the client had just
saved. `started_at` is stamped **once**, when the test first goes `in_progress`,
so a test begun at 09:00 and finished after lunch recorded seven hours — and
**time limits are pass/fail criteria here**.

Wall clock is now only a fallback for tests completed _without_ a measured value,
via `resolve_elapsed_seconds`, which keeps a measured `0` rather than treating it
as absent. Reopening an in-progress test restores the on-screen timer from
`elapsed_seconds` instead of restarting the evaluation at 00:00.

### 17.3 Autosave

The active test screen persisted only on an explicit **Save** or on entering
review — on a screen used one-handed outdoors. A locked phone or a killed tab
lost every criterion scored since the examiner last thought to press Save.

Scoring is now autosaved, silently and only while the evaluation is live, through
the shared `useAutoSave` hook. Full offline queueing is deliberately **not**
attempted here; see §7.

### 17.4 Optimistic Concurrency

`skill_tests` carried no version and no ETag, so two examiners on one test — or
an officer editing the scorecard while a phone held unsaved criteria — lost one
side's work, and **the losing side got a success response**.

Tests now carry an **integer version counter**, bumped on every mutation.
`PUT /tests/{id}` refuses a stale `expected_version` with **`409`**. Clients that
send no `expected_version` keep the old behaviour, so this is additive.

> An integer rather than `updated_at`: MySQL `DATETIME` has no fractional seconds
> by default, so two writes in the same second compare equal and the conflict
> would go undetected — autosave plus a manual **Save** is exactly that case.

On conflict the test screen **suspends autosave and says so**, rather than
retrying a doomed write every 30 seconds while the examiner believes their
scoring is still being saved.

### 17.5 Passing Points Is a Critical-Criteria Field

`passing_score` is read by the scorer **only when `criterion.required` is set**.
The field nonetheless rendered for every numeric-score criterion, with a
"(critical only)" hint doing the explaining — so it asked for a number the scorer
then ignored. It is now shown only on **critical** criteria.

Validation moved with it. The "passing score cannot exceed max score" check ran
for any score criterion, so a value left behind from before a criterion was
un-marked critical would block saving over a field the editor no longer shows —
an error with no reachable cause.

The stored value is deliberately **kept, not cleared**, when Critical is
unchecked. Clearing would look tidier, but the threshold defaults to `0` when
absent, so an accidental toggle off and back on would silently leave the
criterion passing at any score. Inert data is the safer of the two.

---

## 18. Member-Facing Results _(2026-08-08)_

Every skills-testing route was gated on `training.manage`, so a result lived on
the examiner's device and had to be read over their shoulder. A practice attempt
in particular was a dead end for the person taking it.

- **My Training → Skills Tests** lists the member's own official and practice
  results.
- **`/training/my-skill-tests/:testId`** is a read-only detail page. The route is
  **auth-only by design**: the API already scopes non-officers to tests they are
  party to, so it cannot expose anyone else's scorecard. The list is fetched by
  `candidate_id` — without it, an officer opening the page would see the whole
  organization here.
- Voided results show the member the reason.
- Withheld results (§16) are simply absent.
- **Results awaiting an officer's sign-off** are listed as **awaiting
  validation**, with the outcome withheld (§19.1). Nobody has yet decided that
  the result stands, so showing a pass or a fail would assert something no
  officer has agreed to.

---

## 19. Officer Validation _(2026-08-08)_

Opening the examiner role to every member (§6) needed the authority it used to
carry to land somewhere. It lands here.

### 19.1 What a submission is, before it is a record

An **official** test that has been completed but not validated is a
**submission, not a record**. Concretely, until `validated_at` is set:

- It **credits no pipeline requirement**, even on a pass.
- It **spends no attempt** against the requirement's `max_attempts` cap.
- It is **excluded from `GET /summary`** — the department's pass rate and
  average score do not move.
- The candidate **sees it listed as awaiting validation, with the outcome
  withheld**. Nobody has yet decided that it stands, so showing a pass or a
  fail would be asserting something no officer has agreed to.

### 19.2 Who validates, and who cannot

`POST /tests/{test_id}/validate` requires `training.manage`.

**An officer completing a test validates it in the same step.** They are the
authority the second step exists to obtain, so the existing officer workflow is
unchanged and no queue of self-approvals appears. `validated_at` is `NULL` only
while a **peer-run** test awaits review.

**Separation of duties holds at both ends** (CS-8):

- A member cannot examine themselves on an official test — the examiner-side
  check.
- An **officer cannot validate a test they are the candidate in**. Without
  this, an officer could have a peer "examine" them and then sign off their own
  pass — the same certification fraud, one hop removed.

Both refusals are `400` via `SeparationOfDutiesError`.

### 19.3 Rejection, and where the attempt cap is spent

There is no "reject" endpoint. Rejection is **`POST /tests/{test_id}/void`**,
which keeps the submission and the reason it was refused rather than deleting
an evaluation someone sat for.

The `max_attempts` cap is **spent at validation, not at completion**, and is
therefore enforced there. A submission that is never validated never costs the
candidate a chance.

### 19.4 Edge cases

| Situation                                       | Behavior                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validating an already-validated test            | **Idempotent** — returns the result unchanged, no second audit trail                                                                                                                                                        |
| Validating a **practice** attempt               | `400` — practice is never recorded, so there is nothing to validate                                                                                                                                                         |
| Validating a **voided** test                    | `400`                                                                                                                                                                                                                       |
| Validating an **incomplete / in-progress** test | `400` — only a completed test has a result to validate                                                                                                                                                                      |
| Validating a test you are the **candidate** in  | `400` — separation of duties (§19.2)                                                                                                                                                                                        |
| The validating officer later **leaves**         | `validated_by` is `ON DELETE SET NULL`. A validated result must not revert to pending because the officer who signed it departed                                                                                            |
| Results that predate this feature               | **Backfilled as validated by their examiner.** Under the old rules only officers could run official tests, so each already carries the sign-off. Without the backfill the whole history would re-appear in the review queue |

### 19.5 Data and API surface

| Surface                       | Field / value                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `skill_tests.validated_at`    | `DATETIME`, nullable                                                                                       |
| `skill_tests.validated_by`    | `VARCHAR(36)` → `users.id`, **`ON DELETE SET NULL`**, nullable                                             |
| Index                         | `idx_skill_test_org_validation` (`organization_id`, `is_practice`, `validated_at`) — the review-queue scan |
| Migration                     | `20260808_0001`; no-ops where `create_all()` already materialized the columns                              |
| `SkillTestResponse`           | `validated_at`, `validated_by`, `validated_by_name`, `pending_validation`                                  |
| `SkillTestListResponse`       | `validated_at`, `pending_validation`                                                                       |
| `SkillTestingSummaryResponse` | `pending_validation` (count; `0` for readers who cannot validate)                                          |
| List filter                   | `GET /tests?pending_validation=true` — the officer review queue                                            |

`pending_validation` is **derived** — a completed, official, non-voided test
with no sign-off — and is sent so the UI does not have to re-derive the rule
from three separate fields.

---

## 20. Candidate Lookup _(2026-08-08)_

`GET /training/skills-testing/candidates?q=<fragment>` returns
`[{ id, name }]` and nothing else.

### 20.1 Why it exists

Examining is open to every member (§6), so every member needs to name the
person they are testing. `GET /users` requires `users.view`, which the baseline
member position does not carry, and widening that permission was the wrong
trade — it opens the full member admin payload, contact details included. This
endpoint carries **only an id and a display name**, so it exposes none of what
the member admin payload governs behind organization visibility settings.

### 20.2 A lookup, not a listing

| Guard               | Value / behavior                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `q` required        | There is no request that returns the roster. A caller can **confirm a name they already know**, not enumerate the department               |
| Minimum length      | `CANDIDATE_SEARCH_MIN_CHARS` = **2**                                                                                                       |
| Whitespace-only `q` | Refused with `422` **before** the query runs — it clears `min_length` but the `LIKE` would match everything                                |
| `LIKE` wildcards    | `\`, `%` and `_` are escaped. A bare `%` would otherwise match every row and turn the search-only rule back into a listing                 |
| Result cap          | `CANDIDATE_SEARCH_MAX_RESULTS` = **15**, and it **truncates silently** — so a short fragment is a worse way to harvest names than it looks |
| Permission          | `training.view` **or** `training.manage` — not bare authentication                                                                         |
| Org scope           | `organization_id` = caller's org, `status = ACTIVE`, `deleted_at IS NULL`                                                                  |

Matching is on the **full display name** (`first_name + ' ' + last_name`)
rather than the two columns separately, so `"john s"` finds John Smith; a
first-name-only or surname-only search still matches because the fragment can
sit anywhere.

### 20.3 Client behavior

The picker searches server-side with a debounce instead of filtering a cached
roster, and holds the selected candidate **separately** from the result list so
the choice survives the results being replaced. A member's **practice** run
defaults to themselves, built from the signed-in user — it costs no request and
works without a roster to find your own name in.

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

## 11. Shift Report Skill Scoring Integration _(2026-04-07)_

In addition to formal psychomotor evaluations, skills can be observed and scored during regular shift duty via **Shift Completion Reports**:

- Officers assign a **1-5 score** (Needs work → Excellent) to each observed skill when filing shift reports
- If the observed skill name matches a `SkillEvaluation` record, the score creates/updates a `SkillCheckoff` record, feeding the trainee's competency score history
- The **Skill Linkage Status** feature in Scheduling Settings shows green (linked) or amber (unlinked) indicators for each apparatus-type skill
- This provides continuous skill assessment data between formal evaluations, building a richer competency profile

**Key difference from formal Skills Testing:** Shift report skill observations are lightweight (one score per skill, no sections or critical criteria) and happen during regular duty. Formal Skills Testing uses full skill sheet templates with sections, steps, critical criteria, pass/fail thresholds, and timed evaluations.

**See also:** [Shift Completion Reports](../docs/training/02-training.md#shift-completion-reports) | [Skills Testing Training Guide](../docs/training/09-skills-testing.md)

---

## 12. Open Questions

1. **Partial re-testing**: Should examiners be able to re-test only failed sections, or must the entire sheet be re-administered? (NREMT requires full re-test, but departments may differ)
2. **Multi-examiner support**: Can a test be scored by multiple examiners simultaneously (e.g., one per station in a multi-station scenario)?
3. **Candidate self-assessment**: Should candidates be able to fill out a self-assessment version for practice purposes?
4. **Video recording integration**: Should there be a hook to link a video recording of the test to the session record?
5. **Inter-rater reliability**: Should the system support having two examiners independently score the same test and flag discrepancies?
6. **Custom scoring formulas**: Beyond simple sum-of-points, do any departments need weighted scoring or category minimums (e.g., must score at least 50% in each section)?

---

## 13. Scoring Algorithm (Extracted & Unit-Tested) _(2026-04-30)_

The pass/fail scoring logic was extracted verbatim out of the HTTP endpoint
into a pure function so it can be unit-tested in isolation:

```python
calculate_test_result(test, template) -> tuple[float | None, str]
```

- **Location:** `backend/app/services/skills_testing_service.py`
- **Returns:** `(overall_score, "pass" | "fail")`
- **Pure:** reads only `test.section_results` and the `template` definition; takes
  no DB session (model imports are `TYPE_CHECKING`-only).
- **Caller:** `app/api/v1/endpoints/skills_testing.py` now imports and calls it
  (`overall_score, test_result = calculate_test_result(test, template)`).
- **Tests:** `backend/tests/test_skills_testing_scoring.py`.

### Algorithm

| Step                        | Rule                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No section results          | If `test.section_results` is empty → return `(None, "fail")`                                                                       |
| Overall score (point-based) | If any criterion of `type == "score"` with `max_score > 0` exists: `overall_score = round(sum(earned) / sum(max_score) × 100, 1)`  |
| Overall score (fallback)    | Otherwise average the per-section `section_score` percentages; `None` if there are none                                            |
| Section matching            | A section result matches a template section by `section_id == "section-{idx}"` **or** by `section_name`                            |
| Criterion matching          | A criterion result matches by `criterion_id == "criterion-{s}-{c}"` **or** by `criterion_label`                                    |
| Passing percentage          | If `template.passing_percentage` is set and `overall_score` is not `None`, requires `overall_score >= passing_percentage`          |
| Critical criteria           | If `template.require_all_critical`, every **required** non-`statement` criterion must have a matching result with `passed == True` |
| Statement criteria          | `type == "statement"` criteria are informational and **always pass**                                                               |
| Missing required section    | A required section with no matching result **fails** the critical check                                                            |
| Final result                | `"pass"` only when passing-percentage **AND** critical checks both hold; otherwise `"fail"`                                        |

---

## 14. Training Pipeline Requirement Link _(2026-07-14)_

Skills testing now hooks directly into the training-program pipeline so that
passing a skill test can automatically complete the requirement it satisfies on
a candidate's active program enrollment(s). This replaces the older
`required_skills` JSON lookup described in §4.1 with a concrete foreign-key link.

### 14.1 Schema

A nullable `requirement_id` column (FK → `training_requirements`,
`ON DELETE SET NULL`, indexed) was added to **both** `skill_templates` and
`skill_tests`.

- Migration: `20260714_0001_add_requirement_link_to_skills_testing`
  (indexes `idx_skill_template_requirement`, `idx_skill_test_requirement`).
- Both columns are nullable — a template or test need not be tied to any
  pipeline requirement.

### 14.2 Hybrid Link Model

The link uses a **template-default / per-test-override** model:

- A **template** carries a _default_ `requirement_id` (the requirement it
  normally satisfies).
- Each **test** inherits that requirement at creation time, but the create-test
  request may override it with an explicit `requirement_id` in the body.
- `POST /api/v1/training/skills-testing/tests` sets the test's requirement from
  the explicit body value when provided, otherwise falls back to the template's
  default.

`requirement_id` on a template or test is validated to be a real
`TrainingRequirement` in the caller's organization (via
`_validate_requirement_link`); an unknown ID is rejected.

### 14.3 Endpoints

- `POST /api/v1/training/skills-testing/templates` and
  `PUT /api/v1/training/skills-testing/templates/{id}` accept and validate
  `requirement_id`.
- `POST /api/v1/training/skills-testing/tests` resolves the test's requirement
  (explicit body value, else inherited template default).
- Template list/detail responses and test responses now include
  `requirement_id`.

### 14.4 Pipeline Completion on Pass

`POST /api/v1/training/skills-testing/tests/{id}/complete` marks the linked
requirement complete when **all** of the following hold:

1. The computed result is **PASS**,
2. the test is **not** a practice test (`is_practice == False`), and
3. the test has a non-null `requirement_id`.

When satisfied, completion routes through the training-program progress updater
(`apply_test_pass_to_pipeline`), marking the requirement **COMPLETE** on the
candidate's active enrollment(s). Because it goes through the standard progress
updater, downstream effects run automatically: percentage recalculation,
requirement/phase completion, program-level rollup, and phase advancement.

A **failing** test (or a practice test, or a test with no `requirement_id`) has
**no** effect on the pipeline.

### 14.5 Attempt Limits _(2026-08-08)_

A `TrainingRequirement` may cap attempts (`max_attempts`). Until now only the
officer-entered **knowledge-test** path enforced that cap, so a candidate limited
to two attempts could be given a third skills evaluation and have the pass
credited to the pipeline.

`assert_attempts_remaining` now guards **both ends**:

- **On create** (`POST /tests`), so an examiner is refused _before_ running an
  evaluation that could not count — the expensive failure is the one discovered
  after the drill.
- **On complete** (`POST /tests/{id}/complete`), because several tests can be
  started before any is submitted, so the create-time check alone is not
  sufficient.

What counts as an attempt:

| Case                                                          | Consumes an attempt? | Why                                  |
| ------------------------------------------------------------- | -------------------- | ------------------------------------ |
| Completed, official, **validated**, not voided — pass or fail | **Yes**              | A failed attempt is an attempt       |
| Completed, official, **awaiting validation** (§19)            | No                   | It is a submission, not yet a record |
| Voided (`POST /tests/{id}/void`)                              | No                   | The department withdrew it           |
| Practice (`is_practice`)                                      | No                   | Never recorded, never credited       |
| Started but not completed                                     | No                   | Nothing was evaluated                |

> **Where the cap is spent moved (2026-08-08).** Opening the examiner role to
> every member (§6) means completion is no longer the moment a result counts.
> The cap is therefore **spent at validation** and enforced there, alongside the
> pipeline credit — a submission that is never validated never costs the
> candidate a chance. The create-time check remains, so an examiner is still
> refused before running an evaluation that could not count.

A requirement already **completed, verified or waived** is exempt, matching the
knowledge-test path — otherwise recertification testing against a satisfied
requirement would be impossible.

---
