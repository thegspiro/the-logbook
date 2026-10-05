# Recent changes: September 24 – October 4, 2026

This wiki handoff can be read without the repository's `docs/` tree. The
deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09-24_TO_10-04.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09-24_TO_10-04.md).
Previous handoff: [September 15 – 23](Recent-Changes-2026-09-15-to-09-23).

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

## Read this first

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

## What changed, by area

### Everyone

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

### Members and applicants

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

### Training

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

### Scheduling and admin hours

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

### Events, meetings and elections

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

### Inventory, apparatus and facilities

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

### Communications and forms

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

### Finance

- **Approvals.** The **Approvals** screen lists what is waiting on you, and
  request pages have **Approve** and **Deny**.
- **Approval chains.** Their steps can be added, edited and reordered.
- **No chain.** A request no chain applies to waits for a finance approver
  instead of stalling.

## New pages

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

## Permissions

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

## Training materials and videos

- **The module guides were brought up to date** against the current screens.
  Where each topic lives is indexed in guide 20's _September 24 – October 4_
  section.
- **Screenshots:** 84 are marked **REPLACE** and 38 new ones are requested.
  None has been captured yet. The queue is in `SCREENSHOT_CURRENCY.md`.
- **YouTube scripts** were corrected where they no longer match the app. The
  chapters that need new footage are listed in `SCRIPT_CURRENCY.md`.
