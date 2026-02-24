# Training Compliance Calculations

This document describes every calculation the system uses to determine whether
a member is compliant with training requirements. It covers requirement
evaluation, waiver adjustments, certification expiration handling, and the
final compliance status indicator.

Throughout this document, examples use the following fictitious members of
**Station 7, Riverside Fire Department**:

| Name                | Role                 | Notes                                  |
|---------------------|----------------------|----------------------------------------|
| Maria Torres        | Firefighter/EMT      | Experienced, consistently on track     |
| Jake Nguyen         | Probationary FF      | First year, still building hours       |
| Danielle Brooks     | Driver/Operator      | Returning from maternity leave         |
| Sam Kowalski        | Firefighter          | Back from 4-month military deployment  |
| Carla Mitchell      | Firefighter/Paramedic| Paramedic cert approaching expiration  |
| Tom Raines          | Senior Firefighter   | Let his EMT certification lapse        |

All examples assume **today is October 15, 2025** and the department has
**4 active requirements** unless stated otherwise.

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

### Example: Three Members, Three Statuses

Riverside FD has 4 active requirements for the year. Here is where Maria,
Jake, and Tom stand on October 15:

**Maria Torres** has completed all 4 requirements and holds 2 certifications
that do not expire until 2027:

```
requirements_met   = 4
requirements_total = 4
certs_expired      = 0
certs_expiring_soon= 0

Check RED:  certs_expired (0) > 0?           No
            requirements_met (4) < 4 × 0.5?  No  (4 ≥ 2)
Check YELLOW: certs_expiring_soon (0) > 0?   No
              requirements_met (4) < 4?       No
→ GREEN (Compliant)
```

**Jake Nguyen** has met 3 of 4 requirements. He still needs 6 more
continuing-education hours to finish the annual hours requirement. He has no
cert issues:

```
requirements_met   = 3
requirements_total = 4
certs_expired      = 0
certs_expiring_soon= 0

Check RED:  certs_expired (0) > 0?           No
            requirements_met (3) < 4 × 0.5?  No  (3 ≥ 2)
Check YELLOW: certs_expiring_soon (0) > 0?   No
              requirements_met (3) < 4?       Yes
→ YELLOW (At Risk)
```

Jake gets the yellow indicator even though he is close. The system does not
distinguish between missing one requirement and missing three — any gap below
the RED threshold triggers yellow.

**Tom Raines** let his EMT certification expire last month and has only met
1 of 4 requirements:

```
requirements_met   = 1
requirements_total = 4
certs_expired      = 1
certs_expiring_soon= 0

Check RED:  certs_expired (1) > 0?  Yes
→ RED (Non-Compliant)
```

Tom would be RED based on the expired cert alone. But even without it, he
meets only 1 of 4 requirements (1 < 4 × 0.5 = 2), which independently
triggers RED.

### Edge Case: What if Carla Has Both an Expiring and an Expired Cert?

Carla Mitchell holds two certifications: a Paramedic cert that expired
last week and an ACLS cert expiring in 45 days. Even though the ACLS cert
is merely "expiring soon," the already-expired Paramedic cert overrides
everything:

```
certs_expired      = 1   (Paramedic)
certs_expiring_soon= 1   (ACLS)

Check RED: certs_expired (1) > 0?  Yes
→ RED (Non-Compliant)
```

The expired certification always wins. Carla must renew the Paramedic cert
before she can return to yellow or green, regardless of how many requirements
she has met.

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

#### Example: Maria vs. Jake on Annual Hours

Riverside FD requires **36 hours of continuing education** per year
(Jan 1 – Dec 31, 2025). The requirement has
`training_type = continuing_education`.

**Maria Torres** completed the following CE sessions in 2025:

| Date       | Course                    | Type                  | Hours |
|------------|---------------------------|-----------------------|-------|
| Feb 12     | Hose Operations Drill     | continuing_education  | 4.0   |
| Mar 22     | Hazmat Awareness Refresher| continuing_education  | 8.0   |
| May 10     | Live Fire Exercise        | continuing_education  | 6.0   |
| Jun 14     | Vehicle Extrication       | continuing_education  | 4.0   |
| Aug 03     | Search & Rescue Scenarios | continuing_education  | 6.0   |
| Sep 18     | Ladder Operations         | continuing_education  | 4.0   |
| Oct 05     | EMS Refresher Lecture     | continuing_education  | 4.0   |

```
completed_hours = 4 + 8 + 6 + 4 + 6 + 4 + 4 = 36.0
required_hours  = 36.0
percentage      = (36.0 / 36.0) × 100 = 100.0%
is_complete     = 36.0 >= 36.0 → true
```

Maria has exactly met the requirement.

**Jake Nguyen** started in March and has fewer records:

| Date       | Course                    | Type                  | Hours |
|------------|---------------------------|-----------------------|-------|
| Mar 22     | Hazmat Awareness Refresher| continuing_education  | 8.0   |
| May 10     | Live Fire Exercise        | continuing_education  | 6.0   |
| Jul 19     | Pumper Operations         | continuing_education  | 4.0   |
| Sep 18     | Ladder Operations         | continuing_education  | 4.0   |
| Oct 01     | Forcible Entry Drill      | skills_practice       | 3.0   |

Note: Jake's October 1 drill is `skills_practice`, not `continuing_education`.
Because the requirement filters on `training_type = continuing_education`,
that 3-hour session does **not** count.

```
completed_hours = 8 + 6 + 4 + 4 = 22.0   (skills_practice excluded)
required_hours  = 36.0
percentage      = (22.0 / 36.0) × 100 = 61.1%
is_complete     = 22.0 >= 36.0 → false
```

Jake still needs 14 more CE hours before December 31.

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

#### Example: Carla vs. Tom on EMT Certification

Riverside FD has a requirement: **"EMT Certification"**
(`requirement_type = certification`, `training_type = certification`,
`registry_code = "NREMT"`).

**Carla Mitchell** holds:

| Course Name          | Cert Number     | Expiration  |
|----------------------|-----------------|-------------|
| Paramedic Certification | NREMT-P-88421 | Nov 30, 2025|

The system checks:
1. Training type matches (`certification` = `certification`)
2. Requirement name "EMT Certification" is a substring of
   "Paramedic Certification"? No — but "EMT" is not a substring of
   "Paramedic". However:
3. Registry code "NREMT" is a substring of "NREMT-P-88421"? **Yes**

Match found. Expiration date Nov 30, 2025 >= today Oct 15, 2025 → **valid**.
Carla passes this requirement.

**Tom Raines** holds:

| Course Name          | Cert Number     | Expiration  |
|----------------------|-----------------|-------------|
| EMT-Basic Certification | NREMT-B-67230 | Sep 30, 2025|

Match via registry code "NREMT" in "NREMT-B-67230" — yes. But the
expiration date Sep 30, 2025 < today Oct 15, 2025 → **expired**.
Tom fails this requirement.

### 2c. Shifts / Calls Requirements

A member must complete a minimum number of shifts or calls.

```
count = COUNT(records matching requirement filters within period)
required = requirement.required_shifts OR requirement.required_calls
    (adjusted for waivers, see §4)

is_complete = count >= required
```

#### Example: Maria vs. Jake on Annual Shift Requirement

Riverside FD requires **12 shifts per year** for all members.

Maria has logged 11 shift completion reports so far this year. Jake, who
started in March, has logged 7.

```
Maria:  count = 11, required = 12 → is_complete = false (11 < 12)
Jake:   count = 7,  required = 12 → is_complete = false (7 < 12)
```

Neither has completed this requirement yet with two and a half months
remaining. Maria is at 91.7% while Jake is at 58.3%. Both still have time
to finish.

### 2d. Course Completion Requirements

A member must complete all courses in a specified list.

```
required_course_ids = requirement.required_courses
completed_course_ids = {record.course_id for completed records in period}
matched = count of required_course_ids found in completed_course_ids

is_complete = matched >= len(required_course_ids)
```

#### Example: Jake's Probationary Coursework

Jake's probationary program includes a requirement to complete 3 specific
courses: **Firefighter Safety Orientation** (ID: `course_A`), **SCBA
Operations** (ID: `course_B`), and **Department SOGs Review**
(ID: `course_C`).

Jake has completed `course_A` and `course_B` but not yet `course_C`.

```
required_course_ids  = [course_A, course_B, course_C]
completed_course_ids = {course_A, course_B}
matched              = 2

is_complete = 2 >= 3 → false
percentage  = (2 / 3) × 100 = 66.7%
```

Jake needs to finish the SOGs Review before the period ends.

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

#### Example: Calendar Year vs. Rolling Window

Riverside FD is considering switching their 36-hour CE requirement from a
calendar-year period to a 12-month rolling window. Here is how the change
would affect Jake Nguyen on October 15, 2025.

**Calendar year** (`frequency = annual`, `year = 2025`):
```
Period: Jan 1, 2025 – Dec 31, 2025
```
Jake's training from 2024 does not count. Only his 2025 records apply.
He has 22 hours so far (see §2a).

**Rolling 12 months** (`due_date_type = rolling`, `rolling_period_months = 12`):
```
Period: Oct 15, 2024 – Oct 15, 2025
```
Now Jake's records from late 2024 (before he was even hired) would count if
he had any. He does not, so his total is still 22 hours. But for a member
like Maria, who completed a 4-hour drill on November 8, 2024, the rolling
window would capture that session while the calendar-year window would not.

```
Maria (calendar year): 36.0 hours → 100%
Maria (rolling 12 mo): 36.0 + 4.0 = 40.0 hours → 111% (capped display)
```

The rolling window is more forgiving for members who train consistently
across the calendar boundary.

#### Example: Quarterly Requirement Timing

Riverside FD also has a quarterly **EMS skills practice** requirement
(4 hours per quarter). On October 15, 2025, the current quarter is Q4:

```
quarter_month = ((10 - 1) ÷ 3) × 3 + 1 = 10
Period: Oct 1, 2025 – Dec 31, 2025
```

Maria completed a 2-hour EMS drill on September 28 (Q3). That session falls
outside Q4 and does **not** count toward the Q4 requirement. She needs to
log all 4 hours between October 1 and December 31.

Jake completed a 3-hour EMS session on October 3 (Q4). He only needs 1 more
hour this quarter.

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

> **Bug Fix (2026-02-24):** A rolling period of N months can span N+1 calendar months (e.g., Feb 15 – Feb 14 next year = 12 rolling months spanning 13 calendar months). Previously, `total_months` was set from the rolling period config (12) while the calendar month walk counted 13 months, causing `waived_months > total_months` and negative `active_months`. The fix ensures `total_months` is computed from the actual evaluation period dates rather than the rolling period config value.

> **Permanent waivers (2026-02-24):** Waivers with no end date (permanent) use a far-future sentinel (9999-12-31) internally. The overlap calculation naturally caps at `period_end`, so only months within the evaluation period are counted as waived.

### Example: Danielle's Maternity Leave vs. Maria (No Leave)

Danielle Brooks was on maternity leave from **March 10 to July 25, 2025**.
The department created a leave of absence, which automatically generated a
blanket training waiver for the same dates. Both Danielle and Maria are
evaluated against the **36 hours/year** CE requirement.

**Step 1: Count Danielle's waived months**

| Month    | Waiver Coverage        | Days Covered | Waived? |
|----------|------------------------|--------------|---------|
| March    | Mar 10 – Mar 31        | 22           | Yes     |
| April    | Apr 1 – Apr 30         | 30           | Yes     |
| May      | May 1 – May 31         | 31           | Yes     |
| June     | Jun 1 – Jun 30         | 30           | Yes     |
| July     | Jul 1 – Jul 25         | 25           | Yes     |

Waived months = 5

**Step 2: Adjust Danielle's requirement**
```
total_months     = 12  (Jan – Dec)
active_months    = MAX(12 - 5, 1) = 7
adjusted_required = 36 × (7 / 12) = 21.0 hours
```

**Step 3: Compare**

| Member   | Required Hours | Completed Hours | Percentage | Met?  |
|----------|----------------|-----------------|------------|-------|
| Maria    | 36.0           | 36.0            | 100%       | Yes   |
| Danielle | 21.0           | 18.0            | 85.7%      | No    |

Danielle's bar is significantly lower — 21 hours instead of 36 — but she
still has 3 more hours to complete. Without the waiver, she would need to
make up all 36 hours even though she was away for nearly half the year.

### Example: Sam's Targeted Military Waiver

Sam Kowalski was deployed from **February 1 to May 31, 2025**. His training
officer created a waiver targeting only the **annual CE hours** and **shift
attendance** requirements (IDs: `req_hours` and `req_shifts`). The
department decided Sam's **EMT certification** requirement should not be
waived because he could renew it remotely.

Riverside FD has 4 requirements. Here is how Sam's waivers apply to each:

| Requirement        | ID           | Waiver Applies? | Why                         |
|--------------------|--------------|-----------------|------------------------------|
| CE Hours (36/yr)   | `req_hours`  | Yes             | Listed in `requirement_ids`  |
| Shift Attendance   | `req_shifts` | Yes             | Listed in `requirement_ids`  |
| EMT Certification  | `req_cert`   | No              | Not in `requirement_ids`     |
| EMS Skills (quarterly)| `req_ems` | No              | Not in `requirement_ids`     |

**Waived months for `req_hours` and `req_shifts`:**
- Feb: Feb 1–28 = 28 days → waived
- Mar: Mar 1–31 = 31 days → waived
- Apr: Apr 1–30 = 30 days → waived
- May: May 1–31 = 31 days → waived
- Waived months = 4

**CE Hours adjustment:**
```
adjusted_required = 36 × (MAX(12 - 4, 1) / 12) = 36 × (8/12) = 24.0 hours
```

**Shift Attendance adjustment (12 shifts/year):**
```
adjusted_required = 12 × (8 / 12) = 8 shifts
```

Sam needs 24 CE hours and 8 shifts instead of 36 hours and 12 shifts. His
EMT certification and quarterly EMS requirements remain at their original
targets.

### Edge Case: Near the 15-Day Threshold

What if Sam's deployment ended on **May 14** instead of May 31?

- May: May 1–14 = 14 days → **not waived** (14 < 15)

Waived months would drop from 4 to 3, and the adjustment would be:
```
adjusted_required = 36 × (MAX(12 - 3, 1) / 12) = 36 × (9/12) = 27.0 hours
```

A single day makes the difference: ending May 14 means 27 required hours;
ending May 15 means 24 required hours. The 15-day threshold is strict.

### Edge Case: Overlapping Waivers

Suppose Danielle also had a short-term medical waiver (ankle injury) from
**June 20 to July 10** that overlapped with the tail end of her maternity
leave (which ended July 25). The system counts June and July as waived
months only once:

```
Maternity leave covers June fully → June waived
Medical waiver also covers June 20-30 → June already in the set, skip
Maternity leave covers July 1-25 → July waived
Medical waiver covers July 1-10 → July already in the set, skip

Waived months = still 5  (Mar, Apr, May, Jun, Jul)
```

The overlapping waivers do not double-count any month.

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

### Example: Classifying Three Members' Certifications

On October 15, 2025:

| Member   | Certification     | Expiration     | Days Until | Classification |
|----------|-------------------|----------------|------------|----------------|
| Maria    | EMT-B             | Jun 15, 2027   | +609       | Current        |
| Carla    | Paramedic         | Nov 30, 2025   | +46        | Expiring Soon  |
| Tom      | EMT-B             | Sep 30, 2025   | -15        | Expired        |

- Maria's cert is more than 90 days out → **Current**, no alerts
- Carla's cert is within 90 days → **Expiring Soon**, alerts triggered
- Tom's cert is past due → **Expired**, escalation triggered

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

#### Example: Carla's Alert Timeline

Carla's Paramedic certification expires November 30, 2025. Here is the
alert schedule:

| Alert Date    | Days Left | Tier    | Recipients                        |
|---------------|-----------|---------|-----------------------------------|
| Sep 1, 2025   | 90        | 90-day  | Carla only                        |
| Oct 1, 2025   | 60        | 60-day  | Carla only                        |
| Oct 31, 2025  | 30        | 30-day  | Carla + Lt. Davis (training officer)|
| Nov 23, 2025  | 7         | 7-day   | Carla + Lt. Davis + Chief Warren  |
| Dec 1, 2025   | expired   | Expired | Carla + all escalation officers   |

If Carla renews her certification before November 30 and a new training
record is created with an updated expiration date, the system stops sending
further alerts. Any alerts already sent remain in the log but no new tiers
fire.

If Carla misses the deadline and the cert expires on November 30, the system
sends the expired escalation on December 1 (the first daily run after
expiration). Lt. Davis, Chief Warren, and the compliance officer all receive
the notification with instructions to follow up.

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

#### Example: Tom Renews His EMT

Tom completes his EMT-Basic recertification on **October 20, 2025**. The
EMT-B course defines `expiration_months = 24`.

```
base_month = 10 - 1 + 24 = 33
year       = 2025 + (33 ÷ 12) = 2025 + 2 = 2027
month      = (33 % 12) + 1 = 9 + 1 = 10
day        = MIN(20, 31) = 20

expiration_date = October 20, 2027
```

If Tom had completed it on **January 31, 2025** with a 1-month expiration
(hypothetical):
```
base_month = 1 - 1 + 1 = 1
year       = 2025 + (1 ÷ 12) = 2025
month      = (1 % 12) + 1 = 2
day        = MIN(31, 28) = 28   (Feb 2025 has 28 days)

expiration_date = February 28, 2025
```

The system adjusts for shorter months so the date is always valid.

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

### Example: Riverside FD Compliance Matrix (October 15, 2025)

The training officer pulls up the compliance matrix for Station 7. The
department has 4 active requirements. Danielle's CE hours and shift targets
are waiver-adjusted (shown in parentheses).

```
                   CE Hours    EMT Cert    Shifts      EMS Skills
                   (36/yr)     (cert)      (12/yr)     (4 hrs/qtr)
                   ─────────   ─────────   ─────────   ─────────
Maria Torres       completed   completed   in_progress completed
Jake Nguyen        in_progress completed   in_progress in_progress
Danielle Brooks    in_progress completed   in_progress completed
  (waiver adj.)    (21 hrs)    (no adj.)   (7 shifts)  (no adj.)
Sam Kowalski       in_progress completed   completed   not_started
  (waiver adj.)    (24 hrs)    (no adj.)   (8 shifts)  (no adj.)
Tom Raines         in_progress expired     in_progress not_started
Carla Mitchell     completed   completed   completed   completed
```

**How each cell is determined — selected highlights:**

**Maria / Shifts = `in_progress`:**
Maria has 11 of 12 required shifts. 11 > 0 but 11 < 12 → `in_progress`.

**Danielle / CE Hours = `in_progress`:**
Danielle's requirement is adjusted from 36 to 21 hours (5 months waived).
She has 18 hours completed. 18 > 0 but 18 < 21 → `in_progress`.

**Tom / EMT Cert = `expired`:**
Tom has a matching EMT-B record, but expiration_date (Sep 30) < today
(Oct 15) → `expired`.

**Sam / EMS Skills = `not_started`:**
Sam has no EMS skills practice records in Q4 (Oct 1 – Dec 31). He returned
from deployment in June but has not logged any Q4 EMS training yet →
`not_started`.

**Sam / Shifts = `completed`:**
Sam's shift requirement was waiver-adjusted from 12 to 8 shifts. He has
completed 9 shifts since returning in June. 9 >= 8 → `completed`.

### Member Completion Percentage

Each member row shows an overall `completion_percentage`:

```
completed_count = number of "completed" cells for the member
completion_percentage = (completed_count / total_requirements) × 100
```

**Applied to the matrix above:**

| Member           | Completed Cells | Total | Completion % |
|------------------|-----------------|-------|--------------|
| Maria Torres     | 3               | 4     | 75%          |
| Jake Nguyen      | 1               | 4     | 25%          |
| Danielle Brooks  | 2               | 4     | 50%          |
| Sam Kowalski     | 2               | 4     | 50%          |
| Tom Raines       | 0               | 4     | 0%           |
| Carla Mitchell   | 4               | 4     | 100%         |

Note that `expired` and `in_progress` cells do **not** count toward
`completed_count`. Only cells with `completed` status contribute.

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

#### Example: Zero-Hour Requirement

Riverside FD creates a new continuing-education requirement mid-year with
`required_hours = 0` (they plan to set the value later). In the meantime,
every member automatically shows 100% for that requirement because dividing
by zero would be undefined. The system treats it as automatically met.

### Biannual Requirements

Biannual requirements do **not** use a time-based window. Compliance is
determined entirely by whether the member holds a non-expired certification.
If the latest matching record has an expired `expiration_date`, the status
is `expired` regardless of hours completed.

#### Example: Biannual CPR Certification

Riverside FD has a biannual CPR certification requirement. The system does
not ask "did you complete CPR training this year?" — it only asks "do you
hold a valid CPR cert right now?"

**Maria** completed CPR recertification on March 15, 2024. Her cert expires
March 15, 2026 (24-month validity). On October 15, 2025:
- Expiration (Mar 15, 2026) >= today (Oct 15, 2025) → **completed**

**Tom** completed CPR on January 10, 2023. His cert expired January 10,
2025. Even though Tom logged 50 hours of general training this year, his
CPR requirement shows:
- Expiration (Jan 10, 2025) < today (Oct 15, 2025) → **expired**

Hours completed are irrelevant for biannual certification requirements.
Tom must recertify.

### Waived Month Threshold

A month counts as waived only when the waiver covers **15 or more days**
of that calendar month. A waiver covering Jan 1–14 (14 days) does **not**
waive January.

#### Example: The One-Day Difference

Sam Kowalski's military deployment officially ended May 14 in one scenario
and May 15 in another. The department's annual CE requirement is 36 hours.

| Scenario    | May Coverage | May Waived? | Waived Months | Adjusted Req |
|-------------|-------------|-------------|---------------|--------------|
| Ends May 14 | May 1–14 = 14 days | No (14 < 15) | 3 (Feb–Apr) | 36 × 9/12 = 27.0 hrs |
| Ends May 15 | May 1–15 = 15 days | Yes (15 >= 15)| 4 (Feb–May) | 36 × 8/12 = 24.0 hrs |

That single day changes Sam's required hours by 3 — from 27 to 24. If Sam
has completed exactly 25 hours, he passes in one scenario and fails in the
other.

### Overlapping Waivers

Multiple waivers covering the same calendar month are deduplicated. The
system tracks waived months as a set of `(year, month)` tuples, so
overlapping waivers never double-count a month.

#### Example: Two Waivers, Same Month

Danielle has a maternity leave waiver (Mar 10 – Jul 25) and a medical
waiver for a sprained ankle (Jun 20 – Jul 10). Both cover June and July:

```
Waived set after maternity leave:  {Mar, Apr, May, Jun, Jul}
Processing medical waiver:
  Jun 20–30 → June already in set, skip
  Jul 1–10  → July already in set, skip

Final waived months = 5  (not 7)
```

Without deduplication, June and July would be double-counted, producing 7
waived months and reducing Danielle's requirement to 36 × (5/12) = 15 hours.
With deduplication, the correct result is 36 × (7/12) = 21 hours.

### Requirement Applicability

Before evaluating a requirement for a member, the system checks:
1. The requirement must be `active = true`
2. The requirement must belong to the member's organization
3. If the requirement specifies `required_roles`, the member must hold one
   of those roles. If `applies_to_all = true`, it applies regardless of role.

#### Example: Role-Specific Requirements

Riverside FD has a **Driver/Operator Apparatus Check** requirement with
`applies_to_all = false` and `required_roles = ["driver_operator"]`.

| Member           | Roles                        | Requirement Applies? |
|------------------|------------------------------|----------------------|
| Danielle Brooks  | driver_operator, firefighter | Yes (has the role)   |
| Maria Torres     | firefighter, emt             | No (missing role)    |
| Jake Nguyen      | probationary                 | No (missing role)    |

Maria and Jake are never evaluated against this requirement. It does not
appear in their compliance summary or matrix row. Danielle sees it as one
of her active requirements.

This means different members can have different `requirements_total` values.
If the department has 4 universal requirements plus 1 driver-only
requirement, Danielle's total is 5 while Maria's total is 4.

### Certification Matching Rules

When determining if a training record satisfies a certification requirement,
the system checks (in order):
1. **Training type** — record's `training_type` matches requirement's
   `training_type` (if specified)
2. **Name match** — requirement name appears as a substring of
   `record.course_name` (case-insensitive)
3. **Registry code** — requirement's `registry_code` appears as a substring
   of `record.certification_number` (case-insensitive)

#### Example: Matching Ambiguity

Requirement: **"HAZMAT Operations"** (`registry_code = "HAZMAT-OPS"`)

| Record Course Name              | Cert Number        | Match? | How                    |
|---------------------------------|--------------------|--------|------------------------|
| HAZMAT Operations Certification | HAZMAT-OPS-2025-41 | Yes    | Both name and code     |
| Advanced HAZMAT Operations      | AHO-2025-99        | Yes    | Name contains "HAZMAT Operations" |
| HAZMAT Awareness                | HAZMAT-OPS-2025-22 | Yes    | Code contains "HAZMAT-OPS" |
| General Safety Training         | GS-2025-88         | No     | Neither name nor code  |

The third record ("HAZMAT Awareness") matches on registry code even though
the course name does not contain "HAZMAT Operations." This is intentional —
some agencies reuse cert number prefixes across related courses. Training
officers should ensure registry codes are specific enough to avoid false
matches.

### Hours Rounding

Adjusted required hours are rounded to 2 decimal places. This prevents
floating-point comparison issues when checking completion.

#### Example: Rounding in Practice

Sam's adjusted requirement:
```
36 × (8 / 12) = 24.000000000000004   (floating point)
Rounded: 24.0
```

Without rounding, a member with exactly 24.0 completed hours might fail the
comparison `24.0 >= 24.000000000000004`. Rounding eliminates this.

A more pronounced example with a 7-month active period:
```
36 × (7 / 12) = 20.999999999999996
Rounded: 21.0
```

### Leave-of-Absence Auto-Linking

When a leave of absence is created, the system automatically creates a
linked training waiver (same date range) unless the leave has
`exempt_from_training_waiver = true`. Changes to the leave's dates
automatically update the linked waiver. Deactivating the leave also
deactivates the linked waiver.

#### Example: Danielle's Leave Changes

Danielle's maternity leave was originally entered as **March 10 – July 25**.
The system automatically created a training waiver for those same dates.

On July 10, Danielle notifies the department she is returning early on
**July 15** instead of July 25. The training officer updates the leave
end date to July 15. The linked waiver automatically updates to
Mar 10 – Jul 15.

This changes July's coverage from 25 days (waived) to 15 days (still
waived, since 15 >= 15). If the return date had been July 14 instead,
July would have only 14 covered days and would **not** be waived, changing
Danielle's waived months from 5 to 4 and increasing her requirement from
21.0 to 24.0 hours.

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
