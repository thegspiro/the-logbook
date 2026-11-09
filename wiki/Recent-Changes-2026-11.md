# Recent changes: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's page, and a new month starts a
new page. The engineering audit behind each pass is in
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md).

## Recent changes: November 8 – 9, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-8--9-2026).

- **My Shifts**: Past shifts are grouped by year and month, with a Year
  dropdown and an hours-by-month chart.
- **End-of-shift summary** lists each call type once with a count.
- **Training programs**: the creation wizard keeps a browser draft; milestones
  can wait on courses and tests and notify chosen people; requirements show what
  uses them and can be permanently deleted.
- **Phones and narrow screens**: about twenty tables reflow to cards, and page
  header buttons share each row.
- **Meetings**: members see only approved, non-executive meetings.
- **Accounts**: you cannot make yourself a member's supervisor, and changing
  another member's email needs the same approval as a credential reset.
- **Fixes**: a training waiver takes an excused drill off "missed", moving an
  event's start lets its reminders go again, and platform analytics count whole
  local days.
- **Operators**: `/inventory/ws` accepts only the sign-in cookie, not a token in
  the URL.

## Recent changes: November 6 – 8, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-6--8-2026).

- **My Training**: a Courses requirement lists the courses it needs, ticked as
  you finish them, and counts in courses rather than hours. Certification
  requirements no longer show "hrs".
- **Training History** lists each record in two or three compact lines instead
  of a wide table.
- **Provider imports**: a completion the provider reports as 0 hours (a policy
  acknowledgment, for example) now takes the mapped course's Credit Hours.
- **Finance**: partial reversal of budget amendments, a pending-amendments
  queue, My Dues, mileage trip logs, shared receipts, board reports and an
  optional live QuickBooks Online connection. See
  [Module Finance](Module-Finance).
- **Integrations**: connecting, changing or disconnecting an integration now
  records the IP address in the audit log.

## Recent changes: November 5 – 6, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-5--6-2026).

- **Minutes** let each department choose whether late and left-early members
  count toward quorum and whether to use proxies; published minutes list their
  attachments and the PDF embeds them.
- **Elections**: rolling back a closed election files a dated correction rather
  than editing the minutes.
- **Fundraising**: donations can be edited; grant budget lines and expenditures
  can be edited and deleted; tasks can be assigned when created.
- **Training History** totals and list follow the selected period, with a new
  Last 12 Months choice.
- **Admin hours**: scanning another category's code names the session you are
  clocked in to and offers to clock out of it.
- **Sign-in** waits are counted per account, so a shared station computer no
  longer holds the next member.
- **Profiles** save with a blank name left unchanged and flagged.
- **Prospective members**: interviewers see sensitive answers on the Interview
  page only.

## Recent changes: November 4 – 5, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-4--5-2026).

- **Scheduling** can require approval before a member from another department
  takes a shift, and open swaps now reach members through the bell.
- **Session Attendance** is a new training requirement: attend a share of
  sessions rather than log hours.
- **Compliance Settings** moved to Training Admin → Settings & Data.
- **Historical Data Import** now brings in training records, and the member
  profile shows imported shift and call history.
- **Membership tiers** apply by membership status, every member shows a tier
  name, and **My Crew** lists the members you supervise.
- **Medical screening** grace periods now count, and a record only counts
  toward the requirement it is linked to.
- **Dashboard** sections say plainly when there is nothing to show.

## Recent changes: November 5, 2026 (later merges)

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-5-2026-later-merges).

- **Drill attendance can be a requirement.** A Session Attendance requirement
  (for example 60% of company drills this year) counts the drills a member
  attended. Drills are marked when created, and a badge tells members which count.
  The Chief can override it for a member, with a reason on record.
- **Evaluations can be graded by section**, with grade ranges, so "Meets
  expectations" across the board no longer reads as failing.
- **Historical import** brings in training records and turns company drill dates
  into held drills.
- **Medical screening grace periods now work**, and clinical details need their
  own permission. Check who holds it.
- **Members:** a My Crew page for supervisors and Shift & Call History on profiles.
- **Scheduling:** officers can seat anyone in a custom seat (with a reason), outside
  shifts can require approval, and open swaps post a bell entry.
- **Inventory:** category names are unique within a parent, and adding an item now
  counts as seeing it.
- **Fundraising:** donors and campaigns can be edited.
- **Dashboard and phones:** clearer shift times, All clear fold, wide tables turn
  into cards when narrow, and switches are round-ended pills.
- Operators: DigitalOcean and Google Cloud deployment guides.

## Recent changes: November 3 – 4, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-3--4-2026).

- **Historical Data Import** brings hours from your old system (shifts, on-call,
  training, administrative) into The Logbook, reviewed in monthly batches.
- **Interviewers are emailed** when an applicant reaches an interview stage, and
  **My applicants** now narrows the counts and archive tabs as well.
- **Evaluations** is one menu entry, with a setup checklist, a preview and two
  starter templates for a first-time chief.
- **Setup** asks about Public Information and says when the session has ended.
- **Shift Patterns** shows paused patterns so they can be resumed.
- **Members roster** switches to cards below 1024px.
- Operators: `REDIS_REQUIRED=true` now refuses to start without Redis.

## Recent changes: November 2 – 3, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-2--3-2026).

- **A History module** keeps the department's archive: past members, an Honor
  Roll of line-of-duty deaths, historical titles, and a review before a record
  goes public. Turn it on under Settings → Modules.
- **Leave and training:** leave now shows beside training hours, and a new
  **Months on leave** rule decides how a partly covered month counts. Every
  department starts on Full month, so some members' standing changes on
  upgrade (`docs/UPGRADING.md`).
- **Shifts on outside agencies' units** can be evaluated, once switched on for
  that agency.
- **Adopting minutes** now approves their meeting; meetings with adopted minutes
  are approved on upgrade.
- **Label printing** lets you set the printer's resolution for each label size.
- **Offline work** (equipment checks, skills scoring) can send by itself in
  Chrome and Edge, even with the app closed.
- Screenshots to create are in `docs/training/SCREENSHOT_CURRENCY.md`.

## Recent changes: November 1 – 2, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-1--2-2026).

- **Member performance evaluations** are described in their own entry below.
- **Top navigation** now has Medical Screening and My ID Card like the side menu.
- **Fixes:** Reports and Medical Supplies no longer show the error screen on a
  malformed response.

## Recent changes: Zeffy integration, November 2, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-zeffy-integration-november-2-2026).

- **Zeffy.** A department that raises money through Zeffy can connect it under
  **Integrations**. Under **Grants & Fundraising → Zeffy**, link each Zeffy
  campaign to a fundraising campaign, a fundraising event or a dues schedule,
  and its donations, ticket sales and memberships are recorded there as they
  arrive, refunds included. Linking applies payments from now on unless you
  choose an earlier date, so gifts already typed in are not counted twice.
  Guides 11, 12 and 16 cover it.

## Recent changes: member performance evaluations, November 1–2, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-member-performance-evaluations-november-12-2026).
The full guide is [Performance Evaluations](Module-Evaluations).

- **Member evaluations are here.** Build a form for each kind of member,
  open a review period, and draft evaluations one at a time or for the whole
  period at once.
- **Figures fill themselves in.** Training, meetings, shifts, calls,
  certifications and more are measured over the member's own time in the
  period, with leave and gaps left out.
- **Steps and signatures.** Self-evaluation, evaluator, optional calibration
  and approvals, then the member acknowledges or refuses with a reason. Signing
  needs your typed name and a quick identity check.
- **A PDF with your logo,** made once when the evaluation is final and kept as
  signed.
- **Emails** when a step is waiting on someone, before it is due, once it is
  overdue, and when it is final; all editable under Email Templates.
- **After it is final:** the member can attach a written response; a manager
  can amend it with a reason; the Chief can delete one with a reason the
  member can read.
- **Permissions:** the Chief gets all five evaluation permissions; give them
  to other positions in Role Management.

## Recent changes: October 31 – November 1, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-october-31--november-1-2026).

- **Case managers and interviewers.** Assign members to an applicant; they reach
  it from **My Applicants**. Seeing every applicant now needs
  `prospective_members.view_all` (existing positions kept it).
- **Shift evaluations.** Build your own evaluation forms in Training Admin, link
  them to programs, and fill one out per member after a shift.
- **Shifts.** Swap times show correctly in any time zone; the board no longer
  offers seats on your approved time off; a deleted generated shift stays deleted.
- **Member profile** badges leaves Upcoming, Active or Ended.
- **Onboarding:** the backup recovery email must differ from the administrator's.
