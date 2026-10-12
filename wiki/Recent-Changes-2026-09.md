# Recent changes: September 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's page, and a new month starts a
new page. The engineering audit behind each pass is in
[`docs/CHANGE_AUDIT_2026-09.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09.md).

## Recent changes: September 24 – October 4, 2026

This wiki handoff can be read without the repository's `docs/` tree. The
deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09.md#change-audit-september-24--october-4-2026).
Previous handoff: [September 15 – 23](#recent-changes-september-15--23-2026).

**The headline:** the busiest window so far, with 250 pull requests. Most of
them are fixes found by a new **workflow review**, which drives each job in
the app — onboarding, signing in, issuing gear, running an election — in a
real browser as the people who do it. Alongside it, a plain-language pass
reworded every module, so **many button and heading names have changed**.

New features:

- **inventory NFC tags**: shelves, put-away, audits and a self-service
  checkout kiosk;
- **room door tags and ID-card check-in at a room kiosk**;
- **shifts worked for other departments**;
- **"I was there" attendance requests**;
- an **event organizer and alternate**;
- a **finance Approvals screen**;
- **per-email notification switches**;
- **one email design** for every message.

Sixty-two migrations; the head is `d058b5e7c1f4`. Fourteen new pages, and
nothing moved address.

### Read this first

**Before you upgrade:**

- **Close any election that is Open.** A vote cast across the upgrade could
  be counted twice.
- **Production needs a public `FRONTEND_URL`.** If it is empty or
  `localhost`, the first public address in `ALLOWED_ORIGINS` is used. With
  neither, the server refuses to start.
- **The compose `production` profile's nginx needs `fullchain.pem` and
  `privkey.pem` in `infrastructure/nginx/ssl/`.** Without them it will not
  start.
- **A reverse proxy you run yourself** (Nginx Proxy Manager, SWAG, host nginx)
  **keeps its own upload limit.** Raise it to 60 MB; the bundled ones are
  already there.
- **Two steps cannot be undone by a downgrade**, and five lose data if
  reversed. Back up first.

**After you upgrade, as an administrator:**

- **Every email template was reset to the new design, including ones you
  edited.**
  - Your wording is saved. Open a template and use **Previous version (before
    the redesign)** → **Load this wording** → **Save**.
  - **Do not press Reset to "adopt" the design.** Reset only replaces your
    wording with the default. (An earlier banner on the Templates tab
    suggested pressing it; the banner was corrected on 2026-10-04.)
- **Replies to any email now go to the department's contact address.** Make
  sure somebody reads it. The "Please do not reply" line is gone.
- **Appoint a Compliance Officer.** Every department gained a **Compliance**
  suggestion box that is already accepting reports, and only the Compliance
  Officer can read it. Until one is appointed, reports wait unread. The other
  option is to switch the box off under Suggestion Boxes.
- **"Fire Chief" now reads "Chief".** Only the label changed; who holds it
  and what it can do are unchanged. A title you chose yourself is kept.
- **Probationary and junior members can now sign in and be scheduled.**
  Before, they were refused with "Account is inactive". To stop them signing
  themselves up for shifts, add their membership type to **Excluded from
  Self-Signup** in Scheduling's Eligibility settings.
- **Members who switched Email Notifications off now get no optional emails
  at all**, including shift, store and inventory notices that used to arrive
  regardless. To make an email reach everyone, mark it required on
  **Communications → Member Emails & Texts**.
- **Dropped members still holding gear get one reminder** on the first night
  after the upgrade. The reminders had never actually been sent.
- **Applicant badges printed before the upgrade carry the applicant's private
  status link.** Destroy and reprint them.
- **Applicants sitting on an Election Vote stage without a package** are
  refused on Advance. Press **Create Package** in their drawer.
- **Target Solutions** needs both an API key and an API secret. Re-enter them
  on the External Training Integrations page.

**For everyone:** buttons and headings have new names throughout. A few you
will meet first:

- **My Account** (was User Settings);
- **Event settings**;
- **Decline** (was Deny) on equipment requests;
- **Advance Selected** / **Hold Selected** / **Reject Selected** on the
  applicant table;
- **Keep in inbox after it is read** (was Persistent) on messages.

### What changed, by area

#### Everyone

- **"Today" is the department's day.**
  - Compliance, certification alerts, reports, scheduling and expiry all
    count by the department's own date rather than the server's UTC date.
  - Emails, PDFs and CSV exports print times in the department's timezone,
    which is set under **Settings → Organization → Profile**.
- **The phone bottom bar is yours to choose.**
  - Pick the two tabs beside **Add** under **My Account → Appearance → Phone
    navigation bar**.
  - The **Settings** tab now opens **My Account**.
  - The side drawer shows a cue when more items sit below.
- **Tablets.**
  - Card lists size themselves to the space they have, so you see two roomy
    columns rather than three cramped ones.
  - Controls that only appeared on hover now show on touch screens.
  - Selected toggles are the primary red.
- **Notifications.**
  - Notifications of the same kind stack into one row.
  - Each optional email can be switched off on its own; some are always sent.

#### Members and applicants

- **Member numbers.** Add Member has a single number field: leave it blank
  for automatic. Numbers can follow a pattern (for example `2026-001`) and
  are never reissued.
- **Directory.** It shows **Rank**. Former members can be shown with the
  **Archived** filter and brought back with **Reactivate**.
- **Length of service.** It skips the time a member was away.
- **Anonymize.** A Dropped or Archived member can be anonymized from their
  profile.
- **ID cards.**
  - Only officers who manage badges can open another member's ID card.
  - A lost or revoked card can be registered again.
- **Applicants.**
  - Applicants can withdraw from their status page.
  - Conversion waits until every **Required** stage is complete. Officers
    named on a Multi-Signer stage sign from the new **Sign-offs** page.
  - **Purge Selected** now actually deletes.
  - A target role is limited to what the person who chose it may grant.

#### Training

- **Joined before the requirement.** A requirement can exempt members who
  joined before it, or give them a catch-up deadline. Saving asks **Who does
  this change apply to?**
- **Credit from events.** Finalizing a Training event's attendance writes the
  training records. Approving that credit needs `training.manage`.
- **Target Solutions.** It syncs hourly from its Training Records API,
  matching members by email, with a daily 30-day review.
- **Mapping provider users.** Under External Training → **Mappings →
  Users**, pick the member from each user's dropdown; their waiting
  completions move to that member at once. (This replaced a **Map User**
  button that did nothing, fixed on 2026-10-04.)

#### Scheduling and admin hours

- **Outside shifts.** Log shifts worked for other departments under **My
  Shifts → Hours → Shifts with other departments**. Officers keep the list of
  outside apparatus under **Settings → Outside Apparatus**.
- **Declined shifts.** You can sign up again for a shift you declined.
- **Swaps.**
  - A swap is withdrawn together with its seat.
  - Officers can approve an offer made to a named member.
  - An open swap is not claimable by other members: an officer finds cover.
- **Shift Reports.** The tab explains itself to members, and officers get a
  **Written by me** summary.
- **Admin hours.** You can **Edit**, **Edit & resubmit** or **Withdraw** your
  own pending or rejected entries. Manual entries always go to review.

#### Events, meetings and elections

- **After an event.** Once it has ended, RSVP and **Add to Calendar**
  disappear. Members can send an **"I was there"** request for up to 30 days.
- **Organizer.** Every event has an **organizer** and an optional
  **alternate**, who receive attendance requests. **Transfer event** hands it
  over.
- **Recurring series.** They keep their local time across daylight-saving
  changes. **This and all future events** no longer moves dates.
- **Rooms.**
  - Rooms can have an NFC door tag that checks a member into the room's
    current event.
  - A room's kiosk can accept ID-card taps. This is off by default, per room.
- **Minutes.**
  - **Record Minutes** creates the meeting.
  - The submitter cannot approve their own minutes.
- **Elections.**
  - Fixes from a two-person review.
  - **Voter Overrides** pick a member from a list.
  - **Voting Method** reads plainly and shows a **Winner** row.

#### Inventory, apparatus and facilities

- **NFC tags** (opt-in): tag items and shelves, then:
  - put items away by tapping;
  - run shelf audits, scheduled and offline-capable;
  - see items not seen lately;
  - run a self-service checkout kiosk (`inventory.kiosk`).
- **Labels.**
  - Print directly to a network printer.
  - Choose what each label shows.
  - Share label setups and see the print history.
  - Start partway down a sheet.
  - Label whole storage areas.
- **Equipment requests.** They read **Awaiting review / Approved / Declined /
  Issued**. The member sees the quartermaster's note and is notified of the
  outcome.
- **Equipment checklists.**
  - The Quartermaster can now build them.
  - A failed item needs a note.
  - Editing a published checklist asks you to publish it again.

#### Communications and forms

- **Suggestion boxes.** They now have:
  - notifications and an **Also notify** list;
  - status history and a response to the submitter;
  - an opt-in **idea board** with voting;
  - deletion, either archiving or a typed-name delete.

  Anonymous submissions are now left out of the server's request logs.

- **Email.** Every email uses one design: a coloured tab, a title card and a
  centred footer. Test sends use your department's real records.
- **Forms.**
  - A form manager can tick **Allow submissions without signing in**.
  - A form that still needs sign-in says so before the visitor starts.

#### Finance

- **Approvals.** The **Approvals** screen lists what is waiting on you, and
  request pages have **Approve** and **Deny**.
- **Approval chains.** Their steps can be added, edited and reordered.
- **No chain.** A request no chain applies to waits for a finance approver
  instead of stalling.

### New pages

| Page                     | Address                                        | Who                                |
| ------------------------ | ---------------------------------------------- | ---------------------------------- |
| Storage area labels      | `/inventory/storage-areas/print-labels`        | `inventory.manage`                 |
| NFC tag settings         | `/inventory/admin/nfc`                         | settings managers                  |
| A tapped tag             | `/inventory/tag/:code`                         | `inventory.view`                   |
| Put away                 | `/inventory/put-away`                          | `inventory.manage`                 |
| Shelf audit              | `/inventory/shelf-audit`                       | `inventory.manage`                 |
| Bulk tag enrolment       | `/inventory/admin/nfc/enroll`                  | `inventory.manage`                 |
| Items not seen           | `/inventory/admin/not-seen`                    | `inventory.manage`                 |
| Self-service kiosk       | `/inventory/kiosk`                             | `inventory.kiosk`                  |
| Outside Apparatus        | `/scheduling/admin/settings/outside-apparatus` | `scheduling.manage`                |
| Sign-offs                | `/prospective-members/sign-offs`               | signed in                          |
| Member Emails & Texts    | `/communications/member-emails`                | settings or notifications managers |
| Training-credit approval | `/training/approve/:token`                     | `training.manage`                  |
| Finance Approvals        | `/finance/approvals`                           | `finance.approve`                  |
| Room check-in            | `/locations/:locationId/check-in`              | signed in                          |

### Permissions

- **New:**
  - `inventory.kiosk` (nobody by default);
  - `system.manage_link_domain` (System Owner only);
  - `apparatus.manage_nfc_tags`;
  - `locations.manage_nfc_tags`.
- **New positions:**
  - **Assistant Membership Coordinator**;
  - **Compliance Officer**.
- **Added to seeded positions on upgrade:**
  - Quartermaster: `inventory.check_manage`;
  - President, Vice President, Chief, Deputy Chief and Assistant Chief: both
    NFC tag grants;
  - Apparatus Officer and Facilities Manager: one each;
  - Assistant Membership Coordinator: `members.manage_id_cards`.

  Positions your department created or changed are left alone.

- **Tightened:**
  - the public portal's admin API now requires `settings.manage`;
  - an applicant's target role is held to the chooser's own permissions;
  - another member's ID card requires a badge permission.

### Training materials and videos

- **The module guides were brought up to date** against the current screens.
  Where each topic lives is indexed in guide 20's _September 24 – October 4_
  section.
- **Screenshots:** 84 are marked **REPLACE** and 38 new ones are requested.
  None has been captured yet. The queue is in `SCREENSHOT_CURRENCY.md`.
- **YouTube scripts** were corrected where they no longer match the app. The
  chapters that need new footage are listed in `SCRIPT_CURRENCY.md`.

## Recent changes: September 15 – 23, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09.md#change-audit-september-15--23-2026).
Predecessor: [September 12 – 15](#recent-changes-september-12--15-2026).

**The headline:** **suggestion boxes** — the first new screens since early
September — and a membership pipeline that moves applicants off a meeting stage
**when the event is finalized**, not when they tap the kiosk. Four migrations,
head `5a70c5dcd138`. Nothing moved address and no bookmark breaks.

The window's theme is **records that say what really happened**: an applicant
moves when the department has settled who attended; each inventory item knows
whether it has a label; a form stops storing answers to questions the submitter
could not see; and the pipeline header counts the applicants the table shows.

### Read this first

**If you administer a department:**

- **Tell your event organizers to finalize.** A meeting stage that names its
  event (it has an **Auto-Link Event Type**, or is pinned to one event) now
  advances an applicant only once they are checked in **and** that event's
  attendance is finalized — End Event, recording the actual end time, or
  Finalize Attendance. An event nobody finalizes releases them seven days after
  it ends (`PIPELINE_ATTENDANCE_SETTLE_DAYS`). **The same rule now applies to a
  coordinator's own Advance button**, bulk or single — before, a single click
  was exempt. A stage that names no event ("meet with the chief") still takes
  the coordinator's word.
- **Look at who is parked on an event-naming meeting stage** having attended
  without being checked in. They will be refused on Advance until you record
  the attendance — which you can do after the fact from the event.
- **Five seeded positions gain `suggestions.manage`** — Fire Chief, Deputy
  Chief, Assistant Chief, President, Communications Officer. It lets them set up
  suggestion boxes. **It does not let them read any submission**; only a box's
  named reviewers can.
- **Every inventory item reads "Needs a label" after the upgrade.** There was no
  history to carry over. If your stock is already labelled you can mark it
  without printing — see the upgrade notes.
- **Optionally clear old hidden form answers** with a dry-run-by-default script.

### What members will notice

- **Suggestions** in the sidebar, just after Messages. Submit to any box your
  department has opened — named or, where allowed, anonymously — with up to five
  screenshots. An anonymous submission stores no name and no exact time, and
  screenshots lose their hidden location data. A box that allows follow-up gives
  an anonymous submitter a **one-time key** to read replies; **a lost key cannot
  be replaced**.
- **The installed app's icon is the department's logo.** Anyone who installed
  earlier keeps the old icon until they remove the app and add it again.
- **A form no longer refuses you over a question you could not see.** A required
  question that only shows for some answers is only required while showing.

### What officers will notice

- **Meeting stages** — above. The applicant drawer states the requirement before
  you click, and a refusal names the three ways out: record the attendance,
  un-tick **Required** and skip, or clear the stage's Auto-Link Event Type.
- **The pipeline header matches the table.** Converting, skipping, holding and
  the rest now refresh the stat cards too, and the cards count through the same
  search and event filter as the list. If they disagreed before, the table was
  right.
- **Quartermasters: label by filter.** Filter the items list, tick one row,
  **Select all N matching** (up to 500), **Print Labels**. The label page opened
  with nothing selected offers a Category / Location / Storage-area picker.
  After printing it asks **"Did the labels print correctly?"** — confirming
  takes the items off the new **Needs a Label** filter. Changing an item's
  barcode puts it back.
- **Medical Screening → Add Record** now warns that the record it creates is not
  linked to any member. That was always true; the dialog just says so now.

### Suggestion boxes in one paragraph

Set up under **Administration → Forms & Comms → Suggestion Boxes**
(`suggestions.manage`). Each box has reviewers (positions and/or members), an
**Anonymity** rule — **Submitter chooses**, **Always anonymous**, **Always
named** — and an **Allow follow-up** switch. Reviewers work submissions on the
**Review** tab of the Suggestions page: a disposition (**New**, **Under
review**, **Accepted**, **Implemented**, **Declined**, **Duplicate**), an
internal note, and a reply thread. A reviewer can forward a single suggestion
to other members or positions, who then review that one only. Emails carry a
link, never the content. Suggestion boxes are **not** tied to the
Communications module switch. What anonymity does not defeat — someone with
access to the server's own logs lining up times — is recorded in the repository's
`docs/KNOWN_LIMITATIONS.md`.

### Added September 24, after the window

These changes landed just after the window closed, in
[#2653](https://github.com/thegspiro/the-logbook/pull/2653),
[#2667](https://github.com/thegspiro/the-logbook/pull/2667),
[#2687](https://github.com/thegspiro/the-logbook/pull/2687) and
[#2699](https://github.com/thegspiro/the-logbook/pull/2699).

**Membership coordinators: one bulk-action bar in Table view** (#2653).

- **Selecting applicants in Table view used to show two bars stacked**, both
  reading "N selected". The page's bar offered Print Badges, Advance All and
  Reject All; the table's own offered Advance, Hold and Reject.
- **Now there is one bar**, the same in Kanban and Table: **Print Badges**,
  **Advance All**, **Hold All** and **Reject All** (with an optional reason).
  Nothing was lost: Hold moved onto this bar.
- **Hold All now names anyone it skipped**, like the other bulk actions. The
  old Hold sent one request per applicant and could only report how many
  failed.
- The header checkbox shows a **minus** when only some rows are selected, where
  it used to look the same as all selected.

**Members and event organizers: the event page's Event Information card** (#2667).

- **Capacity shows on any event with a cap.** It used to show only on events
  that require an RSVP. A capped event puts people on a waitlist either way, so
  a waitlisted member could not see the "3 / 3, Event Full" that explained why.
- **No more empty card.** An event that needs no RSVP, has no cap and allows no
  guests used to show the card's heading with nothing under it. The card is now
  left out.
- **Managers see capacity once.** It stays in the Statistics card and is no
  longer repeated in Event Information.

**Nothing to do on upgrade** for either fix. Both are on the web page only: no
migration and no setting.

**If you maintain the training screenshots:**

- **Every placeholder in the guides is now filled (600 of 600).**
- **One image shows a simulated result, and its caption says so.** It is
  Settings → Email with Microsoft 365 passing Test Connection, since the demo
  has no Microsoft 365 tenant.
- **Nine new steps in `scripts/screenshots/seed_demo_data.py`** create what the
  new screens needed. They run at the end of a normal seed and are safe to
  re-run:
  - an org chart;
  - two testing runs;
  - a capped event with a waitlisted member;
  - past closed-out shifts;
  - a retired call type;
  - photo-consent answers;
  - a member's privacy settings;
  - a long department message;
  - one out-of-stock coat size.
- **The Testing Checklist module stays off in the demo department**, as on a
  fresh install. The two testing screenshots switch it on for themselves and
  off again afterwards.
- `docs/training/SCREENSHOT_CURRENCY.md` records each shot, the data behind it,
  and the two frames that were requested but cannot exist.

**If you make the training videos:** a new 45-second short, **8AU "Who's
Going — and Where You Stand on the Waitlist"**, is in
`docs/youtube-scripts/08-quick-tips-and-shorts.md` (#2667). It shows:

- the names-only list of who's going;
- a member's place on the waitlist;
- the Event Information card's capacity, as fixed above;
- the officer setting that controls the list: **Manage Events → Settings →
  Attendance**, set to **Only event managers** out of the box.

**Film it as a member, with attendee visibility switched on**, because an
officer always sees the full roster. The demo department's **"Station Open
House — Setup Crew"** event is already full, with `nbelhaj` on the waitlist.

**Three script beats changed with it** (#2667):

- **Script 06, RSVPing to an Event — new beat for a full event.** A Yes lands
  on the waitlist. The Event Information card shows how full the event is, Your
  RSVP shows the member's place in line, and a freed spot promotes the first
  person waiting automatically. It adds about 15 seconds to the segment.
- **Script 06, the segment's opening line — corrected.** It promised the
  member would see "who's attending". It now says "if your department shares
  it, who's going".
- **Script 08A, the RSVP confirmation shot — corrected.** It promised "your
  name appears in the Attending list". It now shows Your RSVP reading
  **Going**, or **Waitlisted** with a place in line on a full event.

**The two corrections fix old mistakes; the Event Information change did not
cause them.** Attendee visibility ships set to managers only, so on a default
install a member never sees a going list, and neither line could be filmed as
written. Script 04's Statistics beat is unchanged, because the Statistics card
did not change. `docs/youtube-scripts/SCRIPT_CURRENCY.md` has the
before-and-after wording.

**Script 04, creating an event — new beat for the officer's side**
([#2687](https://github.com/thegspiro/the-logbook/pull/2687)). The walkthrough
never said who can see the going list, so an officer had no way to learn the
setting existed. Right after RSVP Settings, it now covers:

- the event form's **Who can see who's going** dropdown: **Use organization
  default**, **Everyone in the department** or **Only event managers**;
- that members see names only, never contact details, notes or accessibility
  information;
- the department default under **Manage Events → Settings → Attendance**,
  which starts out as **Only event managers**.

It adds about 20 seconds. Film it as an officer; nothing needs saving.

**The training guides now say the same**
([#2699](https://github.com/thegspiro/the-logbook/pull/2699)):

- **Guide 04's event-creation steps** have a new step for **Who can see who's
  going** in RSVP Settings.
- **Guide 20, the September release lesson,** now says where to switch the
  going list on, for the whole department or for a single event. Before, it
  only said that an administrator has to.

### Added September 25: the release lessons became indexes

Two training lessons used to repeat, window by window, what each module guide
should say, and the copies had drifted apart. Both are now indexes:
[#2706](https://github.com/thegspiro/the-logbook/pull/2706) folded guide 20
(August 31 – September 23) and
[#2713](https://github.com/thegspiro/the-logbook/pull/2713) folded guide 19
(August 12–31), with a last correction to guide 04 following in
[#2725](https://github.com/thegspiro/the-logbook/pull/2725). Guide 20's index
now points to both passages that correction fixed, under _Corrections folded
in on September 25, 2026_
([#2740](https://github.com/thegspiro/the-logbook/pull/2740)), so a trainer
who starts from the index lands on the corrected text.

- **Teach from the module guides.** Each one now describes how its screens work
  today, in one place. Guides 19 and 20 remain only as lists of where each topic
  went, so old links still land somewhere useful.
- **Upgrade steps are in `docs/UPGRADING.md`**, dated. Guide 19's August steps
  were missing from it until now. The ones worth reading before an upgrade from
  an August build:
  - four steps take permissions away from seeded positions;
  - administrative members lose their operational rank, and a downgrade does not
    give it back;
  - rolling back past the org chart keeps only each seat's first holder;
  - the production compose file needs Docker Compose v2.24.4 or later;
  - a duplicate active applicant stops the upgrade part way.
- **Direct label printing needs `LABEL_PRINTER_ALLOWED_NETWORKS`.** The setting
  arrived on September 14 without an upgrade note, and is empty by default, which
  turns direct printing off. The **Unraid compose files do not pass it through**,
  so an Unraid install has to add it to the backend's `environment:` block.
- **Some guide text was wrong, and is corrected.** Every claim was checked against
  the application while it moved. The ones a trainer is most likely to have
  repeated:
  - **Account lockout** is 5 failed sign-ins and 15 minutes, and the sign-in
    page says only "Incorrect username or password" while an account is locked.
    The old 5-in-60-seconds and 30-minute figures belong to the separate per-IP
    rate limit.
  - **A budget's cap is enforced.** Finance said three times that approving over
    budget is allowed; it is refused with "Insufficient available budget".
  - **The skills-test builder's checkbox is Critical**, not Required, and
    checklist and timed steps can earn or lose points.
  - **An election is created with "How is the Winner Determined?"**, where
    Supermajority is one choice that sets both the counting method and the
    victory condition.
  - **Writing a random code to a blank ID card** is the preferred way to issue
    one; reading the chip serial is the fallback.
  - **The dashboard staffing tiles need `scheduling.manage`**, not
    `scheduling.view`.
  - **A ballot item has no voting method of its own and no number of winners**
    (guide 04). Each item has a **Vote Type**, **Who Can Vote** and an optional
    **Victory Condition** override; how votes are counted is the election's
    **How is the Winner Determined?** choice.
  - **The dashboard has no Clear All** (guide 04 still described one, and a
    dismiss button on every card). Event notices land in **My Updates**, where
    opening a row marks it read. Only holders of `notifications.manage` or
    `settings.manage` can clear a persistent message, and that clears it for
    everyone.
- **Screenshots moved with the text.** Thirty-three images from guide 19 now sit
  in the guides that describe their screens; nine were left out because a module
  guide already shows the same screen.

### Upgrade notes

**Four migrations. Head is `5a70c5dcd138`.** Back up, confirm `alembic heads`
returns exactly one, then `alembic upgrade head`.

| Revision       | What                                            | Reverses?                                           |
| -------------- | ----------------------------------------------- | --------------------------------------------------- |
| `80e2004cd691` | Suggestion box tables                           | Yes — **and drops every suggestion**                |
| `394600cbfae2` | `suggestions.manage` onto five seeded positions | Yes — also removes a grant added by hand afterwards |
| `9cb132ad83dc` | Suggestion forwards                             | Yes — drops every forward                           |
| `5a70c5dcd138` | Label-printed columns on inventory items        | Yes — loses only the print history                  |

**Catching up labels on stock that is already labelled:** filter the items list
to **Needs a Label**, tick one row, **Select all N matching**, **Print Labels**,
**cancel** the browser's print dialog, and answer **Mark N items as labelled**.
Only confirm for items whose labels really are on the gear.

**Own reverse proxy?** The app icons are served at the paths they always had
(`/pwa-192x192.png`, `/apple-touch-icon.png`, `/apple-splash-*.png`, and the new
`/pwa-maskable-512x512.png`). Pass them through to the frontend container; a
proxy serving the built files off disk keeps serving the stock icon.

**Hidden form answers (optional):**

```bash
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py          # dry run
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --apply --backup-file /tmp/hidden-answers-backup.json
```

**Development note:** vitest moved to 5.0; **PyMySQL is held at 1.2.0** (1.2.1+
breaks every BLOB write through aiomysql) and **jsdom at 30.0.1** (tests only).
Both holds carry a Dependabot ignore and a lift condition in
`docs/KNOWN_LIMITATIONS.md`.

### Not yet available — do not teach these

- The crew **Sweep** and the equipment-check **lap** — built, not reachable.
- **Qualification entry** — still only through a course's _Certifies_ field.
- **Choosing the member on a medical screening record** — the dialog still cannot.

### Where to read more

| Topic                         | Repository file                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator documentation        | the module guides; `docs/training/19-august-2026-release-changes.md` and `20-september-2026-release-changes.md` index where each topic went |
| Suggestion boxes walkthrough  | `docs/training/07-documents-forms.md`                                                                                                       |
| Meeting stages                | `docs/training/15-prospective-members.md`, `docs/PROSPECTIVE_MEMBERS_MODULE.md`                                                             |
| Label tracking                | `docs/training/05-inventory.md`, `docs/LABEL_PRINTING_MODULE.md`                                                                            |
| Upgrade notes                 | `docs/UPGRADING.md`                                                                                                                         |
| Screenshots to create/replace | `docs/training/SCREENSHOT_CURRENCY.md`                                                                                                      |
| Video script changes          | `docs/youtube-scripts/SCRIPT_CURRENCY.md`                                                                                                   |

## Recent changes: September 12 – 15, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09.md#change-audit-september-12--15-2026).
Predecessor: [September 6 – 12](#recent-changes-september-6--12-2026).

**The headline:** **nothing moved address, and nothing new was added to move
to.** No screen was created and none retired, so there is no bookmark to
repair and nothing new to learn the way to.

This is a **correction window**. Twelve of its seventeen changes enforce a rule
that was written down somewhere and enforced nowhere, or enforced on one path
out of two. Four of them change what somebody sees without anyone asking: the
**Open Shifts board lists only shifts with a seat the member can take**, **a
click outside a dialog stops discarding the form in it**, **only an inspection
moves an item's inspection clock**, and an **email configuration that cannot
send is refused when you save it**.

### Read this first

**If you administer a department:**

- **⚠️ Check your gear's inspection dates.** Marking _any_ maintenance record
  complete used to write the item's last inspection date and recalculate the
  next one due. A coat inspected in April and repaired in August had its annual
  NFPA 1851 inspection silently rescheduled from the following April to the
  following August, and the department read as compliant four months longer
  than it was. Only an inspection moves that clock now — **but the fix does not
  go backward.** Gear whose date already slid keeps it, because the application
  cannot tell a date that slid from one a quartermaster entered deliberately.
  If you track gear on an inspection interval and have been completing repairs
  against it, check those dates against your paper records.
  _(The September 6–12 window stated this rule for records created as complete.
  This window covers the commoner path — work scheduled first and marked
  complete later — which is where a quartermaster actually works.)_

- **Check your email configuration if mail has been unreliable.** Settings →
  Email would save an **enabled** section green that had no chance of sending:
  **Cloudflare** with no account ID or token, or the platform left at **Not
  configured** — the button labelled **Other** until this change — which stores
  nothing at all. Both are refused on save now. **The reason this matters more than a
  validation message:** an enabled section short-circuits the deployment's own
  SMTP settings, so a half-filled section did not merely fail on its own — it
  stopped whatever server-level mail configuration the installation had from
  being used. A department that had been sending perfectly well, then started
  filling in an email section and stopped, has been in this state. **Either
  complete the section or turn it off**; a disabled section hands sending back
  to the deployment's own configuration.

- **Check your meeting stages.** A membership-pipeline meeting stage with
  **auto-advance** ticked and **Auto-Link Event Type** set to _None_ used to
  accept attendance at any event in the department. Guest check-in is
  department-wide and departments enable it on open houses and fundraisers, so
  a stage reading "Meeting with the Fire Chief" advanced an applicant who signed
  in at a pancake breakfast. Such a stage now advances on nothing until you name
  the event type, and the stage builder refuses to save the combination. Cal.com
  stages are unaffected.

**If you run scheduling:**

- **Tell your members the Open Shifts board will be shorter.** This is the
  change most likely to be reported as something being broken. See below.

### Members: the Open Shifts board

A member picking their position off the board could be refused with **"Position
was filled after this request was submitted"** — a message about somebody
beating them to it, for a seat that had been taken for days.

Two questions were being asked and never compared: "does this shift still need
somebody?" and "is this member cleared for a seat that is actually free?" A
shift with an empty driver's seat and a full firefighter seat answered yes to
both for a firefighter, whose signup was then declined.

**A member's board now lists a shift only when one of its unclaimed seats is a
position they are cleared for.** Someone who used to see eight open shifts may
now see three — and the five that went are the five the system would have
refused. The position picker offers only seats the server will grant, and
**"every seat you are cleared for on this shift has been filled"** is now
distinguished from **"you are not eligible"**; the first means come back later,
the second means talk to an officer, and both used to read as the second.

**Officers holding `scheduling.manage` see no change** — that tab is also how a
scheduling admin finds staffing gaps, so it keeps the department-wide view. If
an officer and a member compare boards and see different lists, that is why.

### Everyone: dialogs stopped closing when you click beside them

Clicking in the margin around an open dialog used to close it, and where the
dialog held a form, that discarded the form — no draft, no confirmation, no
undo. The reported case was adding a uniform to Inventory: a name, category,
room, storage area and a set of sizes and garment style axes, all chosen before
anything is saved, thrown away by one click in the gutter.

**Escape and the X in the dialog's header still close everything.** Five
surfaces deliberately keep click-away because none holds anything you could
lose — the command palette, the two equipment-check jump sheets, the checklist
picker and the "before publishing" sheet. Menus and dropdowns are unaffected.

**Nothing looks different in a screenshot**, which is worth saying to whoever
runs training: it shows up the first time somebody demonstrates closing a
dialog on video.

### Membership pipeline: four stages that now enforce what they describe

- **A membership vote is binding on both buttons.** The applicant's election
  package has always recorded the vote, and nothing read it when moving an
  applicant — so an applicant the department had voted _down_ advanced on a
  click, next to a panel saying they were not elected. **Advance** was gated on
  September 13 and **Convert** — the button shown on the last stage, and the way
  a coordinator is told to finish a pipeline — on September 14, because the two
  go through different code. A department that holds its vote at a meeting and
  records the result by hand is unaffected: a stage with no package, or one
  still _Draft_ or _Ready_, advances as before.
- **A meeting stage that names no event advances on nothing** — see **Read this
  first** above.
- **A form submission moves only the applicant it belongs to, and only off the
  stage they are on.** It used to find the stage by matching the _form_ and
  complete it wherever the applicant had got to, which pulled people backward —
  from the membership vote back to the welcome email.
- **"Auto-advance when form is submitted" now decides something.** The box was
  inert in both directions. Un-tick it and the applicant stays put with their
  answers recorded for you to review; a stage where nobody touched the box keeps
  advancing exactly as it does today.
- **Election Vote and Manual Approval can be created from the stage picker.**
  Neither could be unless you used a quick-add preset: both demanded a list of
  roles that has no input anywhere in the modal, and Manual Approval — the
  modal's default — failed in silence because its error was never rendered.

### Email: twelve SMTP presets

Yahoo, iCloud, Zoho, Fastmail, AOL, GMX, SendGrid, Amazon SES, Mailgun,
Postmark, Brevo and Mailjet each fill in the host, port and encryption the
provider documents, plus what its Username and password fields expect — **most
need an app password** generated in the provider's own settings once two-factor
sign-in is on, which is the commonest reason a correct host and port still fails
to authenticate.

This is a labelling fix rather than a new capability: all twelve are ordinary
SMTP, which the platform already sent perfectly well. What departments did not
have was any way to know that. A chief running on Yahoo read "Self-Hosted SMTP
— your own mail server", reasonably concluded it was not supported, and picked
**Other**, which cannot send at all.

Also: departments on **Cloudflare can send ballot email** for the first time,
and a deployment-wide Cloudflare account no longer overrides a department that
has configured its own transport.

### Smaller fixes worth knowing

- **Fourteen screens stopped refusing people holding the `manage` permission.**
  A permission named `manage` does not automatically include `view`. One of
  these reaches a department that changed nothing: president, secretary, vice
  president and membership coordinator all ship with
  `prospective_members.manage` and not `.view`, so they could link an event to
  an applicant and not read the links back — and the drawer said **"no linked
  events"** rather than showing an error, so the links appeared to vanish. Four
  more are worth knowing if you have hand-built an officer position: the
  **time-off and swap queues** are reviewed by whoever holds
  `scheduling.manage`, and a position holding only that could reach neither
  queue nor a request it had been sent a link to.
- **First-run setup can no longer be bricked by concurrent requests.** Two
  setup records could be created at once, after which every status check failed
  and setup had no way forward. The upgrade removes any duplicates.
- **The inventory items list stopped double-requesting** when a "Load More"
  retry failed, and its guards now reset when you change the search, sort or
  status filter rather than carrying over from the previous result set.

### Security and accessibility

Ninety-three security-review commits. **Pass 5 completed its lap** — features
00 through 22 ran here, the rest having run in the previous window — and the
rotation reset; **pass 6 has reached Feature 06 (Elections & ballots)**. One
pass produced a behaviour change worth naming: **MP-30**, which is what carried
the membership vote gate onto the **Convert** button.

### Not yet available — do not teach these

Carried forward unchanged from the last three windows:

- The crew **Sweep** for equipment checks — built, visible only in the template
  builder's preview.
- The equipment-check **lap** — built, not wired.
- **Qualification entry** — still only through a course's _Certifies_ field,
  never entered directly.

## Recent changes: September 6 – 12, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09.md#change-audit-september-6--12-2026).
Predecessor: [August 31 – September 6](Recent-Changes-2026-08#recent-changes-august-31--september-6-2026).

**The headline:** **nothing moved address and no bookmark breaks** — the
opposite of last window, which retired fourteen. This window is additive.
**First-run setup was rebuilt**: it now tells you what it will ask for before
it starts asking, it asks in an order a department can actually answer, and it
collects three things you previously could only set after setup was over — your
**rank ladder**, your **membership tier ladder**, and **how you number
members**. Five scattered member settings were collected into a new **Members
Administration → Settings** screen. The **inventory items list** can now be
pinned and grouped by a quartermaster. And three changes alter what an existing
department may do or see without anyone asking: the **Treasurer gains approval
permissions**, **property-return reports stop being readable by the whole
department**, and **everyone's menu may move to the left side** on the first
load after upgrading.

### Read this first

**If you administer a department:**

- **⚠️ Your navigation layout resets to the left sidebar.** Setup has always
  asked whether you want the menu across the top or down the side, but the
  answer only ever reached _the browser that gave it_ — it was saved in local
  storage, and the copy sent to the server was read by nothing. So the officer
  who ran setup saw their choice and every other member saw the default. The
  answer is now stored on the department and applies to everyone, which is the
  fix — but an existing installation has no stored value, so **everyone gets
  the left sidebar on their next page load**, including the officer whose
  browser held the top bar. There was nothing to migrate, because the old
  value was never reachable from the server.
  **If you want the top bar, set it once at Settings → General → Profile →
  Navigation Layout.** It applies to every member from their next page load.
  Departments already on the default need do nothing.

- **Your Treasurer can now approve purchase requests.** Two permissions —
  `finance.approve` and `finance.configure_approvals` — were defined and gated
  real endpoints, but **no seeded position held either**. Only the IT
  administrator could reach them, through a wildcard. What that cost you: build
  an approval chain without also granting approve, and every submitted request
  lands in _Pending Approval_ with nobody able to action it. The upgrade grants
  both to the Treasurer.
  **It is a careful grant, not a blanket one.** It applies only where the
  Treasurer position holds exactly `finance.view` + `finance.manage` — the
  combination the system seeds. If you have deliberately curated that position,
  it is left alone. **If you deliberately gave your Treasurer view and manage
  and nothing else, meaning "no approval powers", check that position after
  upgrading** — nothing in the stored row distinguishes that decision from the
  untouched default.
  This does **not** let a treasurer approve their own spending. Self-approval
  is refused whoever holds the permission.

- **Property-return reports were readable by your whole department.** When a
  member leaves and a property-return report is generated, it was filed into
  the **Reports** folder, which everyone with document access can read — while
  naming the departed member, quoting the reason for the separation
  (**including involuntary ones**) and printing their home address so the
  letter could be posted. They now file into a **leadership-only
  member-separations folder**, and the upgrade moves the reports already
  written. No action needed; this is listed so you know what was exposed and
  for how long.

- **If you publish a public event-request form, nothing changes — and that is
  the point.** There is a setting called "accept public event requests". It
  worked on the API path and was **never read by the Forms path** — the one
  your own "Generate Event Request Form" button produces. Now both paths read
  it. Left alone, that would have silently switched off community requests at
  every department with a published form, with the toggle already showing off
  and no error anywhere. So the upgrade sets the flag on for every department
  whose published form was actually feeding the pipeline. Departments without
  such a form keep the default of off.

**If you are a member or an officer:** the menu may move to the left side
(above). Otherwise nothing you use moved, and nothing you had bookmarked
broke.

### First-run setup was rebuilt

This only affects **new installations** — an existing department has already
been through it. It matters here because it is what a trainer demonstrates and
what the installation video walks through.

#### It now says what it will ask for, before it asks

A new **Setup Prerequisites** screen (`/onboarding/prepare`) opens the flow. It
collects nothing and saves nothing. It exists because the health screen told an
operator the database was up, and then nothing told them the wizard was going
to want SMTP credentials, an OAuth client secret and a storage key — so they
started, met a step they could not answer, and left to go and find it. **Walking
away is what used to end the install.**

Its two lists — what is required, what is optional — are derived from the step
list itself, so they cannot drift out of agreement with the wizard.

#### The order changed, and only two steps are required

| #   | Step                  | Required?    |
| --- | --------------------- | ------------ |
| 1   | Organization Setup    | **Required** |
| 2   | Administrator Account | **Required** |
| 3   | Modules               | Optional     |
| 4   | Ranks & Positions     | Optional     |
| 5   | Stations              | Optional     |
| 6   | Apparatus             | Optional     |
| 7   | IT & Backup Contacts  | Optional     |
| 8   | Email                 | Optional     |
| 9   | File Storage          | Optional     |
| 10  | Sign-In Method        | Optional     |
| 11  | Navigation Layout     | Optional     |

The principle: **identity comes second**, so everything after it belongs to a
real account; **what the department uses** (modules, ranks, stations,
apparatus) comes before the **external integrations** (email, storage,
sign-in), which are the steps that send someone off to hunt for credentials —
and every one of those is skippable.

Two buttons that named a step they no longer went to have been corrected, and
an in-progress setup now stays resumable **after its session lapses**, which
previously meant starting over.

#### Three things you can now answer during setup

- **How you number members**, in step 1. This has to come first: the counter
  only numbers members created _after_ it is switched on, and the wizard
  creates your administrator account in step 2 and your IT team in step 7. A
  department that set this on a members screen afterwards ended up with its
  first few accounts holding no number and the roster import starting at the
  number those accounts should have had — an off-by-a-few nobody notices until
  a badge is printed.
- **Your rank ladder**, in step 4. A rank can now confer a seat your department
  invented, rather than only the seats that ship.
- **Your membership tier ladder.** It has a screen in setup _and_ in Settings,
  and they are the same editor.

Also in step 4: the permission checkboxes now **show rows only for the modules
you enabled** in step 3, they grant permissions that actually exist, unticking
a seeded position removes it, and pressing Continue without editing anything no
longer deletes most of the roster.

### New: Members Administration → Settings

Five settings that lived in different places are now one screen at
**Members → Administration → Settings**, each section its own address so an
officer can be linked straight to it.

| Section                | What it sets                            | Who can change it                         |
| ---------------------- | --------------------------------------- | ----------------------------------------- |
| **Contact Visibility** | What members see of each other          | A settings grant — _not_ `members.manage` |
| **Membership IDs**     | Numbering and prefixes                  | A settings grant                          |
| **Operational Ranks**  | The ladder, and who may fill which seat | `members.manage` or a settings grant      |
| **Membership Tiers**   | The ladder, and what each tier confers  | `members.manage`                          |
| **EVOC Levels**        | Driver certification ladder             | `apparatus.manage`                        |

**The grants differ per section on purpose.** Reaching the hub takes
`members.manage`, but Contact Visibility and Membership IDs save through
endpoints that do not accept it — gating them on the hub's grant would put a
members officer on a page where every toggle fails. Operational Ranks _does_
now accept `members.manage`, because the ladder moved here and its gate moved
with it. **EVOC deliberately does not**: it belongs to the apparatus API, and
widening that was a separate decision from moving the page.

Contact Visibility and Membership IDs moved here on 2026-09-06 and **their old
addresses redirect**, so existing links still arrive.

### Inventory: shape the items list

For a quartermaster, a handful of items — the Class B polos, the duty boots —
carry nearly all the traffic while sitting scattered through an alphabetical
list.

- **Pin** an item and it moves to a **Pinned** section at the top. Pins are
  **yours**, not the department's: two quartermasters running different supply
  lines front different gear, and curating your list never reorders anybody
  else's page. Reorder pinned rows by dragging, or with the up/down arrows on a
  phone where dragging does not work. **Up to 25 items.**
- **Group by** — beside the filters — reorganises the list by Category, Item
  Type, colour, or any other attribute. Whatever you group by **drops out of
  the rows**, since repeating it on every row inside its own group is noise;
  the **Size** column is shown instead.
- **A product's size variants fold into one expandable row**, so a coat in six
  sizes is one line until you open it.

Two related corrections underneath: a garment can now record **every style
attribute it has** rather than one. Sleeve, fit, neckline and closure are four
independent descriptors, and a men's long-sleeve polo could not be recorded at
all — variant generation resolved the conflict by creating three separate
items. And a member's **fit preference is now read**: it previously saved, and
changed nothing about what they were offered.

### Scheduling

- **A close-out queue** at Administration → Scheduling → Close-out: the shifts
  that have ended and were never closed out, oldest first.
- **The Calls log on the shift panel is now hidden unless your department
  records calls in a mode that has one.** Three call-entry paths that were
  ungated are gated the same way. A department not tracking calls was being
  offered a log it could not meaningfully fill.

### Membership pipeline

- **A coordinator can place an applicant directly on a stage**, rather than
  only advancing them one at a time.
- **Applicants with no stage no longer disappear** from the board, and
  applicants belonging to other pipelines no longer appear in _Unassigned_.
- **Switching a pipeline drops the old pipeline's applicants** rather than
  carrying them across into stages that do not correspond.
- Underneath: two stages could share a position in the order, which made both
  the column order **and where "advance" sent an applicant** depend on how the
  sort happened to break the tie — differently from one page load to the next.
  Stage positions are now unique and the upgrade renumbers existing ones.

### Smaller fixes worth knowing

- A facility emergency contact can be saved with **a contact name and no
  company** — the form always allowed it and the database always rejected it.
- A membership pipeline stage that advances **on a meeting now requires real
  attendance**.
- The **token-refresh lookup is indexed**, which is the busiest query the
  session table takes.
- **Equipment-check drafts survive leaving the page**, and a failed draft
  recovery no longer puts a toast over the next page you open.
- **Only an inspection may move an item's inspection clock.**
- The items-list **export now matches the list you are actually looking at**,
  filters and grouping included.
- Storefront order placement is **serialized per organization**, closing a race
  where two orders placed together could both pass the same stock check.

### Security and accessibility

Ninety security-review commits across thirty-four feature areas; the rotation
reached **Feature 23 (Medical supplies)**. Mobile accessibility gained two
automated passes — `mobile-accessibility.spec.ts` and `mobile-dialogs.spec.ts`
— which hold AA contrast at **zero findings** across the checked routes and
ratchet the AAA-only findings per route so they cannot grow.

### Not yet available — do not teach these

Carried forward unchanged from the last two windows:

- The crew **Sweep** for equipment checks — built, visible only in the template
  builder's preview.
- The equipment-check **lap** — built, not wired.
- **Qualification entry** — still only through a course's _Certifies_ field,
  never entered directly.
