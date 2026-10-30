# Scheduling Module

The Scheduling module manages shift scheduling, member self-service signup,
standing shifts, swap and time-off requests, shift templates and patterns,
shift close-out and call counts, shift completion reports, and scheduling
reports.

> **Equipment checklists belong to Inventory.** A checklist is a list of
> inventory items, so the whole feature — authoring it, performing it and
> reporting on it — lives in the
> [Inventory module](Module-Inventory#equipment-checklists) under
> `/inventory/checklists`. **Scheduling hosts none of it.** Members reach their
> checklists from the **My Checklists** nav row.
>
> What Scheduling keeps is the shift's own business: a "Start checklist" link
> on shift check-in and on the shift detail panel, both pointing at
> `/inventory/checklists/my?shift={id}`; the finalize gate on outstanding
> end-of-shift checks; and the picker that lets a shift template **name** the
> checklists its shifts carry, edited under the vehicle picker on the template.
> Sections below that mention checks describe the shift-side behaviour.

---

> **Developers:** routes, API endpoints, the data model and the frontend
> architecture are on [Scheduling Module — Developer Reference](Module-Scheduling-Developer).

## Key Features

- **Shift Board** — a month board with a status chip on every shift, a day
  panel with one-tap claiming, and a phone layout
  ([details](#the-shift-board))
- **Member Self-Service** — sign up for open seats, confirm/decline
  assignments; a signup goes straight onto the roster
- **Built-in and custom seats** — ten built-in positions (officer, driver,
  firefighter, EMT, paramedic, captain, lieutenant, probationary, volunteer,
  other) plus a department's own seat names
- **Position Eligibility** — rank, qualification, training and org-wide rules
  decide which seats a member may take, enforced on self-signup and on officer
  assignment alike
- **Shift Conflict Detection** — prevents duplicate assignment and overlapping
  shift times
- **Shift Officer Assignment** — assigning the "Officer" seat makes that member
  the shift officer, who then holds per-shift authority over the crew
- **Understaffing Indicators** — staffing chips and warnings when a shift is
  below its stated crew size
- **Template Colors** — shifts inherit colour from their template
- **Standing Shifts** — a member's recurring claim on a seat ("every Tuesday
  night"), applied to shifts already on record and to every shift created later
- **Swaps, Trades & Time Off** — open swaps anyone cleared can pick up,
  targeted offers the recipient accepts, two-way exchanges, and time-off
  requests, with separation of duties on review
- **Shift Templates & Patterns** — reusable shift configurations (hours, crew
  seats, vehicle, named checklists) and daily, weekly, platoon and custom
  patterns for bulk generation
- **Shift Pattern Presets** — 24/48, 48/96, Kelly Schedule, California
  3-Platoon, ABCAB, plus a custom pattern builder with a 30-day preview
- **Bulk Shift Generation** — generate shifts from templates and patterns;
  dates already on the schedule are skipped
- **Platoon Rotations (opt-in)** — person-level platoon membership drives
  multi-platoon generation with leave-aware staffing and a hold-over roster
- **Full Shift Lifecycle** — per-shift officer authority, a live readiness
  panel, cancel instead of delete, reopen/unfinalize, crew pass-down notes, and
  optional close-out enforcement
- **Shift Close-Out & Call Counts** — three call-tracking modes, including a
  count-only mode with a three-step close-out wizard for departments without an
  RMS
- **Shift Call / Run Logging** — in detailed mode, officers log each call a crew
  ran: incident type/number, dispatched/on-scene/cleared times,
  cancelled-en-route and medical-refusal flags, responding members, and notes;
  read-only once the shift is finalized
- **Pre-Shift Work** — a member who scans the vehicle before check-in opens can
  time prep work against an upcoming shift, which an officer approves
- **Shifts With Other Departments** — members log time on another
  jurisdiction's apparatus, picked from an officer-kept list
- **Shift Completion Reports** — officers file reports per crew member that
  credit training programs once approved, with 1–5 skill scoring, batch review,
  offline drafts and a print layout
- **Manual Shift Report Page** — `/training/log-shift` (`training.manage`) for
  departments without the Scheduling module: officers enter the shift date,
  times, apparatus, crew and trainee evaluations by hand
- **Personal Calendar Feed** — members subscribe to their shifts in
  Google/Apple Calendar/Outlook via a private ICS link
- **Automation** — rolling auto-generation from patterns, pre-shift reminders,
  end-of-shift member summaries, trainee report follow-up, swap-offer expiry
- **Reports** — member hours, coverage, call volume and shift compliance;
  dashboard staffing widgets for administrators
- **Setup Guide** — the administration hub walks a new department through
  template → pattern → shifts on the calendar
- **Shift History Import** — bring in shifts worked before the department used
  the system, from a CSV; see the [user guide](Scheduling-History-Import)

---

## The Shift Board

The Schedule tab is a **board**: every shift says whether it still needs
anybody, and claiming a seat is one tap.

### What the board shows

Every shift in the month grid carries a **status chip**:

| Chip              | Colour      | Meaning                                |
| ----------------- | ----------- | -------------------------------------- |
| `2 open`          | red / amber | Seats still to fill                    |
| `Full 4/4`        | green       | Staffed                                |
| `You + 2/4`       | blue        | You are on it                          |
| `3 on` (no ratio) | grey        | **The shift never stated a crew size** |

Beside the grid, a day panel shows the crew and **one button that claims the
first open seat the member is cleared for**. Filters dim rather than hide, so
the month keeps its shape. On a phone the board is a bar grid, a day sheet and a
confirmation screen, with 44px touch targets.

Every shift response carries its `roster`, so a month arrives with its seat
occupants in one request: selecting a day costs no network call, and a cell can
be coloured "you are on it". The chip text and what counts as short both come
from `shiftBoard.ts`, which the staffing-gaps view also uses, so the two cannot
disagree.

Each shift on the board carries a details link into the shift detail panel,
where editing, attendance and finalizing live.

### Shifts without a crew size, and closed shifts

A shift naming neither positions nor `min_staffing` has no stated crew size. It
is grey, shows a headcount rather than a ratio, **stays out of the open-seat
count and the URGENT flag**, and can still be joined.

Cancelled, finalized and past shifts read as **closed** and offer nothing:
their empty chairs do not count toward the day's open-seat total or its urgent
flag.

Calendar day labels are calendar dates, not instants, so they are never shifted
into the viewer's timezone. "Today" throughout the module — open shifts, the
calendars, auto-generation, swap-offer expiry, leave cancellations, the
compliance report and the calendar feed — is the **department's** date.

An empty department's board says shifts have not been published yet.

---

## Signing Up and Eligibility

### Signing up

- **A signup goes straight onto the schedule.** It is stored as `assigned`; the
  member confirms it themselves. No officer queue approves signups.
- **Re-signing up after a decline or cancellation works**: the inactive row is
  cleared under the shift lock once the signup passes its checks, so the
  one-row-per-member-per-shift constraint does not refuse it.
- The **Open Shifts** tab lists shifts with a seat the member is cleared for,
  ranked by **actual staffing** (an unfilled required position, or fewer active
  `ASSIGNED`/`CONFIRMED` members than `min_staffing`), capped at 500 candidates
  per window.
- The dashboard's **Next 30 Days** list asks the bulk eligibility endpoint once
  for every open shift it shows and labels a shift the member cannot take **Not
  eligible** instead of offering Sign Up. A failed lookup leaves the button,
  whose tap-time check still refuses.
- **Probationary members are active.** `ACTIVE_ACCOUNT_STATUSES = (ACTIVE,
PROBATIONARY)` backs `User.is_active` and the shift-eligibility check: a
  probationary member signs in, can be assigned, and appears on the platoon
  roster, availability and compliance reports. To keep them off self-signup,
  exclude the membership type under **Settings → Eligibility**.

### Signup window

**Settings → Eligibility → Signup window** sets when a shift stops taking
signups:

| Setting                        | Default | Options                                        |
| ------------------------------ | ------- | ---------------------------------------------- |
| Members can sign up until      | `0`     | the start, or 15/30/60/120 min or 1 day before |
| Officers can add members until | `60`    | the start, or 15/30/60 min, 4 h or 1 day after |

Stored as `signup_closes_minutes_before` and `late_signup_grace_minutes`. A
scheduling admin can always add someone, and any officer can reopen signup on a
single shift (`POST /scheduling/shifts/{id}/late-signup`).

### Who may take which seat

`get_eligible_positions` resolves the seats a member may take:

1. A member whose account is not active is eligible for nothing.
2. A shift marked **open to all members** offers all of its seats (bypassing
   membership type and rank, but not account status).
3. An excluded membership type gets nothing.
4. Otherwise the union of: the rank's `eligible_positions`, positions the
   member is qualified for as of the shift date (`QUALIFICATIONS` in
   `app/services/qualification_service.py`; `officer_in_charge` clears the
   three `OFFICER_SEATS`), positions unlocked by completed training, and
   org-wide open positions. A held RBAC position confers nothing.
5. With a shift given, the result is intersected with the seats that shift
   actually has.

The ranks × positions matrix is edited under **Members Administration →
Settings → Operational Ranks**; **Who Can Fill What**
(`/scheduling/admin/positions`) shows the resulting roster with the source of
each clearance (rank, qualification, training or open).

Driver/operator seats are also checked against the apparatus's required **EVOC
level** (organization-configurable levels, `evoc_levels`; an apparatus names its
minimum via `required_evoc_level_id`). A refusal carries `LB-SCHED-001`, which
the UI keys its "request an exception" offer on. Pattern generation leaves a
driver seat empty rather than seat an unqualified member, and names each such
seat in an 8-second notice.

### Seat capacity

Seat capacity is enforced both for shifts with named positions (seat by seat)
and for shifts with only `min_staffing`. **Position eligibility applies on both
write paths** — a member claiming their own seat and a scheduler seating
somebody else. `require_mutable` and `reject_past` stay tied to self-signup:
a scheduler backfilling last week's roster is doing records work, while being
cleared for a position is a safety question that does not expire with the
shift. Officer assignment is otherwise uncapped deliberately.

### Permissions on the crew board

| Permission          | Allows                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `scheduling.view`   | See shifts, templates, patterns, attendance (baseline member grant)    |
| `scheduling.swap`   | Request swaps and time off, pick up open swaps (baseline member grant) |
| `scheduling.assign` | Assign members, edit positions, remove assignments, see availability   |
| `scheduling.manage` | Create/edit/delete shifts, templates, patterns; everything admin       |
| `scheduling.report` | Scheduling reports                                                     |

The named shift officer can manage that shift's crew, attendance, calls,
close-out and cancellation without a department-wide grant. Self-signup needs
no permission beyond membership.

---

## Standing Shifts

A standing shift is a member's recurring claim on a seat — "every Tuesday
night". It is **stored as a claim** (`standing_shift_claims`), not written once
as a batch of assignments, so giving up a single date leaves the series intact.

It has two readers, and only means anything because both exist:

1. Creating a claim seats the member on matching shifts **already on record**.
2. Creating a **shift** seats every member whose active claim matches it.

Rules:

- **The series is anchored on the shift it was started from.** Biweekly parity
  and the monthly ordinal both come from the first matching weekday after the
  start date.
- **The horizon is the member's to pick**, defaulting to a year out; a series
  spans at most 366 days.
- **A series covering only dates the department has not scheduled yet can be
  saved.** That is the case standing shifts exist for.
- Standing claims go through the **same self-service validation as any other
  sign-up** — eligibility, shift state, past dates and seat counts.
- A claim's `apparatus_id` is verified in-org before it is stored.
- The standing service and shift generation resolve the organization's timezone
  through one shared helper.

---

## Swaps, Trades and Time Off

### Open swaps

An **Open Swap** is offered to every member cleared for the seat: they see it on
the Requests tab under **Open shifts you can pick up**, and the first to pick it
up takes the seat (`POST /scheduling/swap-requests/{id}/pick-up`). Officers do
not approve open swaps, but can deny one.

### Trades a member can complete

`GET /scheduling/shifts/{id}/trade-candidates` lists who could take over the
caller's seat, with everyone who could not accept **already excluded**: on the
shift, on leave, not cleared for the position, or working an abutting tour.
Ranked least-loaded first.

`POST /scheduling/swap-requests/{id}/respond` lets the member who was offered a
seat accept it. This is distinct from manager review, which refuses
participants by design, and is limited to a one-way targeted offer: accepting
is the offerer withdrawing and the accepter signing up, in one step.

Officer review also approves a one-way targeted offer, handing the seat to the
target.

A pending swap is cancelled, and both members told, when the seat it names goes
away — withdrawal, removal, decline, reassignment, shift cancellation, approved
time off, leave, or another approved swap of the same seat.

A **two-way exchange** (a requested shift and a target member) requires each
member to be qualified for the seat they take — the same eligibility rule as
signup. It is refused when submitted, `GET
/scheduling/shifts/{id}/exchange-candidates` lists only qualifying pairs, and
approval re-checks it: a pair that lapsed while pending is refused with
`LB-SCHED-002`, which a duty officer may override (`override_qualification` on
the review, noted on the request and audited). The override waives only that
position check; leave, overlap, capacity and the EVOC driver block still apply.
One-way offers and moves are not gated by this rule.

`swap_offer_expiry` is a daily sweep closing offers still pending the day
before the shift, notifying both members and the duty officer. A pending offer
holds the seat with the member who made it.

Two more rules:

- **Giving up a seat is withheld while your own offer of it stands.**
  Withdrawing is the only move until the recipient answers.
- **A training seat cannot be handed over through a trade.** It carries the
  trainee's program and evaluating officer. Approved time off is rechecked when
  an offer is accepted, not only when candidates were picked.

### Separation of duties

Holding `scheduling.manage` does not let a member review a request they are
**party to**. Both review paths reject it outright:

> Requesters cannot review their own swap requests
> Target participants cannot officer-review swap requests
> Requesters cannot review their own time-off requests

A swap has **two** blocked parties: the member who raised it and the member it
targets. On a small combination department the officer requesting Saturday off
is frequently the same person who holds the permission to approve it — and a
permission grant is not a second person. The rule is enforced in the service
layer, so it applies however the request is reached. Swap requests are
readable only by their participants and by reviewers.

- The rule keys on the **participants**, not the shift's owner. An officer may
  still review a swap between two other members on their own shift.
- **A rejected self-review leaves the request completely pending.** The check
  runs before any field is changed or any assignment cancelled, so somebody else
  can still action it.
- The swap check runs inside the row lock (`with_for_update`), so two reviewers
  racing cannot slip a self-approval through.

### The Requests tab

`GET /scheduling/swap-requests` and `GET /scheduling/time-off` return
`{ items, total, skip, limit }`, and the Requests tab pages through them. There
is **no swap/time-off request export**; anything that needs the whole set pages
through the API, using `total`.

Swap and time-off cards carry inline **Approve** / **Deny** buttons; a
double-clicked Approve is sent once. A filtered empty list says "Showing pending
requests only. Choose All Statuses to see the rest."

Time-off requests validate their date range; approved time off and leave remove
a member from assignment dropdowns
(`GET /scheduling/shifts/{id}/unavailable-members`).

---

## Running a Shift

### The shift detail panel

- **Per-shift officer authority** — the officer named on a shift can manage its
  crew, attendance, calls, close-out and cancellation without a department-wide
  `scheduling.manage`/`assign` grant. Editing or deleting the shift itself
  requires `scheduling.manage`.
- **Readiness panel** — present vs. assigned, staffing vs. target (understaffed
  flag), and outstanding start-of-shift checks _during_ the shift.
- **Crew board** — position dropdown first, an **Assign** button on open slots,
  and **Fill All Open**; members on leave, with time off, or already assigned are
  filtered out. Officers edit times, apparatus, colour, notes and positions from
  the panel.
- **Cancel a shift** — cancels instead of deleting: the record is kept, the crew
  is notified, and the shift drops out of open-shift signup. Finalized shifts
  cannot be cancelled.
- **Reopen a finalized shift** — a permissioned, audit-logged correction path;
  re-finalize when done.
- **Pass-down / handoff** — a note captured at finalize, shown to the next crew
  on the same apparatus.
- **Training-position crew slots** — an officer can mark a seat as a supervised
  training slot linked to the trainee's program and evaluator; finalizing drafts
  a completion report against that program.
- **Writing an apparatus NFC tag** from the panel needs
  `apparatus.manage_nfc_tags`.

### Hold-over roster

The shift detail view shows a **hold-over roster** of available members (same
org, not on leave, not already assigned) with a one-click **Assign**, so a
supervisor can fill a gap or hold a member over. Because it is derived from who
is on approved leave, `GET /scheduling/shifts/{id}` returns `platoon_roster`
only to callers with `scheduling.assign`, `scheduling.manage`, or who are the
shift's own officer. Everyone else receives an empty roster, while every other
detail on the shift remains visible.

### Check-in

Members check in at `/scheduling/checkin?shift={id}` (QR codes print from
`/scheduling/checkin/print`). Check-in opens `checkin_opens_hours_before`
(default 2) hours before the start and closes `checkin_closes_hours_after`
(default 12) hours after the end; those values are edited in Inventory under
**Equipment Checklists → Checklist settings** and stored in
`org.settings["shift_reports"]["checklist_timing"]`.

Early check-out asks first — "Check out early?", **Stay checked in** / **Check
out now** — because a member cannot undo a check-out.

### Close-out rules

**Settings → General → Shift close-out rules** (all off by default except the
call-tracking mode):

| Setting                                           | Default    | Effect                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require_end_of_shift_checks`                     | `false`    | Blocks finalize while end-of-shift equipment checks are outstanding; officers can override with a logged reason                                                                                                                                                                                                |
| `restrict_checkin_to_assigned`                    | `false`    | Only rostered members may check in (open shifts exempt)                                                                                                                                                                                                                                                        |
| `pre_shift_work_enabled`                          | `true`     | Allows [pre-shift work](#pre-shift-work)                                                                                                                                                                                                                                                                       |
| **How calls are recorded** (`call_tracking.mode`) | `detailed` | `detailed` logs individual calls on the shift panel and counts volume from those records; `count_only` swaps the finalize checklist for the three-step wizard and counts calls the officer reports; `off` hides the call log and asks nothing. Calls already recorded stay visible and removable in every mode |

### Pre-shift work

A member who scans the vehicle before check-in opens can time prep work — an
early equipment check, for example — against one of their upcoming shifts. They
start a session (`POST /scheduling/pre-shift-work`) and end it with an optional
note; it then waits for review. `scheduling.manage` or the shift's officer
approves, adjusts or rejects it (a shift officer cannot review their own time),
and approved time counts toward hours. The department-wide queue appears on
**Shift Close-Out**. Turned off with **Allow pre-shift work** under the
close-out rules.

---

## Call Volume Without an RMS

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

Nine are seeded for a department that has not defined its own: Fire, EMS, Motor
Vehicle Accident, Rescue, Hazmat, Service Call, Alarm / Good Intent, Mutual Aid,
Other. A department may configure up to 50, under **Settings → General**.

The **slug** is stored and permanent; the label is display-only and may be
renamed freely. Storing the label instead would orphan every historical call
the first time somebody fixed a typo in settings. Retired types are not offered
for new counts, except on a shift that already has calls against them.

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
apparatus bay resumes where it left off. The server's `shifts.closeout_step`
decides the entry screen — nothing is held only in the browser. Reopening a
finalized shift restarts the wizard at step 1.

**The total on step 2 is derived from the per-type rows and is read-only.**
There is exactly one source for the number; `deriveCallTotal` sums the visible
rows, including the "Not categorised" row.

**Shared calls.** Step 2 lists calls another unit logged while this shift was on
(`attachable_calls`, served for count-only departments on an unfinalized shift).
Ticking one claims it (`attach_call_ids`), so an incident two units rolled on is
one `org_calls` row with two responses and the department counts it once.

**The wizard carries everything the checklist could do** — the end-of-shift
check override (gated on a logged reason, audited) and pass-down notes — so a
count-only department that enforces equipment checks can still close a shift.

### Reading the call volume report

The mode-aware call volume report is the Reports module's `call_volume` report
(`POST /api/v1/reports/generate`). It picks **one** source and never mixes:
count-only departments from the call tables, detailed departments from the
shift completion reports. Reading both and adding them would count every call
twice for a department that has used each mode in turn.

- **Count-only**: the headline is the department's incident count (distinct
  `org_calls` rows). Per-unit runs are listed separately as **Runs by Unit**
  (`by_apparatus_runs`) because they sum past the total whenever two units share
  a call.
- **Detailed**: the headline is labelled **Member-Reported Calls** — it sums
  `calls_responded` across per-member `ShiftCompletionReport` rows, so a shift
  two members reported is counted once for each. It is not an incident count.
- The CSV export uses the same headline label as the screen.
- **A range that predates the current mode** shows a "Part of this range is
  missing" warning: the whole range is read under the current mode, so calls
  recorded before the switch under the other method are not included.
- **Shifts not yet closed out** make the report **Preliminary**, with a count of
  them, because calls are counted at close-out.

`GET /scheduling/reports/call-volume` (the Scheduling Reports page) is a
separate report over detailed-mode shift calls, grouped by day, week or month,
with a type breakdown and average response time.

### Edge cases worth knowing

- **Blank and zero are different answers in the form and the request, but not
  after saving.** The distinction is what lets a correction clear a previously
  entered count; both store no call rows and both read back as `0`. No report
  can tell a quiet tour from an unanswered question.
- **A breakdown shorter than the total is accepted at the API level** — the
  remainder is stored as unclassified. In the wizard an officer records a
  remainder by entering it under "Not categorised"; omitting it records a
  smaller shift.
- **You cannot lower the total below the calls this shift already shares with
  another unit.** The wizard says so and names the number; detaching a shared
  call is an explicit act.
- **Correcting a shift's date or apparatus after close-out moves its calls with
  it.**
- **Only `ASSIGNED` and `CONFIRMED` crew are listed.** Every listed member gets
  the apparatus's full call count by default, so declined, pending and no-show
  members are left off.
- **Assigned members who never checked in are still listed**, with empty times
  to fill in, so the officer can give them hours and credit.
- **A member credited with fewer calls than the apparatus ran gets a count, not
  types.** Which calls they were on is not knowable.
- **100 calls per shift is a hard cap** (`MAX_CALLS_PER_SHIFT`). An officer
  closing out a shift is reporting a tour, not a year.

---

## Shifts With Other Departments

A member who rides a neighbouring jurisdiction's apparatus gets credit for it
from **My Shifts → Hours → Shifts with other departments**, with **Log outside
shift**:

- **Start and End**, with **+12 hours** / **+24 hours** buttons; the server
  derives the date (the start's local date, so a night shift counts on the day
  it began) and the hours. Not in the future, at most 48 hours an entry.
- **Department** and **Apparatus** from a list scheduling officers keep under
  **Settings → Outside Apparatus** (`/scheduling/admin/settings/outside-apparatus`).
  A unit with shifts logged on it cannot be deleted, only turned off; each entry
  keeps the names it was logged under.
- **Counts as soon as it is saved.** An officer rejects one with a reason ("Not
  counted", locked to the member) and can restore it, from **Scheduling Reports
  → Member Hours**, which also has an **Outside Hours** column and an **Outside
  apparatus staffed** per-unit summary.
- Reported **beside** worked hours (`external_*`), but **added into** each
  member's totals on the Shift Compliance report.

Tables `external_agencies`, `external_apparatus` and `external_shift_hours`;
API under `/api/v1/scheduling/external-hours` (see
[API Endpoints](Module-Scheduling-Developer#api-endpoints)). Limits in `docs/KNOWN_LIMITATIONS.md`.

---

## Shift Reports

### The Shift Reports tab

The tab appears when shift reports are enabled for the department.

- A member without `training.manage` sees no toggle — a heading, **Shift
  reports about you**, and an empty state saying when a report appears and what
  it holds. A trainee reads a report only once it is `approved`, with
  `reviewer_notes` and other hidden fields stripped by the visibility settings.
- Officers' views: **About me**, **Written by me**, **Review Queue** and
  **Flagged** (where review is required), **Drafts**; **New report** is a button
  beside the strip.
- With report review switched off, the **Flagged** view stays offered while any
  flagged report exists, so a flagged report is never stranded.
- **Written by me** shows **Your reporting summary** (Reports written, Shift
  hours covered, Calls covered, and **Drafts to finish →** / **Awaiting review
  →** buttons), a **Reports written per month** chart, and **Not acknowledged
  yet** and **Waiting N days** on cards.
- `?view=` is honoured and kept (`?tab=shift-reports&view=create` opens the
  creation form), and `?report=<id>` auto-expands that report — the target of
  shift-report notification links.

### Creating reports: shift-first batch workflow

1. Open **New report** on the Shift Reports tab.
2. Select a **shift** — the crew assigned to it loads.
3. Fill in **shared data** for the whole crew: hours on shift, calls responded,
   call types.
4. For each **trainee**, expand their evaluation: performance rating, skills
   observed (with 1–5 scores), tasks performed, strengths, areas for
   improvement, officer narrative.
5. Non-trainees receive hours/calls credit only — no evaluation section.
6. **Submit All** creates every report in one request
   (`POST /api/v1/training/shift-reports/batch`); the response is
   `{created, skipped}`, skipping a trainee who already has a report for that
   shift.

When a shift has an apparatus, the skills and tasks lists and the **Add Task**
defaults come from the apparatus-type mapping (falling back to org-wide
defaults). An ad-hoc report with no shift shows the full member list; a
shift-linked one shows only that shift's crew. A report's date must match its
linked shift; a crew member with an assignment but no attendance row can be
given hours manually.

### Scoring, review and credit

- **1–5 skill scores** with inline labels: 1 = Needs work, 2 = Developing,
  3 = Competent, 4 = Proficient, 5 = Excellent. Scores flow into
  `SkillCheckoff` records and competency score history; a score outside 1–5 is
  a `422`.
- **Drafts** do not credit training; neither does `pending_review`. Credit
  toward training requirements is released only when a report reaches
  `approved`, so a report awaiting second review cannot credit a trainee early
  or twice. Draft-to-submitted validates that the trainee still has an active
  enrollment, and a draft cannot be re-created for a shift that already has a
  submitted or reviewed report. `POST …/drafts/submit-all` submits only the
  caller's own drafts.
- **Batch review**: checkboxes on the Review Queue and Flagged views, a
  select-all toggle, and **Approve Selected** / **Flag Selected**
  (`POST /api/v1/training/shift-reports/batch-review`, at most 100 reports,
  returning `{reviewed, failed}`).
- **Flagging requires a reason**; flagged reports show the reviewer's comment
  and a **Re-Review Report** action. A re-approved flagged report releases its
  deferred training credit.
- Report cards show trainee, officer and reviewer names; the review modal
  renders the complete report content.
- **Reading a report by id** (`GET /training/shift-reports/{id}`) is limited to
  the trainee, the filing officer and `training.manage`; anyone else gets a
  `404`.
- Report endpoints write audit events (`shift_report_created`,
  `shift_report_updated`, `shift_report_reviewed`,
  `shift_report_acknowledged`, `shift_reports_bulk_submitted`).

### Drafts and offline submission

- In-progress forms are saved to `localStorage` (shift, form values, crew
  selections and evaluations, crew remarks, timestamp). Up to **20 drafts** are
  kept; the oldest is evicted past that.
- A submission made without connectivity is queued in **IndexedDB** with its
  full `BatchShiftReportCreate` payload, a queued timestamp and a retry count,
  and is sent when connectivity returns; a failed retry increments the counter
  and stays queued. Queued reports carry crew rosters and evaluations, so the
  queue is cleared with the rest of a member's local data.

### Print layout

`/scheduling/shift-reports/print?id=<reportId>` renders one report for letter
paper: a **Shift Completion Report** header with the report id, filed date and
review status; member, shift date, hours, calls and call types; rating,
strengths, improvements, narrative, skills with scores and tasks; and signature
lines. The browser print dialog opens automatically after load; the page stays
visible for a manual print if the dialog is blocked. Reached from **Print** on
report cards.

### Shift Reports settings

**Settings → Shift Reports** (`/scheduling/admin/settings/shift-reports`)
configures the report workflow. It reads and writes `training_module_configs`
(form toggles, apparatus mappings, rating scale) and the
`post_shift_validation` half of `org.settings["shift_reports"]`; the endpoint
deep-merges, so `checklist_timing` (edited in Inventory) is left untouched.

| Setting (`org.settings["shift_reports"]`)       | Default | Description                                                                                                           |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `post_shift_validation.enabled`                 | `true`  | Post-shift validation reminders active                                                                                |
| `post_shift_validation.require_officer_report`  | `false` | Tells officers, in the post-shift reminder, that a report is required. **Not in effect yet** — close-out never checks |
| `post_shift_validation.validation_window_hours` | `2`     | Hours after shift end for validation reminders                                                                        |

**Form section toggles** (on `training_module_configs`, all default `true`)
decide which optional sections appear on the report form:
`form_show_performance_rating`, `form_show_areas_of_strength`,
`form_show_areas_for_improvement`, `form_show_officer_narrative`,
`form_show_skills_observed`, `form_show_tasks_performed`,
`form_show_call_types`. They are separate from the `show_*` columns, which
control what trainees see after approval. With every section off, the core
fields (trainee, date, hours, calls) remain and the form is submittable.

**Per-apparatus-type skills and tasks** — `apparatus_type_skills` and
`apparatus_type_tasks` map an apparatus type to lists, e.g.
`{"engine": ["Pump operations", "Hose deployment"]}`, edited as inline tag
lists. Each skill shows green when it matches a `SkillEvaluation` record
(tracked competency) and amber when it does not
(`GET /api/v1/training/module-config/skill-names`).

**Rating scale** — `rating_label` (default "Performance Rating"),
`rating_scale_type` (`stars` or `descriptive`), `rating_scale_labels` (per-level
labels; a descriptive scale with none falls back to 1–5).

**Reviewer role** (`report_review_role`) is shown but **not in effect yet**:
approving a report is gated on `training.manage`.

---

## Platoon Rotations

Departments that staff by **platoon** (rotating A/B/C crews) can build the
schedule from platoon membership instead of assigning each shift by hand. The
feature is **opt-in** and **off by default**.

### Department toggle

`org.settings["scheduling"]["platoons_enabled"]` (default `false`), under
**Settings → Platoons**. When off, no platoon fields, badges or roster appear
and generation ignores platoons.

### Person-level platoon membership

Platoon membership lives on the member: `User.platoon` (nullable). A
firefighter is "on A platoon" as a standing assignment, and the schedule is
derived from it. Members see their platoon on their profile; managers set it
from the member admin UI or in bulk.

### Multi-platoon generation

Each platoon runs the same cycle offset by `i × cycle_length / num_platoons`
days, so the platoons tile to exactly one on-duty platoon per day:

| Rotation      | Cycle | Platoons | Offsets (days) |
| ------------- | ----- | -------- | -------------- |
| 24/48         | 3     | 3        | 0, 1, 2        |
| Kelly (9-day) | 9     | 3        | 0, 3, 6        |
| 48/96         | 6     | 3        | 0, 2, 4        |

- Generated platoon shifts reflect the platoon's **actual makeup**: a member on
  approved leave is omitted, and approving leave **cancels** their conflicting
  generated shifts.
- Only members whose account `is_active` are staffed onto generated shifts, so
  soft-deleted and anonymized members never are.
- The responsible platoon is stored on the shift (`Shift.platoon`).
- A pattern's stored platoon list is unvalidated JSON; the Patterns tab treats a
  malformed value as empty rather than failing.

### Platoons page

**Platoons** (`/scheduling/admin/platoons`, `scheduling.manage`) lists every
platoon and the unassigned bucket with their active members, and bulk-assigns
members to a platoon (or clears it) in one request. Both endpoints require
`scheduling.manage` — the department-wide roster is not readable by members —
and bulk assignment is org-scoped and audited as `platoon_bulk_assigned`.

---

## Notifications and Scheduled Tasks

Scheduled tasks run in the backend's built-in asyncio task runner; no external
cron is required.

| Task                        | Schedule     | What it does                                                                                           |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `shift_reminders`           | every 30 min | Pre-shift reminder to assigned members                                                                 |
| `end_of_shift_summary`      | every 30 min | Each attending active member gets an in-app notice and email with their hours, calls and a report link |
| `trainee_report_escalation` | daily 08:00  | Reminds trainees of approved-but-unacknowledged reports                                                |
| `shift_pattern_generation`  | daily 04:00  | Generates shifts from active patterns for departments with auto-generation on                          |
| `swap_offer_expiry`         | daily        | Closes swap offers still pending the day before the shift                                              |

**Pre-shift reminders** (`org.settings["shift_reminders"]`: `enabled` default
`true`, `lookahead_hours` default `2`, `send_email` default `true`, `cc_emails`)
include the apparatus, the active-member crew roster (member + position, capped
at 8 with a "+N more" overflow), the shift's equipment checklists, and a **Mark
Arrival** link to `/scheduling/checkin?shift=<id>`. Times are shown in the
department's timezone; a shift that has already started is skipped.

**End-of-shift summary** (`org.settings["shift_reports"]["member_summary"]`:
`enabled` default `true`, `lookback_hours` default `4`, `require_finalized`
default `true`). With `require_finalized=false`, the summary goes out for
not-yet-finalized shifts labelled "Preliminary Shift Summary". A member is
stamped as sent only once their email was sent (or when no email can go: no
address, opted out of shift notices, or email off for the department); a failed
send is retried on the next run inside the lookback window and repeats the
in-app notice.

**Trainee follow-up** (`org.settings["shift_reports"]["follow_up"]`: `enabled`
default `true`, `acknowledgment_days` default `7`, `max_reminders` default `3`,
tracked in the report's `review_history`). In-app alerts go to the filing
officer and training officers. A **low-rating alert** goes to training officers
when a report's `performance_rating` is at or below `low_rating_threshold`
(default `2`; `0` disables) or it has non-empty `areas_for_improvement`.

**Settings → Notifications** holds the settings each sender reads:
decline/drop alerts (`org.settings["scheduling"]`), assignment notifications
(`org.settings["scheduling_assignment"]`, in-app plus optional email), shift
reminders, and equipment-check failure alerts.

Notification links open the scheduling page with the shift pre-selected;
`SchedulingPage` accepts `?tab=schedule|my-shifts|open-shifts|requests|shift-reports`.

---

## Member Conveniences and Automation

- **Subscribe to my shifts** — My Shifts → "Subscribe to my shifts" gives each
  member a private calendar URL for Google/Apple Calendar/Outlook
  (`GET /scheduling/calendar-feed`). The link can be reset if it leaks
  (`POST /scheduling/calendar-feed/rotate`).
- **My Shifts** has **Upcoming**, **Past** and **Hours** views and honours
  `?view=past` / `?view=hours`. The past view includes walk-on attendance as
  completed entries; the dashboard Standby card links to it. Pending
  assignments can be confirmed or declined in bulk, with the UI rolling back on
  failure.
- **Overtime advisory** — **Settings → General → Overtime advisory**: an
  optional soft warning when an assignment or signup pushes a member's scheduled
  hours over `max_hours_per_window` within `hours_window_days` (default 7; `0`
  disables).
- **Automatic shift generation** — `auto_generate_enabled` (default `false`)
  and `auto_generate_weeks` (default `4`) keep active patterns generating shifts
  to a rolling horizon.
- **Department Defaults** (default duration, minimum staffing, overtime
  threshold) are stored but marked **Not in effect yet** — no shift, template or
  warning reads them.

---

## Scheduling Administration

`/scheduling/admin` sits in the **Administration** section of the navigation
beside Training Admin and Inventory Admin. `/scheduling` itself is the member's
page; nothing administrative is reached from it.

**One grant runs the whole area**: `scheduling.manage`, on the hub, every page
behind it, and the nav rows. `scheduling.manage` is in
`ADMIN_NAVIGATION_PERMISSIONS`, so a child gate cannot admit anyone its parent
has already turned away. The hub's two Inventory cards (Equipment Checklists,
Checklist Timing) are gated on Inventory's own grants.

### Setup guide

For a department with nothing configured, the hub shows three steps — **Create
a shift template**, **Set up a repeating pattern** _(optional)_, **Put shifts on
the calendar** — ticked off from `active_templates`, `active_patterns` and
`shifts_scheduled` on `GET /scheduling/summary`. It hides once the two required
steps are done and can be dismissed. Empty departments' summaries say there is
nothing to check rather than reporting every shift closed out or fully crewed.

### Shift Planning

One screen with three routed sections — staffing gaps, templates, patterns — in
the order the work happens. The gaps view lists every short shift over a date
range with the assignment on the row. What counts as short comes from
`shiftBoard.ts`, so it cannot disagree with the board; openness is judged for an
officer rather than a member, because an officer can still seat somebody after
member signup closes. Pattern generation reports "No new shifts. Dates already
on the schedule are skipped…" when a re-run creates nothing.

### Shift Close-Out

Lists the shifts that ended and were never closed, oldest first. A shift with no
recorded end is judged against the department's open-ended cushion — the same
number the roster lock uses — so a crew still out is not backlog. The row opens
the department's own close-out: the three-step wizard where the department
records a call count, and the shift's finalize checklist everywhere else. The
pre-shift work review queue is on the same page. A shift officer's own route to
closing their shift goes through the shift panel, not this page.

### Settings

Seven sections, each its own route under `/scheduling/admin/settings/`:
`general`, `apparatus`, `platoons`, `eligibility`, `notifications`,
`shift-reports`, `outside-apparatus`. `/scheduling/admin/settings?tab=<section>`
forwards to the section's route.

### Dashboard staffing widgets

Seven tiles for `scheduling.manage` — Today's Staffing, Future Coverage Gaps,
Open Slots, Pending Changes, Incomplete Closeouts, Workload Balance, Special
Operations — each linking into the schedule already filtered to what it
counted. Each tile keeps its own horizon and filters, stored per member
(`/scheduling/dashboard/widget-preferences`).

`GET /scheduling/dashboard/widgets` bounds its own window: a range that is
inverted, or 93 days or longer, is a `422`. `station_id` and `platoon` are
validated against the organization's own lists, so an unknown value is a `422`
and not an empty result.

---

## Scheduling Reports

**Scheduling Reports** (`/scheduling/admin/reports`; the endpoints need
`scheduling.report`):

- **Member Hours** — hours per member from shift assignments, with the
  **Outside Hours** column, the **Outside apparatus staffed** summary, and
  reject/restore of outside entries.
- **Coverage** — staffing coverage over a range.
- **Call Volume** — detailed-mode shift calls grouped by day/week/month (see
  [Reading the call volume report](#reading-the-call-volume-report)).
- **Shift Compliance** — grades **only shift-credited requirements**: a SHIFTS
  requirement by default, an HOURS requirement only when an officer ticks
  **Shift Credit** on the requirement form (`training_requirements.shift_credited`).
  The summary cards are **Requirement Checks**, **Checks Met** and **Checks Not
  Met**, each counting a member-requirement pair (22 members under three
  requirements read 66). A requirement nobody is held to reads **Not
  applicable**. A requirement scoped by `required_roles` matches the member's
  rank, and one scoped by membership type appears for the members it names.
  Outside-department hours are added into each member's totals.

---

## Shift History Import

`scheduling.manage` users bring past shifts in from a CSV (one row per member
per shift) at `/scheduling/admin/history-import`; the full walkthrough is the
[Shift History Import user guide](Scheduling-History-Import).

- Uploads are drafts (`shift_history_imports`, `shift_history_import_rows`),
  reviewed at `/scheduling/admin/history-import/{importId}`.
- Times are read in a chosen IANA zone; an end at or before the start crosses
  midnight.
- Entries for one member on one unit within 30 minutes of each other are joined
  (`keep_separate` splits them).
- Crews group by unit and day with a confidence score: 90+ matches
  automatically, 60–89 is held for review.
- Exact unit names only; other agencies' units become outside-department hours
  (`ExternalShiftHours`).
- Former members are created **archived** (`archived_at` set) with no password
  or email.
- Commit writes finalized shifts, confirmed assignments and attendance directly
  — no notifications, equipment-check gate or completion-report drafts — and is
  final.
- Member, unit and position decisions persist per department in
  `shift_history_import_mappings` once a commit succeeds.

API under `/api/v1/scheduling/history-import`.

---

## Supply Tracking: the Shelf and the Truck as One Loop

The supply loop behind equipment checklists is part of the Inventory module's
checklist feature; it is described here because shift crews are the ones who
record consumption. An equipment check is a scheduled, signed pass over a whole
apparatus; supply tracking lets a crew that uses the last of something at 03:00
record it at the time instead of leaving it for the next morning's check.

### What a checklist position records

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
with three dates, and the truck's real exposure is the **soonest date aboard**.

- A position's count is the **sum** of its deployed lots; its expiration is the
  **earliest** of them. The supply worklist, the apparatus view, the check form
  and the item-to-apparatus lookup all read those derivations.
- Lot number and expiration are **snapshotted** onto the deployed row rather than
  read through `inventory_lot_id` (`ON DELETE SET NULL`), because shelf lots get
  consumed and deleted and what is on a truck has to remain answerable after the
  shelf record is gone.
- **Consumption draws first-expiring-first-out.** Undated lots sort last — an
  undated unit is never the one that needs using up.

### Who can write what

Reads accept `inventory.check_view` / `inventory.check_submit` /
`inventory.view` (the supply worklist: `inventory.check_view` or
`inventory.manage`; the item-to-apparatus lookup: `inventory.check_view` or
`inventory.view`).

- **Crew work** accepts `inventory.check_submit` (the default member grant) as
  well as `inventory.check_manage` / `inventory.manage`: reporting what was used
  (`POST /items/{id}/used`), recounting (`PUT /items/{id}/quantity`), editing a
  deployed lot's quantity, and swapping a ready-stock lot onto the truck
  (`POST /items/{id}/swap`). The swap takes its lot number and date from the
  org-scoped shelf lot, so a submitter can move real stock but cannot invent
  either; tying a position to a catalog item for the first time through a swap
  needs a manage grant.
- **Corrections of record** require `inventory.check_manage` or
  `inventory.manage`: withdrawing a restock report (`DELETE /items/{id}/used`)
  and editing a deployed lot's identity fields (`lot_number`,
  `expiration_date`). A submit-only member changing those gets a `403`, though
  quantity edits still go through.

### Edge cases

| Scenario                                                     | Behavior                                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A crew reports more used than the record held                | Draws what was there. That is a correction to the record, not a negative quantity                                                                                 |
| A position carries units with no lot row, and a lot is added | The existing units are given a row **first**, or the lot sum would become the authority and the uncounted units would vanish                                      |
| A recount lands over the record                              | The surplus goes into an **undated** row — the honest answer to when found stock expires is that nobody knows                                                     |
| A recount lands under the record                             | The difference comes off soonest-expiring-first, like any other consumption                                                                                       |
| A lot is drawn down to zero                                  | The row is removed, so a spent box stops contributing its date to the position's reading                                                                          |
| A restock puts the truck part-way back                       | The report **stays open**. Two of four back is still a truck short two                                                                                            |
| A counted position is below target with no report behind it  | It reaches the supply worklist anyway, showing the numbers                                                                                                        |
| Shelf stock has expired                                      | Excluded from the on-hand count, flagged in the payload, struck through in the UI and **refused by the swap**                                                     |
| Everything on a position has expired                         | Counted as **expired**, reported apart from _expiring_, and the count renders red — two of two expired units meet the number and are still nothing a crew can use |
| Headers and free-text checklist lines                        | Not shown on the apparatus view. They are scaffolding, not things anyone stocks                                                                                   |
| A template is cloned                                         | The catalog link is carried across, so a department standing up its second engine keeps tracking on the copy                                                      |

### Where the numbers come from on a check form

A quantity item arrives carrying the **running on-truck count**, with the last
check's number as the fallback for items never counted. It arrives with **no
pass/fail status**: a pre-filled number is a starting point to correct, not an
assertion, so the progress counter reflects what was actually looked at, and a
crew cannot submit an untouched sixty-item check as complete.

**"Confirm Counts" leads; "Set All to Par" warns.** They are different claims —
"the numbers are right" versus "it is all full". Set All to Par names the items
whose count it would raise; a compartment already at par is untouched and stays
one tap.

---

## What the 2026-10-24 shifts review changed

Open items that need a schema change or a product decision are in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).

**Seating.** Every seat-placing path now runs `_validate_assignment_candidate`
(eligibility, named-seat cap, duplicate, overlap, leave, time off, driver):
`update_assignment` on a seat change or a revived row, standing claims, offers,
pickups, trades and pattern generation. Seat eligibility is checked on a shift
with no named seats too. An open-to-all shift naming no seats offers the
built-in seats (`_open_to_all_seats`, shared by the single and bulk eligibility
calls). `confirm_assignment` only from assigned/pending; `create_assignment`
on a cancelled or finalized shift needs `scheduling.manage`. The trade picker
considers every current member on an open-to-all shift and matches seat names
case-insensitively. Seat lists in requests are capped at 100 characters per
name.

**Record locks.** On a finalized shift, attendance and calls cannot be added,
edited or removed; a cancelled shift cannot be checked into or finalized.
`add_attendance` locks the shift row and does a locking read for an existing
row (Pitfall #27), so it no longer creates a duplicate that broke the member's
check-out with `MultipleResultsFound`.

**Templates and patterns.** `ShiftTemplateUpdate` and `ShiftPatternUpdate`
accept `is_active`: templates can be reactivated, patterns paused (manual
generation answers 409, the nightly run skips it). The generation duplicate
guard is keyed on the pattern's own template. Overnight and 24-hour shifts roll
their end on the local date before converting to UTC. Generated seats that
fail the candidate check come back as `seat_warnings`.

**Shift reports.** `review_status` changes only by submitting a draft;
`report_review_required` decides pending vs approved. A re-approval does not
re-run sign-offs: `_create_skill_checkoffs` records the report id and skips a
skill already signed off from that report. Trainee views blank hidden fields on
a serialized copy; before this, each trainee visit wrote NULL over
`officer_narrative` and `reviewer_notes` through `get_db`'s end-of-request
commit, so those fields were lost for everyone. The future-date check moved to
the endpoints, against the department's today.

**Numbers.** `PUT /scheduling/settings` returns `pre_shift_work_enabled`;
`catch_up_deadline` is declared on `MemberComplianceRecord`; a finalized
shift's call count and hours come from finalize's snapshots; coverage uses the
shift → apparatus → 1 minimum and skips cancelled shifts; member-hours
"scheduled" skips declined/cancelled seats; a custom annual window on 29
February is clamped; history import keeps approved pre-shift time and does not
recreate rejected outside-agency hours.

**Dates.** Shift, leave and pattern dates are calendar days and render through
`formatCalendarDate` (UTC-anchored), so they no longer slip a day where browser
and department zones differ. The board's "today" is the department's calendar
day on the shared scheduling clock tick.

## Related Documentation

- [Shift History Import user guide](Scheduling-History-Import)
- [Inventory Module](Module-Inventory) — equipment checklists
- [Apparatus Module](Module-Apparatus) | [Events Module](Module-Events) |
  [Training Module](Module-Training)
- [Scheduling Module — Developer Reference](Module-Scheduling-Developer) — routes, API, data model
- `docs/KNOWN_LIMITATIONS.md` — open scheduling limitations
