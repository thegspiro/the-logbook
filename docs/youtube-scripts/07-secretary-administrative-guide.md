# Script 7: Secretary & Administrative Officer Guide

**Video Type:** Role-Based Guide (Medium-Form)
**Estimated Length:** 20–25 minutes
**Target Audience:** Secretaries, Assistant Secretaries, Treasurers, administrative staff
**Roles Covered:** secretary, assistant_secretary, treasurer, quartermaster
**Chapters:** 8 (each designed as a standalone clip)

---

## CHAPTER 1: Introduction — The Administrative Backbone (0:00 – 1:30)

### HOOK (0:00 – 0:30)

**[SCREEN: Quick montage — recording meeting minutes, managing member roster
changes, creating events, running an election, managing documents. The Secretary
is the person who keeps the department running behind the scenes.]**

> "The Secretary keeps the records, runs the meetings, manages the roster, and
> makes sure nothing falls through the cracks. If that's you, this video shows
> you how The Logbook takes all of that paperwork and puts it in one place."

### WHAT THE SECRETARY CAN DO (0:30 – 1:30)

> "As Secretary, you have manage access to Members, Events, Documents, Meeting
> Minutes, Elections, Scheduling, and Forms. You're one of the most active users
> on the platform, so let's make sure you know every tool at your disposal."

**[CALLOUT: Secretary's module access list with manage/view indicators]**

> "We'll cover: meeting minutes, event management and attendance, member roster
> management, document administration, forms and data collection, elections
> support, suggestion boxes, administrative hours tracking, and your daily
> workflow."

> **Treasurers — production note, not a spoken beat:** dues live in the Finance
> module, which this guide doesn't cover, and the Dues page is read-only in the
> current release — schedules, the collection summary and member records are
> visible, but payments, waivers and waiver reversals are API-only until the
> management UI ships. Two behaviors changed underneath and are worth covering
> once there is something to point a camera at: payments are now a full history
> rather than one running total (a second installment no longer erases the first
> one's method and notes, and a resubmitted check number can't charge a member
> twice), and a waiver must be deliberately reversed before a payment will go
> in. Shorts **8m** and **8n** are written and on hold for the same reason; the
> written walkthrough is in the Finance training document.

**[TRANSITION: Meeting minutes]**

---

## CHAPTER 2: Meeting Minutes (1:30 – 5:30)

### CREATING MINUTES (1:30 – 3:00)

**[SCREEN: Navigate to Minutes (MinutesPage). Click "Record Minutes."]**

> "Meeting minutes are often the Secretary's primary responsibility. The
> Logbook's Minutes module is designed for how fire department meetings actually
> work."

**[SCREEN: The "Record Meeting Minutes" dialog: title, Meeting Type, called
by, date and time]**

> "Click **Record Minutes**. That records the meeting itself: give it a title,
> pick the **Meeting Type** — Business, Special, Committee, Board or Other —
> and enter who called it, the date and the time."

**[SCREEN: Back on the list, click the book icon on the meeting's card —
"Create minutes from this meeting"]**

> "Then the book icon on that meeting's card opens its minutes. If minutes
> already exist, it opens those rather than starting a second set."

**[PRODUCTION NOTE — 2026-10-04. Rewritten. There is no "New Minutes" button
and no "Executive Session" type (pre-existing); the book icon opening existing
minutes and the five offered types date from 2026-10-03. Re-record both
cues.]**

> "The editor gives you a structured template. Start with the **Call to Order**
> — who called the meeting to order and at what time. **Roll Call** — who's
> present, absent, and excused. You can pull from the member roster instead of
> typing names manually."

**[SCREEN: Show the roll call section pulling from the member roster]**

**[CALLOUT: "Pull attendance from the member roster — no manual typing"]**

> "Add sections for each agenda item: **Officer Reports**, **Old Business**,
> **New Business**, **Committee Reports**. Each section supports rich text —
> bold, lists, links."

**[SCREEN: Add several agenda sections with sample content]**

> "Record **motions** — who made the motion, who seconded, and the vote result.
> The system tracks motions separately so they're searchable and reportable."

**[SCREEN: Record a motion with maker, seconder, and vote result]**

### ACTION ITEMS (3:00 – 4:00)

**[SCREEN: Show the action items section within minutes]**

> "As items come up that need follow-up — 'Captain Smith will get a quote for
> new hose,' 'Treasurer to report on the fundraiser account' — record them as
> action items."

**[SCREEN: Add an action item with an assignee and due date]**

> "Each action item has an assignee and a due date. These automatically appear
> in the Action Items module and on the assigned member's dashboard. At the
> next meeting, you can review outstanding action items directly from the
> previous minutes."

**[CALLOUT: "Action items from minutes → assigned to members → tracked to completion"]**

### PUBLISHING & ARCHIVING (4:00 – 5:00)

> "When your minutes are complete, press **Submit for Approval**. Another
> officer then approves or rejects them — not you. If you submitted them, the
> page tells you it's waiting for another officer, because nobody signs off
> their own minutes."

**[SCREEN: Submit for Approval; then, as a second officer, Approve Minutes;
then Publish to Documents]**

> "Once they're approved, **Publish to Documents** files them in the
> department's Documents as a formatted copy. That's the official record."

**[PRODUCTION NOTE — 2026-10-04. Rewritten. The previous take offered "save as
a draft or publish immediately"; minutes have gone through Submit for
Approval → a different officer's Approve Minutes → Publish to Documents since
before this window. Pre-existing; found, not caused, by it. Needs two officer
accounts on camera.]**

> "The search feature lets you find any motion, discussion topic, or action
> item from any meeting in the department's history."

**[SCREEN: Search for a term across all meeting minutes. Show results.]**

### MINUTES DETAIL VIEW (5:00 – 5:30)

**[SCREEN: Navigate to a published minutes detail page (MinutesDetailPage)]**

> "The detail view shows the complete minutes. Once they're published, **View
> in Documents** takes you to the formatted copy — that's the one to share or
> print for your physical records."

**[SCREEN: Click View in Documents; show the published minutes document]**

**[PRODUCTION NOTE — 2026-10-04. There is no PDF export on minutes (none in the
frontend or the API); the previous cue could not be filmed. Pre-existing.]**

**[TRANSITION: Event management]**

---

## CHAPTER 3: Event Management & Attendance (5:30 – 9:00)

### CREATING & MANAGING EVENTS (5:30 – 7:00)

**[SCREEN: Navigate to Events (EventsPage)]**

> "Secretaries often manage the department's event calendar. Business meetings,
> social events, fundraisers — creating and tracking attendance for these is
> core to the role."

> "Creating an event follows the same flow we covered in the Chief's guide —
> name, type, date, time, location, RSVP settings, and the check-in window.
> Every event gets its own check-in QR code; there's nothing to switch on."

**[SCREEN: Quickly create an event — "April Business Meeting"]**

> "One thing Secretaries often manage: **event requests.** These come from your
> public outreach form — a school asking for an engine at its fair, a group
> wanting a fire-safety talk. The person asking is a member of the public with
> no account here."

**[REWRITTEN 2026-09-30 — requests come from the public request form, not from
members, and there is no approve/deny: a coordinator works the request's
pipeline tasks, then schedules, postpones or declines it. The requester's
status link is not in any email, so it has to be sent by hand.]**

**[SCREEN: Navigate to Event Requests (EventRequestsTab). Expand a request:
the pipeline task list, **Assign**, then **Schedule Event**, **Postpone** and
**Decline**. Point to **Copy Link**.]**

> "Open a request and you'll see its tasks — the checklist your department set
> up for these. Work through them, then **Schedule Event**, **Postpone** or
> **Decline**. Scheduling puts it on the calendar."

> "Whether the requester hears about each change depends on which request
> emails your department switched on under Events settings. And one thing to
> know: their status link isn't in any of those emails. If you want them to
> follow along, press **Copy Link** and send it to them yourself."

### EVENTS ADMIN HUB (7:00 – 7:30)

**[SCREEN: Navigate to Events Admin Hub (EventsAdminHub)]**

> "The Events Admin Hub gives you an administrative overview — all events,
> attendance summaries, pending requests, and event analytics. This is your
> command center for the event calendar."

**[SCREEN: Show the admin hub with filters and summary stats]**

### ATTENDANCE TRACKING (7:30 – 8:30)

> "After an event, review and finalize attendance. The system captures RSVPs
> and check-ins automatically, but you may need to add late arrivals or correct
> errors."

**[SCREEN: Open an event's attendance list. Show editing attendance — adding a
member who arrived late, excusing an absence.]**

> "You can mark members as Present, Absent, or Excused. Add notes if needed —
> 'arrived 20 minutes late,' 'excused for work conflict.'"

> "This attendance data feeds into the member's overall participation record
> and shows up in reports."

### HISTORICAL IMPORT (8:30 – 9:00)

**[SCREEN: Navigate to Historical Import (HistoricalImportPage)]**

> "If your department has historical attendance data in spreadsheets, the
> Historical Import tool lets you bring that data into the system. Upload a CSV
> with past event dates and attendance, and the system backfills the records."

**[SCREEN: Show the import interface briefly]**

> "This is a one-time operation most departments do when first adopting the
> platform."

**[TRANSITION: Roster management]**

---

## CHAPTER 4: Member Roster Administration (9:00 – 12:00)

### MANAGING THE ROSTER (9:00 – 10:00)

**[SCREEN: Navigate to Members Admin Hub (MembersAdminHub)]**

> "The Secretary is often responsible for keeping the member roster current.
> When someone joins, when someone leaves, when positions change — it's your
> job to update the records."

**[SCREEN: Show the Members Admin Hub with the roster overview]**

**[SCREEN: Members → Membership Management. Open the "Filter by status"
dropdown: All Statuses, Active, Inactive, On Leave, Retired, Archived]**

> "The roster itself is the **Members** page, with status indicators. Filter
> by status — Active, Inactive, On Leave, Retired, and, for officers,
> Archived — and search by name, membership number or email."

**[PRODUCTION NOTE — 2026-10-04. The previous take filtered "by membership
type — Active, Probationary, Retired, Honorary" and searched "by position".
The filter is by status, and search covers name, membership number and (for
officers) email. Wrong before this window; found, not caused, by it. The Admin
Hub's **Member Management** tab is roles, not the roster. Re-record this cue.]**

### ADDING A NEW MEMBER (10:00 – 10:30)

**[SCREEN: Click "Add Member." Fill in the form quickly.]**

> "Adding a new member: click 'Add Member,' fill in their information — name,
> address, phone, email and an emergency contact are all required — set their
> **Membership Type**, which for a new joiner is usually **Probationary**, and
> pick a Rank and Position if they hold one."

**[SCREEN: Show the "Set initial password" checkbox — once with email
working ("Leave unchecked to email the member a temporary password."), once
with email off, where it is ticked and required]**

> "Then the password. If email is set up, leave **Set initial password**
> unchecked and they're emailed a temporary password. If it isn't, the box is
> required — set one here and hand it to them. The Logbook won't create an
> account nobody knows the password to."

**[PRODUCTION NOTE — 2026-10-04. Rewritten. "Probationary Member" was never a
position: Probationary is a membership type (pre-existing error). The
password requirement when email is off is new (2026-09-27). Re-record both
cues.]**

### EDITING MEMBER RECORDS (10:30 – 11:00)

**[SCREEN: Navigate to a member's admin edit page (MemberAdminEditPage)]**

> "To update a member's information, click their name and go to the edit view.
> Update their contact info, address, rank and station, or change their
> **Membership Type** — Probationary to Active when they come off probation."

**[SCREEN: Show changing Membership Type from Probationary to Active and
saving]**

> "Two things aren't on that page. Status — active, on leave, retired — is the
> **Change status** control on the member's profile. Positions are assigned
> under **Manage Roles** in the Members admin hub."

**[PRODUCTION NOTE — 2026-10-04. The previous take changed a member's
position and added notes on the admin edit page; it has neither, and the
cue filmed a position change that was really a membership-type change.
Pre-existing; found, not caused, by this window.]**

### MEMBER SCANNING (11:00 – 11:30)

**[SCREEN: Navigate to Member Scan page (MemberScanPage)]**

> "The Member Scan page lets you scan a member's ID card, QR code or printed
> badge to pull up their profile instantly. Badges now carry a random code the
> server issues — it isn't the membership number — and a scan is checked
> against your department only, so a hand-made code gets nowhere. Badges
> printed before that keep scanning until an administrator turns off **Accept
> old badges**. Useful at events, during check-in, or at the firehouse."

**[SCREEN: Show scanning a QR code and the profile appearing]**

### ADMIN HOURS TRACKING (11:30 – 12:00)

**[SCREEN: Navigate to Administrative Hours module]**

> "If your department tracks administrative hours — time spent on paperwork,
> meetings, phone calls, community outreach — the Admin Hours module lets you
> log and report these."

**[SCREEN: Click "Log Hours Manually". Fill Category, Start Time, End Time and
Description; click "Submit for review"]**

> "Logging after the fact is **Log Hours Manually** — a category, a start and
> an end time, and a line on what you worked on. Then **Submit for review**:
> a hand-typed entry always goes to an officer, even in a category that
> auto-approves clocked time. That's useful for departments where officers
> report their non-operational time for annual reports or for reimbursement
> tracking."

**[SCREEN: A pending entry with "Edit" and "Withdraw"; a rejected one with
"Edit & resubmit"]**

> "Typed one wrong? Until it's approved it's still yours — **Edit** a pending
> entry, **Edit & resubmit** a rejected one, or **Withdraw** either. Once it's
> approved, only an officer can change it."

**[PRODUCTION NOTE — 2026-10-04. The previous cue showed "category, hours, and
notes"; the form takes a start and end time, not an hours figure. Re-record
both cues. The edit/withdraw beat is new and adds about 15 seconds; re-time
Chapter 4.]**

**[SCREEN: Show a pending entry belonging to the signed-in officer, with the
Approve button refusing]**

> "One rule worth knowing if you're the person who approves these: **you can't
> approve your own hours.** Officers log time into the same pool they sign
> off, so somebody else has to review yours. You can still reject or withdraw
> your own entry — it's approving it that needs a second pair of eyes."

**[TRANSITION: Documents section]**

---

## CHAPTER 5: Document Management (12:00 – 14:00)

### ORGANIZING DOCUMENTS (12:00 – 13:00)

**[SCREEN: Navigate to Documents (DocumentsPage)]**

> "The Documents module is the department's digital filing cabinet, and you're
> the librarian. You can create folders, upload files, set visibility, and
> manage the organizational structure."

**[SCREEN: Show the document browser with folders]**

> "Create a folder structure that makes sense for your department — SOPs,
> Policies, Forms, Training Materials, Meeting Documents. Members can browse
> this structure to find what they need."

**[SCREEN: Create a new folder. Upload a document into it.]**

> "For each document, you can set visibility — visible to all members, or
> restricted to specific positions. Sensitive documents like personnel policies
> might be restricted to officers only."

### WAIVER MANAGEMENT (13:00 – 13:30)

**[REWRITTEN 2026-09-30 — Waiver Management holds leaves of absence and
training waivers. It has no waiver templates and no signature tracking; the
previous take described liability releases and photo consents, which live
nowhere here.]**

**[SCREEN: Members → Admin → Waivers (WaiverManagementPage) → **Create
Waiver**. Show the waiver type, the dates, and the **Applies To** fieldset with
**Training Requirements** and **Meeting Attendance & Shift Requirements**, and
the line under them saying what will be created.]**

> "Waivers here excuse a member from requirements for a period — a leave of
> absence, medical, military. Pick the member, the type and the dates, then
> what it applies to."

> "**Meeting Attendance & Shift Requirements** is one box, because a leave
> excuses both. **Training Requirements** is the other: tick it too and their
> training is adjusted for the time away; leave it off and their training stays
> on schedule. The line under the boxes tells you exactly what will be
> created."

**[SCREEN: The **Active Waivers** tab, a **Deactivate** button; then **All
Waivers**.]**

> "**Active Waivers** shows what's in force, and **Deactivate** ends one early.
> **All Waivers** keeps the history."

### FORMS MODULE (13:30 – 14:00)

**[SCREEN: Navigate to Forms (FormsPage)]**

> "The Forms module lets you create custom forms for anything — shift checkout
> checklists, equipment inspection reports, member surveys, event feedback.
> Build the form with the drag-and-drop builder, publish it, and members can
> fill it out."

**[SCREEN: A form card → **Share** → the **Share Form** dialog: **Public
Access** on, then tick **Allow submissions without signing in**; the footnote
changes to "Anyone can submit this form without signing in."]**

> "Sharing it outside the department? Press **Share** and turn on **Public
> Access**. If people without an account need to send it — applicants, the
> public — also tick **Allow submissions without signing in**. Leave that off
> and only members can submit, even from the public link."

**[SCREEN: Show the form builder briefly — adding fields, setting types]**

**[SCREEN: A field "Previous EMT experience" set to Required, with conditional
visibility "show when Membership Type equals EMT".]**

> "Conditional questions are safe to make required now. A question that only
> shows for some answers is only required while it's showing — before September
> 2026, an applicant who picked a different answer couldn't submit the form at
> all. And if somebody fills a question in and then changes the answer that
> shows it, the hidden answer is thrown away instead of saved."

**[SCREEN: Open a form's Share dialog: the public-access switch, then the
"Allow submissions without signing in" checkbox, unticked. Then open the form's
public link in a private window — the "Sign in to submit this form" notice
above the questions.]**

> "Sharing a form outside the department? Turning on the public link lets
> anyone **view** it, but submitting still needs a member sign-in until you tick
> **Allow submissions without signing in** in the Share dialog. A visitor who
> isn't signed in is told so before they start, with a Sign in button — not
> after they've typed every answer."

**[PRODUCTION NOTE — 2026-10-04. New beat, about 15 seconds; re-time Chapter 5.
The up-front sign-in notice is new (2026-10-03); before it, a visitor learned
only on Submit and lost their answers. A form that allows one submission per
person can never be opened to visitors who are not signed in.]**

> "You can review all submissions, export responses as CSV, and analyze results."

**[SCREEN: Show the Forms page's Submissions tab briefly]**

**[PRODUCTION NOTE — 2026-10-04. This cue pointed at "Review Submissions
(ReviewSubmissionsPage)", which is the training officer's queue of
self-reported training, not form responses. Form responses are the
**Submissions** tab on the Forms page. Wrong before this window; found while
checking it.]**

**[TRANSITION: Elections]**

---

## CHAPTER 6: Supporting Elections & Communications (14:00 – 17:35)

### ELECTION ADMINISTRATION (14:00 – 15:00)

> **Producer note:** overview only — the full elections lifecycle, including
> auditing and forensics, is **Script 12**. Reference it in the end card.

> "As Secretary, you often administer elections. The process is the same as we
> covered in the Chief's guide: create the election, define offices and
> candidates, open voting, close it, and publish the results."

**[SCREEN: Quick walkthrough of election admin — focus on the Secretary-specific
tasks: the Eligibility Roster, sending a test ballot, and publishing results]**

> "Your specific responsibilities usually include verifying the Eligibility
> Roster is correct before ballots go out — it shows you exactly who will
> receive a ballot, who won't, and why, item by item. Grant overrides for
> members who should vote but got filtered out. And send yourself a test ballot
> first — test votes are marked as tests and never count toward the real
> results."

**[SCREEN: Show the Eligibility Roster and the Publish Results panel]**

> "After closing the election, use the Publish Results panel to make results
> visible to members and email the results report — then formally record the
> outcome in the meeting minutes. One thing to know: if you close voting early,
> say at the end of the meeting, press **Publish Results** so members can see
> the outcome right away — otherwise results stay hidden until the originally
> scheduled end time."

> "And before the meeting: generate the **Pre-Meeting Package** — a printable
> PDF with the agenda, the full ballot preview, and the eligible-voter list,
> ready to email out or file with the minutes. Full walkthrough in the
> elections deep-dive (Script 12, Short 12k)."

> "Three more meeting-night duties that now run through the system: open a
> **nomination phase** so members propose candidates themselves; record
> in-room **paper ballots** — you enter the tally, and other officers attest
> the count before it counts; and after close, download the **Certified
> Results package** to sign and file with the minutes. All covered in
> Script 12, Chapters 14–16."

### COMMUNICATIONS (15:00 – 15:20)

**[SCREEN: Navigate to Communications module]**

> "Under Communications → Messages, you can send announcements to the entire
> membership or to specific roles, statuses, or individual members. Compose a
> message, pick the audience, and set a priority. Every targeted member gets it
> in-app and by email — that email is the department's record they were
> notified — and Urgent messages even send a text, so a time-sensitive callout
> reaches people who aren't logged in."

**[SCREEN: Show composing a message with the audience selector and priority]**

> "Turn on 'Require acknowledgment' for anything members must confirm they've
> read — like an SOP change. You'll get a report showing exactly who has and
> hasn't acknowledged it. You can also schedule a message to go out later, and
> edit or delete a message after posting."

**[SCREEN: Show the acknowledgment report and the schedule field]**

### EMAIL TEMPLATES — FINDING THINGS, SIGNING THEM, AND CLOSING THEM (15:20 – 17:20)

**[SCREEN: Communications → Email Templates. The sidebar shows the collapsible
categories with counts — seven, plus Other only when a template fits none.]**

> "Email Templates is where the wording of every automated notice lives — welcome
> emails, event reminders, dues notices, store confirmations. There are well over
> three dozen of them, and they used to be one long flat scroll."

> "They're grouped now — Members & Accounts, Events & Scheduling, Training &
> Certifications, Elections & Voting, Inventory & Property, Suggestion Boxes and
> Department Store, with Other for anything that fits none. Search still works
> across all of them, and searching expands every group so a match can't hide
> behind a collapsed header."

**[SCREEN: Open a template; in the signature block, type {{president_name}} and
{{president_title}}.]**

> "Second thing, and this one solves a real annoyance. A notice you send as
> secretary, or that goes out from a nightly automated job, had no way to carry
> the name of the officer it should come from."

> "Every template can use officer variables now. President, Vice President, Chief,
> Deputy and Assistant Chief, Secretary, Assistant Secretary, Treasurer, Safety
> Officer, Training Officer, Quartermaster, EMS Supply Officer and Compliance
> Officer — name, title, email and phone for each one."

**[SCREEN: Send Test Email; the rendered signature shows the current holder's
real name.]**

> "It fills in whoever currently holds that office."

**[CALLOUT: "You probably don't have to set this up"]**

> "And here's the part people miss and then spend twenty minutes on: **you
> probably don't have to configure anything.** It works out who holds each office
> from the positions your members already carry. Open the Officers tab only if it
> got one wrong, or if an office has nobody matching a position."

> "If you _do_ link an office to a specific member, the values track that member's
> profile — they change their phone number, your notices follow. And it re-checks
> nightly, which is what catches a change made to the member rather than to the
> assignment."

#### Footers — the bit at the bottom of every email

**[SCREEN: Scroll to the bottom of the open template's preview. Highlight the
footer block.]**

> "Now look at the bottom of that email. 'This is an automated message from…',
> the contact line, the address. Every notice ends with some version of it."

> "Until recently that block was **copy-pasted into all thirty-five templates**.
> Which meant changing one word in it was thirty-five edits — and if you'd
> already customised a template by hand, your only way to pick up the new wording
> was Reset, which throws away everything else you'd changed in it."

**[SCREEN: Click the Footers tab.]**

> "It's a library now. You edit it once, here."

**[SCREEN: Show the three seeded footers in the list, Internal marked as
default.]**

> "Three come set up, and they're **different on purpose**, because you don't say
> the same thing to everybody."

**[SCREEN: Expand each in turn while narrating]**

> "**Internal** — for members. 'This is an automated message from' your
> department, and nothing telling them not to reply: replies go to the
> department's own address, so a member who answers gets a person. That's your
> default."

> "**Public** — for people outside the department. This one **invites a reply**
> and carries your mailing address. That matters: somebody who emailed to ask if
> the department would bring an engine to their school's fair should not get a
> notice back telling them not to reply. Event requesters and applicants get this
> one automatically."

> "**Official notice** — for things going on the record. Separations, property
> return, election results."

**[SCREEN: Edit a footer's lines; toggle Phone, Email, Website and Mailing
address. Then scroll up to the "Department contact details" card.]**

> "Rename them, reword them, add your own, delete ones you don't use. Each footer
> has its own lines and its own switches — **Phone**, **Email**, **Website**,
> **Mailing address**. What those print comes from one place, the **Department
> contact details** card at the top, and changing it there changes it in
> Organization settings too."

**[SCREEN: Point to the "N templates use this" count beside a footer]**

> "Before you delete one, it tells you how many templates use it — so that's a
> decision, not a guess."

**[CALLOUT: "Deleting a footer never leaves an email with none"]**

> "And if you do delete one that templates were using, those templates fall back
> to your default. Losing a footer entirely is never the right answer, so it
> doesn't happen."

**[SCREEN: Open a template; show the footer selector, set to Public.]**

> "To point one specific template at one specific footer, open the template and
> pick it here. Leave it alone and it uses your default — which means changing
> your default changes every template that hasn't overridden it, in one go."

#### Nine more things you can put in an email

**[SCREEN: Open the variable palette; expand the Organization group.]**

> "Last thing on templates. There are fields you've already filled in under
> Organization Settings that you previously couldn't actually use in an email.
> They're all available now."

> "Your **tax ID** — if you're a 501(c)(3) asking for money, you're expected to
> state your EIN on the message that asks. Your **county** and **founded year**,
> for the 'Serving the county since 1923' line people type by hand. Fax, if
> you're still asked for one."

**[SCREEN: Insert {{organization_identifier_label}} {{organization_identifier}}
into a template; show the preview rendering "FDID 12345"]**

> "And this pair is the useful one. Departments carry three different official
> identifiers — FDID, a state ID, a department ID. This inserts **whichever one
> your department nominated, with the name of the scheme in front of it**. So an
> official notice reads 'FDID 12345' and is actually right about which number
> that is."

#### Your emails look different now — every one of them

**[REWRITTEN 2026-10-04. Supersedes the 2026-08-24 and 2026-09-25 versions of
this beat. Both described a design that was opt-in per template through Reset;
since 2026-09-27 (migration `15c5bc7700aa`) **every** stored template was reset
to the new design at upgrade, edited ones included, and the previous wording was
kept in a backup. A secretary following the old take would wait for a choice
that has already been made for them.]**

**[SCREEN: Show the preview pane — the solid tab naming the category, the title
on its tinted card, the message card, the centred footer.]**

> "The design changed again in September, and this time it changed everywhere
> at once. Every email now has a solid tab at the top naming what kind of
> notice it is, the title on a tinted card, the message on its own card, and a
> centred footer."

**[SCREEN: Open a template the department had edited; show the "Previous
version (before the redesign)" panel above the editor]**

> "Here is the part to get right, because it is the one that generates the
> support ticket. **When your department upgraded, every template was reset to
> the new design — including the ones you'd reworded.** Nothing you wrote was
> thrown away."

> "Open a template you'd changed, and above the editor there's a **Previous
> version** panel. **Load this wording** puts your old subject and message back,
> inside the new design. Check the preview, press **Save** — or **Discard** if
> you'd rather keep the new text. The old colours and header don't come back;
> only your words."

**[CALLOUT: "Your wording is saved — Previous version → Load this wording →
Save"]**

**[PRESENTER NOTE — 2026-10-04: the banner at the top of the Templates tab
was corrected. It now says every email uses the current design, points to
Previous version, and says Reset replaces wording without changing the design.
It can be filmed; footage recorded before 2026-10-04 shows the old banner,
which told admins to press Reset "to adopt it" — do not use that footage.]**

**[CALLOUT: "Reset replaces your wording — read it before you press it"]**

> "And read the warning on the **Reset** button. It puts the shipped wording
> back. If somebody has spent two years refining how your department words its
> dues notice, that goes with it."

**[SCREEN: The Templates tab list, showing which templates the department has
changed and how often each is used]**

> "The list also tells you which of these your department has changed, and how
> heavily each one gets used. That's your priority order for bringing old
> wording back — the heavily-used ones first."

**[SCREEN: The editor and preview side by side]**

> "And the editor and the preview sit side by side, so you're not switching
> tabs to see what you just typed. There's no CSS box any more — every email
> uses the one built-in stylesheet."

**[PRODUCTION NOTE — 2026-10-04: Re-shoot every email preview in this script,
once. There is now **one** state: the solid-tab shell. Shots of the full-bleed
red band (before 2026-08-10), the rounded header band (2026-08-10 → 08-23), the
accent-rule and status-chip shell (2026-08-24 → 09-24) and the centred-masthead
shell (2026-09-25 → 09-26) are all retired, whatever a template had been edited
to — do not caption any of them as current. Film the Previous version panel on
a demo template that has a backup row. The Footers tab is at
`/communications/email-templates?tab=footers`.]**

### PUBLIC PORTAL (17:20 – 17:35)

**[SCREEN: Navigate to Public Portal settings]**

> "The Public Portal is your department's public-facing page — visible to
> non-members. If your department uses this for community engagement, you can
> manage what's displayed: upcoming public events, recruitment information,
> contact details."

**[SCREEN: Show the public portal configuration briefly]**

**[TRANSITION: Suggestion boxes]**

---

## CHAPTER 7: Suggestion Boxes (17:35 – 20:35) — ADDED 2026-09-24

> **Producer note:** suggestion boxes shipped on 2026-09-23; the Compliance box,
> the idea board, Also notify and deleting a box followed that week. The demo
> department has four boxes. The seeder's three — **Training ideas** (Submitter
> chooses), **Station concerns** (Always anonymous) and **Apparatus wish list**
> (Always named, one-way) — are reviewed by the Secretary position, which the
> demo secretary **Owen Kittredge** (`okittredge`) holds; **Training ideas** also
> has the idea board on, with two published ideas and votes. The fourth is the
> default **Compliance** box every department gets, reviewed by the Compliance
> Officer position, which the demo gives to **Lila Nakamura** (`lnakamura`) —
> Owen does not review it and cannot open it. It also files four
> submissions from **Nadia Belhaj** (`nbelhaj`), including an anonymous one
> already under review, with a reply thread and a forward to the Training
> Officer. Record the reviewer beats as Owen and the member beats as Nadia. The
> **Creating a box** beat builds a new box on camera: do it as the
> administrator, use a name that is not already seeded, and do **not** press
> Save if the take will be reused — a saved box stays in the demo department.
> The follow-up key only appears at the moment of submitting, so the member beat
> needs one live anonymous submission. **Every follow-up key on screen must be
> a demo key.** A real key is the submitter's only credential, and this video
> is public.

### WHO SETS THEM UP (17:35 – 18:15)

**[SCREEN: Sidebar → Administration → Forms & Comms, with **Suggestion Boxes**
between Messages and Photo Use Consent.]**

> "Suggestion boxes are new. A department can run as many as it likes — one for
> training ideas, one for station concerns, a complaints box — and each one has
> its own reviewers and its own rules about anonymity."

> "First, who can set them up. That's a permission called
> **suggestions.manage**, and out of the box it's on the Chief, Deputy
> Chief, Assistant Chief, President and Communications Officer. **Not the
> Secretary.** If your chief wants you to run them, they'll need to add it to
> your position — or set the boxes up themselves and name you as a reviewer."

**[CALLOUT: "Setting up a box ≠ reading it"]**

> "And here's the part that matters most. That permission lets you **create**
> boxes and choose who reviews them. It does **not** let you read anything
> anybody submitted. Only the reviewers named on a box can. That's deliberate —
> it's how a department runs a complaints box that the people most likely to be
> complained about can't open."

### CREATING A BOX (18:15 – 19:00)

**[SCREEN: Suggestion Boxes → **New box**. Fill in the dialog: Name "Training
ideas", Description, Anonymity **Submitter chooses**, tick **Allow follow-up**,
tick one reviewer position, then **Save box**.]**

> "Press New box. Give it a name, and a description members will actually read
> — say what the box is for and who reads it."

> "**Anonymity** has three settings. **Submitter chooses** — the member decides
> each time. **Always anonymous** — nobody's name is ever recorded, which is what
> you want for a concerns box. **Always named** — every submission carries the
> member's name."

> "**Allow follow-up** turns on a reply thread, and lets the member see what
> happened to their idea. Leave it off and the box is one-way — you read, you
> don't answer."

> "Then the reviewers — positions, members, or both. Pick a position where you
> can: when somebody new takes that seat, they review the box and the person who
> left stops, with nobody editing anything."

**[CALLOUT: "Boxes are never deleted — untick Accepting submissions to close one"]**

**[SCREEN: The box list, with the seeded **Compliance** box marked as accepting
submissions; open it to show its reviewer, the Compliance Officer position.]**

> "One box is already there when you arrive: **Compliance**. It's switched on
> from day one, and its reviewer is the **Compliance Officer** position. Until
> somebody is appointed to that position, a report filed there waits, unread.
> So either appoint your Compliance Officer, or untick **Accepting
> submissions** until you have one."

**[PRODUCTION NOTE — 2026-10-04. New beat, about 15 seconds; re-time Chapter 7.
The Compliance Officer position and the Compliance box were seeded on upgrade
(2026-09-24) and the box switched on the same day. Film it in a demo department
where nobody holds the position.]**

### WHAT A MEMBER SEES (19:00 – 19:40)

**[SCREEN: Switch to the member account. Sidebar → **Suggestions**, the
**Submit** tab. Choose "Training ideas", type a title and details, attach a
screenshot, tick **Submit anonymously** — the screenshot warning appears.
Press Submit. The **Save your follow-up key** panel appears (demo key).]**

> "Members find it in their sidebar, just after Messages. Pick a box, write it
> up, attach up to five screenshots."

> "When they tick anonymous, it really is anonymous. No name is stored — not
> hidden, not stored. The time is kept to the day only, and screenshots lose
> their hidden location and device data. What it can't do is blur the picture
> itself — if their name is on the screen they captured, it's in the
> screenshot, and the form tells them so."

> "In a follow-up box, an anonymous member gets a **follow-up key**, once.
> That's how they come back and read your replies without ever being
> identified. If they lose it, nobody — not you, not the chief — can look it up."

**[CALLOUT: "Tell members: copy the key before you close that screen"]**

### REVIEWING (19:40 – 20:35)

**[SCREEN: Back as the reviewer. Suggestions → **Review** tab with its open
count. Open the anonymous submission: set Disposition to **Under review**, type
an internal note, send a reply in the Follow-up thread — the author shows as
"Anonymous submitter".]**

> "As a reviewer you get a **Review** tab, with a count of what's open. Open a
> submission and set its disposition — New, Under review, Accepted,
> Implemented, Declined or Duplicate. Keep an internal note; the submitter never
> sees it. And if the box allows follow-up, answer in the thread."

> "You'll get an email when something new arrives — but the email only carries
> a link, never the content. Nothing sensitive sits in anybody's inbox. That
> email is on by default; a reviewer can turn it off in their own notification
> settings, unless your department has made it required. The bell gets it
> either way."

**[SCREEN: Press **Forward**, choose the Training Officer position, confirm.
The **Forwarded to** list shows it, with a **Withdraw** control.]**

> "Sometimes the right person to answer isn't a reviewer. **Forward** sends
> that one suggestion to a member or a position. They can read it, set its
> status and reply — but they see nothing else in the box, and they can't pass
> it on. An anonymous submitter stays anonymous. And you can withdraw it later."

> "One honest caveat to pass on if anyone asks. Anonymous means nobody using
> The Logbook can find out who sent it — and The Logbook's own request logs
> leave these submissions out entirely. What it can't speak for is anything
> your IT runs **in front of** it — a firewall or another proxy keeping its own
> logs. If that matters for what someone wants to raise, they should use
> another route."

**[PRODUCTION NOTE — 2026-10-04. The caveat used to point at the server's own
"raw logs"; since 2026-09-29 the access logs, application request logs and
error reports skip the submission and follow-up routes. Narration only.]**

**[TRANSITION: Workflow summary]**

---

## CHAPTER 8: The Secretary's Weekly Workflow (20:35 – 22:35)

### BEFORE A MEETING (20:35 – 21:05)

**[CALLOUT: Pre-meeting checklist]**

> "**Before the meeting:** Create a new minutes document from the template.
> Review outstanding action items from the last meeting. Confirm the event for
> the business meeting is created and RSVPs are tracked. Prepare any reports
> or documents needed."

### DURING A MEETING (21:05 – 21:35)

> "**During the meeting:** Record minutes in real time using The Logbook on a
> laptop or tablet. Use the structured sections — roll call, reports, old
> business, new business. Record motions with maker, seconder, and vote. Capture
> action items as they arise."

**[SCREEN: Show the minutes editor in use during a simulated meeting flow]**

### AFTER A MEETING (21:35 – 22:05)

> "**After the meeting:** Review and edit the minutes for clarity. Finalize
> attendance. Publish the minutes for the membership. Verify action items are
> assigned with due dates."

### WEEKLY TASKS (22:05 – 22:35)

**[CALLOUT: Weekly task list]**

> "**Weekly:** Update the member roster with any changes — new members,
> departures, position changes. Verify upcoming events are created and accurate.
> Check for pending event requests or form submissions. If you review a
> suggestion box, clear its **Review** tab. Respond to any member inquiries
> about records."

> "**Monthly:** Generate attendance reports for officers. Ensure all meeting
> minutes are published. Review document repository for outdated files."

> "**Annually:** Support the election process. Update SOPs and policies in the
> document repository. Generate year-end attendance and participation reports."

### WRAP-UP (22:35 – 23:05)

> "The Secretary role is all about record-keeping and organizational memory.
> The Logbook replaces the paper filing system, the attendance clipboard, and
> the minutes notebook with a platform that's searchable, shareable, and
> permanent."

> "If you're new to the Secretary role, start with just minutes and attendance.
> Once you're comfortable, expand into documents, forms, and elections. The
> platform grows with you."

**[SCREEN: End card with subscribe, playlist link]**

---

## Clip Extraction Guide

| Clip                         | Timecode    | Standalone Title                              |
| ---------------------------- | ----------- | --------------------------------------------- |
| Recording Meeting Minutes    | 1:30–5:00   | "Recording Meeting Minutes in The Logbook"    |
| Creating Action Items        | 3:00–4:00   | "Tracking Action Items from Meetings"         |
| Event Attendance Tracking    | 7:30–8:30   | "Managing Event Attendance"                   |
| Adding a New Member          | 10:00–10:30 | "How to Add a New Member (Secretary)"         |
| Document Organization        | 12:00–13:00 | "Organizing Your Department's Documents"      |
| Custom Forms Builder         | 13:30–14:00 | "Building Custom Forms for Your Department"   |
| Email Footers, Once          | 16:05–17:00 | "Change Your Email Footer Once, Not 35 Times" |
| Suggestion Boxes             | 17:35–20:35 | "Running Suggestion Boxes — Anonymous or Not" |
| Secretary's Meeting Workflow | 20:35–22:05 | "The Secretary's Meeting Workflow"            |

## AUGUST 14 RELEASE INSERTS — EVENT DELIVERY AND ACTION CLEANUP

### Add to “CREATING & MANAGING EVENTS”

Use the reminder-audience and check-in narration from Script 04. Demonstrate
both an optional event (`going`) and a mandatory event (`all`), then change the
audience explicitly and show that toggling Mandatory no longer overwrites it.
Show the template selector separately because templates persist their own
choice. Add 1:30.

### Add to “COMMUNICATIONS”

> "Every targeted department message receives best-effort email at every
> priority. Urgent adds SMS only when Twilio, consent, and the member preference
> all allow it. Completing an event or scheduling action archives only the
> notification carrying the matching organization, entity, and action IDs; an
> unrelated notification remains."

**[SCREEN: related notification before action; complete action; refresh; unrelated notification remains.]**

### Add to “MEMBER SCANNING”

> "Roster administration and scanning are separate permissions. Directory reads
> use `members.view`; the scanner requires `users.view` or `members.manage`."

**EDITOR:** Add 2:30; re-time Chapters 3–7, Wrap-Up, and clip rows.

---

## ADD TO "MEETING MINUTES" (ADDED 2026-08-31)

**[SCREEN: A meeting record with a linked event; press Unlink; reload the page]**

> "Two fixes here worth knowing about, and one of them you may have been
> working around without realising."

**[CALLOUT: "Unlink now actually unlinks."]**

> "Pressing **Unlink** on a meeting record's linked event told you 'Event
> unlinked' — and then the link came straight back on the next page load. It
> never removed anything. If you've been re-doing that and assuming you'd
> misclicked, you hadn't. It takes effect now, and it sticks."

**[SCREEN: A meeting record's audit history]**

> "And meeting **records** now leave an audit trail. Minutes always did —
> who edited what, when. But creating, editing, deleting or approving the
> meeting record itself, and adding or removing its attendees and action items,
> recorded nothing at all. All of it is recorded now, which matters the first
> time somebody asks who moved a meeting."

---

## ADD TO "SUBMITTING MINUTES" (ADDED 2026-08-31)

> "One separation-of-duties fix: **a secretary could submit and approve their
> own meeting minutes.** That is closed. If you are used to doing both, you now
> need the second signature your bylaws probably already required."
