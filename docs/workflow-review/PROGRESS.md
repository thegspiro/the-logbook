# Workflow Review — Progress Tracker

Each run takes the **first ⬜ activity**, drives it in a browser as the roles in
its row, records findings in `docs/workflow-review/W<nn>-<slug>.md`, fixes what
is safe, flags the rest, and passes the completion gate before marking it ✅.
See [`README.md`](./README.md) for the harness and [`CHECKLIST.md`](./CHECKLIST.md)
for what every run checks.

**Legend:** ⬜ pending · 🔄 in progress · ✅ done · ⛔ blocked (the reason is in
the log)

The order is risk: what locks people out or loses their data first, then the
daily work of each module in the order a department adopts them. Activities
build on each other's data, so run them in order unless a row says otherwise.

---

## Tier 1 — Getting in, and the first hour

| #   | Activity                                                                   | Acts as           | Starts at                             | Status |
| --- | -------------------------------------------------------------------------- | ----------------- | ------------------------------------- | ------ |
| W01 | Fresh-install onboarding, every step, including going Back and resuming    | anonymous → admin | `/`, `/onboarding/*`                  | ✅     |
| W02 | Sign in, sign out, session timeout, a wrong password, lockout messaging    | member            | `/login`                              | ✅     |
| W03 | Forgot password and reset by link                                          | anonymous         | `/forgot-password`, `/reset-password` | ✅     |
| W04 | My account: profile, password change, MFA enrolment, notification settings | member            | `/account`                            | ✅     |
| W05 | Positions and permissions: create a position, grant, assign, revoke        | admin → member    | `/settings/roles`                     | ✅     |
| W06 | Organization settings, module switches, department setup checklist         | admin             | `/settings`, `/setup`                 | ✅     |
| W07 | Dashboard for each role: what shows, what links work, what fails behind it | every role        | `/dashboard`                          | ✅     |

## Tier 2 — Members

| #   | Activity                                                                  | Acts as                | Starts at                                    | Status |
| --- | ------------------------------------------------------------------------- | ---------------------- | -------------------------------------------- | ------ |
| W08 | Add a member, with and without a password, and their first sign-in        | admin → new member     | `/members/add`                               | ✅     |
| W09 | Import members from a spreadsheet                                         | admin                  | `/members/import`                            | ✅     |
| W10 | Find a member and read their profile, as a member (contact visibility)    | member, admin          | `/members`, `/members/:userId`               | ✅     |
| W11 | Edit a member as an officer: details, clearing a field, status, history   | admin                  | `/members/admin/edit/:userId`                | ✅     |
| W12 | Member settings: ranks, membership tiers, ID numbering, EVOC, visibility  | admin                  | `/members/admin/settings/*`                  | ✅     |
| W13 | Waivers                                                                   | admin                  | `/members/admin/waivers`                     | ✅     |
| W14 | Check-in station, badge scan, member labels and ID cards                  | admin                  | `/members/check-in-station`, `/members/scan` | ✅     |
| W15 | A member leaves: departure clearance, property return, archive, reinstate | admin                  | `/members/admin`                             | ✅     |
| W16 | Prospective member from application to converted member                   | membership_coordinator | `/prospective-members`                       | ✅     |
| W17 | An applicant checks their status by link                                  | anonymous              | `/application-status/:token`                 | ✅     |

## Tier 3 — Events

| #   | Activity                                                                  | Acts as               | Starts at                                       | Status |
| --- | ------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------ |
| W18 | Create, edit and cancel an event, including a recurring one               | secretary             | `/events`, `/events/:id/edit`                   | ✅     |
| W19 | RSVP, change it, and see it on the event                                  | member, member2       | `/events/:id`                                   | ✅     |
| W20 | Check-in: QR self check-in, live monitoring, an officer's manual check-in | member, secretary     | `/events/:id/qr-code`, `/events/:id/monitoring` | ✅     |
| W21 | Event templates, the events admin hub, and event analytics                | secretary             | `/events/admin`, `/events/templates`            | ✅     |
| W22 | A public event request and its status link                                | anonymous → secretary | `/event-request/status/:token`                  | ✅     |
| W23 | Locations, the kiosk display and guest check-in                           | admin, anonymous      | `/locations`, `/display/:code`                  | ✅     |

## Tier 4 — Training

| #   | Activity                                                              | Acts as                   | Starts at                                          | Status |
| --- | --------------------------------------------------------------------- | ------------------------- | -------------------------------------------------- | ------ |
| W24 | Submit a training record, and the officer approves or returns it      | member → training_officer | `/training/submit`, `/training/submissions`        | ✅     |
| W25 | Courses and requirements                                              | training_officer          | `/training/courses`, `/training/requirements`      | ✅     |
| W26 | A training program: build it, enroll a member, the member's progress  | training_officer → member | `/training/programs`                               | ✅     |
| W27 | A course cohort: schedule classes, roster, attendance                 | training_officer          | `/training/cohorts`                                | ✅     |
| W28 | Skills testing: build a sheet, run a test, the member sees the result | training_officer → member | `/training/skills-testing`                         | ✅     |
| W29 | Compliance: configure requirements, read the matrix, print it         | training_officer          | `/training/compliance-config`, `/training/officer` | ✅     |
| W30 | Log a shift and file a shift report                                   | member                    | `/training/log-shift`                              | ⬜     |
| W31 | The learning center orientation                                       | member                    | `/learning`                                        | ⬜     |

## Tier 5 — Scheduling

| #   | Activity                                                           | Acts as                     | Starts at                                                   | Status |
| --- | ------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------- | ------ |
| W32 | Shift templates and patterns, then generate a month of shifts      | scheduling_officer          | `/scheduling/admin/planning/*`                              | ⬜     |
| W33 | Sign up for a shift, swap it, request time off                     | member, member2 → officer   | `/scheduling`                                               | ⬜     |
| W34 | Check in to a shift by apparatus QR, and close the shift out       | member → scheduling_officer | `/scheduling/checkin`, `/scheduling/admin/closeout`         | ⬜     |
| W35 | Platoons and the position qualification roster                     | scheduling_officer          | `/scheduling/admin/platoons`, `/scheduling/admin/positions` | ⬜     |
| W36 | Every scheduling settings section                                  | scheduling_officer          | `/scheduling/admin/settings/*`                              | ⬜     |
| W37 | Scheduling reports and the printed check-in sheet and shift report | scheduling_officer          | `/scheduling/admin/reports`                                 | ⬜     |

## Tier 6 — Inventory and equipment

| #   | Activity                                                                     | Acts as                | Starts at                                                  | Status |
| --- | ---------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- | ------ |
| W38 | Set up inventory: categories, then add items of each tracking kind           | quartermaster          | `/inventory/admin/setup`, `/inventory/admin/items`         | ⬜     |
| W39 | Issue equipment to a member, the member sees it, return it                   | quartermaster → member | `/inventory/admin/members`, `/inventory/my-equipment`      | ⬜     |
| W40 | Pool items, checkouts, kits and variant groups                               | quartermaster          | `/inventory/admin/pool`, `/inventory/checkouts`            | ⬜     |
| W41 | A member's request, return, write-off and reorder, and the approvals         | member → quartermaster | `/inventory/admin/requests`, `/inventory/admin/returns`    | ⬜     |
| W42 | Maintenance records, vendors, charges and issuance allowances                | quartermaster          | `/inventory/admin/maintenance`, `/inventory/admin/charges` | ⬜     |
| W43 | Storage areas, barcode labels and CSV import                                 | quartermaster          | `/inventory/storage-areas`, `/inventory/import`            | ⬜     |
| W44 | NFC: tag in bulk, put away, shelf audit, items not seen                      | quartermaster          | `/inventory/admin/nfc/*`, `/inventory/shelf-audit`         | ⬜     |
| W45 | The self-service kiosk                                                       | member                 | `/inventory/kiosk`                                         | ⬜     |
| W46 | Equipment checks: build a checklist, perform a check, fleet board, check log | quartermaster → member | `/inventory/admin/checklists`, `/inventory/checklists`     | ⬜     |
| W47 | Medical supplies                                                             | quartermaster          | `/medical-supplies`                                        | ⬜     |

## Tier 7 — Apparatus and facilities

| #   | Activity                                                          | Acts as | Starts at                                | Status |
| --- | ----------------------------------------------------------------- | ------- | ---------------------------------------- | ------ |
| W48 | Add an apparatus, edit it, read its detail, print its labels      | admin   | `/apparatus`, `/apparatus/new`           | ⬜     |
| W49 | Facilities: a facility, its maintenance, inspections and settings | admin   | `/facilities`, `/facilities/maintenance` | ⬜     |

## Tier 8 — Governance and communication

| #   | Activity                                                              | Acts as            | Starts at                                          | Status |
| --- | --------------------------------------------------------------------- | ------------------ | -------------------------------------------------- | ------ |
| W50 | An election: create, nominate, vote by ballot link, close, results    | secretary → member | `/elections`, `/ballot`                            | ⬜     |
| W51 | Meeting minutes: draft, approve, publish                              | secretary          | `/minutes`                                         | ⬜     |
| W52 | Action items: assign, work, close                                     | secretary → member | `/action-items`                                    | ⬜     |
| W53 | Documents: folders, upload, who can see what                          | secretary, member  | `/documents`                                       | ⬜     |
| W54 | Org chart and legal documents                                         | admin, member      | `/governance/org-chart`, `/governance/legal`       | ⬜     |
| W55 | Messages: send to a group, the member's inbox, message administration | admin → member     | `/communications/messages`, `/messages`            | ⬜     |
| W56 | Notification rules and logs, the in-app bell                          | admin, member      | `/notifications`                                   | ⬜     |
| W57 | Email templates: edit, preview, restore                               | admin              | `/communications/email-templates`                  | ⬜     |
| W58 | Suggestion boxes and suggestions                                      | member → admin     | `/suggestions`, `/communications/suggestion-boxes` | ⬜     |
| W59 | Photo-use consent                                                     | member, admin      | `/communications/photo-use-consent`                | ⬜     |
| W60 | Forms: build, publish a public form, submit it, read submissions      | admin → anonymous  | `/forms`, `/f/:slug`                               | ⬜     |

## Tier 9 — Money

| #   | Activity                                                               | Acts as                   | Starts at                                                        | Status |
| --- | ---------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- | ------ |
| W61 | Budgets                                                                | treasurer                 | `/finance/budgets`                                               | ⬜     |
| W62 | Approval chains and finance settings, including the emailed approval   | treasurer                 | `/finance/settings/approval-chains`, `/finance/approvals/:token` | ⬜     |
| W63 | A purchase request through its approval chain                          | member → treasurer, chief | `/finance/purchase-requests/new`                                 | ⬜     |
| W64 | An expense report, from receipt to reimbursement                       | member → treasurer        | `/finance/expenses/new`                                          | ⬜     |
| W65 | Check requests                                                         | treasurer                 | `/finance/check-requests`                                        | ⬜     |
| W66 | Dues: set them, record a payment, who is behind                        | treasurer                 | `/finance/dues`                                                  | ⬜     |
| W67 | The department store: shop, check out, my orders, store administration | member → quartermaster    | `/store`, `/inventory/admin/store`                               | ⬜     |
| W68 | Grants: an opportunity, then an application through to its report      | treasurer                 | `/grants/opportunities`, `/grants/applications`                  | ⬜     |
| W69 | Fundraising: campaigns, donors, donations, reports                     | treasurer                 | `/grants/campaigns`, `/grants/donations`                         | ⬜     |

## Tier 10 — Everything else

| #   | Activity                                                                  | Acts as          | Starts at                                  | Status |
| --- | ------------------------------------------------------------------------- | ---------------- | ------------------------------------------ | ------ |
| W70 | Administrative hours: clock in and out by QR, manage categories and hours | member → admin   | `/admin-hours`, `/admin-hours/manage`      | ⬜     |
| W71 | Medical screening                                                         | admin            | `/medical-screening`                       | ⬜     |
| W72 | Reports                                                                   | admin, chief     | `/reports`                                 | ⬜     |
| W73 | Integrations                                                              | admin            | `/integrations`                            | ⬜     |
| W74 | IP security, and a member's access request                                | member → admin   | `/ip-security/my-requests`, `/ip-security` | ⬜     |
| W75 | Audit log, error monitoring and analytics                                 | admin            | `/admin/audit-log`, `/admin/errors`        | ⬜     |
| W76 | Public portal and the public pages                                        | admin, anonymous | `/admin/public-portal`, `/`, `/privacy`    | ⬜     |
| W77 | The testing module and its printed report                                 | admin            | `/testing`                                 | ⬜     |
| W78 | Platform administration                                                   | admin            | `/admin/platform-analytics`                | ⬜     |
| W79 | Phone pass: W08, W19, W24, W33, W39 and W70 again at 390×844              | member, officers | as those rows                              | ⬜     |

---

## Leads from earlier browser passes

Seen while building this harness or in the ad-hoc browser pass of 2026-09-27,
and not yet confirmed or fixed. The run for each activity starts from these.

- **Inventory activities** — the Inventory Administration "Needs attention"
  tile (backend summary: PPE replacement and below-par only) disagrees with
  the list under it, which also carries clearances, requests and returns;
  "Issued to members" counts pool issuances only, so permanently assigned
  items read "0, held by 0 members" (W15).
- **Facilities, reports and inventory activities** — four `DialogPanel`
  dialogs have no `role` on the panel or a wrapper: the facilities lookup
  editor, the report viewer, and InventoryScanModal's confirm and
  custody-transfer dialogs (W14-2). The inventory pair sits inside another
  modal; check its tests' dialog queries when changing it.
- **Any run touching the app shell** — while a password change is required
  (first sign-in, admin reset), the shell and shared hooks fire ~17 requests
  the server refuses with 403, including `POST /errors/log`, so errors from
  that state cannot be reported (W08-6).
- **Any run touching the app shell, or an accessibility activity** — every
  page carries two "Skip to main content" links, one in `index.html` and one
  in `AppLayout` (W20).
- **W79** — tap targets under 44px on the onboarding Modules, Ranks &
  Positions and Apparatus steps at 390px wide (W01-13), and the sign-in
  screen's "Forgot your password?", Privacy and Terms links (W02-5), and
  "Back to Login" on the forgot-password page (36px, W03).
- **W75** — password sign-in, failure, lockout and sign-out never reach the
  audit log, so the audit screen cannot show them (W02-3).

## Log

### W29 — Compliance: configure requirements, read the matrix, print it — 2026-09-29

Driven as: `training_officer` at 1280×900 and in print media, with `member`
refused. Held: a threshold saved and survived reload; an at-risk threshold
above the compliant one was refused; unread settings are labelled "not in
effect yet"; the print page drops the app chrome; `member` was refused the
write, the matrix and both pages. Fixed: W29-1 (MED — the printed matrix
re-derived its summary from completion instead of standing, printed "not
started" as "does not apply", and cut requirement names to 12 characters),
W29-2 (LOW — a refused save gave no reason), W29-3 (LOW — 17 configuration
fields unnamed, tab state colour-only), W29-4 (LOW — a requirement nobody is
held to read "0/0 — 0%"). No flags. Gate: typecheck, lint and the touched
suites clean. Next: W30.

### W28 — Skills testing: build a sheet, run a test, the member sees the result — 2026-09-29

Driven as: `training_officer` at 1280×900 and `member` at 390×844, with
`member2` refused. Held: double-clicked Create Template, Begin Evaluation and
Submit each acted once; the scoring screen exposes PASS/FAIL state; the result
page explains an unscored sheet and shows the department's time; the member
sees their result, another member gets 404. Fixed: W28-1 (LOW — the template
builder's fields had no accessible names), W28-2 (LOW — Start Skill Test's
fields unnamed and its mode chosen only by colour), W28-3 (LOW — "Avg Score
0%" and "Pass Rate 0%" for figures the API could not compute). No flags.
Member-examined validation and delayed release not driven. Gate: typecheck,
lint and the touched suites clean. Next: W29.

### W27 — A course cohort: schedule classes, roster, attendance — 2026-09-29

Driven as: `training_officer` at 1280×900 and `member` at 390×844, with
`quartermaster` refused. Held: a double-clicked Generate made one cohort with
two events and both members signed up; Remove withdrew a member from the
classes to come; a double-clicked Shift moved the schedule once; a roster
member sees the schedule without peers, a non-member gets 404. Fixed: W27-1
(HIGH — "Create a new course" opened beneath the syllabus dialog and took no
clicks, blocking every department's first syllabus), W27-2 (MED — a course
created from the syllabus was not listed, so it could not be picked). Flagged:
W27-3 (MED — no way to add a member to a generated cohort). Open: W27-4 (NIT).
Attendance not driven — the classes are in October. Gate: typecheck, lint and
the touched suites clean. Next: W28.

### W26 — A training program: build it, enroll a member, the member's progress — 2026-09-29

Driven as: `training_officer` at 1280×900 and `member` at 390×844, with
`member` and `member2` refused. Held: a double-clicked Create Pipeline and a
double-clicked Enroll each acted once; a member cannot set their own progress;
`member2` was refused another member's enrollment, enrolling and editing.
Fixed: W26-2 (LOW — the member's pipeline card named neither program nor
requirements; `program_name` added to the summary), W26-3 (LOW — two refused
requests per visit, an "Enrolled 0" and a Duplicate for a plain member), W26-4
(LOW — the wizard's new-requirement fields had no accessible names; a raw
position slug on the review), W26-5 (NIT — the enroll picker's selection was
colour only). Flagged: W26-1 (MED — a linked requirement starts at zero,
contradicting the compliance figure on the same screen and the wizard's
promise). Gate: typecheck, lint, flake8, black, isort and the touched suites
clean. Next: W27.

### W25 — Courses and requirements — 2026-09-29

Driven as: `training_officer` at 1280×900, with `member` refused. Held: a
double-clicked course made one; empty names and hours were refused; a
requirement's cleared description saved; Deactivate kept a requirement
restorable; `member` was refused every write, saw a read-only library and got
Access Denied on requirements. Fixed: W25-1 (MED — a double-clicked Create
Requirement made two), W25-2 (LOW — clearing a course's optional fields did not
save), W25-3 (LOW — the course form's fields had no accessible names), W25-5
(NIT — action buttons named the wrong action or no row). Flagged: W25-4 (LOW —
a deactivated course cannot be brought back). Gate: typecheck, lint and the
touched suites clean. Next: W26.

### W24 — Submit a training record, and the officer approves or returns it — 2026-09-29

Driven as: `member` at 390×844 and `training_officer` at 1280×900, with
`member` and `member2` refused. Held: a double-tapped submit, return and
approval each acted once; the officer's note reached the member, Fix and
Resubmit kept every value, and the approved record showed on My Training with
its hours; officer routes refused `member`, another member's submission refused
`member2`, and an approved submission refused edits. Fixed: W24-1 (LOW — the
"Returned" date was the UTC day), W24-2 (LOW — missing fields were marked only
in red), W24-3 (LOW — raw ISO dates and an unnamed notes box on the officer's
review). Open: W24-4 (NIT). No flags. Gate: typecheck, lint and the touched
suites clean. Next: W25.

### W23 — Locations, the kiosk display and guest check-in — 2026-09-29

Driven as: `admin` at 1280×900, anonymous at 1024×768 and 390×844, with
`member` refused. Held: a double-clicked room made one room and one location;
the kiosk showed the event in the department's zone; a double and a repeat
guest sign-in made one attendee and one prospect; `member` was refused every
write and the QR page, with display codes redacted; Regenerate retired the old
kiosk URL. Fixed: W23-3 (LOW — `/locations` offered a member controls the
server refuses). Flagged: W23-1 (HIGH — a guest's prospect lands in no
pipeline when none is flagged default, and no screen shows it), W23-2 (HIGH —
no screen reads a guest sign-in). Open: W23-4 (NIT). Gate: typecheck, lint and
the touched suites clean. Next: W24.

### W22 — A public event request and its status link — 2026-09-29

Driven as: anonymous at 390×844 and 1280×900, `secretary` at 1280×900, with
`member` refused. Held: a double-clicked public submission made one request;
the secretary's task ticks and Start Working showed on the anonymous status
page; the requester's cancel survived a reload and reached the coordinator's
list and activity log; `member` got 403 and Access Denied. Fixed: W22-1 (MED
— the public form's fields had no accessible names), W22-2 (LOW — a pipeline
task's done state was icon-only), W22-3 (LOW — coordinator lists showed rank
codes). Flagged: W22-4 (MED — the requester is never given their status
link). Open: W22-5 (NIT). Gate: typecheck, lint and the touched suites clean.
Next: W23.

### W21 — Event templates, the admin hub, analytics — 2026-09-29

Driven as: `secretary` at 1280×900 and 390×844, with `member` refused on
three pages and two APIs. Held: templates are created once and listed; the
hub's counts and analytics' totals match the data; creating from a template
fills title, type and location; deactivating hides it from the picker.
Fixed: W21-1 (MED — moving an event's start left its end behind, before the
new start, which every template start made the usual case), W21-2 (LOW —
clearing a template's fields did not save, pitfall 1), W21-3 (NIT — the
template picker was unnamed), W21-4 (NIT — a template's default start came
from the browser's clock). Flagged: W21-5 (LOW — Delete only deactivates,
while the dialog says it cannot be undone), W21-6 (LOW — the attendance
rate counts upcoming events as no-shows). Gate: typecheck, lint and the
touched suites clean. Next: W22.

### W20 — Check-in: QR, monitoring, manual — 2026-09-29

Driven as: `member` at 390×844 and `secretary` at 1280×900, with `member2`
checked in and refused, on a Training event with no linked session. Held:
the QR page, a confirming self check-in that a double or repeat tap cannot
duplicate, monitoring that counts and explains early taps, manual check-in;
`member2` refused on page and APIs. Fixed: W20-1 (MED — the check-in screen
said "Training Record Created" for a training event that records nothing;
the server now says whether it will), W20-2 (LOW — the manual check-in
search's label was overridden and 26 buttons were all "Check In"), W20-3
(NIT — "going" in monitoring). Flagged: none. Gate: typecheck, lint and the
touched suites clean. Next: W21.

### W19 — RSVP, change it, and see it on the event — 2026-09-28

Driven as: `member` and `member2` at 1280×900 and 390×844, with `secretary`
reading the result, on a one-seat meeting. Held: an impossible party is
refused in the dialog; Going, Not Going and Maybe hold after reload; a full
event waitlists, and declining promotes the next member automatically; the
officer sees every response and note; a double submit writes once. Fixed:
W19-2 (LOW — RSVP Activity printed raw values), W19-4 (NIT — "holds 1
people"), W19-5 (NIT — 20px answer choices on phones). Flagged: W19-1 (MED —
a waitlist promotion is in-app only, no email, against pitfall 18), W19-3
(LOW — the promotion is missing from RSVP Activity; needs a schema marker).
Gate: typecheck, lint and the touched suites clean. Next: W20.

### W18 — Create, edit and cancel an event, including a recurring one — 2026-09-28

Driven as: `secretary` at 1280×900 and 390×844, with `member` refused on both
pages and three APIs. Held: required fields and the 10-character cancel
reason are enforced; editing one occurrence changes only it; cancelling one
occurrence and the whole series both read back after reload. Fixed: W18-1
(HIGH — series were stepped in UTC, so a 7pm drill became 6pm when daylight
saving ended, and evening custom weekdays, Nth-weekday patterns and skip
dates matched the UTC day), W18-2 (HIGH — "This and all future events"
stamped the anchor's date onto every later occurrence, so a description
edit collapsed the series onto one day), W18-4 (LOW — unnamed and
identically named schedule controls), W18-5 (LOW — "Occurrence of 6" on a
cancelled occurrence), W18-6 (NIT — tap targets). Flagged: W18-3 (MED —
series already stored wrong are not repaired; a data migration). Gate: see
`W18-events-and-recurring.md`. Next: W19.

### W17 — An applicant checks their status by link — 2026-09-28

Driven as: anonymous at 1280×900 and 390×844 (token read from the review
database for setup, since email is off and staff never see it), with
`membership_coordinator` and `chief` reading the result. Held: the page
shows status, progress and a dated timeline; unknown and malformed links
are refused plainly; withdrawal works end to end, once, and reaches the
coordinator's Withdrawn tab and drawer with the reason; the Chief's
sign-offs drop the withdrawn applicant. Fixed: W17-1 (NIT — "Reason
(optional) (optional)", and the same on Apparatus Inventory's note), W17-2
(LOW — an outage read "Application not found"). Flagged: W17-3 (MED — the
label preview hands anyone with `prospective_members.view` every
applicant's status token, which opens and withdraws the application; the
printed barcode carries it too). Gate: typecheck and lint clean; the two
touched suites pass (no Python changed).

**W17-3 resolved** at the owner's direction ("print the short id on
labels"), and W17-4 (LOW — the coordinator was refused the label page their
pipeline links to; the route now takes view or manage, as the API does)
fixed while re-driving it. Labels printed earlier still carry tokens; see
`docs/KNOWN_LIMITATIONS.md`. The rotation restarted; next: W18.

### W16 — Prospective member to converted member — 2026-09-28

Driven as: `membership_coordinator` at 1280×900 and 390×844, with `chief` as
a required signer and `member2` refused on page and API. Held: a pipeline
and stages are created from labelled forms and presets; a Required stage
cannot be skipped; Advance records the stage history; the conversion wizard
is honest about email being off. Fixed: W16-2 (LOW — with no pipeline, Add
Applicant opened a form that silently did nothing), W16-3 (LOW — the Add
Applicant dialog had no role, labels or named close), W16-4 (NIT). Flagged:
W16-1 (HIGH — a Required Multi-Signer Approval stage is not enforced: the
coordinator converted an applicant no officer had signed; the transfer
endpoint never checks required stages, and no screen lets a signer record
an approval). Gate: typecheck, lint and the full frontend suite clean (no
Python changed).

**The rotation stopped here.** W16-1 needs a decision about who may admit a
member and when, which is an authorization and product decision, and the
overnight routine's stop condition. Next, once decided: W17.

**W16-1 resolved** at the owner's direction ("block conversion until required
stages complete, and add signer sign-off"): conversion is refused while any
Required stage is incomplete; signers get a Sign-offs page and a dashboard
row; the applicant drawer's Approval Status now reads the stage's configured
signers. Re-driven end to end as `membership_coordinator`, `chief` and the
president; `member2` sees nothing to sign. See `W16-prospective-member.md`.
The rotation remains stopped; next, when restarted: W17.

### W15 — A member leaves — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member` reading the
directory and `member2` refused on five APIs. Setup: one item created and
assigned through the API (no inventory existed). Held: the drop warns, opens
a clearance with a deadline and serves the property return report;
completing the clearance auto-archives; Reactivate restores the number and
records a second stint. Fixed: W15-1 (MED — Inventory Administration asked
for `in_progress` clearances only, so a new `initiated` one never appeared,
and rows named the member by raw id). Flagged: W15-2 (MED — no screen can
resolve or complete a clearance, and an ordinary return leaves it open, so
the member is never archived), W15-3 (LOW — a member dropped today cannot be
reinstated until tomorrow), W15-4 (LOW — archived members are listed in
every member's directory). Ian Two reinstated afterwards. Gate: typecheck,
lint and the full frontend suite clean (no Python changed). Next: W16.

### W14 — Check-in station, badge scan, labels and ID cards — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member2` refused on page
and API. Held: NFC ID Cards activates; an officer issues a card and a
duplicate serial in another format is refused; the station clocks in, guards
a double tap, refuses unknown and suspended cards with reasons, and clocks
out; badges print for selected members. The ID-card QR lead is closed: only
officer-operated lookups read it, and the station and kiosk identify by NFC
card. Fixed: W14-1 (MED — a badge printed for a member without a membership
number carried a short id no scanner in the app resolved), W14-2 (LOW — the
integration Activate/Connect dialog had no dialog role or name), W14-3 (NIT).
Nothing flagged. Test card removed and NFC ID Cards deactivated afterwards.
Gate: typecheck, lint and the full frontend suite clean (no Python changed).
Next: W15.

### W13 — Waivers — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member` reading their
own profile and `member2` refused on page and API. Held: validation before
anything is sent; training-plus-leave, training-only and permanent waivers
stored as chosen; the member sees their own leave; deactivating asks first
and takes the linked training waiver with it; the history lists every one.
Fixed: W13-1 (MED — "Meeting Attendance" and "Shift Requirements" were
separate choices, but a leave excuses both, so either box excused every
shift), W13-2 (LOW — five unlabelled fields, filters by colour alone),
W13-3 (LOW — a refused deactivation hid the server's reason), W13-4 (NIT).
Flagged: W13-5 (LOW — whether meetings and shifts should be separable needs
a column). All review waivers deactivated afterwards. Gate: typecheck, lint
and the full frontend suite clean (no Python changed). Next: W14.

### W12 — Member settings — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member` reading the
directory and `membership_coordinator` and `member2` refused. Held: every
section saves and survives a reload; contact visibility reaches the
directory; ranks refuse a duplicate and a rank ten members hold; tiers
refuse a colliding id, a held tier's removal and a ladder that would demote;
EVOC refuses a duplicate level and asks before deleting; the coordinator is
sent to the one section its grant opens. Fixed: W12-1 (LOW — the IDs screen
showed "RV-150" where the server issues "RV-0150"), W12-2 (LOW — one tap
deleted a rank permanently), W12-3 (LOW — rank form unlabelled, seat
eligibility by colour alone), W12-4 (NIT). Nothing flagged. Settings put
back as found. Gate: typecheck, lint and the full frontend suite clean (no
Python changed). Next: W13.

### W11 — Edit a member as an officer — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member2` refused on page
and API. Held: clearing middle name, phone and personal email persists
across a reload; a status change to Leave with a reason, and a membership
type change, both land and are filed under the right history filter;
Manage Members adds and removes; every change is audited. Fixed: W11-1 (MED
— an emergency contact without an email was a 422 and the contact was
lost), W11-2 (LOW — 21 unlabelled fields plus both member dialogs), W11-3
(LOW — Reset Password named no rule and was silent on success), W11-4 (LOW
— Manage Members' `Promise.all` hid a partial save; the W05 lead), W11-5
(LOW — the "×" confirmation did not name the position and a refusal read as
a connection fault), W11-6 (LOW — the history showed no time), W11-7 (NIT).
Flagged: W11-8 (MED — the last-administrator check takes no lock), W11-9
(LOW — the base Member position can be removed like any other). Casey put
back to active and probationary afterwards. Gate: typecheck, lint and the
full frontend suite clean (no Python changed). Next: W12.

### W10 — Find a member and read their profile — 2026-09-28

Driven as: `member`, `member2` and `admin`, at 1280×900 and 390×844. Held:
search by name and member number, and a hidden email cannot be confirmed by
searching for it; a colleague's profile shows only what a member may see;
turning the department's contact ceiling on shows email and phone; a member
setting their work email to "Only you and leadership" hides it from other
members in the page and the API while `admin` still sees it, and the choice
survives a reload. Fixed: W10-1 (LOW — every colleague's profile fired two
403s for leaves of absence), W10-2 (LOW — the search box promised an email
search that could not match while emails are hidden), W10-3 (NIT). Nothing
flagged; one lead for the kiosk activities (unsigned ID-card QR). Settings
restored afterwards. Gate: typecheck, lint and the full frontend suite
clean (no Python changed). Next: W11.

### W09 — Import members from a spreadsheet — 2026-09-28

Driven as: `admin` at 1280×900 and 390×844, with `member2` refused. Held:
the pre-check named four of seven bad rows before anything was written, each
with the column and a fix; the error report returns them with the reason
and neutralises a leading `=`; imported rows were stored exactly (US dates
converted, quoted commas kept, rank, position and contacts saved); a
re-upload flags every row as already on the roster; the error report
re-uploads with its reason column ignored; a non-CSV is refused. Fixed:
W09-1 (MED — a duplicate email passed the pre-check whenever the department
hides work email, because `GET /users` returned every email null), W09-2
(LOW — "Import Complete! Successfully imported 0 members" over an all-failed
run), W09-3 (NIT). Nothing flagged. Gate: typecheck, lint and the full frontend suite
clean (no Python changed). Next: W10.

### W08 — Add a member and their first sign-in — 2026-09-28

Driven as: `admin`, the new member and `member2`, at 1280×900 and 390×844.
Held: an empty submit names 13 required fields; everything the form sends is
stored; with email off the password is required and the form says why; the
first sign-in holds the member on a forced change, signs them out after it
and lets the new password in; both new members show in another member's
directory; a member is refused page and API; creates are audited. Fixed:
W08-2 (MED — a second member whose email shared a local part could not be
added: "Username already exists" for a field the form does not show), W08-3,
W08-4 (LOW — 28 unlabelled fields; the password checked only for length),
W08-5 (NIT). Flagged: W08-1 (MED — Status and Preferred Contact were offered
and never saved; removed, and the owner question mirrored to
KNOWN_LIMITATIONS). Open: W08-6 (LOW — refused requests while a password
change is required; added as a lead). Not driven: adding without a
password, which needs email. Gate: typecheck, lint and the full frontend suite
clean (no Python changed). Next: W09.

### W07 — Dashboard for each role — 2026-09-28

Driven as: all ten seeded roles at 1280×900, `admin` and `member` at
390×844. Held: every dashboard loaded with no failed request, console error
or broken text; all 42 links across the ten dashboards opened a page the
role can use; the money, grant and outreach cards follow their permission
and module gates. Fixed: W07-1 (LOW — with Integrations or Scheduling off,
every page fired 403s for `/integrations/connected` from both navigation
bars and `/scheduling/settings` from the dashboard; confirms and closes the
W07 lead). Nothing flagged. Gate: typecheck, lint and the full frontend suite
clean (no Python changed). Next: W08.

### W06 — Organization settings, modules, department setup — 2026-09-28

Driven as: `admin`, with `member` for what the department sees, at 1280×900
and 390×844. Held: name, timezone, contact and logo autosave, survive a
reload and reach every member's header; a cleared field stays cleared;
turning Minutes off removed it from the member's menu and its URL explained
why, and turning it back on restored both; the member is refused on both
pages and every write; "Mark as reviewed" moves and keeps the setup count.
Fixed: W06-1 (MED — an emptied name failed every profile save until it was
retyped), W06-2 (MED — "Create Shift Templates" and "Configure & Verify
Email Delivery" opened screens that cannot do the step), W06-3, W06-4 (LOW —
14 unnamed contact/address fields; a logo could not be removed). Nothing
flagged. Gate: typecheck, lint, flake8, black, the full
frontend suite and the checklist tests clean. Next: W07.

### W05 — Positions and permissions — 2026-09-28

Driven as: `admin` → `member`, plus `membership_coordinator` and `chief`, at
1280×900 and 390×844. Held: a position created with `reports.view` and
assigned to `member` opened Reports in the member's live session; unchecking
the permission, and deleting the position, took it away again; `member` is
refused on both pages and the API; the grant ceiling refused the coordinator
Chief and `chief` both emptying IT Manager and adding `*` to Member; double
submit made one position; every change audited with the actor. Fixed: W05-1
(MED — a refused save showed its error behind the dialog, in schema
language), W05-2 (MED — Manage Roles told a coordinator they could not
assign positions, behind the dialog, instead of the server's reason), W05-3,
W05-4, W05-6 (LOW), W05-7 (NIT). Flagged: W05-5 (LOW — duplicate position
names), mirrored to KNOWN_LIMITATIONS. Gate: typecheck, lint and the full frontend suite clean
(no Python changed). Next: W06.

### W04 — My account — 2026-09-28

Driven as: `member`, with `member2` as the other member, at 1280×900 and
390×844. Held: password change refuses a wrong current password, reuse and a
change inside the minimum age; MFA enrolment, sign-in by code and by recovery
code, the replay guard, regeneration and turning MFA off with a code;
notification preferences survive a reload; another member sees emergency
contacts redacted and gets `403` editing them; no overflow on eight tabs.
Fixed: W04-2 (HIGH — recovery codes were never shown), W04-3 (HIGH — a
correct password cleared the MFA failure count, so the lockout never
tripped), W04-1 (MED — no message after a password change signed the member
out), W04-4 (MED — a contact with the fields marked required got a 422 in
schema paths), W04-5, W04-6, W04-8 (LOW), W04-9 (NIT). Flagged: W04-7 (LOW —
phone and mobile are free text), mirrored to KNOWN_LIMITATIONS. MFA left off
for `member` so the harness can sign in. Gate: typecheck, lint, flake8, black and the full frontend suite clean;
the auth/MFA backend tests pass. Next: W05.

### W03 — Forgot password and reset by link — 2026-09-28

Driven as: a signed-out visitor and `member2`, at 1280×900 and 390×844, with
a minted token standing in for the email (tokens are stored hashed and email
is off here). Held: the same answer for every address, requests audited, the
token in the URL fragment and single-use, a used or bad link refused, and a
reset that signs in with the new password, refuses the old, and (from code)
ends sessions and clears a lock. Fixed: W03-2 (MED — "Check Your Email"
covered the server saying no link was sent under outside sign-in); W03-3
(MED — a rate-limited link was called invalid); W03-4 (MED — both
checklists said 8 characters and missed two server rules; one shared list
now); W03-1, W03-5 (LOW); W03-8 (NIT — suppressions removed). Flagged:
W03-6 (MED — with email off the page promises an email) and W03-7 (MED —
request, open and submit share 3 requests per 5 minutes), both mirrored to
KNOWN_LIMITATIONS. Gate: typecheck, lint, flake8, black and the full
frontend suite clean. Next: W04.

### W02 — Sign in, sign out, session timeout, lockout — 2026-09-27

Driven as: `member`, `member2` and a signed-out visitor, at 1280×900 and
390×844. Held: sign-out revokes the session server-side and per device, no
account enumeration, the 15-minute idle timeout (warning, sign-out,
message, and a keypress keeping the session), account lockout, and the
per-address limit. Fixed: W02-2 (MED — the sign-in screen ignored the
server's Retry-After, telling a rate-limited member to wait 4 seconds
instead of 60); W02-1 (LOW — deep links lost their query after sign-in);
W02-6 (NIT). Flagged: W02-3 (HIGH — password sign-in, failure, lockout
and sign-out are never audited); W02-4 (MED — a locked account looks like
a wrong password and no admin screen shows the lock); both mirrored to
KNOWN_LIMITATIONS. Open: W02-5 (LOW). Harness: `wr.as` now refreshes or
re-signs a stale session, paced, since the server ends sessions after 15
idle minutes. Gate: typecheck, lint and the full frontend suite clean.
Next: W03.

### W01 — Fresh-install onboarding — 2026-09-27

Driven as: anonymous visitor → system owner, at 1280×900 and 390×844, across
three fresh installs. Held: required-field summaries, one organization per
double-click, the server refusing a second owner, station rows kept and not
duplicated, one stored entry per apparatus seat, and a Reset that asks first
and deletes what it says. Fixed: W01-10 (HIGH — Reset left cookies for the
deleted owner and the page retried `/onboarding/start` about 75 times a
second); W01-2, W01-5, W01-6, W01-8 (MED — password rules missing from the
checklist, a dead end on Back from Modules, apparatus seats unique, ~1,450px
sideways scroll on phones); W01-1, W01-3, W01-4, W01-7, W01-9 (LOW). Flagged:
W01-11 (HIGH — Authentik offered with no sign-in behind it; choosing it turns
off password reset), mirrored to KNOWN_LIMITATIONS. Open: W01-12, 13, 15, 16
(LOW), W01-14 (NIT). Harness: the seed now waits for each step's heading
before pressing anything. Gate: typecheck, lint, flake8, black and the
touched suites clean. The database was reset to drive onboarding and
re-seeded at the end. Next: W02.

<!-- One entry per run, newest first:
### W<nn> — <activity> — <YYYY-MM-DD>
Driven as: <roles>. Held: <what worked>. Fixed: <ids>. Flagged: <ids by severity>.
Gate: <clean / what was not run and why>. Next: W<nn>. -->
