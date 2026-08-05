# Script 14: Multi-Class Courses & Cohorts — Scheduling a Whole Class Series

**Video Type:** Focused Tutorial (Short/Medium-Form)
**Estimated Length:** 10–14 minutes
**Target Audience:** Training Officers who run recruit schools, academies, or any multi-night course
**Roles Covered:** training_officer, safety_officer
**Chapters:** 6 (each designed as a standalone clip)
**Requires permission:** `training.manage`

> **Companion videos:** Script 11 builds a *pipeline* — what a recruit has to
> accomplish. This video builds a *schedule* — when the classes actually meet.
> Most departments running a recruit school want both, and generating a cohort
> wires them together.

---

## CHAPTER 1: The Problem (0:00 – 1:15)

### HOOK (0:00 – 0:30)

**[SCREEN: The Events calendar in month view, sparse. Then a hand-drawn
overlay of fifteen tally marks appearing one at a time.]**

> "Your recruit school starts in September. Fifteen classes, two nights a week,
> every one a different subject. So you sit down and create fifteen training
> events — one at a time. And in March, when the spring class starts, you do it
> again."

### THERE'S A BETTER WAY (0:30 – 1:15)

> "The Logbook can do that whole thing in one screen. You describe the course
> once — what the classes are, and how far apart they run — and every time a new
> class of recruits starts, you generate the schedule from it."

**[CALLOUT: "Describe the course once · Generate every intake from it"]**

> "Two pieces to learn: the **syllabus**, which is the class list, and the
> **cohort**, which is one run of the course. Let's build both."

**[TRANSITION: Course Library]**

---

## CHAPTER 2: Building the Syllabus (1:15 – 4:00)

### THE CONTAINER COURSE (1:15 – 1:45)

**[SCREEN: Navigate to Training > Setup > Course Library
(CourseLibraryPage embedded in TrainingAdminPage).]**

> "Start in the Course Library. You want one course that represents the whole
> program — 'Recruit School.' If it doesn't exist yet, create it like any other
> course. This one's the container; the individual subjects go inside it."

### ADDING CLASSES (1:45 – 3:00)

**[SCREEN: Click the Manage classes icon on the Recruit School card; the
Course Syllabus Builder (CourseSyllabusBuilder) opens.]**

> "Click **Manage classes** and add your first one."

**[SCREEN: Click Add class; the class form expands.]**

> "Every class points at a real course from your library — SCBA Operations,
> Ladders, Hose Evolutions. That's required, and it's the point: the course you
> pick is what carries the credit hours, the certification settings, and the
> categories. You're not retyping any of that."

**[CALLOUT: "Each class = a real catalog course"]**

> "Don't have the course yet? Hit the plus button right here and create it
> without leaving this screen."

**[SCREEN: Click the + next to the course picker, fill in the course modal,
save; the new course is selected automatically.]**

> "Now the timing — and this is the part that makes the whole thing reusable.
> You don't give the class a date. You say how many days after the course starts
> it happens. Orientation is day one. SCBA is day two. Ladders is day four."

**[SCREEN: Set the Day field, start time, and duration on three classes in
sequence.]**

> "Look at what the builder says next to each one: 'Course start.' 'Next day.'
> 'Two days later.' That's how you'd describe the schedule to somebody standing
> in front of you, so that's how it's written down."

### FILL FROM PATTERN (3:00 – 3:30)

**[SCREEN: Click Fill from pattern; the weekday chips appear; select Tue and
Thu, set "Course starts on a" to Monday, click Apply to all.]**

> "And if your school meets on a set cadence, don't count days at all. Fill
> from pattern — Tuesdays and Thursdays, course starts on a Monday — and every
> class spaces itself out. Fifteen classes, about seven and a half weeks. You
> can still tweak any individual one."

### CREDIT-ONLY CLASSES (3:30 – 4:00)

**[SCREEN: Open a class for edit, scroll to the "Counts toward certification
requirements" checkbox, uncheck it.]**

> "One setting worth knowing. Most classes should count toward certification —
> leave this on. But if you've got an informal in-house drill sitting inside an
> otherwise certification-grade school, turn it off. Members still get the hours
> and the training record. It just won't advance their certificate — because a
> certifying body wouldn't accept it, and you don't want it inflating what looks
> like a certified competency."

**[CALLOUT: "Hours yes · Certificate no"]**

**[TRANSITION: Generating a cohort]**

---

## CHAPTER 3: Generating a Cohort (4:00 – 6:45)

### START THE WIZARD (4:00 – 4:30)

**[SCREEN: Navigate to Training > Records > Course Cohorts; click New cohort.]**

> "Syllabus done — and you never have to do that again. Now every September and
> every March, you come here. Records, Course Cohorts, New cohort."

> "Pick the course. Name this run — 'Recruit School, Fall 2026.' Next."

### THE SCHEDULE RULES (4:30 – 5:15)

**[SCREEN: The Schedule step: date picker, weekday chips, roll-policy select.]**

> "Set the start date. Then tell it what to do when a class lands on a day you
> don't train. Keep the date as computed. Move weekends to the next weekday. Or
> move to the next meeting day, using the days you picked."

**[CALLOUT: "Keep · Next weekday · Next meeting day"]**

### THE PREVIEW — DON'T SKIP THIS (5:15 – 6:15)

**[SCREEN: The Preview step, full class list with computed dates. Slowly scroll.
Pause on an amber warning row.]**

> "Now stop. This screen is the reason the wizard exists."

> "Nothing has been created yet. Every date you're looking at is what *would*
> happen. And it's already telling you about the problems."

**[SCREEN: Zoom on a warning reading "Moved from 2026-09-12 to 2026-09-14 —
2026-09-12 is a weekend."]**

> "This one got moved — it would have been a Saturday. This one's flagged
> because the classroom is already booked for something else. And look up here:
> Labor Day and Thanksgiving are sitting inside your course, offered to you as
> days to skip. Tick them, hit Recalculate, and the schedule works around them."

**[SCREEN: Click two holiday chips, click Recalculate; the dates shift.]**

> "You can move any individual class right here, or tick Skip this class to
> leave one out of this particular intake."

**[CALLOUT: "Every date visible before a single event exists"]**

### ROSTER AND GENERATE (6:15 – 6:45)

**[SCREEN: The Roster step — search, tick a handful of members. Then the
Confirm step, then click Generate.]**

> "Pick your recruits. If the course doesn't have a pipeline yet, tick Build a
> matching pipeline and it'll create one from your syllabus sections. Then
> generate."

**[SCREEN: The Cohort Detail page loads, showing the full class timeline.]**

> "There it is. Fifteen training events on the department calendar, each with
> its own training session. Your recruits already have the whole schedule, they
> check in with the QR code the same as any other event, and the hours flow into
> their pipeline. That was one screen."

**[TRANSITION: When plans change]**

---

## CHAPTER 4: When Plans Change (6:45 – 8:45)

### THE FOUR THINGS THAT ALWAYS HAPPEN (6:45 – 7:15)

**[SCREEN: The Cohort Detail page, Classes tab, showing sign-up and attendance
counts on each row.]**

> "Now, no recruit school in history has ever run exactly as scheduled. Your
> SCBA instructor calls out. Weather kills a live-fire night. Somebody joins two
> weeks late, somebody else drops. Here's each one."

### RESCHEDULE AND CANCEL (7:15 – 8:00)

**[SCREEN: Click the reschedule icon on one class, pick a new date/time, click
Move class.]**

> "Reschedule moves the class *and* its calendar event together. Everybody who
> signed up stays signed up — you're not rebuilding an attendee list."

**[SCREEN: Click the cancel icon on another class; the confirmation dialog
appears.]**

> "Cancel is important to understand. It cancels the event — it doesn't delete
> it. Anyone who signed up sees a cancellation, instead of a class quietly
> disappearing off their calendar and wondering if they missed it. And the class
> stays listed here for your record."

**[CALLOUT: "Cancelled, not deleted — people see the change"]**

### SHIFT AND ADD (8:00 – 8:45)

**[SCREEN: Click Shift remaining, enter 7, click Apply; the remaining dates
all move.]**

> "Weather took out a week? Shift remaining, seven days, done. Everything that
> hasn't happened yet moves. Classes that already ran stay put — their
> attendance records are attached to those dates."

**[SCREEN: Click Add class; fill in a make-up session.]**

> "Need a make-up night that was never on the syllabus? Add class. The roster
> gets invited automatically."

**[SCREEN: Open the Roster tab; show a member's progress bar; click Remove on
one member.]**

> "And on the roster: add somebody late and they're put on the classes still to
> come — not the ones they already missed, because putting a finished class on
> their calendar would just be confusing. Remove somebody and the upcoming
> classes come off their calendar, but their records and anything they already
> attended stay exactly where they are."

**[TRANSITION: The gotchas]**

---

## CHAPTER 5: Three Things That Trip People Up (8:45 – 11:00)

### REORDERING ISN'T RESCHEDULING (8:45 – 9:30)

**[SCREEN: The syllabus builder; click the up-arrow on a class; the row moves
but its Day number does not change, and its gap label flips to "2 days
earlier."]**

> "Number one, and this catches everybody. Moving a class up the list changes
> the *order*. It does not change the *date*."

> "Watch — I move this one up, but its day number stays where it was. See how
> the label changed to 'two days earlier'? That's the builder telling you the
> order and the timing no longer agree."

**[CALLOUT: "Order ≠ timing. Re-space with Fill from pattern."]**

> "To actually re-space them, edit the day numbers, or just hit Fill from
> pattern and let it redo the whole thing."

### EDITING THE SYLLABUS WON'T FIX A RUNNING SCHOOL (9:30 – 10:15)

**[SCREEN: Split view — the syllabus builder on one side, a running cohort's
class timeline on the other, unchanged.]**

> "Number two. If you fix the syllabus while a school is running, that running
> school does not change."

> "That's deliberate, and you want it that way. Imagine a recruit class's
> schedule silently rearranging itself underneath them because you corrected a
> typo. Your fix applies to the *next* intake. To change the one in progress,
> edit it here on the cohort page."

**[CALLOUT: "Syllabus = template · Cohort = a copy that's already running"]**

### COHORT OR RECURRING SESSION? (10:15 – 11:00)

**[SCREEN: Side-by-side callout comparing the two.]**

> "Number three: don't confuse this with a recurring session."

> "A recurring session repeats the **same class** over and over — your monthly
> CPR refresher. Same subject, same hours, every time."

> "A cohort runs an **ordered series of different classes**, once. Orientation,
> then SCBA, then ladders. That's a recruit school."

**[CALLOUT: "Same class repeating → recurring session. Different classes in
order → cohort."]**

> "If every meeting covers a different subject, you want a cohort."

**[TRANSITION: Wrap-up]**

---

## CHAPTER 6: Wrap-Up (11:00 – 12:00)

### WHAT YOU BUILT (11:00 – 11:40)

**[SCREEN: Montage — the syllabus builder, the preview screen, the cohort
timeline with attendance counts.]**

> "So: you described your recruit school once, as a list of classes with
> spacing instead of dates. You generated a fall intake from it in about a
> minute, and you saw every date before anything got created. Your recruits have
> the schedule, they're checking in with QR codes, and their hours are landing
> in the pipeline without you touching a thing."

> "And in March, when the spring class starts? You pick the course, pick a date,
> and generate. That's it."

### NEXT (11:40 – 12:00)

> "If you haven't built the pipeline that tracks what these recruits have to
> accomplish, watch Script 11 next — it's the other half of this. And Script 9
> covers running that pipeline day to day."

**[SCREEN: End card with subscribe, next video link, and playlist link]**

---

## Clip Extraction Guide

| Clip | Timecode | Standalone Title |
|------|----------|-----------------|
| The Problem | 0:00–1:15 | "Stop Building Fifteen Training Events by Hand" |
| Building the Syllabus | 1:15–3:30 | "Describe a Multi-Class Course Once, Reuse It Forever" |
| Fill From Pattern | 3:00–3:30 | "Space Out 15 Classes in One Click" |
| Credit-Only Classes | 3:30–4:00 | "Hours Without Certificate Credit — When and Why" |
| Generating a Cohort | 4:00–6:45 | "Schedule a Whole Recruit School in One Screen" |
| The Preview Screen | 5:15–6:15 | "See Every Date Before You Create Anything" |
| When Plans Change | 6:45–8:45 | "Reschedule, Cancel, and Shift a Class Series" |
| Reordering Isn't Rescheduling | 8:45–9:30 | "The #1 Mistake With Course Syllabi" |
| Cohort or Recurring Session? | 10:15–11:00 | "Cohort vs. Recurring Session — Which Do I Want?" |
