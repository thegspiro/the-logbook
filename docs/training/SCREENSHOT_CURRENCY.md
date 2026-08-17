# Screenshot currency

## Flagged by the 2026-08-15 → 08-16 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-15_TO_16.md`](../CHANGE_AUDIT_2026-08-15_TO_16.md#documentation-and-media-disposition).
These are **not verified captures**; each remains open until the image is
opened and checked against its guide caption.

### SCREENSHOT NEEDED

- **Nested facility rooms** (guide 06, lesson 19): the Rooms section rendering
  a two/three-level tree with indented sub-rooms, per-room sub-room counts,
  and the add-a-room-inside row action. Seed one nested branch (e.g.
  Volunteer Office → Quartermaster's Storage).
- Room form with the **"Located inside" picker** open, demonstrating the
  room's own subtree is excluded from the options.
- **Delete-room confirmation** for a container room, showing the
  "sub-rooms move up a level" warning.
- **Cross-module room picker** (an event form) with indented sub-rooms and
  the containment path printed under a selected nested room.
- **Candidate list, member vs. manager** (guides 14, 19): the same election
  after nominations close from a member account (accepted only) and an
  `elections.manage` account (pending visible). Caption which is which.
- **Directory profile redaction** (guides 17, 19): the same colleague profile
  with `members.view` only (no MFA/verification/last-login/notification
  metadata, roles without permission lists) beside the `users.view` version.
  Use a demo member with MFA enabled so the difference is visible.
- **Hire-date restriction** (guide 19): profile edit rejecting a `hire_date`
  change without leadership/secretary/membership-coordinator permission,
  showing the explanation in the toast.

### REPLACE / re-verify

- `06-11-facility-detail.png` — re-verify: if the Rooms section is visible,
  it now renders a tree with sub-room counts, not a flat list. Replace if the
  old flat list shows.
- Any existing capture of the **room form** without the "Located inside"
  field, or of a **room picker** (events/training/scheduling captures) showing
  a flat, un-indented list — the picker now indents sub-rooms and shows the
  containment path.
- Any capture of a colleague profile that shows the account-metadata block
  (MFA, last login, timestamps) under a members-only viewing context.

### REPLACE — one image now; 38 more only when they are next re-shot

The themed background gradient moved from `body` to `html` so that it also
covers the browser's stable scrollbar gutter. Before that, the gutter showed the
browser's default canvas — against dark content, **a 15px white strip down the
right edge**.

All 429 images were checked with
[`scripts/screenshots/audit_images.py`](../../scripts/screenshots/audit_images.py)
(`--check edges`). **39 carry the strip**, and they split cleanly by how much it
matters:

| Tier                                     | Count | What changed                                                                     | Action                                                            |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Stark** — `10-11-public-form-dark.png` | 1     | Dark page: the white strip becomes a **dark** gradient. Plainly visible          | **Re-shoot.** It is the only `theme: "dark"` shot in the manifest |
| **Subtle** — 38 modal captures           | 38    | Light page under a dark modal overlay: white becomes a **pale** gradient at 15px | Leave. Fold in whenever the shot is re-taken for another reason   |

**The 38 are the instructive part.** They are light-mode pages; what darkens the
right edge is the **modal overlay**, which dims the viewport but sits inside
`body`, leaving the gutter — reserved on `html` — white behind it. So the trigger
is _dark content at the right edge_, not a dark page.

> **Correction (2026-08-16).** This section first said "exactly three, measured".
> That was wrong, and wrong in an instructive way: the first scan pre-filtered on
> **whole-image** brightness before looking at the edge, which quietly assumed the
> defect was a dark-mode one. Every modal capture is bright overall and dark
> exactly where it matters, so 36 of them were filtered out before the real check
> ran. **A filter that encodes the assumption you are testing will confirm it.**
> The script now compares the edge with the content beside it and never with the
> page average; run it rather than re-deriving the check by hand.

Cropped per-control shots never included the edge and are unaffected. **There is
still no set-wide re-shoot here** — the actionable list is one file.

Nothing else about the rendering changed — no layout, no spacing, no colour
inside the content area — so these three need only re-capture, not re-caption.

### SCREENSHOT NEEDED

- **Onboarding session expired, in two frames.** (1) The wizard reopened after a
  browser restart, showing previously typed answers repainted; (2) the
  session-expired error raised by the next step. Demo data: begin an onboarding
  run through the stations step, close the browser, reopen `/onboarding`, and try
  to continue. **Both frames are required** — either one alone teaches the wrong
  lesson, because the whole point is that a filled-in form does not mean a live
  session. Used by `08-admin-reports.md` and
  `19-august-2026-release-changes.md`.
- **A public page in dark mode at full window width**, on a page long enough to
  scroll (`/f/{slug}` or an application-status link). This is the standing proof
  that the canvas covers routes rendered outside the app shell, which is the
  reason the rule exists at all. Used by `19-august-2026-release-changes.md`.
- **Skills-testing printing, three shots** (added by the 2026-08-11 print pages,
  documented 2026-08-16 — the guide had no printing section until then):
  - The Templates tab row actions with **Print** visible, plus the resulting
    blank sheet in print preview. Demo data: one published template with at
    least two sections and a mix of criterion types (pass/fail, scored, timed),
    so the differing marking boxes appear in one frame.
  - A completed scorecard print preview showing per-step marks, the score
    arithmetic, and the validating officer's sign-off. Demo data: one validated
    official result with at least one failed step, so the deduction is visible.
  - The same scorecard as a candidate under `scores` disclosure sees it, with
    the examiner's notes absent. **Capture beside the officer version** — the
    pair is the teaching point; either alone is not.

The reason, data path, and edge cases for each are recorded in
[`../CHANGE_AUDIT_2026-08-10_TO_16.md`](../CHANGE_AUDIT_2026-08-10_TO_16.md#documentation-and-media-disposition).

## Flagged by the 2026-08-12 → 08-14 changes

The three-day connection audit identified the following capture work. These
are **not verified captures**; each remains open until the image is opened and
checked against its guide caption.

### SCREENSHOT NEEDED

- Saved-ballot picker showing the visible template name, item count, replacement
  warning, and action buttons; a separate before/apply/after capture of the
  election settings form demonstrates that settings were restored. Also capture
  the manual paper-ballot count on election results.
- Station-board dashboard and the admin-hours calendar-year/category summary.
- Store admin activity/status counts, order filters, open-banner toggle, and a
  member changing their own external payment method.
- Inventory temporary-issue deadline/overdue state and stock arithmetic showing
  why on-hand and available differ.
- Room QR Codes directory (search, print, PNG), the regeneration warning, and
  rank-backed apparatus crew positions.
- Event create/template reminder audience and Flexible 60-minute check-in state.
- Personal versus Organization dashboard tabs, directory-versus-scanner
  navigation, and personal-export field visibility before/after the Training
  setting changes.
- Event Settings outreach-form picker, training-session requirement/program
  linkage, and a related notification before and after automatic archive.

### REPLACE / re-verify

Replace any existing capture that shows the old dashboard, admin-hours
summary, store admin dashboard, Ballot Builder without saved settings,
free-text apparatus crew positions, old outreach-form discovery, or QR
navigation before the Room QR directory. Re-verify mobile captures containing
changed headers, dashboard cards, breadcrumbs, or actions at 375px; the 44px
touch-target fixes can change spacing even when the words are unchanged.

The reason, data path, and edge cases for each screen are recorded in
[`../CHANGE_AUDIT_2026-08-12_TO_14.md`](../CHANGE_AUDIT_2026-08-12_TO_14.md#documentation-and-media-disposition).

Which captured screenshots still match the application. Companion to
[SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md), which counts how many
placeholders are **filled**; this file records whether what was captured is still
**true**.

Kept separately because `SCREENSHOT_STATUS.md` is regenerated wholesale by
`scripts/screenshots/status_report.py` and anything hand-written there is lost on
the next run.

**Newest flags first: see _[Images invalidated by the 2026-08-11 → 08-12
changes](#images-invalidated-by-the-2026-08-11--08-12-changes)_** — the mobile
hamburger moved to the left edge (touches every phone-width capture with a
header) and the Ballot Builder grew a Save-as-Template control. Flagged
2026-08-12, not yet re-captured.

**Re-captured 2026-08-11.** The seventeen images flagged under _[Images
invalidated by the 2026-08-10 → 08-11 changes](#images-invalidated-by-the-2026-08-10--08-11-changes)_
were re-shot against a live stack, and every one of them was opened and read
against its caption afterwards. See _[The 2026-08-11
pass](#the-2026-08-11-pass)_ for what that found. The guides listed under _Not
re-captured_ below are otherwise unchanged and remain stale.

**Re-captured 2026-08-10.** The 02, 03 and 09 guides — 57 images — were shot
against a live stack rebuilt from current `main`. The three other guides listed
under _Not re-captured_ below still carry images from **2026-08-09 09:43 UTC or
earlier** and remain stale.

> **An earlier revision of this file said re-capture was impossible here**,
> because MariaDB and a Docker daemon were both absent. That was true of the
> container, not of the project: `apt-get install mariadb-server` supplies the
> database, and the pipeline runs fine without Docker. The claim is corrected
> rather than deleted because it is the sort of environment assumption that
> quietly becomes policy.

---

## The 2026-08-13 guide-by-guide re-verification

Every image below was **opened and read against its caption** before being
committed. Images that changed but were not opened are deliberately left
uncommitted rather than taken on trust — see the navigation incident below for
why that rule exists.

### The "Elected package with its tally" is three things on two screens

`01-membership.md:1156` asks for "the Elections module showing Alex Rivera's
election package with status **Elected**, vote tally (35-3), and the linked
prospect record". No single screen shows those together.

`ElectionPackageSection` renders the package status as a badge — `elected` gets
the same emerald treatment as `ready`, and the text is the status with
underscores swapped for spaces — inside the applicant drawer, beside the
applicant it belongs to. That covers the status and the linked prospect. **The
tally is not there**: vote counts live on the election results screen, which
guide 14 already photographs, and nothing joins the two.

So the caption needs splitting the way `09-18`'s did: the package badge in the
drawer, with the tally described in prose and cross-referenced to guide 14.

Reaching `elected` at all is the same seed problem as the ballot-send shot. The
seeded packages are `draft`; getting one to `elected` needs the package on a
ballot, the election closed, and results applied back. That is the same open
election the send shot needs, so the two should be built together rather than
seeded twice.

**All three remaining placeholders are now characterised** — none is a mystery,
each is a bounded piece of demo-data work, and two of them share a fixture.

### A currency survey after the main merges — the navigation is fine, guide 03 is not

Code changed under six guides since their images were captured. Checked in
order of blast radius:

**The navigation refactor is not a problem.** `SideNavigation.tsx`,
`TopNavigation.tsx` and a new `adminNavigation.ts` changed how admin
permissions are computed, and one item's gate moved from `forms.view` to
`forms.manage` — which could have altered the sidebar in every one of the ~420
images. Re-captured a representative admin page and compared: **the sidebar
renders identically** for the demo administrator. The only differences were
time drift ("3d in stage" to "6d in stage", notification badge 12 to 11), so
that capture was discarded rather than committed as churn.

**Guide 03 is the real exposure.** `SchedulingPage.tsx` plus a **new**
`SchedulingHeader.tsx` and the templates / patterns / platoons / settings /
admin-reports pages all changed, across 80 shots. A `--only 03-6` re-capture
produced 11 changed images out of 13.

Shots on routes whose components changed, as an upper bound rather than a
verified count:

| Shots | Guide             | Changed underneath                                                                                                                 |
| ----: | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
|    80 | 03 scheduling     | `SchedulingPage`, new `SchedulingHeader`, templates/patterns/platoons/settings/admin-reports, `shiftSettingsApi`                   |
|    67 | 02 training       | `CreateTrainingSessionPage`, `SubmitTrainingPage`, `TrainingLinkageFields`, `TrainingSessionLinkageCard`, `useTrainingLinkageData` |
|    22 | 04 events         | `EventForm`, `EventDetailPage`, `EventsPage`, `types/event.ts`                                                                     |
|    17 | 09 skills testing | `ActiveSkillTestPage`, `ScoreBreakdownPanel`, `SkillTemplateBuilderPage`, `skillTestTallies`, both print pages                     |
|    12 | 06 apparatus      | `ApparatusListPage`, `ApparatusDetailHeader`, `ApparatusFormPage`                                                                  |
|     2 | 08 admin          | `ErrorMonitoringPage`, `RoleManagementPage`                                                                                        |

`Breadcrumbs`, `PageTransition` and `CommandPalette` also changed, and they
appear across many guides — if their rendered output moved at all the exposure
is wider than the table.

Of the 11 changed guide-03 images, **only `03-63-batch-report-form` was opened
and is committed**; the other ten were reverted unopened. They are not wrong,
they are unverified, and the rule that has caught every real defect this session
is that those are not the same thing.

### Program phases carry no requirements, so the caption's counts come from elsewhere

`01-membership.md:1282` wants Phase 1 (Complete, 4/4), Phase 2 (In Progress,
0/6) and so on. A program's detail response — `GET
/training/programs/programs/{id}` — returns phases with `name`,
`phase_number`, `prerequisite_phase_ids`, `requires_manual_advancement` and
`time_limit_days`, and **no requirements at all**. So the fractions in the
caption cannot come from this screen; they belong to a member's enrolment view,
which is guide 02's territory and where `02-90-phase-prerequisites` already
looks.

That makes this the same split as `09-18` and `01-membership.md:1156`: the
program detail can show the phase structure and its gating, and the per-phase
progress belongs to a cross-reference. Confirm against the enrolment view before
rewriting the caption — this was established from the API shape alone, and the
screen has not been opened yet.

### The skip banner is right; the toast beside it is a demo artifact

The fixture works. `Operations Committee Seat — Restricted Ballot` is open with
its one item restricted to `operational`, and pressing Send Ballot Emails
produces exactly the banner the guide describes:

> **2 member(s) skipped when sending ballots** — Jonah Whitfield: membership
> type not eligible for 1/1 item(s) (requires: operational; member has:
> administrative). Bram Hollis: same.

**The first capture was thrown away, because the toast above the banner read
"Ballots sent to 0 voter(s), 20 failed, 2 skipped".** Email is not configured in
this demo, so every actual send fails. The skip logic is genuine and the banner
is exactly what a department would see; the failure count is an artifact of the
environment, and a reader shown "0 sent, 20 failed" under a caption about
skipped members would draw the wrong conclusion.

The fix was to wait the toast out. It is transient and the banner is not, so the
prepare step now waits for the count text to disappear before shooting. A
`selector` was tried first and abandoned — the banner is a plain div with no test
id and no role.

`allowEmptyState` is set for a real reason: the page also says "No votes cast
yet", which is correct for an election whose ballots went out seconds ago and is
not what this pictures.

Verified: the banner names Jonah Whitfield and Bram Hollis with the eligibility
reason, over the election that produced it, with no toast in frame.

Everything else is committed and working: the seeded election, the
`mutatesSeedData` flag (the manifest invariant caught the shot in the wrong
position on the first run and named all eleven shots that would have been
affected), and the caption rewritten against the two things that actually
report a send — a transient toast with the counts and a persistent banner with
the names.

### The demo department now has two membership types, and `/profile` was never going to give it one

The blocker below is cleared. Bram Hollis and Jonah Whitfield are
`administrative`; the other twenty stay `active`. Flipping two existing members
rather than adding two keeps "Members on file" at 22, which several captured
images state outright, and both were chosen because **no shot in `manifest.mjs`
mentions either name** — so a different membership type on them cannot silently
change an image already verified.

**The first attempt looked like it worked and did nothing.** The seeder patched
`/users/{id}/profile`, which is where its rank repair goes. `UserUpdate` has no
`membership_type` field, so the request was accepted and the value dropped —
the same shape as `supporting_statement` being sent top-level on an election
package. The tier change has its own endpoint,
`PATCH /users/{id}/membership-type`, which also validates the value against the
department's configured tiers. Worth the habit: when a write appears to succeed
and the value does not appear, check the schema on the route rather than the
column.

That unblocks the shared fixture. Next: an open election whose item restricts
`eligible_voter_types` to `operational`, which will now skip exactly these two
with a real reason.

### The ballot-send shot is blocked on the demo having only one membership type

`14-elections.md:352` needs a send that skips somebody. The skip reason is
generated by `_user_has_role_type`: an item restricted to
`eligible_voter_types` skips a member whose `membership_type` is outside it,
with the reason "Requires voter type(s): operational; member has:
administrative".

**All 22 seeded members are `active`.** So an item restricted to `operational`
skips nobody and one restricted to `administrative` skips everybody — neither is
the "N sent, M skipped" mix the shot is about. The demo department has no
administrative members at all, which is a seed gap beyond this screenshot: the
conversion modal offers "Administrative — Non-operational support role" as one
of two choices and nothing in the demo has ever taken it.

Two ways to close it, and they are not equivalent:

- **Flip two existing members to `administrative`.** No change to any count, so
  no other image is invalidated — but `membership_type` is displayed on member
  detail screens, so the two chosen would need checking against the shots that
  picture them.
- **Add two administrative members.** Cleaner in intent, but "Members on file"
  goes 22 → 24 and every image showing a member total or a full roster has to be
  re-captured and re-verified.

The first is the smaller blast radius and is probably right, but it is a
deliberate choice about the demo department's composition rather than a
mechanical fix, so it is recorded here rather than taken on a whim. Once there
are two membership types, the rest of the shot is already designed: a new open
election whose item restricts to `operational` (an open election refuses ballot
edits, so the restriction has to be set at creation), and a prepare step that
presses Send Ballots and waits for the banner — flagged `mutatesSeedData`, which
the manifest invariant will then force to the end of guide 14.

### The offline "Queued for sync" badge does not exist either

`03-scheduling.md` asked for an offline banner, a **"Queued for sync" badge on a
pending report**, and a count. Two of the three are real. Queued reports live in
IndexedDB and are never listed individually, so there is no per-report badge to
photograph — what exists is the banner, which carries `(N pending)` once
something is queued, and a second banner reading "Syncing N queued reports…"
while the queue drains. Caption corrected to the banner, with the other two
states described in prose.

**Faked offline in the page, not in the browser context.** `context.setOffline(
true)` would have been the obvious move and would have broken every shot after
this one: the context is shared across the run and nothing in the harness
restores it. `useOnlineStatus` reads `navigator.onLine` and listens for the
window events, both of which can be overridden inside the one page — and a
navigation resets it, so the fake cannot outlive its own shot. Confirmed by
re-capturing `03-61-review-queue-batch` afterwards, which came out unchanged.

### A merge left the database stamped at a revision that no longer exists

Merging the other session's work renumbered two migrations off main's new
`20260813` revisions, and the demo database was still stamped `20260812_0006`.
The backend then refused to start at all — correctly: "Refusing destructive
fresh-database initialization; restore the missing migration or repair the
revision explicitly."

Both renamed migrations had already run under their old ids, so the schema was
at head and only the label was stale. `alembic stamp` could not fix it (it
cannot resolve the current revision to move from); `alembic stamp --purge
20260813_0007` clears the version row and re-stamps, which is the repair the
error message is asking for. Worth knowing before anyone reaches for a database
drop after a migration renumber.

### The shift-report table guide 02 described does not exist

`02-training.md` asked for "the Shift Reports tab showing the batch of 26
reports filed for the Q2 drill, with columns for trainee name, apparatus, hours
(all showing 4), skills observed count, and approval status".

Three things were wrong with that. The tab is under **Scheduling**, not
Training — the same screen guide 03 already photographs. There is no per-drill
table of individual reports: the tab rolls them up **per crew member**. And the
columns are Crew member, Reports, Hours, Calls and Avg Rating — not one of the
five named.

Caption rewritten against the table that exists, with a note saying plainly that
the old columns do not, and `02-90-crew-summary-table` captured against it.
Verified: ten crew members, one report each, hours from 8.0 to 12.0, calls and
ratings per row.

### Groundwork on the last five: what each one actually needs

No images this pass — both candidates examined turned out to need seed work
larger than a tick, and guessing at it would have produced a picture that did
not match its caption. Written down so the next pass starts from the answer.

**`14-elections.md:352` — the ballot send confirmation.** The caption's "42
ballots sent, 3 skipped" is not what the screen says. `EmailBallotResponse`
carries `recipients_count`, `failed_count`, `skipped_count` and
`skipped_details`, and `ElectionDetailPage` renders a toast reading "Ballots
sent to N voter(s), M skipped (see banner below)" plus a **persistent banner**
listing each skipped member and reason. The caption should be rewritten against
those two, not the invented numbers.

Producing a skip needs an eligibility mismatch — the reasons are "No eligible
ballot items — role type and attendance did not match any item requirements" and
"Not eligible for any position … membership type does not match any position's
voter-type rules". So the seed needs an **open** election whose items restrict
`eligible_voter_types`, with members on file who fall outside it. Sending is a
real mutation, so the shot must be flagged `mutatesSeedData` and will be forced
last in guide 14 by the manifest's own invariant.

**`01-membership.md:1282` — the training program phases.** The caption asks for
Phase 1 (Complete, 4/4), Phase 2 (In Progress, 0/6), Phase 3 (Locked, 1/3
pre-credited), Phase 4 (Locked, 0/2) and a 25% bar — numbers from the guide's
worked example, not from any screen. The three seeded programs have two or three
phases each and **zero requirements in any phase**, so no progress fraction can
render at all. Filling this means seeding a four-phase program with 4/6/3/2
requirements and an enrolment part-way through it, or narrowing the caption to
what a program detail can show. The former is a day's demo data; the latter
should be a deliberate choice, not a silent one.

### A membership vote nothing could picture, and a field that silently discarded writes

`14-elections.md:843` wanted a membership approval ballot item. None existed
anywhere: every seeded ballot was position races and a bylaw amendment, and Sam
Okafor's election package was still `draft`, so the item type the whole
prospective-member pipeline exists to produce had never reached a ballot.

**The item had to go on a draft election, and that is correct.** An open
election refuses ballot edits — "Only `end_date` can be updated while voting is
active" — because a cast vote references an item id. So the seeder now creates a
draft _Membership Vote — August Business Meeting_ carrying the item, which is
also the order the guide's own workflow describes: package marked ready,
secretary adds it, then the election opens.

**The election detail page does not render Approve/Deny; the ballot preview
does.** `BallotPreviewModal` draws the item title, its description, and the
Approve / Deny / Abstain options; `ElectionDetailPage` only lists items and
offers **Preview Ballot**. The placeholder was retargeted at the preview, and
the prose corrected — it had promised "Approve/Deny" and the screen offers
Abstain too.

**`supporting_statement` is not a column.** It lives inside `package_config`,
and the API accepts a top-level `supporting_statement` on the package endpoint
while storing nothing. Two seeder runs "filled in" that field and the box stayed
empty, which is why `15-08-election-package` had always pictured an empty
Supporting Statement — the one part of a package that decides a membership vote.
Now nested correctly, and backfilled for a package that already exists, so the
panel and the ballot item quote the same words from one shared constant.

**Third time this session for the same trap.** The seeder skips a record that
already exists by name — templates, elections, packages — so anything added to a
blueprint afterwards never reaches a long-lived demo database. Each case has
needed its own backfill. Worth a general answer rather than a fourth one.

Verified: `14-23-membership-ballot-item` shows "Membership Approval — Sam
Okafor" with the coordinator's statement and Approve / Deny / Abstain, under the
BALLOT PREVIEW banner. `15-08-election-package` re-checked with the statement now
filled.

### The storefront Payments tab is unphotographable, and that is the correct design

`store_payment_events` rows are written from exactly one place — the public
PayPal webhook, which verifies every payload against PayPal's
verify-webhook-signature API before recording anything. The authenticated
storefront API offers `GET /payments` and apply/ignore; there is no create.

That is right for a ledger of what an external provider reported, and it means a
demo department has an empty Payments tab permanently. The placeholder is
retired with the reason written into the guide itself, alongside the elections
public ballot and the Salesforce connection.

### Next tick's groundwork on guide 14

`14-elections.md:843` wants an election detail page showing a **membership
approval** ballot item. None exists: the seeder creates elections with position
and bylaw items only, and Sam Okafor's election package is still `draft`, so it
has never reached a ballot. `BallotBuilder.tsx` does support the type
(`membership_approval`, labelled "Membership Approval"), and `ballot_items` is a
JSON column on the election, so seeding one is a bounded change.

One thing to settle when doing it: the placeholder also asks for "Approve/Deny
voting options", and `KNOWN_LIMITATIONS.md` already records that the in-app
ballot only renders position races. The admin detail page may show the item and
its supporting statement without any vote controls — in which case the caption
needs narrowing to what the page actually offers, the way `09-18`'s did.

### A repair pass that had never repaired anything

`09-skills-testing.md`'s read-aloud placeholder wanted a statement criterion
with the clock button. The seeder's blueprint declared a statement criterion,
and the database held **none** — because `seed_skills_testing` skips a template
that already exists by name, and the `_repair_criterion_types` pass written to
cover exactly that case walks `template["sections"]` on the **list** response,
which returns `section_count` and `criteria_count` and no sections at all.

So the pass iterated an empty list, found nothing to fix, and reported success.
It had been a no-op since it was written — which means the `"checkbox"`
criteria it exists to rewrite were still on file the whole time. Both passes now
hydrate each template from its detail endpoint first, and a new
`_backfill_missing_criteria` adds criteria the blueprint has gained since a
template was created, matching on label within section and never editing or
removing an existing one.

**A test snapshots the sheet it started with**, deliberately, so a candidate is
scored against what they were shown. That also meant the seeded in-progress test
could never show a criterion added afterwards. The seeder now compares the
snapshot against the live template and cancels a stale in-progress test so a
fresh one is made — safe in a demo database, where nobody is mid-evaluation.

`09-18-statement-starts-clock` verified: the read-aloud box, the START CLOCK &
READ button beneath it, and the line explaining that this statement is read
inside the time limit. The button only exists while the clock is stopped —
opening an in-progress test resumes the timer, so the shot pauses it first.

The placeholder had asked for two states in one image. Narrowed to the button;
the state after the tap is now described in prose beside it, since one image
cannot be both.

**Worth an owner's attention:** the demo database holds **50 completed skills
tests for one member** on one template, one per seeder run. Nothing pictures
them and nothing breaks, but the seeder is appending rather than topping up.

### The Sign Up button was documented as doing a check it does not do

`03-scheduling.md` asked for a screenshot contrasting an open shift with a
**Sign Up** button against one without, "because the member's rank doesn't
qualify". No such contrast exists to photograph: `Dashboard.tsx` renders the
button on every open shift and only fetches eligibility when it is pressed —
the expanded card then shows either a position dropdown or "Not eligible for
this shift."

Verified against the demo member: `nbelhaj` holds the `firefighter` rank, the
shift has three open positions (officer, driver, firefighter), and the dropdown
offers **Firefighter alone**. The filtering is real; it just happens a tap later
than the guide claimed.

Prose corrected, the rough edge written up in `KNOWN_LIMITATIONS.md`, and
`03-62-dashboard-signup-positions` now pictures the expanded card — the
dropdown the caption is about, with the unconditional Sign Up buttons on the
cards below it visible in the same frame.

### The applicant progress track was drawn in the wrong order, and Back never undid an advance

Opening `15-05-applicant-actions` to check its action bar caught two product
defects behind it, neither of them about screenshots.

**1. The progress track was drawn in whatever order the database returned.**
`step_progress` has no `ORDER BY`, and `mapProspectToApplicant` mapped it
straight through into `stage_history`, which the drawer draws as a
left-to-right progress track. For Jordan Fields the API returned sort orders
3, 0, 4, 5, 1, 2 — so the picture showed him finishing Background & Medical
before Application Received. The public application-status page already sorts
by `sort_order` and carries a comment explaining why; the drawer and the
election-package snapshot never got the same treatment. All three now sort.

**2. `regress_prospect` moved the pointer and nothing else.** It set the
previous step back to `in_progress` but left its `completed_at` stamp, and left
the step being vacated `in_progress` forever. The drawer counts stamps for
"N of 6 stages completed" and draws a green tick per stamp, so an applicant
sent **Back** to stage two still read as having completed it, with stage three
still drawn as live underneath — a Back click that visibly changed nothing.
Both are now cleared, and the test asserts the round trip: regress clears the
stamp, and advancing again puts one back.

**The demo database still carries the residue, and the images show it.** Six of
seven seeded applicants have `step_progress` rows that disagree with their
current stage — stages behind the pointer left `in_progress`, stages ahead of
it holding completion stamps — all written by the buggy regress before it was
fixed. It cannot recur, but it does not self-heal: the only API routes that
touch these rows are advance and regress, and normalising a stage _ahead_ of an
applicant requires advancing them onto it first, which for the vote stage
creates an election package and would change guide 14's images too.

So `15-05-applicant-actions` is committed with its ordering fixed and its
counter still reading "4 of 6 stages completed" for an applicant on stage four.
**That number is wrong and is known to be wrong.** Clearing it needs a decision
this loop should not take on its own — rebuilding the demo database from
`bootstrap_demo.py` would produce clean rows by construction, and would also
invalidate every one of the 415 images verified against the current one.

### 15-09-convert-modal, and prose describing three fields that do not exist

Re-pointed off `openApplicantDrawer("Riley Bishop")` — with the spread restored
Riley is no longer on the final stage, so the Convert button was not there to
click — and onto `openApplicantAtStage("Onboarding")`, the property the caption
is actually about. `15-05` was re-pointed the same way, at
`Background & Medical`, because both stage-movement buttons only render for an
applicant with somewhere to go in each direction.

`openApplicantDrawer` had no call sites left after that and is deleted.

Opening the result showed the guide listing **Membership ID** ("auto-generated
or manual entry") and **Roles** ("initial role assignments") among the modal's
fields. Neither exists in `ConversionModal.tsx`. It also described one screen
where there are two steps, and missed Middle Name, Hire Date, Emergency Contact
and Notes. Rewritten against the component.

### The same wrong inference in three components, and an email running through a phone number

`15-07-interview-form` pictured a panel headed "Current Stage: Application
Received" with **Application Received ticked as completed** two lines below it.
The applicant drawer had already been fixed for this; the interview page's
Pipeline Progress and the conversion modal's "Completed N of M stages" were
doing the same thing — deciding a stage was finished from the presence of a
`completed_at` timestamp. All three now read the progress record's own status,
which is the field that actually says so.

The same shot also had the applicant's email running straight through the phone
number in the next grid column. A flex child does not shrink below its content,
so any address longer than half the card overlapped its neighbour. `min-w-0` on
the row and `break-all` on the address; the icon no longer shrinks either.

### Two bulk-action bars, and a duplicate image pair

`15-11-table-bulk-actions` shows **two** bulk-action bars stacked, both reading
"3 selected", offering different sets of buttons from two different components.
The guide said "an action bar appears" and listed the buttons as
"**Advance** / **Advance All**" as though they were alternate labels. They are
two bars. The guide now says so, and the duplication is written up in
`KNOWN_LIMITATIONS.md` — which bar survives is a design decision, not one for
this loop.

`15-01-pipeline-board` and `15-04-kanban-board` are byte-identical: the kanban
board is the default view, and both captions genuinely describe it. A third
legitimate duplicate pair alongside the two already recorded below; no hash
sweep needs to re-investigate it.

### The destructive shot had drifted, and now the manifest refuses to let it

`15-09-bulk-action-result` runs a real bulk advance, and the comment beside it
says that is why it sits last among the 15-\* shots. It was fourth. Every shot
below it that finds its applicant by stage was matching against a board this
had already advanced — which is what `15-05-applicant-actions` was timing out
on, fifteen seconds of locator failure with nothing pointing at the cause.

Moved back to last, and the manifest now **throws at import** if a shot flagged
`mutatesSeedData` has any shot of the same guide after it. A comment did not
survive one unrelated edit; the invariant now fails loudly at the top of a
capture run instead of silently four shots later.

### 15-08-election-package was pointing at the wrong applicant, twice over

Its caption promises "an applicant at the vote", and the election-package
section only renders on an `election_vote` stage. Two separate things stopped
that being true, and the first hid the second:

1. **The seeder could not restore the spread.** `_spread_prospects_across_stages`
   only moved applicants _forward_, so once `15-09-bulk-action-result`'s real
   bulk advance had run, every applicant was parked at the final stage —
   permanently, across re-seeds. The manifest assumes a re-seed restores the
   mixed page; that only holds if the spread can move applicants back, which it
   now does via `/regress`. The board goes back to one applicant per stage.
2. **The shot named its applicant.** `openApplicantDrawer("Morgan Tran")` tied
   it to one seeding order. With the spread restored, Morgan Tran is at
   Interview. A new `openApplicantAtStage("Membership Vote")` matches the
   table's Current Stage column instead, so a different spread cannot silently
   point the shot at somebody who is not at the vote.

Verified: the drawer now shows Sam Okafor at Membership Vote with the ELECTION
PACKAGE section — status, name, membership type, coordinator notes and
supporting statement — over a board spread across all six stages.

`15-12-pipeline-stats` also verified: the four stat cards, Total Active 7.

### A regression I introduced, and the capture-order trap that exposed it

**I broke an endpoint two ticks earlier and only found it now.** Declaring
`program` on `ProgramEnrollmentResponse` — the fix for the dashboard's unnamed
pipelines — turned it into a serialization-time read, so any query feeding that
model without eager-loading it lazy-loads mid-await and answers **500**.
`get_member_enrollments` loads it, which is why the dashboard worked and the
gates stayed green; `get_program_enrollments` did not, so the program detail
view's Enrollments tab 500'd. The seeder caught it, not the test suite. Fixed,
with a test that asserts every enrollment-returning query selects the
relationship rather than asserting the one that bit us.

That is the same failure mode as the prospect-advance 500 I had just fixed —
introduced by me, one tick later, while fixing something else.

**The capture run mutates the demo data, and I forgot.**
`15-09-bulk-action-result` performs a real bulk advance; the manifest says so
beside it, says that is why it sits last among the 15-\* shots, and says the
seeder restores the mixed page. Re-running `--only 15-` several times without
re-seeding pushed six of seven applicants to the final stage, which is why
`15-08-election-package` came out showing an applicant at Onboarding under a
caption about the vote stage. Not a defect in the shot — a defect in how I ran
it. **Re-seed before capturing guide 15.**

### 15-prospective-members — the two "failures" are not the same kind of thing

**`15-02-board-truncated` is skipped by design, not broken.** It needs a
pipeline past the board's 200-card ceiling, which the ordinary seed
deliberately does not create — the manifest says so beside the entry and points
at `seed_demo_data.py --bulk-prospects`. Nothing to fix; it is capturable on
demand.

**`15-13-application-status` cannot be captured the way it is written.** Its
prepare step reads the applicant's `status_token` from the prospect detail
response, and the comment beside it still says "the token is only on the
prospect _detail_ response — the list omits it". That stopped being true: a
security fix removed `status_token` from responses entirely, because it is the
credential behind the public application-status page and was leaking into the
kanban board. The tokens exist — all seven applicants have one in the database —
but nothing over the API will hand one out, and it should not.

So the shot needs a different route to a status URL (minted server-side by the
seeder and passed to the capture, the way `10-11-public-form-dark` resolves its
slug), or it needs retiring. Not decided here; recorded so the next tick does
not re-diagnose it.

**The board spread is improved but still not even.** `_spread_prospects_across_stages`
now advances applicants who are behind their target stage, recording a real
interview where the stage demands one rather than skipping it — a skip is a
different thing and shows on the applicant's progress track. That took the board
from two occupied stages to four. It cannot pull anyone _back_, so the first two
stages stay empty until either more applicants are seeded or the existing ones
are regressed.

### 15-prospective-members — in progress, and it found the advance bug's real cost

`15-01-pipeline-board` and `15-14-applicant-drawer-overview` are populated now
that the pipeline has stages, and their empty-state flags are the same false
positive as guide 01's (some columns legitimately read "No applicants";
a drawer for an applicant with no uploads reads "No documents yet"). Suppressed
with that reasoning beside the entries.

**`15-09-bulk-action-result` was displaying the 500 verbatim.** Its toast read
"Skipped 7: Rosa Delgado (**Action failed**); Morgan Tran (Prospect is already
at the final stage) … and 4 more" — every one of seven applicants refused, four
of them by the MissingGreenlet crash. So the advance bug was not an edge case:
it blocked the whole bulk workflow, and this screenshot was documenting it as
normal behaviour.

Fixed rather than filed. The audit that entry said was needed turned out to be
one line long: `_validate_step_completion` reads exactly one relationship that
`get_prospect` did not eager-load, `interviews`. Adding it lets the validator
actually run, and the endpoint's existing `ValueError` → 409 handling does the
rest. The toast now reads "This step requires at least 1 interview(s); only 0
recorded." — a real business-rule answer instead of a crash. A second test
guards the audit rather than the single relationship, failing if the validator
ever reads another unloaded one.

Two shots still failing, both about seed data rather than code:
`15-02-board-truncated` (`locator.waitFor` timeout — the board needs more
applicants than fit a column) and `15-13-application-status` ("no applicant
carries a status token").

The board's spread is also lopsided — four in Interview, three in Onboarding,
three stages empty — because the seeder's advance loop only ran for
newly-created prospects, and the ones already in the database could not be
moved while advance was crashing. Now that it returns a proper 409, spreading
them needs interviews recorded first.

### 01-membership — images complete, 19 of 19 verified

The last five opened and current: `01-05-add-member-form`,
`01-06-import-members`, `01-07-admin-member-edit`,
`01-08-member-audit-history`, `01-36-membership-number-field`. Nothing in them
contradicted its caption — the import page's nine-step instructions match the
validation the review screen actually applies, and the edit form's
"Exempt from Compliance" control carries the explanation the guide relies on.

Guide 01's **two placeholders remain open** and are the only outstanding work
here: an election package showing status "Elected" with a 35-3 tally and a
linked prospect record, and a training-program phase view (Phase 1 Complete
4/4, Phase 2 In Progress 0/6, Phase 3 Locked 1/3 pre-credited, Phase 4 Locked
0/2, overall 25%).

### 01-membership — earlier tick, 14 of 19 changed images verified

Seven more opened and current: `01-01-member-directory`, `01-11-create-waiver`,
`01-19-create-waiver`, `01-23-print-member-badges`,
`01-24-delete-member-modal`, `01-32-duplicate-applicant-warning`,
`01-33-import-review-rejected-rows`. Each shows what its caption promises —
notably the delete modal's Deactivate/Permanently Delete split with its
records-affected counts and type-to-confirm, and the import review's four
rejected rows with a per-line reason apiece.

**A third legitimate duplicate pair.** `01-11-create-waiver` and
`01-19-create-waiver` are **byte-identical** — same md5, same
`/members/admin/waivers` route, two guide locations describing the same form.
Recorded here alongside `03-15`/`03-32` and `03-02`/`03-08` so a future hash
sweep does not re-investigate it.

Still to verify: `01-05-add-member-form`, `01-06-import-members`,
`01-07-admin-member-edit`, `01-08-member-audit-history`,
`01-36-membership-number-field`. Guide 01's two placeholders are also still
open.

### 01-membership — earlier tick, 7 of 19 changed images verified

Beyond the three below: `01-02-member-profile` (compliance summary, training,
contacts, employment — all populated), `01-22-member-lifecycle` (already
re-captioned by an earlier pass as the Members Admin hub, and matches),
`01-30-evoc-operator-modal` and `01-35-applicant-drawer-final-stage`.

Both of the last two were flagged as empty states and both are **false
positives**, now suppressed with the reasoning recorded beside the entry:

- `01-30` — "No EVOC level" is the select's placeholder option, present in the
  DOM on every operator including this one, which has Level 1 selected and its
  certification and licence dates filled.
- `01-35` — "No checklist data recorded yet" is the Checklist Progress section
  for an applicant whose onboarding checklist has not been started. The shot is
  about reaching the **final** stage and the **Convert** action it unlocks, and
  both render, along with two uploaded documents.

Still to verify, changed but not yet opened: `01-01-member-directory`,
`01-05-add-member-form`, `01-06-import-members`, `01-07-admin-member-edit`,
`01-08-member-audit-history`, `01-11-create-waiver`, `01-19-create-waiver`,
`01-23-print-member-badges`, `01-24-delete-member-modal`,
`01-32-duplicate-applicant-warning`, `01-33-import-review-rejected-rows`,
`01-36-membership-number-field`. Guide 01's two placeholders are also still
open.

`01-11` and `01-19` are a duplicate pair — both resize 920→938 identically —
and should be checked together when they are opened.

### 01-membership — the "No applicants" gap, closed

Three shots (`01-10-prospective-pipeline`, `01-25-applicant-action-bar`,
`01-26-print-applicant-badges`) pictured an empty board while seven active
applicants sat in the database. **The pipeline had no stages at all.**

The seeder does send a `steps` payload — but only when it _creates_ the
pipeline, and the guard above that skips creation once a pipeline of the same
name exists. A database seeded before that payload was added therefore keeps a
stage-less pipeline forever, and a pipeline with no stages has no board columns,
so no applicant can be placed. `_backfill_pipeline_stages` now repairs an
existing pipeline, idempotent on the state.

All three images are correct now: the board shows Total Active 7 with cards in
Interview, the bulk bar shows "3 selected" with Print Badges / Advance All /
Reject All, and the drawer shows Rosa Delgado's stage, linked event, interview
requirement and full action bar.

The empty-state flag on these three is a **false positive** and is now
suppressed with a note: a board that spreads seven applicants across six stages
necessarily leaves columns reading "No applicants", and a drawer for an
applicant who has uploaded nothing reads "No documents yet". Neither means the
page is empty — the check is Total Active.

**A 500 found on the way, not yet fixed.** `POST /prospects/{id}/advance` returns
500 rather than a handled error when the target stage is an
`interview_requirement`: `_validate_step_completion` reads
`prospect.interviews`, a lazy relationship, inside async context, and SQLAlchemy
raises `MissingGreenlet`. The endpoint maps `ValueError` to 409 but nothing
catches this. Advancing anyone out of the Interview stage — the third stage of
the default pipeline — hits it. Recorded in KNOWN_LIMITATIONS.

### 00-getting-started — complete, 11 of 11 changed images verified

Third tick closed it out with `00-07-dashboard-panels`: current, and its
resize is content growth rather than layout. Guide 00 is done.

**What appearing in three images finally prompted.** The Department Overview's
**Training Compliance 0%** sits next to "252 hrs last 30 days", which reads as a
contradiction. It is not a bug: `compute_org_compliance_pct` counts members who
satisfy **every** active requirement, and the demo department has 36 of them, so
0% is arithmetically right and the hours figure beside it is unrelated. Left the
computation alone and documented the card instead — the same call as the
"Failed 100%" finding: correct, deliberate, and easy to misread. The guide's
stats list also said "training completion rates", which named it as something
it is not.

### 00-getting-started — earlier ticks, 10 of 11 changed images verified

Second tick added five: `00-09-account-settings`, `00-16-sidebar-admin`,
`00-17-account-settings`, `00-19-change-password`,
`00-22-notification-card-expanded` — all current. Only
`00-07-dashboard-panels` is still unopened.

**What `00-16-sidebar-admin` exposed.** The guide's Administration table had
drifted from the navigation in four ways, checked against `SideNavigation.tsx`
rather than against the picture: **Store Admin** and **Admin Hours** were
missing entirely, **Forms** is now **Forms & Comms** with Email Templates,
Messages, Forms and Integrations under it, and **Integrations** was listed as a
top-level item when it is nested. Table rewritten.

**What `00-09` and `00-17` exposed.** They are the same picture — `/settings/account`
and `/account` are aliases for one page. That is fine, but `00-09`'s caption
promised "profile, notification preferences, and password sections", and those
are separate **tabs**, not sections of the page shown. Caption corrected in both
the guide and the manifest. Unlike the `03-15`/`03-32` and `03-02`/`03-08`
pairs below, this one was not previously recorded.

### 00-getting-started — first tick, 5 of 11 changed images verified

| Image                      | Verdict                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `00-04-dashboard-overview` | current; gained the Learning Center nav item                      |
| `00-14-confirm-dialog`     | current; in-app dialog with named buttons, as the guide describes |
| `00-15-sidebar-member`     | current; the new Learning Center row is the whole diff            |
| `00-18-rsvp-modal`         | current                                                           |
| `00-20-member-dashboard`   | **was wrong** — see below                                         |

Three images were byte-identical and needed nothing: `00-01-login-page`,
`00-21-login-sso-options`, `00-23-login-two-factor`.

Still to verify, changed but not yet opened: `00-07-dashboard-panels`,
`00-09-account-settings`, `00-16-sidebar-admin`, `00-17-account-settings`,
`00-19-change-password`, `00-22-notification-card-expanded`.

**What `00-20-member-dashboard` exposed.** Its My Training Progress card listed
two enrollments both labelled the literal word **"Program"**, so a member on two
pipelines could not tell them apart. `get_member_enrollments` eager-loads the
programme relationship, but `ProgramEnrollmentResponse` had no field to put it
in, so it was dropped on the way out and the dashboard's `program?.name` fell
back to its placeholder every time. The member training print-out showed an em
dash for the same reason. Fixed by declaring the field the eager-load was
already paying for.

**What `00-15-sidebar-member` exposed.** The guide's sidebar table had no row
for **Learning Center**, which now sits second in the nav. Added.

---

## The 2026-08-13 currency audit — what a full pass found

A full re-capture was run to answer "are the committed images still true?". It
did not get as far as answering that, because it first exposed three things
that made every previous full pass untrustworthy. All three are fixed; the
re-capture itself is being redone guide by guide, verifying each image before
committing it.

### The harness was rendering the wrong navigation

`08-62-topnav-bell-badge` switches the app to the top navigation bar by writing
`navigationLayout` to `localStorage`, to photograph a bar that is not the
default. It never put it back, and `capture.mjs` reuses one page for every shot
of a given auth mode — so **every admin-authenticated shot captured after it
rendered with the top bar instead of the default left sidebar.**

Silent, and dependent on manifest order, which is why it had never shown up: a
narrow `--only` run does not reach 08-62 before the rest, and only a full pass
does. It surfaced as 46 images having grown by _exactly_ 65px — too uniform to
be content, and it turned out to be the sidebar-to-top-bar swap.

Fixed by clearing the key before every shot, so ordering cannot matter. 187
images had already been committed from the contaminated pass; that commit was
reverted.

**Lesson for this file: a byte diff is not verification.** The contaminated
images were all "changed", and every one of them looked plausible on its own.
What gave it away was the _shape_ of the change being identical across
unrelated guides.

### Two seeding problems that read as capture failures

Captures against stale or half-seeded data fail as bare `locator.click`
timeouts that name nothing. Both of these cost an hour before being traced:

- `GET /training/module-config/config` answered **500** for the demo
  organization, which aborted the shift-report seed step, which left the shift
  report shots with nothing to click. Fixed — see the 2026-08-12 entry in
  KNOWN_LIMITATIONS' sibling commit history.
- The TOTP account added for the two-factor login shot was `rduarte`, which is
  `DEMO_PEER_EXAMINER_USERNAME`. Several seed steps sign in as it, and a
  password sign-in on an MFA account returns no session, so three steps failed
  with 401s. Moved to an account nothing signs in as, with an assertion that
  fails at seed time if it is ever pointed at a login identity again.

**Always re-run `seed_demo_data.py` after a container restart, and require it
to finish with no failures before trusting a capture.**

### Genuine capture failures still outstanding

Seven shots failed for their own reasons rather than as fallout. (A long tail
of `Target page, context or browser has been closed` in the same log is not
real — that is the run being stopped.)

| Shot                          | Failure                          |
| ----------------------------- | -------------------------------- |
| `03-56-bulk-confirm-shifts`   | `locator.waitFor` timeout        |
| `03-58-assign-member-form`    | `locator.click` timeout          |
| `02-88-member-checklist-view` | `scrollIntoViewIfNeeded` timeout |
| `02-89-officer-only-steps`    | `scrollIntoViewIfNeeded` timeout |
| `08-55-audit-medical`         | `selectOption` timeout           |
| `15-02-board-truncated`       | `locator.waitFor` timeout        |
| `15-09-bulk-action-result`    | `locator.waitFor` timeout        |

### A seed gap: the prospect pipeline is empty

Four shots across guides 01 and 15 flagged **"No applicants"** —
`01-10-prospective-pipeline`, `01-25-applicant-action-bar`,
`01-26-print-applicant-badges`, `15-14-applicant-drawer-overview`. Earlier in
the same session `15-14` flagged the much narrower "No documents yet", so the
pipeline had applicants then and does not now. Whatever seeds prospects is
either not running or not surviving. Not yet diagnosed.

---

## Images invalidated by the 2026-08-11 → 08-12 changes

**Flagged 2026-08-12, not yet re-captured.** Two UI changes landed after the
2026-08-11 passes and reach existing images. Flagged by comparing each image's
subject against the commits, not by opening them.

### A. The mobile hamburger moved to the left edge

`SideNavigation`'s phone header now puts the ☰ button at the **left** edge
(the edge the drawer slides in from) with the logo/department name to its
right; it was previously at the far right. The component renders the top bar
of **every authenticated page on a phone**, so every phone-width capture that
includes the top bar now shows an outdated header:

| Image                                                                               | Why it's in frame                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `10-04-mobile-dashboard`                                                            | fullPage, header at top                                    |
| `10-05-mobile-inventory`                                                            | header at top                                              |
| `10-06-mobile-inventory-admin`                                                      | fullPage, header at top                                    |
| `10-10-mobile-minimum-text`                                                         | header at top                                              |
| `10-15-mobile-menu-notifications`                                                   | shot _of_ the open menu — the button itself is the subject |
| `10-14-scan-camera-denied`                                                          | viewport-anchored, header at top                           |
| `03-48-settings-phone`, `03-73-flat-check-form-header`, `03-95-apparatus-inventory` | top-anchored phone shots                                   |

**Not invalidated, recorded so nobody re-checks:** `10-12-mobile-bottom-nav`
(clipped to the bottom nav element), `03-71-set-all-to-par-confirm` (dialog
clip), `04-32`/`04-33` guest sign-in (public `/login` renders outside
`AppLayout` — no hamburger), and mid-page clips that never reach the top bar
(`03-60`, `03-70`, `03-72`, `03-96` — verify by opening before re-shooting).

The training guide's new header note carries a matching
`[SCREENSHOT NEEDED]` for the re-shoot.

### B. The Ballot Builder grew a "Save as Template" button

`14-04-ballot-configuration` pictures the Ballot Builder, which now shows
**Save as Template** beside its actions whenever the ballot has items (and the
template picker gained a "Your saved ballots" section). The whole guide-14 set
was already listed under _Not re-captured_ as cosmetically stale; `14-04` is
now **structurally** stale, and two new placeholders in
`14-elections.md` (the save form, the saved-ballots picker) have never been
shot. Note for the harness: the saved-templates picker needs a seeded saved
template — `seed_demo_data.py` does not create one yet.

### C. Checked and not invalidated

- **The responsive sweeps (08-11)** are scoped under 768px, so the existing
  desktop captures are unaffected. The two everywhere-width changes have no
  captures to invalidate: the Member Training Status page (gained its page
  gutter) has no shot in the manifest, and no facility detail page is shot at
  phone width.
- **The confirm-dialog sweep** replaced _native_ browser dialogs, which
  Playwright could never photograph anyway; `00-14-confirm-dialog` pictures
  the in-app dialog, which is the surviving pattern.
- **`02-104-cohort-preview-step`** was captured in the same commit that fixed
  the holiday-chip date format it pictures, so it is already current.

---

## What re-capturing exposed

Eight defects, plus two in the harness itself. None were reported by the
capture run: it listed **26/26 captured, 0 flagged** for a batch containing two
images showing the opposite of their captions. Its empty-state check can tell
that a page rendered, not that it rendered the thing the caption promises.

| Defect                                                                                                                                           | Found by                                                          | Fix                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platoon Management captioned "platoon columns and their members", showing a "platoon scheduling is turned off" banner over one Unassigned column | Opening the image                                                 | Seeder enables platoons and deals the roster A/B/C                                                                                                                                                                                                             |
| Scheduling Settings showed six sections against documentation describing seven                                                                   | Same — Platoons is hidden while the feature is off                | Same fix                                                                                                                                                                                                                                                       |
| `03-14` captioned "compliance report", showing an empty date picker                                                                              | Opening the image                                                 | `prepare` step drives the Shift Compliance tab                                                                                                                                                                                                                 |
| `09-10`, `09-11`, `09-12` timed out on an empty validation queue                                                                                 | Capture failure, then tracing it to the data                      | Peer examiner was a **lieutenant**, whose rank grants `training.manage`, so their submission self-validated. Switched to a firefighter; the seeder now asserts it                                                                                              |
| `02-21` and `02-41` were **byte-identical**, both shooting the default tab under two different captions                                          | Hashing the whole image set                                       | Both routes now carry `?tab=`                                                                                                                                                                                                                                  |
| `04-20` and `17-01` byte-identical to _other_ shots — hub routes defaulting to another tab                                                       | The same MD5 sweep, set aside at first as another guide's problem | Both carry `?tab=`. `17-01` needed a second fix: `/settings/account` is a `<Navigate>` with no query, so React Router dropped `?tab=` on the redirect and the shot stayed on the Account tab while the harness reported success. Uses the canonical `/account` |
| Expiring Certifications permanently empty                                                                                                        | Fixing the route above                                            | The seeder's own comment promised near-future expiries; its arithmetic put the earliest at **TODAY + 233 days**, so none of the 66 records could enter the 90-day window                                                                                       |

### Two defects in the harness

Both surfaced by images, and both had been costing accuracy silently:

- **A false positive held back a correct screenshot.** The empty-state check
  scanned the whole page as one blob, so `17-01` was flagged on its own help
  text — "These are optional — _nothing here_ is required for membership."
  Prose, not an empty state. It now matches per line and only on lines short
  enough to _be_ the message, which is what distinguishes a standalone
  "No Integrations Yet" from the same words mid-sentence.
- **A false negative let an empty page through.** The pattern required the
  phrase to end in found/yet/scheduled/available/to show, so
  "No certifications expiring within 90 days" scanned as populated — which is
  exactly why the empty expiring-certs page reported `empty=False` and was
  publish-eligible while showing nothing. Line scoping makes a whole-line
  "No …" safe to match, so that gap is closed.

### Two duplicate pairs are legitimate

`03-15` / `03-32` (settings defaults to `?tab=general`) and `03-02` / `03-08`
(the Calls / Runs section lives inside the shift detail panel) are genuinely one
screen satisfying two captions. Recorded so a future hash sweep does not
re-investigate them.

### A product bug these images display

`03-14` shows **"Total Members 66"** for a 22-member department.
`SchedulingReportsPage.tsx` computes that card as
`complianceData.reduce((sum, r) => sum + r.total_members, 0)` — a sum of
per-requirement cohorts, so a member counted under three requirements counts
three times. The Compliant and Non-Compliant cards sum the same way: the values
are member-requirement pairs, the labels claim members.

**Not fixed here.** The payload carries no distinct-member count, so correcting
it means either relabelling the cards or adding a field to the API — a product
decision, not a screenshot one. The image accurately shows current behaviour;
this note exists so the guide does not silently endorse the number.

### Held back deliberately

`02-68-vector-category-mapping` still has nothing to photograph. Category
mappings are created **only** by `POST /providers/{id}/sync-categories`, which
fetches the live vendor catalogue over the network — there is no create
endpoint the seeder could call, so the table stays empty however much demo data
is added. The harness flags the shot and does not apply it, and it is **not
committed**, so the guide keeps its unfilled placeholder rather than gaining a
picture of an empty table under a caption describing a full one.

**Resolved 2026-08-12 for `02-42-external-integrations`.** That one was empty
for a reason the seeder _could_ fix — the demo department had no provider
configured at all. `seed_external_provider` now saves one, and the shot is
captured and applied. Only the configuration is seeded: `connection_verified`
and `last_sync_at` are written by a real sync, so the card reads "Connection
not verified" and "Last Sync: Never", which the guide's prose now explains
rather than contradicts.

### Salesforce cannot be connected in a demo department, and that is correct

The Salesforce Sync panel is real and worth a picture, but it renders only for
an integration whose status is `connected`, and `POST
/integrations/{id}/connect` will not grant that. `instance_url` must match
`^https://[a-zA-Z0-9\-\.]+\.salesforce\.com$` **and** resolve in DNS — the SSRF
guard calls `getaddrinfo` on it. A Salesforce instance host is per-customer
(`oakvillefd.my.salesforce.com`), so the demo department's does not exist and
never will.

**Deliberately not worked around.** The hosts that do resolve —
`login.salesforce.com`, `test.salesforce.com`, `na1.salesforce.com` — are login
and pod hosts, not any department's instance, and seeding one would put a URL
in the demo database that is wrong in a way a reader could copy. That is a
different case from `seed_external_provider`, where the vendor's real API host
_is_ the value every customer uses.

The section's prose has been corrected against the code instead, so the guide
describes the panel accurately without a picture of it.

### A seed gap that wasn't — the quantity checklist was reachable all along

**Withdrawn 2026-08-12, the day after it was written.** This section claimed
three 03-scheduling placeholders — the carry-over banner, the Set All to Par
confirmation, and the flat check form on a phone — were unreachable because the
only template with quantity items is bound to **M-3** and `seed_scheduling`
rosters shifts onto `fleet[:3]` only. The premise about the roster is true. The
conclusion drawn from it was not.

**A check does not need a shift.** `MyChecklistsPage` has an **Unscheduled
checklist** button that offers every active template and starts a check with no
shift attached — the same standalone-check feature the guide documents two
sections further down. All three shots were captured through it with no seeder
change at all, and they are now applied.

The mistake was reasoning from `/equipment-checks/my-checklists` (which is
shift-derived, and was correctly read) to "the screen is unreachable", without
reading the page that renders it. Recorded rather than deleted because the
cheap check — open the page and look at what else is on it — is the one that
was skipped.

**What was genuinely missing** was smaller and got fixed here: no seeded
template had a **section header**, so the bold in-compartment caption the guide
documents could not be pictured and the renderer had never met one in demo
data. `_add_section_header` now puts one on the engine checklist.

---

## Not re-captured

These guides still carry pre-2026-08-09 images. Everything in them is at least
**cosmetically** stale: the 2026-08-10 form-control sweep touched 103 files
across every module, so any screenshot containing a text input, select or
checkbox differs from the current build in control padding, corner radius,
checkbox size and focus ring.

| Guide                        | Captured |
| ---------------------------- | -------: |
| `00-getting-started.md`      |        4 |
| `01-membership.md`           |        9 |
| `04-events-meetings.md`      |       10 |
| `05-inventory.md`            |       18 |
| `06-apparatus-facilities.md` |       13 |
| `07-documents-forms.md`      |       13 |
| `08-admin-reports.md`        |       11 |
| `10-mobile-pwa.md`           |        5 |
| `11-finance.md`              |       12 |
| `12-grants-fundraising.md`   |       10 |
| `13-medical-screening.md`    |        5 |
| `14-elections.md`            |        7 |
| `15-prospective-members.md`  |       11 |
| `16-integrations.md`         |        1 |
| `17-privacy-data-rights.md`  |        2 |
| `18-storefront.md`           |        4 |

`10-mobile-pwa.md` is the most affected of these: it shoots at phone width,
where the sweep's 44px minimum control height changes layout rather than just
appearance.

---

## Verification method

Captured images were checked **by opening them and reading them against the
caption they fill**, not by trusting the harness's exit code — every defect
above survived a green capture run. Two whole-set screens ran alongside that:
an MD5 pass for duplicate files, which is what caught `02-21`/`02-41`, and a
colour-uniformity pass for blank or near-blank pages.

Not every one of the 57 was opened individually. Priority went to the
structurally-changed screens, every shot carrying a `prepare` step, and anything
either screen flagged.

---

## Superseded — the 2026-08-09 staleness audit

The table below is the pre-re-capture analysis, kept for the reasoning rather
than the verdicts.

Every **Structural** row was re-captured successfully. Four —
`09-07`, `09-08`, `09-09` and `09-12` — produced **byte-identical** output, so
they do not appear in the commit diff. That is not the same as "not
re-captured": those screens already matched the current build, and the shots had
been failing for a data reason rather than a rendering one. `09-12` is the clear
case — it timed out before the examiner fix and captures cleanly after it, while
rendering exactly the same pixels, because the stale file on disk had been shot
when a pending validation happened to exist.

Worth stating because a diff-based reading gets it backwards: an unchanged image
file after a successful re-capture is the _good_ outcome. It means the screen was
already current.

## Structural — re-capture first

| Image                                     | Screen                        | What changed                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `03-15-scheduling-settings.png`           | `/scheduling/settings`        | Rebuilt onto the shared settings layout: section sidebar on desktop, tab strip on phones, single header replacing two stacked titles                                                                                                                               |
| `03-32-settings-general-closeout.png`     | `?tab=general`                | Same, plus the Save/Reset footer now appears only on General, Apparatus and Equipment                                                                                                                                                                              |
| `03-34-settings-checklist-timing.png`     | `?tab=shift-reports`          | Same layout change; Shift Reports no longer shows the page-level Save footer                                                                                                                                                                                       |
| `03-35-settings-form-sections.png`        | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-36-settings-apparatus-skills.png`     | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-37-settings-rating-scale.png`         | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-38-notifications-assignment.png`      | `?tab=notifications`          | Same layout change, plus the preset toggles are now labelled switches with a disabled treatment and an error state when the rules fail to load                                                                                                                     |
| `03-39-notifications-reminders.png`       | `?tab=notifications`          | Same                                                                                                                                                                                                                                                               |
| `03-40-settings-position-eligibility.png` | `?tab=eligibility`            | Same layout change                                                                                                                                                                                                                                                 |
| `02-09-program-detail.png`                | `/training/programs` → detail | Gained the per-requirement **prerequisite** toggle, the checklist step list, and the reminder-schedule editor                                                                                                                                                      |
| `02-11-pipeline-wizard.png`               | Create-pipeline wizard        | Structure picker is **Phases / One list** ("Sequential" retired); checklist requirements now have a steps editor with per-step visibility                                                                                                                          |
| `09-*` (11 images)                        | Skills testing                | The scoring screen was rebuilt — 44px section chips replace progress dots, candidate name added to the header, scored/total and save-status lines added, **Next** replaces **Finish** as the primary bottom-bar button. Test Records rows now read "Tap to resume" |

## Cosmetic — the rest

All remaining images. Guides, with the count of captured images each:

| Guide                        | Captured | Backing screens touched by the 2026-08-09/10 sweep                      |
| ---------------------------- | -------: | ----------------------------------------------------------------------- |
| `00-getting-started.md`      |        4 | Login, Dashboard, Account Settings                                      |
| `01-membership.md`           |        9 | Members, Add Member, prospect drawer                                    |
| `02-training.md`             |       21 | Most training pages (see structural rows above for two)                 |
| `03-scheduling.md`           |       26 | Scheduling page and its tabs, shift detail panel, equipment-check pages |
| `04-events-meetings.md`      |       10 | Events list/detail/edit, minutes                                        |
| `05-inventory.md`            |       18 | Allowances, item detail                                                 |
| `06-apparatus-facilities.md` |       13 | Apparatus, locations, facilities sections                               |
| `07-documents-forms.md`      |       13 | Forms                                                                   |
| `08-admin-reports.md`        |       11 | Reports, action items, org settings, error monitoring                   |
| `09-skills-testing.md`       |       11 | **See structural**                                                      |
| `10-mobile-pwa.md`           |        5 | Multiple, at phone width — most affected by the 44px control minimum    |
| `11-finance.md`              |       12 | Finance settings, approval chains, check requests                       |
| `12-grants-fundraising.md`   |       10 | Grants pages                                                            |
| `13-medical-screening.md`    |        5 | Screening record and requirement forms                                  |
| `14-elections.md`            |        7 | Elections list/detail/settings, ballot voting                           |
| `15-prospective-members.md`  |       11 | Pipeline board, settings, interview page                                |
| `16-integrations.md`         |        1 | Integrations catalog                                                    |
| `17-privacy-data-rights.md`  |        2 | Account settings                                                        |
| `18-storefront.md`           |        4 | Product form, store settings                                            |

---

## Images invalidated by the 2026-08-10 → 08-11 changes

**Read this before trusting the "Re-captured 2026-08-10" note above.** That pass
ran at **22:34 UTC** and covered guides 02, 03 and 09. Two large branches merged
**after** it:

| Branch                                    | Merged               | What it changed on screen                                                                                                      |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Email template catalogue + footer library | 2026-08-10 **22:45** | The whole outgoing-email design, and a new **Footers** tab on the Email Templates page                                         |
| Inventory ↔ equipment-check supply loop   | 2026-08-10 **23:22** | The template builder toolbar, the check form, the inventory items grid and toolbar, the inventory admin hub, and two new pages |

So **no capture in the repository postdates the supply work**, and the guide-08
email screenshots predate the email redesign by 21 hours. Everything below is
flagged by comparing each image's last-captured timestamp against the commit that
changed the screen it pictures — not by opening it, which is the check that still
has to happen.

### A. Stale because of the supply / catalog-linking work

Nothing in this group has ever been captured against the shipped code.

| Image                               | Captured    | What is now different                                                                                                                                                 |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-22-equipment-check-builder.png` | 08-10 22:34 | The toolbar now carries a **linked / unlinked count**, and the quick-add bar is a **catalog search** with a "create in inventory" option rather than a plain name box |
| `03-25-equipment-checks-tab.png`    | 08-10 22:34 | The **My Equipment Checklists** header now carries an **Apparatus Inventory** link beside "Start a Check"                                                             |
| `05-01-inventory-items.png`         | 08-10 01:11 | The **Qty** column reads ready units across in-date lots for lot-stocked items and is labelled **"in-date lots"**                                                     |
| `05-47-items-filter-bar.png`        | 08-10 01:11 | The Manage Items toolbar now carries **Receive Stock**, **Add Several** and **Import CSV** that was previously unreachable from this page                             |
| `05-25-admin-hub.png`               | 08-08 00:45 | The hub now links out to **Scheduling → Supply** (Expiring on Apparatus)                                                                                              |

### B. Stale because of the email redesign

Guide 08 was **not** part of the 22:34 re-capture. All three images show the
retired full-bleed red band over a grey slab; outgoing mail is now a white card
on a grey page.

| Image                                                  | Captured    | What is now different                                                                                                                                                                   |
| ------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `08-34-email-templates.png`                            | 08-10 01:11 | Preview pane shows the old design; the tab strip is missing **Footers**                                                                                                                 |
| `08-36-template-search.png`                            | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `08-37-email-officers.png`                             | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `18-01-member-storefront.png`, `18-02-store-admin.png` | 08-08       | **Check before re-shooting.** The storefront's _emails_ moved onto the shared theme; these two picture the store's own screens and may be unaffected. Listed so the question gets asked |

### C. Stale because the pictured screen was fixed after the shot

All captured at **08-10 01:11**, before the fix landed the same day.

| Image                                                                                             | What is now different                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`                                      | The **Open Shifts** panel is capped at five with an "N more" line. It previously rendered every open shift in the next 30 days — 48 rows on the demo department, which is why the dashboard in these shots is 6,930px tall with the ID card and equipment panels pushed off the bottom. Shift dates in **My Upcoming Shifts** were also rendering a day early for some viewers |
| `11-05-budget-detail.png`, `11-12-purchase-request-detail.png`, `11-14-expense-report-detail.png` | **Breadcrumbs now render on the loaded record.** They previously appeared only in the loading and not-found states, so these three shots have no breadcrumb trail where the shipped page has one                                                                                                                                                                               |
| `05-45-impact-planner.png` (08-08)                                                                | Ranks rendered as **"Deputy_chief"** with the underscore. Fixed 2026-08-10                                                                                                                                                                                                                                                                                                     |
| `06-21-apparatus-evoc-level.png` (08-08)                                                          | **Setting this field returned a server error when the shot was taken**, and once any apparatus had a level, the fleet list returned one too. The form works now, and the guide text around it was corrected: the levels are per-organization records, not a fixed Basic/Intermediate/Advanced triple                                                                           |

### The 2026-08-11 pass

**All seventeen images in groups A, B and C above were re-captured**, and each
was then opened and read against its caption. Sixteen came out right. The
seventeenth is the reason this section exists.

| Group | Images                             | Verified                                                                                                                         |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A     | `03-25`, `05-01`, `05-47`, `05-25` | Supply-loop changes present                                                                                                      |
| A     | `03-22`                            | **Was wrong. See below.**                                                                                                        |
| B     | `08-34`, `08-36`, `08-37`          | **Footers** now in the tab strip; the editor shows "Closes with"                                                                 |
| B     | `18-01`, `18-02`                   | The question the table asked is answered: the storefront's own screens were unaffected by the email redesign. Re-shot regardless |
| C     | `00-04`, `00-07`                   | Open Shifts is capped; the full dashboard is 4,486px, down from 6,930px                                                          |
| C     | `11-05`, `11-12`, `11-14`          | Breadcrumbs render on the loaded record                                                                                          |
| C     | `05-45`, `06-21`                   | Ranks read "Deputy Chief"; the EVOC form saves and shows "Level 2 — Intermediate"                                                |

**`03-22-equipment-check-builder` was photographing the wrong page, and had
been for as long as it existed.** Its route was
`/scheduling/equipment-check-templates/**new**` — the blank create form — and it
carried `allowEmptyState: true` with a note calling that correct, "the shot is
of the builder layout". But the guide text this image sits under is about
compartments, item check types and drag-to-reorder, and the page in the image
says "No compartments yet". The two changes that got it flagged for re-capture
in the first place — the toolbar's linked/unlinked catalog count and the
quick-add bar's catalog search — do not render at all without items on the page,
so re-shooting the same route would have produced the same wrong picture with a
fresher timestamp.

It now opens the seeded **Medic 3 Supply Check**, and shows the `5/8 linked`
badge, three compartments, per-item check types, the catalog quick-add bar and
the summary bar. `fullPage` is off: the toolbar and the summary bar are both
sticky, so a full-page capture paints each of them twice.

The lesson is the one the harness section above already makes, sharpened: an
`allowEmptyState` flag records that somebody decided a page was legitimately
empty. That decision is worth re-examining whenever the caption changes — the
flag is what stops the one check that would have caught this.

**Three empty-state flags were false positives, all the same shape.** A
`<select>`'s placeholder option — "No EVOC requirement", "No EVOC level", "No
category" — is in the DOM on every render, including the ones where a real value
is selected. `03-52` and `06-23` now carry `allowEmptyState` with a comment
saying which option is doing it. `03-54`'s flag is a different false positive:
"No calls logged for this shift" belongs to a sub-panel further down the same
drawer, and the shift is deliberately in the future.

**One shot needed new seed data.** `03-54-crew-board-open-slots` had been
failing outright — "no future shift is part-staffed with 2+ open" — because the
seeder staffs every shift to its minimum or one short. That is what a real
schedule looks like, but it meant the crew board never showed more than one open
row and the bulk **Fill All Open** action, which appears only at two or more,
was unreachable in the demo. `PART_STAFFED_SHIFT` now leaves one future shift
crewed by its officer alone. The repair runs against the API as well as in the
create path: an existing shift is skipped on a re-run, so a create-path-only fix
would have worked on a fresh database and nowhere else.

**The Add Operator form cannot be photographed with its picker open.** Both
selects on it are native, and an open native popup is drawn by the operating
system rather than the page, so Playwright cannot capture it. `06-23` shows the
two fields _set_ instead, which makes the same point more directly: a real
member name proves the box is a picker over the roster, and an EVOC level beside
it is the combination that used to return a server error.

**Still not fixed: `11-05-budget-detail` pictures a budget with no
transactions.** The breadcrumb fix it was flagged for is confirmed, but every
seeded budget has `amountSpent: 0`, so Transaction History is genuinely empty and
the utilization bar reads 0.0%. The seeder creates purchase requests and expense
reports without settling any of them against a budget. Closing that gap is
seeder work, not a capture setting.

### Two sessions shot the same screens at once

This pass and the one recorded above it ran in parallel against the same
backlog, and both photographed the email screens, the two inventory modals, an
item's Stock tab and four of the supply shots. Nothing was lost — the duplicates
were reconciled on merge, keeping whichever version was better and deleting the
other — but the effort was spent twice, and one of the reconciliations was not
obvious:

- **`08-67-email-preview-design`.** One version opened the welcome email and
  concluded, in the guide, that the preview pane simply cannot show a footer:
  it is a fixed 600px iframe and the message is taller. The other opened
  **Shift Assignment** instead, because the footer renders only where the body
  contains `{{footer_html}}` and most shipped bodies predate footers. The second
  is right, and the first would have documented a limitation that is really a
  template-choice problem. Kept the second.
- **Numbering collided.** Both sessions took `05-65`, `05-66` and the `03-57`
  … `03-62` range for different screens. Ids are full slugs, so no file was
  overwritten, but the numbers no longer read in order. Before adding a shot,
  check the manifest for the next free number rather than counting the images
  on disk.

### D. Verified current — do not re-shoot on this pass

| Image(s)                                                                  | Why                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Everything in guides **02**, **03** and **09** except `03-22` and `03-25` | Captured 08-10 22:34 against the current code for those screens |
| `01-08-member-audit-history.png`                                          | Re-captured after the event-type filter and details-panel fixes |
| `08-60` … `08-63` (notification shots)                                    | Captured after the delivered-status and `?tab=` fixes           |
| The 15-prospective-members set                                            | The Linked Events badge capitalization fix is in these captures |

### Screenshots that do not exist yet

The 2026-08-11 documentation pass added **18 new `[SCREENSHOT NEEDED]`
placeholders** for screens that have never been photographed:

| Guide                        | Placeholders added                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-scheduling.md`           | Apparatus Inventory page, the lots sheet, the report-used sheet, the quick-add catalog search, the bulk inventory-match dialog, the check form with carry-over banner, the Set All to Par warning, the Expiring on Apparatus worklist (8) |
| `05-inventory.md`            | The two-ledger items grid, the Receive Stock modal, the Add Several modal, an item's Stock tab with deployed positions                                                                                                                    |
| `06-apparatus-facilities.md` | The Operators tab, the Add Operator member picker                                                                                                                                                                                         |
| `08-admin-reports.md`        | The Footers tab, the footer selector in the template editor, the Organization variable palette, the new email preview design                                                                                                              |

**All eighteen are now captured and applied** _(2026-08-11)_, across the two
parallel sessions recorded above:

| Guide | Shot as                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03`  | `03-95` apparatus inventory, `03-96` lots sheet, `03-59` worklist, `03-69` quick-add, `03-68` bulk match, plus the report-used sheet, carry-over banner and par warning |
| `05`  | `05-53` the two-ledger grid, `05-09` Receive Stock, `05-10` Add Several, `05-07` an item's Stock tab                                                                    |
| `06`  | `06-22` Operators tab, `06-23` Add Operator                                                                                                                             |
| `08`  | `08-64` Footers tab, `08-65` footer selector, `08-66` variable palette, `08-67` email preview                                                                           |

The numbering does not run in order because two sessions allocated ids at the
same time — see _Two sessions shot the same screens at once_ above. The
apparatus shots select M-3 from the picker by the option's **value** rather
than its label, since the label is built from two fields and matching it as a
string breaks the moment either changes.

`08-64` only became possible on 2026-08-11: the Email Templates page held its
tab in plain state, so a shot of the Footers tab would have silently captured
the Templates tab — the same way `02-21`/`02-41` and `04-20`/`17-01` came to be
byte-identical images under different captions. `?tab=` now round-trips all
five tabs, with a test pinning every call site.

**Superseded.** An earlier revision of this section said fourteen of the
eighteen had no manifest entry and that several needed seed data that did not
exist — a position carrying two lots with two dates, a truck below par, a
restock report raised by a member. All three now exist, and all eighteen are
shot.

**The seeder gap is closed** _(2026-08-11)_. `seed_supply_tracking` in
`scripts/screenshots/seed_demo_data.py` now builds the state these sections
describe, on the medic unit:

| What it seeds                                                                              | Which screenshot needs it                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five dated consumables with shelf lots, one of them **already expired**                    | The struck-through row on the worklist; the two-ledger Qty column                                                                                            |
| Catalog links on the counted positions, **and three positions deliberately left unlinked** | The toolbar's coverage count; the bulk-match dialog                                                                                                          |
| Naloxone from **two lots with two dates** on one bracket                                   | The lots sheet, and the "soonest aboard" rule                                                                                                                |
| Gauze at **18 of 24**                                                                      | The amber short count, and the Set All to Par warning — which is suppressed on a compartment already at par, so a fully stocked department cannot picture it |
| A restock report raised **by the demo member**, not the administrator                      | The worklist row naming a real reporter, which is the whole claim about who can record use                                                                   |

**A defect the wiring exposed.** The seeder had been writing
`"check_type": "presence"` on every equipment-check item. The column is a free
`String(30)` so the API accepted it, but the eight types the check form
recognises spell it **`present`** — and an unrecognised value falls through the
form's switch to the pass/fail branch. So every seeded item rendered **Pass /
Fail** buttons under a guide describing Present / Missing, and nothing reported
a problem. Fixed, with a `_repair_check_types` pass for rows a long-lived demo
database already holds. Same shape as the skills-testing `"checkbox"` criterion
type recorded in `KNOWN_LIMITATIONS.md`; worth assuming there are more of these
wherever a type is stored as a free string.

---

## Re-capturing

See [`scripts/screenshots/README.md`](../../scripts/screenshots/README.md). The
short version, once MySQL/MariaDB and Redis are up:

```bash
scripts/screenshots/dev_env.sh                       # blocks until the stack answers
python scripts/screenshots/seed_demo_data.py         # run before EVERY capture
node scripts/screenshots/capture.mjs --only 03-      # one guide at a time
python scripts/screenshots/apply_placeholders.py
python scripts/screenshots/status_report.py
```

**Structural first, and by guide.** `--only 09-` and `--only 03-` cover the two
screens that changed shape; the cosmetic tier is worth doing in one full run
rather than piecemeal, since a partial sweep leaves two control styles side by
side in the same guide.

**Update this file when you do.** It is the only record that a captured image was
checked against the build rather than merely present on disk.
