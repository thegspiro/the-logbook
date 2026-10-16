# Recent changes: October 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's page, and a new month starts a
new page. The engineering audit behind each pass is in
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md).

## Recent changes: October 15 – 16, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-15--16-2026).
Predecessor: [October 14 – 15](#recent-changes-october-14--15-2026).

**The headline:** **Medical Supplies** now say where each supply is kept, on the
shelf and on which apparatus, and can be sorted, filtered and retired in bulk.
Catalog Links can link obvious matches for you. Google accounts of departed
members are suspended more reliably.

### Read this first

**If you run the server:** the Unraid and minimal compose files now require your
database, Redis and app secrets instead of falling back to placeholders; set them
before upgrading. Error reports no longer include local variables. Three new
migrations; `alembic heads` should report one head.

**If you administer a department:**

- **Medical Supplies.** File each supply under a room and storage area. Existing
  supplies are filed automatically when exactly one active area matches their old
  text. Use the location filter, sort the table, and retire several at once.
- **Catalog Links.** **Link matches automatically** links exact and strong
  matches and skips ties. Each name has an **Undo**.
- **Google Workspace.** On the Google card, **Link existing members** covers
  people who joined before the integration, so their accounts are suspended when
  they leave.
- **Documents.** Full administrators get a weekly email listing folders only
  administrators can open. A department can make it required.

**If you are a member:** My Checklists is a compact list by day on a phone. A
position at its critical minimum is no longer flagged critical; only a count
below it is.

### What changed, by area

| Area             | Change                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Medical Supplies | Storage room and area, apparatus places, location filter, Where it is dialog                            |
| Medical Supplies | Sort, bulk retire, Lots dialog, clickable tiles, Size, Next expiry, unset reorder point shown as a dash |
| Equipment checks | Automatic catalog linking with Undo; critical means strictly below the minimum; phone checklist layout  |
| Google Workspace | Accounts tagged with the member; link existing members; suspension from one departure hook              |
| Membership       | The undo window for a drop counts from its effective date                                               |
| Documents        | Weekly administrator-only folder email                                                                  |
| Security         | Reads of leave, service history and audit records are audited; incident-response policy added           |

Screenshots to capture and video beats to redo are queued in the repository's
`docs/training/SCREENSHOT_CURRENCY.md` and `docs/youtube-scripts/SCRIPT_CURRENCY.md`.

## Recent changes: October 14 – 15, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-14--15-2026).
Predecessor: [October 13 – 14](#recent-changes-october-13--14-2026).

**The headline:** **Meeting Minutes** now follow how a department really adopts
them: circulate, take members' suggestions, adopt. Roll call, closed sessions,
attachments, outlines and formatted text came with it. Checklist items also
find catalog items under other names.

### Read this first

**If you run the server:** rebuild the backend image (`docker compose build
backend`), or run `pip install -r backend/requirements.txt` from source; the
minutes editor needs a new package, and the backend will not start without it.
Three new migrations; `alembic heads` should report `1d65720bce34`. Manual Docker
backups taken before this change did not include uploaded files; take a new one.

**If you administer a department:**

- **Minutes.** Members can now read minutes that have been circulated, and are
  emailed when you circulate them (each member can turn that email off). Drafts
  and executive sessions are still hidden. Set up your standard order of business
  under **Minutes > Outlines**.
- **Inventory.** Give items other names under **Also called** ("BVM" for "Bag
  Valve Mask"). A medical supply category can be deleted; its supplies move to
  another category first.
- **Finance.** **Start from last year** no longer copies lines on retired
  categories.

**If you are a member:** open circulated minutes and use **Suggest a change** on
the section you want corrected. Only you and the secretary see your suggestion.

### What changed, by area

| Area         | Change                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Minutes      | Circulate for review, member suggestions, recall, adopt as presented or amended; circulation email; required sections              |
| Minutes      | Roll call with six statuses and quorum; closed sessions; election results and addenda; attachments and signed copy; printable copy |
| Minutes      | Outlines page; formatted text in sections; approved versions with a fingerprint; carry open action items forward                   |
| Inventory    | Also called names, near-match search in checklist pickers, CSV column; delete a medical supply category                            |
| Finance      | Start from last year skips retired categories                                                                                      |
| Training     | Single enrollment enforces prerequisite programs                                                                                   |
| Integrations | Claude connections made with member sign-in can now run tools                                                                      |
| Appearance   | Opaque result lists in dark mode; every control's visible text is in its accessible name                                           |
| Operations   | Docker backups include uploads; upgraded installations no longer 500 on medical categories                                         |

Screenshots to capture and video beats to redo are queued in the repository's
`docs/training/SCREENSHOT_CURRENCY.md` and `docs/youtube-scripts/SCRIPT_CURRENCY.md`.

## Recent changes: October 13 – 14, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-13--14-2026).
Predecessor: [October 12 – 13](#recent-changes-october-12--13-2026).

**The headline:** **cash advances** under the IRS accountable plan, **budget
sub-lines that only chosen positions may charge**, dues and sub-categories in the
**QuickBooks export**, a **My Training** page split into what to do now and your
full history, and a **button layout fix** across 32 screens.

### Read this first

**If you run the server:** four new migrations (cash advances, dues export,
budget charge access, skill-test validity) and two merge revisions; check
`alembic heads` reports one head. `BACKUP_ENABLED` and `BACKUP_SCHEDULE` never did
anything: backups run daily at `BACKUP_TIME` (UTC). `install.sh --traditional`
now needs Python 3.13 or newer. Re-run `scripts/setup-ssl.sh` on a server the old
version left loading pages but failing API calls.

**If you administer a department:**

- **Finance.** Members can request a cash advance and account for it; set the two
  QuickBooks accounts under Finance > QuickBooks Export before exporting one. A
  budget category can keep its lines for the owner and chosen positions
  (nothing is restricted until you do it). Once a dues account is set, the next
  export carries every dues payment in its period, so export only later periods
  if you entered earlier dues by hand.
- **Training.** Rolling hours requirements count whole calendar months and show
  no due date. A skill can be given a validity period in months.
- **Documents.** Creating, opening up or moving a folder that only full
  administrators could open now asks you to confirm.

**If you are a member:** My Training now leads with what is due; **History**
lists everything on your record, with no 100-record cap. An hours requirement
shows **Show monthly hours**. The apparatus inventory on a phone has filter chips
and saves each tap, with no Save button.

### What changed, by area

| Area           | Change                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Finance        | Cash advances, overdue advances report, QuickBooks advance accounts; who can charge a category's lines; export from its own page |
| Finance        | Dues payments exported to QuickBooks; subcategories export through their parent's accounts; restricted funds on request forms    |
| Training       | My Training tabs, upcoming list with rolling hours and skills-test expiry; cohort roster sync honours prerequisites              |
| Documents      | Admin-only folder confirmation                                                                                                   |
| Facilities     | Record dialogs centred, Maintenance Type required, due dates in words                                                            |
| Inventory      | Apparatus inventory restacked for phones                                                                                         |
| Communications | Suggestion-box editor puts Questions after the name                                                                              |
| All screens    | Icon-and-label buttons on one line at desktop width; a deliberate 503 shows its message instead of retrying for minutes          |
| Operations     | SSL script, Python check, backup time, Unraid update stop, ClamAV note                                                           |

Screenshots to capture and video beats to redo are queued in the repository's
`docs/training/SCREENSHOT_CURRENCY.md` and `docs/youtube-scripts/SCRIPT_CURRENCY.md`.

## Recent changes: October 12 – 13, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-12--13-2026).
Predecessor: [October 11 – 12](#recent-changes-october-11--12-2026).

**The headline:** a **finance pass** (two-person approval, the IRS accountable-plan
deadline, expense classes and board reports), a **keyboard and screen-reader pass**
over every dialog, menu and tab list, and a department can now choose **one
practical-skills system**.

### Read this first

**If you run the server:** fourteen new migrations (check `alembic heads` reports
one head). Two move data: facility folders are refiled and restamped, and the
practical-skills setting is backfilled. A fresh installation could not finish setup
because the Encryption Key step returned a 403; that is fixed. A setup wizard left
open more than 24 hours must be refreshed. The universal installer now sets
`ALLOWED_ORIGINS` from `--public-url`, so a new install no longer refuses requests
made under the department's own hostname.

**If you administer a department:**

- **Pick a practical-skills system** under Training Administration > Settings &
  Data > Practical Skills: **Skills Testing** or **Shift report sign-offs**. The
  other is hidden, nothing is deleted.
- **Facility folders** (Photos, Maintenance Records, Inspection Reports) now open to
  anyone with facilities access; blueprints, insurance and capital projects stay
  restricted. Check who holds `facilities.view`.
- **Compliance emails are live.** Members start receiving deadline reminders and
  non-compliance notices if your saved settings ask for them.
- Editing someone else's profile or contact details needs `members.manage`.
- Public-portal access logs are kept 90 days.

### What changed, by area

**Finance.** Requests at or above a threshold you set need **two different
approvers**. Expenses can enforce the **accountable-plan deadline** (off, warn or
block; 60 days is the IRS safe harbor). Budget categories and purchases carry a
**functional class**. **Finance > Reports** has budget vs actual, an amendment log,
a payments register, functional expenses and a late-claims report, each on screen,
as CSV and printable. You can no longer record a payment against your own dues.

**Training.** Programs can name **prerequisite programs** and allow concurrent
enrollment. Requirements can have their **own due date**, member-facing wording
and a completion message; reminders and one overdue notice follow the program's
ramp. Editors that silently kept an old value after you cleared a field (programs,
phases, milestones, skill templates, records, requirement years and dates, shift
report drafts) now save the clear. Program-progress reports are renamed to say they
are not requirement compliance.

**Scheduling.** A **Weekend Only** pattern preset, and weekly patterns can choose
day, night or both for each weekday. Deleting a shift template or pattern asks first.

**Inventory.** A **Catalog Links** page links unlinked checklist lines across every
template at once. A return notice received another way can be **inspected**. Record
inspection closes the scheduled inspection. Reorder requests link to an item. The
items list shows serial numbers and says **No location**.

**Events, documents, grants.** Attendance requests show how often they were resent.
Published minutes show **Being corrected** while reopened. Folder access can be set
by position and permission. Suggestion boxes ask their questions first. Grant
applications follow a lifecycle and warn on overspend; anonymous donors are hidden
from view-only holders.

**Dashboard and reports.** **Customize** the Department pulse (yours, or the
department default). A **Saved reports** screen and scheduled email delivery.

**Accessibility.** Every dialog has a role, a name and sensible focus; tab lists
take arrow keys; menus close on Escape and give focus back; pagination keeps
focus; 19 more dialogs keep Save and Cancel in view.

**Wiki.** Installation has one page per platform. The Training, Inventory,
Scheduling, Events and Elections module pages are split into a user page and a
Developer page and no longer carry dated notes. A new
[Shift History Import](Scheduling-History-Import) guide has a sample file and ten
screenshots.

### Screenshots and videos

Training screenshots to create or replace are listed in
[`SCREENSHOT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/training/SCREENSHOT_CURRENCY.md#queued-by-the-october-12--13-documentation-pass);
video beats to re-record in
[`SCRIPT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/youtube-scripts/SCRIPT_CURRENCY.md).

## Recent changes: October 11 – 12, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-11--12-2026).
Predecessor: [October 8 – 11](#recent-changes-october-8--11-2026).

**The headline:** many screens that guides described but the app lacked now exist:
**dues administration**, **grant opportunities, donations, pledges and fundraising
events**, **departure clearance**, **a meeting attendance dashboard**, **folder
management**, and a **member compliance view**.

### Read this first

**If you run the server:** six new migrations (check `alembic heads` reports one
head). Five unused settings were retired; a `.env` that still names them boots with
a warning.

**If you administer a department:**

- **Documents always live in a folder.** Anything uploaded without one goes to
  **General Documents**, and existing loose documents were moved there. Check who
  can open that folder.
- **Forms can refuse a second submission** from the same person, on the public and
  in-app paths; the builder has a control for it.
- **Election results are graded per ballot item.** Anything reading
  `overall_results` through the API should read `results_by_position`.
- **Customised email templates now show the department footer** even if they did
  not include it.

### What changed

#### Finance and grants

Dues: create or edit a schedule, generate dues, record a payment. Export history
sits beside the QuickBooks mappings. Grants: **Add Opportunity** (it used to bounce
to the dashboard), **Record Donation**, **Pledges** and **Fundraising Events**.

#### Inventory and equipment checks

Assignments ask **Permanent** or **Temporary** with a return date. A departure
clearance record lets you resolve each line, then complete or close it
incomplete. A short count on a shift check raises a restock report, and a lot swap
files a reorder request at the reorder point. Check reports include basic
apparatus.

#### Medical screening

**Show compliance for** opens one member's or prospect's requirement-by-requirement
status; the roster has a **Not compliant (overdue)** filter.

#### Meetings, events, forms and documents

Minutes: an **Attendance** dashboard, executive/trustee/annual meetings, and
action items assigned to members. Events list **guests** apart from attendance.
Forms warn before publishing a public form that would file nothing. **Manage
folder** renames, restricts, moves or deletes a folder. Failed department-message
deliveries retry five times before showing as failed.

#### Elections

Proxy ballots on anonymous elections (with acknowledgement), no default Abstain,
ballot links retired when the ballot changes, auto-open sends ballots and alerts
managers if it cannot, and results grade each contest separately.

#### Prospective members and settings

Referral details in the drawer, a **Department Email** section in Organization
settings, and a warning email seven days before Auto-Purge deletes an application.

#### Scheduling

The close-out confirm step offers **Give everyone all _N_ calls**. Three
saved-but-inert settings are labelled "not in effect".

### Screenshots and scripts

Screenshots to create or replace and video beats to redo are queued in the
repository's `docs/training/SCREENSHOT_CURRENCY.md` and
`docs/youtube-scripts/SCRIPT_CURRENCY.md`. Nothing has been re-captured yet.

## Recent changes: October 8 – 11, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-8--11-2026).
Predecessor: [October 7 – 8](#recent-changes-october-7--8-2026).

**The headline:** members can **time pre-shift work** from the vehicle scan,
departments can **import past shifts**, **suggestion boxes ask questions and route
submissions**, and **administration hubs** became described cards with a phone-
friendly row and four new review queues. Underneath: **every stored file is
encrypted**, and **budgets need a second officer to confirm amendments**.

### Read this first

**If you run the server:** twenty new migrations (check `alembic heads` reports
one head). Stored files are encrypted from now on; run `scripts/encrypt_uploads.py`
to encrypt older ones, and confirm the encryption key is stored apart from the
server. Prospective-member Auto-Purge now deletes, counting from the upgrade.

**If you administer a department:**

- **Pre-shift work is on by default.** Members who scan a vehicle before check-in
  opens are offered **Doing pre-shift work?**. An officer must approve the time; it
  adds hours, never shifts. Turn it off in Shift Settings → **Allow pre-shift
  work**.
- Review who can approve budget amendments (`finance.budget_review`,
  `finance.manage`); the person who entered one cannot confirm it.

### What changed

#### Scheduling

- **Pre-shift work.** Scan the vehicle while check-in is closed, pick the shift
  (within 48 hours), scan again to finish. Approved in the close-out wizard, the
  shift panel or the **Pre-shift time awaiting review** queue. Counts in hours
  reports, My Hours and Shift Compliance hours.
- **Shift History Import** (`scheduling.manage`): upload a CSV as a draft, settle
  members, units, positions and proposed shifts, then commit (final). Back-to-back
  entries join, with **Split apart** to undo; decisions are remembered for later
  files.
- Shifts can be put on rigs added through the Apparatus module.

#### Administration hubs

Described section cards (Events, Members, Store; Training in seven areas), a
scrolling chip row on phones, hub sections in the search palette, **Headline
Metrics** on Inventory and Scheduling, and new **Needs attention** queues for
skills tests, shift reports, attendance requests and open order windows.

#### Communications

Suggestion boxes can ask branching **Questions**; a dropdown or single-choice
answer can send the submission to another box, read only by that box's reviewers.
The Compliance box asks "What kind of concern is this?".

#### Events, finance, apparatus

Attendance requests can be withdrawn (twice) and organizers have a cross-event
list. Finance adds next-year requests, board review, adoption, year-end close,
**My Budgets** and receipts. Apparatus explains **Deficiency**, requires a
**Reason** for Out of Service, and files photos and documents as documents. The
equipment-check builder fits a phone.

#### Security

Per-file AES-256-GCM encryption at rest, an encryption-key confirmation in setup,
organization-first upload storage, and the end of the client-supplied-ID sweep
(XC-1) across training, scheduling, events, inventory, apparatus and others.

### Screenshots and scripts

Not re-captured. The queue is in `docs/training/SCREENSHOT_CURRENCY.md` and
`docs/youtube-scripts/SCRIPT_CURRENCY.md`.

## Recent changes: October 7 – 8, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-7--8-2026).
Predecessor: [October 6 – 7](#recent-changes-october-6--7-2026).

**The headline:** **every member can raise their own finance requests**,
**Target Solutions imports credit members automatically** (with a manual report
upload and course mappings), **officers can void or edit a training record and the
member is told**, and the **apparatus pages guide a first-time chief**.

### Read this first

**If you run the server:**

- **Five migrations** land after head `8c4f2a6e1d93` (new head `7db20aa49329`). One
  makes staged training imports unique per provider record; existing duplicates are
  marked, never deleted. Downgrading drops course mappings and the structured void
  reasons.
- **Every member gains the `finance.request` permission** through the seeded
  **Member** position. Remove it from that position if you do not want members
  raising requests. See the 2026-10-07 entry in `docs/UPGRADING.md`.

**If you administer a department:**

- **Target Solutions** completions that match a member become training records at
  sync or upload; unmatched ones wait under **Imports**. Other providers still need
  an officer's review.
- **Fix your HIPAA, Bloodborne Pathogens and Hazmat requirements.** The templates
  now create **Courses** requirements; the old "hours of this type" form let any
  CAPCE hour satisfy a HIPAA refresher. Existing requirements are not rewritten and
  show a warning on their card.

### What's new

#### Finance

- Members see **My Purchase Requests**, **My Expense Reports** and **My Check
  Requests** under a new **Finance** entry in the navigation. They create, edit
  and submit their own, and withdraw a draft purchase request. Another member's
  request is not found. Approval chains still apply; nobody approves or pays their
  own.
- Forms offer budget lines by name and amount remaining ("Training — $1,250.00
  remaining") without budget access. Ordering, receiving, paying, issuing and
  voiding stay with finance managers.

#### Training provider imports

- **Upload Report** on a Target Solutions card takes the completions-report CSV
  with no key. Sync and upload never record a completion twice.
- The live report format is now accepted; members are matched by Employee ID when
  email finds nobody; hours come from **Duration (hours)**; "Admin" items become the
  new **Policy Acknowledgment** type.
- **Mappings › Courses** maps a provider's new Course ID to your library course so
  a requirement stays met when the provider issues a new version. Training officers
  get a **New Course Version to Map** email.
- Import and Bulk Import buttons now keep the category and hours you choose.

#### Training records

- **Void** (with a required reason) and **Edit** on a member's Training History.
  The member sees the reason, and gets a bell notice and a required email. A void is
  final and removes a qualification the record granted.

#### Apparatus

- An empty fleet says **No apparatus yet** and explains what to add; the Add form
  says what is required; NFPA tracking is per vehicle; fuel reads **CNG**.
- The row wrench opens **Maintenance**; Archive is on the apparatus page. The
  maintenance form explains which date to use; the Equipment tab explains it is not
  the crew's shift checklist and links to the builder.
- Status and type badges are readable (contrast fixed).

#### Smaller changes

- Member Visibility Settings: grouped cards, two columns, and a pinned Save bar
  with the unsaved count.
- Floating menus (Training Admin **More**, equipment-check builder) are opaque in
  dark mode.
- **Add Member** with a membership number no longer fails.

### Security review

Eight passes. Two changed code: **onboarding** (a race let two simultaneous
first-run requests create two organizations; fixed, plus a false "reset failed"
log entry) and **reports** (the Pipeline Overview showed an officer their own
prospective-member record; fixed). The rest found nothing new.

### Where to read more

[Module-Training](Module-Training) · [Module-Apparatus](Module-Apparatus) ·
the repository's `docs/training/11-finance.md`, `16-integrations.md`,
`06-apparatus-facilities.md` and `docs/UPGRADING.md`.

## Recent changes: October 6 – 7, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-6--7-2026).
Predecessor: [October 5 – 6](#recent-changes-october-5--6-2026).

**The headline:** every setting in your `.env` now actually reaches the server
(some that were silently ignored will start working), **open shift swaps are
first-come, first-served**, a department's **own crew seats** can be filled,
**compliance counts shift attendance** for "shifts completed" requirements,
**elections use one ballot** for the app and the email (with proxy voting and
multi-seat races), and **Claude can connect to a member's account** through an
opt-in sign-in.

### Read this first

**If you run the server:**

- **Review `.env` before upgrading.** The backend's compose `environment:` block was
  an allowlist, so about four in five settings (SMTP, sign-in providers, Twilio,
  CAPTCHA, push, Sentry, password policy) were ignored. All of them now pass
  through. A stale `EMAIL_ENABLED=true`, an old `ACCESS_TOKEN_EXPIRE_MINUTES=480`, or
  a placeholder `SALESFORCE_OAUTH_REDIRECT_URI` will take effect, and a typo or a
  production-check violation (for example `RATE_LIMIT_ENABLED=false`) stops the
  backend booting. Run the preflight described at the top of
  `docs/UPGRADING.md` (and see [Deployment-Docker](Deployment-Docker)) first. A compose file you maintain yourself
  keeps its old allowlist.
- **Unraid:** the template has a new required, masked **ENCRYPTION_SALT** field.
- **Signing keys:** if `AUDIT_LOG_SIGNING_KEY` or `VOTE_SIGNING_KEY` was in `.env`,
  it only starts signing now. Old rows keep verifying with `SECRET_KEY`, so **do not
  change `SECRET_KEY`** while they matter.
- **Eleven migrations** land after head `15802f3df5c4`. Downgrading some of them
  discards data: knowledge tests, integration sync history, MCP connections,
  election revision marks and seats-per-race. The shift-seat migration refuses to
  downgrade while a custom seat is stored.
- **Managed database or Redis?** There is a new opt-in
  `docker-compose.external-services.yml` override; see
  [Deployment-Production](Deployment-Production). With it, back up the `uploads` and
  `audit_archives` volumes yourself.

**If you administer a department:**

- **Compliance numbers move.** A "shifts completed" requirement now counts
  attendance on your finalized shifts (plus counted external shifts) everywhere;
  a department requirement linked into a training program shows the member's live
  figure instead of starting at zero.
- **Open swaps:** the first eligible member to **Pick up** takes the seat; officers
  can deny but no longer approve an open swap. Nobody is emailed about open swaps.
- **Members:** a position name another position already uses is refused; the base
  **Member** position cannot be removed from an active member; phone numbers are
  checked when saved.
- **Elections:** a closed election's results are visible to everyone who can view
  elections (the publish switch is gone). Ranked choice cannot be combined with
  more than one seat.

### What's new

#### Training and members

- **Online knowledge tests**: question bank, online delivery and automatic grading;
  members take them on the **Knowledge Tests** page. Answers are never sent before
  submitting.
- **Skill Evaluations** screen under Training Admin › Setup, and **skills testing
  that works offline**, with a queue that replays when the signal returns.
- **Cohort rooms**: pick a room per cohort and override it per class.
- **Qualifications** can be entered on a member's profile or imported from a CSV
  (previewed first) in **Members admin → Import Qualifications**.
- **Department Readiness** heat-map on Training Admin › Advanced › Competency.
- **Undo a mistaken drop** within 7 days; **Add Member** can set the starting
  status; leave editing and **Overdue Property Returns** have screens.
- **Admin hours Review Rules**: a sole-officer department can approve its own
  entries; a resync that grows an approved entry past 25% sends it back for review.
- Optional **virus scanning** of self-reported certificates (off by default).

#### Scheduling

- **Shared calls** in the close-out wizard: tick a call another unit already logged
  so it is counted once.
- **Open swaps** and **custom crew seats**, as above. An unrecognised seat is refused
  with error `LB-SCHED-003`.

#### Elections

- One ballot for the in-app **Cast Vote** tab and the emailed ballot; positions-only
  elections can now email ballots.
- **Proxy ballots** (refused on anonymous elections for now), a ballot email that
  names the proxy, **seats per race**, and a visible **Results revised** mark when a
  closed election is corrected.

#### Security, integrations and operations

- **Security Alerts** page (`/admin/security-alerts`): acknowledge and resolve with a
  note; every export is audited and listed.
- **Integration health**: each integration has a detail page with sync history, last
  error and **Retry sync**.
- **Claude connections** (opt-in OAuth 2.1): members approve Claude at
  `/claude/authorize` and manage connections at `/claude/connections`; admins register
  clients on the Integrations page. See [Integration-Claude-MCP](Integration-Claude-MCP).
- **Medical screening**: Member/Prospect picker on Add Record, a **Self-recorded**
  badge, and an audit event for every view of screening records.
- **Public portal and PayPal**: portal limits shared across workers; a daily task
  catches PayPal payments the webhook missed.
- **Desktop density**: with a mouse, icon buttons are 36px and switches a 24px pill
  (still 44px on phones and touch screens); long event, store and cohort titles get
  more room.

### Security review results

Training core (one MEDIUM flagged: `POST /training/enrollments` can create a
duplicate active enrollment), training extended (one MEDIUM fixed: an officer could
credit themselves for a missed cohort class), skills testing, compliance, admin hours
and grants & fundraising (no fixes needed). The new knowledge-test code has not had
its own security pass yet.

## Recent changes: October 5 – 6, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-5--6-2026).
Predecessor: [October 4 – 5](#recent-changes-october-4--5-2026).

**The headline:** member badges now carry a **server-issued code** and ID cards
print on a plastic-card printer; **finance approvals go to the named approver**;
a **finalized event can finally be edited**; and **compliance figures were
re-aligned** so the dashboard, the matrix and the annual report agree — which
moves some departments' percentages.

### Read this first

**If you administer a department or run the server:**

- **Run the normal upgrade.** Seven migrations land (head `15802f3df5c4`, a
  merge). Downgrading `ad3b979746f1` discards issued badge codes, so printed
  badges would stop scanning.
- **Compliance percentages may change.** Members that nothing grades now show
  **N/A** and leave every percentage; the Department Compliance card and the annual
  report use compliance profiles like the matrix; a requirement scoped by role now
  matches **rank**; a certification requirement no longer credits a course that
  merely contains its name (requirements that already exist keep name matching for
  records up to the upgrade day). Stored annual reports keep their old figures.
- **Shift Compliance grades only shift-credited requirements.** SHIFTS
  requirements are credited automatically; an HOURS requirement drops off the report
  until an officer ticks **Shift Credit** on it.
- **Finance approval steps now enforce who may approve.** Check **Finance →
  Approval Chains** for a step flagged as one nobody can act on; an approvals admin
  can override with a written reason.
- **Badges:** every member gets a random badge code. Old badges (membership number,
  short id, old QR) keep scanning until an officer turns off **Accept old badges**.
  Printing a badge needs `members.manage` or `members.manage_id_cards`.
- **Certificate files from self-reported training** can expire: set a retention
  period under **Review Submissions → Settings → Certificate Files** (minimum 90
  days). Nothing is deleted until you choose one.
- **Proxy limits were raised** (400 connections, 50 requests/second with a queue)
  because one dashboard load could lose requests behind a shared station address.
  If you customized `nginx.conf`, compare it.

**If you train or schedule people:**

- **Exchange With a Member** (My Shifts): both members must be cleared for each
  other's seat; a pair that lapsed while pending can still be approved with
  **Approve anyway**. The dashboard says **Not eligible** instead of offering Sign Up.
- **Cohorts:** **Add member** on the Roster tab, then decide each class a late joiner
  missed — credit it or schedule a make-up. Shifting or cancelling a cohort is now
  all-or-nothing.
- **Effectiveness tab:** **Submit Evaluation**. **Skills Testing:** records are paged
  and the CSV export needs a date range of up to a year.
- **Review Submissions / My Training:** pending records stay visible; imports name the
  bad row and value.

**If you edit events:**

- A **finalized event can be edited from the edit form.** Only a change to a locked
  field (type, category, schedule, check-in rules) is refused; the form says which
  and how to unlock them.

**If you use a phone or station computer:**

- Offline items are sent only under the member who queued them; items queued before
  the upgrade are held with **Send as me** / **Discard**.
- A sign-out that the server never confirms blocks the screen until it is retried.
- Two tabs refreshing together no longer sign a member out everywhere.
- Members and Inventory admin pages fit a phone (no double margin; Items filters
  behind a **Filters** button).

**Emails changed:** low stock says "at or below reorder point"; certification alerts
say "Expires Today / Tomorrow"; the weekly supply alert is **Supplies to Replace** with
a **Status** column; five more emails fit a phone. A failed end-of-shift email is
retried, and failed scheduled tasks now show in **Error Monitoring**.

### Engineering notes

| Area       | Note                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Badges     | `users.badge_code` via `/member-badges` (`GET`, `reissue`, `resolve`); never in roster/export responses. CR80 PDFs via `/member-id-cards/{layout,pdf}`. |
| Finance    | `finance_approver_matching.py` is the single authority; `approver-coverage` report; 403 on mismatch; override reason audited.                           |
| Compliance | `ComplianceGrading` / `classify_standing` are the one definition; `not_applicable` standing; `name_match_until`; `shift_credited`.                      |
| API paging | `GET /training/records` `skip`/`limit` + `X-Total-Count`; skills-testing `/tests` → `{items,total}`.                                                    |
| Errors     | New `LB-AUTH-012` (409, refresh superseded) and `LB-SCHED-002` (exchange qualification).                                                                |
| Security   | Integration senders DNS-pinned (SSRF); Google Calendar capped at 10 MB.                                                                                 |

### Reviews in this window

Security review (0 fixes unless noted): finance-approvals (1 fix), users-
organizations, elections-ballots, membership-pipeline (1 fix), medical-screening,
documents-legal, inventory, facilities, apparatus-nfc, equipment-check-shifts,
scheduling, events-requests. App review: dashboard pass 3 (7 fixes), locations &
kiosk pass 3 (6 fixes), medical screening pass 5 (2 fixes), apparatus pass 5 (2 fixes).

### Where to read more

[Module-Training](Module-Training) · [Module-Scheduling](Module-Scheduling) ·
[Module-Events](Module-Events) · [Member-ID-Cards](Member-ID-Cards) ·
[Module-Compliance](Module-Compliance)

## Recent changes: October 4 – 5, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-4--5-2026).
Predecessor: [October 3 – 4](#recent-changes-october-3--4-2026), and the wider
[September 24 – October 4](Recent-Changes-2026-09#recent-changes-september-24--october-4-2026) page.

**The headline:** members can **go by a preferred name**, **shift reports** got
clearer ownership and department totals behind a new permission, and a
**training bug that silently withheld credit** from multi-category requirements
is fixed — with a one-time repair script. Nothing moved address.

### Read this first

**If you administer a department or run the server:**

- **Run three migrations** with the normal upgrade. They are safe on a populated
  database. Downgrading the last one (`34d3d56d1479`) discards preferred names.
- **Repair missed training credit once.** A requirement tagged with two or more
  categories never advanced from a finalized session or an imported record.
  New completions are now correct; credit already missed needs
  `scripts/backfill_category_requirement_credit.py` (dry run first, then
  `--apply`; it keeps a rollback file and sends no notifications). Percentages
  move once, upward. See `UPGRADING.md`.
- **Department-wide shift-report totals need `training.view_analytics`.** It is
  given to the Chief, Deputy Chief and Assistant Chief ranks and the President and
  Training Officer positions. Captains and lieutenants see only their own reports
  under **Written by me**; grant the permission if a role should see more.
- **Editing a role with a wildcard now saves.** Roles holding `*` (IT Manager) or
  a `module.*` grant failed with "Failed to update role" on any change.
- **Printing a member badge through the label API** needs `members.manage` or
  `members.manage_id_cards`. The Print Badges button already did.

**If you train or schedule people:**

- **Preferred name.** Members set it under **My Account → Account**; officers on
  **Admin Edit** or **Add Member**. The shift board, directory, messages,
  notifications, the ID card, meeting-minute attendance, the photo-consent roster
  and medical screening records show it; reports, exports, training records,
  certificates, ballots, legal documents and the audit log keep the legal name.
- **Shift reports.** A member cannot write a report about themselves. **File Shift
  Report** on a finished shift is the **Shift Officer's**; leadership uses
  **Shift Reports → New report**. An optional setting, **Reports are filed by the
  officer on the rig**, restricts filing to that officer department-wide. The
  report list gains per-member **Calls Responded**.
- **One call-type list.** Training requirements and pipelines pick **Call types
  that count** from the department list in Scheduling settings, and the call log's
  incident type uses the same list, so "mva" and "Motor Vehicle Accident" no
  longer credit differently.
- **Close-out wizard.** Type **Hours** for a member who forgot to check in or out
  (up to 48), or choose **Until shift end** / **Full shift**.

**If you use a phone or tablet:**

- Administration hub pages now sit on the same page margin as every other screen
  (they were indented twice as far).
- The date-and-time picker fits at 320px; stat tiles wrap their labels instead of
  cutting them off; Training Administration tabs fit a phone.
- Alert text in the light theme is darker (AAA contrast), and primary action
  buttons that were blue are the app's red.
- The weekly **expiring supplies** email now has three columns that fit a phone.
- Four Inventory pages and 16 hub tabs show a failed-load message instead of a
  blank error screen when the server returns something unexpected.

### Engineering notes

| Area                | Note                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`              | `display_name` (preferred else first + last) for everyday screens; `full_name` stays legal. Anonymizing clears `preferred_name`.                                   |
| JSON array matching | `app/utils/json_ids.json_array_contains` replaces `column.contains([id])`, which was a `LIKE` on serialized JSON. A SQLAlchemy deprecation now fails the test run. |
| Call types          | `app/utils/call_type_matching.py` resolves slug, label or legacy text to one type.                                                                                 |
| Roles               | `invalid_permission_grants()` accepts what `permission_matches` resolves; the rejection names at most five grants.                                                 |
| CI                  | Playwright E2E is split by weight; sweep budgets come from measured runs.                                                                                          |

### Reviews in this window

Security review (all 0 fixes): auth-session, cross-cutting, frontend-shared,
permissions-roles, public-webhooks, storefront-payments. App review: member
lifecycle (2 fixes, 1 flagged), platform ops pass 3 (4 fixes, 2 flagged).
Workflow review: Action items, Documents, org chart and legal documents.

### Where to read more

[Module-Training](Module-Training) · [Module-Scheduling](Module-Scheduling) ·
[Role-System](Role-System) · [Member-ID-Cards](Member-ID-Cards)

## Recent changes: October 3 – 4, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10.md#change-audit-october-3--4-2026).
Predecessor: [September 15 – 23](Recent-Changes-2026-09#recent-changes-september-15--23-2026). **The
September 23 – October 3 window has no handoff page yet** — this one covers the
last 25 hours only.

**The headline:** a department can finally **raise a training standard without
failing its whole roster**, **probationary members can sign in**, and a long
tablet and phone layout pass made controls visible and tappable that were not.
Nothing moved address.

### Read this first

**If you administer a department:**

- **Probationary accounts can now sign in and be scheduled.** They used to be
  refused as _"Account is inactive"_. If you kept a probationary account out on
  purpose, set it to Inactive or Suspended; to stop shift self-signup only,
  exclude the membership type in Scheduling settings.
- **Training requirements can exempt existing members.** The requirement form has
  an **Existing Members** section — _Apply to everyone_, _Exempt existing
  members_, or _Give a catch-up deadline_ — and editing a requirement asks
  whether the change reaches **Everyone** or **New members only** (the original
  stays for members who joined before the date; a copy carries the change).
  Nothing changes until you set a cutoff.
- **Percentages may move once.** Dashboard, Compliance Matrix and member status
  now honour role-scoped requirements, and exports print **N/A** where a
  requirement does not apply.
- **Duplicate scheduled reminders stop** on multi-worker deployments (CRON-40).

**If you train or schedule people:**

- Adding a requirement to a training program asks whether **members already
  enrolled** are held to it or recorded as **waived**.
- Shifting a course cohort across a daylight-saving change keeps the class at
  its local time (19:00 stayed 19:00); a shift that includes a finalized class is
  refused before anything moves.

**If you are a crew member or officer:**

- A **Fail** or **Out of service** on an equipment check now needs a note, and
  Overall Notes no longer covers a third of a phone screen.
- On an iPad, the edit, delete and download buttons are **visible** (they were
  hidden until hover). Event roster buttons are 44px on a phone.

### What changed

| Area             | Change                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Training         | Existing-member exemption / catch-up / new-members-only split; program waiver for enrolled members; status **Due** for catch-up (blue on the scheduling report); audited                                                                 |
| Membership       | Probationary counts as active for sign-in, shifts, rosters, targeted messages                                                                                                                                                            |
| Equipment checks | Failed item needs a note; one submit confirmation; Fleet Readiness agrees with My Checklists; builder lists real vehicle types, names which vehicles it reaches, and warns when it unpublishes a live checklist; failure-log total fixed |
| Courses          | Cohort shift is DST-safe and refuses a finalized class up front                                                                                                                                                                          |
| Locations        | `GET /locations/{id}/display` redacts the event description like its public sibling                                                                                                                                                      |
| Platform         | Scheduler claim renewed only while held; `organizations.active` has a server default                                                                                                                                                     |
| Layout           | Settings screens full-width on phones; Training Setup and compliance rules fit 320px; tablet hover-only actions visible; selected toggles red; one bordered card everywhere                                                              |
| Accessibility    | Contrast fixes on Import History and compliance status words; hub headline-metrics switch has an accessible name; heading levels no longer skip                                                                                          |

### Screenshots to create or replace

See `docs/training/SCREENSHOT_CURRENCY.md` in the repository. New: the
**Existing Members** section, the **who does this change reach** dialog, the
program **Members already enrolled** choice, the template builder's readiness
panel and unpublished banner, the failed-item note prompt. Replace: every phone
and tablet shot of settings screens, Training Setup, the event roster, and any
screen that used a blue selected tab.

### Known and open

- **Course cohorts, CC-7:** shifting from a sequence reaches classes that already
  happened; whether an officer may move a delivered class is a product decision
  (see `KNOWN_LIMITATIONS.md`).
- **Scheduled tasks, CRON-40** is closed by this window's fix; the broader
  scheduler findings stay on the security-review tracker.
