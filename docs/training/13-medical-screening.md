# Medical Screening

The Medical Screening module tracks occupational health requirements, screening records, and compliance for department members and prospective members. It centralizes physical exams, drug screenings, fitness assessments, psychological evaluations, and other medical clearances into a single compliance-aware system with expiration tracking and grace period support.

Medical Screening is a standalone module accessible from the sidebar. It integrates with the Membership module for member and prospect lookups.

---

## Table of Contents

1. [Medical Screening Overview](#medical-screening-overview)
2. [Screening Requirements](#screening-requirements)
3. [Creating Requirements](#creating-requirements)
4. [Screening Records](#screening-records)
5. [Recording a Screening](#recording-a-screening)
6. [Compliance Dashboard](#compliance-dashboard)
7. [Expiring Screenings](#expiring-screenings)
8. [Prospect Screening](#prospect-screening)
9. [Realistic Example: Annual Physical Compliance](#realistic-example-annual-physical-compliance)
10. [Troubleshooting](#troubleshooting)

---

## Medical Screening Overview

**Route:** `/medical-screening`

**Feature Flag:** `MODULE_MEDICAL_SCREENING_ENABLED` must be set to `true` in the environment configuration. When disabled, the Medical Screening sidebar item and all related API endpoints are inaccessible.

The Medical Screening page uses a **three-tab layout**:

| Tab | Purpose |
|-----|---------|
| **Requirements** | Define what screenings your department requires, how often, and for which roles |
| **Records** | Log individual screening results for members and prospects |
| **Compliance** | View department-wide compliance status, identify gaps, and track upcoming expirations |

> **[SCREENSHOT NEEDED]:** _The Medical Screening landing page showing the three-tab navigation (Requirements, Records, Compliance) with the Requirements tab active, displaying a table of screening requirements._

### Permissions

| Action | Required Permission |
|--------|-------------------|
| View requirements, records, and compliance data | `medical_screening.view` |
| Create, update, or delete requirements | `medical_screening.manage` |
| Create, update, or delete screening records | `medical_screening.manage` |

> **HIPAA Note:** Medical screening records contain protected health information (PHI). Access to this module should be restricted to authorized personnel only. Assign the `medical_screening.view` and `medical_screening.manage` permissions exclusively to roles that have a legitimate need to access medical compliance data (e.g., Chief Officers, Health & Safety Officers, HR administrators). All access to medical screening endpoints is logged in the audit trail.

### Screening Types

The system supports six screening types, each representing a category of occupational health evaluation:

| Screening Type | Display Name | Typical Use |
|----------------|-------------|-------------|
| `physical_exam` | Physical Exam | Annual NFPA 1582 physicals, DOT physicals |
| `medical_clearance` | Medical Clearance | Return-to-duty clearance, SCBA clearance |
| `drug_screening` | Drug Screening | Pre-employment, random, post-incident drug/alcohol tests |
| `vision_hearing` | Vision & Hearing | Audiometric exams, vision acuity tests |
| `fitness_assessment` | Fitness Assessment | CPAT, department fitness evaluations, treadmill stress tests |
| `psychological` | Psychological | CISM evaluations, pre-employment psych exams, fitness-for-duty |

---

## Screening Requirements

Requirements define **what** your department mandates and **how often**. Each requirement specifies a screening type, recurrence interval, applicable roles, and a grace period for compliance calculations.

Navigate to **Medical Screening > Requirements** tab to view all requirements.

> **[SCREENSHOT NEEDED]:** _The Requirements tab showing a table of requirements with columns: Name, Screening Type, Frequency, Applies To, Grace Period, Status (Active/Inactive), and action buttons (Edit, Delete)._

### Requirement Fields

| Field | Type | Description |
|-------|------|-------------|
| **Name** | String (required) | Descriptive name for the requirement (e.g., "Annual NFPA 1582 Physical") |
| **Screening Type** | Enum (required) | One of the six screening types listed above |
| **Description** | Text (optional) | Detailed description, instructions, or notes about the requirement |
| **Frequency (Months)** | Integer (optional) | Recurrence interval in months. Leave blank for one-time requirements |
| **Applies to Roles** | JSON array (optional) | Specific roles this requirement applies to. Leave blank to apply to all members |
| **Grace Period (Days)** | Integer (default: 30) | Number of days after expiration during which a member remains compliant |
| **Is Active** | Boolean (default: true) | Whether this requirement is currently enforced |

### One-Time vs Recurring Requirements

- **Recurring:** When `frequency_months` is set (e.g., 12), the system expects a new screening every N months. The expiration date on each record determines when the next screening is due.
- **One-time:** When `frequency_months` is null, a single passing record satisfies the requirement indefinitely. There is no expiration cycle.

---

## Creating Requirements

**Required Permission:** `medical_screening.manage`

1. Navigate to **Medical Screening > Requirements** tab.
2. Click **Add Requirement**.
3. Fill in the requirement fields:

| Field | Example Value |
|-------|---------------|
| **Name** | Annual NFPA 1582 Physical |
| **Screening Type** | Physical Exam |
| **Description** | Annual medical examination per NFPA 1582 standard. Includes cardiac stress test for members over 40. |
| **Frequency (Months)** | 12 |
| **Applies to Roles** | _(blank — applies to all members)_ |
| **Grace Period (Days)** | 30 |
| **Is Active** | Yes |

4. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Add Requirement form/modal showing all fields filled out for an annual physical requirement, with the Screening Type dropdown open displaying all six options._

### Editing and Deleting Requirements

- Click the **Edit** button on any requirement row to modify its fields. Changes take effect immediately for future compliance calculations.
- Click the **Delete** button to remove a requirement. A confirmation dialog appears. Deleting a requirement does not delete associated screening records — it only removes the requirement from compliance calculations.

### Role-Based Requirements

When **Applies to Roles** is populated, only members assigned to those roles are evaluated for compliance against that requirement. This is useful for role-specific mandates:

| Requirement | Applies to Roles |
|-------------|-----------------|
| CPAT Fitness Assessment | Firefighter, Lieutenant, Captain |
| DOT Physical | Driver/Operator |
| Pre-Employment Psych Eval | _(one-time, all roles)_ |
| SCBA Medical Clearance | Firefighter, Lieutenant, Captain, Hazmat Technician |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Member has no role assigned | Not evaluated against role-specific requirements; evaluated against all-roles requirements only |
| Member's role changes after a screening is recorded | Compliance recalculates on next view — if the new role is not in the requirement's role list, the member is no longer evaluated against it |
| Requirement's role list is updated | Compliance recalculates for all members on next view |
| All roles are removed from a requirement | Requirement applies to all members (same as null) |

---

## Screening Records

Records capture the **result** of an individual screening event — who was screened, when, what type, what the outcome was, and who reviewed it.

Navigate to **Medical Screening > Records** tab to view all records.

> **[SCREENSHOT NEEDED]:** _The Records tab showing a table of screening records with columns: Member/Prospect Name, Screening Type, Status (color-coded badge), Scheduled Date, Completed Date, Expiration Date, Provider, and action buttons._

### Record Statuses

| Status | Color | Description |
|--------|-------|-------------|
| **Scheduled** | Blue | Screening is scheduled but not yet completed |
| **Completed** | Gray | Screening was completed; result has not been reviewed |
| **Passed** | Green | Screening completed with a passing result |
| **Failed** | Red | Screening completed with a failing result |
| **Pending Review** | Yellow | Screening completed; awaiting officer review of results |
| **Waived** | Purple | Screening requirement waived (with documented reason) |
| **Expired** | Orange | Screening result has passed its expiration date |

### Record Fields

| Field | Type | Description |
|-------|------|-------------|
| **Requirement** | Foreign key (optional) | Link to a screening requirement. Optional because ad-hoc screenings may not map to a defined requirement |
| **Member** | Foreign key (one required) | The member being screened. Provide either `user_id` or `prospect_id`, not both |
| **Prospect** | Foreign key (one required) | The prospective member being screened. See [Prospect Screening](#prospect-screening) |
| **Screening Type** | Enum (required) | The type of screening performed |
| **Status** | Enum (required) | Current status of the record (see table above) |
| **Scheduled Date** | Date (optional) | When the screening is/was scheduled |
| **Completed Date** | Date (optional) | When the screening was actually completed |
| **Expiration Date** | Date (optional) | When this screening result expires |
| **Provider Name** | String (optional) | Name of the medical provider, lab, or evaluator |
| **Result Summary** | Text (optional) | Brief summary of the result (e.g., "Cleared for full duty") |
| **Result Data** | JSON (optional) | Structured result data (lab values, measurements, scores) |
| **Reviewed By** | Foreign key (optional) | Officer who reviewed the result |
| **Reviewed At** | Datetime (optional) | When the result was reviewed |
| **Notes** | Text (optional) | Additional notes or comments |

> **HIPAA Note:** The `result_summary`, `result_data`, and `notes` fields may contain PHI. The system does not cache API responses for medical screening endpoints (they are included in `UNCACHEABLE_PREFIXES`). All record access is logged in the audit trail. Limit the specificity of data entered — record compliance outcomes (passed/failed/waived) rather than detailed medical findings when possible.

---

## Recording a Screening

**Required Permission:** `medical_screening.manage`

1. Navigate to **Medical Screening > Records** tab.
2. Click **Add Record**.
3. Fill in the record fields:

| Field | Example Value |
|-------|---------------|
| **Requirement** | Annual NFPA 1582 Physical |
| **Member** | FF Jake Thompson |
| **Screening Type** | Physical Exam |
| **Status** | Passed |
| **Scheduled Date** | 2026-05-15 |
| **Completed Date** | 2026-05-15 |
| **Expiration Date** | 2027-05-15 |
| **Provider Name** | Dr. Sarah Chen, Occupational Health Associates |
| **Result Summary** | Cleared for full duty, no restrictions |
| **Notes** | Stress test normal. Follow-up recommended for elevated BP. |

4. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Add Record form/modal showing fields filled out for a completed physical exam with Passed status, including the member dropdown, requirement dropdown, date fields, and provider information._

### Status Workflow

Records typically progress through these status transitions:

```
Scheduled → Completed → Pending Review → Passed / Failed
                                       → Waived (with documented reason)
Passed → Expired (automatic, when expiration_date passes)
```

- **Scheduled to Completed:** Update the record after the screening occurs, adding the completed date and provider information.
- **Completed to Pending Review:** When results require officer review before a pass/fail determination.
- **Pending Review to Passed/Failed:** After the reviewing officer evaluates the results. The `reviewed_by` and `reviewed_at` fields are set automatically.
- **Waived:** Set directly when a screening is waived. Document the reason in the notes field.
- **Expired:** The system treats a record as expired when the current date exceeds the `expiration_date`. The status badge updates automatically.

### Editing and Deleting Records

- Click the **Edit** button on any record row to update its fields (e.g., updating status from Scheduled to Passed after a screening is completed).
- Click the **Delete** button to remove a record. A confirmation dialog appears. Deletion is permanent and logged in the audit trail.

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Record created without a requirement link | Record is stored and displayed but does not affect compliance calculations for any requirement |
| Record created with both `user_id` and `prospect_id` | API rejects the request — provide exactly one |
| Record created with neither `user_id` nor `prospect_id` | API rejects the request — at least one is required |
| Expiration date is in the past at creation time | Record is saved; status badge shows Expired (orange) if status is Passed or Completed |
| Completed date is after expiration date | Record is saved; no automatic validation prevents this, but it indicates a data entry error |

---

## Compliance Dashboard

The **Compliance** tab provides a department-wide view of who is compliant, who is not, and who has screenings expiring soon.

Navigate to **Medical Screening > Compliance** tab.

> **[SCREENSHOT NEEDED]:** _The Compliance tab showing summary cards at the top (Total Requirements, Compliant, Non-Compliant, Expiring Soon) and a member-by-member compliance matrix below with green/red/amber indicators per requirement column._

### Compliance Summary

The top of the Compliance tab displays four summary metrics:

| Metric | Description |
|--------|-------------|
| **Total Requirements** | Count of active screening requirements |
| **Compliant** | Number of members who meet all applicable requirements |
| **Non-Compliant** | Number of members missing one or more required screenings |
| **Expiring Soon** | Number of members with at least one screening expiring within 60 days |

### How Compliance Is Calculated

For each active requirement, the system evaluates each applicable member (based on role filters):

1. **Find the most recent record** for the member with a matching screening type and a status of **Passed**, **Completed**, or **Waived**.
2. **Check expiration:**
   - If the record has an `expiration_date` and it is today or later: **Compliant**.
   - If the record has no expiration date (one-time requirement): **Compliant** indefinitely.
   - If the `expiration_date` has passed but is within the requirement's `grace_period_days`: **Compliant** (grace period active).
   - If the `expiration_date` has passed and the grace period has also expired: **Non-Compliant**.
3. **No qualifying record found:** **Non-Compliant**.

### Grace Period

The grace period provides a buffer after a screening expires. During the grace period, the member is still considered compliant, giving the department time to schedule and complete the next screening.

**Example:** A requirement has a 30-day grace period. A member's physical exam expired on June 1. The member remains compliant until July 1 (June 1 + 30 days). After July 1, the member is non-compliant.

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Grace period is 0 | Member becomes non-compliant the day after expiration |
| Member has multiple records for the same screening type | Only the most recent qualifying record (Passed/Completed/Waived) is considered |
| Member has a Passed record and a later Failed record | The most recent qualifying record is used — if the Failed record is newer, the system looks for the most recent Passed/Completed/Waived record before it |
| Requirement is deactivated (`is_active = false`) | Requirement is excluded from compliance calculations entirely |
| Member has a Waived record with no expiration | Compliant indefinitely (waiver has no expiry) |
| Member has a Waived record with an expiration | Compliant until the waiver expiration + grace period |

### Per-Member Compliance

Click on any member row in the compliance matrix to view their individual compliance detail, or use the API endpoint:

```
GET /api/v1/medical-screening/compliance/{user_id}
```

This returns a `ComplianceSummary` for the specified member:

| Field | Type | Description |
|-------|------|-------------|
| `total_requirements` | Integer | Number of active requirements applicable to this member |
| `compliant_count` | Integer | Number of requirements the member currently satisfies |
| `non_compliant_count` | Integer | Number of requirements the member does not satisfy |
| `expiring_soon_count` | Integer | Number of compliant screenings expiring within 60 days |

> **[SCREENSHOT NEEDED]:** _A member's individual compliance detail view showing a list of applicable requirements with status indicators (green check for compliant, red X for non-compliant, amber clock for expiring soon), the most recent screening date, expiration date, and days until expiration for each._

---

## Expiring Screenings

The Compliance tab includes an **expiring screenings** section that highlights screenings approaching their expiration date, giving officers advance notice to schedule renewals.

### Viewing Expiring Screenings

The expiring screenings section on the Compliance tab shows a **60-day lookahead window** by default. Each entry displays the member name, screening type, expiration date, and days remaining.

**Color-coded urgency:**

| Urgency | Color | Criteria |
|---------|-------|----------|
| **Critical** | Red | 7 days or fewer until expiration |
| **Warning** | Amber | 8 to 30 days until expiration |
| **Upcoming** | Blue | 31 to 60 days until expiration |

> **[SCREENSHOT NEEDED]:** _The expiring screenings section of the Compliance tab showing a list of upcoming expirations with color-coded urgency badges (red for 3 days remaining, amber for 22 days, blue for 45 days), member names, screening types, and expiration dates._

### Expiring Screenings API

Retrieve expiring screenings programmatically:

```
GET /api/v1/medical-screening/expiring?days=N
```

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `days` | Integer | 1-365 | 30 | Number of days to look ahead for expiring screenings |

The response includes all screening records with `expiration_date` within the specified window, sorted by expiration date ascending (most urgent first).

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| `days` parameter is 0 or negative | API returns 400 Bad Request |
| `days` parameter exceeds 365 | API returns 400 Bad Request |
| `days` parameter omitted | Defaults to 30 days |
| Screening already expired (expiration in the past) | Not included in the expiring endpoint — already expired screenings appear as non-compliant in the compliance view |
| Screening has no expiration date | Not included — one-time screenings do not expire |

---

## Prospect Screening

Medical screenings can be recorded for **prospective members** (candidates in the membership pipeline) before they are converted to full members. This is essential for pre-employment physicals, drug screenings, and psychological evaluations that must be completed before onboarding.

> **Cross-reference:** See [Membership Management > Prospective Members Pipeline](./01-membership.md#prospective-members-pipeline) for details on managing the prospect pipeline.

### Recording a Prospect Screening

The process is identical to recording a member screening, except you select a **Prospect** instead of a **Member** in the record form:

1. Navigate to **Medical Screening > Records** tab.
2. Click **Add Record**.
3. In the **Prospect** field, search for and select the prospective member.
4. Leave the **Member** field blank.
5. Complete the remaining fields as usual.
6. Click **Save**.

> **[SCREENSHOT NEEDED]:** _The Add Record form showing the Prospect field populated with a prospective member name, the Member field blank, and the screening type set to Drug Screening with status Pending Review._

### Prospect Compliance

View a prospect's compliance status using the dedicated endpoint:

```
GET /api/v1/medical-screening/compliance/prospect/{prospect_id}
```

This returns the same `ComplianceSummary` structure as member compliance, evaluated against all active requirements (role-based filtering does not apply to prospects since they do not yet have assigned roles).

### Prospect-to-Member Transition

When a prospect is converted to a full member through the membership pipeline, their screening records remain linked to their new member account. The `prospect_id` on existing records is retained for historical reference, and the records continue to count toward the member's compliance.

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Prospect has no screening records | Compliance shows 0 compliant out of total requirements |
| Prospect is deleted from the pipeline | Screening records are retained (orphaned) for audit purposes |
| Prospect is converted to a member | Existing screening records remain valid and count toward member compliance |
| Department requires pre-employment screenings | Create one-time requirements (null frequency) for pre-employment screening types; track prospect compliance before onboarding |

> **HIPAA Note:** Prospect screening records are subject to the same PHI protections as member records. Access is controlled by the same `medical_screening.view` and `medical_screening.manage` permissions. Ensure that personnel involved in the hiring process who need to view prospect screening compliance have the appropriate permissions assigned.

---

## Realistic Example: Annual Physical Compliance

This walkthrough demonstrates a complete medical screening workflow — from creating a requirement through tracking compliance and handling expirations — using a realistic department scenario.

### Background

**Falls Church Volunteer Fire Department** has 45 active members across three stations. The department's Health & Safety Officer, **Captain Diane Alvarez**, needs to implement annual physical exam tracking per NFPA 1582 and ensure all members maintain current physicals. The department also requires pre-employment drug screening for all new members.

---

### Part 1: Setting Up Requirements

Captain Alvarez navigates to **Medical Screening > Requirements** and creates two requirements.

**Requirement 1: Annual Physical**

| Field | Value |
|-------|-------|
| **Name** | Annual NFPA 1582 Physical Examination |
| **Screening Type** | Physical Exam |
| **Description** | Annual medical examination per NFPA 1582. Includes cardiac stress test for members aged 40+. Must be performed by a department-approved occupational health provider. |
| **Frequency (Months)** | 12 |
| **Applies to Roles** | _(blank — all members)_ |
| **Grace Period (Days)** | 30 |
| **Is Active** | Yes |

**Requirement 2: Pre-Employment Drug Screening**

| Field | Value |
|-------|-------|
| **Name** | Pre-Employment Drug Screening |
| **Screening Type** | Drug Screening |
| **Description** | 10-panel drug screening required before membership is finalized. One-time requirement. |
| **Frequency (Months)** | _(blank — one-time)_ |
| **Applies to Roles** | _(blank — all members)_ |
| **Grace Period (Days)** | 0 |
| **Is Active** | Yes |

The Compliance tab now shows both requirements. Since no screening records have been entered yet, all 45 members show as non-compliant for the annual physical, and all members who have not previously completed a drug screening show as non-compliant for that requirement.

---

### Part 2: Bulk-Recording Existing Physicals

Captain Alvarez has a spreadsheet from the department's occupational health provider showing that 38 of 45 members completed their annual physicals within the past year. She enters records for each member.

**Example record for FF Maria Torres:**

| Field | Value |
|-------|-------|
| **Requirement** | Annual NFPA 1582 Physical Examination |
| **Member** | FF Maria Torres |
| **Screening Type** | Physical Exam |
| **Status** | Passed |
| **Scheduled Date** | 2026-03-10 |
| **Completed Date** | 2026-03-10 |
| **Expiration Date** | 2027-03-10 |
| **Provider Name** | Occupational Health Associates — Dr. Sarah Chen |
| **Result Summary** | Cleared for full duty, no restrictions |

After entering all 38 records, the Compliance tab updates:

| Metric | Value |
|--------|-------|
| **Total Requirements** | 2 |
| **Compliant (Physical)** | 38 of 45 members |
| **Non-Compliant (Physical)** | 7 members |
| **Expiring Soon (Physical)** | 4 members (physicals expiring within 60 days) |

---

### Part 3: Handling the 7 Non-Compliant Members

Captain Alvarez clicks on the non-compliant count to see which members are overdue. The list shows:

1. **FF James Kowalski** — Physical expired 2026-04-15 (73 days ago, past 30-day grace period)
2. **FF/EMT Priya Patel** — Physical expired 2026-05-28 (30 days ago, last day of grace period)
3. **Lt. Mike Chen** — No physical on record
4. **FF Rosa Martinez** — Physical expired 2026-06-01 (26 days ago, still within 30-day grace period)
5. **FF David Kim** — No physical on record (new member, joined 2026-06-01)
6. **FF/Paramedic Amy Larson** — On leave of absence, physical expired 2026-02-01
7. **Probie Chris Washington** — Probationary member, no physical on record

Captain Alvarez takes action:

- **Kowalski and Patel:** Schedules physicals for next week. Creates records with status **Scheduled** and upcoming dates.
- **Lt. Chen:** Contacts him directly — discovers his physical was done at a different provider. Enters the record with **Passed** status.
- **Martinez:** Still within grace period (26 days < 30 days). Captain Alvarez notes she is technically compliant but schedules her physical for the following week.
- **Kim and Washington:** New members who need their first department physical. Schedules both.
- **Larson:** On leave — Captain Alvarez notes the record but the physical will be required upon return to duty.

> **[SCREENSHOT NEEDED]:** _The Compliance tab filtered to show the 7 non-compliant members for the Annual Physical requirement, with their names, last screening date (or "None"), expiration date, and days overdue._

---

### Part 4: Tracking a Prospect

A new candidate, **Alex Rivera**, is moving through the membership pipeline. Captain Alvarez needs to record his pre-employment drug screening before the membership committee votes.

1. Navigates to **Medical Screening > Records** tab.
2. Clicks **Add Record**.
3. Selects **Alex Rivera** in the Prospect field.
4. Sets Screening Type to **Drug Screening**.
5. Sets Status to **Pending Review** (lab results expected in 3 days).
6. Enters Scheduled Date: 2026-06-25, Provider: "QuickScreen Labs".
7. Saves the record.

Three days later, results arrive. Captain Alvarez edits the record:
- Updates Status to **Passed**.
- Sets Completed Date to 2026-06-25.
- Adds Result Summary: "10-panel negative, all clear".
- Expiration Date left blank (one-time screening).

Alex Rivera's prospect compliance now shows 1/2 requirements met (drug screening passed, annual physical still needed). The membership committee can see that the pre-employment screening is complete.

---

### Part 5: Monitoring Expirations Over Time

Two months later (August 2026), Captain Alvarez checks the Compliance tab. The expiring screenings section shows:

| Member | Screening | Expiration | Days Left | Urgency |
|--------|-----------|------------|-----------|---------|
| FF Sarah Odom | Annual Physical | 2026-08-30 | 3 | Red |
| EMT Tom Bradley | Annual Physical | 2026-09-05 | 9 | Amber |
| FF Carlos Reyes | Annual Physical | 2026-09-18 | 22 | Amber |
| Lt. Lisa Park | Annual Physical | 2026-10-15 | 49 | Blue |

Captain Alvarez immediately contacts FF Odom (3 days remaining) and schedules her physical. She sends a department-wide reminder for members expiring in September.

---

### Key Takeaways from This Example

1. **Requirements drive compliance** — Define what is needed once; the system tracks every member automatically.
2. **Grace periods prevent false alarms** — The 30-day grace period for physicals means members are not immediately flagged as non-compliant the day after expiration.
3. **One-time requirements simplify pre-employment** — Drug screenings with null frequency are satisfied indefinitely after a single passing record.
4. **Prospect screening integrates with the pipeline** — Pre-employment screenings can be tracked before a candidate becomes a member.
5. **Expiration tracking is proactive** — The 60-day lookahead with color-coded urgency gives officers time to schedule renewals before members become non-compliant.

---

## API Reference

### Requirements Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/medical-screening/requirements` | List all screening requirements |
| `POST` | `/api/v1/medical-screening/requirements` | Create a new requirement |
| `GET` | `/api/v1/medical-screening/requirements/{id}` | Get a specific requirement |
| `PUT` | `/api/v1/medical-screening/requirements/{id}` | Update a requirement |
| `DELETE` | `/api/v1/medical-screening/requirements/{id}` | Delete a requirement |

### Records Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/medical-screening/records` | List all screening records |
| `POST` | `/api/v1/medical-screening/records` | Create a new record |
| `GET` | `/api/v1/medical-screening/records/{id}` | Get a specific record |
| `PUT` | `/api/v1/medical-screening/records/{id}` | Update a record |
| `DELETE` | `/api/v1/medical-screening/records/{id}` | Delete a record |

### Compliance Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/medical-screening/compliance/{user_id}` | Get compliance summary for a member |
| `GET` | `/api/v1/medical-screening/compliance/prospect/{prospect_id}` | Get compliance summary for a prospect |
| `GET` | `/api/v1/medical-screening/expiring?days=N` | List screenings expiring within N days (1-365, default 30) |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Medical Screening does not appear in the sidebar | Verify that `MODULE_MEDICAL_SCREENING_ENABLED=true` is set in your environment configuration. Restart the backend if the flag was just added. |
| "Permission denied" when viewing records | Your role needs the `medical_screening.view` permission. Contact your administrator to assign it. |
| "Permission denied" when creating records or requirements | Your role needs the `medical_screening.manage` permission. Contact your administrator to assign it. |
| Member shows non-compliant but they have a passing record | Check the record's `expiration_date` — it may have passed, and the grace period may also have elapsed. Also verify the record's status is one of Passed, Completed, or Waived (Scheduled and Pending Review do not count toward compliance). |
| Member shows compliant but their screening expired | The member is likely within the grace period. Check the requirement's `grace_period_days` setting. The member will become non-compliant when the grace period ends. |
| Compliance count does not match manual count | Verify that the requirement's **Applies to Roles** filter matches your expectations. Members without a matching role are excluded from compliance calculations for role-specific requirements. Also check that the requirement is marked **Is Active**. |
| Expiring screenings section is empty | No screenings are expiring within the 60-day default window. All members either have screenings expiring further out or have one-time screenings that do not expire. |
| Record shows Expired status but I set it to Passed | The record's `expiration_date` has passed. The status badge updates automatically based on the current date. Update the record with a new screening result and expiration date. |
| Cannot link a record to a requirement | The requirement dropdown only shows active requirements. Verify the requirement exists and `is_active` is true. |
| Prospect screening not appearing in compliance | Use the prospect-specific compliance endpoint: `GET /medical-screening/compliance/prospect/{prospect_id}`. Prospect compliance is separate from member compliance. |
| Drug screening shows as compliant indefinitely | This is expected for one-time requirements (null frequency). The record has no expiration date, so it remains valid indefinitely. To require periodic re-screening, set a frequency on the requirement. |
| API returns 422 when creating a record | Check the request payload. Common causes: missing required fields (`screening_type`, `status`), providing both `user_id` and `prospect_id`, providing neither `user_id` nor `prospect_id`, or invalid enum values for `screening_type` or `status`. |
| Compliance data seems stale | Compliance is calculated on each request — there is no cached state. If data appears stale, verify the underlying records are correct. Refresh the page to re-fetch. |
| Grace period not working as expected | The grace period starts from the `expiration_date` on the record, not from the completed date. Verify the expiration date is set correctly. A grace period of 0 means the member becomes non-compliant immediately after expiration. |

---

**Previous:** [Grants & Fundraising](./12-grants-fundraising.md) | **Next:** [Elections & Voting](./14-elections.md)
