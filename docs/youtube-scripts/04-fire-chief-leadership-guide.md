# Script 4: Fire Chief & Department Leadership Guide

**Video Type:** Role-Based Guide (Medium-Form)
**Estimated Length:** 25–30 minutes
**Target Audience:** Fire Chiefs, Deputy/Assistant Chiefs, Presidents, Vice Presidents
**Roles Covered:** fire_chief, deputy_chief, assistant_chief, president, vice_president
**Chapters:** 8 (each designed as a standalone clip)

---

## CHAPTER 1: Introduction — Leading with The Logbook (0:00 – 2:00)

### HOOK (0:00 – 0:30)

**[SCREEN: Dashboard showing upcoming events, member attendance stats, training
compliance percentages, and scheduling overview. The view of a leader who can
see the big picture at a glance.]**

> "As Fire Chief or department president, your job is the big picture — are we
> staffed, are we trained, are we compliant, and are we running efficiently? The
> Logbook puts all of that in one place. In this video, I'll show you everything
> you can do as a department leader — and how to do it fast."

### WHAT THE CHIEF SEES (0:30 – 2:00)

**[SCREEN: Show the sidebar — highlight the modules accessible to the Chief
role. Most modules are visible but some admin-only sections like IP Security
or Platform Analytics are absent.]**

> "As Fire Chief, you have near-full access to the platform — but you're not
> the IT Manager. You can manage members, events, training, scheduling,
> apparatus, and elections. You can view reports and analytics. What you
> typically _don't_ have is access to system settings like server configuration,
> integrations, or IP security — that's the IT Manager's domain."

> "The President has a similar access level but is more focused on governance —
> elections, meeting minutes, and financial oversight. Since these roles overlap
> significantly, this guide covers both."

**[CALLOUT: "Chief = operational authority. President = governance authority.
Both = leadership oversight."]**

> "Let's start with the dashboard — your daily command view."

**[TRANSITION: Cut to dashboard walkthrough]**

---

## CHAPTER 2: The Leadership Dashboard (2:00 – 5:00)

### DASHBOARD OVERVIEW (2:00 – 3:30)

> **📷 B-ROLL NOTE (2026-08-11) — narration is correct, the screen is not.** The
> **Open Shifts** panel is capped at five with an "N more" line as of
> 2026-08-10; before that it rendered every open shift in the next 30 days, so
> any capture taken earlier shows a page several thousand pixels tall. Re-shoot
> the screen, keep the audio. Nothing in the script below needs changing.

**[SCREEN: The main Dashboard page with all widgets visible.]**

> "The dashboard is the first thing you see when you log in. It's designed to
> give you a situational awareness snapshot — like a status board in the
> firehouse."

**[SCREEN: Point to each widget area as you describe it]**

> "**Upcoming Events** — the next few events on the calendar with RSVP counts.
> At a glance, you can see if tonight's drill has enough people coming."

**[CALLOUT: Arrow pointing to the upcoming events widget]**

> "**Training Compliance** — a percentage showing how many members are current
> on their required certifications. If this number drops below your threshold,
> you know you need to schedule training."

> "**Member Stats** — total active members, new members this month, and
> attendance trends."

> "**Scheduling Overview** — who's on shift today, any open slots that need
> filling."

> "**Recent Activity** — a feed of what's happened recently: new events created,
> training recorded, documents uploaded."

### ANALYTICS DASHBOARD (3:30 – 5:00)

**[SCREEN: Navigate to the Analytics Dashboard (AnalyticsDashboardPage)]**

> "For deeper numbers, click into the Analytics Dashboard. This gives you trend
> data over time."

**[SCREEN: Show charts — attendance over time, training completion rates,
event participation, member activity]**

> "You can see attendance trending up or down over the last three, six, or
> twelve months. Training compliance by category — is Hazmat current but CPR
> falling behind? Event participation rates — which events get strong turnout
> and which ones are struggling?"

> "This is the data you bring to your officers' meetings. Instead of guessing
> whether the department is healthy, you have the numbers."

**[CALLOUT: "Export any chart or report as PDF for officer meetings"]**

**[TRANSITION: Events section]**

---

## CHAPTER 3: Managing Events (5:00 – 10:00)

### CREATING AN EVENT (5:00 – 7:00)

**[SCREEN: Navigate to Events → Create Event (EventCreatePage)]**

> "Events are the heartbeat of any fire department — drills, business meetings,
> trainings, fundraisers, community events. Let's create one."

**[SCREEN: Fill in the event creation form step by step]**

> "**Event Name** — 'March Monthly Drill.' **Event Type** — select 'Training'
> from the dropdown. The types were configured during setup. **Date and Time** —
> set the start and end time. Remember, the system handles timezone conversion
> automatically, so enter times in your local timezone."

**[SCREEN: Set date and time fields]**

> "**Location** — select from your department's locations, or enter a custom
> address. **Description** — add details about what the drill will cover."

> "**RSVP Settings** — you can set an RSVP deadline, require RSVPs, set a
> minimum or maximum headcount. If you want a minimum of 15 members to run the
> drill, set that here and the system will warn you if RSVPs fall short."

**[SCREEN: Configure RSVP settings]**

> "**QR Check-In** — enable this and the system generates a unique QR code for
> the event. Members scan it with their phone when they arrive for instant,
> contactless attendance tracking."

**[CALLOUT: "QR Check-In = no more paper sign-in sheets"]**

### GUEST CHECK-IN FOR AN OPEN HOUSE (added 2026-08-09)

**[SCREEN: The Check-In Settings section of the event form, ticking "Allow guest
check-in" and "Create a prospective member from each guest".]**

> "That QR code is for **members**. Scan it without an account and you land on the
> login page — which is exactly the wrong thing to hand a visitor at a volunteer
> interest night."

> "So there's a second one. Tick **Allow guest check-in** and the room display
> shows a **guest QR code** beside the member one. A visitor scans it, types their
> name, and they're signed in. No account, no login."

**[SCREEN: The room display showing both QR codes side by side.]**

> "And the second toggle is the one I'd actually pay for. **Create a prospective
> member from each guest** — every visitor who leaves an email address gets a card
> in your recruitment pipeline, linked back to the event, with a referral source
> reading 'Attended: Volunteer Interest Night'. Your open-house sign-in sheet
> becomes your recruiting list, automatically."

**[CALLOUT: "Sign-in sheet → recruiting pipeline, automatically"]**

**[SCREEN: The two toggles, both off, on a business meeting event.]**

> "One warning, and it's the reason both of these are **off by default**. Turning
> guest check-in on means anyone who can reach that QR code can write to your
> attendance list without logging in. That's the right trade for an open house. It
> is the **wrong** trade for a business meeting or a training session, where
> attendance drives member records. Leave it off there."

> "It's protected — rate limits, a cap of three hundred sign-ins per event per
> day, and the department is worked out from the room's own display code rather
> than from anything the visitor sends. But the judgment about which events get it
> is yours."

### EVENT TEMPLATES (7:00 – 8:00)

**[SCREEN: Navigate to Events → Templates (EventTemplatesPage)]**

> "If you run the same type of event every month — like a monthly business
> meeting or weekly drill night — create a template. Templates pre-fill all the
> fields so you just pick a date and go."

**[SCREEN: Show creating or using a template]**

> "Create a template once, reuse it all year. It saves time and ensures
> consistency."

### MONITORING ATTENDANCE (8:00 – 9:00)

**[SCREEN: Navigate to an event's detail page (EventDetailPage) showing the
RSVP list and check-in status]**

> "Once an event is live, you can monitor it in real time. The event detail page
> shows who has RSVPed yes, no, or maybe. Once check-in starts, you see who's
> actually arrived."

**[SCREEN: Show the RSVP breakdown — yes/no/maybe counts and member names]**

> "If you have QR check-in enabled, there's also a monitoring view."

**[SCREEN: Navigate to Event Check-In Monitoring (EventCheckInMonitoringPage)]**

> "This is great to have on a tablet at the door. It shows a live feed of
> check-ins as they happen."

### EVENT ANALYTICS (9:00 – 10:00)

**[SCREEN: Navigate to Event Analytics (EventAnalyticsPage)]**

> "The Event Analytics page shows attendance trends across all events. Which
> events get the best turnout? Which members consistently attend or consistently
> miss? Which day of the week works best?"

**[SCREEN: Show charts and filters for event analytics]**

> "This data is gold for planning. If Tuesday drills get 80% attendance but
> Thursday drills only get 40%, maybe it's time to move drill night."

**[TRANSITION: Member management]**

---

## CHAPTER 4: Member Oversight (10:00 – 14:00)

### VIEWING THE ROSTER (10:00 – 11:00)

**[SCREEN: Navigate to Members list page]**

> "As Chief or President, you can view the full member roster. You can see every
> active member, their position, their station assignment, and their membership
> type."

**[SCREEN: Show the members list with sorting and filtering]**

> "Filter by position to see all your Captains, or by station to see who's
> assigned where. The search bar lets you find anyone instantly."

### MEMBER PROFILES (11:00 – 12:00)

**[SCREEN: Click into a member's profile (MemberProfilePage)]**

> "Click on any member to see their full profile. You'll see their personal
> information, position history, training records, attendance history, equipment
> assignments, and certifications."

**[SCREEN: Scroll through the profile tabs]**

> "As a leader, this is where you check on individual readiness. Is this member
> current on all their certifications? How's their attendance? Have they
> completed the required training for their position?"

**[SCREEN: Scroll to the Emergency Contacts section on the profile]**

> "Two things on this page you're seeing because of your position, and ordinary
> members are not: date of birth, and emergency contacts. Chiefs, captains, the
> president, vice-president, secretaries and the membership coordinator can see
> them. Everyone else gets nothing — the section isn't even rendered."

> "There's no setting to change that, and that's deliberate. Emergency contacts
> aren't really your members' data — they're a spouse's name and phone number,
> a parent's, a neighbor's. Those people never joined your department and have
> no account here to remove themselves. So the system doesn't offer you the
> option of putting them on the roster."

> "The other half of that: when you open a member's profile, the system records
> that you saw those fields. Not to police you — you have a legitimate reason,
> that's why you have the access. But if a member ever asks who's been looking
> at their family's phone number, you want that to be a question with an
> answer."

### MEMBER ID CARDS (12:00 – 12:30)

**[SCREEN: Navigate to Member ID Card page (MemberIdCardPage)]**

> "The platform can generate member ID cards. These are printable cards with the
> member's photo, name, position, department, and a QR code that can be scanned
> for check-in."

**[SCREEN: Show a generated ID card]**

### PROSPECTIVE MEMBERS PIPELINE (12:30 – 14:00)

**[SCREEN: Navigate to Prospective Members section]**

> "If your department is actively recruiting, the Prospective Members Pipeline
> tracks applicants from initial interest through to full membership."

**[SCREEN: Show the pipeline view — kanban board or table with stages]**

> "Each applicant moves through configurable stages — Application Received,
> Background Check, Interview, Probationary Period, Full Member. You can see
> where everyone is at a glance."

**[SCREEN: A board with a large intake — full columns, and the truncation notice
if the pipeline exceeds 200.]**

> "And you're now seeing **all** of them. That board used to be built from one
> page of applicants — twenty-five — so a big recruiting class meant cards were
> just missing from columns, with nothing on screen saying so. If you ran a large
> intake before August 2026 and the numbers looked light, that's why."

> "If you go past two hundred active applicants, the board tells you what it
> isn't showing rather than dropping them quietly. At that scale, work from the
> table view."

**[SCREEN: Click into an applicant to show their detail view]**

> "Click on any applicant to see their progress, notes, documents, and next
> steps. You can advance them to the next stage, add notes from their interview,
> or mark them as rejected with a reason."

**[SCREEN: Select twelve applicants; run a bulk advance; the itemized result
appears — ten advanced, two named and skipped with reasons.]**

> "Selecting a group and advancing them is one action now, and — more usefully —
> it **tells you who didn't move and why.** It used to come back as a bare count
> with no names, so a partial failure was something you found out about later."

**[CALLOUT: "Bulk actions name who was skipped, and why"]**

> "One thing worth knowing if you're auditing past decisions: before August 2026,
> pressing Advance on somebody already at the final stage reported success and
> wrote an audit entry saying they'd been advanced, when nothing had happened.
> It now refuses, and the audit entry is only written after a real move. If
> you're reconstructing a membership decision from before that date, check the
> applicant's stage history rather than trusting the audit line alone."

> "When an applicant completes the pipeline, you can convert them directly to a
> full member — their data carries over automatically."

**[CALLOUT: "Pipeline → Convert to Member = seamless onboarding"]**

**[TRANSITION: Elections section]**

---

## CHAPTER 5: Running Elections (14:00 – 18:00)

> **Producer note:** this chapter is the overview. The canonical elections
> deep-dive — including eligibility, proxies, runoffs, and auditing — is
> **Script 12** (with its edge-case shorts pack 12a–12j). Keep this chapter
> high-level and point viewers to Script 12 in the end card.

### CREATING AN ELECTION (14:00 – 15:30)

**[SCREEN: Navigate to Elections (ElectionsPage)]**

> "Officer elections are a core part of fire department governance. The Logbook
> handles the entire process — creating the election, managing candidates,
> collecting votes, and tabulating results."

**[SCREEN: Click "Create Election"]**

> "Let's set up an annual officer election. Enter the election name — 'Annual
> Officer Election 2026.' Set the voting period — when voting opens and when it
> closes."

**[SCREEN: Fill in the election creation form]**

> "Choose your voting method. Simple majority is the most common — each voter
> picks one candidate per office. Ranked choice, approval voting — where members
> can approve as many candidates as they like — and supermajority are also
> available. And if you enable runoffs, the system automatically creates a
> runoff election when no candidate meets the victory condition."

> "Set eligibility rules — who can vote? Active members only? Minimum tenure of
> one year? The system automatically determines eligible voters based on your
> rules."

### MANAGING CANDIDATES AND OFFICES (15:30 – 16:30)

**[SCREEN: Navigate to the election detail page (ElectionDetailPage)]**

> "Now add the offices being contested — Fire Chief, Captain, President,
> Treasurer — whatever positions are up for election."

**[SCREEN: Add offices/positions to the election]**

> "For each office, add the candidates. Candidates can self-nominate if you
> enable that option, or you can add them manually."

**[SCREEN: Add candidates to an office]**

> "Each candidate can have a profile — a photo and a brief statement that voters
> see on the ballot."

### THE VOTING EXPERIENCE (16:30 – 17:30)

**[SCREEN: Show the ballot voting page from a member's perspective
(BallotVotingPage)]**

> "When voting opens, eligible members see a notification on their dashboard.
> They click into the election, see the ballot with all candidates organized by
> office, and cast their votes."

**[SCREEN: Walk through voting on a sample ballot]**

> "Votes are recorded securely. Members can only vote once per election. The
> ballot is confidential — only the aggregate results are visible."

> "As the election administrator, you can monitor voting progress in real time —
> how many eligible voters have cast ballots, the participation percentage —
> without seeing individual votes."

### CLOSING & PUBLISHING RESULTS (17:30 – 18:00)

> "When voting ends — automatically at the scheduled time, or when you close it
> manually at the end of the meeting — the system tabulates the results. If no
> candidate meets the victory condition and runoffs are enabled, a runoff
> election is created automatically."

**[SCREEN: Show the closed election with the Publish Results panel]**

> "Review the results, then use the Publish Results panel to make them visible
> to the membership and email the results report. One tip: if you closed voting
> early, flip 'results visible immediately' so members don't have to wait for
> the originally scheduled end time."

> "Results are recorded permanently, every vote carries a cryptographic
> signature, and a full forensic audit trail is available if an election is
> ever disputed."

**[CALLOUT: "Election results are permanently archived with a tamper-evident audit trail"]**

**[TRANSITION: Communications]**

### DEPARTMENT ANNOUNCEMENTS (17:45 – 18:00)

**[SCREEN: Navigate to Communications → Messages]**

> "When you need to reach the whole department fast, use Communications →
> Messages. Set the priority: a normal post shows up in the app, but mark it
> Urgent and it also goes out by email and text message, so a mandatory callback
> or a station closure reaches people who aren't logged in. Target everyone, a
> specific role, or individual members."

> "For anything members must confirm — a policy change, an inspection deadline —
> turn on Require acknowledgment. You'll get a report of exactly who has and
> hasn't signed off, which is your paper trail for compliance. You can also
> schedule an announcement to go out at a set time."

**[SCREEN: Show an urgent message and the acknowledgment report]**

---

## CHAPTER 6: Scheduling & Shift Oversight (18:00 – 22:15)

### VIEWING THE SCHEDULE (18:00 – 18:45)

**[SCREEN: Navigate to Scheduling (SchedulingPage)]**

> "The Scheduling module gives you a calendar view of all shifts, duties, and
> coverage. As a Chief, you're looking at the big picture — are all shifts
> covered? Are there any gaps?"

**[SCREEN: Show the scheduling calendar with shifts displayed]**

> "You can view by week, by month, or by individual. Color coding shows shift
> types and coverage status — green for fully staffed, yellow for minimum
> staffing, red for gaps."

### APPROVING SHIFT SWAPS (18:45 – 19:45)

> "When members request shift swaps, the requests come to the designated
> approver — usually a Captain or Chief officer. You'll see pending swap
> requests in your dashboard notifications."

**[SCREEN: Show a swap request notification. Click into it to show the details:
who's swapping, which shifts, and the impact on coverage.]**

> "Review the swap: does it leave the shift understaffed? Is the replacement
> qualified? If everything checks out, approve it. If not, deny it with a
> reason."

**[SCREEN: Show approving a swap request]**

### SETTING SHIFT CLOSE-OUT RULES (19:45 – 20:15)

**[SCREEN: Scheduling → Settings → Close-out rules card]**

> "Here's where you set your department's standards for closing out a shift. You
> can require that end-of-shift equipment checks are done before an officer can
> finalize a shift — so every apparatus is verified ready and nothing slips
> through."

**[SCREEN: Toggle on "Require end-of-shift equipment checks"]**

> "It's off by default. When you turn it on, an officer who tries to finalize
> with checks outstanding is stopped — but they can still override in a genuine
> emergency, and that override is written to the audit log with their reason."

**[CALLOUT: "Accountability without getting in the way of the run."]**

### WHAT'S EXPIRING ON YOUR TRUCKS (20:15 – 21:30)

**[SCREEN: Scheduling → Supply. The "Expiring on Apparatus" page loads.]**

> "While we're here — this page answers a question you've probably asked out
> loud and not been able to get a straight answer to. What's about to expire on
> my apparatus?"

**[SCREEN: Point to the three summary pills at the top]**

> "Everything on your trucks that's expiring, expired, running short, or that a
> crew has reported using. In one list."

**[SCREEN: Point to a row with ready stock, then to one without]**

> "And here's the bit that makes it useful rather than just alarming. Each row
> tells you **whether you've actually got a replacement on the shelf**."

**[CALLOUT: "'Swap it' and 'order it' are different jobs"]**

> "Because those are two different jobs. The rows with stock behind them are a
> job for whoever's on today — go and swap them. The rows without are a
> purchase order. You plan your week around which is which, and until now you
> had to work that out by walking the building."

**[SCREEN: Point to the 30/60/90 window selector]**

> "Thirty, sixty or ninety days ahead, depending on how far out you want to
> think."

**[SCREEN: Point to a struck-through expired row]**

> "Anything already expired on the shelf shows struck through, and the system
> won't let a crew put it on a truck. That's not a suggestion — the swap is
> refused."

> "And you get this as a **weekly notification**, so nobody has to remember to
> come and look. Weekly rather than daily on purpose: something that's _already_
> expired fails its truck on the next check and tells you that way. This alert
> exists to get ahead of the date."

**[PRODUCTION NOTE: The demo seeder's `seed_supply_tracking` step produces rows
in all four states — expiring with stock, expired, short of par, and reported
used by a crew member. Without it this page is empty and the beat has nothing
behind it.]**

> "You can also require that only rostered members check in, so attendance
> matches the crew that actually worked. And if something needs fixing after a
> shift is closed, an officer can reopen it, make the correction, and finalize
> again — every reopen is logged too."

### SCHEDULING REPORTS (21:30 – 22:15)

**[SCREEN: Navigate to Scheduling Reports (SchedulingReportsPage)]**

> "Scheduling reports show you staffing patterns over time — who's working the
> most hours, who's consistently available, where your coverage gaps tend to
> fall."

**[SCREEN: Show scheduling report charts]**

> "This data feeds into shift planning. If you consistently have gaps on
> Saturday mornings, you know to either recruit more weekend availability or
> adjust the schedule."

**[TRANSITION: Reports section]**

---

## CHAPTER 7: Reports & Decision-Making (22:15 – 25:15)

### GENERATING REPORTS (22:15 – 23:45)

**[SCREEN: Navigate to Reports (ReportsPage)]**

> "The Reports module aggregates data from across the entire platform. You can
> generate reports on membership, attendance, training compliance, equipment
> status, scheduling, and more."

**[SCREEN: Show the report type selection]**

> "Let's generate a Training Compliance report. Select 'Training Compliance,'
> set the date range, and choose which member groups to include."

**[SCREEN: Generate the report. Show it loading and then displaying with charts
and tables.]**

> "The report shows each member's certification status — current, expiring soon,
> or expired. It highlights exactly who needs attention and which certifications
> are most at risk."

> "Export this as a PDF for your officer meeting, or as a CSV for further
> analysis in a spreadsheet."

**[SCREEN: Show the export options]**

### SHIFT REPORTS (23:45 – 24:15)

**[SCREEN: Navigate to Shift Reports (ShiftReportPage)]**

> "Shift reports give you a detailed breakdown of each shift — who was on duty,
> what happened, any incidents or notes."

### USING DATA FOR DECISIONS (24:15 – 25:15)

> "Here's the bigger picture on reports. The Logbook replaces the filing cabinet,
> the spreadsheets, and the notebooks. Every data point your officers collect —
> attendance, training completions, equipment maintenance, shift hours — is
> searchable, sortable, and exportable."

**[CALLOUT: Key reports for officer meetings]**

> "For your monthly officer meeting, I recommend three standing reports:
> **Training Compliance** — who's current and who's not. **Attendance Summary**
> — participation trends across events. **Scheduling Coverage** — where are the
> gaps and how are we addressing them."

> "Having this data readily available transforms officer meetings from guessing
> games into informed decision-making."

**[TRANSITION: Wrap-up]**

---

## CHAPTER 8: Daily Workflow Summary (25:15 – 27:15)

### THE CHIEF'S DAILY ROUTINE (25:15 – 26:45)

> "Let me put it all together with what a typical day looks like on The Logbook
> as Fire Chief or President."

**[SCREEN: Dashboard view]**

**[CALLOUT: Daily routine steps appearing one at a time]**

> "**Morning:** Check the dashboard. See tonight's event RSVPs. Review any
> pending shift swap requests. Check the training compliance number."

> "**Before Events:** Pull up the event detail to see who's coming. If it's a
> training event, verify the instructor and materials are set."

> "**During Events:** If QR check-in is enabled, the attendance tracks itself.
> If not, the event manager handles it."

> "**After Events:** Review attendance. The system automatically updates
> participation records."

> "**Weekly:** Review analytics for trends. Check prospective member pipeline
> progress. Review any pending actions from the previous meeting minutes."

> "**Monthly:** Generate standing reports for the officer meeting. Review member
> certifications approaching expiration. Check equipment maintenance schedules."

### WRAP-UP (26:45 – 27:15)

> "The Logbook isn't meant to create more work — it's meant to replace the
> scattered paper records, spreadsheets, and group texts with a single source of
> truth. As a department leader, you see the full picture in one place."

> "In the next video, we'll look at The Logbook from the Training Officer's
> perspective — managing certifications, tracking compliance, and running
> training programs."

**[SCREEN: End card with subscribe, next video link, and playlist link]**

---

## Clip Extraction Guide

| Clip                           | Timecode    | Standalone Title                                |
| ------------------------------ | ----------- | ----------------------------------------------- |
| Dashboard Overview             | 2:00–5:00   | "Your Leadership Dashboard Explained"           |
| Creating an Event              | 5:00–7:00   | "Creating an Event with QR Check-In"            |
| Event Templates                | 7:00–8:00   | "Save Time with Event Templates"                |
| Running an Election            | 14:00–18:00 | "How to Run a Department Election"              |
| Scheduling Overview            | 18:00–22:15 | "Managing Shifts & Scheduling"                  |
| Shift Close-Out Rules          | 19:45–20:15 | "Require End-of-Shift Checks Before Finalizing" |
| What's Expiring on Your Trucks | 20:15–21:30 | "What's About to Expire on Your Apparatus"      |
| Generating Reports             | 22:15–23:45 | "Generating Reports for Officer Meetings"       |
| Chief's Daily Routine          | 25:15–26:45 | "The Chief's Daily Routine on The Logbook"      |
