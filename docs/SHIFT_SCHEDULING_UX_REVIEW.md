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

**Slows people down — three fields for two facts.** ✅ **Fixed.** Start time, end time _and_
duration, with duration pre-filled `12` regardless, so the two can disagree.
Start and end are six blank dropdowns. Cards behind the dialog show 24-hour
times while the form uses AM/PM.

**Slows people down — colour is picked by typing a hex code** ✅ **Fixed.** (`#dc2626`). A raw
hex field is developer-facing; offer six or eight named swatches. The default is
also red, which the calendar itself uses for a shift in trouble.

**Slows people down — officer tools sit below the whole calendar.** ✅ **Fixed.** Seven cards
under an "ADMINISTRATION" heading, reached only after scrolling a full month
grid; on a phone each carries an external-link arrow though they are ordinary
pages, and the Supply badge shows an orange `1` with nothing to say what it
counts.

**Slows people down — patterns open collapsed** ✅ **Fixed.** with nothing to read or do, and
the page prints its title twice.

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

**Invites mistakes — "0/2 present" on a shift eight days out.** ✅ **Fixed.** Nobody can be
present for a future shift, so the zero reads as an alarm; and the two
denominators differ (`0/2` present, `2/3` staffed), which makes the pair look
self-contradictory. Show attendance only once the shift has started.

**Invites mistakes — an unlabelled delete in the drawer header** ✅ **Fixed.**, one of four
bare icons, two of them destructive.

**Invites mistakes — an uncaptioned hours chip** ✅ **Fixed.** beside each crew member
(`12h`, `11.9h`). Scheduled, credited or worked — the three differ in practice.

**Slows people down — My Shifts never says which truck.** ✅ **Fixed.** Date, time and
"Position: Officer", but no apparatus or station: the one fact that tells you
where to go. Every other view shows it.

**Slows people down — Assign opens a form you cannot see.** ✅ **Fixed.** The form renders at
the bottom of the drawer without scrolling to it, so on a 900px window the
button appears to do almost nothing.

**Slows people down — "Assign" and "Sign Up" side by side** ✅ **Fixed.**, with the
difference (someone else vs. me) never stated.

**Slows people down — internal phrasing on screen:** ✅ **Fixed.** "Positions from B-5 +
shift customizations" describes how the list is computed.

## 03 · Start of shift

**Invites mistakes — a card reading "End" above a button reading "Start
Check".** ✅ **Fixed.** The badge is _when_, the button is _what you do now_, and together
they contradict. The filter chips "All / Start / End" repeat it. Spell the
timing out and rename the button "Open checklist".

**Invites mistakes — every item was captioned "presence"**. ✅ **Fixed.** Not a
wording choice: `check_type` was an unvalidated free-form string, the demo seeder
wrote `"presence"` — not one of the nine types the form can render — and the
caption fell back to printing the raw value. The value is now validated on write
against the set the template builder offers, an unrecognised one renders no
caption at all rather than an internal token, and the seeder was corrected. A
department using the builder always saw the proper label ("Present").

**Invites mistakes — the checklist forgets its shift.** ✅ **Fixed.** Once open, the only
heading is the template name; apparatus, date and shift are gone, so two trucks
running the same template produce identical screens.

**Invites mistakes — Pass or Fail, nothing between.** ✅ **Fixed.** No "not applicable", no
"out of service". A tool legitimately off the truck must be recorded as a
failure or buried in a note, and the compliance reports then count it as a
fault.

**Invites mistakes — check-in accepts a shift that ended days ago.** ✅ **Fixed.** Verified
against the running app: opening the check-in link for a shift that ended
31 July and pressing Check In returned `200` on 11 August and stamped the
arrival time as _now_. The only guard is whether an officer finalised the shift;
the shift being over means nothing. This is the one data-integrity finding here.
The product already has the concept — Scheduling Settings carries "Checklist
Timing — start/end of shift windows" — so bound check-in the same way and say on
screen why the button is off.

**Slows people down — checking in leads nowhere.** ✅ **Fixed.** After a successful check-in
nothing points at the start-of-shift checklist, which lives on another tab of
another page.

**Slows people down — REQUIRED on all nine items** ✅ **Fixed.**, in red, the same red used
for a failed item. Mark the optional ones instead.

**Slows people down — checklists days away look as due as today's.** ✅ **Fixed.** Six
checklists five to nine days out, active buttons, no ordering by urgency,
nothing marking what is due on this shift.

**Slows people down — no progress or submit within reach.** ✅ **Fixed.** Progress (`0/9`) is
at the top, Submit at the very bottom, compartment headings scroll away. The
demo checklist has nine items; a real engine inventory runs to dozens, so a
member scrolls to the end to find out they missed one in the cab. Pin progress
and Submit; make compartment headings sticky.

**Slows people down — two buttons a letter apart:** ✅ **Fixed.** "Start a Check" (page
header, unscheduled) and "Start Check" (card, assigned).

**Slows people down — the not-found message blames a QR code that was never
used.** ✅ **Fixed.** Opening the page without a shift shows "This QR code may be invalid or
you may not have access to this shift" — two guesses, neither actionable.

## 04 · End of shift

**Already right — the pre-finalisation checklist is the model the rest of the
module should copy.** It states each condition as a plain sentence with an
honest colour: "3 of 3 checked in, 3 checked out", and in amber, "Ran
understaffed — 3 of 4 positions filled." It tells an officer what they are
signing off with no jargon at all. Everything below is wording on top of a
screen that already works.

**Invites mistakes — nothing says which rows block the close-out.** ✅ **Fixed.** The amber
"Ran understaffed" row looks like a barrier but is not; the shift finalises
anyway. Green and amber are equally passable, which trains officers to ignore
both. Separate "must fix first" from "noted on the record".

**Invites mistakes — the close-out checklist is indistinguishable from the
start-of-shift one.** ✅ **Fixed.** Same layout, same buttons, same "Submit Report"; only the
template name differs.

**Slows people down — "Finalize" appears twice at once** ✅ **Fixed.** (drawer header and
panel) and is the least plain word on the screen. One button, "Close out shift".

**Slows people down — machine plurals and a raw date.** ✅ **Fixed** (plurals; the stale-handoff date remains). "1 equipment check(s)
completed", "1 call(s) recorded", and a handoff banner headed "Handoff from
previous shift (2026-08-01)" — an ISO date two lines under "Wednesday,
August 12, 2026", eleven days stale with nothing marking it as old.

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

**Slows people down — Scheduling Reports opens blank.** ✅ **Fixed.** Five report types, all
starting on "Select a Date Range" with two empty `mm/dd/yyyy` boxes: no default
range and no presets, so every visit begins with typing. Default to this month,
add "Last 30 days / This month / This year", and use the app's own
`DateRangePicker` rather than bare native inputs. (An earlier draft of this
review called the red Generate button a danger signal — see Corrections: red is
the app's primary colour.)

**Slows people down — reports do not say which shift they cover** ✅ **Fixed.** — person and
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

## Implemented delivery order

The original highest-risk items (ambiguous My Shifts actions, unrestricted late
check-in, calendar codes, the template dialog, and unclear report terminology)
are fixed. The table below records the implementation order used for the remaining work.

| Priority | Outcome                                                      | Changes that produce it                                                                                                                                                                                | Why now                                                                                                                                                |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0**   | A member records the right checklist against the right shift | Carry apparatus, shift date and start/end timing into the checklist; rename the action to **Open checklist**; add **Not applicable** and **Out of service** outcomes                                   | The current flow can attach an apparently valid Pass/Fail record to an indistinguishable checklist and forces legitimate exceptions to become failures |
| **P0**   | Assignment actions cannot silently surprise a crew           | Hide future attendance; label destructive drawer actions; caption hours as scheduled or worked; scroll the newly opened assignment form into view; explain **Assign member** versus **Sign myself up** | These actions directly change staffing, but the current screen mixes future attendance, ambiguous numbers and controls that appear to do nothing       |
| **P1**   | Start-of-shift work becomes one continuous task              | After check-in, link directly to today's start checklist; sort today's checklists first; distinguish future items; pin checklist progress and submit; keep compartment headings visible                | Members currently cross tabs/pages and repeatedly scroll long apparatus checks to discover omissions                                                   |
| **P1**   | Officers know what must be resolved before close-out         | Split finalisation conditions into **Must fix** and **Recorded warning**; visibly distinguish start and end checklists; mark stale pass-down notes with a friendly date and age                        | The strongest screen in the flow still makes passable warnings look like blockers and makes stale handoffs look current                                |
| **P1**   | Reports answer common questions on arrival                   | Default the range to this month; add date presets; use the shared date-range control; identify the covered shift with time and apparatus                                                               | Every report visit currently starts with manual date entry, and same-day reports cannot be identified confidently                                      |
| **P2**   | Shift creation has one source of truth                       | Derive duration from start/end time; replace six blank time dropdowns with the standard time input; use one time format; replace raw hex entry with named colour swatches                              | Removing redundant and developer-facing inputs prevents contradictory templates and speeds routine setup                                               |
| **P2**   | Administration is discoverable without calendar scrolling    | Move officer tools into a persistent sub-navigation; remove external-link glyphs from internal routes; label badge counts; open Patterns with useful content and one page title                        | This is recurring navigation friction rather than a correctness risk, so it follows the shift lifecycle work                                           |

### Delivered slices

1. **Checklist identity and outcomes:** context header, start/end wording, new
   outcomes, and report handling for those outcomes.
2. **Assignment safety:** future-attendance suppression, explicit action labels,
   hours captions, and focus/scroll management for the assignment form.
3. **Guided shift lifecycle:** check-in → today's checklist → close-out, with
   progress and blocking-state treatment carried between screens.
4. **Reporting defaults:** date presets and shift identity in list, detail and
   print views.
5. **Creation and navigation polish:** derived duration, time controls, colour
   swatches, administration navigation and Patterns empty state.

Measure the first three slices with task completion rather than clicks alone:
the percentage of members who complete check-in and the correct start checklist
without leaving the flow, checklist exception rates by outcome, assignment-form
abandonment, and close-out attempts blocked by an unresolved requirement.

## Follow-up implementation review

Implementing the workflow changes exposed six contracts that were easy to miss
in a screen-only review:

1. **Checklist outcomes are a data contract, not button copy.** Adding **Not
   applicable** and **Out of service** required the request schema, client types,
   aggregate status calculation, stored item value and history display to agree.
   Not applicable completes an item without failing the check; out of service
   completes the item and fails the overall check so it remains visible in
   readiness and deficiency reporting.
2. **Shift identity belongs on the report response.** The report list cannot
   reliably distinguish two same-day shifts using the report row alone. The API
   now exposes the linked apparatus and shift start time from its existing shift
   relationship, rather than issuing one client request per report or encoding
   presentation text into the report record.
3. **Derived duration needs an overnight rule.** Template duration is now
   calculated from start and end. An end at or before the start is treated as
   the following day, preserving 19:00–07:00 and 07:00–07:00 templates without
   asking the creator to reconcile a third value.
4. **Persistent does not have to mean fixed-position.** Administration is now a
   compact, horizontally scrollable sub-navigation immediately after the main
   scheduling tabs. It remains discoverable before the calendar without taking
   permanent viewport space on a phone; badge text says what is being counted.
5. **A trainee performing the check needs training provenance.** Shift
   finalisation already creates a draft training report for active enrollees and
   explicit training-slot assignments, but the report previously contained no
   evidence that the trainee performed an equipment check. Linked, completed
   checks are now copied into the draft's tasks with the check id as provenance.
   The operational checklist remains the source of truth; the training report
   records what the evaluator should review and approve.
6. **Training provenance is not trainee-visible until release.** Draft,
   pending-review and flagged reports remain officer-only through list, detail
   and aggregate-stat endpoints. This boundary applies even when the optional
   second-review workflow is disabled: that setting allows the filing officer
   to approve directly; it does not publish drafts. Trainees receive only an
   approved report, after configured field-level visibility is applied.
7. **Provisional review must not award training credit.** Submitting a draft for
   second review no longer advances shift, hour, call or skill requirements.
   Credit is applied only when the report becomes approved, using the existing
   source-id deduplication so a retry cannot award it twice. Likewise, a trainee
   cannot acknowledge a draft, pending-review or flagged report by calling the
   acknowledgement endpoint directly.
8. **New outcomes must remain distinct in analytics.** The first implementation
   correctly treated Out of service as a failure in readiness and deficiency
   reports, but the item-trend fallback grouped Not applicable with Not checked.
   Trend responses, charts and CSV exports now carry a separate Not applicable
   count, and history renders human-readable labels for both new outcomes.
9. **Shift apparatus identity is polymorphic.** Scheduling can reference either
   a full Apparatus record or the lightweight BasicApparatus created during
   onboarding. Report identity initially resolved only the full module record;
   it now resolves both, matching the apparatus options and equipment-check
   paths instead of dropping the unit label for onboarding-only departments.

### Next controls for review quality

The confidentiality and credit boundaries are now explicit. The next gains are
process controls rather than more report fields:

1. **Give every draft one accountable reviewer.** Notify the assignment's
   configured evaluator—not only the officer who finalized the shift—and show an
   **Assigned to me** queue. Fall back to the shift officer only when no evaluator
   was selected.
2. **Add review service levels.** Set department-configurable targets for draft
   completion and second review (for example, 48 hours each), remind the assigned
   reviewer before the deadline, and escalate overdue reports to training
   managers. The existing scheduled job escalates trainee acknowledgement only;
   it does not stop reports from waiting indefinitely on an officer.
3. **Require evidence before release.** For training assignments, block approval
   until hours are reconciled, required rubric sections are complete, linked
   equipment checks still exist, and each failed/out-of-service result has a
   disposition. Show these as a plain-language release checklist.
4. **Separate observation from approval.** Preserve the filing evaluator's
   evidence, reviewer changes and redactions as distinct history entries. For
   departments using second review, prevent the filing evaluator from acting as
   the second reviewer unless an explicit override is audited.
5. **Measure the review funnel.** Report median time from shift close to draft,
   draft to submission, submission to approval and approval to trainee
   acknowledgement; also show overdue counts, flag/rework rates and reports
   released without equipment-check evidence.

### Regression checks for future review

- Create same-day, overnight and 24-hour templates and verify their derived
  durations at the API boundary.
- Submit each of Pass, Fail, Not applicable and Out of service, then verify the
  item history, overall result, readiness state and aggregate reports agree.
- Check in from the QR landing page and reach the highlighted checklist without
  navigating through another scheduling tab.
- Have a training-slot member complete a shift check, close the shift, and
  verify the evaluator's draft report names the check and retains its source id.
- As that trainee, verify the draft is absent from report lists and stats and
  returns not found by id; approve it as an officer, then verify it appears with
  the configured field-level visibility.
- Submit a draft into second review and verify no training progress changes;
  approve it and verify credit is applied once, then retry approval and verify
  it remains unchanged.
- Open two reports for the same member and date on different apparatus and
  verify they can be distinguished while collapsed and in print.
- Repeat assignment and checklist tasks at phone width with keyboard focus and
  screen-reader names as well as visible labels.
