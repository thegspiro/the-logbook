# Training Waivers & Leaves of Absence

## Overview

When a department member takes a leave of absence (medical, military, personal,
etc.), the system reduces their training requirements proportionally so they are
not penalised for time they were inactive. This guide explains how training
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

   | Field          | Description                                                                                                                                  |
   | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Member**     | Select the member from the dropdown (sorted by last name).                                                                                   |
   | **Applies To** | Two checkboxes: _Training Requirements_ and _Meeting Attendance & Shift Requirements_. Tick one or both; the hint says what will be created. |
   | **Leave Type** | Choose one: _Leave of Absence_, _Medical_, _Military_, _Personal_, _Administrative_, _New Member_, or _Other_.                               |
   | **Start Date** | First day the member is on leave.                                                                                                            |
   | **End Date**   | Last day the member is on leave (must be on or after start date). Leave blank and check **Permanent** for waivers with no end date.          |
   | **Reason**     | Optional free-text explanation.                                                                                                              |

4. Click **Create Waiver**.

**Applies To options:**

There are two options, not three. Meetings and shifts are one choice because a
Leave of Absence has no field saying which of the two it covers — scheduling,
attendance and tier grading all treat a leave as excusing both. (Until
2026-09-28 the form offered them as separate boxes, but ticking _Meeting
Attendance_ alone still created a leave that excused every shift.) A waiver
that excuses meetings but not shifts is not possible today; see
`docs/KNOWN_LIMITATIONS.md` (W13-5).

- **Both ticked**: Creates a Leave of Absence and automatically creates a linked training waiver with matching dates. This is the most common choice.
- **Training Requirements only**: Creates a standalone training waiver without a Leave of Absence. The member's meeting attendance and shift scheduling are not affected.
- **Meeting Attendance & Shift Requirements only**: Creates a Leave of Absence with `exempt_from_training_waiver = true`. Training requirements are not adjusted.

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

- **View inactive leaves**: Toggle the _Show inactive leaves_ checkbox above
  the table to include previously deactivated leaves.
- **Deactivate a leave**: Click the **Deactivate** button on an active leave
  row. This performs a soft-delete; the record is kept for audit history but
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
month. For example:

- Leave from Jan 1 – Jan 31 → January is waived (31 days covered).
- Leave from Jan 10 – Jan 25 → January is waived (16 days covered).
- Leave from Jan 20 – Jan 31 → January is **not** waived (12 days covered).

### Overlapping leaves

If a member has multiple overlapping leave records (e.g., two leaves that both
cover March), the month is only counted once. The system uses a set of
(year, month) tuples to deduplicate.

### Which requirements are affected?

Leaves of absence created through the Member Lifecycle page apply to **all**
training requirements.

Training-specific waivers (created via the `/training/waivers` API) can
optionally target specific requirement IDs via the `requirement_ids` field.
When `requirement_ids` is null, the waiver applies to all requirements.

### Requirement types that are adjusted

| Requirement Type  | Adjusted Field                                            |
| ----------------- | --------------------------------------------------------- |
| **Hours**         | `required_hours` is reduced proportionally.               |
| **Shifts**        | `required_shifts` is reduced proportionally.              |
| **Calls**         | `required_calls` is reduced proportionally.               |
| **Courses**       | Not adjusted (completion is binary, not proportional).    |
| **Certification** | Not adjusted (you either have a valid cert or you don't). |

### Frequency-based evaluation windows

The adjustment is applied within the requirement's evaluation window:

| Frequency | Window                                                     |
| --------- | ---------------------------------------------------------- |
| Annual    | Jan 1 – Dec 31 of the requirement year                     |
| Quarterly | Current quarter (3-month window)                           |
| Monthly   | Current calendar month                                     |
| Biannual  | Two-year window (certification-based, no hours adjustment) |
| One-time  | No window (no adjustment applies)                          |

---

## Where Compliance Is Evaluated

The waiver adjustment is applied consistently across all compliance views:

| View / Endpoint                                                        | Description                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| **My Training** (`GET /training/module-config/my-training`)            | Member's personal training dashboard.               |
| **Compliance Matrix** (`GET /training/compliance-matrix`)              | Officer view: all members x all requirements.       |
| **Competency Matrix** (`GET /training/competency-matrix`)              | Department heat-map / readiness view.               |
| **Training Report** (`GET /training/reports/user/{id}`)                | Individual member training report.                  |
| **Requirements Progress** (`GET /training/requirements/progress/{id}`) | Per-user, per-requirement progress.                 |
| **Program Enrollment Progress**                                        | Stored progress percentages in program enrollments. |

---

## API Reference

### Member Leaves of Absence (Membership Module)

These are the endpoints used by the Member Lifecycle UI.

| Method   | Endpoint                                    | Permission                   | Description                                                  |
| -------- | ------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `POST`   | `/api/v1/users/leaves-of-absence`           | `members.manage`             | Create a leave.                                              |
| `GET`    | `/api/v1/users/leaves-of-absence`           | `members.manage`             | List org leaves (optional `user_id`, `active_only` filters). |
| `GET`    | `/api/v1/users/{user_id}/leaves-of-absence` | `members.manage` or own user | Get a member's leaves.                                       |
| `GET`    | `/api/v1/users/leaves-of-absence/me`        | Any authenticated user       | Get your own leaves.                                         |
| `PATCH`  | `/api/v1/users/leaves-of-absence/{id}`      | `members.manage`             | Update a leave.                                              |
| `DELETE` | `/api/v1/users/leaves-of-absence/{id}`      | `members.manage`             | Deactivate (soft-delete) a leave.                            |

### Training Waivers (Training Module)

These are more granular waivers that can target specific requirements.

| Method   | Endpoint                        | Permission             | Description                                               |
| -------- | ------------------------------- | ---------------------- | --------------------------------------------------------- |
| `POST`   | `/api/v1/training/waivers`      | `training.manage`      | Create a waiver.                                          |
| `GET`    | `/api/v1/training/waivers`      | `training.manage`      | List waivers (optional `user_id`, `active_only` filters). |
| `GET`    | `/api/v1/training/waivers/me`   | Any authenticated user | Get your own waivers.                                     |
| `PATCH`  | `/api/v1/training/waivers/{id}` | `training.manage`      | Update a waiver.                                          |
| `DELETE` | `/api/v1/training/waivers/{id}` | `training.manage`      | Deactivate (soft-delete) a waiver.                        |

---

## Session Waiver Requests

A waiver above is something a training officer grants. A **session waiver
request** is something a member asks for: to be excused from one training
session that counts against them (owner decisions, 2026-11-10).

**Off until the department turns it on.** A training officer saves the policy
(`PUT /api/v1/training/waivers/requests/policy`, `training.manage`). With no
policy saved, or one that cannot be read, members cannot ask and nothing else
changes. The policy chooses:

| Setting                     | Choices                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `deadline`                  | before the session starts; 24 hours after it ends; 7 days after it ends |
| `cap` / `cap_period`        | no cap, or 1–365 approved requests per calendar year or any 12 months   |
| `categories`                | up to 20 labels a member picks from, optionally required                |
| `reason_text`               | off, optional or required                                               |
| `attachment`                | supporting documents off, optional or required (default off)            |
| `attachment_retention_days` | days a request's documents are kept once it is closed (default 365)     |
| `approver_position_ids`     | the positions whose holders decide                                      |

**Who may ask.** A member may ask about a training session that is not
cancelled and is linked to a session-attendance requirement that applies to
them, before the deadline, once per session. Not a member who is exempt from
compliance, who checked in (or was recorded as attending), or who has no
waivers left under the cap. Withdrawing a pending request frees the session to
ask again; a denied request does not.

**Who decides.** The current holders of the chosen positions are asked. If
that leaves nobody (no positions chosen, the positions are vacant, or the only
holder is the member asking), the Chief is asked, and failing a Chief, every
holder of `training.manage`. A Chief may always decide. Nobody decides their
own request. The first decision is final, except that the Chief may approve a
denied request, with a reason, never on their own request; the denial stays on
record beside the override.

**The cap** counts approved requests, by the session's date, including denials
the Chief overrode. It is checked when a request is approved, not when it is
made, so several may be pending at once. Under `rolling_12_months` no 12-month
span may hold more approved requests than the cap. A Chief's override is not
blocked by the cap, but counts toward it.

**What an approval does.** The session drops out of the member's held and
attended counts for every attendance requirement it counts toward, including
one linked after the approval, and off their missed-mandatory list. It is
matched on the session, never on the day: another session that day is still
owed, and no month of an hours, shifts or calls requirement is reduced. A
member who attended anyway is still credited with attending.

**Privacy.** The reason and the deciders' notes are encrypted at rest, shown
only to the member and to those who may decide, and kept out of notifications
and the audit log. The member's data export carries their requests, reasons
included, and the decision log of each, notes included; it does not carry
notes the member wrote as a decider on anyone else's request. Anonymizing a
departed member clears the reason and the notes; the request itself is kept.

**Supporting documents.** When the policy's `attachment` is `optional` or
`required`, a member may file up to three documents with a request: PDF,
JPEG, PNG or HEIC, 10 MB each, judged by the file's contents, not its name.
They can be filed with the request (`POST .../with-attachments`, multipart)
or added while it is pending; nothing is added once it is decided or
withdrawn. Under `required`, a request without one is refused. Only the
member and the people who may decide the request can open a document; a
former decider who no longer holds the position cannot. Each download is
audited (`attendance_waiver_attachment_downloaded`, ids only), is sent
uncacheable, and is named `waiver-attachment-1.pdf` and so on: the uploader's
filename is never kept, because a doctor's note's name can say what it is
about. The daily `attendance_waiver_attachment_retention` task deletes a
request's documents `attachment_retention_days` after it was decided (or, for
one withdrawn or voided, after it closed) and audits the ids it removed; the
request and its decision log are kept. Anonymizing the member deletes them at
once. The data export lists each document's record (type, size, checksum,
date) but not the file. Documents never appear in the annual review or in a
notification.

**In the annual review.** An evaluation template can show a member's requests
for the review period, by session date: `training.session_waivers_summary`
(how many were made, approved, overridden, denied, withdrawn, pending and
voided) and `training.session_waiver_history` (one line per request: session,
outcome with who decided, category). Neither shows the reason, a decider's
note or an attachment, and neither can be scored. See
`docs/EVALUATIONS_MODULE.md`, "Figures".

**Where it is in the app.**

| Who              | Where                                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Training officer | **Training Admin > Settings & Data > Session Waivers** turns requests on and sets the policy above, including **Supporting documents** and how many days they are kept                                                                                                            |
| Member           | A training session's page offers **Request to be excused** when the session counts against them, shows how many waivers are left, then the request's state; the request form has a document field when the policy takes them; **My Training > My Waiver Requests** lists them all |
| Approver         | **Training Admin > Records > Waiver Requests**, or `/attendance-waivers`, lists what they decide; `/attendance-waivers/{id}` is the page their email opens, with the filed documents to download (and, for the member, to add while pending)                                      |

The email's approve and deny buttons only pre-select a choice
(`?action=approve|deny`). The page never decides on load, because mail scanners
open every link; the approver presses the button and confirms. A denial needs a
note to the member. The Chief's override appears only on a denied request and
only to a Chief.

| Method | Endpoint                                                             | Who                                           |
| ------ | -------------------------------------------------------------------- | --------------------------------------------- |
| `GET`  | `/api/v1/training/waivers/requests/policy`                           | Any authenticated user                        |
| `PUT`  | `/api/v1/training/waivers/requests/policy`                           | `training.manage`                             |
| `GET`  | `/api/v1/training/waivers/requests/eligibility`                      | Any authenticated user, about themselves      |
| `POST` | `/api/v1/training/waivers/requests`                                  | Any authenticated user, for themselves        |
| `GET`  | `/api/v1/training/waivers/requests/mine`                             | Any authenticated user                        |
| `GET`  | `/api/v1/training/waivers/requests`                                  | The requests the caller may decide or decided |
| `GET`  | `/api/v1/training/waivers/requests/{id}`                             | The member, or someone who may decide         |
| `POST` | `/api/v1/training/waivers/requests/{id}/withdraw`                    | The member, while pending                     |
| `POST` | `/api/v1/training/waivers/requests/{id}/approve`                     | Someone who may decide, while pending         |
| `POST` | `/api/v1/training/waivers/requests/{id}/deny`                        | Someone who may decide, while pending         |
| `POST` | `/api/v1/training/waivers/requests/{id}/override`                    | A Chief, on a denied request                  |
| `POST` | `/api/v1/training/waivers/requests/with-attachments`                 | Any authenticated user, for themselves        |
| `POST` | `/api/v1/training/waivers/requests/{id}/attachments`                 | The member, while pending                     |
| `GET`  | `/api/v1/training/waivers/requests/{id}/attachments/{attachment_id}` | The member, or someone who may decide         |

### Asking the member for more information _(2026-11-13)_

Anyone who may decide a request may ask its member a question first, while the
request is pending, no question is already open (`info_requested_at` is NULL)
and it is not waiting on the member to reconfirm a moved session
(`reconfirm_requested_at` is NULL). Asking writes an `info_requested` log entry
whose note is the question, sets `info_requested_at`, and leaves the status
**pending**. The deciders' in-app prompts are archived, and the member gets an
in-app notice and an email naming who asked and the session, **never the
question**; the training notice links to My Training, where the answer form is.

Only the member answers, while the question is open. Answering writes a
`member_responded` entry whose note is the answer, clears
`info_requested_at`, and prompts the deciders again (in-app and email, worded
"answered your question", never the answer). Any number of rounds may follow,
one open question at a time.

Deciders may approve or deny without waiting for the answer; deciding,
withdrawing and voiding all clear `info_requested_at`. Questions and answers
are log notes, encrypted at rest like every note, and appear in no
notification, email, log line or audit row (audit rows carry ids only).
`describe` reports `can_request_info` (a decider, and the state above) and
`can_respond` (the member, while a question is open); `GET .../mine` returns
each request with its log so the member can read every round.

| Method | Endpoint                                              | Who                                                 |
| ------ | ----------------------------------------------------- | --------------------------------------------------- |
| `POST` | `/api/v1/training/waivers/requests/{id}/request-info` | Someone who may decide, body `{note}`               |
| `POST` | `/api/v1/training/waivers/requests/{id}/respond`      | The member, while a question is open, body `{note}` |
| `POST` | `/api/v1/meetings/waiver-requests/{id}/request-info`  | As above, for a business-meeting request            |
| `POST` | `/api/v1/meetings/waiver-requests/{id}/respond`       | As above, for a business-meeting request            |

A request in the wrong state is refused with 400 and a sentence saying why.

---

## Example Scenario

**Situation**: Firefighter Smith takes a 3-month medical leave from March 1
through May 31. The department requires 24 hours of training per rolling
12-month period.

1. The training officer navigates to **Member Lifecycle > Leave of Absence**
   and creates a leave for Smith:
   - Type: Medical
   - Start: 2026-03-01
   - End: 2026-05-31
   - Reason: "Shoulder surgery recovery"

2. The system identifies that March, April, and May are each covered by

   > = 15 days, so **3 months are waived**.

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

**Check-in wins** (owner decision, 2026-11-10): a meeting the member was
marked present at counts as attended even if they also hold a waiver for it.
A per-meeting waiver excuses only a meeting the member missed. The rule lives
in `tally_attendance`, which the voting check, the attendance dashboard and
the annual evaluation all use, and the election attendee import copies the
same present members.

### Where attendance is affected

| View / Endpoint                                                 | Description                                          |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| **Attendance Dashboard** (`GET /meetings/attendance/dashboard`) | Secretary's per-member attendance summary.           |
| **Voting Eligibility** (election service)                       | Uses attendance % to determine if a member can vote. |

### Per-meeting waivers vs. Leave of Absence

There are two ways a meeting can be excluded from a member's attendance:

1. **Per-meeting waiver**: An officer grants a waiver for a specific meeting
   (via the meeting detail page or `POST /meetings/{id}/attendance-waiver`,
   with `user_id` and `reason` in a JSON body; the reason is kept out of the
   URL and the audit log). This sets `waiver_reason` on the `MeetingAttendee`
   record. An approved member request (below) sets the same waiver.

2. **Leave of Absence**: Created via Member Lifecycle. Automatically excludes
   all meetings whose date falls within the leave period — no need to grant
   individual per-meeting waivers.

Both are subtracted from the denominator independently.

### Business-meeting waiver requests

A member can ask to be excused from a business meeting, in the same engine as
session waiver requests (`AttendanceWaiverService` bound to the
`business_meeting` workflow) and with the same rules: deadline presets, one
request per meeting, withdraw, the cap (counting only approved **meeting**
requests, Chief overrides included), one decision, and the Chief's override of
a denial. What differs:

- **Its own policy**, at `organizations.settings["meetings"]["waiver_policy"]`,
  saved by the Secretary through `PUT /api/v1/meetings/waiver-requests/policy`
  (`meetings.manage`). Off until saved; the generic settings save cannot write
  it.
- **It is about the business_meeting event**, since members cannot see a
  minutes record until it is approved. Not when the member checked in (or is
  marked present on the minutes record), when a leave of absence covers the
  meeting, or when the Secretary has already waived it.
- **Routing**: the chosen positions; failing them, the Secretary; failing the
  Secretary, every holder of `meetings.manage`. A Chief may always decide.
- **Approving writes the waiver** onto the meeting's minutes record: the
  `MeetingAttendee` row gets `waiver_reason` "Excused: approved request" (plus
  the category), `waiver_granted_by` the decider and `waiver_request_id` the
  request; `present` is left alone (check-in wins). Never the member's reason:
  `waiver_reason` is plain text shown on voting and ballot screens, and the
  reason stays encrypted on the request. If the minutes record does not exist
  yet, `MeetingsService.create_from_event` carries approved requests over when
  it builds one (absent members get a row with `present=False`). A minutes
  record created by hand, with no event, cannot be requested; the Secretary's
  grant still works on it.
- Cancelling or deleting the event voids pending requests (training ones too);
  decided ones are kept.

The routes mirror the training ones under `/api/v1/meetings/waiver-requests`
(`policy`, `eligibility`, submit, `mine`, the decider queue, one request,
`withdraw`, `approve`, `deny`, `override`).

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

No. When you create a Leave of Absence (from any UI), the system
automatically creates a linked training waiver unless you explicitly opt out
with the `exempt_from_training_waiver` flag. You only need a separate
standalone Training Waiver if you want to waive specific requirements while
keeping others active (use the "Training Only" option in the Waiver Management
page).

**Q: What happens if I deactivate a leave?**

The leave is soft-deleted, and its linked training waiver (if any) is also
deactivated. The member's requirements revert to the full unadjusted values.
Their compliance status is recalculated on the next page load.

**Q: Can a leave cover only part of a month?**

Yes, but for **training**, a month is only excluded from calculations if the
leave covers 15 or more days of that month. For **meeting attendance**, any
meeting whose date falls within the leave period is excluded regardless of how
many days the leave covers in that month.

**Q: Does the leave affect shift scheduling?**

The Member Leave of Absence is also read by the shift module to exclude the
member from scheduling during the leave period.

**Q: Do I need to grant per-meeting waivers for each meeting during a leave?**

No. The Leave of Absence automatically excludes all meetings during the leave
period. Per-meeting waivers are only needed for one-off absences outside a
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
