# Recent changes: August 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's page, and a new month starts a
new page. The engineering audit behind each pass is in
[`docs/CHANGE_AUDIT_2026-08.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08.md).

## Recent changes: August 31 – September 6, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-31_TO_09-06.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-31_TO_09-06.md).
Predecessor: [August 24–31](Recent-Changes-2026-08-24-to-31).

**The headline:** **equipment checklists moved out of Shift Scheduling into
Inventory**, and **everything an officer administers about the schedule moved
into the Administration section** — between them breaking **fourteen
addresses**, none of which redirects. Departments can now **name
their own call types**. Gmail and Microsoft 365 email, which **had never been
able to send a message**, now send. There is a new opt-in **Claude (MCP)
integration**. And six upgrade steps **take permissions away** from seeded
positions, one of them unconditionally — read that section even if you skip
the rest.

### Read this first

**If you administer a department:**

- **Bookmarks will break, quietly.** Fourteen addresses no longer take you
  where they used to, and none of them redirects. Thirteen land on the
  dashboard instead of showing an error; the fourteenth
  (`/scheduling?tab=equipment-checks`) opens Scheduling on its **Schedule** tab,
  because that page still exists and simply ignores the tab that was removed.
  Either way nothing tells the person following the link that the page moved. If you have links to
  equipment checklists or scheduling settings in a station SOP, a pinned tab or
  a previously-sent email, they need updating. The tables are in
  [What moved where](#what-moved-where).

- **⚠️ End-of-shift reminder notifications already in members' bells carry the
  old checklist address** and will land on the dashboard. New ones are correct,
  and these age out within a few days. It is worth one message to your crews.

- **Six upgrade steps revoke permissions from seeded positions.** Nothing
  those six steps take away is granted back automatically (two other steps do
  add grants — see below):
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

### What moved where

#### Equipment checklists: Scheduling → Inventory

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

#### Scheduling administration → the Administration section

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

#### Gear Admin → Inventory Administration

The area had four different names — "Gear & Uniforms Administration" on the
hub, "Gear Admin" in the navigation, "Gear & Uniforms" in the module registry,
"Inventory" in the command palette. It is **Inventory** throughout now.
Screens that really are about gear keep the quartermaster's vocabulary: My
Issued Gear, Gear Requests, Gear Kits.

**Labels only — no route, permission, module key or API value changed**, so
nothing breaks. The one address that did move is the Department Store console,
now at `/inventory/admin/store`, and `/store/admin` redirects to it.

### Pages and connection points

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

### Why your members could see Reports

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

### What was fixed that members will notice

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

### Who could see what — the disclosure fixes

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
- **A member could register an unlimited number of push-notification
  devices**, and every later notification to them fanned out to all of them —
  an unbounded cost with no legitimate reason a real person would approach it.
  Capped at 20 per member; refreshing a device you already have is unaffected.
- **Narrowing a published message's audience could erase the record of who had
  already read or acknowledged it.** A member dropped from a corrected audience
  now keeps their receipt — marked no longer active rather than deleted — so an
  acknowledgment report stays accurate after the audience is adjusted, and
  their access to the message is still correctly withdrawn.
- **A meeting attendance waiver resolved member and grantor names without an
  organization filter.** Not a live leak — the ids always came from an
  org-scoped write elsewhere — but it relied on that staying true, and the
  first write path to skip the validation would have returned another
  department's member name. Both lookups filter directly now.
- **A denied purchase request, expense report or check request could still be
  approved and paid** — the rest of the approval chain stayed pending, and
  approving the last step reversed the denial and charged the budget.

### Database upgrade route

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

### After you upgrade

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

### Late additions to this window

Five changes merged after the first draft of this page and fall inside the
same window.

#### A public form's "one submission per person" limit now holds _(2026-09-06)_

**A form limited to one submission per person could take two from the same
member** if both arrived at the same moment — a double-click on Submit, or the
form open in two tabs. The check that looked for an earlier submission read from
a snapshot of the database taken before the check ran, so two submissions
arriving together each saw "no previous submission" and both were filed.

Submissions already recorded are untouched. If you have a form where you suspect
this happened, the duplicates are still in the responses list and can be removed
there.

**Two things to know before you go looking for this setting.**

- **There is no control for it in the form builder.** The limit lives on the
  form record and is enforced by the server, but nothing on the Forms screen
  writes it, and new forms default to **allowing multiple submissions**. In
  practice that means no department can turn one-per-person on from inside the
  application today — only a caller using the API directly can set it. This is a
  gap, not a change: the fix above hardened enforcement that was already there.
  Recorded in `docs/KNOWN_LIMITATIONS.md`.
- **It applies to the public form link only.** A form filled in from inside the
  application by a signed-in member has never enforced a per-person limit. That
  is long-standing behaviour, unchanged by this fix, and also recorded in
  `docs/KNOWN_LIMITATIONS.md`.

#### The inventory items page's location panel agrees with its list _(2026-09-06)_

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

#### A gear request is fulfilled from the variant it named _(2026-09-06)_

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

#### Grants & fundraising lists page at the database _(2026-09-05)_

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

#### Retiring is now the only way to deactivate an item _(2026-09-06)_

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

## Recent changes: August 24–31, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-24_TO_31.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-24_TO_31.md).
Predecessor: [August 23–24](Recent-Changes-2026-08-23-to-24).

**The headline:** your department now has an **organizational chart** any
member can open, membership records now say **what kind of member** somebody is
separately from **where they sit on the ladder**, the **equipment check
template builder** was rebuilt into one list you scroll, and the **Testing
Checklist became a module that is switched off** — so a department mid-way
through a pre-launch walkthrough will find `/testing` gone until an
administrator turns it back on. Four upgrade steps **take permissions away**
from seeded positions; read that section even if you skip the rest.

### Read this first

**If you administer a department:**

- **`/testing` has disappeared.** The Testing Checklist is now a module and it
  is **off by default**. Settings → Modules → **Testing Checklist** brings it
  back. **Marks held on the server are not lost** — they are still there and
  reappear the moment you switch it on.

- **⚠️ But marks from before the checklist moved to the server are.** The old
  version kept them in the **browser** (`logbook.testing-checklist.v1`) and
  there is no import path. If you are part-way through a walkthrough on an
  older build, **export the run before upgrading**.

- **Four upgrade steps revoke permissions from seeded positions**, and they are
  not granted back automatically (two further steps add new grants):
  - `compliance.view` is taken off the **Member** position.
  - `notifications.view` is taken off the **baseline member and junior rank**
    positions.
  - `facilities.view` is taken off **regular members**, and then off the
    **shared operational officer** positions. Line officers who used to open
    the Facilities workspace will not be able to.
  - `training.configure` is a **new** permission and is granted to the
    positions that configure training.
  - `users.view_consents` is a **new** permission and is granted to the
    Historian and PIO positions.

  If somebody in your department relied on one of the revoked grants, re-grant
  it on a position that is meant to carry it.

- **Every administrative member has had their operational rank cleared.** An
  operational rank is a chain-of-command position and it carries permissions
  with it, so an administrative member holding one held grants that role was
  never meant to have. This does not reverse.

- **You cannot simply set the rank again.** The API refuses the
  administrative-class/rank pair with a 400, and the edit screen disables the
  rank control for an administrative member — a rank carries chain-of-command
  permissions, which is what that class is outside of. If somebody genuinely
  holds an operational rank, **change their class first**, then set the rank.

- **Facility files were readable by the whole department** through the
  Documents module — insurance policies, leases, capital-project files,
  inspection paperwork. The facility _record_ was restricted; the _file_ it
  pointed at was not. Fixed for files uploaded from now on, and existing
  facility **folders** have their permissions corrected on upgrade.

- **⚠️ Files uploaded before the upgrade are not re-filed.** The migration sets
  the folders' permissions; it does not move documents that were already stored
  outside a folder into them, and the app files a document only as it is newly
  attached. **Every facility file that predates this upgrade is still
  folderless, still treated as organization-wide, and still listable and
  downloadable by anyone who can open Documents.** Re-attach or re-file them —
  the upgrade alone does not close it.

- **The compliance configuration page was silently dropping cleared fields.**
  If you ever cleared a setting there and saved, the old value stayed. More
  consequential: a compliance profile whose officer had unchecked _every_
  required requirement was being graded against every active org-wide
  requirement instead of none. **Re-check your compliance percentages after
  upgrading** — they may move.

**If you are a member:**

- **Governance → Organizational Chart** is new and open to everyone signed in.
  It is there so you can work out who runs an area without asking around.
- **Your record now holds two facts where it held one.** "Membership type"
  became **class** (operational / administrative / social) and **status**
  (prospective → probationary → regular → life → retired, plus honorary and junior). A life member who
  still rides, or a probationary treasurer, is now expressible. **The member
  screens still show a single Membership Type selector** — the pair is derived
  from it — so there is nothing new to fill in.

**If you integrate with the API:** `membership_type` is still present, still
correct, and still returned — it is now _derived_ from the new `member_class`
and `member_status` pair rather than being the authority. Nothing was removed
or renamed. If your integration **writes** `membership_type`, move it to the
pair: the derivation is deliberately lossy in one direction, because the old
vocabulary cannot express an administrative probationer. Shift and template
seat objects gained a third field, `allow_administrative_members`; older
readers accept it.

**If you run the upgrade:** forty-five migrations, head `f6a7b8c9d0e1`. Four
do not reverse. See [Database upgrade route](#database-upgrade-route).

### Pages and connection points

| Area                                            | Pages                                                                             | API/data connection                                                                                                                                                                               | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Organizational chart**                        | **`/governance/org-chart`** (new) — outline and diagram views                     | New tables `org_chart_nodes`, `org_chart_node_holders`; `GET /org-chart`, `POST /org-chart/nodes`, `PUT /org-chart/nodes/{id}`, `POST /org-chart/nodes/{id}/move`, `DELETE /org-chart/nodes/{id}` | **Reading needs no permission beyond signing in** — the chart exists for the general membership, and gating it would lock out its audience. Editing needs `orgchart.manage` or `settings.manage`; without either the page is read-only. **A seat can hold several people**, so two deputy chiefs share one box. **A holder need not be a member** — a name with no account covers the town attorney or a mutual-aid liaison. Linking a seat to a position _fills in_ its holders; **unlinking keeps the holders you typed and drops the ones the link supplied**, so a seat whose holders all came from its link goes vacant. The chart starts empty; you draw your own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Membership class, status and qualifications** | Member profile; Members administration; member create/edit; Elections eligibility | New columns `users.member_class`, `users.member_status`; new table `member_qualifications`                                                                                                        | The old single field could not say both things at once, and elections is where it showed. **The built-in voter categories keep their legacy meaning** — `operational` still requires operational class **and** regular standing; an earlier version of this change read the class alone and was reverted the same day because it admitted probationary and retired members to a restricted ballot. Two things did change: **a life member now receives a `regular` ballot** (with one fused field, "life" and "regular" were competing values), and **every status category now also requires the operational class**, so an administrative member with regular standing no longer receives ballots restricted to active or life members — a tightening. **Honorary members become the _social_ class** — that is not a new judgement, it is what the system already did with them. A **qualification** (Firefighter I/II, apparatus operator, EMT, Paramedic) is separate from a rank because qualifications expire and ranks do not; shift eligibility reads the expiry **as of the shift date**, not as of today. **Qualifications are recorded through a course's Certifies field**, never entered directly — so a card a member has held for years needs a matching training record, and setting Certifies on a course does not backfill records already filed against it |
| **Equipment check template builder**            | Scheduling → equipment check templates                                            | `equipment_check_templates.content_revision`; new bulk-delete, clone and reorder endpoints                                                                                                        | Sections, locations and items are now **rows in one list, in the order a crew walks them**. The metadata sidebar, the three-step progress strip, the "Template readiness" card and the Quick Add / Bulk Add toggle are all gone. Adding items is one box per location — type one and press Enter, or paste a list and confirm a preview. Nesting a location is an **indent button**. **When Publish is unavailable the page lists the specific things to fix**, and each one jumps to the row, opens its location and puts the cursor in the empty field. The mobile preview docks beside the checklist **only at 1440px and wider**; below that — tablets and 1366px-class laptops included — the Preview control opens the modal, as it does on a phone. The compact rows and full-height item editor are unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Testing Checklist**                           | `/testing`, **`/testing/report/print`** (new)                                     | New tables `testing_checklist_entries`, `testing_runs`; new module flag `testing`                                                                                                                 | **Off by default**, and not offered during first-time setup — it is a tool for checking an installation, not a decision to make while making every other one. Work is organised into **runs** ("Pre-launch, build 1.4"); starting one **archives** the previous run rather than clearing it. **Every mark is checked against what the app expected** — a page that opened for an account that should have been refused is flagged where you marked it and listed in the report as a permissions defect. Marks record the build, so `Needs re-test` finds the ones made before a deployment. Exports: CSV, a page-by-tester permission matrix, a printable report, and Markdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Facilities**                                  | **`/facilities/settings`** (new, managers only); Facility detail → Files          | Folder gating migration; `FACILITY_ENTRY_PERMISSIONS`                                                                                                                                             | Facility files live in the shared Documents module. They were landing **outside any folder**, and a file in no folder is treated as organization-wide — so the whole department could list and download them. Now filed into the facility's own folder on upload, and the folder carries the same three facility grants. Two officers opening a new facility's Files tab at the same moment could each create a duplicate folder set; that is serialized now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Inventory**                                   | Item detail; return-request review; transfer; receiving                           | Reorder-receiving, return-receipt and request-duration migrations                                                                                                                                 | "Checkout batch" is now **Item Distribution**, and the module's canonical vocabulary is stated in one place — Assignment, Temporary loan, Issuance, Return, Check-in, Transfer, Distribution. **That is the target, not yet every label:** you will still see "Active Checkouts" and "Checkout — returnable individual item" on some screens. **API values are unchanged**; only the labels moved. **Stock received through the reorder workflow now actually becomes issuable** (it previously created a purchase record and never updated on-hand). An item recorded as poor, damaged or out of service **can no longer be returned to service** until a later inspection records a safe condition. The "Transfer is immediate" checkbox is gone — transfers always were                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Department Store**                            | Item detail; sizing request                                                       | Thread-colour, size-order and personalization-method migrations                                                                                                                                   | **Embroidery and engraving are not the same job.** They shared one "customization" field, so an engraved brass plate asked for a thread colour. They are now separate, and the thread swatch appears only where thread is used. Variant sizes sort in **garment order** — `XL` no longer files between `L` and `XS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Communications**                              | **`/messages/:id`** (new); **`/communications/photo-use-consent`** (new)          | Message-recipient and delivery-key migrations                                                                                                                                                     | The message detail page needs no permission beyond signing in — the server only serves a message you were actually sent. An **already-sent department message could go out a second time**; delivery is keyed now, and a **reported send failure is never recorded as delivered**. The photo-use consent roster is readable by the people who publish (`users.view_consents`, or notifications/members/users management) and is excluded from the browser response cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Meetings and minutes**                        | Meeting minutes; meeting records                                                  | —                                                                                                                                                                                                 | **"Unlink" on a linked event never unlinked it.** It showed _Event unlinked_ and the link returned on the next page load. Meeting **minutes** already recorded who changed what; meeting **records** — create, edit, delete, approve, and their attendees and action items — recorded nothing. They do now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Grants & fundraising**                        | Dashboard; campaigns; donors; application detail; reports                         | —                                                                                                                                                                                                 | A report covering a range that **included today** — the default — dropped everything recorded later that same day. The fundraising payment-method breakdown showed **0.0% for every method** as soon as two methods had donations. View-only members were shown New Campaign / Add Donor / New Application / Add Item / Record Expenditure / Add Task / Add Note buttons that failed on click; those are hidden now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Medical supplies**                            | Catalog; summary                                                                  | —                                                                                                                                                                                                 | The summary's **Low Stock count only looked at the first 500 active items** — a department over that size could have a low-stock item missing from the headline figure while listed correctly in the table below. Creating a category or item was recorded in the audit trail; **editing one was not**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### What was fixed that members will notice

- **Creating a new member was completely broken** and failed every time with a
  server error. Fixed.
- **Every member could read every other member's notifications.** Fixed.
- **A member's audit history could show actions performed on someone else.**
  Fixed.
- **Admin hours CSV export** now recovers from an expired session instead of
  downloading a broken file.
- **Bulk edits to a saved checklist** now save every selected item, not just
  the last one.
- **Two approvers acting at the same moment could double-charge a budget**, and
  a budget's cap could be quietly bypassed. Both are serialized now.
- **Two coordinators transferring the same prospect** could create two accounts
  for one person. Serialized.
- **Two quartermasters reviewing the same return request** could overwrite each
  other's decision. Serialized.

### Who could see what — the disclosure fixes

Tell your officers about these:

- **Facility files** — the whole department, through Documents. **Closed for
  files uploaded from now on only.** Files that predate the upgrade are still
  folderless and still downloadable by anyone who can open Documents until you
  re-file them; see the warning above. This is the one item on this list that
  needs you to do something.
- **Notifications** — every member could read every other member's. Closed.
- **Admin-hours progress** — an officer with compliance access could look up
  any member's progress **in any department**. Closed.
- **The finance approvals queue** was scanning every organization's pending
  steps. Closed.
- **A membership applicant's file** could reach a signer who could not
  otherwise view it. Closed.
- **Eight named surfaces** could hold member-identifying data in the browser's
  short-lived response cache for up to 90 seconds — a training cohort's roster, a
  program's enrollment-eligibility list, an external provider's member mappings, a
  form-management page, a raw analytics export, the department-wide competency
  heat map, the training dashboard's at-risk widgets, and the training-session
  approval roster. All are now excluded, and a grants/fundraising list was closed
  as a precaution.
- **Separation of duties** — a storefront manager could settle their own
  order's payment, a finance approval token could approve its own requester's
  request, a secretary could submit _and_ approve their own meeting minutes,
  and a skills-testing officer could void or return their own result. All
  closed.
- **Security monitoring for session hijacking and unusual bulk downloads was
  never actually running** — it looked for the signed-in user before the
  request had been authenticated. Both checks run now.

### Database upgrade route

**Forty-five migrations. Head is `f6a7b8c9d0e1`.**

Back up, confirm `alembic heads` returns exactly one, then
`alembic upgrade head`.

**Five migrations do not reverse.** Four are no-ops where a downgrade that
_did_ restore the old values would be the more destructive option:

| What it does                                                 | Why the downgrade leaves it alone                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clears the operational rank of every administrative member   | Nothing records which ranks this cleared, so restoring them would also restore ranks an officer cleared deliberately                                      |
| Recovers membership standing out of membership positions     | Nothing records which members were reclassified here rather than by an officer; putting them all back would flatten standings a department set on purpose |
| Canonicalizes crew seat names (`EMT` / `EMS` onto one token) | The two spellings really were one seat; splitting them again would have to guess                                                                          |
| Adds `allow_administrative_members` to every stored seat     | Older readers accept the extra field, so there is nothing to undo                                                                                         |

> **⚠️ The fifth destroys data on the way down.** `a7c93f21d5b8` (org-chart
> multi-holder) restores the single-holder shape by keeping **each seat's first
> holder only**, then drops the holders table. Every additional holder is lost,
> and a seat whose holders came only from a position link comes back **empty**.
> **If you have drawn your org chart and might roll back, export the holders
> first.** No other migration in this window destroys data downward.

**Several migrations deliberately backfill nothing, and an empty result is not
a bug:** member qualifications start empty (nothing is inferred from rank — a
department that recorded somebody as an EMT _rank_ has said where they sit, not
which card they hold or when it expires), the org chart starts empty because
you draw your own, and testing runs start empty.

### After you upgrade

- **Turn the Testing Checklist back on** if you were using it (Settings →
  Modules).
- **Re-grant anything the revocations took** that your department genuinely
  needs — especially `facilities.view` for line officers, if that is your
  intent.
- **Re-check your compliance percentages.** The configuration fix can move
  them, and for any group meant to have _no_ required certifications it can
  move them a lot.
- **Do not try to re-set an operational rank on an administrative member** —
  the pair is refused with a 400 and the control is disabled. If the rank is
  right, their **class** is what needs changing first.
- **Draw your org chart.** It starts empty, and it is the one new screen your
  members will actually open. **If you may roll this upgrade back, export
  `org_chart_node_holders` once you have drawn it** — the downgrade keeps
  only each seat's first holder.
- **Warn your quartermaster** that "checkout batch" is now Item Distribution,
  and that received reorder stock is finally issuable.

## Recent changes: August 23–24, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-23_TO_24.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-23_TO_24.md).
Predecessor: [August 19–23](Recent-Changes-2026-08-19-to-23).

**The headline:** members can now claim a shift from the calendar in one tap,
and commit to a recurring one. Officers can issue NFC ID cards and leave a
check-in station running on a tablet. Label printers are registered once and
printed to directly, including the shift roster and the equipment check sheet.
Four administration pages now open with the same frame — four metrics and a
"Needs attention" queue. And **five authorization gaps were closed, four of
them reachable by an ordinary member** — read that section even if you skip the
rest.

### Read this first

**If you administer a department:**

- **Enabling the Department Store during setup used to make setup impossible to
  finish** — the final Continue failed outright. Fixed. If you gave up on
  turning the store on, try again.

- **The Assigned Inventory table has disappeared from member profiles** for
  everyone except quartermasters (`inventory.manage`) and the member
  themselves. This is a fix, not a regression — it was visible to every viewer.
- **Members with `admin_hours.manage` were seeing the whole department's hours**
  under "My Admin Hours" headings. That page now always shows only their own.
- **Nine settings screens changed shape.** The content is the same; the
  navigation is now identical on all of them.
- **Email notifications look different** for departments that press **Reset**
  on a template. Nothing changes until they do.

**If you integrate with the API:** no response shape changed incompatibly, but
one changed **additively** — every scheduling `ShiftResponse` now carries a
`roster` array of its seat occupants. A client that rejects unknown fields, or
that validates against a generated schema, needs to account for it. Nothing
was removed or renamed. Several endpoints are new; see the table below.

**If you run the upgrade:** twelve migrations, head `e7a41b6d09c2`. One does
not reverse. See [Database upgrade route](#database-upgrade-route).

### Pages and connection points

| Area                                | Pages                                                                                                        | API/data connection                                                                                                                                                                                                           | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduling — the board**          | Scheduling → Schedule (month grid + day panel; on a phone a bar grid, a day sheet and a confirmation screen) | New table `standing_shift_claims`; `GET /scheduling/shifts/{id}/trade-candidates`, `POST /scheduling/swap-requests/{id}/respond`, `GET/POST/DELETE /scheduling/standing-shifts`, `GET /scheduling/eligibility/positions/bulk` | Each shift carries a status chip — `2 open`, `Full 4/4`, `You + 2/4` — and one button that claims the first open seat the member is cleared for. Filters **dim rather than hide**, so the month keeps its shape. **A shift that names neither positions nor a minimum staffing level reads as unset, not as an emergency**: grey, headcount instead of a ratio, and out of the open-seat count. Cancelled, finalized and past shifts read as closed. A **training seat cannot be traded** — it carries the trainee's program and evaluating officer                                                                                                                                                                  |
| **Standing shifts**                 | Schedule → a shift → Make this a standing shift                                                              | `standing_shift_claims`                                                                                                                                                                                                       | "Every Tuesday night" is stored as a claim, so giving up one date leaves the series intact. It works in both directions: creating a claim seats you on matching shifts already scheduled, **and** a shift created later seats everyone whose claim matches it. The series is anchored on the shift you started it from, so fortnightly means every other one of _those_. The horizon is yours to pick and defaults to a year out                                                                                                                                                                                                                                                                                     |
| **NFC ID cards & check-in station** | **`/members/check-in-station`** (new); member profile → ID Cards                                             | New table `nfc_tags`; `GET/POST/PATCH/DELETE /nfc-tags`, `POST /nfc-tags/check-in`                                                                                                                                            | **Off until a department enables the `nfc-id-cards` integration.** A card is stored only as a hash — the department cannot read a member's card number back out, and neither can anyone who obtains a database dump. The last four characters are kept so an officer can tell two of a member's cards apart. A station keeps offering a shift until an officer **finalizes** it, not until it ends — checking out has no deadline, so a crew coming off a tour can still tap out. **Retired and on-leave members can still tap in** — they attend meetings and banquets. Suspended, dropped, archived and deleted members cannot. Revoking a card is permanent; a replacement is a new registration                  |
| **Label printers**                  | Settings → Label Printers; inventory labels; **Print** on the shift roster and the equipment check sheet     | New table `label_printers`; `GET/POST/PUT/DELETE /label-printers`, `POST /label-printers/{id}/test`, `GET /label-printers/{id}/status`, `POST /labels/print`, `POST /station-documents/print`                                 | A printer is registered once — host, port, resolution, label stock, command language — instead of typed at every print, and there is no browser print dialog to get wrong. **Two languages: ZPL** (Zebra and ZPL-emulating printers) **and ESC/POS** (receipt-class thermal, some with linerless label media). The choice changes the renderer, the stock sizes offered and the status query. **The server opens the connection, not your browser** — a printer you can reach from your laptop may be unreachable from the server, and registration will still succeed                                                                                                                                               |
| **Administration pages**            | Members, Training, Inventory and Events admin pages                                                          | New table `admin_hub_metric_preferences`; `GET /admin-hub/{module}/summary`, `GET/PUT /admin-hub/{module}/metrics`                                                                                                            | All four now open with a header, **four headline metrics**, a **Needs attention** queue, then the tabs you already know. **Three of the four metrics are your choice**; the fourth is always the count the queue is about, so it cannot be configured away. The department sets a default, and can decide whether individual administrators may keep their own. A department that configures nothing keeps the built-in four — **an upgrade never blanks the page.** Access is the module's own manage permission: an inventory officer cannot read the members queue                                                                                                                                                |
| **Equipment checks**                | Template builder; check form                                                                                 | New column `check_template_compartments.is_sealed`; new table `shift_equipment_check_seals`                                                                                                                                   | A compartment can be marked as **closed with a numbered tamper seal** — a drug bag, a trauma kit. On the check, reading a matching intact seal clears the counting inside in one tap. **It never clears expiry dates or pressure readings**, which move on their own while the bag sits shut. **A seal proves unchanged, not full**: the previous counts carry forward, so a bag that was three morphine short is still three short and still files as a failure. If the seal is broken or the number differs, the seal is still recorded and the contents are counted by hand. Item types collapsed from nine to four — **`level`, `function`, `count`, `expiry`** — and the builder now names what each one stores |
| **Submit External Training**        | `/training/submit`                                                                                           | New `start_time` columns; `POST /training/submissions/with-attachment` and the attachment routes                                                                                                                              | The certificate is attached **with** the submission rather than in a second step that could be skipped. The form asks for a start time and a length; both are now kept, so an officer reviewing a four-hour entry can tell a morning class from an evening one. Entries submitted before this have no start time recorded — that reads as blank, not as 9am                                                                                                                                                                                                                                                                                                                                                          |
| **My Admin Hours**                  | `/admin-hours`                                                                                               | `GET /admin-hours/summary`, now always scoped to you                                                                                                                                                                          | The six-tile grid is gone. A **reporting period** drives both the totals and the entry list, so the two always describe the same window; it **defaults to all time**, because a calendar-year default made "no hours logged this year" look like an empty account. Requirement progress now appears where the department has configured requirements for your profile                                                                                                                                                                                                                                                                                                                                                |
| **Events list**                     | `/events`                                                                                                    | `GET /events/missed-mandatory`; new column `event_rsvps.early_check_in_minutes`                                                                                                                                               | Events are ranked by what they need from you, with a **Needs you** band. **An early check-in is flagged and never credited as attendance** — tapping in at 17:00 for a 19:00 drill records the honest arrival time and tells the event's manager how early it was. Historical check-ins have no early figure recorded, because deciding one after the fact would put a number on the record that was never true                                                                                                                                                                                                                                                                                                      |
| **Department Store**                | `/store`, **`/store/checkout`** (new), My Orders                                                             | Storefront endpoints; route gated on the organization's storefront module                                                                                                                                                     | The catalog, checkout and My Orders were redesigned around the cart. Several setup defects were fixed at the same time: the admin dashboard returned a 500, onboarding's **Enable** button did not actually enable the store, and the position editor stripped store permissions on first save                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Settings**                        | Organization, Events, Scheduling, Elections, User Settings, Email Templates and three more                   | Shared settings shell                                                                                                                                                                                                         | Nine screens carried five different navigation idioms between them. All now use the same one: a section list on desktop, a scrollable tab strip on a phone, and the selected section in the URL so a link opens where you meant. **Save/Reset appears only on sections it actually writes**                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Email templates & notifications** | Settings → Email Templates                                                                                   | New `header_accent`, `status_chip`, `layout` columns                                                                                                                                                                          | Every notification has a new shell. **Existing templates are untouched** until somebody presses **Reset** on one — a department that changes nothing keeps exactly the emails it has today. The editor and its preview are now side by side, and the screen says which notices your department has changed and how heavily each is used                                                                                                                                                                                                                                                                                                                                                                              |
| **Dashboard**                       | `/dashboard`                                                                                                 | `GET /scheduling/dashboard/widgets`, `GET/PUT /scheduling/dashboard/widget-preferences`                                                                                                                                       | Seven staffing tiles — today's staffing, coverage gaps, open slots, pending changes, incomplete closeouts, workload balance, special operations — each linking into the schedule already filtered to what it counted. Each tile keeps its own horizon and filters, per member                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **The installed app**               | Everywhere                                                                                                   | Service-worker precache and update flow                                                                                                                                                                                       | The app never picked up a new version in Brave until the browser cache was cleared by hand. Fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Database upgrade route

Twelve new migrations. **Current head: `e7a41b6d09c2`.** Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.

| Revision       | Adds                                                               |
| -------------- | ------------------------------------------------------------------ |
| `c3e91a7f4d28` | `admin_hub_metric_preferences`                                     |
| `d5b207e4f139` | Sealed-container flag and the `shift_equipment_check_seals` record |
| `c3f81a4d5e72` | Collapses check item types to four                                 |
| `c3b71f0d5a92` | `nfc_tags`                                                         |
| `d5e82c0a7f31` | `event_rsvps.early_check_in_minutes`                               |
| `b3e7f1a92c40` | `label_printers`                                                   |
| `c7d1f4a83e29` | The printer's command language                                     |
| `e4b91c7d2a58` | Merge revision rejoining the two branches                          |
| `e7a41b9c3d85` | `nfc_station` as an admin-hours entry method                       |
| `a71c9d4e5b62` | `start_time` on self-reported training                             |
| `e7c4a913b8d2` | Email template colourway columns                                   |
| `e7a41b6d09c2` | `standing_shift_claims`                                            |

#### Before you upgrade

**One migration does not reverse.** `c3f81a4d5e72` collapses nine equipment
check item types into four. Three old names become `function` and two become
`level`, and nothing records which one a row started as. The downgrade
deliberately leaves the types collapsed rather than guessing — **a wrong guess
renders the wrong control on a safety checklist.** No data is lost either way;
you simply cannot get the old names back.

That migration also **writes an instruction into items that had none.** The
three pass/fail variants differed only in what the crew was asked to do, and
the type name was the only place that instruction lived. An item with an empty
description gets one ("Confirm the item is in place." / "Switch it on and
confirm it works."). **An item whose author wrote their own description keeps
their words.** In the shipped preset library this affected 185 of 232 items.

**Seven of the twelve deliberately backfill nothing**, and it is worth knowing
why so an empty column does not read as a bug:

- Every existing compartment stays **unsealed** — that is what every department
  has today.
- Historical event check-ins get **no early-arrival figure**. Working one out
  would mean deciding what each event's start time was at the moment somebody
  tapped, and an event whose start was edited afterwards would be given a
  number that was never true.
- Historical admin-hours rows recorded as `qr_scan` **stay** `qr_scan`. That is
  what the QR path really wrote; rewriting any of them would invent a
  provenance the database never recorded.
- Training submitted before this release has **no start time**. Blank is the
  truth; 9am would be a guess.
- Existing email templates keep **their own colours**, and render byte for byte
  as they do today.
- **No standing shift claims are inferred** from anyone's existing assignments
  — that would guess a commitment nobody made.
- A department with **no metric preferences** gets its module's built-in four.

### Who sees what — the authorization fixes

Five gaps closed. Four were reachable by an ordinary member, and three of those
rested on the same mistake: **gating on a permission that every member holds.**

| What was visible                                                                                           | To whom                                            | Now                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member's assigned gear — turnout coat, radio, SCBA mask — and its condition, on **every** member profile | Every viewer                                       | `inventory.manage`, or your own profile. A member profile is a directory card; what somebody signed for is quartermaster business                                                                                                                 |
| Department-wide inventory counts, low stock and overdue checkouts on the dashboard                         | Every member                                       | `inventory.manage` or `settings.manage`                                                                                                                                                                                                           |
| Your own membership application, through the prospect widget's counts and details                          | Anyone reviewing intake who had themselves applied | Excluded from the totals, the aging buckets and the details list                                                                                                                                                                                  |
| Medical-screening compliance and the members attention queue                                               | Anyone with `members.manage`                       | Also requires `medical_screening.view`. Without it the tile reads **unknown** rather than vanishing — an absent tile invites a second look, a stated unknown does not                                                                             |
| —                                                                                                          | —                                                  | **Position eligibility is now enforced when a scheduler assigns somebody**, not only when a member claims their own seat. A department that configured which ranks may run a position had that ignored on the write path that seats everyone else |
| —                                                                                                          | —                                                  | **A check submitter can no longer move unlimited stock onto a truck.** A swap is bounded by the lot it replaces, and that lot must actually be aboard                                                                                             |

**`inventory.view` and `prospective_members.view` are part of the baseline
Member position.** A check for one of them says only "this person signed in".
If you write or review an authorization check, that is the trap.

### Not yet available

- **Walking an equipment check as a lap** — stop by stop, in walking order — is
  built and tested but **not connected to the live check screen**, which still
  shows the flat compartment list. Do not expect it after this upgrade.

### Known limitations opened this window

- **The setup wizard's per-module "configure permissions" step does nothing.**
  Fifteen module cards point at it. It says _"permissions configured!"_ and
  discards the answer — nothing submits it and no backend field corresponds to
  it. **Do not use it to restrict a module during setup**; set the permissions
  on the positions themselves afterwards. The Department Store's route was
  removed in this window rather than repaired. Tracked as **ONBOARD-1**.
- **Self-report certificates have no retention policy and are not scanned for
  malware.** They are validated by magic bytes and stored under a
  server-generated name, so nothing is executed server-side, but a file served
  back to an officer is whatever the member uploaded. Approved certificates are
  kept indefinitely, which is what a training record is for — expiring them
  needs a records-retention decision from the department before it needs code.

Full detail in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).

## Recent changes: August 19–23, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-19_TO_23.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-19_TO_23.md).
Predecessor: [August 17–19](Recent-Changes-2026-08-17-to-19).

**The headline:** departments can now write and publish their own privacy
notice and terms, with publishing held behind a second permission. Equipment
checks became safe to retry — one check per shift is now a database rule, so
a crew that completes an inspection in a dead spot no longer creates a
duplicate when the phone reconnects. Dialogs on a phone are finally tappable
all the way to the bottom. And two scheduling endpoints changed shape, which
will break anything reading them as a plain list.

### Read this first if you integrate with the API

`GET /scheduling/swap-requests` and `GET /scheduling/time-off` **no longer
return an array.** They now return:

```json
{ "items": [...], "total": 0, "skip": 0, "limit": 50 }
```

Anything treating the response as a list — a script, an export, a dashboard —
needs updating.

### Pages and connection points

| Area                         | Pages                                                                                 | API/data connection                                                                                                                                                                                        | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Governance — Legal Documents | **`/governance/legal`** (new). What it publishes is what `/privacy` and `/terms` show | New table `legal_document_revisions`; new grants `legal.propose`, `legal.publish`; `GET /legal-documents`, `POST …/revisions`, `POST …/revisions/{id}/publish`, `POST …/{document_type}/revert-to-default` | **Proposing and publishing are separate permissions** — `legal.propose` drafts, `legal.publish` makes it public. One published revision per document at a time. Old revisions are archived, never deleted, because a records request asks what the notice said _on a date_. The reason for a change is required, not optional. The "Last updated" line is free text and is never parsed — date it however your records officer does                                                                                                                                                                    |
| Equipment checks             | Shift detail → equipment check; template builder; compartment tree                    | New table `equipment_check_bulk_requests`; new column `shift_equipment_checks.client_submission_id`; two new unique constraints                                                                            | **One check per shift per template, enforced by the database.** A retry, a double tap, or an offline queue replaying on reconnect now resolves to the same check instead of creating a second. Standalone (non-shift) checks still accept `equipment_check.submit` as well as `equipment_check.manage` — ordinary members keep the ad-hoc check they had. Expired-equipment failures are decided from authoritative inventory at submission rather than from what the phone claimed, then stored; a lot expiring later does not retroactively fail an earlier check. Deep nested storage paths now fit |
| Dashboard                    | `/dashboard`; chief operations; organization asset widgets; training-officer widgets  | `GET /dashboard/widgets?period=`, `GET /dashboard/operations`, `GET /dashboard/asset-widgets`                                                                                                              | Each section is authorized independently, but the three endpoints differ: **operations** and **asset widgets** leave out what you cannot see, while **`/dashboard/widgets`** returns those sections as `null`. Only the operations endpoint checks both module and permission throughout. `settings.manage` is deliberately **not** money access: totals need `finance.manage`, fundraising needs `fundraising.view`, outreach needs `events.manage`. Asset widgets carry counts and links only — no facility codes, accounts, budgets or leases                                                       |
| Scheduling — requests        | Scheduling → Requests                                                                 | `GET /scheduling/swap-requests`, `GET /scheduling/time-off` now paginated                                                                                                                                  | **A requester can no longer review their own swap or time-off request, even holding `scheduling.manage`.** On a small department the officer requesting the swap is often the one who can approve it; a permission is not a second person. Requests are also restricted to their participants                                                                                                                                                                                                                                                                                                          |
| Mobile — dialogs             | Every dialog, drawer and bottom sheet on a phone                                      | `useOverlaySurface`; `modal-panel-scroll`                                                                                                                                                                  | The bottom navigation now **hides while an overlay is open**. It previously painted over dialogs and swallowed their taps — the buttons were untappable rather than merely hidden, and the tap navigated the page out from under the dialog                                                                                                                                                                                                                                                                                                                                                            |
| Browser tabs                 | Every page                                                                            | `RouteTitleManager`                                                                                                                                                                                        | Tabs now carry the page name instead of a generic app title, so several Logbook tabs are finally distinguishable. Titles work in background tabs, and a slow page never shows the previous page's name                                                                                                                                                                                                                                                                                                                                                                                                 |
| Events                       | Event type picker; pipeline board; event detail                                       | New `recruitment` event type                                                                                                                                                                               | Open houses and recruitment nights get their own type, so a pipeline stage can point at "the next recruitment event" without matching every fire-safety demo. New recruitment events **default to guest sign-in** — a recruitment event whose attendees never reach the pipeline has not recruited anybody. The event page shows who it brought in                                                                                                                                                                                                                                                     |
| Exports                      | Every CSV in the product                                                              | One shared escaper                                                                                                                                                                                         | A member named `Smith, John` no longer shifts the columns after them in the attendance export. Spreadsheet formula characters are neutralized everywhere, and blank cells no longer pick up a stray apostrophe                                                                                                                                                                                                                                                                                                                                                                                         |

### Database upgrade route

Eight new migrations. **Current head: `a17c4e9d2b61`.** Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.

| Revision                        | Adds                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `1eeb053d59b7`                  | Normalizes crew seat lists to one stored shape                                   |
| `7ed8593bc904`                  | Repeats a storage-area barcode backfill that a revision-id collision skipped     |
| `5c2f6a8b1d34`                  | Creates `push_subscriptions` where a collision skipped it                        |
| `d6f4a13c9e20` / `4c8d7e2a91b3` | Widen `shift_equipment_check_items.compartment_name` to `TEXT`                   |
| `9f6d1c2a4b70`                  | Makes `documents.file_name` / `file_path` nullable on already-upgraded databases |
| `06adc68a8b84`                  | `legal_document_revisions` + the `legal.propose` / `legal.publish` grants        |
| `5223a69474b8`                  | The `recruitment` event type                                                     |
| `8a4f2d1c9b30`                  | `equipment_check_bulk_requests`                                                  |
| `9bb38ab9b052`                  | Merge revision rejoining five heads                                              |
| `a17c4e9d2b61`                  | One-check-per-shift constraints; `client_submission_id`                          |

#### Two things to know before you upgrade

**Three of these migrations repair a database that believes it is already
up to date.** Three earlier migrations were released under one revision id
and later renumbered, so a database upgraded during those windows carries a
valid stamp for work that never ran. The stamp cannot tell the two histories
apart, so the repair simply repeats the work, guarded by schema inspection.
On a healthy database all three are no-ops.

**Two migrations do not cleanly reverse — but neither destroys data.**

- `1eeb053d59b7` expands a legacy seat `count` into that many seats. Its
  downgrade is a deliberate **no-op**: the original count cannot be worked out
  from the expanded seats, so it leaves them alone rather than guessing.
  Downgrading loses nothing — it just does not put the old shape back.
- `a17c4e9d2b61` keeps one equipment check per shift and template, preferring
  a completed check and then the earliest one. **Duplicates are detached, not
  deleted** — their item snapshots are kept and a note explains what happened
  — but the downgrade cannot re-attach them, because a later check may now
  own that slot.

**Also:** downgrading past _both_ `compartment_name` widenings narrows the
column back to `VARCHAR(200)` and will truncate deep storage paths.

### What Legal Documents does and does not store

The **live wording** your members and the public see stays where it always
was, in the organization's own settings, so the public pages load with no
sign-in and no database join. The new table is the **governance record
around** it: who proposed which wording, what rule they were addressing, who
published it, and what the page said before.

That split is the point. A department can already see its current notice. What
it could not do before is answer the question a records request actually asks,
which is what the notice said on a given date.

Deleting the member who drafted or published a revision does not delete the
revision — the wording published on a date is a department record and outlives
the account.

### Sign-in, permissions and who sees what

Two new permissions this window, both for Legal Documents:

| Permission      | Grants                                                              |
| --------------- | ------------------------------------------------------------------- |
| `legal.propose` | Read the current notices and draft alternatives. **Cannot publish** |
| `legal.publish` | Publish a draft, and revert a document to the platform default      |

`settings.manage` also reaches the screen, for departments that do not want a
separate role.

### Known limitations opened this window

- **The main dashboard widget registry is mostly unread.** Eight widgets are
  declared; one is used. Five of the eight aggregate paths have no backend
  endpoint. Nothing is broken — nothing calls them — but the file reads as
  authoritative. Tracked as **DASH-1**.
- **`compartment_name` is widened by two separate migrations.** Harmless on
  upgrade, asymmetric on downgrade. Tracked as **SCHEMA-1**.

Both are in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).

## Recent changes: August 17–19, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-17_TO_19.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-17_TO_19.md).
Predecessor: [August 15–16](Recent-Changes-2026-08-15-to-16).

**The headline:** a department that does not run incident reporting can now
record call volume — enough for a grant application or an ISO rating, and
deliberately nothing that would make the record PHI. Closing out a shift became
a three-step wizard that survives a locked phone. Separately, NFC tags now work
across events, admin hours and shift check-in.

### Pages and connection points

| Area                          | Pages                                                                                                                                                                         | API/data connection                                                                                                                                                         | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling — call volume      | Scheduling → Settings → General → _Shift close-out rules_ → **Record a call count at close-out**; Reports → Call Volume                                                       | New tables `org_calls`, `org_call_responses`; org setting `scheduling.call_tracking.{mode,call_types}`; `GET /scheduling/reports/call-volume` gains `counts_unit_responses` | Three numbers that are **not supposed to add up**: department volume (one call however many units rolled), apparatus runs (unit responses), member credit (per person). Blank ≠ 0. 100 calls per shift is a hard cap. A department that has never touched this setting keeps per-incident logging — absence means today's behaviour, never "off". |
| Scheduling — close-out wizard | Shift detail → **Close out shift**                                                                                                                                            | New column `shifts.closeout_step`; `GET /scheduling/shifts/{id}/closeout`, `PATCH …/closeout/attendance`, `PATCH …/closeout/calls`                                          | Each step saves as it advances, so a phone locking at 0700 resumes where it left off. Only count-only departments see the wizard; everyone else keeps the single finalize checklist unchanged. Reopening a finalized shift restarts the wizard.                                                                                                   |
| NFC tags                      | `/events/:id/qr-code`, `/admin-hours/categories/:id/qr-code`, `/locations/qr-codes`, shift detail QR block; **Tap Tag** on Events, My Admin Hours and the scheduling calendar | `constants/nfc.ts` target registry; Web NFC                                                                                                                                 | A tag is untrusted input: the payload is resolved against the app's own origin, only known routes are accepted, and the route handed to the router is **rebuilt** rather than the raw string. `/display/:code` is deliberately not taggable — that code is a check-in credential. Chrome on Android over HTTPS only.                              |
| Upgrades                      | — (CLI)                                                                                                                                                                       | `python -m app.preflight`, `--compose PATH`                                                                                                                                 | Answers "will this configuration start?" **before** the restart that would otherwise find out by losing the service. Run it with `--build` and the same `-f` files the deployment uses, or it answers about a configuration nobody runs.                                                                                                          |
| Sign-in                       | Login, forgot password, the two public forms                                                                                                                                  | Breached-password lookup; suspicious-IP throttle; CAPTCHA                                                                                                                   | The breach lookup **fails open** (it is supplementary — complexity, history, MFA and lockout still apply); CAPTCHA **fails closed** (nothing sits behind it). Lockout responses are generic by default. Account lockout is per-user and so does not cover password spraying; the per-IP throttle does.                                            |
| Privacy                       | `/privacy`, `/terms`                                                                                                                                                          | Static content, rewritten                                                                                                                                                   | The department, not the platform, is the data controller, and the notice now says so up front. Print stylesheet extracted; accessibility pass on both.                                                                                                                                                                                            |
| Dashboard                     | `/dashboard` on a phone                                                                                                                                                       | —                                                                                                                                                                           | The week strip and alert list collapse on narrow screens; the phone line counts the whole week, not the visible slice.                                                                                                                                                                                                                            |

### Database upgrade route

Two migrations, both additive and introspection-guarded, neither backfilling:

| Revision                    | Adds                              |
| --------------------------- | --------------------------------- |
| `82bdcb3b1e64` (2026-08-18) | `org_calls`, `org_call_responses` |
| `2827079fd66c` (2026-08-19) | `shifts.closeout_step`            |

They sit on top of `8050e5a61f34`, the 2026-08-17 rejoin that collapsed the four
heads left by concurrently-merged pull requests. **Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.**

An organization that has never used count-only tracking gets two empty tables
and a NULL column. Every existing report keeps reading the source it already
read.

### What the call tables deliberately do not hold

No address, no cross streets, no patient or caller identity, no narrative, no
dispatch/on-scene/clear times, and no CAD incident number for display. Those
are the fields that make a call record PHI, and collecting them is what a
department choosing this mode declined to do.

It is enforced by absence — there is no field to type one into and no column to
store it in. `call_date` is a **date, not a timestamp**, because a timestamp
would let response times be reconstructed, which is the first step back toward
an incident record.

### Reading the call-volume report correctly

In count-only mode the report says **Unit Responses**, not **Total Calls**.
That is not cosmetic. Until the cross-unit attach picker ships, two units that
closed out independently each reported their own call, so the figure counts an
incident once per responding unit.

**Do not put that number in a grant application as a department call count.**
Either wait for the picker, or reconcile mutual responses by hand.

### Operational notes

- **Enabling _Record a call count at close-out_ takes effect immediately in the
  admin's own browser** — but **anyone already signed in must reload**. A
  session opened before the change keeps the settings it loaded at sign-in, so
  that officer still sees the old checklist, which never asks for a call count
  while the backend has already switched. A shift closed from a stale tab
  finalizes with no calls recorded. Flip it at a shift change, and tell working
  officers to refresh.
- **A count-only department that enforces end-of-shift equipment checks can
  still close out.** The wizard carries the override and its logged reason, and
  the pass-down notes field, because it replaces the checklist rather than
  sitting beside it.
- **Only assigned and confirmed crew appear in close-out.** Declined, pending
  and no-show members are excluded — every listed member otherwise takes the
  apparatus's full call count by default.
- **Correcting a shift's date or apparatus after close-out moves its calls with
  it.** The totals were always right; before this fix the daily and
  per-apparatus reports pointed at the wrong day and the wrong truck.

### CI note for contributors

An unbounded `apt-get` in six CI job instances stalled for 19m26s on 2026-08-19
and consumed the entire 20-minute budget of two backend jobs. Because the
integration and contract matrices sit behind `needs:`, they reported **skipped**
rather than failed — so a merge reached `main` with no backend test having run
and nothing red to react to.

The install is now a script that skips apt entirely when the library is already
loadable, and otherwise retries under one 240-second deadline covering every
attempt. Backend database setup for the integration and contract jobs is a
single composite action rather than two verbatim copies.

## Recent changes: August 16–17, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is available in the source repository at
[`docs/CHANGE_AUDIT_2026-08-16_TO_17.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-16_TO_17.md).
Predecessor: [August 15–16](Recent-Changes-2026-08-15-to-16).

**The headline for administrators:** three new anti-brute-force controls (two
of them opt-in), one permission that tightened and **will** lock people out
until it is regranted, and an Alembic chain that briefly had four heads.

### Pages and connection points

| Area                                     | Pages                                                                                        | API/data connection                                                                                                                | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Challenge-response (CAPTCHA)**         | Forgot password; public form submission. **Not** guest check-in                              | `GET /api/v1/auth/captcha-config` (anonymous, returns provider + public site key only); token sent in the `X-Captcha-Token` header | Off by default. **Fails closed** — if the provider is unreachable, submissions are refused; that is deliberate, since nothing else guards these two forms. Turning it on **without a secret key** logs an error and enforces nothing rather than refusing everything. Turning it on also widens the Content-Security-Policy for the provider's widget; with it off the policy is unchanged. A rejected submission resets the widget (tokens are single-use). Guest check-in is excluded on purpose — it is reached by scanning a QR code on a station display. |
| **Breached-password rejection**          | Registration; change password; reset by token; admin creates a user; admin resets a password | Have I Been Pwned range API. Only the **first five characters** of the password's SHA-1 leave the deployment                       | Off by default (it needs outbound internet). **Fails open** — if the lookup fails, the password is accepted, because complexity rules, password history, MFA and lockout still apply and a third-party outage must not stop a department setting passwords during an incident. The rejection deliberately does **not** say how many times the password was seen.                                                                                                                                                                                               |
| **Suspicious-IP throttling**             | All sign-in surfaces (no new screen)                                                         | Redis counters per IP; wired into `/auth/login`, `/auth/mfa/login`, and the pre-verification challenge rejections                  | **On by default**: 50 failed attempts per IP per hour, 15-minute block. Counts failures across _all_ accounts, which is the gap a password spray walks through. A **fully** successful sign-in from that IP clears the counter, so a station's shared connection does not drift into a block on ordinary typos — but a correct password alone does not clear it, and clearing never lifts a block already in force.                                                                                                                                            |
| **Platoon Management**                   | `/scheduling/platoons`                                                                       | `GET /scheduling/platoons/overview` now requires **`scheduling.manage`** (was `scheduling.view`)                                   | ⚠️ **Breaking for existing users.** `scheduling.view` is implicit for every member, so the department-wide platoon roster was effectively public inside the department. Anyone who reached this page before and does not hold `scheduling.manage` will now see a permission error. Grant `scheduling.manage` to the roles that need it.                                                                                                                                                                                                                        |
| **Shift detail — availability roster**   | Shift detail page                                                                            | `GET /scheduling/shifts/{id}` → `platoon_roster`                                                                                   | The hold-over roster is derived from **who is on approved leave**, so it is now returned only to `scheduling.assign`, `scheduling.manage`, or the shift's own shift officer. Everyone else sees an empty roster; all other shift details — time, apparatus, assignments, check-in — are unchanged.                                                                                                                                                                                                                                                             |
| **Generated platoon shifts**             | Scheduling → generate from pattern                                                           | Generation filters active members correctly                                                                                        | Soft-deleted and anonymized members were being staffed onto generated shifts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Scheduling → Patterns**                | Patterns tab                                                                                 | —                                                                                                                                  | A pattern whose stored configuration held a malformed platoon list crashed the tab. It now renders with that list treated as empty.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Prospective members — form stages**    | Pipeline stage of type "form submission" with auto-advance                                   | Advance is bound to the submitting prospect                                                                                        | **One applicant's submission used to advance every prospect sitting on that step.** Now only the person who submitted advances, and the history entry records which submission caused it.                                                                                                                                                                                                                                                                                                                                                                      |
| **Prospective members — stage approval** | Pipeline stage approval                                                                      | `/approve-step`                                                                                                                    | A member can only sign off with a role **the stage actually asked for**. Previously any member could record their own position as an approval on any prospect. A stage with no approver roles configured is now refused instead of completing outright.                                                                                                                                                                                                                                                                                                        |
| **Meeting minutes**                      | Minutes page cards                                                                           | Attendee and action-item counts                                                                                                    | Cards read "0 attendees · 0 action items" over meetings whose detail view showed real numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Dashboard readiness**                  | Dashboard                                                                                    | Certification and screening reads                                                                                                  | A **renewed** certification no longer grounds the member — only the newest credential per course counts. Screenings are judged on the same 60-day window as certifications (they were on 30), including one lapsing today. A failed screening load now clears the counts rather than leaving "Clear to respond" standing on stale data.                                                                                                                                                                                                                        |
| **Driver / EVOC enforcement**            | Shift assignment; pattern generation; shift edit; exception review                           | `driver_exceptions` table                                                                                                          | Certification expiry is judged on the **shift's** date, not today. Recurring pattern generation no longer bypasses the block — it leaves an unqualified driver's seat empty and reports the skip. Changing a shift's apparatus or date revalidates the drivers already on it. Two chiefs reviewing the same exception at once no longer both succeed. Deleting an apparatus now removes the exception written for it, rather than turning it into a fleet-wide grant.                                                                                          |
| **Medical supplies — alerts**            | Low-stock / expiring-supply emails                                                           | Per-domain recipient grouping                                                                                                      | An EMS supply officer no longer receives gear item names and counts in the alert body. Someone holding both grants gets **one** complete email, not two partial ones.                                                                                                                                                                                                                                                                                                                                                                                          |
| **Medical supplies — On hand**           | Edit supply                                                                                  | —                                                                                                                                  | For a lot-stocked item the "On hand" box wrote a value nothing displayed: the count comes from its lots. The field now shows the lot figure and points to **Receive delivery**.                                                                                                                                                                                                                                                                                                                                                                                |
| **Inventory — Impact Planner PDF**       | Export PDF                                                                                   | —                                                                                                                                  | Names containing `<` or `&` corrupted or failed the export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Inventory — CSV import**               | Gear Admin → import                                                                          | Unmatched-vendor report                                                                                                            | Spelling variants of one name are reported once, not three times. A name matching a **deactivated** vendor now links to it instead of sending you to a form that would reject it. A name is only reported once its row actually imported.                                                                                                                                                                                                                                                                                                                      |
| **Installed app (PWA)**                  | Settings → App → Force refresh                                                               | `/version.json` probe                                                                                                              | Force refresh now **refuses to run when the server is unreachable** and says so. Running it offline used to delete the app's only offline copy and reload into nothing.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Setup wizard**                         | Onboarding                                                                                   | CSRF token in tab-scoped storage                                                                                                   | Two onboarding tabs can no longer overwrite each other's token. Clients still holding the old cookie are migrated automatically.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Logging**                              | —                                                                                            | —                                                                                                                                  | Exception tracebacks no longer include local variable values, which on a password or token frame meant the credential itself in the log file.                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Configuration added

All of these live in `.env` — see
[Configuration → Security](Configuration-Security) for the full descriptions.

| Variable                            | Default        | Notes                                                      |
| ----------------------------------- | -------------- | ---------------------------------------------------------- |
| `SUSPICIOUS_IP_THROTTLE_ENABLED`    | `true`         | The only one of these that is on out of the box            |
| `SUSPICIOUS_IP_MAX_FAILURES`        | `50`           | Failed attempts per IP per window                          |
| `SUSPICIOUS_IP_WINDOW_SECONDS`      | `3600`         |                                                            |
| `SUSPICIOUS_IP_BLOCK_SECONDS`       | `900`          |                                                            |
| `BREACHED_PASSWORD_CHECK_ENABLED`   | `false`        | Needs outbound HTTPS                                       |
| `BREACHED_PASSWORD_MIN_COUNT`       | `1`            | Appearances before rejecting; 1 rejects anything ever seen |
| `BREACHED_PASSWORD_API_URL`         | HIBP range API |                                                            |
| `BREACHED_PASSWORD_TIMEOUT_SECONDS` | `3.0`          | On timeout the password is accepted                        |
| `CAPTCHA_ENABLED`                   | `false`        |                                                            |
| `CAPTCHA_PROVIDER`                  | `turnstile`    | `turnstile` \| `hcaptcha` \| `recaptcha`                   |
| `CAPTCHA_SECRET_KEY`                | —              | Enabling without this enforces nothing                     |
| `CAPTCHA_SITE_KEY`                  | —              | Public; served to the browser                              |
| `CAPTCHA_TIMEOUT_SECONDS`           | `5.0`          | On timeout the submission is **refused**                   |
| `CAPTCHA_MIN_SCORE`                 | `0.5`          | reCAPTCHA v3 only                                          |

### Database upgrade route

The window opened at a single head (`20260816_0005`) and closed at a single
head (`8050e5a61f34`), by way of a four-head fork that made the migrations
directory unloadable for about an hour.

Two branches both revised `20260816_0005`: `20260816_0006` (shift-finalization
backfill) and `20260816_0007` (email preference unification). Five pull
requests each noticed the fork and each wrote a merge for it; all five merged
within the hour, leaving four heads and two files claiming revision id
`20260816_0008`.

**What to do:** pull the current `main` and run `alembic upgrade head`. If you
pulled between roughly 17:30 and 18:50 UTC on 2026-08-17, your checkout's
migrations directory may not load at all — pull again. **No database recovery
is needed**; the broken state prevented migration rather than corrupting
anything.

Two schema changes landed in the window:

| Revision        | What it does                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0008` | Creates `driver_exceptions` — chief-approved exceptions to the EVOC driver requirement, with justification, restrictions, a validity window and review fields |
| `20260816_0009` | Adds `previous_status`, `phase_before_id`, `phase_after_id`, `completion_credit_id` for reversible training completions                                       |

`driver_exceptions.apparatus_id` deletes with its apparatus (`ON DELETE
CASCADE`). That is intentional and is the safe direction here: an exception
whose apparatus reference was nulled looks identical to a blanket fleet-wide
grant, so retiring a truck would silently widen an authorization. The audit
log retains the approval record.

Standard procedure is unchanged: back up, confirm `alembic heads` returns
exactly one result, then upgrade.

### Administrator checklist

1. **Regrant `scheduling.manage`** to whoever needs Platoon Management. This
   is the one change in the window that removes access someone already had.
2. **Decide on CAPTCHA.** If your public forms or password-reset page are
   reachable from the internet, this is the control that stops a paced bot.
   Remember it fails closed — a provider outage means those two forms refuse
   submissions until it recovers.
3. **Decide on breached-password checking.** It needs outbound HTTPS to the
   HIBP range API. Only five characters of a hash ever leave the deployment.
   If your deployment cannot make outbound requests, leave it off — it will
   simply accept every password rather than erroring.
4. **Check the suspicious-IP threshold against your roster.** 50 failures per
   hour from one IP is generous, but a large department behind a single NAT
   egress should confirm it suits them. A successful sign-in from that IP
   clears the counter.
5. **If you front the app with a reverse proxy on a different origin,** make
   sure `X-Captcha-Token` survives it. It is in the application's own CORS
   allowlist; a proxy with its own header allowlist needs the same entry.

## Recent changes: August 15–16, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is available in the source repository at
[`docs/CHANGE_AUDIT_2026-08-15_TO_16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-15_TO_16.md).
Predecessor: [August 12–14](Recent-Changes-2026-08-12-to-14).

### Pages and connection points

| Area                        | Pages                                                                                                                                          | API/data connection                                                                                                                                                                                       | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facilities — nested rooms   | Facility detail → Rooms (tree, sub-room counts, add-a-room-inside); room form "Located inside" picker; Events/Training/Scheduling room pickers | `facility_rooms.parent_room_id` (self-FK, SET NULL); `GET /api/v1/facilities/rooms` returns `parentRoomId`, accepts `parent_room_id` / `top_level_only`; linked Location names carry the containment path | Parent must be same organization **and** same facility; no cycles; five levels maximum. Deleting a room moves its sub-rooms up one level — never deletes them. Moving a room to another building carries its subtree and re-points the linked Locations. A room with a missing parent shows at top level instead of vanishing. Clearing a form field now persists (explicit nulls). |
| Elections                   | Election detail candidate list                                                                                                                 | `GET /elections/{id}/candidates`                                                                                                                                                                          | Members see pending nominations **only while nominations are open** (so nominees can respond); afterwards, accepted candidates only. `elections.manage` always sees all.                                                                                                                                                                                                            |
| Member directory & profiles | Colleague profile; profile edit                                                                                                                | `GET /users/{id}/with-roles`; `PATCH /users/{id}/profile`                                                                                                                                                 | With only `members.view`, a colleague's profile omits email-verification, MFA status, last login, created/updated timestamps, notification preferences, and role permission lists (role names remain). `hire_date` is now a restricted field — leadership, secretary, or membership coordinator only — because it drives automatic membership-tier advancement.                     |
| Finance                     | External approver email links                                                                                                                  | Approval token consumed atomically, cleared on approve/deny                                                                                                                                               | One click, one action: a re-used link reports the step as already actioned, even under concurrent clicks.                                                                                                                                                                                                                                                                           |
| Public forms                | Public submission page                                                                                                                         | Daily cap enforced in the service, after validation                                                                                                                                                       | Bots and invalid submissions no longer consume the form's daily allowance; the cap counts valid submissions only and still answers `429` when reached.                                                                                                                                                                                                                              |
| Public endpoints            | All                                                                                                                                            | Redis-error handling in `public_rate_limit`                                                                                                                                                               | A Redis outage now falls back to the in-memory limiter instead of disabling public rate limiting. Login/registration remain fail-closed.                                                                                                                                                                                                                                            |
| Shared devices              | Logout                                                                                                                                         | `localStorage` draft purge                                                                                                                                                                                | Equipment-check drafts (`equipment-check-draft-*`) are now purged at logout alongside shift-report drafts and offline queues — the next person on a station computer cannot read them.                                                                                                                                                                                              |
| Onboarding                  | Setup wizard                                                                                                                                   | `onboarding_session_id` in `sessionStorage` (was `localStorage`)                                                                                                                                          | The setup session is tab-scoped and does not survive a browser restart; legacy stored identifiers are cleaned up automatically. Multi-tab onboarding is intentionally not shared.                                                                                                                                                                                                   |
| Theming                     | Public forms, ballots, status pages                                                                                                            | Root (`html`) now paints the themed gradient canvas                                                                                                                                                       | Fixes dark-mode white-on-white on pages outside the app shell, and paints the scrollbar gutter.                                                                                                                                                                                                                                                                                     |
| Module API clients          | All modules                                                                                                                                    | 401 → failed refresh now rejects the request                                                                                                                                                              | Callers no longer continue with an empty response while the browser redirects to login.                                                                                                                                                                                                                                                                                             |

### Database upgrade route

One migration in this window: `20260816_0001` (revises `20260814_0004`) adds
`facility_rooms.parent_room_id` with an index and a self-referential foreign
key `ON DELETE SET NULL`. No backfill — existing rooms come up top-level and
nothing changes until someone nests a room. SET NULL is the database backstop;
the application re-parents sub-rooms before deletion ever reaches it. Back up,
require one `alembic heads` result, run `alembic upgrade head`. (Later
same-day merges appended `20260816_0002`/`_0003` — storage-area barcode and
inventory-vendor backfills — so the head today is `20260816_0003`; see the
[Aug 10–16 rollup](Recent-Changes-2026-08-10-to-16).)

### Deployment notes

- **`docker-compose.prod.yml` requires Docker Compose v2.24.4+.** It uses
  `volumes: !override` so production clears the development file's source-tree
  bind mounts instead of merging them. If an older Compose errors on the tag,
  upgrade Compose — do not delete the tag.
- **Unraid:** the example environment now shows
  `ALLOWED_ORIGINS=https://logbook.yourdomain.com`. The default production
  posture enforces HTTPS, so a plain `http://<LAN-IP>:port` origin will not
  work as shipped; front the app with an HTTPS reverse proxy.

### Documentation and media actions

Screenshots are needed for: the nested Rooms tree with sub-room counts, the
"Located inside" picker (own subtree excluded), the delete-room confirmation
("sub-rooms move up a level"), a cross-module room picker showing indentation
and the containment path, the members-vs-managers candidate list in and out of
the nominations phase, a `members.view`-only directory profile beside the
`users.view` version, and a rejected `hire_date` edit. Replace or re-verify
any capture showing the old flat Rooms list, the room form without "Located
inside", a flat room picker, or a white-background dark-mode public page.

Before recording, update YouTube scripts **03/04** (facilities and rooms),
**04/06/07** (any location-picker B-roll), **12** (candidate visibility),
and **06/08** (directory privacy and the shared-computer logout claim). The
queue with per-script details is
[`docs/youtube-scripts/SCRIPT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/youtube-scripts/SCRIPT_CURRENCY.md).

## Recent changes: August 12–14, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is available in the source repository at
[`docs/CHANGE_AUDIT_2026-08-12_TO_14.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-12_TO_14.md).

### Pages and connection points

| Area                        | Pages                                                           | API/data connection                                                                                                                     | Boundary and important edge cases                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Elections                   | Ballot Builder, saved templates, results/runoffs                | `/api/v1/elections/templates/saved-ballots`; `SavedBallotTemplate`; manual paper count                                                  | `elections.manage`, per organization. Templates copy settings/structure but never candidates, voters, tokens, votes, attendance, or results; applying creates new item IDs. Names are case-insensitively unique. Invalid methods/items and paper counts above the roster fail. |
| Dashboard/admin hours       | Station board and Summary                                       | dashboard/report services; calendar-year and category totals                                                                            | Pending/persistent messages replace arbitrary recent history. Conditional cards are not always present. Calendar year is not rolling 365 days.                                                                                                                                 |
| Storefront                  | Store Admin, order filters, member order                        | `/api/v1/store/*`; `show_store_open_banner`; status/activity counts; payment-method PATCH                                               | Counts, filters, locks, and orders are organization-scoped. Members edit only their order. Payment reporting is not payment processing. Recipient lists stay private.                                                                                                          |
| Inventory                   | Item detail, issue/return, stock, import, barcode/labels        | `/api/v1/inventory/*`; computed overdue/availability; barcode fallback; CSV/WebSocket validation                                        | Return dates survive temporary-issue edits. Available excludes issued/deployed stock. CSV is byte-limited and live connections require an allowed origin.                                                                                                                      |
| Facilities/QR/apparatus     | Room QR directory, room/facility pages, apparatus crew editor   | facility counts, location display-code regeneration, rank-backed crew positions                                                         | Bulk directory is restricted. Rotation invalidates old signs. `facilities.view_sensitive` does not grant edit. Rank IDs are canonical; legacy names are display fallback.                                                                                                      |
| Events/forms/prospects      | Event Settings outreach picker and prospect progress            | `/api/v1/event-requests/forms`; normalized active-prospect email; skip/advance/approval services                                        | Only event admins discover public-outreach forms. Active email uniqueness is organization + active rows. Signers authenticate; gated/final stages reject unsafe skips; deleted interviewers remain historical.                                                                 |
| Training/skills             | Session editor, program pages, skill runner/results             | `/api/v1/training/sessions/by-event/{event_id}` and linkage PATCH; requirement/course/program IDs; `resume_count` and result visibility | Linked records must belong together and to the organization. Undated records cannot satisfy recency. Officer-only state stays private. A failed step may deduct points without forcing overall failure.                                                                        |
| Scheduling/equipment checks | Shift settings, calendar, checklist reports                     | `/api/v1/scheduling/shift-settings` GET/PUT/DELETE; `SchedulingModuleConfig`; related notifications                                     | Settings/cache keys include organization. Authorized member completion remains available despite tighter template administration. Matching action completion archives only its related notification.                                                                           |
| Integrations                | Salesforce readiness, preview, sync                             | encrypted secret, external IDs, retry/backoff and pagination cursor                                                                     | Secret exists decrypted only in process and is absent from logs/responses. Retries cover transient failures, not bad credentials. Webhook diagnostics are redacted.                                                                                                            |
| Authentication/operations   | OAuth/MFA, Error Code Reference, audit/error logs, installation | rotating refresh family, `LB-*`, `AUDIT_LOG_LEGACY_MAX_ID`, production TLS                                                              | OAuth cannot bypass MFA; replay revocation commits before 401; reset authority has a privilege ceiling. Production TLS fails closed unless explicitly overridden. Public errors expose support codes, not internals.                                                           |

### Database upgrade route

Back up database and encryption keys separately, require one result from
`alembic heads`, then run `alembic upgrade head`. The window contains saved
ballot templates/settings, skill resume reconciliation, active-prospect
uniqueness/reconciliation, public portal key/timestamp hardening, shift vehicle
and crew data, training-result visibility, sensitive-facility permission,
manual paper-ballot counts, scheduling settings, mandatory membership types,
and the store-open banner. Active-email reconciliation is in
`20260814_0003`. **Before upgrading**, query active prospects grouped by
organization plus `LOWER(TRIM(email))`. If any group has more than one row, stop,
review linked applications, keep the earliest `created_at` (then lowest `id`),
mark the others inactive, and require a zero-row recheck. Otherwise the earlier
unique-index revision fails before reconciliation can run. Inspect migration
logs before and after rollout; never downgrade just to repair a migration fork.

### Documentation and media actions

Screenshots are still needed for saved ballot settings/paper count, the station
board and admin-hours categories, store counts/filters/banner/payment method,
Room QR download/print/rotation, rank-backed crew seats, event outreach forms,
training-session linkage/skill scoring, notification auto-archive, and redacted
Salesforce readiness. Replace older images showing the prior versions of those
screens, and re-check changed mobile headers/cards/actions at 375px.

Before recording, update YouTube scripts **01/03** (TLS/migrations/security),
**04/06** (dashboard), **07** (messages/notification cleanup), **08** (Room QR),
**12** (elections), **13** (store), and **14/15/16** (training/skills). Recalculate
all later timestamps after inserting a chapter.

## Recent changes: August 10–16, 2026

This is the six-day handoff, written to be usable without the repository `docs/`
tree. It is the wider frame around
**[Recent changes: August 12–14](Recent-Changes-2026-08-12-to-14)**, which stays
authoritative for the middle of the window and carries the per-area connection
map. Read this page for the days on either side of it, for the routes and
storage views that a three-day frame could not show, and for the August 15–16
changes that appear nowhere else.

The engineering audit lives in the source repository at
[`docs/CHANGE_AUDIT_2026-08-10_TO_16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-10_TO_16.md).

**Window:** 504 non-merge commits · 1,517 changed paths · 28 Alembic revisions ·
5 new routes · 3 new models · 37 new endpoint handlers.

### What changed, by sub-window

| Days          | Character                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aug 10–11** | The supply loop (shelf ↔ truck arithmetic), the email footer library, the Learning Center, skills-testing printing and return-for-correction, and a phone-width sweep across every page                                                                                                                                                                                                           |
| **Aug 12–14** | Security, permissions, elections, the dashboard personal/organization split, storefront, QR, scheduling settings — see [that page](Recent-Changes-2026-08-12-to-14)                                                                                                                                                                                                                               |
| **Aug 15–16** | Onboarding session hardening, the dark-mode canvas move, nested facility rooms (migration `20260816_0001`), a nine-fix security/privacy batch, and the coverage-measurement correction — see [that page](Recent-Changes-2026-08-15-to-16). Post-audit merges the same day added storage-area barcodes (`20260816_0002`), inventory vendors (`20260816_0003`), and the silent-error surfacing pass |

### New pages and their permissions

Five routes went live in this window. Three are authenticated-only on purpose —
in two of those the real access control is **server-side redaction**, not the
route gate.

| Page                        | URL                                        | Who can open it                                                                                         |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Learning Center             | `/learning`                                | Any signed-in member                                                                                    |
| Check-In QR Codes           | `/locations/qr-codes`                      | `locations.manage` **or** `facilities.manage`                                                           |
| Apparatus Inventory         | `/scheduling/apparatus-inventory`          | `equipment_check.submit`, `equipment_check.view`, **or** `inventory.view`                               |
| Blank skill sheet (print)   | `/training/skills-testing/print/template`  | Any signed-in member — it is the empty form and carries no member data                                  |
| Completed scorecard (print) | `/training/skills-testing/print/scorecard` | Any signed-in member — the server redacts the result to the reader's disclosure level before sending it |

**Two of these gates are deliberate and easy to get wrong when documenting them.**
Apparatus Inventory is crew-level because recording what you just used off a
truck is the whole point — putting it behind a manage permission is what leaves
the gap it was built to close. The scorecard print is _not_ gated on
`training.manage` because that would stop a member printing a result they are
already allowed to read, while withholding nothing from anyone else.

The Check-In QR Codes directory is the opposite case: a kiosk display code is a check-in
credential, so a bulk directory of every room's code is a different object from
any single room's QR, and it is restricted. Regenerating a code invalidates the
previous sign.

### August 15–16 in detail

#### Onboarding now runs in one tab, one sitting

The onboarding session identifier moved from `localStorage` to `sessionStorage`.
It is a bearer credential — sent as `X-Session-ID`, it authorizes the setup
requests that create the organization, its stations and apparatus, the IT team,
and the first System Owner. In `localStorage` it survived browser restarts
indefinitely and was readable from every tab on the origin. On a shared or
station-kiosk machine that is a standing invitation to finish somebody else's
installation.

**What an installer will notice:**

- A **second tab does not inherit the wizard.** It starts a new server session,
  and the first step that needs an established one returns
  `ONBD_SESSION_INVALID`.
- **Closing the browser mid-setup ends the run.** So does 30 minutes of
  inactivity — the server session expires on a 30-minute sliding timer, and
  always did.
- **The wizard can look resumable when it is not.** The answers already typed
  live in a separate, longer-lived store, so reopening the wizard repaints them.
  The failure appears at the next step that saves something, not at the repaint.
  **The recovery is to restart the wizard, not to re-type into a dead session.**
- **"Onboarding has already been completed" is something else entirely.** That
  message means an organization already exists — the install finished, and the
  operator should sign in rather than start setup again.

Identifiers left behind by the previous build are deleted the first time the new
build loads. Nothing about permissions, endpoints, or stored department data
changed.

#### Dark mode: the strip down the right edge is gone

The themed background gradient moved from the page body to the root element.
The dark-mode surface colours are translucent by design — they are built to
composite over that gradient — and the browser's stable scrollbar gutter sits
_outside_ the body, so it was showing the browser's default white. In dark mode
that read as a bright seam down the right edge of every page.

This affects **every screen, signed-in and public**, which is why it matters for
documentation: 39 captured training images show the old seam. Only one is a
dark-mode page — the other 38 are **light-mode captures of modal dialogs**, where
the overlay darkens the page but leaves the gutter white behind it. Do not assume
a light-mode screenshot is safe because this began as a dark-mode symptom.

**This caused two problems, both already fixed** (2026-08-16). Moving the
background to the root element stopped the page body's background from reaching
the window, and two things were quietly relying on it:

1. **Printing with "Background graphics" enabled, in light mode** could put the
   themed background behind a scorecard, skill sheet, label or QR sign.
2. **The six print-preview screens** (skill sheet, scorecard, member training
   record, program, compliance, shift report) showed the themed background
   framing the grey backdrop behind the sheet — cosmetic, and printed output was
   never affected.

Both are fixed, with a regression test so the next change to the page background
cannot repeat them. If you see either, you are running a build from between
August 15 and 16.

### Database upgrade route

Back up the database and encryption keys **separately**. Require exactly one
result from `alembic heads` — **`20260814_0004`** at the close of this
window's audit snapshot; same-day merges then appended **`20260816_0001`**
(nested facility rooms), **`20260816_0002`** (storage-area barcode backfill),
and **`20260816_0003`** (inventory vendors — renumbered from a colliding
`_0002`), so the head today is **`20260816_0003`** — then run
`alembic upgrade head`. Never downgrade to repair a fork.

**Before upgrading**, run the active-prospect duplicate check: group active
prospects by organization plus `LOWER(TRIM(email))` and require every group to
have one row. If any group has more, stop; review the linked applications, keep
the earliest `created_at` (then the lowest `id`), mark the rest inactive, and
re-run until zero rows come back. The unique-index revision runs _before_ the
reconciliation revision, so a collision fails the upgrade rather than being
repaired by it.

Across the six days the chain adds: the deployed-lot and on-truck stock columns,
the restock report, the found-expiration column (its write-back onto template
items was later removed as a security fix), email-template footers,
optional kit items, the skill-test return trail and resume counter, saved ballot
templates and their settings, active-prospect uniqueness and reconciliation,
public-portal key/timestamp hardening, shift-template vehicle fields and
apparatus crew positions, training result-visibility defaults, the
sensitive-facility permission and its Captain revocation, manual paper-ballot
counts, per-organization scheduling settings, event mandatory membership types
and reminder targets, and the store-open banner. Inspect migration logs before
and after rollout.

August 15–16 itself adds `20260816_0001` (nested facility rooms — no
backfill), and the post-audit August 16 merges add the storage-area barcode
backfill (`20260816_0002`) and the inventory-vendor tables/backfill
(`20260816_0003`). An earlier revision of this page said this window carried
no migration; that was true only of the onboarding/dark-mode changes it was
written against.

### Documentation and media actions

**Screenshots still needed** — the August 12–14 queue is unchanged (saved-ballot
settings and paper count, station board and admin-hours categories, store
counts/filters/banner/payment method, Room QR download/print/rotation,
rank-backed crew seats, event outreach forms, training-session linkage and skill
scoring, notification auto-archive, redacted Salesforce readiness). New this
pass:

- The onboarding **session-expired** state, so the guide can show an installer
  what "start over" looks like instead of describing it.
- A **public page in dark mode** at full window width, as standing proof the
  canvas covers routes outside the app shell.

**Images to replace:** everything on the August 12–14 list, plus **any
full-window dark-mode capture taken before August 15** that shows the unpainted
gutter. Triage those by looking at the right edge of the image — light-mode
captures and captures cropped inside the content column are unaffected. Re-check
changed mobile headers, cards and actions at 375px.

**YouTube scripts to update before recording:** the August 12–14 list (**01/03**
TLS and migrations, **04/06** dashboard, **07** messages and notification
cleanup, **08** Room QR, **12** elections, **13** store, **14/15/16** training and
skills), plus:

- **02 — First-Time Setup & Onboarding**: add the spoken caution that onboarding
  runs in one tab and one sitting, and re-check any B-roll that shows the
  presenter leaving the wizard and returning.
- **01 / 03**: the same caution wherever the install walkthrough hands off
  between screens.
- Any script with full-screen dark-mode B-roll shot before August 15 — an edit
  decision per clip, not a re-record.

Recalculate every later timestamp after inserting a chapter.
