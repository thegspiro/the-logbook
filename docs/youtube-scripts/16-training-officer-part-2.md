# Script 16: Training Officer, Part 2 — Evaluating, Reporting & Running the Calendar

**Video Type:** Role-Based Guide (Medium-Form)
**Estimated Length:** 15–18 minutes
**Target Audience:** Training Officers, Safety Officers, Compliance Officers
**Roles Covered:** training_officer, safety_officer
**Chapters:** 4 (each designed as a standalone clip)
**Requires permission:** `training.manage`. Since 2026-08-25 there is a narrower alternative, `training.configure`, which grants **the member-disclosure policy and nothing else**; every other training setting returns 403 without `training.manage`. **A take saying the visibility panel is behind "training management" is wrong; so is a take implying `training.configure` covers the module's other settings.**

> **This is Part 2 of two.** [Part 1](./05-training-officer-guide.md) covers the
> dashboard, building programs and requirements, and recording completions —
> setting the system up so it knows what your department owes. This one covers
> using it: evaluating members, proving compliance to the people who ask, and
> putting training on the calendar.
>
> They were one 26-minute video. Splitting it means a new training officer can
> finish Part 1, go and actually build their requirements, and come back — rather
> than watching half an hour of features they can't use yet.

> **Chapter 2 is a summary, not the deep dive.** Skills testing has its own video
> — [Script 15](./15-skills-testing-evaluations.md) — covering result disclosure,
> the void/cancel/delete lifecycle, attempt limits and scorecard integrity. If you
> run psychomotor evaluations, watch that one after this.

---

## CHAPTER 1: Where We Left Off (0:00 – 1:15)

### COLD OPEN (0:00 – 0:35)

**[SCREEN: The Compliance Matrix triage rail — the compliant group collapsed,
with the at-risk and non-compliant groups open above it.]**

**[EDITOR NOTE (2026-09-05): the grid of coloured cells this shot described was
replaced by a triage rail grouped by standing. Re-shoot the cold open; the old
footage shows a screen that no longer exists.]**

> "At the end of Part 1 you had a training program, a set of requirements, and a
> way to record completions. Which means the system now knows what your department
> owes — and, for the first time, it can tell you who hasn't paid up."

**[SCREEN: Open the first member in the non-compliant group; their unmet
requirements list with the figures behind each one — "6 of 24 hours",
"Lapsed 41 days ago".]**

> "That's this. And it's the difference between _having_ a training program and
> being able to _prove_ you have one."

### WHAT PART 2 COVERS (0:35 – 1:15)

**[CALLOUT: "Evaluate · Prove · Schedule"]**

> "Three things. **Evaluating** members with skills tests — a summary here,
> because it earned its own video. **Proving** compliance: the reports you hand a
> chief, an insurer, or a state inspector. And **scheduling** — putting training on
> the calendar so completions record themselves instead of you typing them in."

> "We finish with the weekly, monthly and quarterly routine that ties all of it
> together. If you only take one thing from this video, take that."

**[CALLOUT: "Haven't watched Part 1? Build your requirements first — this video
assumes they exist."]**

**[TRANSITION: Skills testing]**

---

## CHAPTER 2: Skills Testing (1:15 – 5:15)

### WHAT IS SKILLS TESTING? (1:15 – 2:15)

**[SCREEN: Navigate to Skills Testing (SkillsTestingPage)]**

> "Skills testing goes beyond certifications — it's hands-on evaluation of a
> member's practical skills. Can they throw a ladder? Can they perform a search
> pattern? Can they operate the pump?"

> "The Logbook lets you create skills testing templates, conduct tests, and
> record results — all digitally."

### CREATING SKILL TEMPLATES (2:15 – 3:45)

**[SCREEN: Navigate to Skills Testing Templates
(SkillsTestingTemplatesTab). Click to create a new template.]**

> "First, create a template. The Skill Template Builder lets you design a
> testing protocol."

**[SCREEN: Navigate to the Skill Template Builder
(SkillTemplateBuilderPage)]**

> "**Template Name:** 'Annual SCBA Proficiency Test.'
> **Skills to Evaluate:** Add each skill being tested — 'Don and doff SCBA in
> under 60 seconds,' 'Navigate a zero-visibility environment,' 'Emergency air
> management.'"

**[SCREEN: Add several skills to the template with pass/fail criteria]**

> "For each skill, set the evaluation criteria — pass/fail, scored 1-5, or
> timed. You can add detailed instructions for the evaluator and the member."

### CONDUCTING A SKILLS TEST (3:45 – 4:45)

**[SCREEN: Navigate to Start Skill Test (StartSkillTestPage)]**

> "When it's time to test, select the template and search for the member being
> evaluated. The system presents each skill in order."

> "That candidate field is a **search**, not a dropdown of the whole department.
> Type two letters of the name. You can confirm somebody you already know; you
> can't browse the roster from here, and it only shows the first fifteen matches
> — so type more of the name rather than scrolling."

> "One thing you'll notice: you can't select **yourself** as the candidate.
> Skills testing is somebody observing you perform — so the examiner and the
> candidate have to be two different people. If you want to run through a
> sheet on your own to practice, switch the test into **practice mode**;
> practice attempts don't touch anyone's record."

**[SCREEN: An ordinary member's account, no training permissions, starting an
official test.]**

> "And since August 2026 you are not the only person who can do this. **Any
> member can run an official skills test** — because in most departments the
> person holding the clipboard is a senior member, not an officer."

> "What comes back to you is the sign-off. A test a member ran arrives in your
> queue as a **submission**: it's scored and stored, but it credits nothing, uses
> none of the candidate's attempts, and doesn't move your pass rate. You read the
> scorecard and **validate** it — or **void** it, with a reason. Your own tests
> validate the moment you submit them, so nothing changes about your workflow."

**[CALLOUT: "Anyone can examine. Only an officer can validate."]**

**[SCREEN: Show the active skill test interface (ActiveSkillTestPage)]**

> "Walk through each skill — mark it as pass or fail, add notes on performance,
> record the time if it's a timed evolution."

**[SCREEN: Show marking skills and adding notes]**

> "Your scoring saves itself as you go — that screen's meant to be used
> one-handed, outdoors, while you're actually watching somebody, so it doesn't
> wait for you to remember to press Save."

> "When the test is complete, the results are saved to the member's training
> record. You can see a history of all their skills test results over time — and
> so can **they**, on My Training."

### TEST RECORDS (4:45 – 5:15)

**[SCREEN: Navigate to Skills Testing Test Records
(SkillsTestingTestRecordsTab)]**

> "The Test Records tab gives you a complete history of all skills testing
> conducted. Search by template, candidate or examiner name, filter by date
> range or by result, and page through the list."

**[SCREEN: Point to the date range (opens on the last twelve months) and the
Export button]**

> "Export gives you a CSV of exactly the rows you're looking at — and it needs a
> date range of no more than a year. Outside that, the button is disabled and
> tells you why."

**[PRODUCTION NOTE — 2026-10-06. New beat, about 15 seconds; re-record the
Test Records screen (SKT3-2): paged list, server-side search, date range
defaulting to twelve months, Export disabled with a reason when the range is
missing or over 366 days.]**

**[SCREEN: Show filtering and browsing test records]**

> "This is your documentation for NFPA compliance — proof that your members are
> tested and proficient."

**[SCREEN: Filter the records list to "Needs Validation".]**

> "There's a filter here for results **waiting on you** — the ones a member ran.
> The count also shows on the Skills Testing dashboard, so it comes and finds you
> rather than sitting there unnoticed."

**[SCREEN: Hover three rows showing Delete, Void and Cancel respectively.]**

> "And notice each row offers exactly one way to take it off the books. Practice
> attempts you delete. A scored official result you **void** — the record stays,
> with a reason you type and your name on it, and any training requirement that
> pass had completed goes back to incomplete. An evaluation you abandoned
> mid-session you **cancel**. You can't delete an official result: an examiner
> observed something, so you withdraw it rather than erase it."

> "Void doubles as your **reject** button on the validation queue. Same reasoning
> — somebody sat for that evaluation, so you refuse it with a reason attached
> rather than erasing it."

**[CALLOUT: "Full deep-dive: Script 15 — Skills Testing"]**

> "There's a lot more here than fits in this chapter — who can run a test and who
> signs it off, deciding how much of a result the candidate sees and when,
> attempt limits, and one genuinely nasty bug that used to let editing a published
> sheet rewrite scorecards you'd already finished. That's all in **Script 15**,
> the skills-testing deep dive. If you've been running skills testing since before
> August 2026, watch that one."

**[TRANSITION: Compliance and reporting]**

---

## CHAPTER 3: Compliance Reporting (5:15 – 8:15)

### COMPLIANCE OFFICER DASHBOARD (5:15 – 6:15)

**[SCREEN: Navigate to Compliance Officer Dashboard
(ComplianceOfficerDashboard)]**

> "The Compliance Officer Dashboard is the big-picture compliance view. It
> aggregates data from training, certifications, and skills testing into a
> single compliance score."

**[SCREEN: Show the compliance dashboard with metrics and charts]**

> "You'll see overall compliance percentage, broken down by category —
> medical certifications, operational certifications, safety training, and
> skills testing. Each category shows how many members are current versus
> how many are overdue."

### COMPLIANCE REQUIREMENTS CONFIGURATION (6:15 – 7:15)

**[SCREEN: Navigate to Compliance Requirements Config
(ComplianceRequirementsConfigPage)]**

> "This is where you define what 'compliance' means for your department. Which
> certifications are mandatory? Which are optional? What are the recurrence
> intervals?"

**[SCREEN: Show the requirements configuration with mandatory/optional toggles]**

> "You might have state-mandated requirements — like annual Hazmat refresher
> for all members — and department-specific requirements — like monthly
> apparatus familiarization for Engineers. Configure both here."

**[SCREEN: On the Thresholds tab, highlight the "Evaluation Period" checkbox]**

> "One setting on the Thresholds tab worth knowing: the **Evaluation Period**.
> If your drills land late in the month, leaving the current month in the
> calculation makes members look non-compliant before they've even had the
> class. Uncheck **Count the current (in-progress) month in compliance
> calculations** and compliance stops at
> the end of last month, so members are measured against where they stood when
> the month began. It's a department-wide default, and any single requirement
> can override it from its own Evaluation Period dropdown."

**[SCREENSHOT NEEDED]:** _The Compliance Requirements Thresholds tab with the "Evaluation Period" checkbox and its helper text._

> "One thing this never touches: certifications that are expiring soon are
> always flagged against the real calendar date, no matter how you set this."

### GENERATING COMPLIANCE REPORTS (7:15 – 8:15)

> "When it's time for an annual report, a state inspection, or an insurance
> audit, generate a compliance report."

**[SCREEN: Navigate to Reports → Training Compliance report]**

> "The report lists every member with their certification status for every
> requirement. Export it as PDF for inspectors or as CSV for your records."

**[PRODUCTION NOTE — 2026-10-06. The annual and monthly compliance reports now
grade each member through their compliance profile, the same as the dashboard
and the matrix (CMP4-3), and members nothing grades are shown as N/A and left
out of the overall percentage (TR4-4). A department that uses profiles will
see the report's figures change; reports already generated keep the figures
they were made with. Do not film an old report next to a new one. No narration
change needed unless the take mentions a percentage.]**

**[SCREEN: Compliance → Attestations: the create form with the quarter picker]**

> "And when an officer attests to the numbers for a period, the attestation
> records the department's compliance figure **as the system worked it out** for
> the last day of that period — you don't type a percentage in. Choose the year
> and, for a quarterly attestation, the quarter."

**[PRODUCTION NOTE — 2026-10-06. New beat, about 15 seconds, only if the
attestation screen is already in the take (CS-8): the Compliance % box is gone
and a quarter picker was added. Needs fresh footage of the form.]**

**[SCREEN: Generate and show the report, then demonstrate the export]**

> "The Reports tab has more than the compliance report. **Member Records (All
> Members)** lets you pick a period — month, quarter, year, or lifetime — and
> export every member's completed records: CSV gives you one combined
> spreadsheet, PDF merges a section per member into a single document. There's
> also a **Hours Summary** CSV — hours by member, category, and type, which is
> exactly what most states want — and a **Certification** CSV listing every
> cert as valid, expiring soon, or expired."

**[SCREEN: Show the Member Records period selector with CSV and PDF buttons,
then the Hours Summary and Certification report cards]**

**[SCREENSHOT NEEDED]:** _The Training Reports tab showing the Compliance, Hours Summary, and Certification cards above the "Member Records (All Members)" period selector with CSV / PDF buttons._

> "And if you need just one person's training — say a member is moving to
> another department and wants their history — open their training history page,
> pick a period, and export their records as CSV or PDF right there."

**[SCREEN: On a member's training history, show the export period dropdown with
the CSV and PDF buttons]**

> "Having this at your fingertips replaces hours of digging through filing
> cabinets and spreadsheets. When the state inspector shows up, you hand them
> a comprehensive PDF in thirty seconds."

**[CALLOUT: "State inspection? PDF report in 30 seconds."]**

**[TRANSITION: Integration with events]**

---

## CHAPTER 4: Integrating Training with Events & Wrap-Up (8:15 – 15:15)

### TRAINING EVENTS (8:15 – 9:15)

> "Training and Events are connected. When you create an event with the type
> 'Training,' fill in the **Training details** section that appears on the form:
> the course, category and requirement it counts toward. Once the event exists,
> you change those on its **Requirements & Programs** card."

**[SCREEN: Events → Create Event, type "Training", the "Training details
(optional)" section with a course and a requirement picked.]**

> "After the event, **Finalize Attendance** — or **End Event** — writes a
> training record for every member who checked in, for the time they actually
> attended. Somebody left early? Fix their times with **Edit Times** first. Anyone
> with no time to credit is named in the finalize message. Have attendance
> reopened, set their times with **Edit Times**, and finalize again."

**[SCREEN: The event page after Finalize Attendance on a Training event — the
toast naming the records written, and the Requirements & Programs card.]**

> "If the session was set to need an officer's confirmation, the attendance comes
> to you instead: **Review and approve** on the event's Requirements & Programs
> card opens the approval page, where you can adjust anyone's minutes before you
> record it. Until then members see the class as **In Progress**."

> "One more change: Training events no longer add **admin hours**. The same
> hours were being counted twice — once as training, once as admin time."

**[CALLOUT: "Event attendance → automatic training credit"]**

**[PRODUCTION: Rewritten 2026-09-30 because finalizing a Training event now
writes the training records. The beat now runs about 1:30 rather than 1:00 —
re-time Chapter 4 and the clip table when it is re-recorded.]**

### MULTI-CLASS COURSES & COHORTS (9:15 – 10:45)

> "That works beautifully for a single class. But what about a recruit school?
> Fifteen classes, over two months, every one a different subject. Are you
> going to build fifteen events by hand — and then do it again next spring?"

**[SCREEN: Navigate to Training > Setup > Course Library, hover the "Manage
classes" icon on a course card named "Recruit School"]**

> "You don't have to. A course can carry its own class list. Click Manage
> classes on any course and you get a syllabus — every subject the course
> covers, in order."

**[SCREEN: Course Syllabus Builder (CourseSyllabusBuilder) showing an ordered
list of classes with day numbers and gap labels]**

> "Here's the part that makes it reusable: you don't put dates on these
> classes. You say how far apart they are. Orientation is day one. SCBA is the
> next day. Ladders is two days after that. Notice the builder even says it
> that way — 'Next day,' 'Two days later' — because that's how you'd describe
> it to somebody standing in front of you."

**[CALLOUT: "No dates on the syllabus — only spacing"]**

> "And if your school meets on a regular cadence, don't count days at all.
> Fill from pattern — Tuesdays and Thursdays — and it spaces every class out
> for you."

**[SCREEN: Click "Fill from pattern", select Tue and Thu, click Apply]**

> "Now the payoff. When a new class of recruits starts, go to Records, Course
> Cohorts, New cohort. Pick the course, pick a start date."

**[SCREEN: Navigate to Training > Records > Course Cohorts > New cohort, select
the course, set a start date, click Next]**

> "And stop right here, because this next screen is the one that saves you.
> Before anything is created, you see every single date the system worked out.
> This one got moved — it would have landed on a Saturday. This one's flagged
> because the classroom is already booked. And Labor Day is sitting right in
> the middle of your course, so it's offered to you as a day to skip."

**[SCREEN: The Preview step, scrolling the computed class list, pointing at an
amber warning and the suggested holiday chips]**

**[CALLOUT: "Preview shows every date — before a single event exists"]**

> "You can move any individual class, or skip one entirely. Then pick your
> recruits, and generate."

**[SCREEN: Cohort Detail → Roster tab: the "Add member" button; a member row
reading "N classes held before they joined — decide"]**

> "A recruit shows up a week late? Open the cohort's Roster tab and add them.
> For every class already held, you decide: credit it as completed, or schedule
> a make-up session for just that member. The decision panel opens on its own
> when somebody added late missed any."

**[CALLOUT: "Shift or cancel a cohort — all or nothing"]**

> "And if you shift or cancel the rest of a cohort and one class can't move — a
> finalized class, a room that's taken that day — nothing moves. You get the
> reason and the cohort is exactly as it was."

**[PRODUCTION NOTE — 2026-10-06. Two new beats, about 40 seconds total; re-time
this chapter and film the Roster tab (W27-3). Make-up credit is applied the
usual way when its attendance is finalized; "Credit as completed" writes the
training record straight away.]**

**[SCREEN: Roster step selecting members, then the Generate button; cut to the
Cohort Detail page with the full class timeline]**

> "Fifteen training events, on the calendar, each with its own training
> session. Your recruits see the whole schedule, they check in with the QR code
> the same as always, and when each class's attendance is finalized the hours
> flow into their pipeline. One screen instead of an afternoon."

### WHEN PLANS CHANGE (10:45 – 11:15)

> "And they will. Your SCBA instructor calls out. Weather kills a live-fire
> night. Somebody joins two weeks late."

**[SCREEN: Cohort Detail page, click Reschedule on one class, then show the
Shift remaining control]**

> "Reschedule one class and its calendar event moves with it — nobody loses
> their spot. Cancel one and everybody signed up sees a cancellation, not a
> class that quietly vanished. Or push everything that hasn't happened yet back
> a week, in one click. A make-up night that was never on the syllabus goes on
> the calendar as an ordinary Training event, and a late joiner can't be added
> to a running cohort's roster from the app yet — settle the roster before you
> generate."

**[CALLOUT: "Reschedule · Cancel · Shift remaining"]**

> "One thing worth knowing: editing the course's syllabus does not change a
> school that's already running. That's on purpose — you don't want a recruit
> class re-scheduled underneath the recruits. Fix the syllabus and it applies
> to the next intake."

**[TRANSITION: External training]**

### EXTERNAL TRAINING (11:15 – 11:45)

**[SCREEN: Training Admin → Records → Submissions (Review Submissions)]**

> "Training taken outside the department — courses at the fire academy,
> conferences, mutual aid training — reaches you two ways. Members submit it
> themselves with **Submit Training**, and it waits for you on **Review
> Submissions**. Once approved, it counts toward their compliance requirements
> just like internal training."

**[SCREEN: Training Admin → Setup → Integrations (External Training
Integrations): a provider card with Sync Now and Mappings, then the Import
Queue]**

> "Or, if your members train on a platform like Target Solutions or Vector
> Solutions, connect it under **Integrations**. Completed courses sync in on
> their own and land in the **Import Queue** for you to check, and every so
> often it re-reads the last thirty days so a late correction on their side
> isn't missed."

**[PRODUCTION NOTE — 2026-10-04. Rewritten. The previous take described
**External Training Integrations** (ExternalTrainingPage) as the member
submission queue — it is the provider sync screen; member submissions are
Submit Training / Review Submissions. Wrong before this window; found, not
caused, by it. A Target Solutions provider saved before 2026-09-29 needs its
API Key and API Secret re-entered. About 15 seconds longer; re-time this
chapter and record both cues.]**

### SHIFT COMPLETION REPORTS & SKILL SCORING (11:45 – 13:15)

> "After each shift, officers file shift completion reports on their trainees.
> Let me show you the workflow."

**[SCREEN: Scheduling → Shift Reports → "New report". Pick a shift card from
the list.]**

> "Reports start from the shift, not the trainee. Go to Scheduling, open
> **Shift Reports**, click **New report**, and pick the shift — hours and calls
> auto-populate from attendance records for the whole crew. Then, for each
> trainee, you rate their performance 1-5, note strengths and areas for
> improvement, and write a narrative."

**[PRODUCTION NOTE — 2026-10-04. Re-record this cue. The previous take filmed
"Training Admin > Shift Reports > Create"; there is no Create there. Training
Admin's **New Report** tab only points to Scheduling (**Go to Shift Reports**),
or, for a department without the Scheduling module, to **Log Shift Report**.
Wrong before this window; found, not caused, by it.]**

**[SCREEN: Show the skills section with 1-5 score buttons]**

> "New as of this update — you can now score each observed skill on a 1-5
> scale. **1 is 'Needs work', 3 is 'Competent', 5 is 'Excellent.'** These
> scores flow directly into the trainee's competency score history."

**[SCREENSHOT NEEDED]:** _Close-up of the skills scoring section showing
3-4 skills, each with violet 1-5 score buttons, score labels as tooltips,
the demonstrated checkbox, and comment field._

> "Skills highlighted in **green** are linked to formal SkillEvaluations — those
> scores feed competency tracking and pipeline progress. **Amber** skills are
> observed on reports but aren't formally tracked."

**[SCREENSHOT NEEDED]:** _The apparatus skills settings panel showing
green and amber linkage tags on skills._

### BATCH REVIEW (13:15 – 14:15)

> "When you have a pile of pending reports — say, after a busy weekend — you
> can batch-review them."

**[SCREEN: Scheduling > Shift Reports > Review Queue]**

> "Check the reports you want to approve, or hit Select all. Then click
> 'Approve Selected' — up to 100 at a time. You can also batch-flag reports
> that need follow-up, with a comment saying why."

**[SCREENSHOT NEEDED]:** _Review Queue view with checkboxes on 5 report
cards, 3 checked, the "3 selected" label, the "Flag Selected" / "Approve
Selected" buttons, and the comment field below them._

> "Flagged reports appear in their own tab, and you can re-review them later."

**[SCREEN: Show the Flagged tab with a few flagged reports]**

### TRAINING OFFICER'S WORKFLOW (14:15 – 14:45)

> "Let me summarize the Training Officer's workflow."

**[CALLOUT: Workflow steps appearing one at a time]**

> "**Weekly:** Check the dashboard and your notifications for new submissions
> and approaching expirations. Approve or reject any member-submitted external training.
> Review pending shift reports — batch-approve routine ones, flag any that
> need a closer look."

> "**Before Training Events:** Ensure the event is linked to the correct
> requirement. Prepare any skills testing templates needed."

> "**After Training Events:** Finalize the event's attendance — that writes
> every attendee's record — and approve it if the session needs your
> confirmation. Update
> skills testing records if practical evaluations were conducted. File shift
> completion reports with skill scores for any on-shift training observations."

> "**Monthly:** Review the Compliance Matrix. Identify members falling behind.
> Plan next month's training calendar to address gaps."

> "**Quarterly:** Generate compliance reports for the Chief and officers.
> Review and update training requirements if state mandates have changed."

### WRAP-UP (14:45 – 15:15)

> "The Training Officer role is about keeping the department ready. The Logbook
> automates the tracking, the reminders, and the reporting — so you can focus
> on the actual training."

> "That's both halves of the Training Officer guide. If you run psychomotor
> evaluations — NREMT skill sheets, department checkoffs — **Script 15** is your
> next one; it goes considerably deeper than Chapter 2 did. If you're setting up a
> recruit school, **Script 11** builds the pipeline and **Script 14** builds the
> class schedule."

> "And if you want to see what all of this looks like from the other side, the
> member's guide shows the platform as a firefighter experiences it — RSVP, check
> your training, view the schedule."

**[SCREEN: End card with subscribe, next video link, and playlist link]**

---

## Clip Extraction Guide

| Clip                          | Timecode    | Standalone Title                                         |
| ----------------------------- | ----------- | -------------------------------------------------------- |
| Skills Testing Walkthrough    | 1:15–5:15   | "Running a Skills Test in The Logbook"                   |
| Compliance Reporting          | 5:15–8:15   | "Generating Compliance Reports"                          |
| Multi-Class Courses & Cohorts | 9:15–10:45  | "Schedule a Whole Recruit School in One Shot"            |
| When Plans Change             | 10:45–11:15 | "Rescheduling a Class Series Without Touching 15 Events" |
| Shift Reports & Skill Scoring | 11:45–13:15 | "Filing Shift Reports with 1-5 Skill Scoring"            |
| Batch Review                  | 13:15–14:15 | "Batch Reviewing Shift Reports"                          |
| Training Officer Workflow     | 14:15–14:45 | "The Training Officer's Weekly Routine"                  |

---

## Production Notes

- **Record the Chapter 1 cold open last.** It refers back to Part 1's closing
  state, so shoot it against the same demo data Part 1 ends on — otherwise the
  Compliance Matrix won't match what viewers just watched you build.
- Chapter 2 deliberately stops short. Resist re-covering disclosure settings or
  the void/cancel distinction here; that is Script 15's job and duplicating it
  means two videos to re-record every time the feature moves.
- The workflow beat (14:15) is the most-clipped segment of the original
  26-minute cut. Give it a clean in-point.

## AUGUST 14 RELEASE INSERTS — HONEST SKILL STATE AND LINKED SESSIONS

### Add to Skills Testing — 1:00

> "A failed step can cost points without automatically failing the entire test;
> critical criteria and the configured passing rule still control the result.
> Resume conflicts are scoped to the current test and require refresh/reconcile,
> not a blind retry. Result visibility and official-test policy are enforced by
> the server, including what appears in a trainee's personal export."

### Add to Training Events — 0:45

**[SCREEN: session editor with Requirement, Course, and Program.]**

> "Link a session to the requirement, course, and program it should advance.
> Cross-organization or mismatched links are rejected. Finalized attendance feeds
> only the owned requirement, and deleting a program cannot take a requirement it
> does not own with it."

**EDITOR:** Add 1:45 and re-time Chapters 2–4 and the clip table. Keep Script 15 as the canonical detailed skills-testing demonstration.
