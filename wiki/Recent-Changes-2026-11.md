# Recent changes: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's page, and a new month starts a
new page. The engineering audit behind each pass is in
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md).

## Recent changes: November 15 – 17, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-15--17-2026).

- **Training events**: Create Event with type Training, and Training Admin's
  **Create Session**, now open the same step-by-step form. Course, credit
  hours, requirements, **Counts toward attendance** and sign-off are on its
  **Training Info** step. Change them later with **Edit training details** on
  the event's **Training details** card.
- **Course Links** (Training Admin → Curriculum): records imported or entered
  without a course can be linked to a library course by name, one spelling at
  a time or with **Link all suggested**. Records from either CSV importer now
  say **Imported**.
- **Evaluated Calls**: a new requirement type, counted from submitted shift
  evaluations. A shift's required evaluations are now fixed when it ends, and
  credit is worked out again when a requirement's type or a member's seat
  changes. An evaluation form in use cannot be deactivated.
- **Waiver Requests** appears in the Training navigation (and under
  Governance for meetings) for whoever decides them, with a count waiting.
  A member is emailed when a cancelled session closes their request.
- **Elections**: each election has a header card with its stage, turnout and
  winner, and its sections (Ballot, Candidates, Eligibility, Results,
  **Integrity & Audit**, …) are links with their own addresses; old links
  still work. **Close Election** and the other stage buttons sit beside the
  status badge. On a phone, officers get a meeting-night dashboard with the
  vote count and one big button.
- **PDFs**: every page after the first carries a running header with the
  department's logo, name and document title. The Reports page's **CSV** and
  **PDF** (was **Print / PDF**) are built by the server and recorded in the
  audit log.
- **Needs You**: an unanswered mandatory event is listed only within two
  months of it, or when its RSVP deadline is under two days away.
- **Security**: changing your own sign-in email, or adding an authenticator
  app when you already have a passkey, asks you to confirm who you are.
  Draft events cannot be checked into. A shift-report reviewer cannot review
  their own report, and the Chief cannot override their own requirement.
- **Finance, grants and the store**: a save that is refused now says why on
  the field or inside the dialog, and keeps what you typed. A fiscal year's
  end date cannot be before its start. Size preferences save the rest when
  one size is refused.
- **Apparatus**: only current members can be added as operators.
- **Phones**: the status bar matches the app's theme instead of always
  being red.

**For whoever takes screenshots:** most of the Elections guide's images show
the old tab bar and need re-shooting; the list is in
[`docs/training/SCREENSHOT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/training/SCREENSHOT_CURRENCY.md).
YouTube scripts 04, 05, 12 and 16 have beats marked for re-recording.

## Recent changes: November 14 – 15, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-14--15-2026).

- **Leave of absence**: members can ask for leave from **Leave Requests**
  (off until the department turns it on), and approvers decide by a rule the
  department picks. Members are emailed before their leave ends and when an
  officer records, changes or removes it; officers get a monthly list of
  open-ended leaves. The Annual Training and Program Requirement reports show
  leave. Settings are under **Members → Administration → Settings → Leave of
  Absence**.
- **My Training**: shift and call requirements have **Show monthly shifts**
  (or calls), with leave months labelled. A target that leave brings to zero
  reads **Nothing owed (on leave)**. Members see their own leave dates and the
  department's leave rule.
- **Training requirements**: **Member Categories** lists your department's
  own tiers, such as Senior. Check any requirement scoped by category.
  Evaluated-shift, transport and refusal requirements linked into a program
  are now credited from shift evaluations.
- **Evaluations**: three more figures for a template (events by type,
  certifications expiring soon, field shift evaluation averages); sources
  from a module that is off read **(turned off)**; the builder warns about
  gaps between score bands.
- **Shift close-out**: a trainee marked No-show or still Pending no longer
  needs a report or an evaluation. The shift report keeps everything typed
  when you step out to an evaluation.
- **Department Store**: an order shows how it is delivered, the address and
  the member's notes, and its subtotal, tax, shipping and discount. Cancel
  from the new **Cancel order** section (it emails the member and does not
  refund). An order moves back only among Ordered, Ready for pickup and
  Fulfilled.
- **Email Templates**: the election and minutes emails can be reworded,
  previewed and switched off, in **Elections & Voting** and a new **Meetings
  & Minutes** group.
- **Elections**: the **Candidates** tab shows a count; minutes say **Votes
  cast**.
- **History**: a **Documents** section for letters, minutes and clippings.
  See the new [History](Module-History) page.
- **Known problem**: `main` currently has three database migration heads, so
  a fresh install or upgrade from it will not start until PR #4323 merges.

## Recent changes: November 14, 2026 (PayPal)

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-paypal-settings-november-14-2026).

- **PayPal**: a connected PayPal card has a **Settings** button. Change the
  environment, credentials, Webhook ID or automatic settlement without
  disconnecting; blank credential boxes keep the saved ones.
- **Sandbox and live**: switching PayPal between them now needs that
  environment's Client ID and Client Secret in the same save. Before, the old
  pair was kept and every payment would have been rejected.
- **Store PayPal button**: under **Store → Settings → Payments**, choose
  whether members pay into **the connected PayPal account** (its PayPal.Me link
  and email, entered on the PayPal integration) or an account entered on the
  store. If the connected account cannot supply a link, the store's own is
  used. See [PayPal Integration](Integration-PayPal).

## Recent changes: November 13, 2026 (Zeffy)

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-zeffy-settings-and-screenshots-november-13-2026).

- **Zeffy**: a connected Zeffy card has a **Settings** button. Change the API
  key or the webhook signing secret there without disconnecting; a box left
  blank keeps what is saved. See [Zeffy Integration](Integration-Zeffy).
- **Zeffy and PayPal connect windows** no longer say a key is already stored
  on a first connection.
- **Training guides**: the Zeffy screens are pictured in the Grants &
  Fundraising and Integrations guides.

## Recent changes: November 10 – 11, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-10--11-2026).

- **Members Administration**: archived and dropped members move to a new
  **Former Members** page. Each row says things once: no repeated Member,
  status or class chips, no separate Status column, and Reset Password,
  Unlock, Reset MFA and Delete live in a **More actions** (⋯) menu.
- **Events**: **More → Postpone Event** moves an event to a new time with a
  reason. RSVPs stay; check-ins and credit for the old time are cleared;
  members who said Going or Maybe are told; the list shows a **Postponed**
  badge.
- **Evaluations**: the training-session attendance figure follows the
  member's session-attendance requirement, so its percentage may change, and
  it reads "unavailable" when no requirement applies.
- **Training**: the groundwork for members asking to be excused from a
  session is in place. It has no screen yet and is off until a policy is
  saved.
- **Shift history import**: an overlapping row's times can be fixed in the
  table with **Save times**.
- **Training events** keep their training details through Duplicate and
  rolling series; **Community Engagement** reports what outreach reached.
- **Documents**: generated PDFs embed Noto Sans; certified results,
  evaluations and minutes are PDF/A-2b.
- **Sign-in**: a member who must change their password goes straight to My
  Account.

## Recent changes: November 8 – 10, 2026

The engineering audit is
[`docs/CHANGE_AUDIT_2026-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-11.md#change-audit-november-8--10-2026).

The November 8 – 9 notes below overlap this pass; where both mention a change, it is the same one.

- **My Shifts**: Upcoming sits under month headers; Past is grouped by year and
  month with a Year dropdown and an hours chart.
- **End-of-shift summary** lists call types as counts.
- **Events**: an officer can record one member, with times, after check-in
  closes. Moving an event's start lets its reminders go out again, and a drill
  excused by a training waiver no longer reads as missed.
- **Training**: a session-attendance requirement with no session held is not
  graded; each record shows whether it came from a provider, the import or The
  Logbook.
- **Members**: the roster is a table again on desktop, and a placeholder email
  no longer breaks the member list.
- **Historical import**: members to be created show their real names.
- **Printing**: PDFs keep ink inside the printable area and leave a binding
  margin; Avery 5160 labels line up.

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
