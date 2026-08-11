# Shift Scheduling — Clarity Review

**Reviewed:** 2026-08-11 · **Scope:** shift scheduling, assignment, start of
shift, end of shift, shift reports.
**Method:** MySQL + Redis in Docker with the API and dev server local; demo
department seeded via `scripts/screenshots/` (66 shifts, 22 members); 48 screens
driven with Playwright as both an administrator and an ordinary member, at
1440px and at 414px.
**Standard applied:** a new volunteer with no training should be able to read
each screen and act on it without asking anyone. The barrier in this module is
almost never hard vocabulary — it is _internal_ vocabulary and unlabelled
controls, which a reader cannot look up.

Severity is about consequence, not polish:

| Grade                 | Meaning                                                           |
| --------------------- | ----------------------------------------------------------------- |
| **Blocks work**       | Someone cannot finish the task on this screen.                    |
| **Invites mistakes**  | The screen is readable, but the obvious reading is the wrong one. |
| **Slows people down** | Clear enough once learned, more work than it needs to be.         |

Original review counts: **19** invites mistakes and **19** slows people down,
plus **9** code faults found and fixed (below). After the fixes marked in this
document, **All 24 remaining workflow findings are now implemented.** The review remains
as a regression checklist and records the reasoning behind each change.

**Status: all 38 findings are fixed**, across two passes — the first closed 14
and the code faults, the second the remaining 24. Each finding below carries the
fix that closed it, and four claims the work disproved are corrected in place
(next section). Two of the second pass's fixes reached past the wording they were
raised about: "not on truck" needed a third answer in the schema, the service and
the item trend, and a shift report needed the backend to say which shift it
covers.

## Corrections to the first pass

Implementing the fixes disproved four claims made here originally. They are
corrected in place below; recorded together so the record shows what changed
and why.

- **The Create Template dialog was not unreachable.** The whole panel was the
  scroll container, so Save was reachable by scrolling — there was simply
  nothing on screen to say so. Regraded from _blocks work_ to _slows people
  down_; the fix (fixed header, pinned footer, only the fields scrolling) stands.
- **The My Shifts icons were not unlabelled.** All four carried `title` and
  `aria-label`, so a screen reader and a desktop hover both got a name. The gap
  was a **visible** label — and a phone has no hover at all, which is where this
  screen is mostly used. They were also 40px against the project's 44px touch
  minimum.
- **Red is the app's primary colour, not a danger signal.** The original note on
  Scheduling Reports said a red primary button reads as destructive. It does
  not: `btn-primary` is `bg-red-600` throughout the app, and the active nav item
  is red too. The real inconsistency is narrower — red serves as _both_ the
  primary and the destructive colour, and there is a second, violet primary
  treatment applied inline elsewhere.
- **"presence" was bad data plus a missing guard, not a label.** `check_type` was
  a free-form string with no validation, the demo seeder wrote `"presence"`
  (not one of the nine supported types), and the form printed the raw token when
  it could not find a label. A department building a template through the builder
  would have seen "Present". Fixed at the root: the value is validated on write,
  an unrecognised one renders no caption rather than a raw token, and the seeder
  was corrected.

---

## Code faults found while driving the app — all fixed

These were not design questions. They surfaced as soon as the module was
exercised against a real database.

| Fault                                          | Effect                                                                                                                                                                                   | Where                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `Decimal / float` in the shift detail response | `GET /scheduling/shifts/{id}` returned 500 for **any** shift with attendance recorded — the whole shift drawer                                                                           | `api/v1/endpoints/scheduling.py`                    |
| Template fetch gated on `equipment_check.view` | A member's own equipment checklist could not be opened: six checklists listed, every "Start Check" 403'd. The start/end-of-shift flow was unusable for the crew it exists for            | `api/v1/endpoints/equipment_check.py`               |
| Calendar dates formatted as instants           | Checklists dated 8/16, 8/18, 8/20 displayed as 8/15, 8/17, 8/19; the QR check-in card named 7/31 for an 8/01 shift. 8 call sites                                                         | 5 files in `pages/scheduling`, `modules/scheduling` |
| Server-side timestamps expired after INSERT    | 7 create endpoints returned 500 on success (recertification pathways, grant opportunities and campaigns, screening requirements and records, prospect election packages and event links) | 5 service modules                                   |

Two notes on the last two:

- **The date bug had a fix already in the codebase.** `formatCalendarDate`
  exists and documents the trap; the shift detail panel and My Shifts dodge it
  with a `+ 'T12:00:00'` anchor. Eight call sites used neither.
- **The permission bug had a fix already in the file.** The `EC-7` comment in
  `equipment_check.py` explains that read endpoints accept `view` OR `submit`
  _because members hold submit_ — applied to eight sibling endpoints, but not to
  the two the member-facing page depends on.

### The follow-up sweep — done, and the "~25 sites" figure was wrong

An earlier draft of this review reported "~25 more sites" with the same
`add` → `flush` → `return`-without-`refresh` shape. That count was inflated by a
detector that only recognised `refresh(obj)` and missed the two-argument
`refresh(obj, ["created_at", "updated_at"])` form the codebase actually favours.
Re-scanned properly: **85 sites already refresh** and 12 did not, of which 4
discard the return value entirely (`_create_compartment`,
`log_template_change`, `_create_record_from_submission`) or serialise no
timestamps (`set_consent`, whose endpoint builds its own dict — safe because the
session runs `expire_on_commit=False`). The codebase was far more consistent than
the first pass implied.

That left **8 real bugs**, all fixed and each verified returning 201 against a
running stack: donors, donations, pledges and fundraising events; grant budget
items, expenditures, compliance tasks and notes.

Two things that sweep taught, both of which corrected the original diagnosis:

- **It is not only the timestamps.** `POST /grants/donors` still 500'd after a
  two-column refresh, because `Donor` also server-defaults `country`,
  `total_donated`, `donation_count`, `is_anonymous` and `active` — every unloaded
  column raises `MissingGreenlet` when the response model reads it. A full
  `refresh(obj)` is the correct fix; the two-column form is only sufficient where
  timestamps are the sole server-side defaults.
- **A central fix exists and was rejected.** `__mapper_args__ =
{"eager_defaults": True}` on the declarative `Base` would close the whole class
  at once. On MySQL, which has no `RETURNING` for this, it costs a `SELECT` after
  _every_ `INSERT` app-wide — including audit logging and bulk operations. Too
  broad a trade for eight endpoints, and it would diverge from the explicit
  refresh the other 85 sites already use.

---

## 01 · Shift scheduling

**Invites mistakes — the calendar speaks in codes nobody defined.** ✅ **Fixed.** Cells read
`7:00 AM B-5 (3/3)` with a green tick or amber triangle. Nothing says `B-5` is
Brush 5, that `(3/3)` counts filled positions, or that amber means short. The
module already solves this three times over: the phone layout writes
"3/3 staff", the shift drawer writes "B-5 — Brush 5", Open Shifts writes
"3 / 4 filled". Use that wording on desktop and add a one-line key.

**Invites mistakes — two stat tiles, one number.** ✅ **Fixed.** "Scheduled Shifts" reads 66
and "This Month" also reads 66. "Hours Worked This Month — 868.1" never says
whose; it is the department's. Name the window and the subject in the label.

**Slows people down — the Create Template dialog buries its own Save button.**
✅ **Fixed.** The dialog is taller than the window and the whole panel was the
scroll container, so the last option ended mid-sentence and Save sat below the
fold with no scrollbar or shadow to say the form continued. Reachable, but only
if you guessed. The header and footer are pinned now and only the fields scroll.

**Slows people down — three fields for two facts.** ✅ **Fixed.** Start time, end time
_and_ duration, with duration pre-filled `12` regardless, so the two could
disagree and nothing said which won. The length is derived from the times and
read back as a sentence ("7:00 AM to 7:00 PM — 12 hours, ending the next day");
a tour longer than a day is the one case that cannot be derived, so it keeps a
number field behind a checkbox that says what it is for. The AM/PM the form
always used now matches the template lists behind it, which printed raw 24-hour
strings — `formatTimeOfDay` re-spells a time of day without going near a
timezone, for the same reason `formatCalendarDate` exists.

**Slows people down — colour is picked by typing a hex code** (`#dc2626`).
✅ **Fixed.** A raw hex field is developer-facing: eight named swatches instead,
and the default is blue rather than the red the calendar uses for a shift in
trouble.

**Slows people down — officer tools sit below the whole calendar.** ✅ **Fixed.**
Seven cards under an "ADMINISTRATION" heading, reached only after scrolling a
full month grid; on a phone each carried an external-link arrow though they are
ordinary pages, and the Supply badge showed an orange `1` with nothing to say
what it counted. They are a strip headed "Officer tools" above the tab content,
visible on every tab, with no arrows, and the badge reads "1 expiring".

**Slows people down — patterns open collapsed** with nothing to read or do, and
the page prints its title twice. ✅ **Fixed.** The page and the component inside
it both printed "Shift Patterns", one line apart; the page keeps the title. A
pattern row was one wide button ending in a bare chevron, so the only thing a
pattern exists for — generating shifts — was behind a glyph: the toggle reads
Details / Hide and Generate shifts is on the row.

## 02 · Assignment

**Invites mistakes — four unlabelled buttons on the member's most-used screen.**
✅ **Fixed.** Every My Shifts row ended in a green tick, a red circled cross, a
swap arrow and a chevron with no visible text. All four did carry `title` and
`aria-label`, so a screen reader and a desktop hover got a name — but a phone
has no hover, and this is a phone screen. Nothing on it distinguished "confirm
I'm working this" from "give this shift up", and the red one read as a delete.
The riskiest screen in the module: guessing wrong leaves a truck unstaffed. They
now read Confirm / Decline / Swap / Details, matching the bulk bar's verbs rather
than inventing a third phrasing, and sit on their own full-width row on a phone
at the project's 44px touch minimum (they were 40px).

**Invites mistakes — the bulk header contradicts its rows.** ✅ **Fixed.** "Select all 4
pending" above four rows badged **Assigned**.

**Invites mistakes — "0/2 present" on a shift eight days out.** ✅ **Fixed.**
Nobody can be present for a future shift, so the zero read as an alarm; and the
two denominators differed (`0/2` present, `2/3` staffed), which made the pair
look self-contradictory. Attendance appears once the shift has begun — decided
against the department's clock, not the browser's — and both counts name their
subject: "2 of 3 crew checked in", "3 of 4 positions filled".

**Invites mistakes — an unlabelled delete in the drawer header**, one of four
bare icons, two of them destructive. ✅ **Fixed.** Same finding as My Shifts and
the same fix: Edit, Delete and Cancel shift say so on a panel that is mostly
used on a phone, where there is no hover to reveal the `title` each carried. The
close ✕ stays a glyph.

**Invites mistakes — an uncaptioned hours chip** beside each crew member
(`12h`, `11.9h`). ✅ **Fixed.** Scheduled, credited or worked — the three differ
in practice, and this one is worked, from check-in to check-out. It says so, and
the check-in chip beside it gives the time instead of a bare arrow.

**Slows people down — My Shifts never says which truck.** ✅ **Fixed.** Date, time and
"Position: Officer", but no apparatus or station: the one fact that tells you
where to go. Every other view shows it.

**Slows people down — Assign opens a form you cannot see.** ✅ **Fixed.** The form
renders at the foot of a drawer taller than the window, so on a 900px window the
button appeared to do almost nothing. It scrolls into view.

**Slows people down — "Assign" and "Sign Up" side by side**, with the
difference (someone else vs. me) never stated. ✅ **Fixed.** Worse on a phone,
where Assign collapsed to a bare icon next to a button reading "Join". They read
"Assign someone" and "Sign myself up" — the difference is in the labels.

**Slows people down — internal phrasing on screen:** "Positions from B-5 +
shift customizations" describes how the list is computed. ✅ **Fixed.** It names
the rig, and says plainly when this shift departs from it.

## 03 · Start of shift

**Invites mistakes — a card reading "End" above a button reading "Start
Check".** ✅ **Fixed.** The badge is _when_, the button is _what you do now_, and
together they contradicted. The badge and the filter chips spell out "Start of
shift" / "End of shift", and the button reads Open checklist (or Continue
checklist).

**Invites mistakes — every item was captioned "presence"**. ✅ **Fixed.** Not a
wording choice: `check_type` was an unvalidated free-form string, the demo seeder
wrote `"presence"` — not one of the nine types the form can render — and the
caption fell back to printing the raw value. The value is now validated on write
against the set the template builder offers, an unrecognised one renders no
caption at all rather than an internal token, and the seeder was corrected. A
department using the builder always saw the proper label ("Present").

**Invites mistakes — the checklist forgets its shift.** ✅ **Fixed.** Once open the
only heading was the template name; apparatus, date and timing are all in the
header now, the timing as a badge in the colour of the card it was opened
from — which is also what distinguishes the close-out checklist from the
start-of-shift one.

**Invites mistakes — Pass or Fail, nothing between.** ✅ **Fixed.** A tool
legitimately off the truck had to be recorded as a failure or buried in a note,
and the compliance reports then counted it as a fault. "Not on truck" is a third
answer: it counts as answered wherever completeness is measured and never toward
failures — in `_compute_check_status`, in the compartment roll-up, and in the
item trend, which gets its own bucket rather than lumping an answer in with
"nobody looked". Deliberately not offered for an expired item: that verdict is
the server's to make and no answer here can retire it.

**Invites mistakes — check-in accepts a shift that ended days ago.** ✅ **Fixed.** Verified
against the running app: opening the check-in link for a shift that ended
31 July and pressing Check In returned `200` on 11 August and stamped the
arrival time as _now_. The only guard is whether an officer finalised the shift;
the shift being over means nothing. This is the one data-integrity finding here.
The product already has the concept — Scheduling Settings carries "Checklist
Timing — start/end of shift windows" — so bound check-in the same way and say on
screen why the button is off.

**Slows people down — checking in leads nowhere.** ✅ **Fixed.** The start-of-shift
checklist is a button on the confirmation. Check Out stays the prominent one:
it is what the same screen is for hours later.

**Slows people down — REQUIRED on all nine items**, in red, the same red used
for a failed item. ✅ **Fixed.** The optional ones are the news, so those are what
carry a badge.

**Slows people down — checklists days away look as due as today's.** ✅ **Fixed.**
Soonest first, with Today / Tomorrow / In 5 days on each card, and a check not
yet due wears the secondary button rather than the urgent one. Still openable —
being early is not an error.

**Slows people down — no progress or submit within reach.** ✅ **Fixed.** The demo
checklist has nine items; a real engine inventory runs to dozens, so a member
scrolled to the end to find out they had missed one in the cab. The header
(title, shift, count, progress) is sticky, the compartment heading is sticky
under it, and Submit sits in a sticky bottom bar naming how many required items
are still unanswered.

**Slows people down — two buttons a letter apart:** "Start a Check" (page
header, unscheduled) and "Start Check" (card, assigned). ✅ **Fixed.** The header
button reads "Unscheduled checklist", the card "Open checklist". More broadly,
check / checklist / report were used interchangeably for three different things:
a _checklist_ is what you fill in and a _check_ is the record of having filled
one in, so the page reads "Due now and coming up", "Completed checklists" and
"Pick a checklist".

**Slows people down — the not-found message blames a QR code that was never
used.** ✅ **Fixed.** "This QR code may be invalid or you may not have access to
this shift" was two guesses, neither actionable, on a page also reached by
typing the URL, from a notification, or from a stale bookmark. Whether a shift
was asked for at all is the one thing we know, so the two cases say different
things and both offer My Shifts.

## 04 · End of shift

**Already right — the pre-finalisation checklist is the model the rest of the
module should copy.** It states each condition as a plain sentence with an
honest colour: "3 of 3 checked in, 3 checked out", and in amber, "Ran
understaffed — 3 of 4 positions filled." It tells an officer what they are
signing off with no jargon at all. Everything below is wording on top of a
screen that already works.

**Invites mistakes — nothing says which rows block the close-out.** ✅ **Fixed.**
Green and amber were equally passable, which trains an officer to skim both. Two
headed groups: "Must be resolved first" and "Noted on the record". That surfaced
a related lie — the pending-checks row always claimed the checks "must be
completed before you can close the shift", including when end-of-shift
enforcement was off, which is the default and closes the shift regardless.

**Invites mistakes — the close-out checklist is indistinguishable from the
start-of-shift one.** ✅ **Fixed.** Same layout, same buttons, same "Submit
Report"; only the template name differed. Its header now carries the timing as a
badge, in the colour of the card it was opened from.

**Slows people down — "Finalize" appears twice at once** ✅ **Fixed.** (drawer header and
panel) and is the least plain word on the screen. One button, "Close out shift".

**Slows people down — machine plurals and a raw date.** ✅ **Fixed.** "1 equipment
check(s) completed", "1 call(s) recorded", and a handoff banner headed "Handoff
from previous shift (2026-08-01)" — an ISO date two lines under "Wednesday,
August 12, 2026", eleven days stale with nothing marking it as old. It reads
"Handoff from the previous shift — Sat, Aug 1 (11 days ago)", and past three days
it says outright that this is the most recent pass-down on the apparatus rather
than a note from the last crew on duty.

## 05 · Shift reports

**Invites mistakes — crew members are labelled "Trainee".** ✅ **Fixed.** The summary table's
first column is headed **TRAINEE** and the block is "Trainee Summary", listing
everyone who worked. Settings itself says reports cover all crew and that
training evaluations are a separate, optional add-on.

**Invites mistakes — people are rated 1–5 stars with no published scale.** ✅ **Fixed.** Every
report carries a rating and the table an "AVG RATING" column; nowhere does the
screen say what three stars means or what is being measured. Settings has a
"Rating Scale" section — surface those words next to the stars.

**Invites mistakes — "My Reports" and "Filed by Me"** ✅ **Fixed.** are reports about you and
reports you wrote, and both readings fit both labels. "About me" / "Written by
me".

**Invites mistakes — approved is the absence of a badge.** ✅ **Fixed.** Draft, Pending Review
and Flagged have pills; a finished report has none, so the most important state
is inferred from a gap.

**Invites mistakes — hours are formatted four ways and disagree with
themselves.** ✅ **Fixed.** One screen shows `6h`, `12h`, `11.87h`, `11.73h`, and the same
record reads `11.9` in the summary table and `11.87h` in the row below it.

**Slows people down — Scheduling Reports opens blank.** ✅ **Fixed.** Five report
types, all starting on "Select a Date Range" with two empty `mm/dd/yyyy` boxes:
no default range and no presets, so every visit began with typing. The range
defaults to this month, the inputs are the app's own `DateRangePicker` — which
grew a "This month" preset — and the active report runs as soon as there is a
range to run it over, including after a tab switch. (An earlier draft of this
review called the red Generate button a danger signal — see Corrections: red is
the app's primary colour.)

**Slows people down — reports do not say which shift they cover** ✅ **Fixed.** — person and
date only, so two reports from one day are told apart by author alone.
✅ **Fixed.** The response carries `shift_label` ("B-5 — Brush 5"), resolved in
two batched queries rather than by a relationship: an eager Shift → Apparatus
chain would load on every query that touches a report, and a lazy one raises
`MissingGreenlet` the moment a response model reads it.

---

## The pattern underneath

Almost nothing here needs invention. The module already contains the clear
version of nearly every unclear screen; it is just not applied evenly.

1. **The good writing is already in the building.** The settings screens explain
   each switch in one sentence naming the consequence ("Disabling hides the
   Shift Reports tab from the scheduling section"). The close-out checklist
   states conditions as sentences. Open Shifts opens with a banner saying what
   the page is for. Copy those three patterns outward and most wording findings
   close.
2. **The same fact is written three ways.** Apparatus as `B-5`, `B-5 — Brush 5`,
   `Brush 5`; crewing as `(3/3)`, `3/3 staff`, `3 / 4 filled`,
   `3 assigned / 3 positions`. Pick the longest form in each pair — it exists
   already and it is the one that reads.
3. **Five date formats, and one was a real bug.** `8/15/2026`, `Sat, Aug 1`,
   `Saturday, August 1, 2026`, `Aug 10, 2026`, `2026-08-01`. The inconsistency
   is cosmetic; the off-by-one behind it was not, and is fixed.
4. **Unlabelled icons cluster where the stakes are highest** — My Shifts, the
   drawer header, the crew board, all with destructive actions behind bare
   glyphs. A label is the cheapest correctness fix in the module.
5. **Nothing carries the shift with it.** Open a checklist and the truck and
   date vanish; read a shift report and it never says which shift. One change
   repeated in several places.

## Say this instead

| Currently says                              | Say instead                   | Where                       |
| ------------------------------------------- | ----------------------------- | --------------------------- |
| `presence`                                  | On the truck?                 | Under every checklist item  |
| `Start Check` (on a card badged End)        | Open checklist                | Checklist cards             |
| `Check History`                             | Completed checklists          | My Equipment Checklists     |
| `Active Checklists`                         | Due now and coming up         | My Equipment Checklists     |
| `Start` / `End` badge                       | Start of shift / End of shift | Checklist cards and filters |
| `TRAINEE`                                   | Crew member                   | Shift report summary table  |
| `Finalize`                                  | Close out shift               | Shift drawer                |
| `Pre-Finalization Checklist`                | Before you close this shift   | Close-out panel             |
| `Positions from B-5 + shift customizations` | Crew positions for Brush 5    | Crew board                  |
| `My Reports` / `Filed by Me`                | About me / Written by me      | Shift report tabs           |
| `Feature Toggles`                           | What's turned on              | Scheduling settings         |
| `B-5 (3/3)`                                 | Brush 5 — 3 of 3 crewed       | Calendar cells              |
| `Min Staffing`                              | Smallest crew that can run    | Template form               |
| `Calls / Runs`                              | Pick one — Calls              | Shift drawer                |
| `1 equipment check(s)`                      | 1 equipment check             | Close-out checklist         |

Also: the nav said **Shift Scheduling** while the page said **Scheduling &
Shifts** and the onboarding registry had a third copy of the second — all three
say Shift Scheduling now; and check / checklist / report were used
interchangeably for three different things, which the last row of the list above
settles.

Every row in this table is in place.

## What the two passes actually changed

The order the work was done in, and what each item turned out to cost:

1. **Labelled the four icons in My Shifts** — highest stakes, smallest change,
   and it set the verbs (Confirm / Decline / Swap / Details) that the drawer
   header and the crew board then matched.
2. **Bound check-in to the shift** — the only data-integrity finding. The
   product already had the concept in Scheduling Settings; the endpoint did not
   consult it.
3. **Made the calendar say what it means**, in the wording the phone layout
   already used.
4. **Fixed the clipped template dialog**, then the form inside it: one length
   derived from the times instead of three fields for two facts.
5. **Retired the internal vocabulary** — `presence`, `TRAINEE`, `Finalize`,
   `Feature Toggles`, `Calls / Runs`, "Positions from B-5 + shift
   customizations" — and settled on one word per thing: a _checklist_ is what you
   fill in, a _check_ is the record of having filled one in, a _report_ is the
   shift report.
6. **Gave the crew somewhere to stand on a long checklist** — sticky progress,
   sticky compartment heading, sticky Submit — and a third answer for a tool
   that is legitimately off the truck.

Three of these needed backend work, and it is worth saying why: a wording
finding is sometimes a data finding wearing a label. "Every item was captioned
presence" was an unvalidated free-form column. "Pass or Fail, nothing between"
was a missing enum value, a roll-up that counted answers as faults, and a report
bucket. "Reports do not say which shift they cover" was a field the API never
sent.
