# Workflow Review — W80 Training event lifecycle: create, credit, correct, excuse, move

**Driven:** 2026-11-08 · **As:** `training_officer`, `member`, `member2`, `chief`, `admin` · **Viewports:** 1280×900, 390×844
**Commit:** `c059b69d` (and this branch's changes for the re-drive) · **Database:** continued from W79, then a fresh seed of `logbook_workflow_review`

An owner-requested pass outside the rotation: one Training event followed from
creation to credit, then everything a training officer does to it afterwards —
edit, update, credit members, delete, waive attendance, postpone. W20 had driven
check-in only on a Training event with no linked session; this pass drove the
session that writes records, and the requirement credit behind it.

Owner decisions taken during the run (2026-11-08) are recorded on the findings
they settle.

---

## What was driven

1. As `training_officer`, Training Administration → Records → Sessions →
   Create Session: the four-step wizard, first with a 7 PM start and 6 PM end
   and 0 credit hours, then a real session starting at the current quarter hour,
   linked to an hours requirement and counting toward a 100% session-attendance
   requirement ("Monthly Drill Attendance", Chief override allowed).
2. As `member` at 390×844: RSVP, self check-in from the event page, re-scan,
   check-out a minute later.
3. As `training_officer`: Check In Members — a roster member and themselves.
4. As `member2`: RSVP Going and never check in (the no-show).
5. As `training_officer`: a second session created yesterday 7–9 PM with
   instructor confirmation required; check-in attempted after it ended; Add All
   Eligible as Going; Edit Times for two members.
6. As `member` at 390×844: "I was there" on the past drill, claiming 6:00–11:45 PM.
7. As `training_officer`: Attendance Requests → approve it as pre-filled;
   Finalize Attendance; Review and approve, with one member's minutes typed as
   1200; the members' records and My Training; the compliance matrix.
8. Waivers, all three meanings the owner named: a one-day training waiver for
   the no-show (Members → Waivers), its deactivation; credit given anyway (Edit
   Times, attendance request); a Chief override from the compliance matrix as
   `chief`, and the same override attempted as `training_officer`.
9. As `training_officer`: retitle and try to move the finalized event; Reopen
   Attendance; Delete Event; the members' records after.
10. As `training_officer`: move the live drill (three check-ins) a week later
    through Edit; the attendees and their notifications; then Cancel Event.
11. As `training_officer`: an event they were checked into, ended and finalized;
    their own approval link, approved in the browser.
12. Re-drive of every fix, as the same roles (see "After the fixes").

Not driven: recurring session creation; the QR page at a kiosk; the email
channel (in-app notifications were read; email was read from code).

## Held up ✅

- The wizard saved exactly what was entered — both requirement links, 2 credit
  hours, flexible window — and landed on the event page, which says when credit
  lands ("when attendance is finalized"). Events clean.
- Self check-in on a phone, a repeat scan offering check-out, and the
  "credit after finalize" message on both screens.
- Edit Times prefilled the scheduled times; finalize's confirmation explains the
  precedence (Edit Times, then check-out, then derived) and that approval is
  pending; the approval page lists every attendee with credited and approved
  minutes; credit was recorded and showed on the member's My Training as
  5.75/24 hours and 1/1 sessions once the member's hire date preceded the drill.
- A finalized event locks its schedule (date fields disabled, banner explains
  Reopen) and still takes a retitle; Delete and Cancel are hidden until reopened.
- Reopen keeps the records until re-finalize, as its dialog says; Delete of the
  reopened event took every member's credit with it (records cancelled, 0 h);
  Cancel of the live drill removed the in-progress record.
- Waiver undo: deactivating the waiver put the no-show back to 0/1 and 24 h.
- The Chief override recorded with a reason, the member read "met by override"
  with the honest count 0/1, and `training_officer` was refused (403, "Only the
  Chief can override a requirement").
- A move of the live drill did notify everyone RSVP'd, in-app ("has been
  updated (end datetime, start datetime)"), and by email per the code.

## Findings

### W80-1 — HIGH — Moving an event kept its check-ins and would credit them for the new date — ✅ FIXED

**Did:** as `training_officer`, Edit on the live Ladder Drill (10:00–12:00, three
check-ins at 10:04–10:06), start and end moved to the same times a week later.
**Saw:** saved without a word. The attendance list still read "Checked In — In:
10:06 AM" for two members — a bare time that on the new date reads as that
morning. Crediting clamps an early check-in forward to the scheduled start
(`EventService._credited_check_in_time`), so at next week's finalize each would
have been credited the full 120 minutes whether or not they came.
**Expected:** a check-in from the original slot never earns credit for another.
**Where:** `backend/app/services/event_service.py` `update_event`.
**Fix:** owner decision — refuse a move that strands check-ins; a real Postpone
is W80-11. `_refuse_orphaning_check_ins` computes the check-in window under the
proposed schedule (with the hour of early grace check-in itself allows on
flexible and window events) and refuses with "N members are already checked in
at a time outside the new schedule…" when any check-in falls outside it. A
correction that still contains every check-in goes through, and an unchanged
schedule (the edit form resends every field) does not query at all.
`tests/test_event_reschedule_check_ins.py`. Re-driven: refused, start unchanged.

### W80-2 — MED — Approved minutes had no bound: 20 hours recorded for a 2-hour drill — ✅ FIXED

**Did:** on the approval page, Blair's 120 minutes typed as 1200 (a slipped zero).
**Saw:** no mark on the row; the confirmation said only "Records 3 members'
training credit"; Blair's record was completed at 20 hours, and the Training
dashboard's "Hours this quarter" read 26.8 department-wide.
**Expected:** a figure past the session's length is noticed before it is filed.
**Where:** `frontend/src/pages/training/TrainingApprovalPage.tsx`.
**Fix:** owner decision — warn, allow. A row over the scheduled length reads
"More than the 120-minute session" (amber, tied to the input by
`aria-describedby`), and the confirmation names each such member and switches to
the warning variant. `TrainingApprovalPage.test.tsx`. Re-driven as `chief`.

### W80-3 — MED — An attendance request's claimed times were approved as shown, 5¾ hours for a 2-hour drill — ✅ FIXED

**Did:** as `member`, "I was there" claiming 6:00–11:45 PM for a 7–9 PM drill;
as `training_officer`, Approve.
**Saw:** the dialog prefilled the claim with no hint it ran outside the event;
approved as shown, the member was credited 345 minutes.
**Where:** `frontend/src/components/event-detail/AttendancePetitionDecisionDialogs.tsx`.
**Fix:** owner decision — warn, allow. "These times run outside the event, which
ran 7:00 PM to 9:00 PM. The member is credited for every minute you confirm."
Both callers already pass the event's actual-or-scheduled span.
`AttendancePetitionDecisionDialogs.test.tsx` (new). Re-driven.

### W80-4 — MED — A training officer approved their own training credit — ✅ FIXED

**Did:** as `training_officer`, checked themselves into their session, ended and
finalized it, opened the approval link.
**Saw:** their own row on the roster, editable; "Approve and record" recorded
their credit. With W80-2, the minutes were whatever they typed.
**Expected (owner decision):** an instructor may attend and be credited, but
another training officer or the Chief approves.
**Where:** `TrainingSessionService.submit_training_approval`;
`TrainingApprovalPage.tsx`.
**Fix:** the service refuses an approver who is on the roster, whole rather than
per entry (one approval completes every record, and a held-back entry would be
stranded). The page says so up front and disables Approve.
`test_training_approval_submit.py::test_an_approver_on_the_roster_cannot_approve_it`
(failed against the old service) and a page test. Re-driven: the page notice, a
direct POST refused 400, and `chief` approving the same link.

### W80-5 — MED — Excusing one missed drill cut the member's annual hours target — ✅ FIXED

**Did:** Members → Waivers → Create, Personal, Training only, 7 Nov–7 Nov.
**Saw:** the form had no way to say which requirement; the waiver covered every
training requirement, and under the department's default `leave_month_rule`
("full month") one excused day waived November, so "Annual Fire Training Hours"
dropped from 24 to 22.
**Where:** `frontend/src/pages/WaiverManagementPage.tsx` (the API already took
`requirement_ids` and validates them in-org with `assert_all_in_org`).
**Fix:** owner decision — a requirement picker. A training-only waiver lists the
active requirements; none ticked keeps today's behaviour (every requirement),
ticked ones are sent as `requirement_ids`. A leave of absence still waives
everything, so the picker is offered only without one.
`WaiverManagementPage.test.tsx`. Re-driven: scoped to drill attendance, the
hours target stayed 24.

### W80-6 — LOW — The wizard accepted an end before the start until the last click — ✅ FIXED

**Did:** step 1 with 7:00 PM start, 6:00 PM end; Next through to Create.
**Saw:** every step accepted it and the review showed "7:00 PM … End 6:00 PM";
only the server's 400 stopped it, three steps later.
**Where:** `frontend/src/pages/CreateTrainingSessionPage.tsx`.
**Fix:** checked on leaving step 1 and on submit ("End time must be after the
start time"). Four existing tests typed a date with no time for both ends — a
schedule the server refuses — and now end on the next day.
`CreateTrainingSessionPage.test.tsx`. Re-driven.

### W80-7 — LOW — A stray "0" after checking out within a minute — ✅ FIXED

**Did:** as `member` at 390×844, check in, re-scan, check out a minute later.
**Saw:** a bare "0" between "Checked Out At" and the training-record note — the
duration tested for truthiness, and React prints a falsy number.
**Where:** `frontend/src/pages/EventSelfCheckInPage.tsx:322`.
**Fix:** `!= null`; the screen reads "Duration: 0h 0m". `EventSelfCheckInPage.test.tsx`.
Re-driven.

### W80-8 — MED — No way to put one named member on a past drill — FLAGGED

**Did:** as `training_officer` (the event's organizer), Check In on three members
the morning after the drill.
**Saw:** each refused with a toast: "Check-in has closed for this event. Ask an
event organizer to record a late check-in." — said to the organizer. The only
ways on are "Add All Eligible as Going" (the whole roster, 19 RSVPs on a
mandatory drill) and then Edit Times per member, or each member's own "I was
there". `POST /events/{id}/add-attendee` exists but no screen calls it.
**Where:** `EventService` check-in window (`event_service.py`, the "Check-in has
closed" message); `EventDetailPage` check-in dialog.
**Options:** let an attendance manager record a check-in after the window, with
times (the Edit Times dialog, opened for a member who has no RSVP); or wire
`add-attendee` into the dialog. Either changes who may write attendance after
the fact, so it is the owner's call. Mirrored in `docs/KNOWN_LIMITATIONS.md`.

### W80-9 — LOW — A session-attendance requirement with no held sessions reads "Complete" — FLAGGED

**Saw:** a member created today read "Monthly Drill Attendance 0/0 sessions —
Complete", and the compliance matrix counted it met for every such member. The
drill was held before their join date (account creation, absent a hire date),
which correctly excludes it; the display is what CLAUDE.md pitfall #29's
corollary warns of — an empty denominator reported as success.
**Why flagged:** reporting "not applicable" changes compliance percentages on
every screen that counts the requirement, a department-wide number change.

### W80-10 — LOW — An excused drill stays under "missed mandatory" — FLAGGED

**Saw:** after the one-day training waiver, the no-show's `GET
/events/missed-mandatory` still listed the drill. That list excludes leaves of
absence only, so a member excused by a training waiver keeps a "missed" item
they cannot clear by responding.
**Why flagged:** whether a training waiver should excuse event attendance as
well as requirement grading is a policy question.

### W80-11 — MED — There is no Postpone — ✅ FIXED (follow-up pull request)

**Saw:** the only way to move a drill is Edit, which (before W80-1) kept the
check-ins, records nothing about the move, and notifies "has been updated (end
datetime, start datetime). Please review the latest details." — without the new
time, and without saying it was postponed.
**Owner decision:** a real Postpone action, stored in new columns.
**Where:** `EventService.postpone_event`, `POST /events/{id}/postpone`,
migration `09f0171ccf5e`, `EventPostponeModal.tsx`, `EventDetailPage.tsx`.
**Fix:**

- Migration `09f0171ccf5e` adds `events.postponed_at`, `postponed_from_start`
  and `postponement_reason`, nullable, no backfill, each added only when absent;
  the downgrade drops them.
- `POST /events/{id}/postpone` `{ new_start_datetime, new_end_datetime, reason,
send_notifications }`, with the same authorization as Edit (events.manage, or
  training.manage on a Training event). In one transaction it clears every
  member check-in, check-out, duration and Edit Times correction and every guest
  check-in, removes the admin hours and training credit they produced (as
  Cancel does), keeps the RSVPs, moves the times, clears the `reminders_sent`
  and `validation_notification_sent` markers so reminders go out for the new
  time, and stamps the three columns. `postponed_from_start` is written once, so
  a second move keeps the original date. Then it notifies Going/Maybe in-app
  ("postponed from … to … Reason: …") and by email (the change email, now
  saying "postponed" and the original time).
- Refused for a cancelled or finalized event, a new start in the past, the time
  the event already has, a room already booked at the new time, and while
  "I was there" requests are pending (they concern the old time).
- Sent twice with the same times, it changes nothing and notifies no one the
  second time (pitfall #36).
- The event page offers Postpone Event under More, with a dialog naming how
  many members are checked in; a postponed event carries a "Postponed" badge
  and "Postponed from <date> — <reason>" under its date. The W80-1 edit refusal
  now points to Postpone. The events list does not yet mark a postponed event.
- Tests: `test_event_postpone.py` (11, against the database; three mutations of
  the service each caught), `test_event_postponement_migration.py` (rows
  present, twice, downgrade, missing table), the route's lock mapping in
  `test_attendance_lock_reaches_client.py`, `EventPostponeModal.test.tsx` and an
  `EventDetailPage` case. Re-driven: a live drill with two check-ins postponed a
  week through the dialog; RSVPs kept, check-ins cleared, the member's notice
  and phone view correct; a repeated POST changed nothing.

### W80-16 — LOW — Editing an event's time does not reset its reminders — OPEN

Seen while building W80-11. `reminders_sent` in `custom_fields` records which
reminder intervals went out, and an edit of the schedule keeps it
(`_with_own_lifecycle_markers`). A drill moved later through Edit therefore
never re-sends a reminder that already went out for its old time. Postpone
clears the markers; Edit, for a correction that keeps the check-ins, does not.
Whether a schedule edit should reset them is a judgement about small
corrections versus real moves.

### W80-12 — NIT — The review step omits "Counts toward attendance" — OPEN

The wizard's review lists the requirement link but not the attendance
requirements ticked on step 2, which were saved (checked through the API).

### W80-13 — NIT — "Credit Hours" says it is what attendees are credited — OPEN

The hint reads "The training hours each attendee is credited with", but credit
follows measured attendance (`EventService.credited_minutes`); a member who left
after a minute was credited nothing. The field is the session's planned length.

### W80-14 — LOW — An officer's check-in starts no in-progress record — OPEN

With "Start an in-progress training record when members check in" on, `member`'s
self check-in created one; `training_officer` checking Blair in did not. Finalize
writes the record either way, so only the in-between view differs.

### W80-15 — NIT — Credit voided by Delete carries no reason — OPEN

The three records left by deleting the drill read "cancelled", 0 h, with
`void_reason` empty, so a member sees a cancelled course with no explanation.

## After the fixes

Re-driven on a new drill ("W-TE Redrive Drill", instructor confirmation on,
`training_officer` and Blair checked in, `member` checking in and out at
390×844): the week-out move refused (W80-1); "Duration: 0h 0m" (W80-7); the
wizard held at step 1 (W80-6); a waiver scoped to drill attendance left the hours
target at 24 (W80-5); the officer's approval page showed the roster notice with
Approve disabled, a bypassing POST was refused 400, and `chief` saw Blair named
as over the 120-minute session before correcting it and approving (W80-2, W80-4);
a 6:00–11:45 PM attendance request showed the outside-the-event warning (W80-3).

## Checklist

| Section                 | Result                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------- |
| 1. The job gets done    | Yes, after W80-6; past-drill attendance is awkward (W80-8)                             |
| 2. The right people     | Chief-only override held; self-approval closed (W80-4)                                 |
| 3. Wrong input, failure | Bad schedule, over-credit and stranded check-ins now caught (W80-1, -2, -3, -6)        |
| 4. Browser signals      | Only the expected 400s from refusals; none unexplained                                 |
| 5. Coming back to it    | Reopen, re-finalize, delete and cancel kept records consistent                         |
| 6. On a phone           | Member check-in/out, My Training and attendance request at 390×844; W80-7 fixed        |
| 7. Everyone can use it  | New warnings are `role=status` and described by `aria-describedby`; picker is labelled |
| 8. What happens around  | Notifications sent on a move; W80-10, W80-11 flagged                                   |

## Completion gate

| Check                    | Result                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                           |
| npm run lint             | clean, 0 errors / 0 warnings (needs `--max-old-space-size=8192`; aborted out of memory at the default, the W77 lead)                            |
| flake8 (changed files)   | clean                                                                                                                                           |
| black --check / isort    | clean                                                                                                                                           |
| frontend tests (touched) | 9 files, 220 passed — the touched suites plus `AttendanceRequestsPage` and `EventDetailPage`                                                    |
| backend tests (touched)  | 356 passed — every suite calling `update_event`, both approval suites, the new reschedule suite; each new test was seen to fail without its fix |
