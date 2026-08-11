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

Counts: **1** blocks work, **19** invites mistakes, **18** slows people down,
plus **9** code faults found and fixed (below).

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

A wider scan found ~25 more sites in the services layer with the same
`add` → `flush` → `return`-without-`refresh` shape as the timestamp bug. They
are **not** all bugs — only those whose object is serialised through a response
model requiring the timestamps — and confirming each needs tracing to its
endpoint. That sweep is **not** done and is the obvious follow-up.

---

## 01 · Shift scheduling

**Invites mistakes — the calendar speaks in codes nobody defined.** Cells read
`7:00 AM B-5 (3/3)` with a green tick or amber triangle. Nothing says `B-5` is
Brush 5, that `(3/3)` counts filled positions, or that amber means short. The
module already solves this three times over: the phone layout writes
"3/3 staff", the shift drawer writes "B-5 — Brush 5", Open Shifts writes
"3 / 4 filled". Use that wording on desktop and add a one-line key.

**Invites mistakes — two stat tiles, one number.** "Scheduled Shifts" reads 66
and "This Month" also reads 66. "Hours Worked This Month — 868.1" never says
whose; it is the department's. Name the window and the subject in the label.

**Blocks work — the Create Template dialog hides its own Save button.** The
dialog is taller than the window: the last option is cut off mid-sentence and
Save is below the fold with no scroll affordance. Give the body its own scroll
area and pin the footer.

**Slows people down — three fields for two facts.** Start time, end time _and_
duration, with duration pre-filled `12` regardless, so the two can disagree.
Start and end are six blank dropdowns. Cards behind the dialog show 24-hour
times while the form uses AM/PM.

**Slows people down — colour is picked by typing a hex code** (`#dc2626`), and
defaults to red, the colour the calendar uses for trouble.

**Slows people down — officer tools sit below the whole calendar.** Seven cards
under an "ADMINISTRATION" heading, reached only after scrolling a full month
grid; on a phone each carries an external-link arrow though they are ordinary
pages, and the Supply badge shows an orange `1` with nothing to say what it
counts.

**Slows people down — patterns open collapsed** with nothing to read or do, and
the page prints its title twice.

## 02 · Assignment

**Invites mistakes — four unlabelled buttons on the member's most-used screen.**
Every My Shifts row ends in a green tick, a red circled cross, a swap arrow and
a chevron, with no text anywhere. Nothing distinguishes "confirm I'm working
this" from "give this shift up", and the red one looks destructive. This is the
riskiest screen in the module: guessing wrong leaves a truck unstaffed. Label
them, or reduce to one primary action plus a menu that names each choice.

**Invites mistakes — the bulk header contradicts its rows.** "Select all 4
pending" above four rows badged **Assigned**.

**Invites mistakes — "0/2 present" on a shift eight days out.** Nobody can be
present for a future shift, so the zero reads as an alarm; and the two
denominators differ (`0/2` present, `2/3` staffed), which makes the pair look
self-contradictory. Show attendance only once the shift has started.

**Invites mistakes — an unlabelled delete in the drawer header**, one of four
bare icons, two of them destructive.

**Invites mistakes — an uncaptioned hours chip** beside each crew member
(`12h`, `11.9h`). Scheduled, credited or worked — the three differ in practice.

**Slows people down — My Shifts never says which truck.** Date, time and
"Position: Officer", but no apparatus or station: the one fact that tells you
where to go. Every other view shows it.

**Slows people down — Assign opens a form you cannot see.** The form renders at
the bottom of the drawer without scrolling to it, so on a 900px window the
button appears to do almost nothing.

**Slows people down — "Assign" and "Sign Up" side by side**, with the
difference (someone else vs. me) never stated.

**Slows people down — internal phrasing on screen:** "Positions from B-5 +
shift customizations" describes how the list is computed.

## 03 · Start of shift

**Invites mistakes — a card reading "End" above a button reading "Start
Check".** The badge is _when_, the button is _what you do now_, and together
they contradict. The filter chips "All / Start / End" repeat it. Spell the
timing out and rename the button "Open checklist".

**Invites mistakes — every item is captioned "presence"**, the internal name
for the kind of check. Ask the question instead ("On the truck?") or show
nothing.

**Invites mistakes — the checklist forgets its shift.** Once open, the only
heading is the template name; apparatus, date and shift are gone, so two trucks
running the same template produce identical screens.

**Invites mistakes — Pass or Fail, nothing between.** No "not applicable", no
"out of service". A tool legitimately off the truck must be recorded as a
failure or buried in a note, and the compliance reports then count it as a
fault.

**Invites mistakes — check-in accepts a shift that ended days ago.** Verified
against the running app: opening the check-in link for a shift that ended
31 July and pressing Check In returned `200` on 11 August and stamped the
arrival time as _now_. The only guard is whether an officer finalised the shift;
the shift being over means nothing. This is the one data-integrity finding here.
The product already has the concept — Scheduling Settings carries "Checklist
Timing — start/end of shift windows" — so bound check-in the same way and say on
screen why the button is off.

**Slows people down — checking in leads nowhere.** After a successful check-in
nothing points at the start-of-shift checklist, which lives on another tab of
another page.

**Slows people down — REQUIRED on all nine items**, in red, the same red used
for a failed item. Mark the optional ones instead.

**Slows people down — checklists days away look as due as today's.** Six
checklists five to nine days out, active buttons, no ordering by urgency,
nothing marking what is due on this shift.

**Slows people down — no progress or submit within reach.** Progress (`0/9`) is
at the top, Submit at the very bottom, compartment headings scroll away. The
demo checklist has nine items; a real engine inventory runs to dozens, so a
member scrolls to the end to find out they missed one in the cab. Pin progress
and Submit; make compartment headings sticky.

**Slows people down — two buttons a letter apart:** "Start a Check" (page
header, unscheduled) and "Start Check" (card, assigned).

**Slows people down — the not-found message blames a QR code that was never
used.** Opening the page without a shift shows "This QR code may be invalid or
you may not have access to this shift" — two guesses, neither actionable.

## 04 · End of shift

**Already right — the pre-finalisation checklist is the model the rest of the
module should copy.** It states each condition as a plain sentence with an
honest colour: "3 of 3 checked in, 3 checked out", and in amber, "Ran
understaffed — 3 of 4 positions filled." It tells an officer what they are
signing off with no jargon at all. Everything below is wording on top of a
screen that already works.

**Invites mistakes — nothing says which rows block the close-out.** The amber
"Ran understaffed" row looks like a barrier but is not; the shift finalises
anyway. Green and amber are equally passable, which trains officers to ignore
both. Separate "must fix first" from "noted on the record".

**Invites mistakes — the close-out checklist is indistinguishable from the
start-of-shift one.** Same layout, same buttons, same "Submit Report"; only the
template name differs.

**Slows people down — "Finalize" appears twice at once** (drawer header and
panel) and is the least plain word on the screen. One button, "Close out shift".

**Slows people down — machine plurals and a raw date.** "1 equipment check(s)
completed", "1 call(s) recorded", and a handoff banner headed "Handoff from
previous shift (2026-08-01)" — an ISO date two lines under "Wednesday,
August 12, 2026", eleven days stale with nothing marking it as old.

## 05 · Shift reports

**Invites mistakes — crew members are labelled "Trainee".** The summary table's
first column is headed **TRAINEE** and the block is "Trainee Summary", listing
everyone who worked. Settings itself says reports cover all crew and that
training evaluations are a separate, optional add-on.

**Invites mistakes — people are rated 1–5 stars with no published scale.** Every
report carries a rating and the table an "AVG RATING" column; nowhere does the
screen say what three stars means or what is being measured. Settings has a
"Rating Scale" section — surface those words next to the stars.

**Invites mistakes — "My Reports" and "Filed by Me"** are reports about you and
reports you wrote, and both readings fit both labels. "About me" / "Written by
me".

**Invites mistakes — approved is the absence of a badge.** Draft, Pending Review
and Flagged have pills; a finished report has none, so the most important state
is inferred from a gap.

**Invites mistakes — hours are formatted four ways and disagree with
themselves.** One screen shows `6h`, `12h`, `11.87h`, `11.73h`, and the same
record reads `11.9` in the summary table and `11.87h` in the row below it.

**Slows people down — Scheduling Reports opens blank.** Five report types, all
starting on "Select a Date Range" with two empty `mm/dd/yyyy` boxes: no default
range, no presets, and the primary button is red, which everywhere else means
danger. Default to this month and add presets.

**Slows people down — reports do not say which shift they cover** — person and
date only, so two reports from one day are told apart by author alone.

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

Also: the nav says **Shift Scheduling** while the page says **Scheduling &
Shifts**; and check / checklist / report are used interchangeably for three
different things.

## Where to start

1. **Label the four icons in My Shifts** — highest stakes, smallest change.
2. **Bound check-in to the shift** — the only data-integrity finding.
3. **Make the calendar say what it means**, using the wording the phone layout
   already uses, plus a two-line key.
4. **Fix the clipped template dialog** — a form whose Save button cannot be seen.
5. **Retire "presence", "Trainee" and "Finalize"**, and publish the star-rating
   scale next to the stars.
