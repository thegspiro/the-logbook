# Training Compliance Calculations

This document describes every calculation the system uses to determine whether
a member is compliant with training requirements. It covers requirement
evaluation, waiver adjustments, certification expiration handling, and the
final compliance status indicator.

---

## Table of Contents

1. [Compliance Status Indicator](#1-compliance-status-indicator)
2. [Requirement Progress Evaluation](#2-requirement-progress-evaluation)
3. [Evaluation Period (Date Windows)](#3-evaluation-period-date-windows)
4. [Waiver Adjustments](#4-waiver-adjustments)
5. [Certification Expiration & Alerts](#5-certification-expiration--alerts)
6. [Compliance Matrix](#6-compliance-matrix)
7. [Edge Cases & Special Handling](#7-edge-cases--special-handling)

---

## 1. Compliance Status Indicator

Each member receives a compliance status shown on their profile card. The
status is one of three levels:

| Status   | Label          | Meaning                               |
|----------|----------------|---------------------------------------|
| `green`  | Compliant      | All requirements met, no cert issues  |
| `yellow` | At Risk        | Partially met or certs expiring soon  |
| `red`    | Non-Compliant  | Significant gaps or expired certs     |

### Decision Logic

```
IF certs_expired > 0
   OR (requirements_total > 0 AND requirements_met < requirements_total × 0.5):
     → RED  (Non-Compliant)

ELSE IF certs_expiring_soon > 0
   OR (requirements_total > 0 AND requirements_met < requirements_total):
     → YELLOW  (At Risk)

ELSE:
     → GREEN  (Compliant)
```

### Output Fields

| Field                  | Type    | Description                                         |
|------------------------|---------|-----------------------------------------------------|
| `requirements_met`     | integer | Count of requirements the member has satisfied       |
| `requirements_total`   | integer | Total active requirements for the organization       |
| `certs_expiring_soon`  | integer | Certs expiring within 90 days                        |
| `certs_expired`        | integer | Certs already past expiration                        |
| `compliance_status`    | string  | `green`, `yellow`, or `red`                          |
| `compliance_label`     | string  | Human-readable label                                 |
| `hours_this_year`      | float   | Total training hours completed in the current year   |
| `active_certifications`| integer | Count of non-expired certifications                  |

**Source:** `GET /training/compliance-summary/{user_id}`
(`backend/app/api/v1/endpoints/training.py`)

---

## 2. Requirement Progress Evaluation

Each training requirement is evaluated individually. The evaluation method
depends on the requirement type.

### 2a. Hours-Based Requirements

The most common type. A member must accumulate a target number of training
hours within an evaluation period.

```
completed_hours = SUM(record.hours_completed)
    WHERE record.user_id = member
      AND record.status = COMPLETED
      AND record.completion_date BETWEEN period_start AND period_end
      AND record matches requirement filters (training_type, course_id)

required_hours = requirement.required_hours (adjusted for waivers, see §4)

percentage = (completed_hours / required_hours) × 100
is_complete = completed_hours >= required_hours
```

**Requirement filters applied in order:**
1. `training_type` — if the requirement specifies a type, only records of
   that type count
2. `required_courses` — if the requirement lists specific course IDs, only
   those course records count
3. `category_ids` — if the requirement specifies category IDs, records with
   matching `course_id` count

### 2b. Certification Requirements

A member must hold a valid (non-expired) certification.

```
has_valid_cert = ANY record WHERE:
    record.certification_number IS NOT NULL
    AND record.expiration_date >= today

is_complete = has_valid_cert
```

Certification matching considers:
- `training_type` match (if the requirement specifies one)
- Requirement name as substring of `course_name` (case-insensitive)
- `registry_code` as substring of `certification_number` (case-insensitive)

### 2c. Shifts / Calls Requirements

A member must complete a minimum number of shifts or calls.

```
count = COUNT(records matching requirement filters within period)
required = requirement.required_shifts OR requirement.required_calls
    (adjusted for waivers, see §4)

is_complete = count >= required
```

### 2d. Course Completion Requirements

A member must complete all courses in a specified list.

```
required_course_ids = requirement.required_courses
completed_course_ids = {record.course_id for completed records in period}
matched = count of required_course_ids found in completed_course_ids

is_complete = matched >= len(required_course_ids)
```

### 2e. Fallback (Other Types)

If the requirement type does not match any of the above, the member is
considered to have met it if they have **any** completed training record
in the current year.

**Source:** `TrainingService.check_requirement_progress()`
(`backend/app/services/training_service.py`)

---

## 3. Evaluation Period (Date Windows)

Each requirement defines a frequency that determines the date window over
which progress is measured.

| Frequency    | Period Start                        | Period End                          |
|-------------|-------------------------------------|--------------------------------------|
| `annual`     | Jan 1 of requirement year (or current year) | Dec 31 of that year        |
| `quarterly`  | First day of current quarter        | Last day of current quarter          |
| `monthly`    | First day of current month          | Last day of current month            |
| `biannual`   | No date window                      | Compliance based on non-expired cert |
| `one_time`   | No date window                      | All-time evaluation                  |

### Quarter Calculation

```
quarter_month = ((today.month - 1) ÷ 3) × 3 + 1

Examples:
  January (1)   → quarter_month = 1  → Q1: Jan 1 – Mar 31
  May (5)       → quarter_month = 4  → Q2: Apr 1 – Jun 30
  August (8)    → quarter_month = 7  → Q3: Jul 1 – Sep 30
  November (11) → quarter_month = 10 → Q4: Oct 1 – Dec 31
```

### Rolling Period Requirements

Some requirements use a rolling evaluation window instead of fixed calendar
periods:

```
IF requirement.due_date_type = "rolling"
   AND requirement.rolling_period_months is set:

   period_start = today − rolling_period_months
   period_end   = today
```

**Source:** `_get_requirement_date_window()`
(`backend/app/api/v1/endpoints/training.py`)

---

## 4. Waiver Adjustments

When a member has an active waiver (training waiver or leave of absence),
their required targets are reduced proportionally.

### 4a. Data Sources

Waivers come from two database tables:

| Table                        | Scope                                        |
|------------------------------|----------------------------------------------|
| `training_waivers`           | May target specific requirement IDs          |
| `member_leaves_of_absence`   | Applies to **all** training requirements     |

Both are merged into a unified `WaiverPeriod` for calculation purposes.

### 4b. Counting Waived Months

A calendar month is considered **waived** when a waiver covers **15 or more
days** of that month.

```
For each waiver period:
  1. Skip if the waiver targets specific requirements and this requirement
     is not in that list (blanket waivers always apply)
  2. Calculate overlap with the evaluation period:
       overlap_start = MAX(waiver.start_date, period_start)
       overlap_end   = MIN(waiver.end_date, period_end)
  3. Walk month-by-month through the overlap:
       For each (year, month):
         covered_days = days the waiver covers in that month
         IF covered_days >= 15:
           Add (year, month) to the waived set

waived_months = count of unique (year, month) entries in the set
```

Overlapping waivers are automatically deduplicated — multiple waivers
covering the same month only count it once.

### 4c. Adjusting the Required Target

```
total_months  = months in evaluation period
                = (end.year - start.year) × 12 + (end.month - start.month) + 1

active_months = MAX(total_months - waived_months, 1)

adjusted_required = base_required × (active_months / total_months)
```

### Worked Example

| Input                  | Value                    |
|------------------------|--------------------------|
| Base requirement       | 24 hours/year            |
| Evaluation period      | Jan 1 – Dec 31 (12 mo.) |
| Member on leave        | Mar 5 – May 20           |

**Step 1: Count waived months**
- March: Mar 5–31 = 27 days → waived (≥ 15)
- April: Apr 1–30 = 30 days → waived (≥ 15)
- May: May 1–20 = 20 days → waived (≥ 15)
- Waived months = 3

**Step 2: Calculate adjustment**
- Total months = 12
- Active months = MAX(12 − 3, 1) = 9
- Adjusted requirement = 24 × (9 / 12) = **18 hours**

The member only needs 18 hours instead of 24 for that year.

### Requirement-Specific vs. Blanket Waivers

- **Blanket waiver** (`requirement_ids = null`): Applies to every
  requirement during the waiver period.
- **Targeted waiver** (`requirement_ids = ["req_1", "req_3"]`): Only
  adjusts the listed requirements. Other requirements are unaffected.

**Source:** `training_waiver_service.py`
(`backend/app/services/training_waiver_service.py`)

---

## 5. Certification Expiration & Alerts

The system monitors certification expiration dates and sends tiered alerts.

### 5a. Expiration Classification

| Condition                                         | Classification   |
|---------------------------------------------------|------------------|
| `expiration_date > today + 90 days`               | Current          |
| `today < expiration_date <= today + 90 days`      | Expiring Soon    |
| `expiration_date <= today`                         | Expired          |

### 5b. Alert Tiers

Alerts are sent at decreasing intervals as expiration approaches:

| Days Until Expiration | Recipients                          | Channels          |
|----------------------|--------------------------------------|--------------------|
| 90 days              | Member only                          | In-app, email      |
| 60 days              | Member only                          | In-app, email      |
| 30 days              | Member + training officer            | In-app, email + CC |
| 7 days               | Member + training + compliance       | In-app, email + CC |
| Expired              | Member + all escalation officers     | In-app, email + CC |

Each tier is sent only once (tracked by `alert_*_sent_at` timestamps on
the record). During each daily run, the system processes one tier per
certification — the most urgent tier that hasn't been sent yet.

### 5c. Expired Escalation

When a certification has already expired and `escalation_sent_at` is null:
- In-app notifications sent to member and escalation officers (training,
  compliance, chief)
- Email sent to member's primary and personal email
- CC'd to training + compliance officers

### 5d. Auto-Calculated Expiration Dates

When a training record is created without an explicit expiration date and
the course defines `expiration_months`:

```
base_month = completion_date.month - 1 + expiration_months
year  = completion_date.year + (base_month ÷ 12)
month = (base_month % 12) + 1
day   = MIN(completion_date.day, last_day_of(year, month))

expiration_date = date(year, month, day)
```

Example: Completed Feb 29, 2024 with 12-month expiration →
Feb 28, 2025 (adjusted for shorter month).

**Source:** `cert_alert_service.py`
(`backend/app/services/cert_alert_service.py`)

---

## 6. Compliance Matrix

The compliance matrix provides a grid view: members (rows) × requirements
(columns), with a status for each cell.

### Cell Statuses

| Status        | Meaning                                            |
|---------------|----------------------------------------------------|
| `completed`   | Requirement fully met within the evaluation period |
| `in_progress` | Some progress but not yet fully met                |
| `not_started` | No relevant records found                          |
| `expired`     | Had a certification but it has expired             |

### Evaluation by Requirement Type

**Hours:**
```
total_hours = SUM(matching records' hours within period)
required = adjusted for waivers

IF biannual AND latest cert is expired → "expired"
IF total_hours >= required             → "completed"
IF total_hours > 0                     → "in_progress"
ELSE                                   → "not_started"
```

**Certification:**
```
matching = records matched by training_type, name, or registry_code
IF matching AND latest is not expired  → "completed"
IF matching AND latest is expired      → "expired"
ELSE                                   → "not_started"
```

**Shifts / Calls:**
```
count = COUNT(matching records within period)
required = adjusted for waivers

IF count >= required  → "completed"
IF count > 0          → "in_progress"
ELSE                  → "not_started"
```

**Courses:**
```
matched = count of required courses found in completed records
IF matched >= total required courses  → "completed"
IF matched > 0                        → "in_progress"
ELSE                                  → "not_started"
```

### Member Completion Percentage

Each member row shows an overall `completion_percentage`:

```
completed_count = number of "completed" cells for the member
completion_percentage = (completed_count / total_requirements) × 100
```

**Source:** `GET /training/compliance-matrix`
(`backend/app/api/v1/endpoints/training.py`)

---

## 7. Edge Cases & Special Handling

### Division by Zero Protection

- If `required_hours = 0`, percentage is set to 100% (automatically
  complete).
- If `total_months = 0`, no adjustment is applied (original requirement
  stands).
- `active_months` is clamped to a minimum of 1 to prevent negative or zero
  values.

### Biannual Requirements

Biannual requirements do **not** use a time-based window. Compliance is
determined entirely by whether the member holds a non-expired certification.
If the latest matching record has an expired `expiration_date`, the status
is `expired` regardless of hours completed.

### Waived Month Threshold

A month counts as waived only when the waiver covers **15 or more days**
of that calendar month. A waiver covering Jan 1–14 (14 days) does **not**
waive January.

### Overlapping Waivers

Multiple waivers covering the same calendar month are deduplicated. The
system tracks waived months as a set of `(year, month)` tuples, so
overlapping waivers never double-count a month.

### Requirement Applicability

Before evaluating a requirement for a member, the system checks:
1. The requirement must be `active = true`
2. The requirement must belong to the member's organization
3. If the requirement specifies `required_roles`, the member must hold one
   of those roles. If `applies_to_all = true`, it applies regardless of role.

### Certification Matching Rules

When determining if a training record satisfies a certification requirement,
the system checks (in order):
1. **Training type** — record's `training_type` matches requirement's
   `training_type` (if specified)
2. **Name match** — requirement name appears as a substring of
   `record.course_name` (case-insensitive)
3. **Registry code** — requirement's `registry_code` appears as a substring
   of `record.certification_number` (case-insensitive)

### Hours Rounding

Adjusted required hours are rounded to 2 decimal places. This prevents
floating-point comparison issues when checking completion.

### Leave-of-Absence Auto-Linking

When a leave of absence is created, the system automatically creates a
linked training waiver (same date range) unless the leave has
`exempt_from_training_waiver = true`. Changes to the leave's dates
automatically update the linked waiver. Deactivating the leave also
deactivates the linked waiver.

---

## Appendix: Integration Points

All compliance calculations must consistently use the shared waiver service
(`training_waiver_service.py`). The following endpoints and reports integrate
with it:

| Endpoint / Feature                         | Uses Waiver Adjustments |
|--------------------------------------------|-------------------------|
| `GET /training/compliance-summary/{id}`    | Yes                     |
| `GET /training/compliance-matrix`          | Yes                     |
| `GET /training/competency-matrix`          | Yes                     |
| `GET /training/requirements/progress/{id}` | Yes                     |
| `GET /training/reports/user/{id}`          | Yes                     |
| `POST /reports/generate` (training types)  | Yes                     |
| `GET /my-training` (member self-view)      | Yes                     |
| Program enrollment progress recalculation  | Yes                     |
