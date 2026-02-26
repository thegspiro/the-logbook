# Skills Testing & Psychomotor Evaluations

The Skills Testing module provides digital skill sheet evaluations that mirror NREMT-style psychomotor examinations. Examiners use a tablet or computer to score individual steps, track time, flag critical criteria, and generate auditable pass/fail results — replacing paper skill sheets with a structured digital workflow.

Skills Testing lives within the Training module and integrates with Training Requirements, Training Records, Training Programs, and the compliance pipeline.

---

## Table of Contents

1. [Overview](#overview)
2. [Skill Sheet Templates](#skill-sheet-templates)
3. [Creating a Template](#creating-a-template)
4. [Publishing Templates](#publishing-templates)
5. [Administering a Skills Test](#administering-a-skills-test)
6. [Scoring & Critical Criteria](#scoring--critical-criteria)
7. [Completing a Test](#completing-a-test)
8. [Viewing Results](#viewing-results)
9. [Skills Testing Summary Dashboard](#skills-testing-summary-dashboard)
10. [Realistic Example: NREMT Trauma Assessment](#realistic-example-nremt-trauma-assessment)
11. [Permissions](#permissions)
12. [Integration with Training Compliance](#integration-with-training-compliance)
13. [Troubleshooting](#troubleshooting)

---

## Overview

Many fire departments and EMS agencies conduct psychomotor skills evaluations as part of certification, recertification, and internal proficiency checks. These evaluations follow standardized skill sheets (such as those published by the NREMT) where an examiner observes a candidate performing a procedure and scores each step.

The Skills Testing module digitizes this process, providing:

- **Reusable templates** based on skill sheets (NREMT, NFPA, or department-defined)
- **Real-time scoring** with per-step pass/fail and section subtotals
- **Critical criteria tracking** for automatic failure conditions
- **Time tracking** with configurable time limits
- **Automatic pass/fail calculation** based on scoring thresholds and critical criteria
- **Audit trail** of every test with examiner, candidate, scores, and timestamps

---

## Skill Sheet Templates

Templates are the reusable definitions of a skills test — the digital equivalent of a blank NREMT skill sheet. Each template contains:

- **Metadata** — Name, category, description, version number
- **Sections** — Ordered groups of related steps (e.g., "Scene Size-Up", "Primary Survey")
- **Criteria within sections** — Individual scored items with descriptions and whether they are critical (required)
- **Scoring configuration** — Passing percentage, whether all critical criteria must be met, optional time limit

> **Screenshot placeholder:**
> _[Screenshot of the Skill Sheet Templates list page showing a table of templates with columns for name, category, status (draft/published/archived), version number, section count, and action buttons (edit, duplicate, publish)]_

### Template Statuses

| Status | Description |
|--------|-------------|
| **Draft** | Template is being built or edited. Cannot be used for testing. |
| **Published** | Template is active and available for examiners to use. |
| **Archived** | Template has been retired. Historical test results still reference it, but no new tests can be created from it. |

---

## Creating a Template

**Required Permission:** `training.manage`

Navigate to **Training Admin > Skills Testing > Templates** and click **Create Template**.

### Step 1: Template Metadata

Fill in the basic information:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Descriptive name of the skill sheet | "Patient Assessment/Management — Trauma" |
| **Category** | Training category (EMS, Fire, Hazmat, etc.) | "EMS" |
| **Description** | Purpose and scope | "NREMT psychomotor exam for trauma patient assessment" |
| **Passing Percentage** | Minimum score to pass (0–100) | 70 |
| **Require All Critical** | If enabled, failing any required criterion = automatic fail | Enabled |
| **Time Limit** | Optional time limit in seconds | 600 (10 minutes) |

> **Screenshot placeholder:**
> _[Screenshot of the Create Template form showing the metadata fields: name input, category dropdown, description textarea, passing percentage slider set to 70%, "Require All Critical" toggle switch (on), and time limit input showing 600 seconds]_

### Step 2: Define Sections and Criteria

Add sections to organize the evaluation, then add criteria (scored items) within each section.

**Adding a section:**
1. Click **Add Section** below the template metadata.
2. Enter the section name (e.g., "Scene Size-Up").
3. Optionally add examiner instructions for the section.

**Adding criteria to a section:**
1. Within a section, click **Add Criterion**.
2. Enter the step description (e.g., "Determines scene/situation safety").
3. Check **Required** if this is a critical criterion — failing a required criterion triggers automatic fail when "Require All Critical" is enabled on the template.

> **Screenshot placeholder:**
> _[Screenshot of the template builder showing two sections ("Scene Size-Up" and "Primary Survey") expanded with criteria listed under each. Each criterion row shows: description text, a "Required" checkbox (some checked with a red asterisk), and drag handles for reordering. An "Add Criterion" button appears at the bottom of each section]_

> **Hint:** Required (critical) criteria are the digital equivalent of the "Critical Criteria" section at the bottom of NREMT skill sheets. If a candidate triggers any of these, the result is an automatic FAIL regardless of their point score.

### Step 3: Save as Draft

Click **Save** to save the template as a draft. You can continue editing drafts at any time before publishing.

---

## Publishing Templates

When a template is ready for use:

1. Navigate to the template detail page.
2. Click **Publish**.
3. The system validates that the template has at least one section with at least one criterion.
4. Once published, the template becomes available for examiners to use in test sessions.

**Version control:** When you edit a published template and structural fields change (sections, criteria, scoring configuration), the version number auto-increments. Historical test results always reference the template version they were administered under.

**Duplicating a template:** Click **Duplicate** on any template to create a draft copy with " (Copy)" appended to the name. This is useful for creating variants (e.g., adapting an NREMT template for department-specific requirements).

> **Screenshot placeholder:**
> _[Screenshot of the template detail page for a published template showing the "Published" status badge in green, version "v2", and action buttons: Edit, Duplicate, Archive. The template sections and criteria are displayed in read-only view below]_

---

## Administering a Skills Test

**Required Permission:** Authenticated user (examiner is auto-set to current user)

Navigate to **Training Admin > Skills Testing > Tests** and click **New Test**.

### Setting Up a Test Session

1. **Select Template** — Choose a published skill sheet template from the dropdown.
2. **Select Candidate** — Choose the member being evaluated from the organization roster.
3. Click **Start Test**.

The system creates a new test session with:
- The current user as the **examiner**
- Status set to **not_started**
- The template's sections and criteria loaded for scoring

> **Screenshot placeholder:**
> _[Screenshot of the New Test form showing a template dropdown (with "Patient Assessment/Management — Trauma v2" selected), a candidate dropdown showing a member search, and a prominent "Start Test" button]_

### Test Statuses

| Status | Description |
|--------|-------------|
| **not_started** | Test created but candidate has not begun |
| **in_progress** | Candidate is actively being evaluated |
| **completed** | Test finished and scored |
| **cancelled** | Test was cancelled before completion |

---

## Scoring & Critical Criteria

During the test, the examiner scores each criterion as the candidate performs the procedure.

### Per-Section Scoring

Each section displays its criteria as a checklist. The examiner:
- **Checks off** each step the candidate completes correctly
- **Leaves unchecked** any steps the candidate misses or performs incorrectly
- Notes which criteria are marked as **Required** (critical) — indicated by a red asterisk

### Running Score

As the examiner scores criteria, the interface displays:
- **Section score** — criteria passed / total criteria in each section
- **Overall running score** — total criteria passed / total criteria across all sections
- **Percentage** — running percentage updated in real-time

### Critical Criteria

If "Require All Critical" is enabled on the template:
- Any **required** criterion that is left unchecked (not passed) will result in an **automatic FAIL**
- This is true even if the candidate's percentage score exceeds the passing threshold

> **Screenshot placeholder:**
> _[Screenshot of the active test scoring interface showing: a top bar with candidate name, template name, timer counting up (showing "04:32"), and running score "14/18 (78%)". Below, sections are shown as accordion panels — one expanded showing criteria with checkboxes. Required criteria have a red asterisk. A completed section shows "5/5" in green. The bottom shows a prominent "Complete Test" button]_

---

## Completing a Test

When the candidate finishes the procedure:

1. Click **Complete Test**.
2. The system automatically calculates:
   - **Total score** — percentage of criteria passed
   - **Critical criteria check** — whether all required criteria were met (if applicable)
   - **Elapsed time** — total time from start to completion
   - **Pass/Fail result** — based on both the score threshold and critical criteria

### Result Determination

A candidate **passes** if ALL of the following are true:
1. Their percentage score meets or exceeds the template's **passing percentage**
2. If "Require All Critical" is enabled, ALL required criteria were scored as passed

A candidate **fails** if ANY of the following are true:
1. Their percentage score is below the passing percentage
2. Any required criterion was not passed (when "Require All Critical" is enabled)

> **Screenshot placeholder:**
> _[Screenshot of the test completion/results screen showing: a large PASS indicator in green (or FAIL in red), the final score "16/18 (89%)", time elapsed "07:23", a section-by-section breakdown showing scores per section, and a list of any missed criteria highlighted in yellow. For a failing test, also show which critical criteria were triggered in red]_

---

## Viewing Results

### Individual Test Results

Navigate to **Training Admin > Skills Testing > Tests** and click on any completed test to view:

- Candidate and examiner names
- Template name and version
- Final score and pass/fail result
- Section-by-section breakdown
- Time elapsed
- Date and time of completion

### Test History

The tests list page supports filtering by:
- **Status** — not_started, in_progress, completed, cancelled
- **Candidate** — filter by specific member
- **Template** — filter by specific skill sheet

> **Screenshot placeholder:**
> _[Screenshot of the Skills Tests list page showing a table of test sessions with columns: candidate name, template name, examiner, date, score, result (PASS/FAIL badge), and status. Show filters at the top for status, candidate, and template dropdowns]_

---

## Skills Testing Summary Dashboard

**Required Permission:** `training.manage`

Navigate to **Training Admin > Skills Testing > Summary** for a department-wide overview:

| Metric | Description |
|--------|-------------|
| **Total Templates** | Number of skill sheet templates |
| **Published Templates** | Templates available for testing |
| **Total Tests** | All-time test sessions |
| **Tests This Month** | Test sessions conducted in the current month |
| **Pass Rate** | Percentage of completed tests that resulted in a pass |
| **Average Score** | Mean percentage score across all completed tests |

> **Screenshot placeholder:**
> _[Screenshot of the Skills Testing Summary dashboard showing six stat cards in a 3x2 grid: Total Templates (12), Published Templates (8), Total Tests (156), Tests This Month (14), Pass Rate (82%), Average Score (76.4%). Each card has an icon and is color-coded]_

---

## Realistic Example: NREMT Trauma Assessment

This walkthrough demonstrates a complete skills testing scenario — from template creation to test completion — using a realistic NREMT "Patient Assessment/Management — Trauma" skill sheet.

### Background

**Springfield Fire-Rescue** is conducting quarterly EMT recertification skills evaluations. Training Officer **Lt. Maria Santos** needs to set up the NREMT Trauma Assessment skill sheet and evaluate EMT **Firefighter Jake Thompson**.

---

### Part 1: Creating the Template

Lt. Santos navigates to **Training Admin > Skills Testing > Templates** and clicks **Create Template**.

**Template metadata:**
- **Name:** Patient Assessment/Management — Trauma
- **Category:** EMS
- **Description:** NREMT psychomotor evaluation for trauma patient assessment and management. Candidate must demonstrate a systematic approach to assessing and managing a trauma patient, including scene size-up, primary survey, secondary assessment, and reassessment.
- **Passing Percentage:** 70
- **Require All Critical:** Enabled
- **Time Limit:** 600 seconds (10 minutes)

**Section 1: Scene Size-Up**
| # | Criterion | Required |
|---|-----------|----------|
| 1 | Takes or verbalizes appropriate PPE precautions | Yes |
| 2 | Determines the scene/situation is safe | Yes |
| 3 | Determines the mechanism of injury/nature of illness | No |
| 4 | Determines the number of patients | No |
| 5 | Requests additional EMS assistance if necessary | No |
| 6 | Considers stabilization of the spine | Yes |

**Section 2: Primary Survey / Resuscitation**
| # | Criterion | Required |
|---|-----------|----------|
| 1 | Verbalizes general impression of the patient | No |
| 2 | Determines responsiveness/level of consciousness (AVPU) | No |
| 3 | Determines chief complaint/apparent life threats | No |
| 4 | Assesses airway and breathing — assessment and corrective interventions | Yes |
| 5 | Assesses circulation — bleeding, pulse, skin (color/temperature/moisture) | Yes |
| 6 | Identifies patient priority and makes transport decision | No |

**Section 3: History Taking**
| # | Criterion | Required |
|---|-----------|----------|
| 1 | Obtains baseline vital signs (BP, pulse, respirations) | No |
| 2 | Attempts to obtain SAMPLE history | No |

**Section 4: Secondary Assessment**
| # | Criterion | Required |
|---|-----------|----------|
| 1 | Inspects and palpates head, neck, and cervical spine | No |
| 2 | Inspects and palpates chest | No |
| 3 | Inspects and palpates abdomen | No |
| 4 | Inspects and palpates pelvis | No |
| 5 | Inspects and palpates lower extremities (pulses, motor, sensation) | No |
| 6 | Inspects and palpates upper extremities (pulses, motor, sensation) | No |
| 7 | Inspects and palpates posterior (log roll technique) | No |
| 8 | Manages secondary injuries and wounds appropriately | No |

**Section 5: Reassessment**
| # | Criterion | Required |
|---|-----------|----------|
| 1 | Demonstrates ongoing reassessment of vital signs | No |
| 2 | Verbalizes continued treatment and monitoring | No |

**Totals:** 5 sections, 20 criteria (5 required/critical)

Lt. Santos saves the template, reviews it, and clicks **Publish**. The template is now version 1 and available for use.

---

### Part 2: Administering the Test

On evaluation day, Lt. Santos navigates to **Training Admin > Skills Testing > Tests** and clicks **New Test**.

1. **Template:** Selects "Patient Assessment/Management — Trauma (v1)"
2. **Candidate:** Selects "Jake Thompson"
3. Clicks **Start Test**

The test session is created. Lt. Santos reads the scenario prompt aloud:

> *"You are dispatched to a single-vehicle motorcycle accident. Upon arrival, you find a 28-year-old male lying supine on the roadway. He is conscious and complaining of pain to his left leg. A bystander tells you the patient was traveling approximately 30 mph when he lost control. The patient is wearing a helmet."*

Lt. Santos starts the timer and FF Thompson begins the evaluation.

---

### Part 3: Scoring the Evaluation

As FF Thompson works through the assessment, Lt. Santos scores each criterion:

**Scene Size-Up (6/6):**
- [x] Takes or verbalizes appropriate PPE precautions *(Required)*
- [x] Determines the scene/situation is safe *(Required)*
- [x] Determines the mechanism of injury/nature of illness
- [x] Determines the number of patients
- [x] Requests additional EMS assistance if necessary
- [x] Considers stabilization of the spine *(Required)*

**Primary Survey / Resuscitation (5/6):**
- [x] Verbalizes general impression of the patient
- [x] Determines responsiveness/level of consciousness (AVPU)
- [x] Determines chief complaint/apparent life threats
- [x] Assesses airway and breathing *(Required)*
- [x] Assesses circulation — bleeding, pulse, skin *(Required)*
- [ ] Identifies patient priority and makes transport decision *(Missed — forgot to verbalize transport priority)*

**History Taking (2/2):**
- [x] Obtains baseline vital signs
- [x] Attempts to obtain SAMPLE history

**Secondary Assessment (7/8):**
- [x] Inspects and palpates head, neck, and cervical spine
- [x] Inspects and palpates chest
- [x] Inspects and palpates abdomen
- [x] Inspects and palpates pelvis
- [x] Inspects and palpates lower extremities
- [x] Inspects and palpates upper extremities
- [x] Inspects and palpates posterior
- [ ] Manages secondary injuries and wounds appropriately *(Missed — did not splint the injured leg)*

**Reassessment (1/2):**
- [x] Demonstrates ongoing reassessment of vital signs
- [ ] Verbalizes continued treatment and monitoring *(Missed — did not verbalize ongoing care plan)*

---

### Part 4: Results

Lt. Santos clicks **Complete Test**. The system calculates:

| Metric | Value |
|--------|-------|
| **Criteria Passed** | 17 / 20 |
| **Percentage Score** | 85% |
| **Passing Threshold** | 70% |
| **Score Meets Threshold** | Yes |
| **Critical Criteria Met** | 5 / 5 (all passed) |
| **Time Elapsed** | 7 minutes 42 seconds |
| **Result** | **PASS** |

**Missed Steps:**
1. Primary Survey #6 — Did not verbalize transport priority decision
2. Secondary Assessment #8 — Did not splint the injured leg
3. Reassessment #2 — Did not verbalize ongoing care plan

**Section Breakdown:**

| Section | Score | Percentage |
|---------|-------|------------|
| Scene Size-Up | 6/6 | 100% |
| Primary Survey / Resuscitation | 5/6 | 83% |
| History Taking | 2/2 | 100% |
| Secondary Assessment | 7/8 | 88% |
| Reassessment | 1/2 | 50% |

FF Thompson passed with 85% — all critical criteria were met and the score exceeds the 70% passing threshold. The missed steps are documented for follow-up training.

---

### Example of a FAIL Scenario

If FF Thompson had forgotten to assess the airway (a **required** criterion in Primary Survey), the result would be:

| Metric | Value |
|--------|-------|
| **Criteria Passed** | 16 / 20 |
| **Percentage Score** | 80% |
| **Passing Threshold** | 70% |
| **Score Meets Threshold** | Yes |
| **Critical Criteria Met** | 4 / 5 — **FAILED** (missed required criterion) |
| **Result** | **FAIL — Critical Criteria Not Met** |

Even though 80% exceeds the 70% threshold, the candidate fails because "Require All Critical" is enabled and one critical criterion was not met. This mirrors real NREMT evaluation rules.

---

## Permissions

| Action | Required Permission |
|--------|-------------------|
| Create/edit/publish templates | `training.manage` |
| Duplicate templates | `training.manage` |
| Archive templates | `training.manage` |
| Create and administer tests | Authenticated (any member) |
| View test results | Authenticated (own results) or `training.manage` (all results) |
| View summary dashboard | `training.manage` |

---

## Integration with Training Compliance

Skills tests integrate with the broader training compliance system:

- **Training Requirements:** A requirement with type `SKILLS_EVALUATION` can reference skill sheet templates. When a candidate passes a test, their progress toward that requirement updates.
- **Training Records:** Completed skill tests create training records that count toward hours and completion requirements.
- **Training Programs:** Skills evaluations can be assigned as phase requirements within structured programs (e.g., "Recruit Academy Phase 3 requires passing Trauma Assessment and Cardiac Arrest Management").
- **Compliance Matrix:** Skills test completion status feeds into the department-wide compliance matrix view.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot create a test — "Template must be published" | Only published templates can be used for testing. Navigate to the template and click Publish. |
| Cannot publish template — validation error | The template must have at least one section containing at least one criterion. Add sections and criteria, then try again. |
| Cannot edit a published template | Published templates can still be edited. If structural fields change (sections, criteria, scoring), the version auto-increments. |
| Cannot update a completed test | Completed and cancelled tests are locked and cannot be modified. |
| Test shows FAIL but score is above passing percentage | Check if "Require All Critical" is enabled. If any required criterion was not passed, the result is an automatic FAIL regardless of the score. |
| Candidate doesn't appear in the dropdown | The candidate must be an active member of your organization. Check their account status. |
| Template shows "archived" — can I still view old tests? | Yes. Historical test results always reference the template version they were administered under. Archived templates just can't be used for new tests. |
| Score calculation seems wrong | The score is calculated as: (criteria passed in sections / total criteria) × 100. Check that all sections and their criteria are correct on the template. |
| Summary dashboard shows 0% pass rate | The pass rate only includes completed tests. If all tests are still in progress or cancelled, the rate will show 0%. |

---

**Previous:** [Administration & Reports](./08-admin-reports.md) | **Next:** [Mobile & PWA Usage](./10-mobile-pwa.md)
