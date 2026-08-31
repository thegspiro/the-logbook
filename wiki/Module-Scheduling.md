# Scheduling Module

The Scheduling module manages shift scheduling, member self-service signup, swap and time-off requests, shift templates, and scheduling reports.

> **Equipment checklists moved to Inventory on 2026-08-31.** A checklist is a
> list of inventory items, so the whole feature — authoring it, performing it
> and reporting on it — lives in the
> [Inventory module](Module-Inventory#equipment-checklists-moved-here-2026-08-31)
> under `/inventory/checklists`. **Scheduling hosts none of it.**
>
> What Scheduling keeps is the shift's own business: a "Start checklist" link
> on shift check-in and on the shift detail panel, both pointing at
> `/inventory/checklists/my?shift={id}`; the finalize gate on outstanding
> end-of-shift checks; and the picker that lets a shift template **name** the
> checklists its shifts carry, edited under the vehicle picker on the template.
>
> The Equipment Checks tab is gone, and so are the old `/scheduling/equipment*`
> URLs. Members reach their checklists from the **My Checklists** nav row.
> Sections below that describe checks are kept for the shift-side behaviour.

---

## Key Features

- **Shift Calendar** — Week and month views of all scheduled shifts
- **Member Self-Service** — Sign up for open positions, confirm/decline assignments
- **9 Position Types** — Officer, driver, firefighter, EMT, captain, lieutenant, probationary, volunteer, other
- **Shift Conflict Detection** — Prevents duplicate assignment and detects overlapping shift time conflicts
- **Shift Officer Assignment** — Assign shift officers via dropdown in create/edit modals
- **Understaffing Indicators** — Amber warning badges on calendar cards when staffing is below apparatus minimum
- **Template Colors** — Shifts inherit color from templates for visual calendar organization
- **Swap Requests** — Members request shift swaps with approval workflow
- **Time-Off Requests** — Request time off with admin approve/deny (date range validation enforced)
- **Shift Templates** — Reusable shift configurations with vehicle type selector for Standard and Specialty categories
- **Shift Patterns** — Daily, weekly, platoon, and custom patterns for bulk generation (JS weekday convention)
- **Shift Pattern Presets** — Built-in fire department rotations (24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB) plus custom pattern builder
- **Bulk Shift Generation** — Generate multiple shifts from templates and patterns, with duplicate check by date + start_time
- **Vehicle Linking on Templates** — Templates linked to actual department vehicles from the Apparatus module
- **Auto-Default Shift Officer** — Assigning the "Officer" position automatically sets that member as the shift officer
- **Apparatus Connection** — Link shifts to vehicles from the apparatus dropdown
- **Shift Completion Reports** — Officers file reports that auto-credit training programs
- **Leave of Absence Integration** — Members on leave excluded from scheduling
- **Multiple Reports** — Hours, coverage, call volume, availability analytics
- **Manual Shift Report Page** — _(2026-04-11)_ Standalone page at `/training/manual-shift-report` for departments without the scheduling module enabled. Officers manually enter shift date, start/end times, apparatus, crew, and trainee evaluations
- **Shift Report Hardening** — _(2026-04-11)_ 20+ security and data integrity fixes for production readiness including submit-all-drafts scope fix, enrollment ID whitelist validation, draft regression guard, and print button restoration
- **End-of-Shift Member Summary** — _(2026-05-29)_ New scheduled task emails (and in-app notifies) each attending active member a summary of their hours, calls, and a report link after their shift
- **Trainee Report Follow-Up** — _(2026-05-29)_ New daily escalation reminds trainees of approved-but-unacknowledged reports, plus low-rating officer alerts to training officers
- **Richer Shift Reminders** — _(2026-05-29)_ Pre-shift reminders now include apparatus, the active-member crew roster, and equipment checklists, with a "Mark Arrival" deep link; email is sent by default
- **Shift Call / Run Logging** — _(2026-06-09)_ Officers (`scheduling.manage`) log the calls a crew ran during a shift: incident type/number, dispatched/on-scene/cleared times, cancelled-en-route and medical-refusal flags, responding members, and notes. Read-only once the shift is finalized
- **Staffing-Based Open Shifts** — _(2026-06-09)_ The Open Shifts list now ranks by **actual staffing** (unfilled required position, or active `ASSIGNED`/`CONFIRMED` count below `min_staffing`) instead of a fixed page, so fully-staffed shifts no longer push genuinely-open ones out of view (capped at 500 candidates per window)
- **Scheduling Query Performance** — _(2026-06-09)_ New composite index `idx_shift_assign_shift_status` on `shift_assignments(shift_id, assignment_status)`, plus batch-loading across the scheduled reminder/validation/auto-checkout tasks and the compliance report (eliminates N+1 officer/attendance/assignment/leave queries)
- **Platoon Rotations (opt-in)** — _(2026-06-19)_ Person-level platoon membership (A/B/C) drives multi-platoon rotation generation with leave-aware staffing and a hold-over roster. Off by default; toggled per department (see below)
- **Full Shift Lifecycle** — _(2026-07-16)_ Per-shift officer authority, a live readiness panel, cancel-instead-of-delete, reopen/unfinalize, crew pass-down notes, and optional server-side close-out enforcement (require end-of-shift checks; restrict check-in to the roster). See below
- **Personal Calendar Feed & Automation** — _(2026-07-16)_ Members subscribe to their shifts in Google/Apple Calendar via a private ICS link; departments can auto-generate shifts from patterns on a rolling horizon and get overtime/hours advisories. See below

---

## The Shift Board and Standing Shifts _(2026-08-23 → 08-24)_

The Schedule tab is a **board**, not a grid of cards. A card told a member a
shift existed; it did not say whether it still needed anybody, and claiming a
seat meant opening a panel and finding a position dropdown.

### What the board shows

Every shift in the month grid carries a **status chip**:

| Chip                | Colour      | Meaning                                |
| ------------------- | ----------- | -------------------------------------- |
| `2 open`            | red / amber | Seats still to fill                    |
| `Full 4/4`          | green       | Staffed                                |
| `You + 2/4`         | blue        | You are on it                          |
| Headcount, no ratio | grey        | **The shift never stated a crew size** |

Beside the grid, a day panel shows the crew and **one button that claims the
first open seat the member is cleared for**. Filters dim rather than hide, so
the month keeps its shape. On a phone this becomes a bar grid, a day sheet and
a confirmation screen.

**Every shift response now carries its `roster`**, so a month arrives with its
seat occupants in one request: selecting a day costs no network call, and a
cell can be coloured "you are on it" at all.

### The grey shift is deliberate

A shift naming neither positions nor `min_staffing` used to be assumed to have
four seats, so it rendered "4 open" in critical red. A department that
configures neither opened the page to a wall of red that meant nothing. Such a
shift is now grey, shows a headcount rather than a ratio, **stays out of the
open-seat count and the URGENT flag**, and can still be joined.

Cancelled, finalized and past shifts read as **closed** and offer nothing —
their empty chairs previously counted toward the day's open-seat total and its
urgent flag, and they offered a claim button the server refuses.

### Standing shifts

A standing shift is a member's recurring claim on a seat — "every Tuesday
night". It is **stored as a claim**, not written once as a batch of
assignments, so giving up a single date leaves the series intact.

**It has two readers and only means anything because both exist:**

1. Creating a claim seats the member on matching shifts **already on record**.
2. Creating a **shift** seats every member whose active claim matches it.

Without the second, a series would go quiet the month the department generated
its next block of schedule.

Edge cases:

- **The series is anchored on the shift it was started from**, not on today.
  Biweekly parity and the monthly ordinal both come from the first matching
  weekday after the start date — anchoring on today built a fortnight that
  skipped the very shift the member opened it from.
- **The horizon is the member's to pick**, defaulting to a year out rather than
  to December 31, which quietly shrinks as the year goes on.
- **A series covering only dates the department has not scheduled yet can be
  saved.** That is the case standing shifts exist for.
- Standing claims go through the **same self-service validation as any other
  sign-up**. They previously called `create_assignment` directly, whose
  `self_signup` flag defaults to false, so a series seated members on shifts
  they were not eligible for, on cancelled or finalized shifts, on past dates,
  and past a position's seat count.
- A claim's `apparatus_id` is verified in-org before it is stored.

### Trades a member can complete

`GET /scheduling/shifts/{id}/trade-candidates` lists who could take over the
caller's seat, with everyone who could not accept **already excluded**: on the
shift, on leave, not cleared for the position, or working an abutting tour.
Ranked least-loaded first.

`POST /scheduling/swap-requests/{id}/respond` lets the member who was offered a
seat accept it. This is deliberately distinct from manager review, which
refuses participants by design, and is limited to a one-way targeted offer:
accepting is the offerer withdrawing and the accepter signing up, in one step,
both already unprivileged.

**This closed a request nobody could complete.** Manager review reads a set
`target_user_id` as "there must be an assignment to trade back" and rejects the
request when there is no requesting shift — which is exactly the shape a
one-way offer has.

`swap_offer_expiry` is a daily sweep closing offers still pending the day
before the shift, notifying both members and the duty officer. A pending offer
holds the seat with the member who made it, so left alone it survived the shift
itself with nobody told.

Two more rules:

- **Giving up a seat is withheld while your own offer of it stands.** Releasing
  it, or offering it again, left the first recipient holding an offer that could
  no longer be honoured. Withdrawing is the only move until they answer.
- **A training seat cannot be handed over through a trade.** It carries the
  trainee's program and evaluating officer, and moving only the member id would
  file one member's training against another. Approved time off is rechecked
  when an offer is accepted, not only when candidates were picked.

### Seat capacity, and who it applies to

Seat capacity was half-enforced: a shift with named positions was capped seat
by seat, while a shift with only `min_staffing` had nothing reading it — so the
calendar could show "Full 4/4" while the server accepted a fifth. Officer
assignment stays uncapped deliberately.

**Position eligibility is now enforced on both write paths** _(2026-08-24)_.
`create_assignment` previously applied it only when a member claimed their own
seat, so a department that had configured which ranks may run a position had
that configuration enforced against the people least likely to get it wrong and
ignored when a scheduler seated somebody else. `require_mutable` and
`reject_past` remain tied to self-signup deliberately — a scheduler backfilling
last week's roster is doing records work, and being cleared for a position is a
safety question that does not expire with the shift.

### Dashboard staffing widgets

Seven tiles — Today's Staffing, Future Coverage Gaps, Open Slots, Pending
Changes, Incomplete Closeouts, Workload Balance, Special Operations — each
linking into the schedule already filtered to what it counted, so a number is a
starting point rather than a fact to go and find. Each tile keeps its own
horizon and filters, stored per member.

`GET /scheduling/dashboard/widgets` bounds its own window: a range that is
inverted, or 93 days or longer, is a `422` rather than a query that walks the
whole schedule. `station_id` and `platoon` are validated against the
organization's own lists, so an unknown value is a `422` and not an empty
result that reads as "nothing scheduled".

### Also fixed

- **Calendar day labels shifted a day for any viewer west of the department.**
  They went through a timezone-aware formatter; a calendar date belongs to no
  timezone, so a cell showing 26 announced itself as "Tuesday, August 25".
- **Each shift on the board carries a details link again.** The board's own
  actions cover claiming and giving up a seat; editing a shift, managing its
  attendance and finalizing it live in the detail panel, which a fully staffed
  shift an officer is not assigned to had no other route into.
- The standing service and shift generation resolve the organization's timezone
  through **one shared helper** instead of disagreeing about the default.
- The phone month grid got its 44px touch targets back.

## Full Shift Lifecycle, Calendars & Automation (2026-07-16)

A broad review closing gaps from shift start-up through close-out, plus
member-facing conveniences.

### Running a shift

- **Per-shift officer authority** — the officer named on a shift can manage its
  crew, attendance, calls, finalize, and cancellation without a department-wide
  `scheduling.manage`/`assign` grant. Editing/deleting the shift itself still
  requires `scheduling.manage`.
- **Readiness panel** — the shift detail shows present-vs-assigned, staffing vs.
  target (understaffed flag), and outstanding start-of-shift checks _during_ the
  shift, not just at finalize.
- **Cancel a shift** — cancels instead of deleting: the record is kept, the crew
  is notified, and the shift drops out of open-shift signup. Finalized shifts
  can't be cancelled.
- **Reopen a finalized shift** — a permissioned, audit-logged correction path;
  re-finalize when done.
- **Pass-down / handoff** — a note captured at finalize, shown to the next crew
  on the same apparatus.

### Close-out rules (department settings, off by default)

**Scheduling → Settings → General → Shift close-out rules.**

| Setting                                                     | Default    | Effect                                                                                                                                                             |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `require_end_of_shift_checks`                               | `false`    | Blocks finalize while end-of-shift equipment checks are outstanding; officers can override with a logged reason                                                    |
| `restrict_checkin_to_assigned`                              | `false`    | Only rostered members may check in (open shifts exempt)                                                                                                            |
| **Record a call count at close-out** (`call_tracking.mode`) | `detailed` | Switches close-out from the single finalize checklist to the three-step wizard, and switches call volume from per-incident logging to counted calls _(2026-08-19)_ |

### Member conveniences

- **Subscribe to my shifts** — My Shifts → "Subscribe to my shifts" gives each
  member a private calendar URL for Google/Apple Calendar/Outlook. The link can
  be reset if it leaks.
- **Overtime advisory** — an optional soft warning when an assignment/signup
  pushes a member's scheduled hours over the department cap
  (`max_hours_per_window` / `hours_window_days`).

### Automation

- **Auto-generate shifts** — a daily task keeps active patterns generating
  shifts to a chosen horizon (`auto_generate_enabled`, `auto_generate_weeks`).

### Training-position crew slots

- An officer can mark a crew-board seat as a supervised training slot and link
  it to the trainee's program + evaluator; finalizing drafts a completion report
  against that program.

---

## Requests: Pagination and Separation of Duties (2026-08-20)

### The Requests tab is paginated

`GET /scheduling/swap-requests` and `GET /scheduling/time-off` now return
`{ items, total, skip, limit }` instead of a bare array. **This is a breaking
change for anything reading those endpoints directly** — see
[API Reference](API-Reference#breaking-response-shape-change-2026-08-20).

A department that had accumulated a season's worth of swap history was loading
all of it to render one screen; the Requests tab now pages through it.

### A requester cannot approve their own request

Holding `scheduling.manage` no longer lets a member review a request they are
**party to**. Both review paths reject it outright:

> Requesters cannot review their own swap requests
> Target participants cannot manager-review swap requests
> Requesters cannot review their own time-off requests

Note that a swap has **two** blocked parties, not one: the member who raised
it and the member it targets. Manager approval stays distinct from participant
acceptance — the person being asked to take the shift cannot also be the
person who signs off on it.

This matters most on exactly the departments where it is least convenient. On
a small combination department the officer requesting Saturday off is
frequently the same person who holds the permission to approve it — and a
permission grant is not a second person. The rule is enforced in the service
layer, so it applies however the request is reached.

Scheduling requests are additionally **restricted to their participants**: a
swap request is no longer readable by members who are not party to it.

### Edge cases

- The rule keys on the **participants**, not the shift's owner. An officer may
  still review a swap between two other members on their own shift.
- **A rejected self-review leaves the request completely pending.** The check
  runs before any field is changed or any assignment cancelled, so a blocked
  attempt does not half-apply and does not consume the request — somebody else
  can still action it.
- The swap check runs inside the row lock (`with_for_update`), so two
  reviewers racing cannot slip a self-approval through between the read and
  the write.
- There is **no swap/time-off request export**. Anything that needs the whole
  set has to page through the API; `total` in the response is what tells a
  caller how many pages remain.

## Call Volume Without an RMS (2026-08-18 → 08-19)

A department that does not run incident reporting still has to answer _"how
many calls did we run, and what did each apparatus go on?"_ — for grant
applications, ISO ratings, apparatus replacement and staffing cases. The
`count_only` mode records exactly that and deliberately nothing more.

### What is deliberately not collected

No address, no cross streets, no patient or caller identity, no narrative, no
dispatch/on-scene/clear times, and no CAD incident number for display. Those
are the fields that make a call record PHI/PII, and collecting them is what the
department declined to do.

This is enforced **by absence** — there is no parameter to pass one to and no
column to land it in. `call_date` is a **date, not a timestamp**, because a
timestamp would let response times be reconstructed, which is the first step
back toward an incident record. A department that wants incident-level records
wants an incident module, behind its own consent and access-control story.

### The three numbers, and why they do not add up

They are computed by three separate code paths on purpose. Collapsing any two
produces a figure that looks right and is wrong.

| Number                     | Where it lives                     | What it means                                                                                                                                                            |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Department call volume** | distinct `org_calls` rows          | One call is one call, however many units rolled                                                                                                                          |
| **Apparatus runs**         | `org_call_responses` rows per unit | Unit responses. A 400-call department can legitimately show 380 engine runs and 240 medic runs — these do not sum to the department total and are not supposed to        |
| **Member credit**          | `shift_attendance.call_count`      | Per member. Someone who came on at 0300 was not on the 2200 call. Never summed back into a department total — with a four-person crew that multiplies every call by four |

**Why a call row exists at all, rather than an integer on the shift.** Two
integers cannot be deduplicated. When Engine 5 reports 5 runs and Medic 1
reports 3, nothing in those numbers says whether they were on the same MVA or
on eight unrelated calls, so a department total summed from per-unit counts
double-counts every mutual response. The call row is the shared thing both
units point at.

### Call types

Nine are seeded for a department that has not defined its own: fire, EMS, MVA,
rescue, hazmat, service, alarm / good intent, mutual aid, other.

The **slug** is stored and permanent; the label is display-only and may be
renamed freely. Storing the label instead would orphan every historical call
the first time somebody fixed a typo in settings.

### The three-step close-out wizard

Opened by **Close out shift** on the shift detail panel, for
`scheduling.manage` or the shift's own officer, on a past shift that is neither
finalized nor cancelled.

| Step | Question                              | Saved on **Next**       |
| ---- | ------------------------------------- | ----------------------- |
| 1    | When was each member actually on?     | Attendance times        |
| 2    | How many calls did the apparatus run? | Call rows and responses |
| 3    | Confirm each member's credit          | Finalize                |

**Each step saves as it advances**, so a phone that locks at 0700 in an
apparatus bay resumes where it left off instead of starting over. The server's
`shifts.closeout_step` decides the entry screen — nothing is held only in the
browser. Reopening a finalized shift deliberately restarts the wizard at step 1.

**The total on step 2 is derived from the per-type rows and is read-only.**
There is exactly one source for the number. A design with a total field _and_ a
breakdown needs a reconciliation rule per direction, and the downward one was
missing — revising a count down left the old total on screen, and that stale
figure was what got saved.

**The wizard carries everything the checklist could do** — the end-of-shift
check override (still gated on a logged reason, still audited) and pass-down
notes. Without them, a count-only department that enforces equipment checks
could never close a shift at all.

### Reading the call volume report

`GET /scheduling/reports/call-volume` picks **one** source and never mixes:
count-only departments from the call tables, detailed departments from the
per-incident records. Reading both and adding them would count every call twice
for a department that has used each mode in turn.

In count-only mode the report relabels itself **Unit Responses**, **Avg
Responses/Day** and **Peak Responses**, with a footnote saying an incident two
units attended is counted once for each. That is not cosmetic: until the
cross-unit attach picker ships, two units closing out independently each report
their own call, so calling the figure "calls" would overstate the department's
volume. **Do not put that number in a grant application as a call count.**

Three caveats on that report, all of them easy to be caught out by:

- **The CSV export still says "Total Calls" in both modes.**
  `getCallVolumeExportData()` does not read `counts_unit_responses`, so the
  relabelling reaches the screen and not the file — which is the artifact most
  likely to leave the building. Relabel it by hand.
- **A date range spanning a mode change omits one period entirely.** The source
  is chosen from the org's **current** mode and applied to the whole range, so
  switching to count-only hides the detailed era and switching back hides the
  count-only era. No warning; the number is just smaller.
- **"Total Calls" in detailed mode is not an incident count either.** It sums
  `calls_responded` across **per-trainee** `ShiftCompletionReport` rows, so a
  shift with two enrolled trainees contributes twice.

Per-apparatus run counts are returned by the API (`by_apparatus_runs`) but
**not rendered on any screen**.

### Edge cases worth knowing

- **Blank and zero are different answers in the form and the request, but not
  after saving.** The distinction is what lets a correction clear a previously
  entered count; it does not survive persistence, since both store no call rows
  and both read back as `0`. No report can tell a quiet tour from an unanswered
  question.
- **A breakdown shorter than the total is accepted at the API level** — the
  remainder is stored as unclassified. **The wizard has no separate total
  field**: `deriveCallTotal` sums the visible rows, including its own "Not
  categorised" row, so an officer records a remainder by entering it there.
  Omitting it records a smaller shift, not an unclassified remainder.
- **You cannot lower the total below the calls this shift already shares with
  another unit.** The wizard says so and names the number; detaching a shared
  call is an explicit act, not something a lowered total should do behind your
  back.
- **Correcting a shift's date or apparatus after close-out moves its calls
  with it.** Before this was fixed the totals stayed right while the daily and
  per-apparatus reports pointed at the wrong day and the wrong truck.
- **Only `ASSIGNED` and `CONFIRMED` crew are listed.** Declined, pending and
  no-show members were previously shown — and every listed member gets the
  apparatus's full call count by default, which credited calls to people who
  never worked the shift.
- **Assigned members who never checked in are still listed**, with empty times
  to fill in. Otherwise they were invisible: no hours, no credit, and no way
  for the officer to notice.
- **A member credited with fewer calls than the apparatus ran gets a count,
  not types.** Which calls they were on is not knowable, and inventing an
  alphabetical prefix meant a trainee's single credit on a shift of one EMS and
  one fire was always spent against EMS-specific requirements.
- **100 calls per shift is a hard cap.** An officer closing out a shift is
  reporting a tour, not a year.

---

## Platoon Rotations (2026-06-19)

Departments that staff by **platoon** (rotating A/B/C crews) can build the
schedule from platoon membership instead of assigning each shift by hand. The
whole feature is **opt-in** and **off by default**.

### Department Toggle

Enabled per organization via `org.settings["scheduling"]["platoons_enabled"]`
(default `false`). When off, no platoon fields, badges, or roster appear and
generation ignores platoons — the module behaves exactly as before.

### Person-Level Platoon Membership

Platoon membership lives on the member: `User.platoon` (nullable, migration
`20260618_0100`). A firefighter is "on A platoon" as a standing assignment, and
the schedule is derived from it. Members see their platoon on their profile;
managers set it from the member admin UI (one-click control + card badge).

### Multi-Platoon Generation

Each platoon runs the same cycle offset by `i × cycle_length / num_platoons`
days, so the platoons tile to exactly one on-duty platoon per day:

| Rotation      | Cycle | Platoons | Offsets (days) |
| ------------- | ----- | -------- | -------------- |
| 24/48         | 3     | 3        | 0, 1, 2        |
| Kelly (9-day) | 9     | 3        | 0, 3, 6        |
| 48/96         | 6     | 3        | 0, 2, 4        |

### Leave Integration & Hold-Over Roster

- Generated platoon shifts reflect the platoon's **actual makeup** — a member on
  approved leave is omitted from the shifts they'd otherwise staff, and
  approving leave **cancels** their conflicting generated shifts.
- The **shift detail** view shows a **hold-over roster** of available members
  (same org, not on leave, not already assigned) with a **one-click Assign** so
  a supervisor can fill a gap or hold a member over.
- The responsible platoon is stored on the shift (`Shift.platoon`, migration
  `20260618_0200`).

### Department Platoon Overview & Bulk Assignment

- A **Platoon Management** page (`/scheduling/platoons`, `scheduling.manage`,
  linked from Settings → Platoons) lists every platoon and the unassigned bucket
  with their active members, and lets a manager **bulk-assign** members to a
  platoon (or clear it) in one request.
- `GET /scheduling/platoons/overview` (**`scheduling.manage`** as of 2026-08-17)
  and `POST /scheduling/platoons/bulk-assign` (`scheduling.manage`, org-scoped /
  IDOR-safe, audit `platoon_bulk_assigned`).

> ⚠️ **Permission change (2026-08-17).** The overview endpoint was gated on
> `scheduling.view`, which is implicit for every authenticated member — so the
> department-wide platoon roster was readable by anyone signed in. It now
> requires `scheduling.manage`. **Anyone who used this page before and does not
> hold `scheduling.manage` will now get a permission error.** Grant it to the
> roles that need the roster.

### Shift Roster Visibility _(2026-08-17)_

The shift detail view's hold-over roster is derived from **who is on approved
leave**. `GET /scheduling/shifts/{id}` now returns `platoon_roster` only to
callers with `scheduling.assign`, `scheduling.manage`, or who are the shift's
own **shift officer**. Everyone else receives an empty roster — it is not
fetched at all — while every other detail on the shift (time, apparatus,
assignments, check-in state) remains visible to any member.

### Generation and Pattern Fixes _(2026-08-17)_

- **Soft-deleted and anonymized members are no longer staffed onto generated
  platoon shifts.** Generation filtered on the member's `status` column, which
  a deleted member can still carry as `active`; it filters on `is_active` now.
- **A malformed platoon list no longer crashes the Patterns tab.** A pattern's
  stored schedule configuration is unvalidated JSON; a non-array (or an array
  with non-string members) reached the renderer and took the whole tab down.

---

## Recent Improvements (2026-05-29)

### Scheduled Tasks: Summaries & Follow-Up

- **`end_of_shift_summary`** (every 30 min): for each attending **active** member,
  sends an in-app notification and email summarizing their hours, calls, and a
  report link. Gated by `org.settings["shift_reports"]["member_summary"]`:
  `enabled` (default `true`), `lookback_hours` (default `4`), and
  `require_finalized` (default `true`). When `require_finalized=false`, the
  summary is sent for not-yet-finalized shifts and labeled "Preliminary Shift
  Summary"
- **`trainee_report_escalation`** (daily 08:00): reminds trainees of
  **approved-but-unacknowledged** reports older than `acknowledgment_days`
  (default `7`). In-app alerts go to the filing officer plus training officers.
  Rate-limited to `max_reminders` (default `3`), tracked in the report's
  `review_history`. Gated by `org.settings["shift_reports"]["follow_up"]`
  (`enabled`, default `true`)
- **Low-rating officer alert**: when a report's `performance_rating` is at or
  below `low_rating_threshold` (default `2` of 5; `0` disables) **or** it has
  non-empty `areas_for_improvement`, training officers are alerted

### Richer Shift Reminders

- Pre-shift reminders now include the apparatus, the **active-member** crew
  roster (member + position, capped at 8 with a "+N more" overflow), and the
  equipment checklists, plus a **"Mark Arrival"** deep link
- Email is now **sent by default** — `org.settings["shift_reminders"].send_email`
  defaults to `true` (opt out per-org)

### Deep-Link Fixes

- Check-in deep links point to `/scheduling/checkin?shift=<id>` (the page is
  mounted without a hyphen; the stale `?user=` param was dropped)
- Shift-report deep links point to `/scheduling?tab=shift-reports&report=<id>`
  (the previously emitted `/scheduling/reports/<id>` was not a real route). The
  page reads `?report=<id>` and auto-expands that report

### Attendance History & Past Shifts

- `GET /scheduling/my-attendance-history` gained optional `start_date`/`end_date`
  (YYYY-MM-DD) params and now joins `Shift` to embed `shift_date`, start, and end
- **MyShiftsTab** honors `?view=past` and synthesizes "completed" entries for
  walk-on attendance; the dashboard Standby card deep-links to the past view
- Roster and reminder queries now filter on `User.is_active`

---

## Recent Improvements (2026-04-11)

### Shift Completion Service Hardening

- **Submit-all-drafts scope**: `POST /api/v1/training/shift-reports/drafts/submit-all` now correctly scopes to the current officer's drafts only
- **Enrollment ID validation**: Draft-to-submitted transition validates that the trainee still has an active enrollment before crediting program progress
- **Draft regression guard**: Prevents re-creation of draft reports for shifts that already have submitted or reviewed reports
- **Print button fix**: Restored broken print functionality on shift report cards in ShiftReportsTab
- **Crew loading fix**: Fixed crew members not loading in shift completion report form when navigating directly to a shift

---

## Pages

| URL                                         | Page                                    | Permission                                                                |
| ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `/scheduling`                               | Scheduling Hub                          | Authenticated                                                             |
| `/inventory/admin/checklists/supply`        | Expiring on Apparatus (supply worklist) | any of `scheduling.manage`, `inventory.check_view`, `inventory.manage`    |
| `/inventory/checklists/apparatus-inventory` | Apparatus Inventory _(2026-08-10)_      | any of `inventory.check_submit`, `inventory.check_view`, `inventory.view` |

### Scheduling Tabs

| Tab         | Description                                     | Admin Only |
| ----------- | ----------------------------------------------- | ---------- |
| Schedule    | Calendar view of shifts                         | No         |
| My Shifts   | Personal shifts, confirm/decline, swap/time-off | No         |
| Open Shifts | Browse and sign up for available shifts         | No         |
| Requests    | Swap and time-off request management            | No         |
| Templates   | Shift template and pattern management           | Yes        |
| Reports     | Hours, coverage, call volume, availability      | Yes        |
| Settings    | Scheduling configuration                        | Yes        |

---

## API Endpoints

```
GET    /api/v1/scheduling/shifts             # List shifts
POST   /api/v1/scheduling/shifts             # Create shift
GET    /api/v1/scheduling/shifts/{id}        # Get shift details
POST   /api/v1/scheduling/shifts/{id}/signup # Sign up for shift
POST   /api/v1/scheduling/shifts/{id}/withdraw # Withdraw from shift
POST   /api/v1/scheduling/shifts/{id}/assignments # Assign member
GET    /api/v1/scheduling/templates          # List templates
POST   /api/v1/scheduling/templates          # Create template
POST   /api/v1/scheduling/patterns           # Create shift pattern
POST   /api/v1/scheduling/swap-requests      # Request swap
POST   /api/v1/scheduling/time-off-requests  # Request time off
GET    /api/v1/scheduling/reports/*           # Scheduling reports
GET    /api/v1/scheduling/apparatus          # List basic apparatus
GET    /api/v1/scheduling/shifts/{id}/unavailable-members  # Unavailable user IDs for assignment filtering
GET    /api/v1/scheduling/my-attendance-history            # My attendance history (optional start_date/end_date, embeds shift date/time) (2026-05-29)
```

### Shift Close-Out Endpoints _(2026-08-19)_

```
GET    /api/v1/scheduling/shifts/{id}/closeout              # Wizard state + resume point
PATCH  /api/v1/scheduling/shifts/{id}/closeout/attendance   # Step 1 — who was on, and when
PATCH  /api/v1/scheduling/shifts/{id}/closeout/calls        # Step 2 — how many calls
POST   /api/v1/scheduling/shifts/{id}/finalize              # Step 3 — confirm and close
```

All four require `scheduling.manage` **or** being the shift's own officer.

`POST …/finalize` accepts `reported_call_count`, `reported_call_types`,
`member_call_counts`, `attach_call_ids`, `manual_hours`,
`override_incomplete_checks` + `override_reason`, and `pass_down_notes`.

`attach_call_ids` claims a call another unit already logged, and is what keeps
a single incident counted once for the department when two units roll. It has
**no UI yet** — `attachable_calls` on the close-out GET is served empty on
purpose, and the field stays on the response so the contract does not change
when the picker lands.

### Equipment-Check Supply Endpoints _(2026-08-10)_

Everything below lives under `/api/v1/equipment-checks`. Reads accept
`inventory.check_view` / `inventory.view`. Writes are split by intent
_(tightened 2026-08-11)_:

- **Reporting what you just used** (`POST /items/{id}/used`, and deployed-lot
  quantity updates) accepts `inventory.check_submit` — the default member
  position — as well as `inventory.check_manage` / `inventory.manage`.
  Recording consumption is crew work; gating it behind a manage permission is
  what leaves the gap for the next morning's check to find.
- **Corrections of record** now require `inventory.check_manage` or
  `inventory.manage` only: withdrawing a restock report
  (`DELETE /items/{id}/used`), swapping a ready-stock lot onto the apparatus
  (`POST /items/{id}/swap`), and editing a deployed lot's identity fields
  (`lot_number`, `expiration_date`) — a submit-only member changing those on a
  deployed lot gets a 403, though quantity edits still go through.

```
GET    /supply/expiring-items?days_ahead=30              # The supply worklist: expiring, expired,
                                                         #   short or reported-used positions, with
                                                         #   the ready stock behind each
GET    /supply/item-deployments/{inventory_item_id}      # Reverse lookup: which trucks carry this item
GET    /apparatus/{apparatus_id}/inventory               # Standing view of one truck, outside any check

POST   /items/{template_item_id}/used                    # Report used/pulled — raises a restock report
DELETE /items/{template_item_id}/used                    # Withdraw the report (also clears reporter + note)
PUT    /items/{template_item_id}/quantity                # Recount; reconciles against the deployed lots
POST   /items/{template_item_id}/swap                    # Move a ready lot onto the truck

GET    /items/{template_item_id}/deployed-lots           # Lots aboard, soonest-to-expire first
PUT    /items/{template_item_id}/deployed-lots/{lot_id}  # Correct one lot: count + number + date together

GET    /templates/{template_id}/inventory-matches        # Propose a catalog item per unlinked position
POST   /templates/{template_id}/inventory-links          # Apply a reviewed set of links
```

---

## Recent Improvements (2026-03-02)

### Component Decomposition & Architecture

- **ShiftSettingsPanel decomposed**: Split from an 800+ line component into 6 focused card components: `ApparatusTypeDefaultsCard`, `DepartmentDefaultsCard`, `PositionNamesCard`, `ResourceTypeDefaultsCard`, `TemplatesOverviewCard`, `PositionListEditor`
- **Dedicated types**: New `shiftSettings.ts` type file for scheduling configuration types
- **Route module extraction**: Scheduling routes defined in `modules/scheduling/routes.tsx` with `lazyWithRetry()` for chunk-loading resilience
- **Type safety**: Full TypeScript typing added to scheduling service API

### Shift Editing & Position Changes (2026-03-01)

- **Expanded shift editing**: Officers can edit shift times, apparatus assignment, color, notes, and custom creation times directly from the shift detail panel
- **Inline position change UI**: Change member position assignments (Officer, Driver, Firefighter, etc.) directly on shift cards without opening a separate modal

---

## Improvements (2026-02-28)

### Architecture Refactor

- **Modular architecture**: Scheduling refactored from a monolithic 1,200-line page into a proper module structure under `frontend/src/modules/scheduling/`
- **Dedicated Zustand store** (`schedulingStore.ts`): Centralized state management for shifts, templates, patterns, members, and apparatus
- **Dedicated API service** (`modules/scheduling/services/api.ts`): All scheduling API calls moved from the global service into a module-scoped client using `createApiClient()`
- **ShiftSettingsPanel**: New scheduling configuration panel for notification preferences and shift rules
- **SchedulingNotificationsPanel**: Notification management for shift reminders and scheduling alerts
- **InlineConfirmAction component**: New reusable UX component for inline confirmation actions, with tests
- **Scheduling store tests**: Unit tests for store state and async actions

### Features & Fixes

- **Fire department shift pattern presets**: Built-in patterns (24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB) plus custom pattern builder with 30-day preview
- **Vehicle linking on templates**: Shift templates can be linked to actual department vehicles from the Apparatus module
- **Auto-default shift officer**: Assigning the "Officer" position automatically sets that member as the shift officer
- **Dashboard shift split**: Dashboard now shows "My Upcoming Shifts" and "Open Shifts" as separate sections
- **Scheduling module hardening**: Type safety, error sanitization, input validation, and conflict detection
- **Shift signup error fix**: Error messages from failed signups now correctly display server-provided details
- **Mobile responsiveness**: Scheduling reports and calendar views improved for small screens

### Previous Improvements (2026-02-27)

- **Shift conflict detection**: Backend prevents duplicate assignment and overlapping time conflicts with `UniqueConstraint(shift_id, user_id)`
- **Data enrichment**: All shift responses now populate `shift_officer_name`, `attendee_count`, `user_name` on assignments, and embedded shift data on `my-assignments`
- **Pattern weekday fix**: Weekly patterns now correctly map JS weekday convention (0=Sun) to Python convention
- **Route ordering**: `/shifts/open` placed before `/shifts/{shift_id}` to prevent route shadowing
- **Dashboard fix**: Shows all organization shifts instead of only user-assigned shifts
- **Time string handling**: `formatTime()` handles bare time strings from backend
- **EMS renamed to EMT**: Position label updated across all files

---

## Recent Improvements (2026-03-24)

### Bulk Actions, Staffing Visualization & Shift Notifications

- **Bulk confirm/decline**: Checkboxes on pending shift cards with "Select All", "Confirm All", "Decline All" buttons. Optimistic UI with rollback on failure
- **Inline approve/deny on Requests**: Direct "Approve"/"Deny" buttons on swap and time-off request cards without modal
- **Staffing status visualization**: Green CheckCircle2 on fully staffed shift cards. Staffing ratio ("4/4") in crew info box. Green/amber color tints override template colors
- **Position-first assignment flow**: Position dropdown first in crew board, "Assign" button on open slots, "Fill All Open" bulk assignment
- **Unavailable member filtering**: New `GET /scheduling/shifts/{id}/unavailable-members` endpoint. Members on leave, with time-off, or already assigned removed from dropdowns
- **Required/Optional position toggle**: Template positions changed from `string[]` to `{position, required}[]`. Violet badge for required, muted for optional
- **Shift assignment notifications**: In-app + optional email on member assignment. Settings in Scheduling Notifications Panel
- **Start-of-shift reminders**: Scheduled task (30-min interval) with configurable lookahead. Includes equipment checklist list. Settings: `org.settings.shift_reminders`
- **Selected shift highlight**: Violet ring on current shift across all calendar views
- **Collapsible shift creation**: Start/End Date first; additional options behind disclosure
- **Searchable template dropdown**: Search input for >5 templates, filters by name/apparatus/category
- **Equipment check inline status**: Badge counts and action hints on shift detail
- **WCAG AA text contrast**: Shift card colors pass 4.5:1 contrast via `colorContrast.ts` utility
- **Mobile touch targets**: 44px minimum on action buttons (WCAG standard)

### Bug Fixes (2026-03-24)

- **Shift overlap false positives**: Open-ended shifts restricted to same `shift_date`
- **UTC in notifications**: Assignment/reminder times now display in org timezone
- **Shift color parsing**: Extracts hour from time portion, not full ISO string
- **Notes 422 error**: Empty notes coerced to `undefined` via `||`
- **Pattern generation 422**: Removed redundant `pattern_id` from request body
- **Member hours report**: Queries `ShiftAssignment` instead of `ShiftAttendance`; added `first_name`/`last_name`
- **Dark mode contrast**: Added `dark:` variants on all interactive elements

### Edge Cases (2026-03-24)

| Scenario                               | Behavior                                          |
| -------------------------------------- | ------------------------------------------------- |
| Bulk confirm with API failure          | Optimistic UI reverts; toast shows error          |
| Template with bare string positions    | Defaults to `required=true` (backward-compatible) |
| Open-ended shift on different date     | No false overlap; restricted to same date         |
| Reminder for already-started shift     | Skipped                                           |
| Member on leave in assignment dropdown | Filtered out                                      |
| Dark mode with light template color    | Text auto-adjusted for WCAG AA contrast           |

---

## Recent Improvements (2026-03-23)

### Permission Fixes & Calls/Incidents Cleanup

- **Shift assignment permission fix**: `ShiftDetailPanel` now correctly checks `scheduling.assign` (not `scheduling.manage`) for assignment-related UI — assign members, edit positions, remove assignments, edit notes. `canManage` retained for shift CRUD (edit/delete shift)
- **Self-signup visibility fix**: Non-apparatus self-signup form is no longer hidden behind a permission gate, matching the backend's open signup policy
- **OpenShiftsTab fallback guard**: Direct-assignment fallback guarded behind `canAssign` so members without the permission get a clear signup error instead of opaque 403
- **Calls/Incidents section removed**: Placeholder "Calls will appear here once the shift is underway" section removed from `ShiftDetailPanel` — no CAD integration exists to populate it. Frontend `ShiftCall` types and API methods cleaned up. Backend endpoints retained for future ePCR/NEMSIS integration

### Edge Cases (2026-03-23)

| Scenario                                                 | Behavior                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| User has `scheduling.assign` but not `scheduling.manage` | Can assign members but cannot edit/delete shifts                                        |
| User has `scheduling.manage` but not `scheduling.assign` | Can edit/delete shifts but cannot directly assign members                               |
| Self-signup on non-apparatus shifts                      | Available to all authenticated users, no permission required                            |
| Calls/Incidents API endpoints                            | Still functional at `POST /api/v1/scheduling/shifts/{id}/calls` for programmatic access |

---

## Recent Improvements (2026-03-19)

### Position Eligibility, Admin Sub-Pages & Timezone Fixes

- **Shift position eligibility system**: Operational ranks now define `eligible_positions` — a list of shift positions each rank is qualified for. Dashboard signup validates against eligibility. Existing ranks backfilled via migration
- **Rank eligible positions UI redesign**: Settings page shows a clear matrix of ranks × positions with toggle controls
- **Scheduling admin sub-pages**: Admin tabs extracted into dedicated routed pages: `/scheduling/templates`, `/scheduling/patterns`, `/scheduling/reports`, `/scheduling/settings` with back navigation and `ProtectedRoute` gating
- **Shift settings tabbed sub-navigation**: Settings page reorganized into tabbed sections
- **Structured position slots**: Shifts define required and optional position slots with decline notifications
- **Open slot visibility**: Declined or removed members reveal open slots for re-assignment
- **Position editing in shift detail**: Officers edit position assignments directly in the shift detail edit form
- **Dashboard shift display fixes**: No longer shows shifts user already signed up for; hides declined/cancelled shifts from "My Upcoming Shifts"; fixes 422 error from invalid `general` position on signup
- **Shift signup re-enrollment**: Members who previously cancelled can re-sign up for the same shift
- **Attendee count fix**: Cancelled and no-show assignments no longer inflate the displayed count
- **Shift timezone fixes**: Fixed naive local times sent as UTC when creating shifts; fixed template generation ignoring org timezone; fixed naive datetime construction across 7 backend services
- **UTC response schema refactor**: `UTCResponseBase` base class stamps naive datetimes with UTC timezone markers in all scheduling response schemas
- **Equipment check system**: Full-stack vehicle and equipment inspection system (see [Apparatus Module](Module-Apparatus#equipment-check-system-2026-03-19))

### New Pages (2026-03-19)

| URL                                                 | Page                             | Permission               |
| --------------------------------------------------- | -------------------------------- | ------------------------ |
| `/scheduling/templates`                             | Scheduling Templates             | `scheduling.manage`      |
| `/scheduling/patterns`                              | Scheduling Patterns              | `scheduling.manage`      |
| `/scheduling/reports`                               | Scheduling Reports               | `scheduling.manage`      |
| `/scheduling/settings`                              | Scheduling Settings              | `scheduling.manage`      |
| `/inventory/admin/checklists/templates/new`         | Equipment Check Template Builder | `inventory.check_manage` |
| `/inventory/admin/checklists/templates/:templateId` | Edit Equipment Check Template    | `inventory.check_manage` |
| `/inventory/admin/checklists/reports`               | Equipment Check Reports          | `inventory.check_view`   |

### Data Model Changes (2026-03-19)

| Table               | Column                                | Description                                |
| ------------------- | ------------------------------------- | ------------------------------------------ |
| `operational_ranks` | `eligible_positions` (JSON)           | Shift positions this rank is qualified for |
| `shift_assignments` | `position_slot_id` (String, nullable) | Links to a structured position slot        |

### Edge Cases (2026-03-19)

| Scenario                           | Behavior                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Ranks with no `eligible_positions` | Default to all positions being eligible (backward-compatible)               |
| Dashboard signup button            | Only appears for shifts with open positions the member's rank qualifies for |
| Previously cancelled signup        | Cleaned up before re-enrollment to avoid constraint violations              |
| Shift create from scheduling page  | Converts local times to UTC using org timezone before API call              |
| Template-generated shifts          | Inherit timezone-correct start/end times                                    |
| Declined assignments               | Create open slots visible to other members                                  |

---

## Recent Improvements (2026-03-15)

### Template Positions & Timezone Fixes

- **Template positions carry to crew roster**: Shift templates with defined `positions` and `min_staffing` now persist these values to created shifts via new `positions` (JSON) and `min_staffing` (Integer) columns on the `shifts` table. Both direct creation and pattern-based generation pass template staffing requirements through. ShiftDetailPanel falls back to shift-level positions when apparatus has none defined
- **Shift timezone display fix**: `ShiftReportsTab` was using UTC date (`toISOString()`) instead of local timezone; now uses `getTodayLocalDate(tz)`. `ShiftDetailPanel` edit form was extracting time from the UTC ISO string instead of converting to local timezone via `Intl.DateTimeFormat`
- **`toTimeValue` local timezone fix**: The function was extracting `HH:MM` by string-splitting the ISO datetime on `'T'`, returning the UTC time portion. For a shift starting at 2:30 PM Eastern (18:30 UTC), the edit form showed 18:30 instead of 14:30. Now uses `Intl.DateTimeFormat` with the user's timezone

### Edge Cases

| Scenario                            | Behavior                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Shifts created before migration     | `positions` and `min_staffing` are `NULL`; UI falls back to apparatus-level positions   |
| `toTimeValue` with invalid datetime | Returns empty string instead of crashing                                                |
| Template edits after shift creation | Existing shifts retain original positions; only newly created shifts get updated values |

---

## Recent Improvements (2026-03-22)

### Permission Fixes, Shift Signup & Camera Scanning

- **Shift assignment permission fix**: Shift assignment UI was gated by `scheduling.manage_assignments` instead of the broader `scheduling.manage` — users with manage permission can now assign members
- **Self-signup visibility fix**: Open Shifts tab fallback permission and self-signup button visibility corrected for non-admin members
- **Calls/Incidents section removed**: Removed placeholder Calls/Incidents section from shift detail panel (not yet implemented)
- **Dashboard shift cleanup**: "My Upcoming Shifts" hides declined and cancelled assignments
- **Position editing in shift detail**: Officers edit position assignments directly from the shift detail edit form
- **Desktop camera scanning**: Camera-based QR/barcode scanning now works on desktop via shared `useHtml5Scanner` hook with user-facing camera fallback
- **Scheduling permission cleanup**: Removed redundant permission checks and narrowed fallback scope in OpenShiftsTab and ShiftDetailPanel

### Edge Cases (2026-03-22)

| Scenario                                                              | Behavior                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| User with `scheduling.manage` but not `scheduling.manage_assignments` | Can now assign members (permission broadened)                          |
| Declined shift in "My Upcoming Shifts"                                | Filtered from dashboard display                                        |
| Desktop with only user-facing camera                                  | Falls back automatically for scanning                                  |
| Member re-signing up after cancellation                               | Previous cancelled assignment cleaned up to avoid constraint violation |

---

---

## Notification Deep-Linking & Scheduled Tasks (2026-03-26)

- **Scheduling page `?tab=` deep-linking**: SchedulingPage accepts `?tab=schedule|my-shifts|open-shifts|requests|equipment-checks` query parameter for direct navigation to a specific tab from notifications and external links
- **Shift notification deep-link**: Shift assignment and reminder notifications link directly to the scheduling page with the shift pre-selected
- **In-process scheduled task runner**: Backend runs shift reminders, notification cleanup, and periodic tasks via a built-in asyncio task runner in `main.py` — no external cron required
- **Start-of-shift checklist CTA**: Notification cards show "Start Checklist" during the shift window or "View Shift" outside it, with deep-link to the Equipment Checks tab

### Standalone Equipment Checks (2026-03-25)

- **Equipment checks without active shift**: Members can perform ad-hoc equipment checks on any apparatus without being on an active shift
- **Flat scrollable check form**: Check form redesigned from tabbed compartments to a single scrollable view with inline compartment headers
- **Section headers in templates**: Template items support `is_header: true` for visual grouping labels that don't participate in pass/fail scoring
- **Text check type**: Read-only statement display for safety reminders and instructions within checklists
- **Critical minimum quantity**: Warning threshold below the required minimum; items below this are flagged as critical
- **Template clone fix**: `is_header` and `critical_minimum_quantity` fields now preserved during template cloning

### EVOC Certification Integration (2026-03-24)

- **EVOC certification levels**: EVOC levels (Basic, Intermediate, Advanced) tracked per member and validated against apparatus requirements for driver/operator position assignments
- **Required EVOC level on apparatus**: Each apparatus can specify a minimum EVOC level for operators

---

## Bug Fixes (2026-03-25)

| Issue                                                        | Fix                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| Apparatus type/status badges showing icon names as text      | Fixed to render actual Lucide icon components                  |
| `navigate(-1)` causing unexpected navigation from deep links | Replaced with hardcoded parent page paths and breadcrumbs      |
| Chrome ignoring custom label page sizes                      | Switched to iframe-based printing with top-level `@page` rules |
| App crash when MySQL not ready at startup                    | Added retry with exponential backoff on migration check        |
| Alembic multiple migration heads                             | Merged divergent branches into single linear chain             |

---

## Shift Reports Settings & Form Customization (2026-04-04)

### Shift Reports Settings Panel

A new **Shift Reports** sub-tab within Scheduling Settings provides centralized configuration for the shift completion report workflow, including checklist timing, post-shift validation, form section toggles, apparatus-specific skills/tasks, and rating scale customization.

**Settings stored in `org.settings["shift_reports"]`:**

| Setting                                         | Default | Description                                                                                                                                           |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checklist_timing.start_of_shift_enabled`       | `true`  | Start-of-shift equipment checklists active                                                                                                            |
| `checklist_timing.end_of_shift_enabled`         | `true`  | End-of-shift equipment checklists active                                                                                                              |
| `checklist_timing.checkin_opens_hours_before`   | `2`     | _(2026-08-11)_ How many hours before shift start the check-in link opens                                                                              |
| `checklist_timing.checkin_closes_hours_after`   | `12`    | _(2026-08-11)_ How many hours after shift end check-in still works — a link to a shift that ended last week is refused instead of stamping an arrival |
| `post_shift_validation.enabled`                 | `true`  | Post-shift validation reminders active                                                                                                                |
| `post_shift_validation.require_officer_report`  | `false` | Mandatory shift completion report per shift                                                                                                           |
| `post_shift_validation.validation_window_hours` | `2`     | Hours after shift end for validation reminders                                                                                                        |

### Report Form Section Toggles

Controls which optional sections appear on the shift completion report form (stored on `training_module_configs`):

| Toggle                            | Default | Controls                     |
| --------------------------------- | ------- | ---------------------------- |
| `form_show_performance_rating`    | `true`  | Rating stars/scale           |
| `form_show_areas_of_strength`     | `true`  | Strengths text field         |
| `form_show_areas_for_improvement` | `true`  | Improvement areas text field |
| `form_show_officer_narrative`     | `true`  | Free-form officer assessment |
| `form_show_skills_observed`       | `true`  | Structured skills checklist  |
| `form_show_tasks_performed`       | `true`  | Structured tasks list        |
| `form_show_call_types`            | `true`  | Call type selection          |

These toggles are **separate** from the existing `show_*` visibility columns, which control what trainees see after submission.

### Per-Apparatus-Type Skills and Tasks

New JSON columns on `training_module_configs` map apparatus types to specific skills and tasks:

- **`apparatus_type_skills`** — e.g., `{"engine": ["Pump operations", "Hose deployment"], "ladder": ["Aerial operations", "Ventilation"]}`
- **`apparatus_type_tasks`** — e.g., `{"engine": ["Pump test", "Hose load inventory"], "ladder": ["Aerial extension test"]}`

When filing a report linked to a shift with an assigned apparatus, the form auto-populates the skills and tasks checklist from the apparatus type mapping. Falls back to org-wide defaults when no type-specific mapping exists.

### Rating Scale Customization

| Setting               | Default              | Description                                                                  |
| --------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `rating_label`        | "Performance Rating" | Custom label for the rating input                                            |
| `rating_scale_type`   | "stars"              | "stars" or "descriptive"                                                     |
| `rating_scale_labels` | `null`               | Custom labels per level (e.g., `{1: "Needs Improvement", 5: "Exceptional"}`) |

### Save as Draft

Officers can save incomplete reports as drafts. Drafts do not trigger training
pipeline progress — and _(2026-08-11/12)_ neither does `pending_review`:
credit toward training requirements is released only when a report reaches
`approved`, so a report awaiting second review cannot credit a trainee early
or credit twice. Trainees also cannot read a report before it is approved,
even when the optional second-review workflow is disabled.

### Auto-Filter Trainee List

When a shift report is linked to a specific shift, the trainee dropdown filters to show only members assigned to that shift. Ad-hoc reports (no shift linked) show the full member list.

### Bug Fixes (2026-04-04)

| Issue                                          | Fix                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Standalone checklist submission failing        | Made `shift_id` nullable in `shift_equipment_checks` for ad-hoc checks                  |
| Equipment check empty templates                | Return "No items to check" instead of empty form                                        |
| Equipment check duplicate submissions          | Added composite unique constraint on shift + apparatus + timing                         |
| Equipment check status logic                   | Corrected pass/fail computation for mixed check types                                   |
| Shift report with assignment but no attendance | Gracefully handles missing attendance; allows manual hour entry                         |
| Report shift_date mismatch                     | Validates report date matches linked shift's actual date                                |
| Pipeline enrollment field name                 | Fixed incorrect field reference causing 500 errors                                      |
| Requirement progress started_at                | Added missing column referenced by training program service                             |
| NotificationLog metadata attribute             | Renamed from reserved `metadata` to `notification_metadata`                             |
| Post-shift validation notification UX          | Fixed "Start Checklist" / "View Shift" button logic                                     |
| Notification deep-linking                      | Shift check notifications now link to checklist page                                    |
| Equipment check query performance              | Added composite indexes on `(shift_id, template_id)` and `(check_id, template_item_id)` |

### Component Architecture (2026-04-03)

ShiftTemplatesPage decomposed into focused components:

- `TemplateFormModal` — Create/edit shift template
- `PatternFormModal` — Create/edit shift pattern
- `GenerateShiftsModal` — Bulk generate shifts from pattern
- `shiftTemplateTypes.ts` — Shared TypeScript types for template/pattern forms

### Edge Cases (2026-04-04)

| Scenario                              | Behavior                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| All form sections toggled off         | Core fields (trainee, date, hours, calls) remain; form submittable |
| Apparatus type with no mapped skills  | Falls back to org-wide defaults; empty if none configured          |
| Draft saved with missing fields       | Validation deferred until final submission                         |
| Standalone equipment check (no shift) | Saved with `shift_id=NULL`; not linked to shift finalization       |
| Descriptive rating with no labels     | Falls back to numeric display (1-5)                                |
| Duplicate equipment check             | Blocked by composite constraint; descriptive error returned        |

---

## Skill Scoring, Batch Review & Security Hardening (2026-04-07)

### 1-5 Skill Scoring

Officers can now assign a 1-5 numeric score to each observed skill on shift completion reports. Scores flow through to `SkillCheckoff` records and competency score history. Score labels: 1=Needs work, 2=Developing, 3=Competent, 4=Proficient, 5=Excellent. Violet-themed score buttons across both `ShiftReportPage` and `ShiftReportsTab`.

### Batch Review

New batch review workflow for shift reports:

- Checkboxes appear on report cards in the **Pending Review** and **Flagged** views
- Select-all toggle to check/uncheck all reports
- "Approve Selected" and "Flag Selected" action buttons
- Backend: `POST /api/v1/training/shift-reports/batch-review` (up to 100 reports per batch)
- Returns `{reviewed, failed}` counts for feedback

### Flagged Reports

- New **Flagged** tab in ShiftReportsTab for reports flagged by reviewers
- `GET /api/v1/training/shift-reports/flagged` endpoint
- Re-review capability: flagged reports can be approved from this view

### Trainee & Officer Names

Report cards now show trainee and officer names (resolved from `User` relationships). Cards display "Trainee Name — Date" in headers. Review modal shows shift date alongside names.

### Report Content in Review Modal

Review modal renders complete report content (hours, calls, rating, strengths, improvements, narrative, skills with scores, tasks) for reviewer context.

### Skill Linkage in Apparatus Settings

`ShiftReportsSettingsPanel` shows green/amber tags for each apparatus-type skill:

- **Green**: Matches a `SkillEvaluation` record (tracks competency)
- **Amber**: No match (observed but not formally tracked)

Powered by `GET /api/v1/training/module-config/skill-names`.

### Security Fixes

- **Authorization bypass** on `GET /shift-reports/{report_id}` fixed — now requires trainee, officer, or `training.manage` permission
- **Audit logging** added to all shift report endpoints: `shift_report_created`, `shift_report_updated`, `shift_report_reviewed`, `shift_report_acknowledged`, `shift_reports_bulk_submitted`

### Bug Fixes (2026-04-07)

| Issue                                        | Fix                                                   |
| -------------------------------------------- | ----------------------------------------------------- |
| Decimal TypeError in weekly/monthly calendar | MySQL `SUM()` returns `Decimal`; wrapped in `float()` |
| `??` → `\|\|` for optional fields            | 35 instances in prospective-members and apparatus     |
| `shift_date` type mismatch                   | Changed from optional to required in TS types         |
| Unused `LogOut` import                       | Removed from `MyShiftsTab`                            |
| Numeric column alignment                     | Center-aligned trainee summary table columns          |

### Edge Cases (2026-04-07)

| Scenario                               | Behavior                                                |
| -------------------------------------- | ------------------------------------------------------- |
| Skill score outside 1-5                | 422 error via Pydantic `Field(ge=1, le=5)`              |
| Batch review >100 IDs                  | Rejected by `max_length=100`                            |
| Batch review with invalid IDs          | Valid reports processed; failed count returned          |
| Flagged report re-approved             | Moves to approved; deferred pipeline progress triggered |
| Non-authorized user reads report by ID | 403 Forbidden                                           |
| Trainee reads own report               | Visibility-filtered; `reviewer_notes` stripped          |

---

## Shift Report Creation Redesign — Shift-First Batch Workflow (2026-04-07)

### Overview

The shift report creation flow has been redesigned from a one-report-at-a-time approach to a **shift-first batch workflow**. Officers now select a shift, see all crew members for that shift, and file reports for the entire crew in a single operation.

### How Batch Creation Works

1. Navigate to **Shift Reports > Create Report** (or click "New Report" from the reports tab)
2. Select a **shift** from the dropdown — the system loads all crew members assigned to that shift
3. Fill in **shared data** that applies to all crew members: hours on shift, calls responded, and call types
4. For each **trainee** on the crew, expand their evaluation section to add individual assessment data: performance rating, skills observed (with 1-5 scores), tasks performed, strengths, areas for improvement, and officer narrative
5. Non-trainees appear in the crew list but only receive hours/calls credit — no evaluation section is shown
6. Click **Submit All** — the system creates reports for all crew members in a single batch via `POST /api/v1/shift-completion-reports/batch`
7. The response shows `{created: N, skipped: N}` — reports are skipped if one already exists for that trainee on that shift

### Task Defaults Pre-Population

When a shift is linked to an apparatus type, the **Add Task** dialog pre-populates from the apparatus-type task mapping configured in **Scheduling > Settings > Shift Reports**. After selecting a task, the defaults remain visible for reference. This reduces data entry and ensures consistency across officers.

### Score Label Improvements

The 1-5 skill score buttons now show descriptive label text inline next to the button (not just as tooltips):

- 1 = Needs work
- 2 = Developing
- 3 = Competent
- 4 = Proficient
- 5 = Excellent

This applies to both `ShiftReportPage` and `ShiftReportsTab` and uses a consistent violet color scheme.

### Review Workflow Improvements

- **Require reason when flagging**: Flagging a report now requires entering a reason. The modal blocks submission until text is provided
- **Reviewer name on cards**: Report cards display the reviewer's name alongside the review status badge
- **Flagged report explanation**: Flagged reports show the reviewer's reason and a "Re-review" action in all view modes (not just the Flagged tab)
- **Server error messages**: Toast notifications show actual server error messages instead of generic "Failed to submit" text

### New API Endpoints

| Method | Path                                     | Description                                        |
| ------ | ---------------------------------------- | -------------------------------------------------- |
| `POST` | `/api/v1/shift-completion-reports/batch` | Batch-create shift reports for all crew on a shift |

### Edge Cases (2026-04-07)

| Scenario                                         | Behavior                                                     |
| ------------------------------------------------ | ------------------------------------------------------------ |
| Batch create with mixed trainee/non-trainee crew | Non-trainees get hours/calls credit only; no evaluation data |
| Reports already exist for some crew members      | Existing reports skipped; `skipped` count returned           |
| Shift with no crew assignments                   | Empty crew list shown; submit button disabled                |
| Task defaults after apparatus type change        | Defaults update to match new apparatus type                  |
| Review comment required for flagging             | Modal blocks submission without text                         |

---

## Shift Report Offline Support (2026-04-08)

### Draft Auto-Save

In-progress shift report forms are automatically saved to `localStorage` to prevent data loss from connectivity drops, browser crashes, or accidental navigation. The system stores:

- Shift ID and shift label
- All form field values
- Crew selections and evaluation data
- Crew remarks
- Timestamp of last save

Up to **20 drafts** are retained. When the limit is reached, the oldest draft is evicted (LRU policy).

### Offline Submission Queue

When connectivity is lost during report submission, reports are queued in **IndexedDB** and automatically synced when connectivity returns:

- Uses the same architecture as the equipment check offline queue
- Queue items include the full `BatchShiftReportCreate` payload, queued timestamp, and retry count
- On reconnection, queued reports are submitted in order
- Failed submissions are retried with incrementing retry counter

### Edge Cases

| Scenario                                  | Behavior                                                  |
| ----------------------------------------- | --------------------------------------------------------- |
| Browser closed with unsaved form          | Auto-saved draft restored on next visit                   |
| 21st draft saved                          | Oldest draft evicted to stay within 20 limit              |
| Connectivity restored with queued reports | Queue drains automatically; no duplicate submissions      |
| Queue item fails on retry                 | Retry counter incremented; kept in queue for next attempt |

---

## Shift Report Print Page (2026-04-08)

New route at `/scheduling/shift-reports/print` renders a shift completion report formatted for printing:

- **Letter-size layout** (8.5" × 11") with proper margins and page breaks
- **Department branding**: Organization name and logo in the header
- **Structured sections**: Shift info, trainee/officer names, hours, calls, performance rating, strengths, areas for improvement, narrative, skills with scores, tasks, and reviewer notes (if applicable)
- **Signature lines**: Spaces for officer and trainee signatures at the bottom
- **Auto-print**: Browser print dialog opens automatically after the page loads
- **Access**: "Print" button on report cards in ShiftReportsTab navigates to this page with `?id=<reportId>`

### Edge Cases

| Scenario                                            | Behavior                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| Redacted fields on printed report                   | Shows "[Redacted]" placeholder text                   |
| Print page for report with all sections toggled off | Only core fields (trainee, date, hours, calls) appear |
| Browser blocks auto-print dialog                    | Page remains visible for manual Ctrl+P                |

---

## Equipment Check Improvements (2026-04-07)

### Incomplete Checklist Warning

When a member submits an equipment check with unanswered items, a confirmation dialog warns about the incomplete state. The dialog shows the count of unanswered items and asks the member to confirm they want to submit with gaps.

### Reopening In-Progress Checks

Previously, incomplete checks could not be resumed. Now:

- `PUT /api/v1/equipment-checks/checks/{id}/complete` allows completing remaining items on an incomplete check
- **MyChecklistsPage** shows a "Resume" button alongside the completion percentage for in-progress checks
- The check form loads with previously answered items pre-filled and unanswered items highlighted

### Edge Cases

| Scenario                                       | Behavior                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Resume check after template items were added   | New items appear as unanswered alongside previously answered items |
| Resume check after template items were removed | Orphaned answers preserved but marked as "template item removed"   |
| Submit with 0 items answered                   | Confirmation dialog warns; submission still allowed for edge cases |

---

## Department-Level Shift Report Settings (2026-04-08)

New granular toggles in the **Shift Reports Settings Panel** extend the existing form section toggles with department-level behavioral controls:

- **Editable tag lists**: Skills and tasks per apparatus type are now managed via inline `EditableTagList` components with add/remove buttons, replacing the previous accordion-only display
- **Settings connection**: Settings panel reads from and writes to both `training_module_configs` (form section toggles, apparatus mappings) and `org.settings["shift_reports"]` (checklist timing, post-shift validation)

---

## Supply Tracking: the shelf and the truck as one loop (2026-08-10)

An equipment check is a scheduled, signed pass over a whole apparatus that
produces a report. Until this landed it was also the **only** way anything about
a truck's stock could be written down, so a crew that used the last of something
at 03:00 had nowhere to put that fact — it waited to be found by the next
morning's check, which is exactly the window in which a truck runs a call short.

### What a checklist position now records

| Column                                                       | Meaning                                                                                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required_quantity`                                          | The state-mandated floor. Outranks `expected_quantity` where both exist                                                                                                          |
| `expected_quantity`                                          | The department's own target                                                                                                                                                      |
| `quantity_on_truck`                                          | The **live** count. **NULL means nobody has counted since the item was defined**, and the target stands in — reading NULL as zero would report every untouched truck as stripped |
| `restock_needed` (+ `restock_reported_by` / `_at` / `_note`) | A report raised by whoever used the unit, at the time they used it                                                                                                               |
| `inventory_item_id`                                          | The catalog link everything above hangs off                                                                                                                                      |

### Lots aboard, not one lot per position

`check_item_deployed_lots` holds **one row per lot's presence on one position**.
A position that carries four of something can be carrying units from three lots
with three dates; the single `lot_number` / `expiration_date` pair on the
template item could only ever describe one of them, and the one recorded was
whichever was restocked last. The truck's real exposure — the **soonest date
aboard** — was unrepresentable.

- A position's count is the **sum** of its deployed lots; its expiration is the
  **earliest** of them. The supply worklist, the apparatus view, the check form
  and the item-to-apparatus lookup all read those derivations.
- Lot number and expiration are **snapshotted** onto the deployed row rather than
  read through `inventory_lot_id` (`ON DELETE SET NULL`), because shelf lots get
  consumed and deleted and what is on a truck has to remain answerable after the
  shelf record is gone.
- **Consumption draws first-expiring-first-out.** Undated lots sort last — an
  undated unit is never the one that needs using up.

### Edge cases

| Scenario                                                     | Behavior                                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A crew reports more used than the record held                | Draws what was there. That is a correction to the record, not a negative quantity                                                                                 |
| A position carries units with no lot row, and a lot is added | The existing units are given a row **first**, or the lot sum would become the authority and the uncounted units would vanish                                      |
| A recount lands over the record                              | The surplus goes into an **undated** row — the honest answer to when found stock expires is that nobody knows                                                     |
| A recount lands under the record                             | The difference comes off soonest-expiring-first, like any other consumption                                                                                       |
| A lot is drawn down to zero                                  | The row is removed, so a spent box stops contributing its date to the position's reading                                                                          |
| A restock puts the truck part-way back                       | The report **stays open**. Two of four back is still a truck short two; clearing the flag there would close the gap on paper and leave it open on the apparatus   |
| A counted position is below target with no report behind it  | It reaches the supply worklist anyway, showing the numbers                                                                                                        |
| Shelf stock has expired                                      | Excluded from the on-hand count, flagged in the payload, struck through in the UI and **refused by the swap**                                                     |
| Everything on a position has expired                         | Counted as **expired**, reported apart from _expiring_, and the count renders red — two of two expired units meet the number and are still nothing a crew can use |
| Headers and free-text checklist lines                        | Not shown on the apparatus view. They are scaffolding, not things anyone stocks                                                                                   |
| A template is cloned                                         | The catalog link is carried across. It used to be dropped, silently severing tracking on the copy — which is how a department stands up its second engine         |

### Where the numbers come from on a check form

A quantity item arrives carrying the **running on-truck count**, with the last
check's number as the fallback for items never counted. It arrives with **no
pass/fail status**: a pre-filled number is a starting point to correct, not an
assertion, so the progress counter reflects what was actually looked at. A crew
could otherwise open a sixty-item check, submit it untouched, and file a complete
report against a truck nobody had looked at.

**"Confirm Counts" leads; "Set All to Par" warns.** They are different claims —
"the numbers are right" versus "it is all full" — and only the second used to
have a button. Set All to Par now names the items whose count it would raise; a
compartment already at par is untouched and stays one tap.

---

**See also:** [Events Module](Module-Events) | [Apparatus Module](Module-Apparatus) | [Inventory Module](Module-Inventory)
