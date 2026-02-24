# Training Waivers & Leaves of Absence

## Overview

When a department member takes a leave of absence (medical, military, personal,
etc.), the system reduces their training requirements proportionally so they are
not penalised for time they were inactive.  This guide explains how training
officers create and manage leaves, how the system adjusts compliance
calculations, and what members see on their end.

---

## How It Works (The Short Version)

1. A **training officer** creates a Leave of Absence for the member with a
   start date, end date, and leave type.
2. Unless `exempt_from_training_waiver` is set, the system **automatically
   creates a linked training waiver** with matching dates. Changes to the
   leave's dates sync to the linked waiver, and deactivating the leave also
   deactivates the waiver.
3. The system counts how many **calendar months** fall within the leave period.
4. Every rolling-period requirement (annual hours, quarterly shifts, etc.) has
   its required value **reduced proportionally**:

       adjusted_required = base_required x (active_months / total_months)

5. The member's compliance percentage and met/not-met status are recalculated
   everywhere: the member's own training page, the compliance matrix, the
   competency matrix, training reports, and program enrollment progress.

---

## Step-by-Step: Granting a Leave of Absence

### From the Waiver Management Page (recommended)

1. Navigate to **Members > Admin > Waivers** (or use the sidebar link).
2. Click the **Create Waiver** tab.
3. Fill in the form:

   | Field           | Description |
   |-----------------|-------------|
   | **Member**      | Select the member from the dropdown (sorted by last name). |
   | **Applies To**  | Multi-select checkboxes: *Training*, *Meetings*, *Shifts*. Pick any combination. |
   | **Leave Type**  | Choose one: *Leave of Absence*, *Medical*, *Military*, *Personal*, *Administrative*, *New Member*, or *Other*. |
   | **Start Date**  | First day the member is on leave. |
   | **End Date**    | Last day the member is on leave (must be on or after start date). Leave blank and check **Permanent** for waivers with no end date. |
   | **Reason**      | Optional free-text explanation. |

4. Click **Create Waiver**.

**Applies To options (multi-select):**
- **Training + Meetings + Shifts** (all selected): Creates a Leave of Absence and automatically creates a linked training waiver with matching dates. This is the most common choice.
- **Training only**: Creates a standalone training waiver without a Leave of Absence. The member's meeting attendance and shift scheduling are not affected.
- **Meetings and/or Shifts only** (Training unchecked): Creates a Leave of Absence with `exempt_from_training_waiver = true`. Training requirements are not adjusted.
- Any combination of the three is valid.

**Permanent waivers:**
- Leave the **End Date** blank and check **Permanent (no end date)** to create a waiver that never expires.
- Permanent waivers display a purple "Permanent" badge in all status columns.
- Internally, the calculation layer maps a null end date to a far-future sentinel (9999-12-31) for period calculations.

**New Member leave type:**
- The **New Member** leave type is designed for long-service members who are exempt from certain training requirements. It functions identically to other leave types for calculation purposes.

### From the Member Lifecycle page (alternative)

1. Navigate to **Administration > Member Lifecycle**.
2. Select the **Leave of Absence** tab.
3. Click the **Add Leave of Absence** button (top-right).
4. Fill in the form (Member, Leave Type, Start/End Date, Reason).
5. Click **Create Leave**.

The leave immediately appears in the table and the system begins excluding
covered months from all compliance calculations.

### Managing existing leaves

- **View inactive leaves**: Toggle the *Show inactive leaves* checkbox above
  the table to include previously deactivated leaves.
- **Deactivate a leave**: Click the **Deactivate** button on an active leave
  row.  This performs a soft-delete; the record is kept for audit history but
  no longer affects calculations.

---

## What the Member Sees

On the member's **My Training** page, each affected requirement shows a blue
info banner:

> Adjusted for 2 waived months of leave (originally 24 hrs, adjusted to 20 hrs
> for 10 active months)

The progress bar and compliance percentage reflect the adjusted (lower) target.

On the member's **Profile** page (visible to officers), active leaves appear
in the sidebar as yellow cards showing the leave type, date range, and reason.

---

## Waiver Calculation Details

### What counts as a "waived month"?

A calendar month is waived if the leave covers **15 or more days** of that
month.  For example:

- Leave from Jan 1 – Jan 31 → January is waived (31 days covered).
- Leave from Jan 10 – Jan 25 → January is waived (16 days covered).
- Leave from Jan 20 – Jan 31 → January is **not** waived (12 days covered).

### Overlapping leaves

If a member has multiple overlapping leave records (e.g., two leaves that both
cover March), the month is only counted once.  The system uses a set of
(year, month) tuples to deduplicate.

### Which requirements are affected?

Leaves of absence created through the Member Lifecycle page apply to **all**
training requirements.

Training-specific waivers (created via the `/training/waivers` API) can
optionally target specific requirement IDs via the `requirement_ids` field.
When `requirement_ids` is null, the waiver applies to all requirements.

### Requirement types that are adjusted

| Requirement Type | Adjusted Field |
|-----------------|----------------|
| **Hours** | `required_hours` is reduced proportionally. |
| **Shifts** | `required_shifts` is reduced proportionally. |
| **Calls** | `required_calls` is reduced proportionally. |
| **Courses** | Not adjusted (completion is binary, not proportional). |
| **Certification** | Not adjusted (you either have a valid cert or you don't). |

### Frequency-based evaluation windows

The adjustment is applied within the requirement's evaluation window:

| Frequency   | Window |
|------------|--------|
| Annual     | Jan 1 – Dec 31 of the requirement year |
| Quarterly  | Current quarter (3-month window) |
| Monthly    | Current calendar month |
| Biannual   | Two-year window (certification-based, no hours adjustment) |
| One-time   | No window (no adjustment applies) |

---

## Where Compliance Is Evaluated

The waiver adjustment is applied consistently across all compliance views:

| View / Endpoint | Description |
|----------------|-------------|
| **My Training** (`GET /training/module-config/my-training`) | Member's personal training dashboard. |
| **Compliance Matrix** (`GET /training/compliance-matrix`) | Officer view: all members x all requirements. |
| **Competency Matrix** (`GET /training/competency-matrix`) | Department heat-map / readiness view. |
| **Training Report** (`GET /training/reports/user/{id}`) | Individual member training report. |
| **Requirements Progress** (`GET /training/requirements/progress/{id}`) | Per-user, per-requirement progress. |
| **Program Enrollment Progress** | Stored progress percentages in program enrollments. |

---

## API Reference

### Member Leaves of Absence (Membership Module)

These are the endpoints used by the Member Lifecycle UI.

| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| `POST` | `/api/v1/users/leaves-of-absence` | `members.manage` | Create a leave. |
| `GET` | `/api/v1/users/leaves-of-absence` | `members.manage` | List org leaves (optional `user_id`, `active_only` filters). |
| `GET` | `/api/v1/users/{user_id}/leaves-of-absence` | `members.manage` or own user | Get a member's leaves. |
| `GET` | `/api/v1/users/leaves-of-absence/me` | Any authenticated user | Get your own leaves. |
| `PATCH` | `/api/v1/users/leaves-of-absence/{id}` | `members.manage` | Update a leave. |
| `DELETE` | `/api/v1/users/leaves-of-absence/{id}` | `members.manage` | Deactivate (soft-delete) a leave. |

### Training Waivers (Training Module)

These are more granular waivers that can target specific requirements.

| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| `POST` | `/api/v1/training/waivers` | `training.manage` | Create a waiver. |
| `GET` | `/api/v1/training/waivers` | `training.manage` | List waivers (optional `user_id`, `active_only` filters). |
| `GET` | `/api/v1/training/waivers/me` | Any authenticated user | Get your own waivers. |
| `PATCH` | `/api/v1/training/waivers/{id}` | `training.manage` | Update a waiver. |
| `DELETE` | `/api/v1/training/waivers/{id}` | `training.manage` | Deactivate (soft-delete) a waiver. |

---

## Example Scenario

**Situation**: Firefighter Smith takes a 3-month medical leave from March 1
through May 31.  The department requires 24 hours of training per rolling
12-month period.

1. The training officer navigates to **Member Lifecycle > Leave of Absence**
   and creates a leave for Smith:
   - Type: Medical
   - Start: 2026-03-01
   - End: 2026-05-31
   - Reason: "Shoulder surgery recovery"

2. The system identifies that March, April, and May are each covered by
   >= 15 days, so **3 months are waived**.

3. Smith's annual training requirement is adjusted:
   - Total months: 12
   - Waived months: 3
   - Active months: 9
   - Adjusted requirement: 24 x (9 / 12) = **18 hours**

4. If Smith has completed 18 or more hours during the active months, they
   show as **compliant** in the compliance matrix, training reports, and
   their own My Training page.

5. Smith's meeting attendance is also adjusted: any meetings held during
   March–May are excluded from the attendance denominator, so Smith's
   attendance percentage and voting eligibility are not penalised.

---

## Meeting Attendance

A Leave of Absence also affects **meeting attendance** calculations.
Meetings that fall within the leave period are automatically excluded from
the attendance denominator so the member's attendance percentage is not
penalised for meetings they could not attend.

### How it works

The attendance calculation is:

    attendance_pct = meetings_attended / eligible_meetings × 100

Where:

    eligible_meetings = total_meetings − per-meeting_waivers − meetings_during_leave

Any meeting whose `meeting_date` falls between a leave's `start_date` and
`end_date` (inclusive) is excluded.

### Where attendance is affected

| View / Endpoint | Description |
|----------------|-------------|
| **Attendance Dashboard** (`GET /meetings/attendance/dashboard`) | Secretary's per-member attendance summary. |
| **Voting Eligibility** (election service) | Uses attendance % to determine if a member can vote. |

### Per-meeting waivers vs. Leave of Absence

There are two ways a meeting can be excluded from a member's attendance:

1. **Per-meeting waiver**: An officer grants a waiver for a specific meeting
   (via the meeting detail page or `POST /meetings/{id}/attendance-waiver`).
   This sets `waiver_reason` on the `MeetingAttendee` record.

2. **Leave of Absence**: Created via Member Lifecycle. Automatically excludes
   all meetings whose date falls within the leave period — no need to grant
   individual per-meeting waivers.

Both are subtracted from the denominator independently.

---

## Auto-Linking: LOA ↔ Training Waiver

When a Leave of Absence is created (and `exempt_from_training_waiver` is not
set), the system automatically creates a linked training waiver:

1. **On LOA creation**: A `TrainingWaiver` record is created with the same
   `start_date` and `end_date`. The LOA stores the waiver ID in
   `linked_training_waiver_id`.

2. **On LOA date change**: If the LOA's dates are updated, the linked waiver's
   dates are updated to match.

3. **On LOA deactivation**: The linked training waiver is also deactivated.

4. **On exempt toggle**: If `exempt_from_training_waiver` is set to `true` on
   an existing LOA that has a linked waiver, the linked waiver is deactivated.
   If set back to `false`, a new waiver is created.

This ensures that creating an LOA from the Member Lifecycle page or the Waiver
Management page both produce consistent results without requiring manual
creation of separate training waivers.

---

## FAQ

**Q: Do I need to create both a Leave of Absence and a Training Waiver?**

No.  When you create a Leave of Absence (from any UI), the system
automatically creates a linked training waiver unless you explicitly opt out
with the `exempt_from_training_waiver` flag.  You only need a separate
standalone Training Waiver if you want to waive specific requirements while
keeping others active (use the "Training Only" option in the Waiver Management
page).

**Q: What happens if I deactivate a leave?**

The leave is soft-deleted, and its linked training waiver (if any) is also
deactivated. The member's requirements revert to the full unadjusted values.
Their compliance status is recalculated on the next page load.

**Q: Can a leave cover only part of a month?**

Yes, but for **training**, a month is only excluded from calculations if the
leave covers 15 or more days of that month.  For **meeting attendance**, any
meeting whose date falls within the leave period is excluded regardless of how
many days the leave covers in that month.

**Q: Does the leave affect shift scheduling?**

The Member Leave of Absence is also read by the shift module to exclude the
member from scheduling during the leave period.

**Q: Do I need to grant per-meeting waivers for each meeting during a leave?**

No.  The Leave of Absence automatically excludes all meetings during the leave
period.  Per-meeting waivers are only needed for one-off absences outside a
formal leave.

**Q: Where can I see all waivers across the department?**

Navigate to **Members > Admin > Waivers** for a unified view of all waivers
(training, meetings, shifts). Training officers can also see training-specific
waivers in the **Training Admin > Dashboard > Training Waivers** tab.

**Q: What is the compliance summary card on member profiles?**

The profile card shows a green/yellow/red compliance indicator based on
requirements met, certification expirations, and training hours. Red means
non-compliant (expired certs or <50% requirements met), yellow means at risk
(expiring certs or incomplete requirements), and green means fully compliant.
