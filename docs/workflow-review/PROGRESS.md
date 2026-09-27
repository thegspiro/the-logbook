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
| W01 | Fresh-install onboarding, every step, including going Back and resuming    | anonymous → admin | `/`, `/onboarding/*`                  | ⬜     |
| W02 | Sign in, sign out, session timeout, a wrong password, lockout messaging    | member            | `/login`                              | ⬜     |
| W03 | Forgot password and reset by link                                          | anonymous         | `/forgot-password`, `/reset-password` | ⬜     |
| W04 | My account: profile, password change, MFA enrolment, notification settings | member            | `/account`                            | ⬜     |
| W05 | Positions and permissions: create a position, grant, assign, revoke        | admin → member    | `/settings/roles`                     | ⬜     |
| W06 | Organization settings, module switches, department setup checklist         | admin             | `/settings`, `/setup`                 | ⬜     |
| W07 | Dashboard for each role: what shows, what links work, what fails behind it | every role        | `/dashboard`                          | ⬜     |

## Tier 2 — Members

| #   | Activity                                                                  | Acts as                | Starts at                                    | Status |
| --- | ------------------------------------------------------------------------- | ---------------------- | -------------------------------------------- | ------ |
| W08 | Add a member, with and without a password, and their first sign-in        | admin → new member     | `/members/add`                               | ⬜     |
| W09 | Import members from a spreadsheet                                         | admin                  | `/members/import`                            | ⬜     |
| W10 | Find a member and read their profile, as a member (contact visibility)    | member, admin          | `/members`, `/members/:userId`               | ⬜     |
| W11 | Edit a member as an officer: details, clearing a field, status, history   | admin                  | `/members/admin/edit/:userId`                | ⬜     |
| W12 | Member settings: ranks, membership tiers, ID numbering, EVOC, visibility  | admin                  | `/members/admin/settings/*`                  | ⬜     |
| W13 | Waivers                                                                   | admin                  | `/members/admin/waivers`                     | ⬜     |
| W14 | Check-in station, badge scan, member labels and ID cards                  | admin                  | `/members/check-in-station`, `/members/scan` | ⬜     |
| W15 | A member leaves: departure clearance, property return, archive, reinstate | admin                  | `/members/admin`                             | ⬜     |
| W16 | Prospective member from application to converted member                   | membership_coordinator | `/prospective-members`                       | ⬜     |
| W17 | An applicant checks their status by link                                  | anonymous              | `/application-status/:token`                 | ⬜     |

## Tier 3 — Events

| #   | Activity                                                                  | Acts as               | Starts at                                       | Status |
| --- | ------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------ |
| W18 | Create, edit and cancel an event, including a recurring one               | secretary             | `/events`, `/events/:id/edit`                   | ⬜     |
| W19 | RSVP, change it, and see it on the event                                  | member, member2       | `/events/:id`                                   | ⬜     |
| W20 | Check-in: QR self check-in, live monitoring, an officer's manual check-in | member, secretary     | `/events/:id/qr-code`, `/events/:id/monitoring` | ⬜     |
| W21 | Event templates, the events admin hub, and event analytics                | secretary             | `/events/admin`, `/events/templates`            | ⬜     |
| W22 | A public event request and its status link                                | anonymous → secretary | `/event-request/status/:token`                  | ⬜     |
| W23 | Locations, the kiosk display and guest check-in                           | admin, anonymous      | `/locations`, `/display/:code`                  | ⬜     |

## Tier 4 — Training

| #   | Activity                                                              | Acts as                   | Starts at                                          | Status |
| --- | --------------------------------------------------------------------- | ------------------------- | -------------------------------------------------- | ------ |
| W24 | Submit a training record, and the officer approves or returns it      | member → training_officer | `/training/submit`, `/training/submissions`        | ⬜     |
| W25 | Courses and requirements                                              | training_officer          | `/training/courses`, `/training/requirements`      | ⬜     |
| W26 | A training program: build it, enroll a member, the member's progress  | training_officer → member | `/training/programs`                               | ⬜     |
| W27 | A course cohort: schedule classes, roster, attendance                 | training_officer          | `/training/cohorts`                                | ⬜     |
| W28 | Skills testing: build a sheet, run a test, the member sees the result | training_officer → member | `/training/skills-testing`                         | ⬜     |
| W29 | Compliance: configure requirements, read the matrix, print it         | training_officer          | `/training/compliance-config`, `/training/officer` | ⬜     |
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

- **W01** — the modules step's button reads "Complete Setup & Go to Dashboard"
  but leads to Ranks & Positions, with four steps still to go.
- **W01** — the system-owner step reports a step count that disagrees with the
  progress panel (`AdminUserCreation.tsx`, "Step 7 of 10").
- **W01** — an email step that was skipped is summarised as "Other" on the
  completion page (`SetupComplete.tsx`).
- **W02 / W04** — after a password change the member is returned to the
  sign-in screen with no message saying why.
- **W04** — the password rules are shown only after typing starts.
- **W07** — right after onboarding, the administrator's dashboard fires 403s
  on `/integrations/connected` (four times) and `/scheduling/settings` for
  modules that are off.
- **W08** — several Add Member fields have no programmatic label.

## Log

<!-- One entry per run, newest first:
### W<nn> — <activity> — <YYYY-MM-DD>
Driven as: <roles>. Held: <what worked>. Fixed: <ids>. Flagged: <ids by severity>.
Gate: <clean / what was not run and why>. Next: W<nn>. -->
