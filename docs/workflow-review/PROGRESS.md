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

- **Kiosk and check-in activities** — the member ID card's QR code is
  unsigned JSON (`{type, id, membership_number, org}`) and the id is in every
  profile URL; check whether any scanner treats a scanned code as proof of
  identity rather than a lookup (W10).
- **Any run touching the app shell** — while a password change is required
  (first sign-in, admin reset), the shell and shared hooks fire ~17 requests
  the server refuses with 403, including `POST /errors/log`, so errors from
  that state cannot be reported (W08-6).
- **W11** — "View by Role → Manage Members" saves each member with its own
  request under `Promise.all`; if one is refused the others still land, but
  the page shows only the error and does not reload, so the list is stale
  (read from code in W05, not driven). The base "Member" position also has a
  remove "×" like any other.
- **W79** — tap targets under 44px on the onboarding Modules, Ranks &
  Positions and Apparatus steps at 390px wide (W01-13), and the sign-in
  screen's "Forgot your password?", Privacy and Terms links (W02-5), and
  "Back to Login" on the forgot-password page (36px, W03).
- **W75** — password sign-in, failure, lockout and sign-out never reach the
  audit log, so the audit screen cannot show them (W02-3).

## Log

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
