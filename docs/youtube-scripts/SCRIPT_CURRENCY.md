# Script currency

## Flagged by the 2026-08-24 → 08-31 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-24_TO_31.md`](../CHANGE_AUDIT_2026-08-24_TO_31.md#documentation-and-media-disposition).

This window produced **five Wrong** — all five rewritten in-script — plus five
new shorts, one new chapter in script 03, two new chapters (04 and 06), and a
re-shoot list. As in every prior window, determinations were made by **reading
the script files**, not by inferring from the change list; a script that was
suspected and turned out clean is recorded as verified rather than left
conditional.

**Rewritten in-script this window** (per the standing rule that no behavioural
content lives only in SCRIPT_CURRENCY):

| Script      | Beat                                        | Was                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **12**      | `PER-ITEM ELIGIBILITY — THE IMPORTANT PART` | "**Eligible voter types** map to membership types — not roles. 'Operational' means active members. 'Regular' means active plus life members." One field that no longer exists, and — worse — a **defect narrated as the design** |
| **12**      | `THE ELIGIBILITY ROSTER` screen note        | A per-item refusal reason reading "membership type not eligible (requires: regular; member has: probationary)". The reason string now names class and status separately                                                          |
| **13**      | `PERSONALIZATION`                           | "For anything embroidered or engraved, turn on personalization" over a single "Name for embroidery" label. Embroidery and engraving are now different jobs asking different questions                                            |
| **05 / 16** | Header permission line                      | "**Requires permission:** `training.manage`" — the module's org-level settings, including the member visibility panel, moved to the new `training.configure`                                                                     |
| **02**      | `POSITIONS VS MEMBERSHIP TYPES`             | "**Membership Types** are classifications like Active, Retired, Honorary, Administrative." One flat list mixing a class, a status and a value that is now the social class                                                       |

### 12 — Elections Deep Dive · **WRONG — and it was describing a bug as a feature**

This is the most instructive determination in the window, and it is worth
reading before making a currency call anywhere else.

The beat said, correctly for the build it was recorded against:

> "'Operational' means active members. 'Regular' means active plus life
> members."

That was an accurate description of what the code did. It was also an accurate
description of **a defect**: `ElectionService` could only answer "is this member
operational" by testing `membership_type == "active"`, because that was the one
value that meant it. A member who had earned **life** membership, or who was
still **probationary**, had that value overwritten by their standing — so a
bylaws question put to the operational members **never reached them**, silently,
with nothing on the dispatch summary to say so.

The script had faithfully documented the behaviour, and in doing so had taught
viewers to expect it. **A currency file that only checks "does the script match
the build" would have marked this beat green every week it was wrong.**

The rule this argues for: when a beat explains _why_ a rule is the way it is,
and the explanation is "because the field can only hold one value", that is a
data-model limitation being narrated as a design decision — and it carries an
expiry the moment somebody fixes the model.

The rewritten beat distinguishes the two facts the old one collapsed:

| The member is…                          | Gets an **operational** ballot item? |
| --------------------------------------- | ------------------------------------ |
| Operational class, regular status       | Yes                                  |
| Operational class, **life** status      | **Yes** — was silently excluded      |
| Operational class, **probationary**     | **Yes** — was silently excluded      |
| Administrative class, holds an EMT role | No — class decides, not the role     |

It also carries a production note telling a delivery pass **not** to shorten it
back to "operational means active", because that sentence is the bug.

### 13 — Department Store · **WRONG — one control for two different jobs**

`PERSONALIZATION` narrated a single field covering embroidery and engraving, on
a screen whose label read "Name for embroidery". An engraved brass plate was
therefore asked for a thread colour.

Rewritten into two captures — method set to Embroidery with the thread swatch
present, method set to Engraving with it absent — and a production note stating
that **a single capture cannot show this change**, so a delivery pass that keeps
one shot loses the point entirely.

### 05 / 16 — Training Officer · **WRONG in the header, which is the worst place**

Both scripts open with "**Requires permission:** `training.manage`". Since
2026-08-25 the training module's org-level settings — chiefly the **member
visibility panel**, which decides how much of an officer's written assessment
the assessed member may read — are gated on the new `training.configure`.

This matters beyond pedantry: the split exists precisely so a Membership
Coordinator can configure training **without** also gaining the power to edit
anybody's training records. A script that names the wrong permission sends a
department to grant the wrong one, and the wrong one here is the broader one.

Corrected in both headers, with the reason stated inline so a future edit
cannot collapse them back together.

### 03 — IT Manager / System Admin · **NEW CHAPTER, existing chapter left alone**

Chapter 10, "The August 31 upgrade: forty-five migrations, and five that take
permissions away". Head `f6a7b8c9d0e1`.

**The August 24 chapter is deliberately not revised.** It documents a different
head and a different irreversible migration and remains correct for anybody
upgrading across that window. Overwriting it would have destroyed a correct
upgrade narration to avoid having two chapters.

The two beats the chapter marks as uncuttable are both "a thing disappeared"
support calls, which is exactly this script's audience:

1. **Five permission revocations** — `compliance.view` off the Member position,
   `notifications.view` off the baseline member and junior ranks, and
   `facilities.view` off regular members _and then_ off the shared operational
   officer positions. Nothing grants them back.
2. **The Testing Checklist ships switched off.** `/testing` is gone until
   Settings → Modules, and nobody will connect a missing page to a module they
   did not know existed.

Also covered: the administrative-rank clearing (does not reverse, and the
reason it should not), and four no-op downgrades with their individual
justifications.

### 04 — Fire Chief / Leadership · **NEW CHAPTER + two inserts**

New chapter, "Who runs what": the organizational chart. This is a chief's
screen and it has never been shot. The load-bearing beat is **why reading it
needs no permission** — the screen exists so a six-week member can find out who
runs an area without asking three people, and a permission would lock out its
own audience.

Two inserts: the elections correction above (in the chief's own words, with
"check your next ballot's recipient list" as the call to action), and an
administration note that line officers lose the Facilities workspace and the
Testing Checklist page is off.

### 06 — Member Guide · **NEW CHAPTER + one insert**

New chapter, "Who do I ask?" — the same org chart, from the member's side and
at a quarter of the length. Placed early, beside "finding your way around",
because that is when a member needs it.

Insert on the profile: class and status as two fields, with the ballot
consequence stated plainly. **The old profile-header capture is wrong, not
dated** — it shows one field where there are now two.

### 07 — Secretary / Administrative · **TWO INSERTS**

- **Unlink now actually unlinks.** Pressing Unlink on a meeting record's linked
  event reported success and removed nothing; the link returned on the next
  load. Worth narrating because secretaries have been working around it without
  realising it was a defect.
- **Meeting records are audited now.** Minutes always were. The meeting record
  itself — create, edit, delete, approve, attendees, action items — was not.
- Plus the separation-of-duties fix: a secretary could submit **and** approve
  their own minutes.

### 02 — First-time setup · **WRONG — caught only because the file was read**

This one is worth recording as a near-miss. The obvious reason to suspect
script 02 in this window was the **Testing Checklist becoming a module**, and on
that count the script is clean: the module is deliberately _not_ offered during
onboarding, so there is nothing for this script to show.

Reading it anyway turned up a different problem. The `POSITIONS VS MEMBERSHIP
TYPES` beat listed "Active, Retired, Honorary, Administrative" as one flat set —
a list that mixes a **class** (administrative), a **status** (retired), and a
value that is now the **social class** (honorary). After the split it is not
just incomplete, it teaches the wrong shape on the screen where a department
sets this up for the first time.

**Had the determination been made from the change list rather than the file, it
would have been marked clean.** That is the argument for reading every
suspected script even when the suspected reason turns out not to apply.

### Verified clean this window

Checked by reading the script, and found still accurate — recorded so the next
pass does not re-check them:

| Script                           | Why it was suspected                             | Verdict                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01 — Installing**              | Forty-five migrations in the window              | **Clean.** It narrates the install path, not a specific head                                                                                                                                                                                                                                                                    |
| **09 / 10 — Training pipelines** | The class/status split touches member records    | **Clean.** Pipelines read programs and requirements, not membership standing                                                                                                                                                                                                                                                    |
| **11 — Building a pipeline**     | Same                                             | **Clean**                                                                                                                                                                                                                                                                                                                       |
| **14 — Multi-class courses**     | Same                                             | **Clean**                                                                                                                                                                                                                                                                                                                       |
| **15 — Skills testing**          | An officer could void or return their own result | **Clean, but extended.** No existing beat became false — the script never narrates an officer voiding their _own_ result — so this is an **addition, not a correction**. An insert was written anyway, because "you can no longer void your own" is the kind of boundary an evaluator meets on a bad day rather than a good one |

### Five new shorts written in-script (8AM–8AQ)

Who do I ask about this? (org chart) · One member, two facts (class vs. status,
with the ballot consequence) · Where did /testing go? · Build a check template
in one list · Thread colour on a brass plate.

**Three carry production constraints that a scheduling pass must respect:**

- **8AN** needs a genuine before/after of the profile header. If the "before"
  capture is unavailable, narrate over the after-state — **do not reconstruct a
  fake old screen.**
- **8AP** opens on the old template builder, and **that state no longer exists
  in any build.** Source it from an archived capture or drop the opening beat.
- **8AQ** needs two captures, one per personalization method. One shot cannot
  show the change.

## Flagged by the 2026-08-23 → 08-24 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-23_TO_24.md`](../CHANGE_AUDIT_2026-08-23_TO_24.md#documentation-and-media-disposition).

This window produced **four Wrong** — all four rewritten in-script — plus five
new shorts, two new chapters in script 03, and a re-shoot list. Determinations
below were made by reading the script files, not the change list; where a
script was suspected and turned out clean, it is recorded as verified rather
than left as a conditional.

**Rewritten in-script this window** (per the standing rule that no behavioural
content lives only in SCRIPT_CURRENCY):

| Script | Beat                             | Was                                                                                                                                                                                                                                    |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **08** | `SHORT 8C`                       | "They get notified — but they don't approve it, and neither do you." **True when written on 2026-08-23; false a day later.** A one-way offer is now accepted or declined by the person it was made to                                  |
| **06** | `VIEWING YOUR SCHEDULE`          | Week/month view toggles and "click any shift to see coverage". The Schedule tab is a board with a status chip per shift and a one-button claim                                                                                         |
| **06** | `REQUESTING A SHIFT SWAP`        | "They'll get a notification to accept or decline. Once both parties agree, it goes to the officer for final approval." Collapsed two now-distinct flows: a one-way offer completes without an officer; a two-way trade still needs one |
| **04** | `VIEWING THE SCHEDULE`           | "View by week, by month, or by individual" and a colour key that no longer matches                                                                                                                                                     |
| **07** | `Your emails look different now` | "You're now **tracking** the built-in design, so future improvements reach you without you doing anything." **No longer true** — the August 24 shell is opt-in per template, and the switch is the Reset button                        |

### 08 — Quick Tips & Shorts · **WRONG, then corrected — and the correction is the interesting part**

`SHORT 8C` was rewritten on **2026-08-23** to remove a target-side
accept/decline control that did not exist. **On 2026-08-24 that control
shipped**, so yesterday's correction became today's error in the opposite
direction.

Both versions are recorded rather than one quietly replacing the other, because
this is the failure mode a currency file exists to catch: a beat can be
corrected into being wrong. The rule it argues for is that a `SCRIPT_CURRENCY`
entry naming a control as **non-existent** carries an expiry the moment that
control is on a roadmap — and "the target can't accept" was a defect report in
this repository's own tracker at the time the correction was written.

The rewritten beat now distinguishes the three cases, which the original never
did:

| What the member does                                        | Who completes it                                 |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Hands their seat to a named colleague (nothing coming back) | **The colleague**, Accept or Decline. No officer |
| Trades their Tuesday for somebody's Thursday                | An officer — and **not** either participant      |
| Posts the seat open                                         | Any eligible member claims it                    |

It also adds two rules a viewer will otherwise hit: you cannot release or
re-offer a seat while your own offer of it stands, and an unanswered offer is
closed the day before the shift with both members and the duty officer told.

**Five new shorts written in-script** (8AH–8AL): claim a shift in one tap;
standing shifts; tap your card, walk in; the seal proves unchanged, not full;
print the roster at the watch desk. Each carries its own production note —
three of them need real hardware or a specific demo state and cannot be
captured in the screenshot harness.

### 06 — Member Guide · **WRONG ×2 — corrected in-script 2026-08-24**

Two beats rewritten, one chapter added, one chapter extended.

- **`VIEWING YOUR SCHEDULE`** described a calendar with view toggles. It is a
  board. The rewritten take walks the chip states in order and lands on the
  grey one — a shift that named neither positions nor a minimum staffing level
  reads as **unspecified, not short**. That is the beat a delivery pass will
  drop, and dropping it puts the viewer back where the old build left them,
  reading meaningless red.
- **`REQUESTING A SHIFT SWAP`** collapsed a one-way offer and a two-way trade
  into one flow with one approval path. They are now different, and the
  difference is the reason the one-way case works at all.
- **New chapter, `CLAIMING THE SAME SHIFT EVERY WEEK`** (standing shifts).
  Nothing to unsay — this did not exist. The load-bearing beat is that giving
  up one date leaves the series intact, and that a shift created **later** still
  seats the member. Without the second half a viewer will assume the claim is
  just a bulk sign-up and stop using it after the department generates a new
  month.
- **`QR CODE CHECK-IN` extended** with ID cards, the check-in station, and the
  early-tap rule: an arrival well before the start is flagged, the tap time
  stays honest, and credit runs from the scheduled start. Say the last part —
  a viewer who thinks tapping early buys hours will test it.

### 04 — Fire Chief / Leadership · **WRONG — corrected in-script 2026-08-24**

`VIEWING THE SCHEDULE` rewritten for the board, with the grey/unspecified state
given its own beat and its own reason: before this release a shift naming
neither positions nor a minimum was assumed to want four people and shown in
critical red, so a department that configures neither opened the page to a wall
of red that meant nothing.

**Two new sections added in-script:**

- **`THE NUMBERS AT THE TOP OF EVERY ADMIN PAGE`.** Four administration pages
  now share one frame. The chief-specific beats are the **scope rule**
  (department default, and whether individual officers may keep their own) and
  the **medical-screening permission** — the screening tile now reads
  _unknown_ rather than vanishing for an officer without
  `medical_screening.view`, and the script says why that choice was made. Do
  not let a delivery pass cut the "it says unknown rather than disappearing"
  line; it is the difference between a self-explaining screen and a support
  ticket.
- **`THE STAFFING TILES ON YOUR DASHBOARD`.** Seven tiles, each linking into
  the schedule already filtered to what it counted.

### 07 — Secretary / Administrative · **WRONG — corrected in-script 2026-08-24**

The email-design beat told the viewer that an unedited template was tracking
the built-in design and that future improvements would arrive on their own.
**A secretary following that would wait for a redesign that never comes.** The
August 24 shell is adopted per template by pressing **Reset**.

Two things the rewritten beat adds, both of which cost somebody real work if
omitted:

- **Reset restores the wording too**, not just the styling — subject, HTML
  body, text body, styles and footer choice all go back to the shipped
  defaults. A department that has spent two years refining how it words its
  dues notice needs to copy that text out first.
- **A presenter note about the on-screen banner.** The banner reads "Templates
  you have never edited already use it", which is true of a body byte-identical
  to the _current_ shipped default — not of a department arriving from the
  previous release, whose untouched bodies are the _older_ default. Reading the
  banner aloud as the rule contradicts the script.

**Every email preview in this script needs re-shooting, and every shot needs a
caption saying which shell it shows** — the pre-08-10 band, the 08-10 rounded
header (still current for a department that has not pressed Reset), or the
08-24 accent rule. All three exist in the field simultaneously, so an
uncaptioned shot of any one of them is a promise about the other two.

### 03 — IT Manager / System Admin · **ADDITION — written in-script 2026-08-24**

Nothing in script 03 needs unsaying. Two chapters added, ~4:30 total:

- **Chapter 7, `NETWORK LABEL PRINTERS`** (~2:00). The load-bearing beat is
  that **the server opens the socket, not the browser**: a printer reachable
  from a desk may be unreachable from the container, and nothing validates the
  address at save time, so registration succeeds and the failure appears at
  print time. This chapter exists to prevent one specific support call and a
  delivery pass that reduces it to "enter the IP address" wastes the chapter.
  Also covers the ZPL/ESC-POS split — including that many non-Zebras ship a ZPL
  emulation mode and should be registered as ZPL — and why "connected" alone is
  not good news from a status check.
- **Chapter 9, `THE AUGUST 24 UPGRADE`** (~2:30). Head `e7a41b6d09c2`. The
  check-type collapse is **irreversible by design** and the script says why a
  guessing downgrade would be worse. Seven migrations backfill nothing **on
  purpose**, and the script names each case — because an operator's first read
  of an empty column is that the migration failed. Ends with the three
  post-upgrade actions the upgrade does not perform (turn on NFC ID Cards and
  grant its two permissions; register printers; check who holds
  `medical_screening.view`) and a warning that scheduler assignments will start
  being refused on position eligibility.

**Demo environment:** the printer chapter needs a printer genuinely answering
on port 9100 **and** a second address reachable from the presenter's desk but
not from the app, or the load-bearing beat has nothing behind it. Show RFC 5737
documentation addresses on screen.

### 05 / 16 — Training Officer · **RE-SHOOT + addition, written in-script 2026-08-24**

`MEMBER SELF-SUBMISSION` narrates correctly — the member "uploads their
certificate", which is still what happens. **Every frame of it is out of date**:
the Submit Training form was rebuilt.

Added in-script: the certificate now attaches **on the form** rather than as a
skippable second step (which is why submissions used to arrive with nothing
behind them), and the start time is kept, so a four-hour entry can be told from
a morning class or an evening one. Plus a caution that pre-release submissions
show a **blank** start time rather than 09:00 — the old edit screen assumed
09:00, which was a guess dressed up as a record.

A presenter note carries the two records facts a chief will ask about:
approved certificates are kept indefinitely with nothing expiring them, and
uploads are **not** scanned for malware (they are validated by magic bytes and
stored under a server-generated name, so nothing runs server-side, but a file
opened by an officer is whatever the member uploaded).

### 13 — Department Store · **RE-SHOOT — previously "not affected"**

Last window this script was recorded as unaffected. **That is no longer true.**
The member storefront — catalog, cart, checkout and My Orders — was redesigned
on 2026-08-23, and checkout is now its own page at `/store/checkout` rather
than a panel.

Chapters 5 and 6 need a full re-shoot. **Nothing narrated in them is wrong**,
which is exactly why this is easy to miss on a read-through.

A presenter note was added to Chapter 2: three setup defects were fixed in the
same release — the store admin dashboard returned an error, onboarding's
**Enable** button did not enable the store, and the position editor stripped
store grants on first save. A viewer who tried to turn the store on before
August 23 and found it did not stick should be told to try again, not that they
did it wrong.

### 10 / guide-side only — mobile

Not a script defect. The phone Schedule board, the settings tab strip and the
check-in station at tablet width are all new captures; they are queued in
[`../training/SCREENSHOT_CURRENCY.md`](../training/SCREENSHOT_CURRENCY.md)
rather than here.

### Verified clear this window

Checked against the change list and found genuinely unaffected:

- **01 — Installing The Logbook.** Its `alembic upgrade head` beat already
  carries "Never downgrade just to repair a migration fork", which covers this
  window's irreversible revision without amendment. The new head number belongs
  in script 03, which is where the upgrade chapter lives.
- **02 — First-Time Setup & Onboarding** — clean, but see the gap below. The
  onboarding fixes in this window are **repairs to behaviour the script already
  describes correctly**; nothing narrated needs unsaying. `grep -i "department
store\|storefront"` over the file returns **nothing**, which is both why the
  script is clean and the gap: the module-selection walkthrough
  (`CHOOSING YOUR MODULES`, 9:30–11:00) lists five categories and never
  mentions the Department Store. Until 2026-08-24, **enabling the store made
  setup impossible to finish** — the final Continue failed with
  `400 Invalid modules: storefront`. That is fixed, so the module is now safe
  to demonstrate, and the walkthrough should name it. Queued as an addition,
  not a correction.

  **Do not**, in that same beat, demonstrate a module's per-module
  "configure permissions" step. It toasts "permissions configured!" and
  discards the answer for the fifteen modules that still point at it
  (**ONBOARD-1** in `KNOWN_LIMITATIONS.md`). Filming a viewer restricting a
  module there would teach a restriction that is not applied.

- **09 / 10 / 11 — Training Pipelines.** No pipeline surface changed.
- **12 — Elections Deep Dive.** Election Settings moved onto the shared
  settings shell, which is a **visual** change: no setting moved and none
  changed meaning. Narration is clean; any settings frame needs re-shooting.
- **14 — Multi-Class Courses and Cohorts.** Untouched.
- **15 — Skills Testing & Evaluations.** Untouched.

### Do not script

**The equipment-check lap** — stops in walking order, finished stops collapsed
— is built, tested, and **not wired to the live check screen**, which still
renders the flat compartment list. It appears in the changelog and it is not in
the product. Verify with `grep` before believing any claim that it shipped:
`CheckLap.tsx` has no importer outside its own test file.

## Flagged by the 2026-08-19 → 08-23 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-19_TO_23.md`](../CHANGE_AUDIT_2026-08-19_TO_23.md#documentation-and-media-disposition).

This window produced **three Wrong** — all three now rewritten in-script — plus
a substantial body of new material and a set of re-shoot notes.

> **Revised 2026-08-23, after a verification pass over all eighteen scripts.**
> The first version of this section was written from the change list rather
> than from the scripts, and it was wrong in both directions:
>
> - It **invented one defect.** Script 03 was labelled "DANGEROUS IF FOLLOWED"
>   for a rollback reassurance that does not appear in the file. See the
>   correction under 03 below.
> - It **missed all three real ones.** The false narration in scripts 05, 08
>   and 15 is not mentioned anywhere in the original section.
> - It **parked four determinations as conditionals** ("if the script
>   demonstrates X…"). All four were checked and all four are clear — 12, 14,
>   the duplication half of 15, and 09/10/11. A conditional in this file is a
>   verification the author owed and did not do; the rule that no behavioural
>   content lives only in SCRIPT_CURRENCY is not satisfied by filing a maybe.
>
> Corrections are recorded in place rather than by deleting the original
> claims, so an editor who started work against them can see what changed.

**Rewritten in-script this window** (per the standing rule that no behavioural
content lives only in SCRIPT_CURRENCY):

| Script | Beat                                | Was                                                            |
| ------ | ----------------------------------- | -------------------------------------------------------------- |
| 08     | `SHORT 8C` (line 102)               | Promised the swap target an accept/decline that does not exist |
| 05     | `DASHBOARD OVERVIEW` (lines 76, 80) | Named two dashboard cards that no longer exist                 |
| 15     | `PRACTICE` (line 583)               | Claimed official tests require `training.manage`; they do not  |

### 03 — IT Manager / System Admin · **ADDITION — migration material missing**

> **Corrected 2026-08-23.** This entry was first written as
> "DANGEROUS IF FOLLOWED", on the claim that the upgrade chapter "walks
> `alembic upgrade head` and then, as reassurance, tells the viewer they can
> downgrade if something goes wrong." **No such line exists in script 03.**
> `### UPDATING THE LOGBOOK (31:30 – 33:00)` walks
> `docker compose up -d --build`, states that migrations run on startup, and
> says to restore from the mysqldump backup. `grep -n "upgrade head"` across
> all eighteen script files hits only `01-installing-the-logbook.md:621` —
> which already says _"Never downgrade just to repair a migration fork."_
> Script 03 contains no `alembic` command at all.
>
> The severity label was wrong and the quoted defect was not in the file. It is
> corrected here rather than quietly deleted, because an editor who had already
> started rewriting against a phantom line needs to know why it vanished.
>
> What follows is the real gap: **nothing existing is wrong, material is
> missing.**

Nothing in script 03 needs unsaying. What it lacks is any statement of what
this release's migrations cost if an operator reaches for a downgrade — and
its audience is exactly the person who would.

**1. The seat-list migration does not reverse.** `1eeb053d59b7` expands a
legacy crew `count` into that many individual seats, and its `downgrade()` is a
deliberate **no-op** — the original count cannot be recovered from the expanded
seats, so it leaves them in place rather than guessing. **Downgrading destroys
nothing here**; it simply does not put the old shape back.

> **Corrected 2026-08-23.** This entry first said downgrading "collapses them —
> a three-firefighter template comes back as one, permanently." That is wrong:
> `downgrade()` is literally `"""No-op — see the module docstring."""`, so no
> seat is lost. The claim was caught by a review bot on PR #1730 after being
> propagated into the audit, changelog, wiki and training lesson. **Do not
> record the data-loss version** — it would have an IT manager tearing down a
> restore over damage that cannot occur.

**2. Downgrading past both `compartment_name` migrations truncates storage
paths.** The column was widened to hold deep nested paths; the downgrade
narrows it back to 200 characters, cutting whatever no longer fits.

A third item is not destructive but will confuse anyone who checks: the
equipment-check de-duplication (`a17c4e9d2b61`) **detaches** historical
duplicate checks rather than deleting them, and cannot re-attach them on
downgrade. Item snapshots survive; the association does not.

The line to add, immediately after the existing backup instruction:

> "Take the backup — and know what it's for. Two of these migrations don't
> reverse cleanly. Nothing gets destroyed if you downgrade, but you won't get
> the old shape back either, so the backup is the only thing that returns you
> to where you started."

**Script 01 needs the same sentence.** Its
`## AUGUST 14 RELEASE INSERT — TLS AND SAFE UPGRADES` (line 621) is the
series' only `alembic upgrade head` beat, and its audience is the self-hoster
who reaches for `alembic downgrade` when an upgrade misbehaves. Its existing
"Never downgrade just to repair a migration fork" remains correct and is now
load-bearing; append the same caveat so the two videos agree. Roughly
+12 seconds. Also worth naming there: `python scripts/validate_migrations.py`,
and the current head `a17c4e9d2b61`.

**Also in this chapter:** three migrations in this release exist to repair
databases that Alembic believes are already up to date, because an earlier
migration was released under one revision id and later renumbered. This is
worth 20 seconds on camera — it is exactly the kind of thing an IT manager
will otherwise interpret as a bug when they see repeated work in the log.

**EDITOR:** the upgrade chapter grows by roughly **45–60 seconds**. Everything
from that chapter onward re-times.

### 04 — Fire Chief / Leadership · **WRONG — new chapter needed**

Two items.

**1. Governance → Legal Documents is a leadership feature and is absent from
the script.** A chief can now have the department's own privacy notice and
terms published rather than the platform's. The beat that matters is **not**
"you can edit your privacy notice" — it is that **proposing and publishing are
separate permissions**. A chief who hears the first half and not the second
has learned the feature backwards and will hand `legal.publish` to everyone
who needs to draft.

Suggested framing:

> "Your secretary can write it. Somebody else has to publish it. That's not
> the product being awkward — that's the two-signature rule your bylaws
> probably already have, enforced by the software instead of by memory."

**2. The self-review rule needs saying out loud, with the failure mode.**
Nobody can approve their own swap or time-off request any more, and on a swap
that blocks **both** the requester and the target. This is correct and it will
strand small departments: where exactly one person holds `scheduling.manage`
and that person also swaps shifts, their requests cannot be approved by
anybody.

That is a chief-level action item, not a footnote:

> "Before you upgrade — count how many people can approve a swap. If the
> answer is one, and that person ever swaps a shift, make it two."

### 06 — Member Guide · **WRONG — reshoot affected takes**

Any take showing a **dialog on a phone** was filmed against the bottom-bar
defect: the navigation bar sat on top of the dialog and swallowed taps. Those
shots now show a bar that will not be there, and if the presenter reaches past
it on camera the take teaches a workaround for a bug that no longer exists.

**B-roll check:** every phone dialog sequence. The bar is absent while a dialog
is open.

Two additions for this script, both short:

- **Browser tabs now name the page.** One line; members with several tabs open
  have been complaining about this for months.
- **Equipment checks are safe to finish with no signal.** A check completed in
  a dead spot and submitted at the station no longer risks a duplicate. Worth
  30 seconds because members have been taught to avoid exactly this.

### 07 — Secretary / Administrative · **new chapter**

Legal Documents is primarily a secretary workflow. New chapter covering:
drafting a revision, the **required change note** (and why — somebody in two
years needs to see the reason), the free-text "Last updated" field, and the
fact that old versions are archived rather than replaced, because a records
request asks what the notice said _on a date_.

**Do not film against a real department's privacy notice.** Use demo wording.

Also for this script: **re-export any attendance file kept from before this
release.** The event attendance export mis-escaped commas, so a member named
`Smith, John` shifted every column after them. That is a correction a
secretary needs to hear, because the broken files are already sitting in
folders.

### 08 — Quick Tips & Shorts · **WRONG — corrected in-script 2026-08-23**

> **This entry originally read "additions"** and listed three new shorts. It
> missed that an existing short teaches a workflow the product does not have.

**Short 8C, "Submitting a Shift Swap Request", line 102:**

> "Option one: propose a direct swap with another member. They get notified
> and accept or decline."

**The target has no accept or decline.** They are notified — `_notify_swap_request`
does fire — but there is no control for them to respond with, and there never
has been on any branch. `frontend/src/modules/scheduling/services/api.ts`
exposes list, create, get, **review** and **cancel**; there is no accept path.
Review requires `scheduling.manage`, and since this window
`scheduling_service.py:3831-3841` rejects the reviewer if they are the
requester **or** the target.

So the short is now wrong twice over: it promises the partner a decision they
cannot make, and it does so in a video whose own next line ("goes to your
officer for approval") contradicts it.

**This is the highest-stakes item in the window** — not the most wrong, but
the only one a viewer _acts on_. A member follows the short, submits a swap,
and waits for their partner to accept in the app. Nothing arrives, because
nothing was ever going to. The shift comes around with the swap still pending.

**Now rewritten in `08-quick-tips-and-shorts.md`** rather than left in this
queue, per the standing rule. The replacement says the partner is notified but
does not decide, and that the officer who signs off must be in neither seat.
The screen direction now explicitly forbids staging a target-side
accept/decline control. **Net +0 seconds** — absorb the extra few by trimming
the closing tag line; the short must stay in format.

**New shorts (genuine additions):**

- **New short: "Finish the check in the dead spot."** Equipment checks are now
  safe to complete offline and submit on reconnect. Needs a real phone and a
  real dead spot or a convincingly simulated one — this is a format where a
  staged offline indicator will be spotted.
- **New short: "Recruitment nights that actually feed the pipeline."** Picking
  the Recruitment event type on a **new** event turns guest sign-in on.
  **Shooting note:** it must be a new event — the switch does not fire when you
  change an existing event's type, and filming it that way produces a take
  where nothing happens.
- **Candidate short: "Which tab am I in?"** Browser tab titles. 20 seconds.

### 05 / 16 — Training Officer (parts 1 and 2) · **WRONG — corrected in-script 2026-08-23**

> **This entry originally read "B-roll stale, one behaviour change"** and named
> that change as prerequisite-gated credit bookkeeping. **It missed the actual
> defect**, which is two chapters up and is the same class of error this file
> caught one window ago in script 06's dashboard tour.

`### DASHBOARD OVERVIEW (1:30 – 2:30)` in `05-training-officer-guide.md`
narrated **two cards that no longer exist**:

| Narrated                                                               | Reality                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Expiring Soon"** — "expiring in the next 30, 60, and 90 days"       | The widget is **Upcoming Expirations**: one fixed 90-day window, first five rows, `{days_left}d` per row. There is no 30/60/90 tiering                                                                                                                        |
| **"Overdue Training"** — "members already past their expiration dates" | **No such card.** `training.py:197` filters `today <= expiration_date <= cutoff`, so already-expired records are excluded by the lower bound. The nearest survivor is **Members Needing Intervention**, which counts unmet requirements, not expiration dates |

A presenter pointing at the screen and naming two absent cards is the worst
kind of stale: the viewer concludes their build is broken or their permissions
are wrong.

**Both are now rewritten in `05-training-officer-guide.md`** rather than left
in this queue, per the standing rule that no behavioural content lives only in
SCRIPT_CURRENCY. Two further corrections were folded in while the beat was
open: the compliance card renders as **Department Compliance** on screen (the
Customize panel's "Compliance Overview" is a different label), and
`expiring_records` is **unsorted** — do not say "soonest first" on camera. A
callout was added making explicit that the expirations card looks only
forward, so it is not an overdue list.

**Chapter 2 needs a fresh take regardless** (the Training Admin rework,
PRs #1716/#1720/#1717), so the rewrite costs nothing extra in production.
Net **+0 to +10 seconds**.

**Also, and separately:** the Training Admin screen now renders section
descriptions and contextual actions, and its tabs were rebuilt for keyboard
and screen-reader navigation (roving focus, arrow/Home/End, `aria-controls`).
Any B-roll of that screen predates the change.

**Prerequisite-gated credit bookkeeping** was corrected — a requirement locked
behind a prerequisite no longer mis-tracks credit when the prerequisite is
completed out of order. If either script narrates prerequisite behaviour,
check the take against the current screen.

Smaller items that affect what is on screen but need no new narration:
action hints on **waived** requirements, the training detail visibility gate,
category mappings that can now be cleared, and restored mobile export tap
targets.

### 12 — Elections Deep Dive · **verified clear 2026-08-23**

> **This entry originally read "one shooting note"** and asked whether the
> script demonstrates backing out of the ballot confirmation. **It does not.**
> Checked: there is no "you can back out here" beat anywhere in the file. Line
> 374 already says the ballot _"submits atomically… there is no such thing as a
> half-submitted ballot"_, which the new guard reinforces rather than
> contradicts.

The underlying change is real — the ballot confirmation can no longer be
dismissed, Escape included, while a vote is in flight — but **no narration in
script 12 needs changing.** Recorded so the next pass does not re-open it.

Two fixes with no narration consequence: automatic election reminders now
carry a working ballot link, and concurrent public ballot submissions are
serialized.

### 14 — Multi-Class Courses and Cohorts · **verified clear 2026-08-23**

> **This entry originally read "verify one beat."** Verified: the string
> "override" appears **zero times** in `14-multi-class-courses-and-cohorts.md`.
> The script never demonstrates a cohort schedule override, so the new
> validation cannot invalidate a take.

Cohort class schedule overrides are now validated — a cohort override that
conflicts with its parent class is rejected rather than accepted and failing
later. **No narration in script 14 needs changing.**

### 15 — Skills Testing & Evaluations · **WRONG — corrected in-script 2026-08-23**

> **The original entry here was about template duplication and was moot.**
> Verified: the string "duplicat" appears **zero times** in
> `15-skills-testing-evaluations.md`. There was no re-link warning to cut. The
> duplication fix (a duplicated skill template now keeps its `requirement_id`)
> is real but the script never narrates duplication.

**What the pass missed, and what is now fixed in-script.**
`### PRACTICE (18:45 – 20:00)` (line 583) said:

> "Official tests still need `training.manage`."

That is **false**, and the same file contradicts it twice — line 9 and the
callout at line 144 ("Anyone can examine. Only an officer can validate"), and
the whole of Chapter 3.5. `create_test` in
`backend/app/api/v1/endpoints/skills_testing.py:1199` depends on
`get_current_user` alone; `training.manage` sits on **`/tests/{id}/validate`**
(line 1955), not on running a test.

The line is now rewritten to say that any member can run an official test and
that the officer's signature afterwards is what makes it count. **Roughly +10
seconds; that beat needs a fresh take.**

This sentence is not from this window — it is a leftover from the 2026-08-08
permission change, which the script's own re-shoot notice and Production Notes
cleaned up everywhere except here. Recorded as a window finding anyway,
because a false permission claim in a shooting script does not become
acceptable by being old.

Also: practice skill-test seeding is idempotent, which matters only to
whoever prepares the demo environment.

### 09 / 10 / 11 — Training Pipelines · **verified clear 2026-08-23**

> **This entry originally read "check the prospect beats."** Verified: the
> string "prospect" appears **zero times** across all three files. These are
> _training_ pipeline scripts — member progression through training phases —
> not prospective-member pipeline scripts. The naming collision is what put
> them on the list.

The prospect pipeline did gain event provenance (the board filters by the event
applicants came from; the API answers "who came from this event"), interview
stage progression retries after an update, and a duplicate-prospect race was
fixed — **but none of it touches these three scripts.** The **Recruitment event
type** material belongs to scripts 04 and 08.

### 13 — Department Store · not affected

No storefront behaviour changed in this window. Verified against the commit
range, not assumed.

## Flagged by the 2026-08-17 → 08-19 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-17_TO_19.md`](../CHANGE_AUDIT_2026-08-17_TO_19.md#documentation-and-media-disposition).

The window produced **one Wrong**, one **Dangerous-if-recorded** (a number a
chief could put in a grant application), and a set of **additions** that are
new material rather than corrections.

### 04 — Fire Chief / Leadership · **WRONG — corrected in-script 2026-08-19**

Two separate problems in the same script, and the second is the serious one.

**1. The close-out chapter narrates a screen half the audience will not have.**
`### SETTING SHIFT CLOSE-OUT RULES (19:45 – 20:15)` walks the close-out rules
card and then describes what an officer sees at finalize. As of 2026-08-19 a
department that has switched on **Record a call count at close-out** gets a
**three-step wizard** instead of the single checklist — different screen,
different flow, and the toggle that switches between them is _on the very card
the presenter is standing on_ and is not mentioned.

The card needs the new toggle named, and the officer-facing consequence stated:
turning it on changes what your officers see at 0700 the same morning.

**Both are now rewritten in `04-fire-chief-leadership-guide.md`** rather than
left in this queue, per the standing rule that no behavioural content lives only
in SCRIPT_CURRENCY.

**2. The call-volume figure needs the caveat said out loud, on camera.**
`### SCHEDULING REPORTS (21:30 – 22:15)` sends a chief to a report that, for a
count-only department, is labelled **Unit Responses** and _is not a department
call count_. Two units that closed out independently each reported their own
call, so an MVA that an engine and a medic both ran appears twice.

This script's audience is precisely the person who puts that number in a grant
application or an ISO submission. **A narrator who says "here's your call
volume" over that screen is teaching a reporting error with a funding
consequence.** The caveat is one sentence and it must be in the take:

> **Three additions to this beat _(2026-08-19, from the Codex review of
> PR #1573)_.** They change what can safely be shown, not just what is said.
> **(a)** Switching the demo department to per-incident mode does **not** make
> "total calls" safe — that figure sums `calls_responded` across _per-trainee_
> shift completion reports, so a shift with two enrolled trainees counts twice.
> Neither mode yields a quotable incident count. **(b) Do not show a CSV
> export in this chapter.** The export still labels the column "Total Calls" in
> both modes, so it visibly contradicts the tile beside it on camera. **(c) Do
> not promise a per-apparatus breakdown** — the API returns one, the screen does
> not render it. Tracked as SCHED-13/15/16 in `docs/KNOWN_LIMITATIONS.md`.

> "If your department records call counts at close-out, read the label — this
> is _unit responses_, not incidents. An MVA two units ran shows up twice.
> Reconcile mutual responses before this goes in a grant application."

**B-roll check:** any planned shot of the finalize checklist must be captioned
as the detailed-mode screen, or shot twice — once per mode.

**EDITOR:** the close-out chapter grows by roughly **60–90 seconds** (the new
toggle, the three wizard steps, and why they save as they go). Scheduling
Reports grows by **~15 seconds** for the caveat. Both sit inside existing
chapters, so **only the bands from 19:45 onward re-time**, not the whole script.
Final timecodes are a recording-production task.

### 08 — Quick Tips & Shorts · **written in-script 2026-08-19**

- **Short 8J** (end-of-shift checks) still holds for detailed-mode
  departments, but for a count-only department the override moved to the **last
  step of the wizard** rather than the dialog it shows. A shooting note is now
  in the short itself: film it on a detailed-mode department, which keeps the
  take correct as filmed, and do not mix both screens into one 50-second clip —
  a viewer has to recognise their own screen immediately or the format fails.
- **New short 8AG, "Tap Instead of Scan"**, is written. Needs a **real Android
  phone and a real tag**; it cannot be captured in the harness, and anyone who
  has used NFC will spot a staged shot. Its production note also rules out
  shooting it on a room kiosk card — those are deliberately not taggable, and
  showing a viewer hunting for a button that is correctly absent teaches the
  wrong thing.

### 01 — Installing The Logbook · **written in-script 2026-08-19**

A new chapter, **CHECK IT BEFORE YOU START IT (10:45 – 11:00)**, now sits ahead
of START THE SERVICES in the script. It adds the preflight check before the
first `docker compose up`:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --build backend python -m app.preflight
```

This is the single best 60 seconds available anywhere in the series. It converts
"discover the configuration problem by losing the service" into a command run
beforehand. Two details have to be in the narration or the advice is worse than
useless:

- **`--build`**, or the viewer checks the image they are replacing rather than
  the one they are deploying.
- **The same `-f` files the deployment uses**, or Compose evaluates only the
  base development configuration and answers about a setup nobody runs.

**EDITOR:** lands inside the existing pre-launch chapter. Budget **60–80
seconds**; no chapter re-ordering.

### 03 — IT Manager / System Admin · **written in-script 2026-08-19**

Two sections added to the script body, both post-setup and both in scope:

- **`python -m app.preflight --compose PATH`** — names the settings a compose
  file _drops_, i.e. values sitting in `.env` that never reach the container.
  Those used to become defaults silently, which is how a production stack ends
  up running a development setting with nothing on screen to say so. This is an
  IT manager's problem specifically, and belongs here rather than in 01.
- **The sign-in hardening posture, and which way each control fails.** Worth
  saying explicitly because the two directions are opposite and deliberate:
  breached-password lookup **fails open** (it is supplementary — complexity,
  history, MFA and lockout still apply, and an outage must not block a password
  change), CAPTCHA **fails closed** (nothing sits behind it, so accepting
  unverified traffic during an outage is the state an attacker wants). Also
  worth one line: enabling CAPTCHA widens the CSP for the provider's widget
  origins, and a misconfigured provider presents as _"the challenge never
  appears"_ rather than as an error.

Written as **Chapter 5 → "Brute-force protection, and which way each control
fails"** and **Chapter 9 → "Ask before you restart"**.

**Do not let a delivery pass compress the fail-open / fail-closed beat into
"both are security checks."** That they fail in opposite directions is the
entire content of the section — breached-password checking must not block a
password change during an outage, and CAPTCHA must not admit unverified traffic
during one. An editor smoothing those into one sentence removes the only thing
a viewer needed to hear.

**Demo environment:** the `--compose` beat needs a compose file that genuinely
drops a setting present in `.env`. Without that fixture the command prints an
empty list and the section has nothing behind it.

**EDITOR:** ~2:30 total, both inside existing chapters. Chapter 5's addition
re-times everything from 17:30 onward; Chapter 9's re-times only Chapter 9 and
the last rows of the clip table.

### 06 — Member Guide · **written in-script 2026-08-19**

`### QR CODE CHECK-IN (6:30 – 7:30)` has gained the NFC alternative in-script.
The added narration keeps it short, because for most members it is one extra
option and one limitation:

> "If your station has put up an NFC tag, you can just hold your phone against
> it instead of scanning. If the app's already open on screen, use **Tap Tag**
> on the Events page — Android won't hand the tag over while the app is in
> front."

**Say the limitation, do not bury it.** Chrome on Android, over HTTPS. iPhone
cannot do this and neither can a desktop, and a member who tries it on an
iPhone and fails will assume the app is broken rather than that their phone
does not have the hardware API.

**B-roll:** needs a real Android phone and a real tag. This cannot be captured
in the screenshot harness, and a mocked-up shot will look wrong to anyone who
has used one.

**EDITOR:** ~25 seconds inside the existing chapter; the clip table entry at
`| QR Code Check-In | 6:30–7:30 |` keeps its title or becomes "Checking In with
a QR Code or a Tap".

### 10 — Training Pipelines, Member · **verify only**

Members whose training requirements count calls will see credit arrive from
close-out rather than from per-incident logging if their department switched
modes. Nothing in the script is wrong; check that no take says "each call your
officer logs" in a way that implies the per-incident form.

### Not affected

**02, 05, 07, 09, 11, 12, 13, 14, 15, 16** — no behaviour in this window
touches what they narrate.

## Flagged by the 2026-08-15 → 08-16 changes

The window produced one **Wrong** (script 02's auto-save promise), several
**in-script corrections**, and a set of **B-roll / verify** notes.

### 02 — First-Time Setup & Onboarding · **WRONG — corrected in-script 2026-08-16**

The installation wizard's session identifier moved to tab-scoped storage on
2026-08-15. Onboarding is now **one tab, one sitting**: a second tab does not
inherit the run, and closing the browser ends it.

**Chapter 2 promised the exact opposite, on camera.** The Welcome Screen
narration read:

> ~~"The wizard auto-saves your progress, so if you need to step away or your
> browser closes, you'll pick up right where you left off."~~

That is now flatly false, and it was already misleading before 08-15 — the server
session has always expired after 30 minutes idle, so "step away" was never safe
for long. An installer following it would close the browser on purpose,
confidently, and lose the run. Recorded, it would have been the most expensive
kind of error in this series: a viewer does what the narrator told them to and
the product punishes them for it.

**This has been rewritten in `02-first-time-setup-and-onboarding.md` rather than
left in this queue**, per the standing rule that no behavioural content lives
only in SCRIPT_CURRENCY. The replacement narration covers:

- Finish in one tab, in one sitting. Gather the department address, station list,
  apparatus list and first administrator's details **before** starting.
- A second tab starts its own session; the step you were on will refuse to save.
- Closing the browser ends the run. So does 30 minutes idle — the server session
  always expired on a sliding 30-minute timer.
- **The trap worth saying out loud on camera:** reopening the wizard after a
  restart **repaints your typed answers while the session behind them is gone**.
  Nothing warns you until the next step fails. The filled-in form is a local
  draft, not a resumed session — restart the wizard rather than re-typing into
  it.
- "Onboarding has already been completed" is a _different_ message: a department
  already exists, so sign in instead of starting setup.

**B-roll check:** any planned shot showing the presenter leaving the wizard and
coming back must be re-planned — it will now fail on camera, which is either a
ruined take or, if left in, a demonstration of the opposite of what the narration
says. If the shot is kept deliberately as a teaching moment, it needs the
two-frame sequence (repainted form, then the error) rather than a single frame.

**EDITOR:** the replacement is net-longer than the two sentences it removes, so
Chapter 2's `1:00 – 4:00` band and **every chapter marker and clip-table entry
after it** re-time. Budget roughly **45–70 seconds added**, depending on delivery
and on whether the optional two-shot insert is used. Final timecodes are a
recording-production task — narration pacing determines them.

### 01 — Installing The Logbook · **Incomplete — written in-script 2026-08-16**

Chapter 7 hands the viewer to script 02 and explicitly invites them to "jump
ahead and explore on your own" — which is exactly the viewer who will lose a
session. A short form of the caution now sits there: one tab, one sitting, what
to have ready, and the 30-minute idle limit. **No re-timing needed** beyond
Chapter 7's own band; it lands inside an existing chapter near the end.

### 03 — IT Manager · **retired, not applicable**

Flagged on 08-16 alongside 01, then withdrawn on inspection. Script 03 is a
**post-setup** administration guide — it opens with "if you've been handed the
System Owner account" — and has no install walkthrough to attach the caution to.
Its nearest neighbour, the Chapter 9 backup/restore drill, is about restoring a
database, and **a restored install already has an organization, so the onboarding
wizard cannot run against it at all.** Adding the caution here would teach a
constraint the viewer will never meet. Recorded rather than silently dropped, so
the next pass does not re-flag it.

### Any script with full-screen dark-mode B-roll · **B-roll only**

The themed background moved to the root element on 2026-08-15 so it covers the
browser's scrollbar gutter; before that, dark content showed a **15px white strip**
down the right edge (measured against the affected training captures — see
`SCREENSHOT_CURRENCY.md`).

Audio is unaffected — no script describes the page background. **This is a
per-clip edit decision, not a re-record and not a blanket re-shoot.** Note the
trigger is _dark content at the right edge_, not dark mode as such: the same
strip appears on a light page under a **modal overlay**, which is how two of the
three affected training screenshots picked it up.

Since nothing in the series has been recorded yet, the practical action is to
**capture new B-roll against a build dated 2026-08-15 or later** and note it in
the shot list, rather than to audit footage that does not exist.

---

Two items are already **written into the scripts** (same convention as the
08-12 → 08-14 pass — each carries an inline **EDITOR** note at the insertion
point):

| Script | Applied update                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01** | Compose minimum raised to **v2.24.4+** in the prerequisites narration (production override now uses `volumes: !override`); on-screen `docker compose version` output must show ≥ 2.24.4 |
| **12** | New ~15s beat in Chapter 5: pending nominations are member-visible only while the nomination window is open; managers always see the full list. Chapter 5 onward re-times by ~0:15      |

The rest of the window's changes are **B-roll / verify** items — the words in
the scripts remain true, but the screens behind them changed. Nothing is
recorded yet, so these are capture-plan notes, not re-records:

| Script                | Kind                 | What changed on screen                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **04** (Fire Chief)   | B-roll only          | The event-creation Location picker now indents sub-rooms under their container and shows a containment path for a selected nested room (facilities rooms can nest, 2026-08-16). If the demo department has nested rooms, the picker will not look like a flat list. Either seed flat-only demo rooms or let the tree show and don't remark on it. |
| **06** (Member guide) | B-roll only + verify | Member Directory beat (18:00–18:30): a colleague's profile opened from the directory no longer shows MFA/verification/last-login/account timestamps or role permission lists to members — do not capture or gesture at an account-metadata block that is no longer there. The narration as written makes no such claim; keep it that way.         |
| **07** (Secretary)    | B-roll only          | Event form location field — same nested-room picker note as script 04.                                                                                                                                                                                                                                                                            |
| **08** (Short 8AF)    | B-roll only          | Room QR Codes directory: nested rooms display with their containment path, so "search for 'Training Room'" may surface "Training Room — Station 1"-style names. Still correct; choose demo data so the searched name is unambiguous.                                                                                                              |
| **03** (IT manager)   | Verify before take   | If the deployment chapter shows `docker compose` commands or version checks, apply the same v2.24.4+ floor as script 01. Also: `unraid/.env.example` now ships an HTTPS `ALLOWED_ORIGINS` example — any Unraid-flavored aside should not show the old `http://<LAN-IP>` form as the end state.                                                    |
| **All**               | B-roll only          | Dark-mode captures of public pages (forms, ballots, status) render on the themed gradient now, not white — retake any dark-mode public-page B-roll captured before 2026-08-15.                                                                                                                                                                    |

No script narrates facility-room management in enough depth to need a nested
rooms chapter today; if a Facilities deep-dive script is added later, the
walkthrough source is
[`../training/06-apparatus-facilities.md`](../training/06-apparatus-facilities.md#nesting-rooms-inside-rooms-2026-08-16).

## Resolved in-script for the 2026-08-12 → 08-14 changes

The previously flagged material is now written word-for-word in the actual
scripts rather than living only in this queue:

| Scripts    | Applied update                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **01, 03** | Fail-closed TLS, duplicate preflight, single Alembic head, audit legacy boundary, reset ceiling, archive modes, export visibility  |
| **04, 06** | Personal/Organization dashboard scopes, conditional cards, directory/scanner permissions, privacy exports                          |
| **04, 07** | Event reminder audience, defaults, email preferences, 60-minute Flexible window, overlap/guest edges, related-notification cleanup |
| **08**     | New Short **8AF**: Room QR search, PNG/print, rotation invalidation, safe demo handling                                            |
| **12**     | Saved ballot boundaries/settings verification, fresh IDs, frozen roll at issuance/redemption, paper turnout bounds                 |
| **13**     | Store banner, member payment-method change, activity/status counts and filters, recipient privacy                                  |
| **14, 16** | Session requirement/course/program linkage and ownership/cross-org edges                                                           |
| **15, 16** | Point deduction vs overall failure, per-test resume conflicts, server policy and result/export visibility                          |

Every affected file carries an **EDITOR** instruction giving the inserted runtime
and the chapters/clip tables that must be re-timed. Script text is current; final
timecodes remain a production edit because pacing depends on the recorded take.

Which YouTube scripts still describe the application, and which have gone out of
date. Companion to
[`docs/training/SCREENSHOT_CURRENCY.md`](../training/SCREENSHOT_CURRENCY.md),
which does the same job for the training-guide images.

A script goes stale in three distinct ways, and they cost different amounts to
fix:

| Kind            | What it means                                                                                           | Cost                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Wrong**       | The narration describes a control, screen or behaviour that does not exist. Re-record the take          | High — it is a lie on camera                                         |
| **Incomplete**  | Everything said is still true, but a feature the audience needs has shipped since. Add a section        | Medium — usually a new chapter, and it moves the timestamps after it |
| **B-roll only** | The words hold; the screen behind them looks different. Re-capture the screen recording, keep the audio | Low                                                                  |

> **Nothing in this series has been recorded yet.** Every entry below is a
> correction to make **before** the take, not a re-record. That is the cheap
> moment to fix these, which is the reason this file exists now rather than after
> production.

---

## Resolved 2026-08-11

Everything the first pass flagged has now been **written**, not just noted.
Kept here rather than deleted, because the record of what changed and why is
what a future reader needs when a take does not match the page.

| Script | What was done                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **06** | Dashboard chapter rewritten against the real page; new **RECORDING WHAT YOU USED** section (15:30 – 17:30); every chapter and clip timestamp re-cut; runtime estimate raised to 22–26 min in the series overview            |
| **07** | Email chapter expanded from 25 seconds to 2 minutes and renamed **…FINDING THINGS, SIGNING THEM, AND CLOSING THEM**; footers, organization variables and the design change all written; chapters 6–7 re-timed; new clip row |
| **04** | New **WHAT'S EXPIRING ON YOUR TRUCKS** beat (20:15 – 21:30); chapters 6–8 re-timed; new clip row. The dashboard flag is downgraded to a B-roll note — the narration there was always correct                                |
| **08** | All five proposed shorts written in full: **8AA** – **8AE**                                                                                                                                                                 |
| **03** | Salesforce service-account setup added to External Integrations: My Domain, client credentials, dedicated Run As user, least privilege, readiness/preview, external IDs, sync direction, retry and pagination behavior      |

**One correction to the first pass.** It said script 06's "Training Status"
widget did not exist. More precisely: there is no permanent widget with a
green/amber/red state, but there **is** a red certification banner that appears
only when something is expired or within 60 days, and a **My Training Progress**
panel that renders only for members enrolled in a pipeline. The rewrite is
written against those two, and carries a production note that both are
conditional — a demo account without them is a shorter page than the narration
walks.

### Deliberately not done

**03 — IT Manager / System Admin: the `alembic heads` beat.** Judged not worth
it. The duplicate-revision-id problem is a _contributor_ concern — it bites
someone writing a migration on a branch, not an operator running `git pull`. The
operator-facing half (recognising a crash on start) is already covered by
`WHEN THE APP REFUSES TO START`, and adding to that section ripples timings
through three chapters of a 40-minute script for about fifteen seconds of
content. `docs/TROUBLESHOOTING.md` (_Alembic Duplicate Revision IDs_) and
`docs/ALEMBIC_MIGRATIONS.md` (_Current Head_) are the right homes, and both
carry it — the troubleshooting entry now records the 2026-08-10 recurrence as
the third instance, with the habit that avoids it.

**A pre-existing timing overlap in script 04**, unrelated to this work:
`CLOSING & PUBLISHING RESULTS (17:30 – 18:00)` and
`DEPARTMENT ANNOUNCEMENTS (17:45 – 18:00)` overlap by fifteen seconds. Left
alone — it predates these changes and a timing audit across the whole series is
its own pass.

---

## Flagged by the 2026-08-11 → 08-12 changes

Three things landed that reach the scripts: **saved ballot templates**, a
**security batch** (MFA on OAuth logins, strict refresh rotation, the audit
legacy-hash boundary, an account-reset privilege ceiling), and the
**production compose file now failing closed on transport TLS**. Plus one
purely visual change with wide reach: the **mobile hamburger moved to the
left edge** of the header on every signed-in page.

### 03 — IT Manager / System Admin

**Section: the `SECURITY_REQUIRE_TLS` beat (~35:00, script lines 595–610)** ·
**Wrong.**

The callout — _"Defaults to false so upgrading can't refuse to boot your
instance"_ — is no longer true for the stack this series installs.
`docker-compose.prod.yml` now defaults `SECURITY_REQUIRE_TLS` to **true**, so
an upgrade of the documented production stack running the bundled plaintext
MySQL/Redis **will** refuse to start until the operator either configures
`DB_SSL`/`REDIS_SSL` or writes an explicit `SECURITY_REQUIRE_TLS=false` into
`.env`. The _application_ default is still `false` — the compose file is what
changed — but the narration is delivered over that compose file, so as
recorded it would promise the opposite of what the viewer experiences.
Rewrite the beat as: "the production compose ships fail-closed; here is the
decision it is forcing you to make, and here is how to say 'cleartext, on
purpose' if that is genuinely your situation."

**Consider adding, same chapter:** two 20-second beats for upgraders.
`AUDIT_LOG_LEGACY_MAX_ID` — an upgraded install sets it once to the last
pre-HMAC audit row, or the old rows fail integrity verification (new installs
leave it at 0 and never think about it). And the **account-reset ceiling**:
a `members.manage` holder can no longer reset the password or MFA of an
account holding permissions they lack, which changes who in the department
can "just fix" the chief's locked-out account — the answer is now "someone at
or above that permission level."

### 01 — Installing The Logbook

**Section: the production compose steps (lines ~310, ~408)** · **Incomplete.**

A fresh install following the script verbatim now meets the fail-closed TLS
default the moment it brings up `docker-compose.prod.yml`. Add one beat where
the stack first starts: the app will refuse to boot with the bundled
plaintext database unless you either set up TLS or set
`SECURITY_REQUIRE_TLS=false` explicitly — and saying `false` out loud on
camera should come with the one-sentence caveat about networks you don't
control.

### 12 — Elections Deep Dive

**Section: `BALLOT ITEMS & TEMPLATES` (8:00 – 9:00)** · **Incomplete.**

The template popover now has a second tier above the built-in items: **"Your
saved ballots"** — whole ballots the department saved from previous
elections. This is the feature the annual-officer-election audience actually
wants: build the slate once, click **Save as Template**, and next year apply
it instead of rebuilding. Two things worth saying on camera, because they are
the two questions a secretary will ask: applying one **replaces** the current
ballot (it confirms twice for that reason), and a template carries the
ballot's _structure only_ — never candidates, voters, votes, or attendance,
so last year's nominees do not haunt this year's ballot. Budget ~45 seconds;
it also makes a natural short ("Never rebuild your officer ballot again").

**Section: `CLOSING — INCLUDING EARLY` (26:30 – 27:30)** · **B-roll only.**
The close confirmation is now an in-app dialog whose buttons read **Close
election** / **Keep it open** — any capture of the old browser popup is
stale, and the narration ("confirm") still holds.

**Section: `PAPER BALLOTS, ATTESTATION` (43:00 – 49:00)** · **No change —
recorded here because the narration got _truer_.** The line "No unverified
paper ever slides into a certified total" was written before 2026-08-12,
when a pending batch — excluded from published results — could still steer
**runoff advancement** and **membership-package outcomes** at close. That
gap is fixed; the claim as scripted is now accurate in full. Take it as
written.

**Optional aside, `THE ELIGIBILITY ROSTER` (14:00 – 15:30):** the roster is
now linkable — `/elections/<id>?tab=eligibility` — worth ten seconds when
the narration says "send this to your co-officer."

### 06 — The Member Experience

**Section: login (2:00 – 2:30)** · **Incomplete, one sentence.** The script
already says a 2FA department prompts for the authenticator code after the
password. Add: **this now includes signing in with Google or Microsoft** —
SSO users get the same code screen after the provider hands them back, and
that screen is expected, not an error. (Before 2026-08-12, OAuth sign-ins
skipped the second factor entirely — do not describe the old behaviour.)

**All phone B-roll, this script and every other:** the header ☰ button now
sits at the **top-left**, next to the department name, instead of the far
right. Any phone screen-capture that includes the top bar and was shot
before 2026-08-12 shows the old layout. Same batching advice as the email
B-roll note below: shoot phone-header B-roll last, and re-shoot it as a set.

### 02, 04, 05, 07, 09–11, 13–16

**Checked against the 24-hour diff — no corrections required.** Script 07's
minutes-deletion moments and any delete/confirm interactions across the
series are now in-app dialogs (B-roll formality only; no scripted narration
describes a browser popup). Script 05/16's officer flows are unaffected by
the undated-training fix — no script narrates approving a dateless record
against a freshness-windowed requirement, which is the only path that
changed. Script 02's OAuth module description remains accurate.

---

## Flagged by the 2026-08-10 → 08-11 changes

Two branches landed on 2026-08-10 that reach the scripts: the **email template
catalogue and footer library**, and the **inventory ↔ equipment-check supply
loop**. A third, smaller set of fixes changed what several screens render.

### 07 — Secretary & Administrative Officer Guide

**Section: `EMAIL TEMPLATES — FINDING THINGS, AND SIGNING THEM` (15:20 – 15:45)**
· **Incomplete**, and its B-roll is wrong.

- **Add the Footers tab.** The footer used to be copy-pasted into all 35 default
  bodies, so changing the wording meant opening 35 templates one at a time. It is
  now a named library — **Internal**, **Public**, **Official notice** — that a
  secretary edits once. This is squarely this audience's job and is arguably the
  single most useful thing in the chapter.
- **Add the new organization variables** — tax ID, FDID/state ID **with the name
  of the scheme**, county, founded year, fax. The `{{organization_identifier}}` /
  `{{organization_identifier_label}}` pair is the one worth demonstrating: an
  official notice that reads "FDID 12345" and is right about which identifier
  that is.
- **The B-roll shows the old email design.** Outgoing mail is now a white card on
  a grey page; the full-bleed red band over a grey slab is retired. Any
  screen-capture of a template preview must be re-shot.
- **Budget for it.** This is a 25-second beat that now has two more subjects in
  it. Either grow the chapter to ~2 minutes or split the footer library into its
  own short (see the proposed 8AA below).

**Section: `DEPARTMENT MESSAGES`** · **B-roll only.** No behaviour change, but
any email preview in shot carries the old design.

### 06 — The Member Experience

**Section: `THE MEMBER DASHBOARD` (2:30 – 4:00)** · **Wrong.**

- The narration lists a **"Training Status"** widget with green/yellow/red
  certification health. **There is no such widget.** The dashboard has an hours
  row, department messages, notifications, two shift panels, upcoming events,
  recent activity, an ID card and an equipment panel. Rewrite the widget tour
  against the real page.
- **"My Shifts"** in the narration is two panels, not one: **My Upcoming Shifts**
  and **Open Shifts**. The Open Shifts panel is capped at five with an "N more"
  line — before 2026-08-10 it rendered every open shift in the next 30 days, which
  on a real department is dozens of rows and made the dashboard several thousand
  pixels tall. Any B-roll shot before that fix shows the long version.

**New section needed: reporting supplies you used.** · **Incomplete.**

This is member-facing crew work and it belongs in this guide, not in the chief's:

> Scheduling → Equipment Checks → **Apparatus Inventory**. Pick your rig, find the
> item, tap **−**. That is it — the count comes down and the supply officer sees
> it, without you starting a whole check or waiting for the morning.

Place it after the shift chapter. Two to three minutes. Worth saying out loud
that this needs no officer permission, because the entire point of the feature is
that the person who used the last one is the person who records it.

### 04 — Fire Chief & Department Leadership Guide

**Section: `DASHBOARD OVERVIEW` (2:00 – 3:30)** · **B-roll only** — same Open
Shifts cap as above.

**Section: the end-of-shift equipment-check toggle (~479–483)** ·
**Incomplete.**

Add a beat on the **supply worklist** (Scheduling → Supply). It answers a
question chiefs actually ask — what is about to expire on my apparatus, and is
there stock behind it — and it splits the list by whether an in-date lot is
actually available, because "swap it" and "order it" are different jobs. Mention
the weekly alert.

### 03 — IT Manager / System Admin

**Section: opening sidebar tour** · **B-roll only.**

**Consider adding:** the migration head moved to `20260810_0008`, and four of
those migrations were **renumbered** because two branches claimed the same
revision id. A duplicate revision id is not a merge conflict git can see — the
backend crashes on startup. If this guide covers upgrades at all, "run
`alembic heads` after merging" is a 20-second beat that saves somebody a bad
evening.

### 08 — Quick Tips & Shorts

**Existing shorts:** no corrections needed.

**Proposed new shorts**, all of which are 30–45 second single-action pieces —
which is what this format is for:

| ID      | Title                                                | The one action                                                                                      |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **8AA** | Change Your Email Footer Once, Not Thirty-Five Times | Communications → Email Templates → Footers, edit, save                                              |
| **8AB** | You Used the Last One — Tell the Truck               | Apparatus Inventory → find the item → tap **−**                                                     |
| **8AC** | Log a Whole Delivery in One Screen                   | Inventory → Manage Items → Receive Stock, four lines, one date                                      |
| **8AD** | Why Your Reorder Alert Never Fired                   | On-hand comes from **in-date lots** for anything stocked that way, and expired stock counts as zero |
| **8AE** | Three Boxes, Three Expiry Dates, One Bracket         | The lots sheet on a position — and why the date shown is the **soonest** aboard                     |

**8AD is the highest-value one in this list.** A consumable stocked purely
through dated lots used to sit at zero ready units and never trip its reorder
alert, because the alert read a `Quantity` field nobody maintains for lot-tracked
stock. Departments that have been quietly running out of things will recognise
the symptom immediately.

### 02 — First-Time Setup & Onboarding · 05 / 16 — Training Officer · 09–15

**No changes.** Checked against the 24-hour diff: nothing in these scripts'
subject areas moved, apart from cosmetic email styling that appears in none of
their B-roll.

---

## Standing note on the email B-roll

Any shot of a **sent email**, a **template preview**, or the **Email Templates
page** anywhere in the series now shows a design that no longer ships. The header
band, the page background and the table styling all changed on 2026-08-10, and
templates whose CSS was never hand-edited now track the built-in stylesheet
rather than carrying a frozen copy — so this will keep happening as the default
improves.

**Shoot email B-roll last**, and re-shoot it as a batch rather than per-script.
