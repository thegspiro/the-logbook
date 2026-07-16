# Training Programs Module

## Overview

The Training Programs module provides a comprehensive system for managing member training requirements, programs, and progress tracking. It supports multiple requirement types, phase-based progression, and integration with national/state training registries.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [User Roles](#user-roles)
3. [Features](#features)
4. [External Training Integration](#external-training-integration)
5. [Training Categories](#training-categories)
6. [Training Requirements](#training-requirements)
7. [Due Date Types](#due-date-types)
8. [Training Programs](#training-programs)
9. [Enrollment & Progress](#enrollment--progress)
10. [Member Experience](#member-experience)
11. [Training Officer Workflow](#training-officer-workflow)
12. [API Reference](#api-reference)
13. [Database Schema](#database-schema)
14. [Self-Reported Training](#self-reported-training)
15. [Shift Completion Reports](#shift-completion-reports)
16. [Member Training Page](#member-training-page-my-training)
17. [Member Visibility Configuration](#member-visibility-configuration)
18. [Training Reports](#training-reports)
19. [Cross-Module Integration Points](#cross-module-integration-points)
20. [Edge Cases & Special Handling](#edge-cases--special-handling)
21. [Recently Implemented Features](#recently-implemented-features)

---

## Core Concepts

### Training Requirements

Training requirements are individual training items that members must complete. They can be:
- **Hours-based**: Require a certain number of training hours
- **Course-based**: Require completion of specific courses
- **Certification-based**: Require obtaining certifications
- **Shift-based**: Require completing a number of shifts
- **Call-based**: Require responding to a number of calls
- **Skills evaluation**: Require demonstrating specific skills
- **Checklist**: Require completing a checklist of tasks
- **Knowledge test**: Require a passing score on a knowledge test (officer-entered score)

### Training Programs

Training programs are structured pathways that group requirements together. Programs can be:
- **Flexible**: Requirements can be completed in any order
- **Sequential**: Requirements must be completed in a specific order
- **Phase-based**: Requirements are organized into phases with prerequisites

### Enrollment

Members are enrolled in training programs to track their progress toward completion. Enrollments track:
- Current phase (for phase-based programs)
- Overall progress percentage
- Completion status
- Target completion date
- Deadline warnings

---

## User Roles

### Training Officer
- Create and manage training programs
- Set up requirements from registries or custom
- Enroll members in programs
- Monitor member progress
- Approve manual phase advancements
- Verify completed requirements

### Member
- View assigned training programs
- Track progress on requirements
- See next steps and upcoming deadlines
- View completed vs. pending requirements
- Receive notifications for milestones and deadlines

---

## Features

### ✅ Implemented Features

#### Registry Integration
- **NFPA Standards**: Firefighter I/II (1001), Driver/Operator (1002), Fire Officer (1021),
  Instructor (1041), Live Fire (1403), Occupational Safety (1500), Medical Fitness (1582),
  Hazmat/WMD Responder (1072), Technical Rescuer (1006), Fire Investigator (1033),
  Fire Inspector (1031), Fire & Life Safety Educator/PIO (1035), Wildland Fire Fighter (1051),
  and Fire Department Safety Officer (1521)
- **Pro Board**: Firefighter I/II, Driver/Operator, Fire Officer I/II, HazMat Ops, Instructor
- **NREMT by provider level** — separate, individually-importable registries so a
  department imports only the level(s) it staffs, each with the level's national
  recertification component (NCCR hours by topic area) plus the appropriate
  life-support certifications:
  - **EMR** — NREMR national component + CPR/BLS
  - **EMT** — NREMT national component + CPR/BLS + PHTLS
  - **Advanced EMT (AEMT / EMT-A)** — NRAEMT national component + BLS/ACLS/PALS/PHTLS
  - **Paramedic** — NRP national component + BLS/ACLS/PALS/PHTLS
- One-click import of registry requirements
- Department can customize imported requirements

#### Template System
- Save programs as reusable templates
- Duplicate templates with version tracking
- Independent copies for customization
- Version numbering (e.g., "Probationary Program v2")

#### Built-in Sample Templates
The **Templates** tab shows a *"Start from a sample template"* gallery with three
real-world-aligned starting points a training officer can add with one click:

| Template | Aligned to | Structure |
|----------|-----------|-----------|
| **Firefighter Recruit School** | NFPA 1001 Firefighter I & II, Hazmat Awareness/Operations (NFPA 1072), IFSAC/Pro Board certification | 4 phases (Orientation & Safety → Fireground Skills → Fire Attack & Live-Fire → Certification), officer-approved advancement on the safety and certification phases |
| **EMT Recruit School** | National EMS Education Standards / NREMT (Preparatory, Airway, Medical, Trauma, Operations), clinical/field internship, cognitive & psychomotor exams | 5 phases, officer-approved advancement on the certification phase |
| **New Member Orientation** | Department familiarization + mandatory annual compliance (HIPAA, OSHA Bloodborne Pathogens, Hazard Communication, harassment prevention) + department-specific onboarding | 3 phases |

These are curated in code (`backend/app/services/sample_program_templates.py`) and are
deliberately generic — requirements are *named* but do not hard-wire a department's own
course, category, or skills-test IDs. Adding a template replays the atomic program build
into your organization as an **editable, department-owned template** (it lands in the
Templates tab with `is_template=true`). Afterward the officer links its requirements to
their real sessions/categories/tests, adjusts hours, and enrolls members.

- `GET /training/programs/sample-templates` — gallery metadata
- `POST /training/programs/sample-templates/{key}/instantiate` — add to the org
  (optional body `{ "name": "…", "is_template": true }`)

#### Editing a Pipeline After Creation
A pipeline is fully editable from the program detail page (Overview tab), gated by
`training.manage`:

- **Program details** — name, description, code, structure, time limits, target
  position, template/active (`PATCH /training/programs/programs/{id}`).
- **Phases** — add, edit (name/description/time limit/manual-advance), reorder, and
  delete (`…/phases`, `…/phases/reorder`, `…/phases/{phase_id}`).
- **Requirements** — add, edit content/target, reorder within a phase, move between
  phases, and remove (`…/requirements`, `…/requirements/reorder`,
  `…/requirements/{prog_req_id}`). The **Required ↔ Optional** toggle is also inline.
- **Milestones** — add, edit, and delete (`…/milestones/{milestone_id}`).

**Destructive edits auto-clean enrolled members.** Deleting a phase or removing a
requirement clears only this program's enrolled members' progress for the affected
items, re-anchors anyone parked on a deleted phase to the first remaining phase, and
recomputes/re-advances their progress. Editing a requirement's numeric target
re-derives enrolled members' progress-row percentages against the new target.

- **Delete the whole pipeline** — a guarded "Delete" action in the program header
  (`DELETE /training/programs/programs/{id}`) permanently removes the program and all
  its phases, requirements, milestones, and enrollments. The UI shows a warning
  dialog (naming the pipeline and its enrolled-member count) first. This is
  irreversible — to retire a pipeline without losing history, set it **inactive** via
  the edit modal instead.

#### Program Prerequisites
- Set prerequisite programs (e.g., must complete "Recruit School" before "Driver Candidate")
- Automatic validation during enrollment
- Prevents enrollment if prerequisites not met

#### Enrollment Controls
- Concurrent enrollment restrictions (one program at a time, or multiple allowed)
- Bulk member enrollment with validation
- Custom target completion dates
- Enrollment notes
- **Eligibility-aware enroll picker** — the picker prechecks eligibility
  (`GET /training/programs/programs/{program_id}/eligibility`) and defaults to
  "Show eligible only". Members are marked **Eligible / Enrolled / Prerequisite /
  In another program** with the specific reason, so officers see who can be enrolled
  up front instead of hitting per-member errors on submit. The **hard gates** are
  already-enrolled (in this program) and unmet prerequisite programs. Being **active
  in another program** is a *soft advisory* only — the member stays eligible and
  selectable (a new member may be in several onboarding courses at once), just flagged
  "Also enrolled in another program". The program's target position/roles are advisory
  and never block.

#### Phase Management
- Multi-phase program structures
- Phase prerequisites
- Manual vs. automatic advancement (auto-advance stops at any phase flagged `requires_manual_advancement`)
- Manual advance endpoint with optional `force` override
- Phase-specific time limits

#### Progress Tracking
- Real-time progress calculation
- Completion percentage tracking (any completed/verified/waived requirement counts as 100%, including non-numeric types)
- Requirement-level progress with officer verification
- Enrollment rollup = average of required requirements' percentages, auto-completing at 100% (and re-opening if it later drops below 100%)
- Officer-entered knowledge-test scoring with pass/fail and attempt limits
- Automatic feeds from shift reports, approved training sessions, and skills tests
- Progress notes and history
- **Officer-gated completion:** members can mark a requirement in-progress, but
  only a training officer can set a numeric progress value, record a test score,
  or mark a requirement complete/verified/waived. Members log training through the
  self-report submission flow instead of writing their own requirement to 100%.
- **No double-crediting:** every automatic feed records each accrual in a per-source
  credit ledger keyed on (requirement, source type, source id). Replaying the same
  shift report, re-syncing the same external course, re-finalizing a session, or
  re-approving a submission is a no-op — one real training is never counted twice.

#### Recertification Cycle (Progress Reset)
Certifications that expire — NREMT, for example, requires resubmission every two
years — need a member's accumulated progress cleared so a fresh cycle can begin.
The pipeline supports both a manual and an automatic reset:

- **Manual reset (officer):** In a member's progress modal, **Reset** on a single
  requirement clears just that item; **Start new cycle** resets every requirement
  and returns the member to the first phase. Both are confirmed before running and
  require `training.manage`. Use this when a coordinator needs to reset a
  certificate that is close to or past expiry.
- **Automatic reset (stored deadline):** Enable **Recertification cycle** in the
  pipeline's Edit dialog and set a cycle length in months (e.g. 24 for NREMT's
  biennial recert). Optionally pin a fixed calendar anchor — a reset month and day
  (e.g. March 30) — so every cycle lands on that date; leave the anchor blank to
  roll forward from each member's enrollment date. Each enrollment then stores its
  next reset date. When that date passes, the enrollment is reset for a new cycle
  and the deadline advances to the following one. Resets apply lazily when a
  coordinator opens the member's progress, and a daily 5 AM scheduled sweep
  (`recert_resets`, or `POST /training/programs/recert/run-due` on demand) resets every
  past-due enrollment across the organization so members no one is actively watching still
  reset on time.

#### Leaving a Program (Self-Service Withdrawal)
A member can remove themselves from a program from their progression view via
**Leave program** — useful when they step down from a level they no longer need to
maintain (e.g. Paramedic → EMT), so the program stops cluttering their dashboard and
raising warnings that no longer apply. The withdrawal is soft: the enrollment moves to
`WITHDRAWN` (kept for history) and drops off the member's active dashboard. Officers
with `training.manage` can withdraw any member; a withdrawn member can be re-enrolled
later (`POST /training/programs/enrollments/{id}/withdraw`).

#### Certification-Eligible vs. Credit-Only Sessions
Training sessions carry a **"Counts toward certification requirements"** toggle (on by
default). Leave it on for sessions delivered in a way a certifying body (NFPA/NREMT)
accepts. Turn it off when a session should give members credit but isn't
certification-grade — for example, an informal recruit-school drill: attendance still
creates the training record and hours (counting toward general compliance), but the
session no longer feeds the linked pipeline/certificate requirements, keeping ineligible
hours off the member's certificate progress.

#### Atomic Program Build
- Create-pipeline wizard builds a program with all phases, requirements, and milestones in one transaction — a failure can't leave a half-built program behind

#### Milestone System
- Define completion milestones (e.g., 25%, 50%, 75%)
- Milestone notifications
- Officer verification requirements

#### Conditional Reminders
- Send reminders based on progress thresholds
- Configure days before deadline
- Only send if member is behind schedule (e.g., only remind if < 40% complete 90 days before deadline)

#### Member Dashboard Widget
- Shows top 3 active programs on dashboard
- Visual progress bars
- Next steps displayed
- Upcoming deadline warnings
- Click-through to detailed progress page

#### Self-Reported Training
- Members submit external training for officer review
- Configurable approval workflow (auto-approve, manual, by hours threshold)
- Customizable form fields (visible, required, label per field)
- Status tracking: draft, pending review, approved, rejected, revision requested
- Approved submissions automatically create TrainingRecords
- **Separation of duties:** an officer cannot approve their own self-reported
  training — a second officer must review it, so hours/credit can't be granted
  unchecked. (Rejecting or requesting revision on one's own submission is allowed.)
- **Apply to a pipeline requirement (make-up sessions):** when approving a submission —
  or later, from an already-approved submission's card — the officer can credit the
  training toward a specific requirement in one of the member's active enrollments. This
  covers make-up sessions that never had a scheduled training date. Hours requirements gain
  the approved hours, a course counts as one completion, and status-based requirements
  (certification / skills / checklist / knowledge test) are marked complete. It runs through
  the normal progress updater (so rollup and phase advancement fire) and, being an explicit
  officer sign-off, is **not** subject to the requirement's `allows_external_credit` opt-in
  (that flag only governs *automatic* crediting from provider syncs).

#### Correcting Mistakes (Void & Reverse)
Entries made in error can be undone without hand-editing progress:

- **Void a training record** (`DELETE /training/records/{id}`, `training.manage`)
  marks the record cancelled — kept for audit, never hard-deleted — and un-applies
  any pipeline credit it produced. The compliance engine only counts completed
  records, so a voided one stops counting immediately.
- **Reverse an approval**
  (`POST /training/submissions/{id}/reverse-approval`, `training.manage`) voids the
  record the approval spawned, un-applies the credit keyed on both the submission
  and the record, and returns the submission to **pending review** so it can be
  re-decided (rejected, or re-approved with corrected values).

Both build on the credit ledger, so requirement percentages, the enrollment
rollup, and phase state unwind automatically. Both are audit-logged.

#### Shift Completion Reports
- Shift officers file reports on trainee experiences
- Auto-updates pipeline requirement progress (shifts, calls, hours)
- Performance ratings, skill observations, officer narratives
- Trainee acknowledgment with comments
- Aggregate statistics per trainee

#### Member Training Page
- Personal training page (`/training/my-training`) for each member
- Shows training history, certifications, pipeline progress, shift reports, submissions
- Configurable visibility per department (14 toggle settings)
- Officers see all data; member view is controlled by TrainingModuleConfig
- Settings tab for officers to customize what members see

#### Training Reports
- Training Summary report with date range filtering
- Training Progress report showing pipeline enrollment status
- Annual Training Report with comprehensive member breakdown
- Customizable reporting period (This Year, Last Year, Last 90 Days, Custom)

#### External Training Integration
- Connect to external training platforms (Vector Solutions, Target Solutions, Lexipol, I Am Responding)
- Automatic sync of completed training records
- Category and user mapping between systems
- Import external records as TrainingRecords
- Sync history and audit logging
- Configurable sync schedules

---

## External Training Integration

The External Training Integration feature allows organizations to connect to external training platforms and automatically import completed training records into The Logbook.

### Supported Providers

| Provider | Description |
|----------|-------------|
| **Vector Solutions** | Fire and EMS online training platform with comprehensive course library |
| **Target Solutions** | Public safety training, compliance tracking, and recordkeeping |
| **Lexipol** | Policy acknowledgment, training bulletins, and compliance training |
| **I Am Responding** | Response tracking with integrated training documentation |
| **Custom API** | Connect to any training platform with a compatible REST API |

### Setting Up an Integration

1. Navigate to **Training** → **Integrations** tab
2. Click **Add Provider**
3. Select the provider type
4. Enter connection details:
   - **Display Name**: Friendly name for this integration
   - **API Base URL**: The API endpoint URL
   - **API Key**: Your API credentials
   - **Authentication Type**: API Key, Basic Auth, or OAuth 2.0
5. Configure sync settings:
   - **Auto-Sync**: Enable/disable automatic synchronization
   - **Sync Interval**: How often to sync (6h, 12h, 24h, 48h, weekly)
6. Click **Test Connection** to verify
7. Save the provider

### Sync Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  1. Configure Provider with API credentials                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Test Connection to verify API access                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Trigger Sync (manual or automatic)                      │
│     - Full: All records from past year                      │
│     - Incremental: Only new records since last sync         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Records fetched and stored as External Training Imports │
│     - Course title, duration, completion date               │
│     - External user and category information                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Auto-Mapping attempts to match:                         │
│     - Users by email address                                │
│     - Categories by name                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  6. Review and fix unmapped users/categories                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  7. Import records as Training Records                      │
│     - Creates official training history                     │
│     - Links to mapped user and category                     │
│     - Advances matching pipeline requirements (by category) │
└─────────────────────────────────────────────────────────────┘
```

> **Imported courses can feed training pipelines — when you opt a requirement in.**
> Each requirement has an **"Accept external / imported training credit"** toggle
> (off by default). Leave it off for competencies the department wants delivered
> in-house (e.g. a hands-on radios drill), and a matching Vector Solutions course
> will *not* check it off — only an in-house session, a skills test, or manual
> sign-off will. Turn it on for requirements where online/third-party delivery is
> acceptable (e.g. HIPAA CE): then, when a record is imported, for each of the
> member's **active** enrollments a matching HOURS requirement is advanced by the
> record's hours and a COURSES requirement by one completion — through the same
> machinery as an in-app session (percentage, auto-completion, rollup, and phase
> advancement all run). The toggle is offered for hours- and course-type
> requirements; types that need human sign-off (skills evaluations, certifications,
> checklists, knowledge tests) are always left for an officer. Correct **category
> mapping** is what routes an imported course to the right requirement, so map
> external categories to the internal categories your requirements use.

### Managing Mappings

After syncing, you may need to map external users and categories to your internal records.

#### User Mapping
- External users are auto-mapped by email when possible
- Unmapped users appear in the "Users" tab under Mappings
- Click "Map User" to select the corresponding internal member
- Once mapped, all training for that external user will apply to the member

#### Category Mapping
- External categories are auto-mapped by name when possible
- Unmapped categories appear in the "Categories" tab under Mappings
- Click "Map Category" to select the corresponding internal category
- Categories determine how imported training counts toward requirements

### Import Queue

The Import Queue shows all fetched records pending import:
- **Pending**: Ready to import (user mapped)
- **Skipped**: No user mapping available
- **Imported**: Successfully created TrainingRecord
- **Failed**: Error during import

Use **Bulk Import** to import all pending records at once, or import individual records selectively.

### Sync History

View sync history for each provider:
- Sync type (full, incremental, manual)
- Records fetched, imported, updated, skipped, failed
- Start and end times
- Error messages if sync failed

---

## Training Categories

Training categories provide a hierarchical way to organize training courses and requirements. Categories help training officers group related training topics and allow requirements to be satisfied by any training within specified categories.

### Category Features

- **Hierarchical Structure**: Categories can have parent-child relationships for nested organization
- **Visual Customization**: Each category can have a color and icon for easy identification in the UI
- **Flexible Assignment**: Courses and requirements can belong to multiple categories
- **Category-Based Requirements**: Requirements can accept training from any course in specified categories

### Example Category Structure

```
🔥 Firefighting
   ├── Structural Firefighting
   ├── Wildland Firefighting
   └── Fire Prevention/Investigation

🏥 Emergency Medical Services
   ├── Basic Life Support (BLS)
   ├── Advanced Life Support (ALS)
   └── Pediatric/Specialty Care

☢️ Hazardous Materials
   ├── Awareness Level
   ├── Operations Level
   └── Technician Level

🚒 Apparatus Operations
   ├── Pumper Operations
   ├── Aerial Operations
   └── Specialized Vehicles
```

### Creating Categories

1. Navigate to **Training** → **Requirements** tab
2. Click the **Categories** section
3. Click **Add Category**
4. Fill in category details:
   - **Name**: Display name for the category
   - **Code**: Short code (e.g., "FF", "EMS", "HAZ")
   - **Description**: Detailed description
   - **Color**: Hex color for UI display
   - **Icon**: Icon identifier
   - **Parent Category**: For nested categories (optional)
   - **Sort Order**: Display order within parent

### Using Categories with Requirements

When creating a requirement, you can specify which categories satisfy the requirement:

```
Requirement: Annual Fire Training (24 hours)
Categories: Firefighting, Apparatus Operations

→ Any training hours logged in courses belonging to "Firefighting"
  or "Apparatus Operations" categories count toward this requirement
```

This allows flexible tracking where members can complete various courses that all contribute to meeting a single requirement.

---

## Due Date Types

Training requirements support flexible due date calculations to match different organizational needs. The system supports four due date types:

### 1. Calendar Period (Default)

Training is due by the end of a specified calendar period. This is ideal for annual requirements that align with calendar or fiscal years.

**Configuration:**
- `period_start_month`: Month when the period starts (1-12)
- `period_start_day`: Day when the period starts (1-31)

**Examples:**

| Use Case | Start Month | Start Day | Due Date |
|----------|-------------|-----------|----------|
| Calendar Year | January (1) | 1 | December 31 |
| Fiscal Year (July-June) | July (7) | 1 | June 30 |
| Academic Year (Sept-Aug) | September (9) | 1 | August 31 |
| Q1 Deadline | January (1) | 1 | March 31 |

**How it works:**
- If current date is before the period start, due date is end of current period
- If current date is after period start, due date is end of next period
- Completion resets the cycle for the next period

### 2. Rolling

Training is due X months from the date of last completion. This is ideal for certifications that must be renewed at regular intervals regardless of when they were obtained.

**Configuration:**
- `rolling_period_months`: Number of months between required completions

**Examples:**

| Certification | Rolling Period | If Completed Jan 15, 2026 |
|--------------|----------------|---------------------------|
| CPR/BLS | 24 months | Due: Jan 15, 2028 |
| ACLS | 24 months | Due: Jan 15, 2028 |
| Annual Physical | 12 months | Due: Jan 15, 2027 |
| Quarterly Drill | 3 months | Due: Apr 15, 2026 |

**How it works:**
- Due date = Last completion date + Rolling period months
- If never completed, due date is immediate (or based on enrollment date)
- Each completion resets the countdown from the new completion date

### 3. Certification Period

Training is due when the associated certification expires. This ties the requirement directly to an external certification's validity period.

**Use Cases:**
- EMT certification renewal
- Paramedic license renewal
- State firefighter certification
- CDL medical card renewal

**How it works:**
- Due date matches the expiration date of the linked certification
- When certification is renewed, due date automatically updates
- Useful for requirements that must match external regulatory timelines

### 4. Fixed Date

Training is due by a specific, unchanging date. This is ideal for one-time requirements or requirements with hard external deadlines.

**Use Cases:**
- Grant-mandated training deadlines
- New regulation compliance dates
- Probationary period milestones
- Specific event preparation

**How it works:**
- Due date is set once and does not change
- Typically used for non-recurring requirements

### Choosing the Right Due Date Type

| Scenario | Recommended Type | Why |
|----------|------------------|-----|
| "Complete 24 hours by year end" | Calendar Period | Aligns with reporting cycles |
| "Recertify CPR every 2 years" | Rolling | Based on individual completion dates |
| "Keep EMT cert current" | Certification Period | Matches external cert expiration |
| "Complete by grant deadline" | Fixed Date | Hard external deadline |
| "Quarterly training drills" | Calendar Period | Recurring calendar-based |
| "Physical fitness test annually" | Rolling | Individual anniversary dates |

---

## Training Requirements

### Requirement Types

#### 1. Hours-Based Requirements
Track cumulative training hours.

```json
{
  "requirement_type": "hours",
  "required_hours": 100,
  "due_date_type": "calendar_period",
  "period_start_month": 1,
  "period_start_day": 1,
  "category_ids": ["firefighting-uuid", "ems-uuid"]
}
```

**With Rolling Due Date:**
```json
{
  "requirement_type": "hours",
  "required_hours": 24,
  "due_date_type": "rolling",
  "rolling_period_months": 12
}
```

#### 2. Course-Based Requirements
Require completion of specific courses.

```json
{
  "requirement_type": "courses",
  "required_courses": ["firefighter-i-course-uuid", "firefighter-ii-course-uuid"]
}
```

> `required_courses` is a flat array of course-ID strings (not objects). The
> compliance evaluator matches a member's completed `course_id` against these
> values directly.

#### 3. Certification Requirements
Require obtaining certifications.

```json
{
  "requirement_type": "certification",
  "required_certifications": ["CPR", "EMT"],
  "due_date_type": "certification_period"
}
```

**With Rolling Recertification:**
```json
{
  "requirement_type": "certification",
  "required_certifications": ["CPR"],
  "due_date_type": "rolling",
  "rolling_period_months": 24,
  "category_ids": ["bls-uuid"]
}
```

#### 4. Shift Requirements
Require completing a number of shifts.

```json
{
  "requirement_type": "shifts",
  "required_shifts": 24,
  "time_limit_days": 180
}
```

#### 5. Call Requirements
Require responding to calls/incidents.

```json
{
  "requirement_type": "calls",
  "required_calls": 50,
  "required_call_types": ["structure_fire", "ems", "mva"]
}
```

#### 6. Skills Evaluation
Require demonstrating skills with officer evaluation.

```json
{
  "requirement_type": "skills_evaluation",
  "required_skills": ["scba-donning-skill-uuid", "ladder-throw-skill-uuid"]
}
```

> `required_skills` (like `required_courses` and `required_roles`) is a flat
> array of ID/slug strings, not objects.

#### 7. Checklist Requirements
Require completing a checklist of tasks.

```json
{
  "requirement_type": "checklist",
  "checklist_items": [
    "Complete station tour",
    "Review SOPs",
    "Equipment familiarization"
  ]
}
```

#### 8. Knowledge Test Requirements
Require a passing score on a knowledge test. Scoring is lightweight and
**officer-entered** — an officer records a `test_score` (0-100) via the progress
endpoint; the system derives pass/fail from `passing_score` (default 70) and
enforces `max_attempts`.

```json
{
  "requirement_type": "knowledge_test",
  "passing_score": 80,
  "max_attempts": 3
}
```

> There is no built-in test-taking engine (question bank, delivery, auto-grading)
> yet — see [Remaining Planned Features](#remaining-planned-features). The current
> support records officer-entered scores and attempt history only.

### Requirement Sources

- **Department**: Custom requirements created by the training officer
- **State**: State-mandated requirements
- **National**: National registry requirements (NFPA, NREMT, Pro Board)

### Customizing Registry Requirements

Registry requirements are editable by default. Training officers can:
- Modify time limits
- Add program-specific descriptions
- Set custom deadlines
- Add prerequisite flags
- Change sort order

---

## Training Programs

### Program Structure Types

#### Flexible Programs
Members can complete requirements in any order.

**Use case**: Annual continuing education requirements

#### Sequential Programs
Requirements must be completed in order.

**Use case**: Progressive skill development programs

#### Phase-Based Programs
Requirements organized into phases with prerequisites.

**Use case**: Probationary firefighter program (Orientation → Skills → Certification)

### Creating a Program

```typescript
const program = {
  name: "Probationary Firefighter Program",
  description: "Complete training path for probationary members",
  target_position: "probationary",
  structure_type: "phases",
  time_limit_days: 365,
  warning_days_before: 30,
  prerequisite_program_ids: [], // No prerequisites for entry-level
  allows_concurrent_enrollment: false, // Only one at a time
  reminder_conditions: {
    milestone_threshold: 50,
    days_before_deadline: 90,
    send_if_below_percentage: 40
  }
};
```

### Adding Phases

```typescript
const phase1 = {
  program_id: programId,
  phase_number: 1,
  name: "Orientation",
  description: "Initial orientation and safety training",
  prerequisite_phase_ids: [],
  requires_manual_advancement: false, // Auto-advance when complete
  time_limit_days: 30
};

const phase2 = {
  program_id: programId,
  phase_number: 2,
  name: "Skills Development",
  description: "Hands-on skills training and evaluation",
  prerequisite_phase_ids: [phase1.id],
  requires_manual_advancement: true, // Officer must approve
  time_limit_days: 180
};
```

### Adding Requirements to Program

```typescript
const programRequirement = {
  program_id: programId,
  phase_id: phase1Id, // Or null for program-level
  requirement_id: requirementId,
  is_required: true,
  is_prerequisite: false,
  sort_order: 1,
  program_specific_description: "Complete within first 30 days",
  custom_deadline_days: 30,
  notification_message: "Welcome! Please complete orientation materials."
};
```

### Adding Milestones

```typescript
const milestone = {
  program_id: programId,
  phase_id: null, // Program-level milestone
  name: "Halfway Point",
  description: "Completed 50% of requirements",
  completion_percentage_threshold: 50,
  notification_message: "Great progress! You're halfway through the program.",
  requires_verification: false
};
```

---

## Enrollment & Progress

### Enrolling Members

#### Single Enrollment

```typescript
const enrollment = {
  user_id: memberId,
  program_id: programId,
  target_completion_date: "2026-12-31",
  notes: "Started as probationary member on Jan 22, 2026"
};
```

> The program detail page's **Enrollments tab** lists enrolled members **by name**
> (via `GET /programs/{program_id}/enrollments`) with their progress, and the
> single-enroll flow uses a **searchable member picker** rather than raw UUIDs.

#### Bulk Enrollment

```typescript
const bulkEnrollment = {
  user_ids: [memberId1, memberId2, memberId3],
  target_completion_date: "2026-12-31"
};

const response = await api.post(
  `/training/programs/programs/${programId}/bulk-enroll`,
  bulkEnrollment
);

// Response includes success count and any errors
console.log(`Enrolled ${response.success_count} members`);
console.log(`Errors: ${response.errors}`);
```

> Bulk enrollment now correctly **blocks** members that fail the prerequisite or
> concurrent-enrollment checks (these were previously bypassed on the bulk path);
> such members are returned in the `errors` list instead of being enrolled.

### Tracking Progress

Officers open an enrollment and update each requirement via
`PATCH /progress/{progress_id}` (`RequirementProgressUpdate`). A single call can:
set the status, log a numeric `progress_value`, record a `test_score`, and/or
apply officer verification.

```typescript
const progress = {
  enrollment_id: enrollmentId,
  requirement_id: requirementId,
  status: "in_progress", // not_started, in_progress, completed, waived
  progress_value: 45, // e.g., 45 hours, 45 shifts, etc.
  progress_percentage: 45, // Calculated automatically
  progress_notes: {
    "2026-01-22": "Completed 8 hours of training",
    "2026-01-29": "Completed additional 12 hours"
  }
};
```

**How percentages are computed:**

- **Numeric types** (hours, shifts, calls): `progress_value / required × 100`
  (waiver-adjusted where applicable), auto-completing at 100%.
- **Courses**: `completed course count / len(required_courses) × 100`,
  auto-completing at 100%. (Course-count requirements are not waiver-adjusted.)
- **Non-numeric types** (checklist, skills_evaluation, certification,
  knowledge_test): marking the requirement `completed`, `verified`, or `waived`
  sets its `progress_percentage` to 100 directly — so these advance the rollup
  even though they carry no numeric value. Previously only numeric types could
  move progress off 0%.
- **Enrollment rollup**: the enrollment's overall percentage is the **average of
  its _required_ requirements' percentages**. It auto-completes at 100% and, if a
  completed enrollment later drops below 100% (e.g. a new required requirement is
  added or an over-count is corrected down), it **re-opens to `active`**.

#### Knowledge-Test Scoring

For `knowledge_test` requirements, an officer submits a `test_score` (0-100):

- Pass/fail is derived from the requirement's `passing_score` (default **70**).
- The raw score plus attempt history are recorded in `progress_notes`
  (`test_attempts`, `latest_score`, `passing_score`, `passed`).
- A **pass** completes the requirement (which then rolls up and can advance the
  phase); a **fail** is recorded and leaves the requirement `in_progress`.
- `max_attempts` is enforced: once attempts are exhausted and the requirement is
  not yet satisfied, further scores are rejected.

```http
PATCH /api/v1/training/programs/progress/{progressId}
Content-Type: application/json

{ "test_score": 82 }
```

### Phase Advancement

After **every** progress update the enrollment auto-advances through any
**consecutive complete phases** (`_is_phase_complete` = all _required_
requirements in the phase at 100%), **stopping** at any phase flagged
`requires_manual_advancement`. This runs as a no-op for non-phased programs and
enrollments without a current phase. When a phase is advanced, the (previously
unused) phase-advancement notification is sent to the member.

#### Manual Phase Advancement

For phases with `requires_manual_advancement: true`, a training officer must
advance the member explicitly:

```http
POST /api/v1/training/programs/enrollments/{enrollmentId}/advance-phase?force=false
```

- By default the current phase's required requirements must be complete;
  `force=true` overrides that gate.
- Errors if the enrollment is already at the final phase, or the program is not
  phase-based.

### Automatic Feeds into Pipeline Progress

Every automatic source routes through the same `update_requirement_progress`
path, so the percentage math, auto-completion, enrollment rollup, and
phase-advancement all run consistently:

- **Shift completion reports** → shifts / calls / hours / skills_evaluation
  requirements (see [Shift Completion Reports](#shift-completion-reports)).
- **Training session approval** → the session's linked requirement (when the
  session carries `program_id` + `requirement_id`), **or**, when the session is
  linked to a program and a **category** (`category_id`, no `requirement_id`),
  it **fans out** to that program's requirements tagged with the category. This
  is applied **after** the approval + records commit. (This fixes the prior bug
  where session attendance bumped a raw value but never computed a percentage, so
  the pipeline still read 0%.)
- **Skills test pass** → marks the linked `skills_evaluation` requirement
  complete (see [Skills Testing Module](#skills-testing-module)).

---

## Member Experience

### Dashboard Widget

Members see a training progress widget on their dashboard showing:
- Top 3 active programs
- Progress percentage with color-coded bars
- Next 1-2 steps/requirements
- Upcoming deadline warnings
- Click-through to detailed view

### Detailed Progress View

The full progress page shows:
- All enrolled programs
- Overall progress percentage
- Time remaining to deadline
- Current phase (for phase-based programs)
- All requirements grouped by phase
- Individual requirement progress bars
- Completed vs. pending status
- Next milestones
- Behind schedule warnings

### Student Progression View

Members have a read-only progression view at `/training/my-progress/:enrollmentId`
(linked from the **My Training** page). It reuses `GET /enrollments/{id}` (members
may read their own enrollment) and shows:
- Current phase and overall progress percentage
- Time remaining / behind-schedule status
- Next milestones
- Requirements grouped by phase, with a **"You are here"** marker on the current phase

### Next Steps Logic

**Flexible Programs**: Shows any incomplete required requirements

**Sequential Programs**: Shows the next requirement in sequence

**Phase-Based Programs**: Shows incomplete requirements in current phase

### Deadline Warnings

- **Green** (90+ days): On track
- **Yellow** (30-89 days): Attention needed
- **Red** (< 30 days): Urgent

---

## Training Officer Workflow

### 1. Set Up Categories (Optional but Recommended)

Categories help organize your training and allow flexible requirement satisfaction.

1. Navigate to **Training** → **Requirements** tab
2. Click **Manage Categories**
3. Create your category hierarchy:
   - Start with top-level categories (Firefighting, EMS, HazMat)
   - Add sub-categories as needed
   - Assign colors and icons for visual identification
4. Categories can be assigned to courses and requirements

### 2. Set Up Requirements

#### Option A: Import from Registry
1. Navigate to Training Programs → Requirements tab
2. Click a registry button — "Import NFPA", "Import Pro Board", or an NREMT provider
   level ("Import NREMT — EMR / EMT / Advanced EMT (AEMT) / Paramedic")
3. A picker opens listing that registry's requirements. **Tick exactly the ones you
   want** (everything not already in your library is pre-selected; requirements you've
   already imported are shown as "Imported" and locked out). Use "Select all / Clear
   all" to bulk-toggle.
4. Click "Import N" to add just the selected requirements
5. Customize as needed (including due date types)

**Connecting courses to section-based requirements.** Some registry requirements
(e.g. the NREMT provider levels) distribute their hours across **topic-area sections**
— Airway, Cardiology, Trauma, Medical, Operations. Importing one of these:

1. Auto-creates a **training category per section** (deduped by registry code) if the
   org doesn't already have it, and links the requirement to those categories. The
   import picker shows each requirement's sections, and the result reports how many
   categories were created.
2. To make a course count toward a section, edit the course (Course Library) and tag it
   with the matching section category. Sessions and training records tagged with that
   category count too.

The compliance engine sums only the hours whose category matches the requirement's
linked categories, so tagging your Airway course with the "Airway…" category makes its
hours count toward that requirement's Airway section.

#### Option B: Create Custom Requirement
1. Click "Create Requirement"
2. Fill in details:
   - Name and description
   - Requirement type (hours, shifts, etc.)
   - Source (department)
   - **Due Date Type** (Calendar Period, Rolling, Certification Period, or Fixed Date)
   - **Due Date Configuration**:
     - For Calendar Period: Set period start month and day
     - For Rolling: Set rolling period in months
   - **Categories** (optional): Select categories that satisfy this requirement
   - Applicability (positions/roles)

#### Option C: Use Requirement Templates
1. Click "Use Template" on the Requirements page
2. Choose from the built-in templates for common standards:
   - **NFPA 1001 Firefighter Annual Training** (36 hrs, annual, calendar period)
   - **NFPA 1500 Occupational Safety Training** (8 hrs, annual, calendar period)
   - **NREMT EMT Recertification** (40 hrs, 24-month rolling period)
   - **CPR/BLS Certification** (certification, 24-month rolling period)
   - **Hazmat Operations Refresher** (8 hrs, annual — OSHA 29 CFR 1910.120)
   - **Bloodborne Pathogens Annual Refresher** (2 hrs, annual — OSHA 29 CFR 1910.1030)
   - **HIPAA Privacy & Security Awareness** (1 hr, annual — 45 CFR 164.530(b))
   - **SCBA Fit Test & Respiratory Protection** (checklist, annual — OSHA 29 CFR 1910.134)
   - **NIMS/ICS Initial Certification** (ICS-100/200, IS-700/800 courses, one-time)
   - **New Member Orientation Checklist** (checklist, one-time, probationary members)
3. Selecting a template opens the create form pre-filled — review and adjust
   the hours, due date configuration, and assignment before saving. Templates
   based on national standards carry NFPA/NREMT/OSHA/HIPAA/FEMA source
   attribution automatically.

### 2. Create Training Program

#### Option A: Create from Scratch
1. Navigate to Training Programs → Programs tab
2. Click "New Program"
3. Fill in program details:
   - Name and description
   - Target position
   - Structure type
   - Time limits
   - Prerequisite programs
   - Concurrent enrollment settings

#### Option B: Duplicate from Template
1. Find existing template/program
2. Click "Duplicate"
3. Enter new name
4. System creates independent copy with version increment

### 3. Configure Program Structure

#### For Phase-Based Programs:
1. Add phases in order
2. Set prerequisites for each phase
3. Configure manual advancement if needed
4. Add requirements to each phase
5. Set phase-specific time limits

#### For All Programs:
1. Add requirements to program
2. Set requirement order/priority
3. Add custom descriptions
4. Configure deadlines
5. Set up milestones

### 4. Enroll Members

#### Single Enrollment:
1. Navigate to program
2. Click "Enroll Member"
3. Select member
4. Set target completion date
5. Add notes

#### Bulk Enrollment:
1. Navigate to program
2. Click "Bulk Enroll"
3. Select multiple members
4. Set target completion date
5. System validates prerequisites
6. System checks concurrent enrollment restrictions
7. View success/error report

### 5. Monitor Progress

#### Program-Level View:
- Number of enrolled members
- Average completion percentage
- Members behind schedule
- Upcoming deadlines

#### Member-Level View:
- Individual progress percentage
- Completed requirements
- Pending requirements
- Time remaining
- Next steps

### 6. Verify & Approve

#### Verify Completions:
1. Review submitted requirement completions
2. Check supporting documentation
3. Verify or request corrections
4. Add verification notes

#### Approve Phase Advancements:
1. Review phase completion
2. Evaluate readiness for next phase
3. Approve or request additional training
4. Member automatically advances

---

## API Reference

### Programs

#### Create Program
```http
POST /api/v1/training/programs/programs
Content-Type: application/json

{
  "name": "Program Name",
  "description": "Description",
  "structure_type": "phases",
  "time_limit_days": 365,
  "prerequisite_program_ids": ["uuid"],
  "allows_concurrent_enrollment": false
}
```

#### Build Program (atomic)
Create a program together with all of its phases, requirements, and milestones in
a single transaction (backs the create-pipeline wizard). Program `code` and
`version`, and each phase's `requires_manual_advancement`, are persisted and
returned (these were previously silently dropped). Requires `training.manage`.

```http
POST /api/v1/training/programs/programs/build
Content-Type: application/json

{
  "name": "Probationary Firefighter Program",
  "code": "PROBIE",
  "version": 2,
  "structure_type": "phases",
  "phases": [
    { "phase_number": 1, "name": "Orientation", "requires_manual_advancement": false, "requirements": [], "milestones": [] }
  ]
}
```

#### Get Program Details
```http
GET /api/v1/training/programs/programs/{programId}
```

#### Duplicate Program
```http
POST /api/v1/training/programs/programs/{programId}/duplicate?new_name=Program%20v2&increment_version=true
```

### Requirements

#### Create Requirement
```http
POST /api/v1/training/programs/requirements
Content-Type: application/json

{
  "name": "Requirement Name",
  "requirement_type": "hours",
  "required_hours": 100,
  "source": "department"
}
```

#### Import Registry
```http
POST /api/v1/training/programs/requirements/import/nfpa?skip_existing=true
```

### Enrollment

#### Enroll Member
```http
POST /api/v1/training/programs/enrollments
Content-Type: application/json

{
  "user_id": "uuid",
  "program_id": "uuid",
  "target_completion_date": "2026-12-31"
}
```

#### Bulk Enroll
```http
POST /api/v1/training/programs/programs/{programId}/bulk-enroll
Content-Type: application/json

{
  "user_ids": ["uuid1", "uuid2"],
  "target_completion_date": "2026-12-31"
}
```

#### List Program Enrollments
Returns each enrollment with the member's name and progress. Requires
`training.view_all` OR `training.manage`.
```http
GET /api/v1/training/programs/programs/{programId}/enrollments?status=active
```

#### Get Member Progress
```http
GET /api/v1/training/programs/enrollments/{enrollmentId}
```

#### Advance Phase (manual)
Advances the enrollment to the next phase. Requires the current phase to be
complete unless `force=true`. Requires `training.manage`.
```http
POST /api/v1/training/programs/enrollments/{enrollmentId}/advance-phase?force=false
```

### Progress

#### Update Requirement Progress
Set status, log a numeric `progress_value`, record a knowledge-test `test_score`
(0-100), and/or apply officer verification. Officers (`training.manage`) may
update any member's progress; other users may only update their own.
```http
PATCH /api/v1/training/programs/progress/{progressId}
Content-Type: application/json

{
  "status": "in_progress",
  "progress_value": 45,
  "test_score": 82,
  "progress_notes": {"2026-01-22": "Completed training"}
}
```

---

## Database Schema

### Key Tables

#### `training_categories`
- id, organization_id, name, code
- description, color, icon
- parent_category_id (self-referential for hierarchy)
- sort_order, active
- created_at, updated_at, created_by

#### `training_programs`
- id, organization_id, name, description
- version, code
- target_position, target_roles
- structure_type (flexible, sequential, phases)
- prerequisite_program_ids
- allows_concurrent_enrollment
- time_limit_days, warning_days_before
- reminder_conditions (JSONB)
- is_template, active

#### `program_phases`
- id, program_id, phase_number, name
- prerequisite_phase_ids
- requires_manual_advancement
- time_limit_days

#### `training_requirements`
- id, organization_id, name, description
- requirement_type (hours, courses, shifts, calls, etc.)
- source (department, state, national)
- registry_name, registry_code
- required_hours, required_shifts, required_calls, etc.
- **passing_score** (for knowledge_test — default 70 when unset)
- **max_attempts** (for knowledge_test — attempt cap)
- frequency, time_limit_days
- applies_to_all, required_positions, required_roles
- **due_date_type** (calendar_period, rolling, certification_period, fixed_date)
- **rolling_period_months** (for rolling due dates)
- **period_start_month** (1-12, for calendar period)
- **period_start_day** (1-31, for calendar period)
- **category_ids** (JSONB array of category UUIDs)

#### `training_courses`
- id, organization_id, name, code
- training_type, duration_hours, credit_hours
- prerequisites, expiration_months
- **category_ids** (JSONB array of category UUIDs)

#### `program_requirements`
- id, program_id, phase_id, requirement_id
- is_required, is_prerequisite
- sort_order
- program_specific_description
- custom_deadline_days
- notification_message

#### `program_milestones`
- id, program_id, phase_id
- name, description
- completion_percentage_threshold
- notification_message
- requires_verification

#### `program_enrollments`
- id, user_id, program_id
- enrolled_at, target_completion_date
- current_phase_id
- progress_percentage
- status (active, completed, on_hold, withdrawn, failed)
- completed_at, deadline_warning_sent

#### `requirement_progress`
- id, enrollment_id, requirement_id
- status (not_started, in_progress, completed, waived)
- progress_value, progress_percentage
- progress_notes (JSONB)
- started_at, completed_at
- verified_by, verified_at

---

## Best Practices

### For Training Officers

1. **Start with Templates**: Use existing templates and customize rather than starting from scratch
2. **Set Realistic Deadlines**: Give members adequate time to complete requirements
3. **Use Milestones**: Break long programs into milestones for motivation
4. **Monitor Regularly**: Check member progress weekly
5. **Provide Feedback**: Use progress notes to give constructive feedback
6. **Verify Thoroughly**: Don't just check boxes - ensure competency

### For Department Administrators

1. **Import Registries First**: Get standard requirements from national registries
2. **Customize Thoughtfully**: Only modify registry requirements when necessary
3. **Set Prerequisites**: Ensure proper progression through training levels
4. **Bulk Enroll**: Use bulk enrollment for cohorts starting together
5. **Review Reports**: Regularly review program effectiveness
6. **Update Templates**: Keep templates current with changing requirements

### For Members

1. **Check Dashboard Daily**: Stay aware of upcoming deadlines
2. **Complete Prerequisites First**: Focus on prerequisite requirements
3. **Track Progress**: Update your progress regularly
4. **Ask Questions**: Reach out to training officer if unclear
5. **Plan Ahead**: Don't wait until the last minute
6. **Document Everything**: Keep records of completed training

---

## Troubleshooting

### Common Issues

**Q: Member can't enroll in program**
- Check prerequisite program completion
- Verify concurrent enrollment settings
- Ensure program is active

**Q: Progress not updating**
- Verify requirement is linked to program
- Check that progress value matches requirement type
- Ensure officer has verified completion

**Q: Reminder not sent**
- Check reminder_conditions configuration
- Verify member is below threshold percentage
- Check days_before_deadline setting

**Q: Can't advance to next phase**
- Check if phase requires manual advancement
- Verify all prerequisites completed
- Ensure previous phase is 100% complete

### Category Issues

**Q: Category not appearing in dropdown**
- Verify category is marked as active
- Check that category belongs to your organization
- Refresh the page to load latest categories

**Q: Training not counting toward category-based requirement**
- Verify the course is assigned to one of the requirement's categories
- Check that the training record status is "completed"
- Ensure the training date is within the current requirement period

**Q: Can't delete a category**
- Categories with assigned courses or requirements cannot be deleted
- Remove category assignments first, or deactivate the category instead
- Child categories must be removed or reassigned before deleting parent

### Due Date Issues

**Q: Due date showing wrong date for calendar period**
- Verify `period_start_month` and `period_start_day` are set correctly
- Remember: period start defines when the NEW period begins, not when it ends
- Example: January 1 start means due December 31

**Q: Rolling due date not updating after completion**
- Ensure the training record has a `completion_date` set
- Verify the record status is "completed"
- Check that `rolling_period_months` is configured on the requirement

**Q: Member shows compliant but due date is past**
- For rolling requirements, the due date is calculated from last completion
- If never completed, member is immediately non-compliant
- Check if there's a grace period configured

**Q: Calendar period requirement due date is in the past**
- If current date is past the period end, member is non-compliant for the current period
- They need to complete training to become compliant for the next period
- Due date will update to next period after completion

**Q: Certification period requirement has no due date**
- Ensure the member has an associated certification record
- The certification must have an expiration date
- Link the training record to the certification if not auto-linked

---

## Self-Reported Training

Members can submit their own training records for officer review and approval.

### How It Works

1. Member navigates to **Training** → **Submit Training** (or **My Training** → **Submit Training**)
2. Fills out the training form (fields are configurable per department)
3. Submission enters **Pending Review** status
4. Training officer reviews on the **Review Submissions** page
5. Officer can **Approve**, **Reject**, or **Request Revision**
6. On approval, a `TrainingRecord` is automatically created
7. Member is notified of the decision

### Configuration

Each department can customize:
- **Approval Settings**: Require approval, auto-approve under X hours, review deadline
- **Notification Settings**: Notify officer on submit, notify member on decision
- **Field Visibility**: Toggle which fields are visible, required, or optional
- **Allowed Training Types**: Restrict which types members can self-report
- **Maximum Hours**: Cap hours per submission
- **Member Instructions**: Custom instructions displayed on the form

Navigate to **Training** → **Review Submissions** → **Settings** tab to configure.

### API Endpoints

```http
POST   /api/v1/training/submissions                  Submit training (member)
GET    /api/v1/training/submissions/my               Member's own submissions
POST   /api/v1/training/submissions/{id}/review       Approve/reject (officer)
GET    /api/v1/training/submissions/config             Get config
PUT    /api/v1/training/submissions/config             Update config (officer)
```

---

## Shift Completion Reports

Shift officers submit reports on trainee experiences after each shift. These reports feed into pipeline requirement progress for shift, call, and hour-based requirements. Reports can be auto-created as drafts during shift finalization or manually filed by officers. *(Updated 2026-03-28)*

### Report Contents

- **Shift Details**: Date, hours on shift, calls responded, call types — auto-populated from shift attendance and ShiftCall records when a shift is linked
- **Performance Observations**: 1-5 rating (configurable label and scale), areas of strength, areas for improvement, officer narrative — all evaluation fields encrypted at rest (AES-256)
- **Skills Observed**: Structured list of `{skill_name, demonstrated, notes, comment}` entries for detailed performance tracking
- **Tasks Performed**: Structured list of `{task, description, comment}` entries for shift activity documentation
- **Pipeline Linkage**: Optionally link to a trainee's program enrollment to auto-update requirement progress
- **Audit Trail**: `data_sources` JSON field tracks which fields were auto-populated from shift data vs manually entered (e.g., `{"hours_on_shift": "shift_attendance", "calls_responded": "shift_calls"}`)

### Auto-Population from Shift Data *(2026-03-28)*

When a shift and trainee are selected in the report form, the system auto-populates:
- **Hours on shift** from ShiftAttendance duration
- **Calls responded** from ShiftCall records where the trainee is in `responding_members`
- **Call types** from the incident types of matching calls

Auto-populated fields display an **(auto)** badge. Officers can edit values before submitting.

### Auto-Progress Updates

When a shift report is created (or a draft transitions to `approved`/`pending_review`), the system automatically updates requirement progress:
- **SHIFTS** requirements: Incremented by 1
- **CALLS** requirements: If `required_call_types` specified on the requirement, only matching calls count (case-insensitive). Otherwise all calls counted. Call type breakdown tracked in `progress_notes`
- **HOURS** requirements: Incremented by hours on shift

Progress percentages and enrollment completion are automatically recalculated. **Draft reports do not trigger progress updates** — progress is deferred until the draft is completed.

### Review Workflow *(2026-03-28)*

Reports support a multi-stage review workflow:

| Status | Description |
|--------|-------------|
| `draft` | Auto-created on shift finalization; awaiting officer completion |
| `pending_review` | Submitted for training officer review (if `report_review_required` enabled) |
| `approved` | Finalized and visible to trainee (subject to visibility config) |
| `flagged` | Flagged by reviewer for correction or concern |

Reviewers can optionally **redact fields** (clearing sensitive content) and add **reviewer notes** (encrypted, never visible to trainees).

### Trainee Acknowledgment

Trainees can acknowledge shift reports and add their own comments via `POST /{report_id}/acknowledge`. Acknowledgment timestamp and comments are recorded for compliance tracking.

### Analytics Dashboards *(2026-03-29)*

**Officer Analytics** (`GET /training/shift-reports/officer-analytics`):
- Org-wide totals: reports, hours, calls, average rating
- Per-trainee breakdown table
- Status counts (draft/pending/approved/flagged)
- Monthly trend data

**Trainee Statistics** (`GET /training/shift-reports/my-stats`):
- Personal totals: reports, hours, calls, average rating
- Monthly breakdown

### Pages

| Page | Path | Access |
|------|------|--------|
| Shift Reports (multi-view) | ShiftReportsTab in SchedulingPage | All members |
| Shift Report Form | ShiftReportPage | `training.manage` |

### API Endpoints

```http
POST   /api/v1/training/shift-reports/                                  Create report (officer)
GET    /api/v1/training/shift-reports/my-reports                        Trainee's received reports
GET    /api/v1/training/shift-reports/my-stats                          Trainee's aggregate stats
GET    /api/v1/training/shift-reports/officer-analytics                 Org-wide analytics (officer)
GET    /api/v1/training/shift-reports/by-officer                        Officer's filed reports
GET    /api/v1/training/shift-reports/pending-review                    Reports awaiting review
GET    /api/v1/training/shift-reports/drafts                            Auto-created drafts
GET    /api/v1/training/shift-reports/all                               All org reports (filtered)
GET    /api/v1/training/shift-reports/trainee/{id}                      Trainee reports (officer)
GET    /api/v1/training/shift-reports/trainee/{id}/stats                Trainee stats (officer)
GET    /api/v1/training/shift-reports/shift-preview/{shift_id}/{trainee_id}  Auto-populate preview
GET    /api/v1/training/shift-reports/{id}                              Single report
PUT    /api/v1/training/shift-reports/{id}                              Update draft
POST   /api/v1/training/shift-reports/{id}/acknowledge                  Trainee acknowledges
POST   /api/v1/training/shift-reports/{id}/review                       Officer reviews (approve/flag/redact)
```

---

## Member Training Page ("My Training")

Every member has access to a personal training page at `/training/my-training` that aggregates all their training data in one place.

### What Members See

Depending on the department's visibility configuration:
- **Training Hours Summary**: Total records and hours completed
- **Requirements Compliance**: Percentage of all active requirements met (supports annual, biannual, quarterly, monthly, and one-time frequencies)
- **Certifications**: Status, expiration dates, days until expiry
- **Pipeline Progress**: Enrollment status, progress bars, requirement completion
- **Shift Reports**: Shift completion reports filed by officers
- **Self-Reported Submissions**: Status of submitted training
- **Training History**: Full table of training records

### What Members DON'T See (by default)

- **Officer Narrative**: Detailed written narratives from shift officers (hidden by default)
- **Report Export**: Members cannot download their data unless enabled

### Officer/Admin View

Officers and administrators always see the full dataset regardless of visibility settings. They also have access to a **Member Visibility Settings** tab where they can toggle each data category on/off for their department.

---

## Member Visibility Configuration

Each department can control exactly what training data individual members see on their personal training page. This is managed through the **Training Module Configuration**.

### Visibility Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Training History | On | Members see their training record list |
| Training Hours | On | Members see total hours summary |
| Certification Status | On | Members see certification expiration dates |
| Pipeline Progress | On | Members see program enrollment progress |
| Requirement Details | On | Members see individual requirement progress |
| Shift Reports | On | Members see shift completion reports |
| Shift Statistics | On | Members see aggregate shift stats |
| Performance Rating | On | Members see 1-5 performance ratings |
| Areas of Strength | On | Members see officer-noted strengths |
| Areas for Improvement | On | Members see improvement notes |
| Skills Observed | On | Members see skill evaluations |
| Officer Narrative | **Off** | Members see officer written narratives |
| Submission History | On | Members see self-reported submission status |
| Report Export | **Off** | Members can download their own data |

### Changing Visibility Settings

1. Navigate to **Training** → **My Training** (as an officer/admin)
2. Click the **Member Visibility Settings** tab
3. Toggle settings on/off
4. Click **Save Changes**
5. Changes take effect immediately for all members

### API Endpoints

```http
GET    /api/v1/training/module-config/config             Get full config (officer)
PUT    /api/v1/training/module-config/config             Update config (officer)
GET    /api/v1/training/module-config/visibility         Get visibility flags (member)
GET    /api/v1/training/module-config/my-training         Get member's training data
GET    /api/v1/training/module-config/my-training/export  Member self-export (CSV/PDF)
```

`GET /my-training/export` lets a member download **their own** training history
as `csv` or `pdf`, with optional `start_date` / `end_date` (omitting `start_date`
returns lifetime history). It is gated by the org's `allow_member_report_export`
setting (the "Report Export" visibility toggle, **off** by default) — when off it
returns **403**. (2026-04 — `app/api/v1/endpoints/training_module_config.py`)

---

## Training Reports

The Reports module includes training-specific reports that aggregate data from training records, shift completion reports, and pipeline enrollments.

### Available Training Reports

#### Training Summary
Overview of training completion rates, hours, and per-member statistics.
- Supports date range filtering (This Year, Last Year, custom)
- Shows completion rate, per-member hours, and course counts

#### Training Progress
Pipeline enrollment progress across all members.
- Shows enrollment status summary (active, completed, withdrawn)
- Per-member progress bars with requirement completion ratios
- Average progress percentage

#### Annual Training Report
Comprehensive annual breakdown of all training activity.
- Defaults to current year; customizable with date range picker
- Summary statistics: total hours, completions, calls responded
- Training by type breakdown
- Per-member table: training hours, shift hours, courses, shifts, calls, performance rating

### Date Range Picker

Training reports support customizable reporting periods:
- **This Year**: January 1 - December 31 of current year
- **Last Year**: Full previous calendar year
- **Last 90 Days**: Rolling 90-day window
- **Custom**: Pick any start and end date

The selected period is passed to the API and displayed in the report results modal.

Navigate to **Reports** page and use the **Reporting Period** section above the report cards.

---

## Database Schema (New Tables)

### `shift_completion_reports` *(updated 2026-03-28)*
- id, organization_id
- shift_id (nullable — null for ad hoc reports), shift_date
- trainee_id, officer_id
- hours_on_shift, calls_responded, call_types (JSON)
- performance_rating (1-5), areas_of_strength (EncryptedText), areas_for_improvement (EncryptedText), officer_narrative (EncryptedText)
- skills_observed (JSON: `[{skill_name, demonstrated, notes, comment}]`), tasks_performed (JSON: `[{task, description, comment}]`)
- enrollment_id, requirements_progressed (JSON: `[{requirement_progress_id, value_added}]`)
- data_sources (JSON — audit trail tracking auto-populated vs manual fields)
- review_status (`draft`, `pending_review`, `approved`, `flagged`)
- reviewed_by, reviewed_at, reviewer_notes (EncryptedText — never exposed to trainee)
- trainee_acknowledged, trainee_acknowledged_at, trainee_comments
- created_at, updated_at
- Unique constraint: `(shift_id, trainee_id)`

### `training_module_configs`
- id, organization_id (unique)
- show_training_history, show_training_hours, show_certification_status
- show_pipeline_progress, show_requirement_details
- show_shift_reports, show_shift_stats
- show_officer_narrative, show_performance_rating
- show_areas_of_strength, show_areas_for_improvement, show_skills_observed
- show_submission_history, allow_member_report_export
- created_at, updated_at, updated_by

### `self_report_configs`
- id, organization_id (unique)
- require_approval, auto_approve_under_hours, approval_deadline_days
- notify_officer_on_submit, notify_member_on_decision
- field_config (JSON), allowed_training_types (JSON)
- max_hours_per_submission, member_instructions
- created_at, updated_at, updated_by

### `training_submissions`
- id, organization_id, submitted_by
- course_name, course_code, training_type, description
- completion_date, hours_completed, credit_hours
- instructor, location, certification_number, issuing_agency, expiration_date
- category_id, attachments (JSON)
- status (draft, pending_review, approved, rejected, revision_requested)
- reviewed_by, reviewed_at, reviewer_notes
- training_record_id, submitted_at, updated_at

---

## Cross-Module Integration Points

The Training Programs module connects with several other modules:

### Events Module

Training sessions can be linked to events via the `training_session.event_id` foreign key. When a training session is created from an event:
- Event RSVP data pre-populates the session attendee list
- Event QR code check-ins can be used for attendance verification
- Event location is inherited by the training session

> **Screenshot placeholder:**
> _[Screenshot of the Create Training Session form showing the "Link to Event" dropdown with a list of upcoming events, and the auto-populated attendee list from the event's RSVPs]_

#### Training Session Approval → Pipeline Progress

When a training session is **approved**, its attendance feeds the pipeline via
`update_requirement_progress` (applied **after** the approval + records commit):
- If the session carries `program_id` + `requirement_id`, the linked requirement
  is progressed directly.
- If the session is linked to a program and a **category** (`category_id`, no
  `requirement_id`), it **fans out** to the program's requirements tagged with
  that category.

This fixes the prior bug where session attendance bumped a raw value but never
computed a percentage, leaving the pipeline showing 0%.

#### Soft Phase Gate on Attendance

RSVP (`POST /events/{event_id}/rsvp?override=`) and self check-in
(`POST /events/{event_id}/self-check-in?override=`) return **HTTP 409** with
`detail: {warning_type: "phase_gate", message}` when a member RSVPs to or checks
into a **program-linked training session whose phase is AHEAD of their current
enrollment phase**. This is a **soft, overridable** warning — the client confirms
and retries with `override=true`.

- Non-enrolled members and non-program sessions are **never** gated.
- **Officer check-in is not gated** (it is itself the override).

### Scheduling Module

Shift completion reports (`POST /training/shift-reports`) auto-progress program requirements when linked to an enrollment:
- **SHIFTS** requirements: Incremented by 1 per report
- **CALLS** requirements: If `required_call_types` specified on the requirement, only matching calls count (case-insensitive matching). Otherwise all calls counted. Call type breakdown tracked in `progress_notes` *(2026-03-28)*
- **HOURS** requirements: Incremented by hours on shift

**Shift Finalization Integration** *(2026-03-28)*: When a shift is finalized via `POST /scheduling/shifts/{id}/finalize`, the system auto-creates draft ShiftCompletionReports for all attendees with active program enrollments. Draft reports do NOT trigger pipeline progress — progress is deferred until the officer completes the draft (transitions to `approved` or `pending_review`). This prevents double-counting and ensures officer review before data impacts training pipeline.

**Auto-Population** *(2026-03-28)*: The report form auto-populates hours, calls, and call types from shift records via `GET /training/shift-reports/shift-preview/{shift_id}/{trainee_id}`. The `data_sources` audit trail tracks which fields were auto-populated.

> **Edge Case:** If a shift report is filed for a member who is enrolled in multiple programs with overlapping requirements, the system credits all matching requirements across all active enrollments. This means a single shift can progress multiple program requirements simultaneously.

### Member Leaves & Waivers

When a member has an active Leave of Absence with an auto-linked training waiver:
- Proportional requirements (hours, shifts, calls) within programs are adjusted using the waiver formula: `adjusted = base × (active_months / total_months)`
- Course completion and certification requirements are NOT adjusted (they are binary)
- The member's program enrollment remains in `active` status during the leave
- Progress percentages reflect the adjusted targets

> **Edge Case:** If a waiver covers exactly 15 days of a month, that month IS waived. If it covers 14 days, it is NOT waived. A single day can change the adjusted requirement significantly. See [Training Compliance Calculations](./training-compliance-calculations.md#edge-case-near-the-15-day-threshold) for a detailed example.

### Skills Testing Module

Skills test results can be linked to program requirements of type `skills_evaluation`:
- When a candidate passes a skills test for a template referenced by a program requirement, progress is automatically updated
- Failed tests do not regress progress but are logged for the officer's review
- Practice mode tests do NOT count toward program requirement progress

### Compliance Officer Dashboard

The compliance officer dashboard at `/compliance` aggregates program data for:
- ISO readiness assessments using program completion data
- Annual compliance reports incorporating program enrollment statistics
- Compliance forecasting based on program progress trajectories

### Multi-Agency Training

Multi-agency training sessions can count toward program requirements when:
- The session is properly linked to the organization's training records
- The participating member is enrolled in a program with matching requirements
- The hours, shifts, or calls from the joint session match the requirement type

> **Edge Case:** Multi-agency training records are delivered to external LRS endpoints asynchronously via Celery. There may be a delay between training completion and the record appearing in the external system. Local program progress updates happen synchronously.

### Instructor Qualification Validation

When creating a training session linked to a program:
- The system can validate that the assigned instructor holds a valid qualification for the course being taught
- If the instructor's qualification expires before the session date, a warning is displayed
- Use `GET /training/instructors/validate/{userId}/{courseId}` to programmatically check

---

## Edge Cases & Special Handling

### Enrollment Edge Cases

| Scenario | Behavior |
|----------|----------|
| Member already enrolled in same program | Duplicate enrollment is prevented; system returns a clear error |
| Member withdrawn from program, re-enrollment attempted | Re-enrollment is allowed; a new enrollment record is created with fresh progress |
| Program deactivated while members are enrolled | Active enrollments remain; enrolled members can still complete requirements, but no new enrollments are accepted |
| All requirements completed but phase requires manual advancement | Enrollment stays at current phase; officer must manually advance to next phase |
| Shift report filed for member not enrolled in any program | Report is saved but no auto-progression occurs; report is available for manual review |
| Concurrent enrollment in programs with overlapping requirements | A single training record or shift report credits all matching requirements across all active enrollments |

### Requirement Progress Edge Cases

| Scenario | Behavior |
|----------|----------|
| Required hours set to 0 | Member automatically shows 100% for that requirement (division by zero protection) |
| Rolling period spans calendar year boundary | The rolling window is calculated from today minus N months, crossing year boundaries correctly |
| Biannual requirement with expired certification | Status shows `expired` regardless of hours completed — certification must be renewed |
| Requirement changed from annual to quarterly mid-year | Existing progress is recalculated against the new frequency; members may see progress reset |
| Category-based requirement with deleted category | Records already tagged with the category still count; new records cannot be tagged with the deleted category |
| Requirement marked completed/verified/waived | Progress percentage is set to 100 directly, so non-numeric types (checklist, skills, certification, knowledge test) advance the enrollment rollup |
| Completed enrollment drops below 100% | Enrollment re-opens to `active` (e.g. a new required requirement is added, or an over-count is corrected down) |
| Knowledge test with `max_attempts` exhausted | Further scores are rejected once attempts are used up and the requirement is not yet satisfied |

### Waiver Interaction Edge Cases

| Scenario | Behavior |
|----------|----------|
| Overlapping waivers (e.g., maternity leave + medical waiver) | Months are deduplicated — a month waived by multiple waivers counts only once |
| Targeted waiver (specific requirements only) | Only listed requirements are adjusted; other program requirements retain full targets |
| Permanent waiver (no end date) | Uses far-future sentinel (9999-12-31); only months within the evaluation period are counted as waived |
| Waiver end date changed retroactively | Compliance recalculates with the new dates; previously-compliant members may become non-compliant |

### Duplicate Detection Edge Cases

| Scenario | Behavior |
|----------|----------|
| Same member + same course name + completion date within ±1 day | System flags as potential duplicate with a warning |
| Same member + same course name but different case (e.g., "EMT" vs "emt") | Detected as duplicate (case-insensitive comparison) |
| Bulk import with duplicates in the batch | Each record checked independently; duplicates within the same batch are also detected |
| Override duplicate warning | User can proceed with the duplicate if it's intentional (e.g., retake) |

---

## Recently Implemented Features

The following features, previously listed as planned, are now available:

- **Training Session Integration** — Sessions auto-populate hours from events and training sessions
- **Automated Reporting** — Compliance forecast and annual compliance reports
- **Email Notifications** — Automated emails for certification expiry (90/60/30/7 day tiers), recertification reminders, and submission decisions
- **Mobile & PWA** — Full training module access via PWA with responsive layouts; QR code check-in for training events
- **Analytics Dashboard** — Competency matrix, compliance officer dashboard, effectiveness scoring
- **Instructor Management** — Track qualifications, validate assignments, manage availability
- **Multi-Agency Training** — Coordinate joint sessions across departments with shared records
- **xAPI Integration** — Learning Record Store connectivity for standardized training activity tracking

### Recently Implemented (March 15, 2026)

- **Recurring Training Sessions** — Training sessions can now recur using the same infrastructure as events (daily, weekly, biweekly, monthly, monthly_weekday, annually, annually_weekday, custom patterns). Backend creates recurring events via `EventService` and links a `TrainingSession` to each occurrence. Selecting an existing course auto-populates training type, credit hours, instructor, expiration months, and max participants
- **Quarter-Hour Time Picker (`DateTimeQuarterHour`)** — New UX component replacing browser `datetime-local` inputs (which ignore `step="900"`). Splits date/time into a native date picker and a select dropdown restricted to `:00`, `:15`, `:30`, `:45`. Located at `components/ux/DateTimeQuarterHour.tsx`
- **Quick Duration Buttons** — 1-hour, 2-hour, 4-hour, and 8-hour buttons on the session creation form. Appear once a start date is set and auto-populate end date/time
- **Course Auto-Populate** — Selecting an existing course fills training type, credit hours, instructor, expiration months, and max participants with a details preview card
- **Training Pipeline Save Fix** — Added missing `program_requirements` relationship on `TrainingProgram` model. Fixed route ordering for `/requirements/registries` and `/requirements/import/{name}` (were being matched as UUID parameters)
- **UUID Comparison Fix** — Fixed 12 instances where UUID objects from Pydantic schemas were compared against `String(36)` database columns without `str()` conversion in `training_program_service.py`

#### Recurring Training Session Edge Cases

| Scenario | Behavior |
|----------|----------|
| Deleting parent event | Does not cascade-delete the linked training session |
| Quarter-hour picker with imported data | Arbitrary minute values are rounded to the nearest quarter-hour |
| Course auto-populate | Fills all fields but does not lock them — user can override |
| Quick duration buttons | Disabled until a start date is selected |
| Recurrence past series end | Events beyond the series end date are not created |

### Recently Implemented (May 2026)

#### Member & Officer Training Exports

- **Member self-export** — `GET /api/v1/training/module-config/my-training/export`
  returns a member's **own** training history as `csv` or `pdf` with optional
  `start_date`/`end_date` (no `start_date` = lifetime). Gated by the org
  `allow_member_report_export` setting; **403** when disabled. The
  `MyTrainingPage` adds export buttons and a `DateRangePicker` defaulting to the
  last 12 months.
- **Officer per-member & bulk exports** — `POST /api/v1/training/reports/export`
  (`training.manage`) gained report types:
  - `member_records` — bulk export of **all ACTIVE members'** records
    (`MemberTrainingHistoryPage` per-member export + the
    `TrainingEnhancementsTab` "Member Records (All Members)" export both use it),
  - `hours_summary` (CSV) and `certification` (CSV).
  - PDF is supported only for `individual`, `member_records`, and `compliance`.
    Bulk PDFs are merged with **pypdf**; an empty result emits a valid
    placeholder page ("No training records found for this period.").
  - **Unknown report types now raise 400** — the previous silent fall-through to
    a compliance report was removed.
- **Period helper** — `frontend/src/utils/trainingPeriods.ts` provides
  `month` / `quarter` / `year` / `lifetime` calendar-period-to-date windows.

#### Real Training-Record Attachments

Training records now support real file attachments (previously metadata-only):

| Endpoint | Notes |
|----------|-------|
| `POST /api/v1/training/records/{id}/attachments` | Multipart upload, ≤ **25 MB**, magic-byte MIME detection (PDF/JPEG/PNG/GIF/WEBP/DOC/DOCX) |
| `GET /api/v1/training/records/{id}/attachments` | Lists **sanitized metadata only** (no server file paths) |
| `GET /api/v1/training/records/{id}/attachments/{index}/download` | Streams a stored attachment by index |

- **Access:** the record owner manages their own attachments; everyone else
  needs `training.manage`.
- **Storage:** `/app/uploads/training_attachments/{org_id}/{uuid}{ext}` with a
  server-generated UUID filename + MIME-derived extension (anti double-extension).
  Metadata is stored in the `TrainingRecord.attachments` JSON column and saved
  with `flag_modified` (CLAUDE.md pitfall #12).
- `MemberTrainingHistoryPage` adds an attachments modal.

#### Finalize Gated by `require_completion_confirmation`

`finalize_training_session` now respects the session's
`require_completion_confirmation` flag instead of always requiring approval:

- **`false` (default)** — the session is auto-approved, training records are
  completed immediately, and **no** officer email is sent.
- **`true`** — the approval stays `PENDING` and training officers are notified to
  confirm.

`_finalize_training_records` now **promotes the existing in-progress check-in
record** (matched by `course_name` and `scheduled_date == event_date` OR
`completion_date == event_date`, preferring the record with a NULL
`completion_date`) to `completed`, instead of creating a duplicate. The unused
`TrainingSession.approval_required` column/schema/type was **removed**
(migration `20260502_0004`); sign-off is governed solely by
`require_completion_confirmation`.

#### Config Robustness

- New `training_requirements.include_current_month` (Boolean, nullable —
  migration `20260503_0002`) per-requirement evaluation-period override; see
  `COMPLIANCE_CONFIG.md` and `training-compliance-calculations.md`.
- `training_module_configs` boolean columns gained DB `server_default`s
  (migration `20260502_0003`), and `manual_entry_enabled` /
  `manual_entry_require_apparatus` were added to the `_BOOL_FIELD_DEFAULTS`
  coercion, so NULL legacy rows no longer 500 on the config response.

### Recently Implemented (July 2026)

#### Training Pipeline: Build, Enrollment, Progress & Phases

- **Atomic program build** — `POST /training/programs/programs/build` creates a
  program with all phases, requirements, and milestones in one transaction (backs
  the create-pipeline wizard; no orphaned half-built program on failure). Program
  `code`/`version` and phase `requires_manual_advancement` are now persisted and
  returned (previously silently dropped).
- **Enrollment management** — `GET /programs/{program_id}/enrollments`
  (`training.view_all` OR `training.manage`) lists members **by name** with
  progress for the detail page's Enrollments tab; single-enroll uses a searchable
  member picker; **bulk-enroll now blocks** members failing prerequisite /
  concurrent-enrollment checks (previously bypassed).
- **Progress management** — `PATCH /progress/{progress_id}` sets status, logs
  numeric `progress_value`, records `test_score`, and applies verification. Any
  completed/verified/waived requirement counts as 100%, so **non-numeric types
  advance the rollup**. Enrollment % = average of required requirements'
  percentages; auto-completes at 100% and **re-opens** if it later drops below.
- **Courses percentage** — `courses` requirements now compute
  `completed / len(required_courses) × 100`, auto-completing at 100%.
- **Knowledge-test scoring (lightweight)** — officer-entered `test_score` (0-100)
  with pass/fail from `passing_score` (default 70), attempt history in
  `progress_notes`, and `max_attempts` enforcement. Not a full test engine.
- **Phase advancement** — auto-advance through consecutive complete phases,
  stopping at `requires_manual_advancement`; manual
  `POST /enrollments/{enrollment_id}/advance-phase?force=<bool>`; the
  phase-advancement notification is now sent.
- **Automatic feeds** — approved training sessions (linked requirement, or
  category fan-out) and skills-test passes now route through
  `update_requirement_progress` so percentages/rollup/phase-advance run
  (fixing the "session attendance never computed %" bug).
- **Student progression view** — read-only `/training/my-progress/:enrollmentId`
  with current phase, overall %, time remaining, next milestones, and a
  "You are here" marker, linked from My Training.
- **Soft phase gate on attendance** — RSVP / self check-in return **409**
  `{warning_type: "phase_gate"}` when a member attends a program session whose
  phase is ahead of their enrollment phase; overridable with `override=true`.
  Non-enrolled members, non-program sessions, and officer check-in are never gated.

### Remaining Planned Features
- **Knowledge-Test Engine**: A full test-taking experience (question bank,
  delivery, and auto-grading). Current knowledge-test support is officer-entered
  scores only.
- **Skill Videos**: Embed training videos for skill requirements
- **Digital Signatures**: Sign off on checklist items digitally
- **Offline Test Administration**: Full offline support for skills testing via PWA IndexedDB

---

## Support

For questions or issues with the Training Programs module:
- Submit an issue on GitHub: https://github.com/anthropics/the-logbook/issues
- Check the FAQ in the main README
- Contact your department administrator

---

*Last Updated: July 14, 2026*
