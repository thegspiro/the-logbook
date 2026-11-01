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
| W30 | Log a shift and file a shift report                                   | training_officer → member | `/training/log-shift`                              | ✅     |
| W31 | The learning center orientation                                       | member                    | `/learning`                                        | ✅     |

## Tier 5 — Scheduling

| #   | Activity                                                           | Acts as                     | Starts at                                                   | Status |
| --- | ------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------- | ------ |
| W32 | Shift templates and patterns, then generate a month of shifts      | scheduling_officer          | `/scheduling/admin/planning/*`                              | ✅     |
| W33 | Sign up for a shift, swap it, request time off                     | member, member2 → officer   | `/scheduling`                                               | ✅     |
| W34 | Check in to a shift by apparatus QR, and close the shift out       | member → scheduling_officer | `/scheduling/checkin`, `/scheduling/admin/closeout`         | ✅     |
| W35 | Platoons and the position qualification roster                     | scheduling_officer          | `/scheduling/admin/platoons`, `/scheduling/admin/positions` | ✅     |
| W36 | Every scheduling settings section                                  | scheduling_officer          | `/scheduling/admin/settings/*`                              | ✅     |
| W37 | Scheduling reports and the printed check-in sheet and shift report | scheduling_officer          | `/scheduling/admin/reports`                                 | ✅     |

## Tier 6 — Inventory and equipment

| #   | Activity                                                                     | Acts as                     | Starts at                                                  | Status |
| --- | ---------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- | ------ |
| W38 | Set up inventory: categories, then add items of each tracking kind           | quartermaster               | `/inventory/admin/setup`, `/inventory/admin/items`         | ✅     |
| W39 | Issue equipment to a member, the member sees it, return it                   | quartermaster → member      | `/inventory/admin/members`, `/inventory/my-equipment`      | ✅     |
| W40 | Pool items, checkouts, kits and variant groups                               | quartermaster               | `/inventory/admin/pool`, `/inventory/checkouts`            | ✅     |
| W41 | A member's request, return, write-off and reorder, and the approvals         | member → quartermaster      | `/inventory/admin/requests`, `/inventory/admin/returns`    | ✅     |
| W42 | Maintenance records, vendors, charges and issuance allowances                | quartermaster               | `/inventory/admin/maintenance`, `/inventory/admin/charges` | ✅     |
| W43 | Storage areas, barcode labels and CSV import                                 | quartermaster               | `/inventory/storage-areas`, `/inventory/import`            | ✅     |
| W44 | NFC: tag in bulk, put away, shelf audit, items not seen                      | quartermaster               | `/inventory/admin/nfc/*`, `/inventory/shelf-audit`         | ✅     |
| W45 | The self-service kiosk                                                       | member                      | `/inventory/kiosk`                                         | ✅     |
| W46 | Equipment checks: build a checklist, perform a check, fleet board, check log | scheduling_officer → member | `/inventory/admin/checklists`, `/inventory/checklists`     | ✅     |
| W47 | Medical supplies                                                             | quartermaster               | `/medical-supplies`                                        | ✅     |

## Tier 7 — Apparatus and facilities

| #   | Activity                                                          | Acts as | Starts at                                | Status |
| --- | ----------------------------------------------------------------- | ------- | ---------------------------------------- | ------ |
| W48 | Add an apparatus, edit it, read its detail, print its labels      | admin   | `/apparatus`, `/apparatus/new`           | ✅     |
| W49 | Facilities: a facility, its maintenance, inspections and settings | admin   | `/facilities`, `/facilities/maintenance` | ✅     |

## Tier 8 — Governance and communication

| #   | Activity                                                              | Acts as            | Starts at                                          | Status |
| --- | --------------------------------------------------------------------- | ------------------ | -------------------------------------------------- | ------ |
| W50 | An election: create, nominate, vote by ballot link, close, results    | secretary → member | `/elections`, `/ballot`                            | ✅     |
| W51 | Meeting minutes: draft, approve, publish                              | secretary          | `/minutes`                                         | ✅     |
| W52 | Action items: assign, work, close                                     | secretary → member | `/action-items`                                    | ✅     |
| W53 | Documents: folders, upload, who can see what                          | secretary, member  | `/documents`                                       | ✅     |
| W54 | Org chart and legal documents                                         | admin, member      | `/governance/org-chart`, `/governance/legal`       | ✅     |
| W55 | Messages: send to a group, the member's inbox, message administration | admin → member     | `/communications/messages`, `/messages`            | ✅     |
| W56 | Notification rules and logs, the in-app bell                          | admin, member      | `/notifications`                                   | ✅     |
| W57 | Email templates: edit, preview, restore                               | admin              | `/communications/email-templates`                  | ✅     |
| W58 | Suggestion boxes and suggestions                                      | member → admin     | `/suggestions`, `/communications/suggestion-boxes` | ✅     |
| W59 | Photo-use consent                                                     | member, admin      | `/communications/photo-use-consent`                | ✅     |
| W60 | Forms: build, publish a public form, submit it, read submissions      | admin → anonymous  | `/forms`, `/f/:slug`                               | ✅     |

## Tier 9 — Money

| #   | Activity                                                               | Acts as                   | Starts at                                                        | Status |
| --- | ---------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- | ------ |
| W61 | Budgets                                                                | treasurer                 | `/finance/budgets`                                               | ✅     |
| W62 | Approval chains and finance settings, including the emailed approval   | treasurer                 | `/finance/settings/approval-chains`, `/finance/approvals/:token` | ✅     |
| W63 | A purchase request through its approval chain                          | member → treasurer, chief | `/finance/purchase-requests/new`                                 | ✅     |
| W64 | An expense report, from receipt to reimbursement                       | member → treasurer        | `/finance/expenses/new`                                          | ✅     |
| W65 | Check requests                                                         | treasurer                 | `/finance/check-requests`                                        | ✅     |
| W66 | Dues: set them, record a payment, who is behind                        | treasurer                 | `/finance/dues`                                                  | ✅     |
| W67 | The department store: shop, check out, my orders, store administration | member → quartermaster    | `/store`, `/inventory/admin/store`                               | ✅     |
| W68 | Grants: an opportunity, then an application through to its report      | treasurer                 | `/grants/opportunities`, `/grants/applications`                  | ✅     |
| W69 | Fundraising: campaigns, donors, donations, reports                     | treasurer                 | `/grants/campaigns`, `/grants/donations`                         | ✅     |

## Tier 10 — Everything else

| #   | Activity                                                                  | Acts as          | Starts at                                  | Status |
| --- | ------------------------------------------------------------------------- | ---------------- | ------------------------------------------ | ------ |
| W70 | Administrative hours: clock in and out by QR, manage categories and hours | member → admin   | `/admin-hours`, `/admin-hours/manage`      | ✅     |
| W71 | Medical screening                                                         | admin            | `/medical-screening`                       | ✅     |
| W72 | Reports                                                                   | admin, chief     | `/reports`                                 | ✅     |
| W73 | Integrations                                                              | admin            | `/integrations`                            | ✅     |
| W74 | IP security, and a member's access request                                | member → admin   | `/ip-security/my-requests`, `/ip-security` | ✅     |
| W75 | Audit log, error monitoring and analytics                                 | admin            | `/admin/audit-log`, `/admin/errors`        | ✅     |
| W76 | Public portal and the public pages                                        | admin, anonymous | `/admin/public-portal`, `/`, `/privacy`    | ✅     |
| W77 | The testing module and its printed report                                 | admin            | `/testing`                                 | ✅     |
| W78 | Platform administration                                                   | admin            | `/admin/platform-analytics`                | ✅     |
| W79 | Phone pass: W08, W19, W24, W33, W39 and W70 again at 390×844              | member, officers | as those rows                              | ✅     |

---

## Leads from earlier browser passes

Seen while building this harness or in the ad-hoc browser pass of 2026-09-27,
and not yet confirmed or fixed. The run for each activity starts from these.

- **Reports and inventory activities** — three `DialogPanel` dialogs have no
  `role` on the panel or a wrapper: the report viewer, and
  InventoryScanModal's confirm and custody-transfer dialogs (W14-2). The
  inventory pair sits inside another modal; check its tests' dialog queries
  when changing it.
- **Any run touching the app shell, or an accessibility activity** — every
  page carries two "Skip to main content" links, one in `index.html` and one
  in `AppLayout` (W20).

- **Dashboard, or any activity touching a module left off at setup** — on a
  fresh install with every module skipped, the administrator's first dashboard
  asked `GET /training/module-config/config` and was refused `403 LB-ORG-002`
  ("module is not enabled"). The weather and `/integrations/connected` half of
  this lead was fixed in the W01 third pass (W01-33); the training call was not
  seen there, because that install had Training on.
- **Any run touching the app shell** — nothing keeps `TopNavigation` and
  `SideNavigation` in step. W55-1 found the inbox, the suggestion box and the
  whole Forms & Comms admin group present only in the side layout. A test
  comparing the two link sets would catch the next one (W55).
- **Any run that merges `main`** — two pull requests that each join the same
  Alembic fork leave two heads, and nothing starts until a merge revision
  joins them (W59-1). Run `alembic heads` after a merge that brings in
  migrations.
- **W33 / W34** — the shift-assignment notice names the equipment checklists
  but opens the schedule rather than My Checklists, and prints the shift date
  as `2026-09-30` (W46-16).
- **W50 follow-up** — the election meeting-link → Import Attendees → unlink
  round trip could not be driven in W50. W51 left a business-meeting event for
  it: "W51 October Business Meeting (event)", 1 Oct 7:00 PM, linked to the
  second set of October minutes. The "link survives a clear" half of W50-60 is
  still read from code only.
- **Documents, a later pass** — a document's type shows as a raw MIME type
  ("TEXT/PLAIN") in the list (W53-6).
- **Minutes, a later pass** — the meetings list badges every meeting "Draft"
  forever (W51-9).

- **Fundraising, a later pass** — the Donations list has a Receipt column
  but nothing sends a receipt or marks one sent, and donors, donations and
  campaigns (beyond status and restriction) have no edit control though
  their `PUT`s now work (W69).
- **Grants, a later pass** — budget lines and expenditures have update and
  delete endpoints but no control on the detail page, and a compliance task
  cannot be given an assignee when it is created (W68).
- **Admin hours, a later pass** — scanning a second category's QR code while
  clocked in is refused, but the page neither names the running session nor
  offers its Clock Out (W70-5).
- **Reports, a later pass** — every renderer prints its period and row dates
  as ISO strings (`2026-01-01 — 2026-12-31`), unlike the rest of the app
  (W72-4).

- **Integrations, a later pass** — the `integration.connected` and
  `integration.disconnected` audit rows carry no IP address (W75).

- **Public portal, a later pass** — public events are only `public_education`
  events, and their location is the free-text `location` alone, so an event
  placed at a facility (`location_id`) would publish no location; read from
  code, not driven (W76).

- **Tooling** — a full `npm run lint` needs about 3.5 GB of heap (2,350
  files with type-aware rules). It aborted out of memory under the 2 GB default
  of the W77 container and passed with `--max-old-space-size=8192`. CI's
  `ubuntu-latest` default is larger, but the margin is thin (W77).

- **Platform analytics, a later pass** — the other "last 30 days" figures
  (events, forms, documents, new users) are still a rolling `now - 30 days`,
  while the two charts and their totals are now whole local days; read from
  code (W78).

## Log

### Lead — Reflow table cells a phone hid — 2026-11-01

Driven as: `admin` at 390×844. Fixed: every body cell of a `rwd-table` with no
`data-label` is hidden below 768px, which took the row actions off the
QuickBooks mapping tables and the pledges list, and every cell of the documents
list view (a document row rendered as an empty card). Those cells now carry
labels, and `rwdTableLabelIntegrity.test.ts` fails on the next unlabeled body
cell, allowing only the inventory desktop actions cell (a phone gets its own)
and the decorative bar in My Hours. Finance Reports, named in the lead, was
clean: its unlabeled cells are in tables that do not reflow or in totals rows,
which the rule leaves alone. Re-driven: the QuickBooks "Add a mapping", the
pledge's Edit and a document's name, size, type and date all show on a phone;
without the fix the document row showed nothing. Gate: typecheck and lint
clean, and the tests for the changed pages pass.

### Lead — The dashboard asked two modules that were off — 2026-10-31

Driven as: `admin` at 1280×900, with Integrations and Training switched off
over `PATCH /organization/modules` and back on afterwards. Fixed: the
dashboard's severe-weather banner asks only while Integrations is on, and the
side and top navigation and the command palette ask for the practical-skills
setting only while Training is on (`usePracticalSkillsMethod` takes the module
check from its caller; Training's own pages are behind its route gate already).
Without the fix the dashboard sent three requests and all three were refused
`403 LB-ORG-002`; with it, the dashboard, Events and the phone layout sent none.
With the modules back on, both requests were sent again and answered. Gate:
typecheck and lint clean; the 281 test files related to the changed files pass,
and every new test fails without the fix.

### W01 third pass — Onboarding options and wording, as an IT manager — 2026-10-31

Driven as: a fresh install, twice (find, then re-drive), anonymous → system
owner, at 1280×900, in the review database only. Covered what the first two
passes left out: every option on every step against what the app did after
(stored rows, first sign-in, navigation, Settings), the email and storage
configuration forms, the logo upload, and the sign-in choice on a server with
no SSO client. Held: organization and logo stored as entered, member numbering,
IT-contact accounts without duplicates, seat lists, the SMTP test's error, and
W01-11 (choosing an unconfigured provider keeps passwords and reset; now
resolved). Fixed: W01-17 to W01-22, W01-25, W01-26, W01-28 to W01-33. One
HIGH (W01-29: the OneDrive card and page said files would be stored in
OneDrive; nothing reads that choice), now worded truthfully; the limitation
stands per the owner's 2026-10-08 decision. Flagged: W01-23 (MED, Mobile App
Access has no reader), W01-24 (LOW, onboarding turns Public Information off
without offering it), W01-27 (LOW, email settings that failed their test are
saved without a word). Resolved the dashboard lead's integrations half
(W01-33). Gate: typecheck and lint clean, every new test seen failing first,
the full frontend suite passes, flake8 and black clean on the two backend files.
Follow-up 2026-11-01: owner decided W01-23, and Mobile App Access is removed
from onboarding and Settings (the stored field is kept, retired). Owner decided
W01-27: a failed email test now warns on the page and Continue asks before
saving, but saving is allowed.

### Membership re-check (W08, W10–W15) — 2026-10-31

Driven as: `admin`, `member` and `member2` on a fresh install, at 1280×900 and
390×844. Held: every admin route and mutation refused for `member`, and contact
data redacted from colleagues. Add member saved exactly one record on a double
click. Clearing date of birth and phone saved the clear. The class and status
filters and search found the edited member. The audit history recorded the edit.
Waiver date validation worked. Deactivate worked through the step-up prompt.
Nothing overflowed on a phone. Fixed: MR-1 (MED — the profile called future and
expired leaves "Active"; it now shares the Waivers screen's rule) and MR-2 (LOW —
the directory fired a refused tier-config request for every member). Flagged:
MR-3 (LOW — members see built-in tier names; mirrored to KNOWN_LIMITATIONS),
MR-4 (LOW — profile views crowd the audit history) and MR-7 (NIT — an unused
membership store). MR-5 and MR-6 (NIT) were fixed in a 2026-11-01 follow-up. Gate: typecheck and lint clean;
lint needed a larger Node heap with the harness running. The touched suites
pass. See W10-W15-membership-recheck.md.

### W01 follow-up — The open onboarding findings — 2026-10-31

Driven as: a fresh install, three times, at 390×844 (the review database only,
reset with `start.sh --reset` and seeded again afterwards). Fixed: W01-12 (owner
decision: refuse a backup email equal to the administrator's), W01-13 (measured
again first; every control under 44px on Modules, Ranks & Positions and
Apparatus, and the four more the drive found on the administrator, IT Contacts
and setup-complete steps and Reset Progress, now take `touch-target-phone`),
W01-14 (the Create button, and Reset Progress, are named by their visible
words), W01-15 (a failed Continue on Organization Setup focuses the first invalid
field) and W01-16 (Stations has Back). Re-driven: every onboarding step measures
clean at 390px, and `seed.mjs` onboards with the renamed button. New lead: the
first dashboard asks two disabled modules and is refused. Gate: typecheck and
lint clean, and the onboarding tests and the tests related to the changed files
pass.

### W08-6 follow-up — Requests held while a password change is required — 2026-10-25

Driven as: a member created by `admin` and signed in on the forced-change
screen, at 1280×900. Fixed: W08-6. The two axios clients now hold every
request outside the server's allowlist while `must_change_password` is set,
answering it with the server's own `403 LB-AUTH-004`, and the error reporter
skips that refusal. Refused requests on the screen fell from 24 (nine of them
`POST /errors/log`) to 0. The change itself, the sign-out it forces and the
next sign-in sent 57 requests, none refused. Not covered: an expired password
past its grace period, which the client cannot see until the server refuses a
request; those refusals are no longer reported. Gate: typecheck and lint clean,
and the tests related to the six changed files pass.

### W79 — Phone pass: W08, W19, W24, W33, W39 and W70 at 390×844 — 2026-10-23

Driven as: anonymous, `admin`, `member`, `training_officer`,
`scheduling_officer`, `quartermaster` and a newly added member, all at 390×844.

Held:

- all six flows complete on a phone, each double-click acting once;
- every result was read back from the other role or after a reload.

Fixed:

- W79-2 (MED — Admin Hours management was 929px wide).
- W79-3 (MED — Pending Review's actions were off-screen).
- W79-9 (MED — the checklist builder's section heading was 18px wide;
  W46-18's small controls).
- W79-1 (LOW — sign-in, forgot-password and legal links; W02-5, W03, W54-6).
- W79-4 (LOW — event page controls).
- W79-5 (LOW — My Training status codes).
- W79-6 (LOW — training review controls).
- W79-7 (LOW — scheduling controls and names).
- W79-8 (LOW — inventory links and the confirmation wording).

Flagged: W79-10 (LOW — the inventory dashboard's attention tile and queue
disagree).

Still open: W08-6, now 25 refused requests; W01-13, not drivable.

Gate: typecheck clean; lint clean with an 8 GB heap; 1,061 tests across the
touched pages pass.

Next: none. W79 was the last activity of the rotation.

### W78 — Platform administration — 2026-10-22

Driven as: `admin` at 1280×900 and 390×844, and `member` for access.

Held:

- members are refused on the page and the API;
- user, module and error totals match the data;
- the export names the local date.

Fixed:

- W78-1 (MED — the trends ended on the previous UTC day and missed
  everything since UTC midnight).
- W78-2 (LOW — every module was badged Enabled).
- W78-3 (MED — both charts drew 0px bars, and the counts were tooltip-only).

Flagged: none.

Gate: typecheck clean; lint clean with an 8 GB heap; 2 frontend and 26
backend tests pass.

Next: W79.

### W77 — The testing module and its printed report — 2026-10-22

Driven as: `admin` and `member` at 1280×900 and 390×844.

Held:

- members are refused the admin actions on screen and through the API;
- marks and notes survive a reload and reach the admin's combined view;
- an archived run is read-only;
- the report, CSV and Markdown agree with the page;
- both clears ask first, and the department-wide one is audited.

Fixed:

- W77-1 (MED — recording a correct refusal as Pass was reported as a
  permissions defect, and nothing said to mark it Blocked).
- W77-2 (LOW — another tester's note was tooltip-only).
- W77-3 (LOW — the Markdown summary dropped "to confirm" and printed
  "(s)").
- W77-4 (LOW — Clear everyone counted 0 testers).
- W77-5 (LOW — both pages scrolled sideways at 390px).

Flagged: none.

Gate: typecheck clean; lint clean with an 8 GB heap (it runs out of memory at
this container's 2 GB default); 110 testing-module tests pass.

Next: W78.

### W76 — Public portal and the public pages — 2026-10-21

Driven as:

- anonymous: the home, privacy and terms pages signed out, and the public API
  with no key, an unknown key, a live key, a revoked key, and the portal
  disabled;
- `admin` at 1280×900 and 390×844: enabling, keys, Data Control, the rate
  limit, access logs, statistics, revoking and disabling.

Held:

- nothing is published until a field is enabled, and then only that field;
- members-only events stay private;
- every refusal answers with its reason;
- double-clicks act once.

Fixed:

- W76-1 (MED — each Data Control switch moved the list under the pointer,
  and the next tap enabled the wrong field).
- W76-2 (MED — the station address was never published when it matched the
  mailing address).
- W76-3 (LOW — Disable Portal did not ask).
- W76-4 (LOW — the access log hid refusal reasons and overstated what it
  lists).
- W76-5 (LOW — duplicate switch names, unnamed revoke buttons, a placeholder
  host).

Flagged: W76-6 (LOW — three statistics fields can be enabled but always
publish null).

Gate: typecheck and lint are clean; 58 public-portal frontend tests and 154
backend portal tests pass.

Next: W77.

### W75 — Audit log, error monitoring and analytics — 2026-10-20

Driven as: `admin` at 1280×900 and 390×844, with one deliberate failed
sign-in for `member2`.

Held:

- search, the event-type filter and the totals agree;
- sign-in, failure and sign-out now reach the audit log (W02-3 resolved);
- "system" appears only for a row with no actor (W50-45 resolved);
- Clear All asks first.

Fixed:

- W75-1 (MED — the category filter offered only the ten busiest categories).
- W75-2 (LOW — "Activity by Hour" charted the UTC hour).
- W75-3 (LOW — a desktop audit row could not be opened from the keyboard).
- W75-4 (LOW — Error Monitoring's filter label and detail buttons).

Flagged: none.

Gate: typecheck and lint are clean; 19 frontend and 396 backend tests pass.

Next: W76.

### W74 — IP security, and a member's access request — 2026-10-20

Driven as:

- `member` filing requests, with bad input, a bad address and a good one, and
  reading the outcome at 390×844;
- `admin` approving and rejecting from the queue, and approving their own
  request.

Held:

- Submit waits for the required fields;
- double-clicks file and approve once;
- members are refused the admin page and endpoints;
- rejection needs a reason.

Fixed:

- W74-1 (MED — any string was queued as an address, and none but an exact
  canonical address could ever match).
- W74-2 (MED — a refused request wiped the member's justification).
- W74-3 (MED — the admin approved without seeing the member, the reason or
  even the address).
- W74-4 (LOW — raw status codes; no rejection reason for the member).

Flagged: W74-5 (LOW — an admin can approve their own exception).

Gate: typecheck and lint are clean; 47 IP-security frontend tests and 64
related backend tests pass.

Next: W75.

### W73 — Integrations — 2026-10-17

Driven as:

- `admin` connecting, testing and disconnecting iCalendar, connecting Slack
  with bad and unresolvable URLs and with no config, and disconnecting it
  through the new confirmation at 390×844;
- `chief`, `secretary` and `member` for access.

Held:

- a double-clicked Connect makes one connection;
- bad webhook URLs are refused;
- only `integrations.manage` holders manage the page;
- members see on/off state only.

Fixed:

- W73-1 (MED — Disconnect acted on one tap, including Claude (MCP)'s, which
  revokes every key).
- W73-2 (LOW — card buttons all read "Connect" / "Disconnect").
- W73-3 (LOW — an empty-config connect left Slack connected with no
  webhook).
- W73-4 (LOW — the messaging webhook field had no label).

Flagged: W73-5 (MED — iCalendar is a switch with no reader).

Environment: the sandbox has no outbound DNS, so no integration that needs
a real service was driven past its URL check.

Gate: typecheck and lint are clean; 49 integrations frontend tests and 121
integration and MCP-key backend tests pass.

Next: W74.

### W72 — Reports — 2026-10-16

Driven as:

- `admin` generating all thirteen reports, the Admin Hours report on the page
  with its CSV, and a saved report;
- `chief` (`reports.view` without `admin_hours.manage`) on the page and the
  report viewer at 390×844.

Held:

- every report generates;
- Admin Hours totals match the admin-hours summary;
- CSV export;
- a double-clicked save records once;
- the server refuses what the caller's permissions do not cover.

Fixed:

- W72-1 (MED — the page offered reports `/available` would have hidden, and
  the catalog never listed Admin Hours, so it could not be hidden or saved).
- W72-2 (MED — the Admin Hours report dated evening entries by their UTC
  day).
- W72-3 (LOW — "Qr Scan", unnamed Run / Edit on saved reports, viewer touch
  targets).

Open, as a lead: W72-4 (NIT — ISO dates in every renderer).

Gate: typecheck and lint are clean; 74 reports frontend tests and 1,109
report-related backend tests pass.

Next: W73.

### W71 — Medical screening — 2026-10-16

Driven as:

- `admin` adding a recurring and a one-time requirement, recording passed
  physicals, reading the Compliance tab, and editing a record at 390×844;
- `member`, `chief`, `membership_coordinator`, `training_officer` and
  `secretary` for access, and `member`'s own dashboard standing.

Held:

- labelled forms, with the inert settings marked "Not enforced yet";
- double-clicks record once;
- the roster grades against every requirement;
- only `admin` can see screenings; five other roles are refused on page and
  API.

Fixed:

- W71-1 (MED — a recurring screening recorded without an expiration never
  fell due; the record form now fills it in from the frequency).
- W71-2 (MED — a record or requirement edit saved, then answered 500).
- W71-3 (LOW — ISO dates and a missing completed date in the lists; record
  buttons not naming the member; 16px Edit / Delete).

Flagged: W71-1's grading half (MED — no-expiration records stay compliant
forever, and records match requirements by type).

Gate: typecheck and lint are clean; 166 medical-screening and date-utility
frontend tests and 88 medical-screening backend tests pass.

Next: W72.

### W70 — Administrative hours: clock in and out by QR, manage categories and hours — 2026-10-16

Driven as:

- `admin` adding categories, opening a QR page, reviewing (approve, reject
  with a reason), the summary, All Entries, the export, and ending a running
  session at 390×844;
- `member` at 390×844 clocking in and out through the QR URL, trying a second
  category while clocked in, logging hours manually, and resubmitting a
  rejected entry.

Held:

- double-clicks record once;
- Chicago times stored as UTC and shown back correctly;
- a second session, a future end and an empty reason are refused with
  reasons;
- review outcomes reach the member;
- summary, list and CSV agree;
- member refused on page and API.

Fixed:

- W70-1 (MED — two active categories could share a name, case-insensitively,
  beside the seeded defaults).
- W70-2 (LOW — category form fields and colour swatches unnamed; identical row
  buttons).
- W70-3 (LOW — Pending Review controls did not say whose entry).
- W70-4 (LOW — raw status codes, unnamed manual-form fields and time pickers,
  retired categories unmarked in the filter, "1 entries", touch targets).

Open, as a lead: W70-5 (LOW — no way out from a second category's clock-in
page).

Gate: typecheck and lint are clean; 121 admin-hours frontend tests and 152
admin-hours backend tests pass.

Next: W71.

### W69 — Fundraising: campaigns, donors, donations, reports — 2026-10-15

Driven as:

- `treasurer` creating campaigns, donors, donations, a pledge and its payment,
  an event, then Reports and the dashboard;
- `secretary` (view), `member` and `quartermaster` (none) for access, with an
  anonymous gift on record;
- 390×844 for every fundraising page.

Held:

- double-clicks record once;
- donations move campaign totals and donor stats;
- Chicago dates and times;
- Reports' totals and method split;
- access and anonymity, on screen and at the API.

Fixed:

- W69-1 (HIGH — every fundraising edit was a 500 and rolled back: campaign,
  donor, donation, pledge, event; the W68 lead).
- W69-2 (MED — a campaign could only ever be Draft: the create dropped the
  status and nothing changed it after; no end date on the form).
- W69-3 (MED — directory donors' gifts read "Unknown"; raw status; a failed
  load read as an empty list).
- W69-4 (MED — "Total Raised (12mo)" always $0: `totalRaised12Mo` on the
  wire).
- W69-5 (LOW — donor form labels, unnamed links and filters, "2026-10",
  silent failure toasts, touch targets).

Flagged: W69-6 (LOW — a business donor must be entered as a person).

Gate: typecheck and lint are clean; 72 grants-fundraising frontend tests and
821 fundraising and grant backend tests pass.

Next: W70.

### W68 — Grants: an opportunity, then an application through to its report — 2026-10-15

Driven as:

- `treasurer` adding an opportunity, starting an application from it, and
  working it through budget, the status lifecycle to Reporting, an
  expenditure, a compliance task, a note, the dashboard and Reports;
- `secretary` (view), `chief` (manage), `member` and `quartermaster` (none)
  for access;
- 390×844 for opportunities, the detail page, the form, the list and the
  budget dialog.

Held:

- the status picker follows the lifecycle;
- awarding creates the inventory task;
- the overspend warning;
- Reports' totals;
- access, on screen and at the API.

Fixed:

- W68-1 (HIGH — no budget line, expenditure, compliance task or note could be
  added: each create schema required a body `application_id` the page never
  sent).
- W68-2 (HIGH — budget categories sent as labels).
- W68-3 (HIGH — Mark Complete, and budget-line and opportunity edits, 500ed
  after the write).
- W68-4 (HIGH — any save with Key Contacts or Budget Summary filled was a
  422).
- W68-5 (MED — "Assigned To" was free text for a member id: dropped on
  create, refused on edit).
- W68-6 (MED — no way to record the award, award date or report dates).
- W68-7 (MED — budget totals read "-"; over-budget compared strings).
- W68-8 (LOW — note type, silent failure toasts, a task due today read
  Overdue, Start Application offered to view-only members, touch targets).

Flagged: W68-9 (LOW — key contacts: text or structured), W68-10 (LOW —
opportunities cannot be edited or retired from the screen).

Gate: typecheck and lint are clean; 64 grants frontend tests and 761 grant
backend tests pass.

Next: W69.

### W67 — The department store — 2026-10-15

Driven as:

- `quartermaster` setting the store up (settings, a sized item with a
  per-member limit, an order window) and working an order through payment
  to fulfilled;
- `member` shopping and checking out;
- `member2` probing, ordering and cancelling;
- 390×844 for the store, My Orders and the console.

Held:

- clear validation on items and windows;
- every double-click records once;
- the payment policy is stated at checkout;
- status changes reach My Orders;
- another member and the admin list refuse a member.

Fixed:

- W67-1 (MED — a per-member limit showed as "Only 2 left" in every size, and
  would have read "Sold out" once reached; offers now carry
  `stock_available`).
- W67-2 (MED — the stepper went past the limit, and the refusal blamed
  stock).
- W67-3 (MED — cancelling an order took one tap).
- W67-4 (LOW — the countdown announced 17 days beside a visible 16).
- W67-5 (LOW — 16–20px checkboxes and back link; unnamed row buttons).

Flagged: W67-6 (LOW — the cart is lost on a reload).

Environment: today's merge needed `nh3` and `npm ci` before the schema and
typecheck would build.

Gate: typecheck and lint are clean; 207 storefront frontend and 416
storefront backend tests pass.

Next: W68.

### W66 — Dues: set them, record a payment, who is behind — 2026-10-14

Driven as:

- `treasurer` creating two schedules, generating dues, recording payments,
  waiving, and reading the history;
- `member` probing for their own dues;
- 390×844 for the dues page and the payment dialog.

Held:

- labelled dialogs with clear validation;
- generation confirms and skips members already billed;
- every double-click records once;
- a waiver needs a reason, and the treasurer cannot waive their own;
- a member gets 403.

Fixed:

- W66-1 (MED — dues generated after their due date read "Pending", so the
  Overdue filter found nobody behind).
- W66-2 (MED — on a phone the reflowed table hid every row's actions, so no
  payment could be recorded).

Flagged:

- W66-3 (MED — an overpayment is accepted silently and counted as
  collected).
- W66-4 (MED — a member has no way to see their own dues, and is never told
  they are due).

Gate: typecheck and lint are clean; 565 finance frontend tests and 45 dues
backend tests pass (4 new).

Next: W67.

### W65 — Check requests — 2026-10-14

Driven as:

- `treasurer` raising and submitting a check, then trying to approve and issue
  their own;
- `admin` approving, issuing and voiding it;
- `member` probing;
- 390×844 for the list, form and detail page.

Held:

- labelled form, with each missing field named;
- every double-click records once;
- separation of duties refuses the requester at approval and at issue;
- issue and void move the budget line's spending and back;
- a member gets 404 and 403.

Fixed:

- W65-1 (MED — a refused issue or void showed only "Failed to …").
- W65-2 (MED — voiding, which is final and reverses spending, took one tap).
- W65-3 (LOW — "You cannot issue check your own check request").
- W65-4 (LOW — "Valley Fuel Co.." in the issue dialog).
- W65-5 (LOW — small controls on the list and form).

Flagged: none new. The check took a purchase-request chain, confirming W64-4.

Gate: typecheck and lint are clean; the finance tests pass (6 new); the
separation-of-duties backend tests pass.

Next: W66.

### W64 — An expense report, from receipt to reimbursement — 2026-10-14

Driven as:

- `member` building a two-line report, attaching receipts and submitting;
- `treasurer` approving, overriding the emailed step and recording payment;
- `member2` probing another member's report;
- 390×844 for the list, form and detail page.

Held:

- validation;
- receipts required before submit;
- every double-click records once;
- uploads fail closed, with a clear message, when no scanner is reachable;
- another member gets 404, and only a finance manager can mark paid.

Fixed:

- W64-1 (HIGH — an approved report could never be marked paid: the endpoint
  existed and no control called it).
- W64-2 (LOW — unlabelled report and line fields).
- W64-3 (LOW — small controls on four screens).

Flagged:

- W64-4 (HIGH — purchase-request chains also route expense reports and check
  requests, and can outrank their own chains).
- W64-5 (MED — an expense line cannot be charged to a budget, so a paid
  reimbursement reaches no budget line).

Harness: the review backend now runs with `CLAMAV_ENABLED=false` (overridable
with `WR_CLAMAV_ENABLED`), because without a scanner no upload could be made.

Gate: typecheck and lint are clean; 558 finance tests pass (6 new).

Next: W65.

### W63 — A purchase request through its approval chain — 2026-10-14

Driven as:

- `member` raising, submitting and following two requests;
- `treasurer` adding a two-step "Large purchases" chain, approving, denying,
  and marking a request ordered, received and paid;
- `chief` as the named second approver;
- `admin` overriding the Chief's step;
- 390×844 for the list, form, detail page and queue.

Held:

- validation;
- the more specific chain wins;
- every double-click records once;
- override and deny require a reason, and the member sees it;
- the budget line commits on approval and spends on payment;
- no overflow on a phone.

Fixed:

- W63-1 (MED — straight after submitting, the request said it had no
  approval steps; purchase, expense and check submit responses now carry
  them).
- W63-2 (MED — the coverage report called a step covered when its approver
  lacked `finance.approve`; new problem `no_approve_permission`).
- W63-3 (LOW — seven unlabelled form fields).
- W63-4 (LOW — 20–38px controls on four screens).

Flagged:

- W63-5 (MED — the approver a chain names may be unable to approve).
- W63-6 (MED — nobody is told a request waits on them, or was decided).
- W63-7 (MED — "Mark Paid" always records the estimate).

Gate: typecheck and lint are clean; 560 frontend and 970 finance backend
tests pass (7 new).

Next: W64.

### W62 — Approval chains, finance settings and the emailed approval — 2026-10-14

Driven as:

- `treasurer` configuring a three-step chain (position, email, notification)
  and approving step 1;
- `member` raising the request that ran through it;
- a signed-out external approver on the emailed link, at 390×844;
- five roles against the chain endpoints.

Held:

- chain create, reorder, rename and delete-with-confirm survive a reload;
- configuration is finance-only;
- each double-click recorded once;
- the emailed link approves once and the member sees the result;
- the notification step says it sends no email.

Fixed:

- W62-1 (MED — a used or cut-short approval link showed the API's raw
  error to an outside approver).
- W62-2 (MED — fiscal years displayed a day early).
- W62-3 (LOW — the fiscal-year and category panels were not dialogs, ignored
  Escape, and three fields were unlabelled).
- W62-4 (LOW — six New Approval Chain fields were unlabelled).
- W62-5 (LOW — two small tap targets).

Flagged:

- W62-6 (MED — an emailed approval that is never sent, or that expires, cannot
  be re-sent, and nothing says it was not sent).
- W62-7 (MED — the external approver is shown no title or amount).

Gate: typecheck and lint are clean; 563 tests pass (6 new).

Next: W63.

### W61 — Budgets — 2026-10-14

Driven as:

- `treasurer` setting up a fiscal year and two categories (none existed), then
  adding, editing and amending budget lines;
- `admin` confirming the amendment;
- `training_officer` reading the line they own, and refused another;
- five roles against list and create;
- 390×844 for the list and the add dialog.

Held:

- one record from each double-click;
- the cleared notes saved as null;
- an inherited owner shown in the form and the table;
- an amendment held at "Pending confirmation" until a second officer
  confirmed it, after which the budget rose;
- finance-only list and edit, and owner-only reading of a line;
- no unexpected failed requests.

Fixed:

- W61-1 (MED — an overspent line read "Near limit" in the list while its own
  page said "Over budget").
- W61-2 (LOW — the row's chevron link had no name, and both row links were
  16px on a phone).
- W61-3 (LOW — an overdrawn total showed in green).

Flagged: none. Two W62 leads seen in Finance Settings while setting up.

Gate: typecheck and lint are clean; the finance tests pass (500, 3 new).

Next: W62.

### W59 — Photo-use consent — 2026-10-13

Driven as:

- `member` agreeing, and `member2` declining, from My Account → Privacy;
- `admin` reaching the roster from the Admin menu, then using its tiles,
  chips, search, sort and the inactive toggle;
- eight roles against the roster API, and three against the menu link;
- 390×844 for the roster.

Held:

- both choices reach the roster, dated, and survive a reload;
- the roster is read-only;
- the API, the page and the menu agree on who may see it;
- no console errors or failed requests.

Fixed:

- W59-1 (HIGH — `main` had two Alembic heads, so no install could upgrade
  and the harness would not start; joined by an empty merge revision, pushed
  on its own first).
- W59-2 (MED — the roster told members to answer under Settings → Security;
  it is My Account → Privacy).
- W59-4 (LOW — chip clear buttons, "Clear all", the inactive toggle and name
  links were 16–20px on a phone).

Flagged: W59-3 (MED — a member cannot record "no" without first recording
"yes", so the ledger shows an agreement that never happened and refusers stay
"not answered").

Gate: typecheck and lint are clean; 261 communications tests pass (2 new);
`test_alembic_migrations.py` passes; flake8, black and isort are clean on the
migration.

Next: W61.

### W58 — Suggestion boxes and suggestions — 2026-10-13

Driven as:

- `admin` creating, editing and (cancelling) deleting a box;
- `member` submitting named and anonymous, then following both up (My
  submissions, and the key);
- `secretary` reviewing: disposition, response, internal note, reply, and
  publish to the board;
- `member2` voting and probing others' submissions;
- `admin` as a box manager who reviews nothing;
- board and submit form at 390×844.

Database continued from W57; `main` merged in first.

Held:

- double-clicks acted once;
- anonymity end to end: no name in review, in the key view or on the
  board;
- the internal note stays internal;
- only reviewers read a box, and the manager cannot;
- the vote toggles and survives a reload;
- deleting a box with submissions requires its name and offers archive;
- reviewer and submitter notices.

Fixed: W58-1 (HIGH — every box made without intake questions, the screen's
default, stored NULL. The review summary 500'd on it, so its reviewers never
saw the Review tab).

Flagged: none.

Gate: typecheck and lint are clean; flake8, black and isort are clean on the
changed Python files; 142 suggestion backend tests pass (2 new). The local test
database had to be brought up to a migration from today's merge first.

Next: W59.

### W57 — Email templates: edit, preview, restore — 2026-10-13

Driven as:

- `admin` editing Event Reminder, switching templates mid-edit, saving,
  resetting, sending a test with email off, and reading the Ballot
  Notification and Election Report previews;
- `member` refused;
- the list at 390×844.

Database continued from W56; `main` merged in first.

Held:

- the live preview follows the draft;
- a double-clicked Save wrote once, and a tab change keeps the draft;
- Reset asks, and truthfully says it cannot be undone;
- the member was refused everywhere.

The W50-68 lead is resolved: the meeting-date variables are in the palette,
and the preview's quorum line is labelled sample data.

Fixed:

- W57-1 (MED — picking another template silently discarded an unsaved
  edit; refresh now warns too);
- W57-2 (MED — a test send with email off came back as a 500 "Email sent but
  failed to log history", and both screens hid the reason);
- W57-3 (LOW — unlabelled filter and preview member picker);
- W57-4 (LOW — 28px group headers on a phone).

Also updated `MessagesAdminPage.delivery.test.tsx`, new from `main`, to W55's
per-message button names.

Flagged: none.

Gate: typecheck and lint are clean; flake8, black and isort are clean on the
changed Python files. 258 communications frontend tests pass (4 new), as do 13
test-send and history backend tests (1 new).

Next: W58.

### W56 — Notification rules and logs, the in-app bell — 2026-10-12

Driven as:

- `admin` creating a rule on an empty install, switching it off, and reading
  the Send Log and Email Templates tabs;
- `member` in the inbox (opening a stack, pinning, reading, following a
  notification for a message deleted in W55), the bell, the Send Log, and the
  rules API;
- the inbox and Send Log repeated at 390×844.

Database continued from W55.

Held:

- a double-clicked create made one rule;
- the switch, a pin and a read each survived a reload;
- the bell followed the inbox;
- the member was refused every rules call;
- `?tab=` was honoured only where allowed;
- a deleted message's notification lands on "Message unavailable".

Fixed:

- W56-1 (MED — Tab reached the hidden buttons of a closed notification
  card);
- W56-2 (LOW — the rule switch had no name, the Trigger Event label was
  linked to nothing, and the create error was not announced);
- W56-3 (LOW — the Send Log filter showed its selection by colour alone, at
  28px on a phone).

Flagged: W56-4 (MED — a rule cannot be renamed or deleted from the screen,
and deleting one quietly turns that trigger's notifications back on; in
KNOWN_LIMITATIONS).

Gate: typecheck and lint are clean. 72 notification frontend tests pass (4
new). No backend change.

Next: W57.

### W55 — Messages: send to a group, the member's inbox, message administration — 2026-10-05

Driven as:

- `admin` composing to one member, to a role and to everyone; scheduling,
  editing, deleting, and reading the acknowledgment report;
- `member` reading and acknowledging;
- `member2` as a non-recipient, trying the message's URL and the admin
  endpoints;
- the inbox, the message and the admin screen repeated at 390×844.

Database continued from W54.

Held:

- targeting, scheduling and delete, each checked from the other member's
  inbox;
- double-clicks acted once;
- a cleared expiry stayed cleared;
- every refusal (404 to a non-recipient, 403 on admin endpoints);
- email-first delivery with SMS only through the allowlist (read from code).

Fixed:

- W55-1 (HIGH — on the top-navigation layout, the inbox, the suggestion box
  and the Forms & Comms admin screens had no menu entry);
- W55-2 (MED — the compose form replaced the server's reason with "Try
  again"; the expiry messages are reworded too);
- W55-3 (LOW — every row's buttons had the same name, and were 32px on a
  phone);
- W55-4 (LOW — unlabelled member search, and 20px checkbox rows).

Flagged: none.

New leads:

- nothing keeps the two navigation layouts in step;
- W57, W58 and W59 should be reached from the navigation.

Gate: typecheck and lint are clean; flake8 and black are clean on the changed
Python files. 300 communications and layout frontend tests pass (7 new), as do
79 messaging service tests.

Next: W56.

### W54 — Org chart and legal documents — 2026-10-04

Driven as:

- `admin` building a chart on an empty install: linked and unlinked seats, a
  typed person with no account, a hidden seat, a re-parent, a removal with
  reports, and a nudge;
- `member` reading and searching the chart, and trying to change it;
- `secretary` proposing and editing a privacy-policy draft, and trying to
  publish, revert, and touch the admin's draft;
- `admin` publishing and reverting, with `/privacy` read signed out after
  each;
- both pages repeated at 390×844.

Database continued from W53.

Held:

- every permission line, on the screen and the API;
- double-clicks acted once;
- cleared fields stayed cleared;
- hidden seats stayed hidden from members;
- publish and revert reached the public page;
- the audit log recorded every change with its actor.

Fixed:

- W54-1 (MED — a malformed contact email was saved and published as a
  `mailto:` link; refused now by the editor and the server);
- W54-2 (LOW — the legal tabs controlled no tab panel).

Flagged (in KNOWN_LIMITATIONS):

- W54-3 (MED — a revert leaves no trace in the published history);
- W54-4 (LOW — a publisher's edit to a proposal is not attributed);
- W54-5 (LOW — department text loses the built-in text's headings and lists).

Lead: W54-6 (two 20px tap targets) → W79.

Gate: typecheck and lint are clean; flake8 and black are clean on the changed
Python files. 60 governance frontend tests and 123 org-chart and legal backend
tests pass.

Next: W55.

### W53 — Documents: folders, upload, who can see what — 2026-10-04

Driven as: `secretary` creating a folder and uploading files (one into a
leadership-only folder); `member` browsing, downloading, and trying to read,
download, search for and delete what they should not; repeated at 390×844.
Database continued from W52.

Held:

- every access rule: the member saw no leadership folder, and got 404 on the
  confidential file's read and download, nothing from search, and 403 on
  delete;
- double-clicks acted once;
- delete asks first.

Fixed:

- W53-1 (MED — the file picker could not be reached by keyboard, so a
  keyboard user could not upload);
- W53-2 (LOW — the upload and delete dialogs were not announced as dialogs);
- W53-3 (MED — nothing said which folders members cannot see);
- W53-5 (NIT — a stale "disable by editing App.tsx" comment).

Flagged: W53-4 (MED — folders cannot be restricted, renamed, moved or deleted
from the screen, though the API supports it; in KNOWN_LIMITATIONS).

Open: W53-6 (LOW — raw MIME types).

Gate: typecheck and lint are clean, and 27 Documents tests pass, as does the full frontend suite (721
files, 9086 tests). No backend change.

Next: W54.

### W52 — Action items: assign, work, close — 2026-10-04

Driven as: `secretary` adding and working items on minutes and reading Action
Items; `member` reading, filtering and trying to close one; repeated at
390×844. Database continued from W51.

Held:

- a status change made on the minutes page showed on Action Items after a
  reload;
- the member saw only items on approved minutes;
- no sideways overflow on a phone.

Fixed:

- W52-1 (MED — due dates read a day early);
- W52-2 (MED — an item counted overdue the evening before its due day);
- W52-3 (MED — "Open" filtered to nothing beside an Open tile of 3);
- W52-4 (MED — rows unreachable by keyboard);
- W52-5 (LOW — the Minutes page's open-items tile left out minutes items, the
  W51 lead).

Flagged: W52-6 (MED — nothing can be assigned to a member, so "Assigned to me"
never matches) and W52-7 (MED — an assignee cannot close their own item). Both
are in KNOWN_LIMITATIONS.

Gate: typecheck and lint are clean, and 44 touched frontend tests pass, as does
the full frontend suite (715 files, 9051 tests). No backend change.

Next: W53.

### W51 — Meeting minutes: draft, approve, publish — 2026-10-03

Driven as: `secretary` drafting and submitting, `chief` approving and
publishing, `member` reading, at 1280×900. The list, the create dialog and the
minutes page were repeated at 390×844. Database continued from W60.

Held:

- every double-click acted once, including Publish (one document);
- the secretary could not approve their own minutes;
- a reject needs a 10-character reason, which the secretary then reads and
  can act on;
- `member` saw approved minutes only, got a 404 on drafts and a 403 on writes;
- a linked event and a written section survived a reload.

Fixed:

- W51-1 (HIGH — minutes from a meeting were dated the day before, or hours
  early: the local date and time were read as UTC);
- W51-2 (HIGH — the Minutes page never linked to minutes, so an approver
  could not find what awaited approval, and "Pending approval" read 0);
- W51-3 (MED — the book icon wrote a second set of minutes for a meeting that
  had them);
- W51-4 (MED — Executive, Trustee and Annual meetings were offered and always
  refused with a misleading message);
- W51-5 (MED — action item due dates read a day early);
- W51-6 (LOW — the submitter was offered Approve);
- W51-7 (LOW — raw ISO dates, an unnamed dialog, the date only checked by a
  422, 32px icon buttons).

Flagged:

- W51-4's missing meeting types (MED, needs a migration);
- W51-8 (MED — existing minutes keep the shifted date; a backfill needs a
  decision). Both are in KNOWN_LIMITATIONS.

Open: W51-9 (LOW — meeting status badge).

Gate: typecheck, lint, flake8, black and isort are clean. 39 minutes frontend
tests and 4083 backend tests (minutes and meetings) pass, as does the full frontend suite (708 files,
9002 tests).

Next: W52.

### W50 (re-drive) — Voter-eligibility rules and the lifecycle — 2026-10-31

Driven as `secretary`, `membership_coordinator`, `member` and `treasurer` on a fresh database, at 1280×900 and 390×844. Covered: department defaults (regular and annual), the waiting period per member type, the profile override, a status change, count-mode attendance, the frozen roll, voting, close and results. Findings are in [W50-elections.md](./W50-elections.md#w50-re-drive--2026-10-31-voter-eligibility-rules-and-the-lifecycle).

- Fixed: W50-R1 (MED — Escape in the position suggestions discarded the create form), W50-R2 (LOW — a future count-from date was accepted).
- Flagged: W50-R3 (LOW — an ineligible member is told only that they are not on the frozen roll).
- Fixed 2026-11-01: W50-R4 and W50-R5 (NIT).

### W50 — An election: create, nominate, vote by ballot link, close, results — 2026-09-30

Driven as: `secretary`, `member` and `member2` (driver A) and `admin`,
`treasurer`, `training_officer`, `chief` and a signed-out visitor (driver B),
two browsers at once at 1280×900 and 390×844, on a fresh database with
**email on** and routed to a local sink (265 messages read back, every ballot
link followed). Three officer elections — Chief plus a budget motion and a
membership approval, a two-seat board, and an engineered tie with its runoff
— and nine probe elections for permissions, security and the lifecycle task.
Not driven: a proxy vote (no UI), a second attesting officer, keyboard-only
navigation; the meeting-link round trip (no event in the org).

Held: create with items and saved templates; nominations end to end; in-app,
emailed-link, paper and attested ballots; close, publish, the certified PDF
and the report; the runoff chain; clone, rollback and void; every refusal
(401/403/404, CSRF, foreign ids, the module gate); every date in Chicago time
from a UTC browser; no console or page error in ~250 scripts.

Fixed (41 findings, 52 fixes: `3de83db` 17 backend S01–S17, `d6f828c` 7
frontend S18–S24, `7aa3405` 28 backend from the drive, `cbd97eb` the
template carry; 18 re-driven live against `7aa3405` and holding):

- W50-1 (CRITICAL — deleting any election with issued ballot tokens 500'd after leadership was mailed "permanently deleted").
- W50-2 (HIGH — an anonymous election was de-anonymised by any manager in two reads), W50-3 (HIGH — a named-election member voted in-app and by link, both counted), W50-4, W50-5 (HIGH — an item id or a missing `position` skipped the attendance rule and the one-vote rule), W50-6 (HIGH — a voided voter's next vote 500'd on both routes), W50-7 (HIGH — motions and membership approvals reported nowhere), W50-8 (HIGH — the printed ballot carried positions only; the recording half is flagged), W50-9 (HIGH — candidates renamed after close; merge and void after close flagged), W50-12 (HIGH — a mid-vote tally mailed as the official closed report), W50-14 (HIGH — an early close dated to the scheduled end, with no actor).
- MED: W50-15, 16, 17, 18, 20, 21, 27, 28, 32, 33, 34, 35, 37, 39, 40, 41, 42, 44, 45 — browser-zone date arithmetic, a cleared statement that survived, a member's deep-link trap, test ballots indistinguishable from real ones, the package's eligibility count, publish controls the server refuses, reminders titled and stamped as first ballots, "send to all voters" that mailed one person, ties printed as two 50% rows, invented recipient facts, runoffs losing their tie policy and items, ballots mailed from a draft, a rollback alert that lied, a vote deleted through another election's path, pending batches counting toward the cap, `[]` meaning nobody, a 60-character write-in 500, a dead token blaming the voter roll, an audit page reading "system".
- LOW: W50-48, 49, 54, 55, 60, 65, 66, 67, 68, 69, 71 — "Quorum Met" with no quorum, an unenforced proxy cap, a voided receipt's message, the roster against the frozen roll, a no-op toast, forensics counters, batch-card void trails, a malformed id 500 and an unbounded statement, ballot-mail wording, a clone's stale flag, a runoff audit row with no election.

Flagged (mirrored to `docs/KNOWN_LIMITATIONS.md`): W50-8 recording half, W50-9
post-close merge/void, W50-10 (the in-app tab is not the ballot), W50-11 (no
seat count), W50-13 (an override on a restricted list) — HIGH; W50-19, W50-22,
W50-23, W50-25, W50-31, W50-38, W50-47 — MED; W50-70, W50-72 — LOW; plus the
S01 proxy-ballot attributability (HIGH), the pre-fix audit rows (MED), the
pre-deploy double-vote window (MED, in `docs/UPGRADING.md`), pooled
`overall_results` on multi-item ballots (MED) and two data residuals (LOW).

Frontend round 2 (a follow-up PR after #2856 merged) fixed W50-24, 26, 29,
30, 36, 43, 46, 50, 51, 52, 53, 56, 57, 58, 59, 61, 62, 63, 64, 73 and the
frontend halves of fourteen backend fixes, each with a Vitest. Re-driven on
screen 2026-10-06 (two browsers, from each finding's own scenario): 20 of 23
held; the three that did not — the list card's close stamp (the list endpoint
never sent `closed_at`), the in-app receipt and focus after a nomination (both
unmounted by a refetch's loading state) — and six more things seen on the way
are W50-83 to W50-92: eight fixed with tests (W50-83, 84, 85 confirmed live
again), W50-91 a re-observation of W50-11, W50-92 a note. Open: W50-74 to
W50-82, W50-91, W50-92 (NIT/NOTE). The manual (`docs/training/14-elections.md`) corrected on five
lines the drive contradicted.

Gate: backend — the election suite 622 passed and the CI unit selection
11977 passed after round 2 and the template carry; flake8, black and isort
clean; each new Alembic revision proven up, down and up; `generate_schema_docs`
and `check_route_permissions --strict` clean. Frontend — typecheck, eslint,
prettier and the election suites (143 passed) clean after round 1; round 2
and the re-drive — typecheck, eslint, prettier and the election suites (61
page and ballot tests, 15 panel tests) clean; backend election suites 173
passed, flake8, black and isort clean. Next: W51.

- **Any forms or prospects run** — `scripts/clear_hidden_form_answers.py`
  still judges each rule one level deep (`FormsService._is_field_visible`,
  kept that way on purpose in W60). So answers stored before W60 under a
  follow-up of a hidden question are not swept. Extending it to
  `_visible_field_ids` changes what it deletes, so it needs its own review and
  a dry run (W60-1).

## Log

### W60 — Forms: build, publish a public form, submit it, read submissions — 2026-10-02

Driven as: `admin` at 1280×900 building a branching form ("Volunteer Intake":
yes/no → checkbox list → required card number), a signed-out visitor on the
public link, and `member`. The public form and the field editor were repeated
at 390×844 after the fixes. Fresh database.

Held: a valid response saved and was listed in the department's timezone; a
required question that is shown was enforced by the browser and the server;
`member` was refused the page and the mutations.

Fixed:

- W60-1 (HIGH — a required follow-up of a closed branch stayed on screen and
  required, in the preview, on the public page and on the server, so answering
  "No" could not be submitted). Visibility now follows a branch through every
  level, from one frontend helper and its backend twin.
- W60-2 (MED — "contains EMT" matched an "AEMT" tick).
- W60-3 (MED — removing a condition, or clearing a placeholder or limit,
  reported success and saved nothing; pitfall 1).
- W60-4 (MED — the builder allowed a cycle, which hid a whole required branch
  from everyone; the editor and the API now refuse it, and the API also
  refuses a parent from another form).
- W60-5 (MED — a duplicated follow-up lost its condition).
- W60-6 (MED — deleting a question took one tap and orphaned its follow-ups).
- W60-7 (LOW — a number field reopened with blank limits).
- W60-8 (MED — the in-app renderer named no field).
- W60-9 (LOW — a rule with no value was accepted).
- W60-10 (LOW — the field-type picker had no checked state).

Flagged: W60-11 (MED — the public page asks for sign-in only after the form is
filled in). Fixed 2026-10-03 on the owner's decision: a notice above the
questions with a Sign in button that returns to the form.

Gate: typecheck, lint, flake8, black and isort are clean. 29 frontend forms
tests and 369 backend forms tests pass, as does the full frontend suite (692 files,
8907 tests).

Next: W51.

### W50 — An election: create, nominate, vote by ballot link, close, results — 2026-09-30

Driven as: `secretary` at 1280×900, `member` at 390×844, and a signed-out
voter on `/ballot` at 390×844, with a minted token standing in for the email
(email is off here). Held: an empty create refused; seven double-clicks acted
once; a pending nomination kept off the ballot; the link asked before casting,
gave a receipt, and refused reuse, a bad token and no token; `member` refused
every manage call. Fixed: W50-1 (LOW — a click on Add after typing a position
was eaten by a click-away layer), W50-2 (LOW — start and end time pickers
shared names), W50-3 (LOW — a plurality election read "Simple Majority"),
W50-4 (MED — only the selected election tab was reachable by keyboard), W50-5
(LOW — the stepper read as bare numbers on a phone), W50-6 (MED — a voter
override needed a user ID, and was listed by it), W50-7 (LOW — the candidate
form, ballot builder and attendance list named nothing), W50-8 (LOW — the
ballot-email reason was a hover title, and the send claimed a summary emailed
with email off). Flagged: W50-9 (MED — a member checked in after opening
cannot vote), W50-10 (MED — an election closed early hides its results until
the scheduled end), W50-11 (LOW — a positions-only election cannot email
ballots). Open: W50-12, W50-13 (NIT). Gate: typecheck, lint, the election
suites, flake8 and black clean; the election and ballot pytests pass.
**Rotation stopped here:** W50-9 and W50-10 are decisions about who may vote
and who may see results, which the rotation's instructions reserve for the
owner. Next, once they are decided: W51.

### W49 — Facilities: a facility, its maintenance, inspections and settings — 2026-09-30

Driven as: `admin` at 1280×900 and 390×844, with `member` refused on four
pages and every call at 390×844. Held: double-clicked saves made one facility,
one maintenance record and one inspection; the records reached the
facility-wide pages and the dashboard; edits send `null` for a cleared field;
no page scrolled sideways on a phone. Fixed: W49-1 (LOW — an email that is not
one was accepted; the forms now refuse it, the server is left open), W49-2
(MED — the overview edit form named none of its 21 fields), W49-3 (LOW — the
section navigation had no current state), W49-4 (LOW — the four maintenance and
inspection dialogs named nothing), W49-5 (LOW — filter strips showed state by
colour alone), W49-6 (LOW — the lookup editor had no dialog role; the facilities
part of the W14-2 lead, removed). Gate: typecheck, lint and the facilities
suite clean; no backend change. Next: W50.

### W48 — Add an apparatus, edit it, read its detail, print its labels — 2026-09-30

Driven as: `admin` at 1280×900 and 390×844, with `member` refused on five
pages and every call. Held: an empty submit saved nothing; a double-clicked
Add made one apparatus; the registration date read as a calendar date; the
labels page printed E-2. Fixed: W48-1 (MED — the add/edit form named almost
none of its 40 fields), W48-2 (LOW — required-field errors not tied to their
fields), W48-3 (LOW — an unchosen fuel type was stored as diesel), W48-4 (LOW —
clearing a field on edit kept the old value), W48-5 (LOW — every row's actions
shared one name), W48-6 (LOW — the detail page scrolled sideways on a phone),
W48-7 (LOW — the basic apparatus form named nothing; the W30 lead, removed).
Open: W48-8 (NIT). Gate: typecheck, lint, the apparatus and scheduling suites
and the apparatus pytests clean. Next: W49.

### W47 — Medical supplies — 2026-09-30

Driven as: `quartermaster` at 1280×900, with `member` read-only at 390×844.
Held: a blank name and a negative threshold were refused; double-clicked
Create category, Add supply and Record delivery each acted once; the expired
lot was left out of on hand; a cleared reorder point saved as a clear; retire
confirmed first; the member saw no write controls and got 403 on every write.
Fixed: W47-1 (LOW — the item page called expired units ready), W47-2 (LOW —
every lot's controls had one name), W47-3 (LOW — delivery lines repeated one
set of field names), W47-4 (LOW — a retired supply's lots stayed on the
expiring tab, in the counts and, read from code, in the expiry alert), W47-5
(LOW — the add-supply notice named the categories page without linking it).
Flagged: W47-6 (MED — the dashboard counts a lot-stocked category as empty).
Open: W47-7, W47-8 (NIT). Gate: typecheck, lint, the inventory and
medical-supplies suites and the touched pytests clean. Next: W48.

### W46 (second pass) — Equipment checks — 2026-09-30

A second session drove W46 before the first run's file reached `main`; the two
were reconciled on merge and this pass's ids renumbered into
`W46-equipment-checks.md` ("A second pass"). Driven as: `chief` building,
`member` performing at 390×844, `quartermaster` refused the builder. Its fixes
overlapped W46-6, W46-7, W46-8 and W46-10 and were kept where they add to
them: the member's log links back to "My checklists". Resolved: W46-14 (the
owner granted the quartermaster `inventory.check_manage`, migration
`f73b449bdb8b`). Flagged: W46-19 (MED — the log counts a checklist missed
before it existed), W46-20 (LOW — basic apparatus cannot be pinned to a
checklist). Next: W47.

### W46 — Equipment checks: build a checklist, perform a check, fleet board, check log — 2026-09-30

Driven as: `scheduling_officer` building and publishing an Engine checklist
and reading the board, log and reports. Then `member` and `member2` performing
checks on Engine 1 at 1280×900 and 390×844, with `member` refused. The seeded
Quartermaster holds no checklist grant, so the row's role was corrected
(W46-14). Fresh database: this container had no review database.

Held: one template per double-clicked save, and one check per double-clicked
submit. Draft resume, carried-over counts, and an out-of-service item taking
the rig off the board, with its reason.

Fixed:

- W46-1 (MED — create stored any apparatus id: 500 for a basic one, stored for a foreign one).
- W46-2 (MED — a filed check still offered Open checklist, then 409 at Submit).
- W46-3 (MED — a check that took an item out of service counted as neither expected nor done).
- W46-8 (MED — the builder offered basic apparatus it cannot save).
- W46-4 (LOW — "No check templates configured" for a rig with one).
- W46-5 (LOW — the admin page lacked the fleet and log links its hub card promises).
- W46-6 (LOW — "← Fleet" shown to members it refuses).
- W46-7 (LOW — answers told by colour only; unnamed count box).
- W46-9 (LOW — raw seat tokens, no Paramedic).
- W46-10 (LOW — each builder row exposed as one "button").

Flagged:

- W46-11 (MED — checks on basic apparatus stored with no apparatus; reports empty by truck).
- W46-12 (MED — a check filed before its shift's date is off the board until then).
- W46-13 (LOW — no note required on Fail/Out of service).
- W46-14 (LOW — Quartermaster grants).

Open: W46-15 (LOW), W46-16, W46-17, W46-18 (NIT).

Gate: typecheck, lint, flake8, black, isort, the inventory suites and the
equipment-check pytests clean. Next: W47.

### W45 — The self-service kiosk — 2026-09-30

Driven as: `admin` running the kiosk at 1024×768 and 390×844 for Jordan Avery
and Alex Brooks, with `member` and `quartermaster` refused (the grant is seeded
to no position by design). Taps came from a stand-in `NDEFReader` installed
before the page loaded, since the review browser has no reader. Held: a
double-clicked Borrow lent once to the card's holder, due in the loan period;
an item on loan to someone else, a return by a non-holder and an unregistered
card were refused; a damaged return needs a note, closed the loan once and put
the item in maintenance; a minute without a tap forgot the member. Fixed:
W45-1 (LOW — the next member's serial card was read as an item until Done),
W45-2 (LOW — a suspended card was called lost or replaced), W45-3 (LOW —
member-facing refusals ended in a support code), W45-4 (LOW — the NFC-off
notice sent the kiosk officer to a settings page). Open: W45-5, W45-6 (NIT).
Review cards revoked and NFC ID Cards deactivated afterwards. Gate:
typecheck, lint, the inventory suites and the kiosk pytests clean. Next: W46.

### W44 — NFC: tag in bulk, put away, shelf audit, items not seen — 2026-09-30

Driven as: `admin` → `quartermaster` at 1280×900, with `member` refused at
390×844, through the typed-serial path every NFC screen offers (the review
browser has no NFC reader). Held: the switch turned on once and survived a
reload; each screen says plainly when the device cannot read tags; a tag was
linked once; a shelf audit found an item recorded elsewhere and moved it once;
put-away moved it back and the tap took it off Items Not Seen; the member got
403 and Access Denied throughout. Fixed: W44-1 (LOW — Tag Items in Bulk sent
the quartermaster to a settings page they cannot open). Open: W44-2, W44-3,
W44-4 (NIT). Gate: typecheck, lint and the inventory suites clean. Next: W45.

### W43 — Storage areas, barcode labels and CSV import — 2026-09-29

Driven as: `quartermaster` at 1280×900, with `member` refused at 390×844.
Held: a nested storage area was created once with its own barcode; label
printing with nothing selected says so; the import reports each rejected row
and the item export neutralises a formula-looking name; the member got 403 on
every write and Access Denied on both pages. Fixed: W43-1 (HIGH — a negative
quantity in an imported CSV was saved, and every item list including it then
failed with a 500, taking down the Items page; the repair of already-stored
rows is flagged), W43-2 (MED — deleting a storage area that held items hid
their location, and the nested-area warning never showed), W43-3 (MED — the
import could not be started without a mouse), W43-4 (LOW — unnamed expand
toggles). Open: W43-5, W43-6 (NIT). Gate: typecheck, lint, flake8, black and
the touched frontend and backend suites clean. Next: W44.

### W42 — Maintenance records, vendors, charges and issuance allowances — 2026-09-29

Driven as: `quartermaster` at 1280×900, with `member` refused at 390×844.
Held: an inspection set the coat's next due date from its category interval
and left it assigned; a vendor was created once and a cleared phone saved as a
clear; an allowance was created once and applied in the pool Issue dialog; four
double-clicks acted once; the member got 403 on every write and Access Denied
on all four pages. Fixed: W42-1 (LOW — an inspection logged after 7 PM Central
was dated tomorrow), W42-2 (LOW — the maintenance note said a passed
inspection keeps an in-service item out of service), W42-3 (LOW — the action
choice and fields had no state or names), W42-4 (LOW — a charge could be
applied at $0 and then never corrected; the dialog was unnamed), W42-5 (LOW —
Issue stayed live for an over-allowance quantity the server refuses). Open:
W42-6, W42-7 (NIT). Gate: typecheck, lint and the inventory suites clean.
Next: W43.

### W41 — A member's request, return, write-off and reorder, and the approvals — 2026-09-29

Driven as: `member` at 390×844 → `quartermaster` at 1280×900, with `member`
refused. Held: a zero quantity was refused; six double-clicks acted once;
declined and issued decisions reached the member with the quartermaster's note;
a stale return notice could not take back an item now held by someone else;
the member got 403 on every write and Access Denied on all four pages. Fixed:
W41-1 (MED — fulfilling pool stock opened on a method the server always
refuses), W41-2 (LOW — a multi-unit return was refused on the pre-filled count
of 1), W41-3 (LOW — the return dialog was unnamed and its row actions
identical), W41-4 (LOW — the reorder form and steps had unnamed fields and
unmarked requirements). Flagged: W41-5 (MED — a reorder made in the app can
never be received; labelled), W41-6 (MED — a write-off raised for one returned
box would retire the whole pool item). Open: W41-7 (NIT). Gate: typecheck, lint
and the inventory suites clean. Next: W42.

### W40 — Pool items, checkouts, kits and variant groups — 2026-09-29

Driven as: `quartermaster` at 1280×900 and 390×844, with `member` refused.
Held: issuing, returning and bulk issuing moved the counts exactly; five
double-clicks acted once; a past loan extension was refused; a kit issued the
coat as an assignment and the gloves as a pool issuance; the member got 403 on
every write and Access Denied on all four pages. Fixed: W40-1 (MED — a quantity
above what was on hand was silently lowered to the maximum and issued, emptying
the shelf), W40-2 (LOW — "0/-1 used … -1 remaining"), W40-3 (LOW — the
issuance list showed user-id prefixes, not names), W40-4 (LOW — unnamed
controls across the pool page and kit form), W40-5 (LOW — an extended loan
came back due a day early), W40-6 (LOW — one tap on a name issued a whole kit).
Flagged: W40-7 (MED — a variant group made on its page can never be filled).
Open: W40-8, W40-9 (NIT). Gate: typecheck, lint and the inventory suites clean.
Next: W41.

### W39 — Issue equipment to a member, the member sees it, return it — 2026-09-29

Driven as: `quartermaster` → `member` at 1280×900 and 390×844, with `member`
refused. Held: an assignment and a pool issuance of 2 were each made once
despite a double-clicked Confirm; the member saw both; a double-clicked return
notice made one and a second was refused; a double-clicked Return returned
once; the member got 403 on every inventory write and Access Denied on the
members page. Fixed: W39-3 (MED — the Return Items dialog could not be used
without a mouse), W39-1 (LOW — a member opening their own gear got
"Insufficient permissions" over an empty History), W39-2 (LOW — a missing NFPA
record toasted as an error), W39-4 (LOW — Pending read 0 with a return notice
open; the notice's fields had no names), W39-6 (LOW — identical per-member
action names), W39-7 (LOW — a loan's return time was bounded in UTC). Flagged:
W39-5 (MED — receiving gear back leaves the member's return notice open). Open:
W39-8, W39-9 (NIT). Gate: typecheck, lint and the inventory suites clean. Next:
W40.

### W38 — Set up inventory: categories, then add items of each tracking kind — 2026-09-29

Driven as: `quartermaster` at 1280×900, with `member` refused, through the
setup wizard. Held: storage, four categories, an individual item and a pool
item were each created once despite double-clicks; the item form opened with
category and storage filled in; members got 403 and Access Denied. Fixed:
W38-1 (LOW — the first step offered the quartermaster an Add room form that
`POST /locations` refuses without a location grant; the permission question is
flagged), W38-2 (LOW — the item form didn't mark the serial and inspection
interval a category requires). Open: W38-3, W38-4 (NIT). Gate: typecheck, lint
and the inventory suites clean. Next: W39.

### W37 — Scheduling reports and the printed check-in sheet and shift report — 2026-09-29

Driven as: `scheduling_officer` at 1280×900 and under print media, with
`member` and `member2` refused. Held: Member Hours reconciles with W34's
attendance (12 h worked, 24 h scheduled); Coverage, Availability and Call
Volume read correctly; the check-in sheet prints the rig, a QR and its link;
the shift report prints with a signature line; members got 403 on every report
and another member 404 on a report. Fixed: W37-1 (LOW — a requirement nobody
is held to read "0% · 0/0 compliant"). Flagged: W37-2 (MED — Shift Compliance
grades training hours requirements from shift attendance alone, so Hazmat reads
compliant here and 4 of 6 on the training side). Open: W37-3 (NIT — the app
footer prints on both print pages; added as a lead). Gate: typecheck, lint and
the scheduling suites clean. Next: W38.

### W36 — Every scheduling settings section — 2026-09-29

Driven as: `scheduling_officer` at 1280×900, with `member` refused; all seven
sections checked for names and state, and a value saved and reloaded in
General and Outside Apparatus. Held: saves persist across reload; double saves
and a double add acted once; the Save footer appears only on the sections it
writes; members get Access Denied and 403. Fixed: W36-2 (LOW — Eligibility's
chips showed their state by colour only), W36-3 (LOW — the custom position
field had no name). Labelled and flagged: W36-1 (MED — the six Scheduling
Notifications switches store `schedule_change` rules no sender reads; the panel
now says they are not in effect, CLAUDE.md pitfall 19). Open: W36-4 (NIT — the
Platoons route falls back to General unexplained while platoons are off).
Gate: typecheck, lint and the scheduling suites clean. Next: W37.

### W35 — Platoons and the position qualification roster — 2026-09-29

Driven as: `scheduling_officer` at 1280×900 and 390×844, with `member`
refused. Held: a double-clicked bulk assign moved two members to Platoon B
once and survived a reload; clearing a platoon worked; the page says platoon
scheduling is off rather than hiding the roster; the roster flags the six
drivers cleared by rank with no EVOC on file; members got 403/404 and Access
Denied. Fixed: W35-1 (LOW — the roster's "why" badges were told apart only by
icon and colour), W35-2 (LOW — the platoon picker had no name). No flags.
Gate: typecheck, lint and the scheduling suites clean. Next: W36.

### W34 — Check in to a shift by apparatus QR, and close the shift out — 2026-09-29

Driven as: `member` → `scheduling_officer`, with `member2`, at 1280×900 and
390×844, on two E-1 shifts set up for the run (one running, one ended
yesterday). Held: the apparatus QR link found the running shift; a
double-clicked Check In, Check Out and Close out shift each acted once; the
close-out queue listed only the ended shift and emptied after it; hours
entered for a no-show reached the member's history; members got 403 on
finalize and the queue. Fixed: W34-1 (MED — one tap on Check Out ended a
12-hour shift 11 hours early with no way back; it now asks before the
scheduled end), W34-2 (LOW — a 0-minute check-out read a bare "hours"), W34-3
(LOW — close-out's per-member hours boxes and the queue's row buttons were
indistinguishable). Open: W34-4 (NIT — expected 404s logged), W34-5 (NIT — an
unassigned member can check in, by a setting). No flags. Gate: typecheck,
lint and the scheduling suites clean. Next: W35.

### W33 — Sign up for a shift, swap it, request time off — 2026-09-29

Driven as: `member`, `member2` → `scheduling_officer`, at 1280×900 and
390×844. Held: a double-clicked sign-up, swap request and time-off request
each acted once; only the seat the member is cleared for was offered;
approving time off cancelled the member's seat and notified them; `member2`
was refused another member's requests (403/404). Fixed: W33-1 (LOW — every
row's Sign up / Confirm / Swap / Approve buttons had one shared name), W33-2
(LOW — signing up promised an officer review that does not exist), W33-3 (LOW —
a double-clicked Approve reviewed twice and showed an error), W33-5 (LOW — an
answered request vanished behind the Pending filter with "No requests").
Flagged: W33-4 (MED — an open swap is visible to nobody else and approving it
moves nothing; the dialog's "Any member can pick it up" is corrected). W33-4
fixed 2026-10-05 on the owner's decision: open swaps are offered to members
cleared for the seat, and a pickup moves the assignment. Gate:
typecheck, lint and the scheduling suites clean. Next: W34.

### W32 — Shift templates and patterns, then generate a month of shifts — 2026-09-29

Driven as: `scheduling_officer` at 1280×900 and 390×844, with `member`
refused and reading the result. Held: a double-clicked Save Template, Create
Pattern and Generate each acted once; a 24/48 rotation produced 11 shifts
every third day at 7 AM Central with the template's seats; a re-run added no
duplicates; members see the shifts as open and are refused the writes and the
pages. Fixed: W32-1 (MED — `driver_warnings`, the driver seats generation
leaves empty for want of EVOC, were dropped by both generate screens; read from
code, covered by tests), W32-2 (LOW — a re-run said "Generated 0 shifts"),
W32-3 (LOW — the pattern form's fields unnamed, its choices by colour, and a
duplicate "Generate" on phones), W32-4 (LOW — the template form's time pickers
and crew seats indistinguishable). Open: W32-5, W32-6 (NIT). No flags. Gate:
typecheck, lint and the scheduling suites clean. Next: W33.

### W31 — The learning center orientation — 2026-09-29

Driven as: `member` at 1280×900 and 390×844, with `member2` for isolation.
Every lesson step's instructions were read against the screen it links to.
Held: progress survives a reload and is kept per member (`member2` starts at
0); the dashboard's orientation prompt opens the first lesson; every lesson
link resolves; the lesson pages fit 390px. Fixed: W31-1 (LOW — seven lesson
steps named controls the screens do not have, e.g. "Next 7 days" for "Next
30 Days", "Inbox" for "My Notifications", "Claim" for "Sign Up"), W31-2 (LOW
— Reset progress discarded every tick without asking), W31-3 (LOW — the My
Sizes dialog's fields had no names). Open: W31-4 (NIT — an expected 404 on a
first My Sizes visit). No flags. Gate: typecheck, lint and the touched suites
clean. Next: W32.

### W30 — Log a shift and file a shift report — 2026-09-29

Driven as: `training_officer` → `member` (the tracker's `member` was wrong —
filing needs `training.manage`; the member reads and acknowledges), at
1280×900 and 390×844, with `member` and `member2` refused. Held: a
double-clicked Submit filed one approved report; the member saw it on My
Training and in Scheduling → Shift Reports and acknowledged it once; filing
refused the member, and another member got 404. Needed an apparatus first
(added through `/apparatus-basic`). Fixed: W30-1 (LOW — the shift report form's
fields, crew checkbox and call-type toggles had no names or state), W30-2 (NIT —
the acknowledgment comment box). New lead for W48 (the basic apparatus form).
No flags. Gate: typecheck, lint and the touched suites clean. Next: W31.

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
colour only). Flagged: W26-1 (MED — fixed 2026-10-06 on the owner's decision to read the compliance result live; a linked requirement starts at zero,
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
