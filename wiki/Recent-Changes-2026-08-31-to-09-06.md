# Recent changes: August 31 – September 6, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-31_TO_09-06.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-31_TO_09-06.md).
Predecessor: [August 24–31](Recent-Changes-2026-08-24-to-31).

**The headline:** **equipment checklists moved out of Shift Scheduling into
Inventory**, and **everything an officer administers about the schedule moved
into the Administration section** — between them retiring **fourteen
addresses**, thirteen of them with no redirect. Departments can now **name
their own call types**. Gmail and Microsoft 365 email, which **had never been
able to send a message**, now send. There is a new opt-in **Claude (MCP)
integration**. And six upgrade steps **take permissions away** from seeded
positions, one of them unconditionally — read that section even if you skip
the rest.

## Read this first

**If you administer a department:**

- **Bookmarks will break, quietly.** Fourteen addresses no longer resolve and
  land on the dashboard instead of showing an error. If you have links to
  equipment checklists or scheduling settings in a station SOP, a pinned tab or
  a previously-sent email, they need updating. The tables are in
  [What moved where](#what-moved-where).

- **⚠️ End-of-shift reminder notifications already in members' bells carry the
  old checklist address** and will land on the dashboard. New ones are correct,
  and these age out within a few days. It is worth one message to your crews.

- **Six upgrade steps revoke permissions from seeded positions.** Nothing is
  granted back automatically:
  - **`reports.view` is taken off the Member and Firefighter positions.** This
    is why a regular member could open Administration → Reports at all — see
    [Why your members could see Reports](#why-your-members-could-see-reports).
  - **`apparatus.view` is taken off the rank-and-file**, including the
    membership-standing positions (Probationary, Junior, Life, Administrative,
    Social, Exempt) if your department still uses those. Officers, chiefs,
    administrators and the **Engineer** rank keep it.
  - **`integrations.view`, `medical_supplies.view`, `mobile.view` and
    `prospective_members.view`** come off Member, Firefighter, Engineer and
    EMT. Engineer additionally loses `positions.view`, `reports.view` and
    `settings.view`, and its apparatus wildcard narrows to view + maintenance.
  - Two steps **restore** grants the setup screen could never express — four
    EMT grants, and the store-order and equipment-check-submit grants on
    Member.

- **⚠️ One revocation is unconditional, including where you granted it on
  purpose.** The earlier attempts tried to tell a deliberate grant apart from
  the setup screen's mistake, and the test they used **missed every department
  that had switched those modules off during setup** — leaving the problem in
  place for exactly the smallest departments. Nothing in a stored position row
  distinguishes the two, and these grants expose other members' aggregated
  data, so they are now removed wherever they are found. **If your department
  deliberately gave members Reports, grant it again on the positions screen
  after upgrading.** A position you created yourself is never touched.

- **Check any custom position holding `inventory.*`** — typically your
  quartermaster. It now also grants the three equipment-checklist permissions,
  because those moved into the Inventory module. That is deliberate — a
  checklist is a list of inventory items — but if it is wider than you intend,
  replace the wildcard with the specific `inventory.` grants you want. No
  seeded position or rank grants `inventory.*`, so this only reaches positions
  you built yourself.

- **⚠️ If you use Gmail or Microsoft 365 for outbound email, it has never
  worked.** The settings form saved the credentials under keys the sender never
  read, so every message failed after a green "Email settings saved" toast —
  and it failed _in preference to_ a working server-wide SMTP configuration.
  Both now work. **Re-open Settings → Email, confirm the From address and app
  password, and use the new Test Connection button.**

- **The Gmail and Microsoft OAuth Client ID / Secret fields are gone**, and the
  upgrade deletes what was stored in them. They never did anything — no token
  was ever obtained and no send path existed — and the onboarding test reported
  them "valid" on string format alone. **This step does not reverse**, which
  costs nothing, because nothing read those values.

- **Microsoft 365 has a deadline you should know about.** Exchange Online is
  retiring Basic authentication for SMTP submission: unchanged through December
  2026, disabled by default for existing tenants at the end of it, and removed
  in the second half of 2027. An App Password _is_ Basic auth. Settings → Email
  now offers **App registration (OAuth)** alongside it. Nothing changes for a
  working App Password configuration until you choose to move.

- **Your members' Apparatus and Reports pages disappear.** That is the
  revocation above working as intended, not a fault. Expect the question.

**If you are a member:**

- **Equipment checks are no longer a tab on the shift screen.** They are in the
  navigation now, under Operations → **My Checklists**. Officers get **Fleet
  Readiness** beside it. From a shift itself nothing changes: check-in and the
  shift panel still offer "Start checklist".
- **The centre of the phone bottom bar is an Add button.** Training hours, a
  rig check, an action item, a shift report, clocking in, checking into a
  shift, scanning a member ID — two taps from anywhere, where it used to be
  four taps and two page loads.
- **You can see what you have worked this year.** My Shifts has a third view,
  **Hours** — every month of the year with shifts, hours and calls, plus this
  month, this year and an all-time total.
- **You can see who's going to an event, and where you stand on a waitlist**
  ("You're #2 of 5"). You can also RSVP to an event that does not require one,
  which the app used to refuse outright.
- **You choose what colleagues see.** Your profile now has per-field visibility
  for email, personal email, phone, mobile and address.
- **The member roster is a directory again**, not a personnel management table
  — and clicking a row opens the member's profile.
- **Your Send Log is now yours.** It used to list every notification the whole
  department had sent anyone.

**If you integrate with the API:** four notes.
`GET /notifications/logs` and `GET /notifications/my` accept a `cursor` and
return `next_cursor`; `skip` still works but a cursor supersedes it.
`POST /notifications/logs/read-all` **previously always swept the whole
organization and now defaults to the caller** — pass `scope=organization` for
the old behaviour.
`GET /admin-hours/compliance/{user_id}?year=…` now returns **400** for a
non-current year against a quarterly-graded profile, instead of a 200 quietly
missing an item.
`GET /scheduling/eligibility/roster` **no longer accepts the training grants** —
it requires `scheduling.manage`.
`GET /items` gains an optional `unassigned_location` flag for the "no location
at all" population. Everything else this window is additive:
`GET /training/compliance-matrix`, `GET /inventory/summary`,
`GET /store/orders`, `GET /inventory/members-summary` and
`GET /api/v1/scheduling/my-hours-history` all gained fields or optional
parameters without changing what was there.

**If you run the upgrade:** thirty-four migrations, head `d7c1b95e2a40`. Eleven
do not reverse and **none destroys data on the way down**. See
[Database upgrade route](#database-upgrade-route).

## What moved where

### Equipment checklists: Scheduling → Inventory

A checklist is a list of inventory items — a checklist position already pointed
at an item in the catalog, and the lots aboard a truck are drawn from the same
stock — so the feature now lives with the things it tracks.

| Was                                       | Is now                                      |
| ----------------------------------------- | ------------------------------------------- |
| `/scheduling/equipment-check-templates/…` | `/inventory/admin/checklists/templates/…`   |
| `/scheduling/equipment-check-reports`     | `/inventory/admin/checklists/reports`       |
| `/scheduling/supply/expiring`             | `/inventory/admin/checklists/supply`        |
| `/scheduling/equipment`                   | `/inventory/checklists`                     |
| `/scheduling/equipment/checks`            | `/inventory/checklists/log`                 |
| `/scheduling/equipment/{id}`              | `/inventory/checklists/apparatus/{id}`      |
| `/scheduling/apparatus-inventory`         | `/inventory/checklists/apparatus-inventory` |
| `/scheduling?tab=equipment-checks`        | `/inventory/checklists/my`                  |

**Checklists now require the Inventory module.** If your department had
Inventory switched off but uses equipment checks, the upgrade switches it back
on for you. If you later switch it off deliberately, the checklist entries
disappear rather than erroring.

**Checklist settings moved with them**, to Inventory Admin → Equipment
Checklists → Checklist settings. The four that decide when crews are prompted
carried over automatically; nothing needs re-entering. **Four other settings
were removed** — "Enable equipment checks for shifts", "Require signature on
completion", "Block shift start when required items fail" and "Default
expiration warning (days)". Every one was stored, reported as saved, and read
by no code anywhere. There is no signature field on the check form to require,
the warning default was hardcoded at 30 days, and a failed required item never
blocked a shift start. Switching them made no difference before and makes none
now — the app just no longer claims otherwise.

**New:** a shift template can now **name the equipment checklists its shifts
carry**, instead of every shift working them out from its vehicle. Leave them
unticked and nothing changes.

### Scheduling administration → the Administration section

Everything an officer administers about the schedule is now at
`/scheduling/admin`, beside Training Admin and Inventory Admin. It used to be
reachable only from a strip of "Officer tools" on the member-facing scheduling
page, so an administrator opened the schedule to find the settings.

| Was                          | Is now                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `/scheduling/settings`       | `/scheduling/admin/settings/general` (and five sibling sections) |
| `/scheduling/templates`      | `/scheduling/admin/planning/templates`                           |
| `/scheduling/patterns`       | `/scheduling/admin/planning/patterns`                            |
| `/scheduling/reports`        | `/scheduling/admin/reports`                                      |
| `/scheduling/platoons`       | `/scheduling/admin/platoons`                                     |
| `/scheduling/qualifications` | `/scheduling/admin/positions`                                    |

`/scheduling/admin/settings?tab=…` **does** still resolve — it forwards to the
section your parameter names.

**Every scheduling administration page now requires `scheduling.manage`.** The
position roster used to also accept the training grants; **a training officer
holding neither scheduling grant can no longer open it**, and neither can the
API behind it. Nothing in the app has ever linked a training officer to that
page.

### Gear Admin → Inventory Administration

The area had four different names — "Gear & Uniforms Administration" on the
hub, "Gear Admin" in the navigation, "Gear & Uniforms" in the module registry,
"Inventory" in the command palette. It is **Inventory** throughout now.
Screens that really are about gear keep the quartermaster's vocabulary: My
Issued Gear, Gear Requests, Gear Kits.

**Labels only — no route, permission, module key or API value changed**, so
nothing breaks. The one address that did move is the Department Store console,
now at `/inventory/admin/store`, and `/store/admin` redirects to it.

## Pages and connection points

| Area                          | Pages                                                                                                                                                                         | API/data connection                                                                                                              | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Equipment checklists**      | `/inventory/checklists` (Fleet Readiness), `/inventory/checklists/my` (My Checklists), `/inventory/admin/checklists` and its templates / reports / supply / settings children | Permissions renamed `equipment_check.*` → `inventory.check_*`; new table `shift_template_equipment_checks`; `shifts.template_id` | Crews are unaffected at the point of use — check-in and the shift panel still offer "Start checklist", and finalization still refuses to close on outstanding end-of-shift checks. What moved is authoring, reporting and the fleet views. **A position holding `inventory.*` now grants all three checklist permissions.** A shift template naming no checklists resolves from its apparatus exactly as today                                                                                                                                                                                                                                                                                                                                                                                            |
| **Scheduling administration** | `/scheduling/admin` hub, `/planning` (staffing gaps), `/planning/templates`, `/planning/patterns`, `/reports`, `/platoons`, `/positions`, six `/settings/<section>` routes    | `ADMIN_NAVIGATION_PERMISSIONS` gains `scheduling.manage`; roster endpoint narrowed                                               | **Each settings section is its own route**, so it can be linked to, bookmarked, refreshed into and reached with the back button — deliberately unlike Organization and Events, which use `?tab=`. The hub's Short-staffed metric and the planning screen's gap list can disagree for a department that states no crew size anywhere: the hub counts a shift with no stated minimum, the planning list does not. Each is right about the question it answers; the fix is to state a crew size                                                                                                                                                                                                                                                                                                              |
| **Shift planning**            | `/scheduling/admin/planning`                                                                                                                                                  | Reuses the shift drawer's own assignment call                                                                                    | Every upcoming shift carrying fewer people than it asks for, over a date range, **with the assignment on the row**. Filling ten gaps was ten trips through the month grid; it is ten selections now. Same EVOC and overtime advisories, and the same driver-exception dialog — a refusal with no route forward is where a safety control turns into a workaround                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Call types**                | Administration → Scheduling Admin → General → Call types                                                                                                                      | Stored in the organization's settings; `ShiftCompletionReport.data_sources`                                                      | The nine types on the close-out screen have always been per-department data and **nothing in the UI could reach them**. A type with calls or a filed report behind it can only be **retired**, not deleted — the stored value on every filed call is its permanent slug. Retiring every type is how you ask close-out for a bare total with no breakdown. Reports, exports, badges and the summary email now use your names, retired types included. **A report filed under per-incident tracking keeps the officer's own wording** and is never relabelled by a rename                                                                                                                                                                                                                                   |
| **Claude (MCP) integration**  | Integrations → Claude (MCP): connect form and Service key panel; endpoint `/api/mcp`                                                                                          | New table `mcp_service_keys`; new permission `integrations.mcp_keys`                                                             | **Off on every installation until you connect it**, and it answers nothing until an IT administrator mints a service key. 51 read tools. Finance totals, medical-screening _status_ and the full duty schedule are behind three switches, **all off by default**; three write tools behind a read/write switch, also off. Tools you have not switched on are not even listed to the client. **One redaction boundary strips personal information from every result** — contact details, date of birth, emergency contacts, photo, membership and certification numbers, login names, medical results — and scrubs every string of emails and phone numbers so free text cannot carry them out. The key is shown once and stored only as a digest. claude.ai custom connectors need a local bridge for now |
| **Email settings**            | Settings → Email; the onboarding email step                                                                                                                                   | `POST /organization/settings/email/test`; provider presets                                                                       | **Gmail and Microsoft 365 could never send** — credentials went under keys the sender did not read. Both are ordinary SMTP behind an app password now, with host, port and encryption fixed by a preset. **Microsoft 365 gains an app-registration (OAuth) path** ahead of Exchange Online's Basic-auth retirement; it needs the `SMTP.SendAsApp` application permission and `SendAs` on the sending mailbox, and a token Exchange refuses is reported as the mailbox grant rather than as bad credentials, because those are fixed in different places. **Test Connection** signs in without saving. A test result is discarded if you edit the form while it runs                                                                                                                                       |
| **Compliance Matrix**         | Training → Compliance Matrix                                                                                                                                                  | `GET /training/compliance-matrix`, additive fields only                                                                          | The member × requirement icon grid is now a **triage rail** — grouped by standing, worst first, with the numbers behind each status on the row ("6 of 24 hours", "Lapsed 41 days ago"). **A member exempt from a requirement could never reach 100%**, and **a certification expiring soon read as a failure** — a member with 26 days left rendered under "Compliant" reading "1 of 2 met · 1 open item". Both fixed, so **your compliance percentages may move**. Notify and Assign are gone: they had no endpoint behind them                                                                                                                                                                                                                                                                          |
| **Gear requests**             | Gear request form; fulfil picker                                                                                                                                              | `equipment_requests.requested_size`                                                                                              | The form **browses the catalog** instead of demanding you know the department's name for a thing, searches category and product-group names, and shows **one row per product** rather than one per stocked size. Your recorded size is preselected. **You can now ask for gear that is out of stock or not carried at all** — the one need a quartermaster had no other way to learn about. Restricted gear is filtered by the server, so it is no longer listed to people who would be refused                                                                                                                                                                                                                                                                                                           |
| **Events**                    | Event detail; dashboard                                                                                                                                                       | `events.attendee_visibility` per-event override                                                                                  | The going list is now shareable with members — **names and going status only**, never contact details, notes, dietary or accessibility needs, guest counts or check-in times. **The default is managers-only**, so nothing changes until you opt in. **Guests now occupy seats** — `allow_guests` was on the model since the beginning and read nowhere, and capacity counted going _rows_. **A capped event will fill sooner than it used to.** Events already over the seat count are left alone rather than retroactively waitlisted                                                                                                                                                                                                                                                                   |
| **My Issued Gear**            | `/inventory/my-equipment`                                                                                                                                                     | —                                                                                                                                | "Permanent Assignments" and "Issued Items" are one **Issued to Me** list. The split was the stockroom's, not the member's — an assignment is one serialized unit, an issuance is N units from bulk stock, and a member holds both open-endedly with nothing to do differently about either. **Active Temporary Loans stays separate**, because a due date is the one distinction a member has to act on. The dashboard gear widget now counts the same way the page does; the two used to disagree (7 on the rail, 4 on the page, for one locker)                                                                                                                                                                                                                                                         |
| **Notifications**             | Inbox; Send Log tab                                                                                                                                                           | Cursor paging on both lists                                                                                                      | **"Load more" could step over a notification entirely.** A department-wide send is the worst case, not an edge case. **The Send Log used to list every notification the department had sent anyone** — subject, body and recipient address. It is your own delivery history now, offered to every member; the organization-wide view needs `notifications.manage`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Documents**                 | `/documents`                                                                                                                                                                  | Hierarchical folder authorization; paginated listings                                                                            | Folder permissions are now checked **up the whole ancestor chain**, so a restriction on a parent applies to what is inside it. Folder create / rename / delete and document metadata edits now leave an audit trail. Listings are paginated at twelve cards per level and no longer cost one query per folder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Roster lock**               | Shift board; shift detail panel                                                                                                                                               | `shifts.late_signup_until`                                                                                                       | **"Reopen for 15 min" was offered on a shift three weeks gone, and it worked** — a member could sign onto a shift they never worked and draw hours for it. Confirm, decline, remove and withdraw outlived the shift too. All are now bounded by the shift's end plus your grace period, **enforced on the server** and not merely hidden. **A shift with no end time was exempt entirely**; it is now treated as running twelve hours past its start, floored at your `checkin_closes_hours_after` so the roster lock and check-in cannot disagree. `scheduling.manage` remains exempt — correcting an old roster is records work                                                                                                                                                                         |

## Why your members could see Reports

Worth understanding, because it explains most of this window's permission
steps and it will explain the next one too.

The old onboarding position editor did not read the permission registry. It
derived its checkboxes from a rule of thumb — _"a member views every module
whose category is not System"_ — and **its first Continue saved that over the
seeded rows**. A member's effective permissions are the union of their
positions' stored lists, so the rule of thumb's answer became live grants on
every department that onboarded under that code.

Reports is its own module category, so the rule ticked it, and every member got
department-wide reporting. Holding it also opened the Administration section
itself, so the whole admin area appeared for anyone affected.

**Four migrations chased this before one worked**, because the first three
tried to repair only a row that matched the rule's output _exactly_ — and other
migrations edit those same rows first, so a department that onboarded early was
a permission or two off and got skipped entirely. The working one removes and
restores **one permission at a time**.

**New departments no longer create the problem.** Setting up a position now
starts from the registry on both paths, and EMT — which the wizard offered to
every agency type with nothing seeded behind it — is registered properly.

## What was fixed that members will notice

- **Calendar dates read one day early for every department west of UTC.** A
  hire date of 2020-12-06 printed "12/5/2020" in New York — and **named the
  wrong weekday**, which on anything schedule-shaped is worse than a wrong
  number. "Days remaining" counts were one short, in the direction that makes a
  renewal look less urgent than it is. Every date-only field was affected: hire
  dates, certification expiries, due dates, leave dates.
- **The dashboard's Administrative hours read "Unavailable" to every ordinary
  member** — the figure was simply never fetched, on a row beside a control
  that opens a page the member can in fact open. And **an officer's "My Hours"
  card totalled the whole department.** Both fixed. Everything logged _today_
  also fell outside the month.
- **A crew seat read as "EMS" on the schedule and "EMT" everywhere it is
  chosen.** One seat, two names, depending on which screen you were standing
  on. It reached printed rosters, shift-reminder emails and assignment
  notifications too.
- **The event check-in QR code was scannable before its window opened.** It was
  drawn at 40% opacity so the page would be "ready" — but a phone camera reads
  straight through that, so members scanned early and hit a refusal with
  nothing explaining why.
- **Saving a change and seeing the old value come back.** A response already in
  flight when an edit landed wrote the pre-edit body back into the cache it had
  just been cleared from, where it was served as fresh for 30 seconds.
- **Table headings sat about 170px away from their own figures**, on 108
  headers across 37 files — worst in the scheduling reports, the compliance
  officer dashboard and the finance, grants and inventory tables.
- **Settings screens were unusable on a phone**: 36px pills under the 44px a
  finger reliably hits, and on Organization Settings the last section sat off
  the right edge with no way to reach it.
- **Five screens told every member to upload a file, add a member, create an
  event or create a pipeline** — with the buttons beside them already
  officer-only, and in three cases a link to the access-denied page.
- **A wrong MFA code was treated as an expired session**, purging local data and
  hard-redirecting to login instead of saying "invalid code, try again". Loading
  your profile after an interrupted connection could **silently discard unsynced
  shift-report drafts and equipment-check submissions**.
- **Reminders for overdue meeting-minutes action items were failing every
  single time**, with no error visible anywhere. A scheduled department message
  could **vanish forever** if another message in the same batch failed first.
- **"Unlink" on a meeting's linked event never unlinked it** — it said _Event
  unlinked_ and came back on the next page load.

## Who could see what — the disclosure fixes

Tell your officers about these:

- **The notification Send Log** showed every colleague's notifications —
  subject, body and recipient address — to anyone who could open it. Closed;
  the tab is now your own deliveries.
- **Department-wide reporting** was reachable by the rank and file. Closed by
  revoking `reports.view`; see above.
- **The Apparatus maintenance and compliance record** — inspection expirations,
  out-of-service status, deficiency flags, driver qualifications — was open to
  every seeded member position. Now officer-only.
- **Restricted gear was listed to members who would be refused it**, disclosing
  the item's existence. Filtered by the server now.
- **`documents.manage` could bypass a folder's own permissions** on create,
  reparent, move and delete — and a folder delete could cascade-destroy a
  **more-restricted descendant** the caller could never open directly, or an
  entire system tree such as every member's files. Closed.
- **Apparatus sub-folders were gated on _facilities_ permissions** by a
  copy-paste, so an apparatus officer could not open a truck's own manuals.
  Fixed, including the folders already stored.
- **Elections:** ten findings, most of one shape — a name collision between a
  plain position and a ballot item let an emailed ballot vote on a contest it
  was never granted. Also, a member moved onto one of your **own custom
  membership tiers** kept voting rights a restricted ballot meant to exclude.
- **MFA:** a code verified while managing your MFA settings could be **replayed
  at login** for the rest of its ~30–90 second window. Closed, along with a
  concurrency race that let one code complete two independent logins.
- **Session-hijack detection silenced itself after firing once**, because its
  own earlier fix promoted the attacker's IP to trusted. An ongoing hijack was
  detected exactly once and then went quiet.
- **A denied purchase request, expense report or check request could still be
  approved and paid** — the rest of the approval chain stayed pending, and
  approving the last step reversed the denial and charged the budget.

## Database upgrade route

**Thirty-four migrations. Head is `d7c1b95e2a40`.**

Back up, confirm `alembic heads` returns exactly one, then
`alembic upgrade head`.

**Eleven migrations do not reverse, and none of them destroys data on the way
down.** Unlike last window, there is nothing to export first. They fall into
three groups:

| Group                                                                                                                                                                      | Why the downgrade leaves it alone                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dropping the four dead equipment-check settings, unwrapping malformed crew seats, pruning the retired email OAuth keys                                                     | The old shape held nothing worth restoring — the settings were read by no code, the seat wrapper carried no information, and no email OAuth token was ever obtained or stored |
| Closing denied approval chains, clearing stale due dates, removing no-op examiner grants, the three pre-rename position repairs, the call-type provenance and slug repairs | These are data repairs. Reversing them would re-break exactly what they fixed                                                                                                 |
| The position permission repairs                                                                                                                                            | Reversing them would restore grants that were removed precisely because they should not be held                                                                               |

**Several migrations deliberately backfill nothing, and an empty result is not
a bug:** a shift's originating template cannot be recovered (nothing on an
existing shift identifies it, and those shifts keep resolving checklists from
their apparatus exactly as today), a shift template with no named checklists
behaves exactly as it does now, and an event with no attendee-visibility
override inherits the organization default — which ships as managers-only.

## After you upgrade

- **Re-test your email.** If you are on Gmail or Microsoft 365, it has never
  worked; Settings → Email now has a Test Connection button.
- **Re-grant anything the revocations took** that your department genuinely
  needs — especially `reports.view`, if giving members department-wide
  reporting was a deliberate choice.
- **Check any custom position holding `inventory.*`.** It now authors and
  submits equipment checklists.
- **Re-check your compliance percentages.** The Compliance Matrix fixes can
  move them — a member exempt from a requirement can now actually reach 100%,
  and a certification with weeks left no longer counts as a failure.
- **Tell your crews where the checklists went** — Operations → My Checklists —
  and that reminders already in their bells point at the old address.
- **Update any station SOP, pinned tab or saved link** to the fourteen retired
  addresses.
- **Name your own call types** if the built-in nine do not match how your
  department reports. Administration → Scheduling Admin → General → Call types.
  Retire, don't delete, any type with history behind it.
- **Decide whether members may see who's going to an event.** It ships
  managers-only; the switch is an organization default with a per-event
  override.
- **Leave the Claude (MCP) integration off** unless you want it. It is off, it
  needs a key before it answers anything, and its three data switches are off
  independently of that.

## Late additions to this window

Three changes merged after the first draft of this page and fall inside the
same window.

### The inventory items page's location panel agrees with its list _(2026-09-06)_

**Five of the items page's nine filters did nothing.** Location, size, colour,
style and the vendor scope were absent from the reload effect's dependencies,
so picking one changed the request the page _would_ send and never sent it. The
list stayed as it was until an unrelated reload — a websocket event, a bulk
status change — applied a filter nobody had touched since.

That is what made the location cards impossible to reconcile with the list:
they are links into a list that did not respond to them.

Three counting mismatches went with it:

- **The cards counted medical stock the list excludes.** A department running
  both saw a header of "82 items" and an "Unassigned" card reading 52 units
  across 2 items, above a list of 6 items totalling 30 — the difference being
  medical stock with no location filed, counted in the panel and unlistable on
  that page. A location holding only medical stock now gets no card at all.
- **The "Unassigned" card could not filter to what it counted.** It sent the
  empty string, which means _All Locations_ — so clicking it cleared the filter
  it appeared to apply, and its highlight was on whenever nothing was selected.
- **The header counted a different thing from the list.** It summed quantities
  across every domain including medical, over a list that counts rows and
  excludes it.

### A gear request is fulfilled from the variant it named _(2026-09-06)_

A direct consequence of the request-form rebuild earlier in this window. The
catalog collapses rows sharing a product and size/colour/style into one line
and **sums their availability** — that is what turns ten serialized radios into
"Portable Radio — 7 available" rather than ten indistinguishable rows.

The request then stored a single item row out of that line, and fulfilment
narrowed to exactly that row — so **a member could ask for ten against a line
advertising ten and leave the quartermaster looking at the one row holding
one.** Fulfilment now offers the variant's sibling rows, so the options match
the availability the member was shown. A different size, colour, style, product
or organization stays excluded, unchanged.

### Grants & fundraising lists page at the database _(2026-09-05)_

Eleven list endpoints — opportunities, applications, budget items,
expenditures, compliance tasks, notes, campaigns, donors, donations, pledges
and fundraising events — fetched an organization's **entire** matching table
before selecting the requested page in application memory. For a department
with years of donation, donor or grant-application history, every list page
view scanned and loaded the complete history regardless of how small the
requested page was.

Pagination now applies in the SQL query itself. **No response shape or ordering
changed** for any request within the documented row limits, so nothing needs
re-checking after the upgrade — pages simply stop getting slower as history
accumulates.

### Retiring is now the only way to deactivate an item _(2026-09-06)_

**A plain edit could take an item out of active inventory while a member still
held it.**

The dedicated **Retire** action blocks deactivation on an item that is
assigned, checked out, or (for pooled stock) has an unreturned issuance, and
keeps the item's other fields consistent with being retired. The general
item-edit path had none of that — so setting an item inactive, either directly
or by setting its status and condition to retired, removed it from every active
list and picker with no safeguards, and left it in a state where it could still
be handed out again immediately afterwards.

**Editing an item no longer accepts either route.** Retiring is the only way to
deactivate one, and the retire action now re-checks the item's current holder
immediately before deactivating — closing a narrow window in which a member
could be assigned the item an instant before it was retired.

Three knock-on fixes went with it:

- **A medical-supplies manager without broader inventory access lost the
  ability to retire a medical item.** Closing the gap above removed their only
  path, because the retire action existed solely on the general inventory
  permission. Medical supplies now has its own retire action, under the same
  medical-supplies permission every other action on that screen already uses.
- **An item's detail page could show stale stock for consumables tracked by
  lot.** The list view already computed on-hand stock from dated lots; the
  single-item detail page — medical supplies and general inventory alike — did
  not, and could show the item's older quantity figure instead.
- **A department with a large category list could find categories missing from
  pickers.** Category pickers fetch the complete list with no lower page to
  reach, and a low internal cap meant anything past it was silently absent from
  every picker and filter. Raised well above any realistic department's
  category count.
