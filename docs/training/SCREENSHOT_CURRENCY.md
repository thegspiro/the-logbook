# Screenshot currency

## Re-captured 2026-08-25 — 470 images refreshed, and 35 shots that no longer reach their screen

The pass planned in the entry below. Verified before committing, which is where
most of what follows came from.

**470 images rewritten, 328 of them at identical dimensions** — same layout,
new palette, which is exactly what a colour migration should look like. 31 grew
and 11 shrank; each of the 11 was opened.

### Byte size is the wrong detector; dimensions are the right one

The obvious check — "did the file get much smaller?" — is useless here. The
median re-captured image is **0.35** of its committed size, because `pngquant`
now applies where it did not for many of the originals. On bytes alone, 182 of
302 looked like data loss. On dimensions, 8 did. Anyone repeating this should
compare heights, not bytes.

### Two images were worse, and are restored rather than committed

`01-31-applicant-documents` went from a populated list to "No documents yet",
and `19-08-store-admin-activity` from a full activity feed to "No order updates
were recorded in the last 7 days". Both are seed gaps rather than code changes,
so the committed bytes stand and the gap is recorded here — the rule the
pipeline already carries. The cost is real and worth naming: those two keep the
**old** button colour until their fixtures are fixed, so the palette is not
uniformly migrated.

`19-08`'s cause is worth writing down because it will recur. The storefront
seeder advances order statuses only when they do not already match, so on a
re-seed the orders keep their original timestamps and slide out of the
seven-day activity window. The guard that makes the step idempotent is what
makes the fixture expire.

### One shot was photographing the demo scaffolding

`04-02-event-detail` came back reading "Attendance (0)" with every statistic
zero. It selected its subject with `isUpcoming` — the soonest upcoming event —
which is now permanently the early check-in fixture: 90 minutes out,
`requires_rsvp` false, RSVP cleared on every seed *by design*. A fixture added
for one marker had quietly taken over a shot two guides away. Re-pointed at
`isRsvpOpen`, the property its caption is about, and re-captured: 3333px with
its attendance back. `isUpcoming` now has no callers, and its own docstring had
already warned that the nearest upcoming event is the wrong subject for an RSVP
shot — it burned the RSVP modal shot the same way.

### 35 shots never reached their screen, and that is UI drift, not flake

Re-run individually, they fail identically every time, so these are stale
selectors rather than timing. They cluster on precisely the screens the review
found rewritten last week — the email template editor, the shift-reports tabs,
the training admin pages, the equipment-check builder.

Nothing was overwritten: a shot that fails in `prepare` never reaches
`page.screenshot`, so all 35 keep their committed bytes. **That is the problem,
not the mitigation** — those 35 keep the pre-2026-08-23 button colour while the
470 around them do not, which is the mixed palette this pass set out to remove.
They need their prepare steps repaired against the current DOM, one screen at a
time.

`02-30-shift-reports` shows why the drift is real and not cosmetic: the tab it
lands on is now a six-tab strip (About me / Written by me / Review Queue /
Flagged / Drafts / New) that did not exist when the neighbouring shots were
written. The image itself is good — four pending reports, named, with hours,
calls and competency badges — it is simply half the height it used to be.

### Also found, not fixed here

Election Settings renders **two switches with no visible label**.
`SettingsToggle` puts its `label` prop on `aria-label` only — its own prop
comment says "Required whenever no visible label is tied to the switch" — and
`ElectionsSettingsPage` passes the label while rendering no adjacent text. A
screen-reader user hears "Anonymous voting by default"; a sighted user sees a
bare toggle. `EmailSettingsSection` shows the house pattern: visible title and
description beside the switch, no `label` prop.

Four `audit_baseline.txt` entries no longer flag and are removed, as the audit
asks. No new findings across 512 images; 281 markdown files, 0 broken links.

## Reviewed 2026-08-25 — the primary button changed colour, and 80% of the library predates it

Not a marker pass. A review of what merged in the week to 2026-08-25 turned up
one change that invalidates most of the library at once, and the honest
response was to re-shoot rather than to patch a list of screens.

**`btn-primary` moved to `red-800` app-wide on 2026-08-23**, in `32627ceb`.
`styles/index.css` says why, and says it was deliberately done everywhere at
once: "a primary button that is one red on the store and another everywhere
else reads as two different actions". **408 of the 510 committed images predate
that commit**, so four in five pictured a red the application no longer draws.
`ConfirmDialog.tsx` carried the same `red-600` -> `red-800` change separately,
which put every confirmation dialog in the same position.

Measured, not assumed. `18-01-member-storefront` re-captured against the same
seed:

| | dominant red | height |
| --- | --- | --- |
| committed 2026-08-16 | `(231, 0, 11)` | 1866px |
| re-captured | `(159, 7, 18)` | 1770px |

Colour and layout both. That shot was restored to its committed bytes at the
time and re-taken properly as part of this pass.

Underneath the palette, eight screens were also substantially rewritten in the
same week and gain new content rather than only a new button colour: the email
template editor (10 shots), the equipment-check builder and form with the new
seal panel (5), the inventory admin hub (6), the settings shell and its label
printers section (5), `SubmitTrainingPage`, `StorefrontPage` / `MyOrdersPage`,
`ElectionsSettingsPage` and the label print page.

Two shared-chrome changes worth separating from the noise: `Modal.tsx` gained
the `modal-content` / `modal-footer` class hooks, and `modal-footer` makes
dialog buttons full-width and 44px **on phones** — so mobile dialog shots
change shape and desktop ones move by a few pixels of padding.
`PageTransition.tsx` only touched document titles and changes nothing visible.

### The seeder aborted first, and the guard was the reason

The first seed of this pass failed the scheduling step outright:

    Unable to create assignment. Member is no longer eligible for this shift

`_validate_assignment` reports two sentences from one gate — "eligible for this
shift" when a member may hold no seat at all, and "eligible for the X position"
when they may hold some seat but not that one. `POSITION_NOT_ELIGIBLE` matched
only the second. The first branch arrived on 2026-08-24 in `ea47d4ab`, closing
an eligibility bypass on unscoped shift offers, and the matcher predated it.

`is_expected_seat_refusal`'s own docstring already calls this class of refusal
ordinary — it leaves a shift a seat short, which is what the Open Shifts tab
exists to show — and warns that treating one as fatal "aborted the whole
scheduling step", taking the close-out fixture, the batch report trainee, the
shift reminder inbox and every downstream guide-03 capture with it. That is the
fourth time this failure has arrived by a different door. The matcher now takes
both sentences, and is asserted against both plus three refusals it must not
swallow.

Capturing on the failed seed would have produced exactly the outcome the
discipline warns about: fresh images that are worse than the committed ones
because data is missing rather than because code changed.

### Status

The re-capture itself is running as this is written; its results are recorded
in the entry above this one once the pass has been verified. Verification is
not optional on a change this size and is not a glance at a few images: the
capture report carries a per-shot empty-state, ErrorBoundary, page-error and
horizontal-overflow verdict, every one of the 511 committed images was
snapshotted beforehand for a byte-and-dimension diff, and anything that shrank
by more than 45% gets opened and checked against the API — that is the
signature of a shot that lost its *data*, which no palette change can explain.

## Captured 2026-08-25 (twenty-second) — label printers, and a marker that asked for two incompatible things

`19-33-label-printers`. 505 of 514.

The marker wanted RFC 5737 documentation addresses **and** "a status result
visible on at least one so the reader sees what a healthy answer looks like".
Those cannot both hold, and the reason is a real property of the feature rather
than a fixture shortcoming.

`app/utils/printer_transport.py` refuses any address outside
`LABEL_PRINTER_ALLOWED_NETWORKS` before it opens a socket — loopback,
link-local and reserved ranges are rejected outright, and everything else has
to be inside an operator-listed CIDR. That setting is a **platform** setting
(`app/core/config.py`), deliberately not tenant-managed, so that registering a
printer cannot be turned into an SSRF primitive. **Its default is empty**,
which disables direct network printing entirely. `192.0.2.x` is precisely the
range no operator will ever list.

So a healthy emerald status line is reachable in exactly two ways, and both are
disqualifying: put a routable printer address in a public repository, or mock
the response and photograph a lie.

What was done instead: the shot shows the two registrations, which is the real
part — the ZPL watch-desk printer badged **Default**, the ESC/POS one in the
supply room, the label stock each resolves to (`Zebra 2" x 1"` and
`80mm roll (3.1")`), and the per-printer **Check status** control the section's
"status is per printer" claim is about. The guide gains a paragraph stating the
allowlist, quoting the refusal text verbatim, and quoting the shape of a
healthy line (`model · dpi · firmware`) so the reader knows what to expect
without being shown a fabricated one.

Worth noting on its own: the guide already said "Nothing checks the address
when you save it, so registration will succeed either way and the failure
appears at print or status time" — true, and verified, since both fixtures
registered without complaint. What it did not say is that on a stock install
the failure at status time is *guaranteed* and is not about the printer at all.
That is the first thing to check, and it was missing.

Seeded by `seed_label_printers`, which skips by name and is safe to re-run.

## Found 2026-08-25 — probing the My Admin Hours marker turned up a 500

The twenty-second pass opens on the ten markers that arrived with this
release's own guide additions. Guide 19's *rebuilt My Admin Hours page* marker
asks for "one configured requirement, so the category bars and the
requirement-progress section are both populated", so the first question was
what feeds that section. It is `GET /admin-hours/compliance/{user_id}` — and it
answered 500 for every member except the one asking.

`AdminHoursService.get_user_hours_compliance` loads the target member and then
reads `user.positions` to pick the applicable compliance profiles. The query
carried no eager load, so that read is deferred IO, which under asyncio raises
`MissingGreenlet` instead of emitting a SELECT.

What kept it hidden is worth writing down, because it is the reason a manual
check would have called the endpoint healthy. SQLAlchemy's identity map answers
`select(User).where(id == <me>)` with the `current_user` instance the auth
dependency already loaded **with its positions**, so asking about yourself
never lazy-loads anything. Only a lookup of somebody else reaches a fresh
`User`. The endpoint's permission check exists solely to allow that lookup.

Fixed with `selectinload(UserModel.positions)`, and
`tests/test_admin_hours_compliance_lookup.py` covers it. The tests
`expunge_all()` before calling the service — without that they exercise the
masked path and pass against the unfixed code, which is the trap the endpoint
itself fell into. All three fail with the fix reverted, with the same
`MissingGreenlet`.

No screen calls it for another member yet, so nothing in the guides was
picturing the failure. It is recorded here because the screenshot pass is what
found it.

## Corrected 2026-08-24 — four review findings on #1794, all real

An automated reviewer read the PR and filed four. Every one held up; three were
mine, one was in the committed early-check-in work.

**P1 — the authenticated display endpoint was raising, not answering.**
`can_check_in` was added to `QRCheckInData` as a *required* field. The public
kiosk (`api/public/display.py`) was updated to pass it; the authenticated
`/locations/{id}/display` (`api/v1/endpoints/locations.py`) constructs the same
model field by field and was not — so it raised a `ValidationError` for any
location with an event in its check-in window, which is the only state that
endpoint exists to report. Reproduced by constructing the schema without the
field before touching anything.

Nothing caught it: `test_kiosk_check_in_window.py` covers the *query* that feeds
the loop and stops there, and `test_public_display.py` covers the other
endpoint. `tests/test_location_display_endpoint.py` is new and closes that gap —
3 of its 4 cases fail with the fix reverted. The value is hardcoded `True` for
the same reason `is_valid` is: the service filters on the strict window before
this loop sees an event, and the permissive rule admits everything the strict
one does.

**P2 — `03-84` opened whichever platoon the rotation happened to put first.**
The seeder prepared `existing[0]` of the generated three-day window and the
manifest opened the first shift carrying any platoon; the shot then waits for a
**"Platoon A Roster"** heading. Which platoon lands on day 35 depends on the
rotation offset and therefore on today's date — green on the day it was written
and a timeout on most others, and the two halves could disagree with each other
besides. Both now select platoon A by name.

**P2 — `_open_two_platoon_seats` was subtracting two members per re-seed.** It
freed the last two assignments unconditionally, so six on shift became four,
then two, and each pass raised another leave request. A database meant to be
repairable by re-seeding drifted further from the capture every time. Now
guarded on the roster's own statuses — one `available` and one `on_leave` is the
state the shot needs, so that is what it checks for. Verified by re-seeding and
confirming 6/1/1 holds.

**P2 — `04-49` could be captured exactly once.** The fixture slides its event
back into the early-arrival band on every run but never reset the member's RSVP,
and a second check-in takes the ALREADY_CHECKED_IN path, which returns no notice
at all. The reviewer's mechanism was slightly off — the shot waits on the notice
itself (`role="status"` appears once on that page), so it would have timed out
rather than captured the wrong screen — but the fixture was one-shot either way.
The RSVP is now cleared each run. Verified the hard way: checked the member in
through the API, re-seeded, checked in again, and the notice came back.

**`04-49` is re-committed at a third of its size.** Re-capturing it was how the
fix was proved, and `pngquant` was available here where it was not for the run
that first captured it: 276 KB to 76 KB, same screen. `03-84`/`03-85` were
re-captured too and their content did not change, so the committed bytes stand.

## Captured 2026-08-24 (twenty-first) — the platoon roster, and the last marker closed

`03-84`/`03-85`, opened and checked. **504 filled, 0 remaining** — every
placeholder in the guides now has an image or the prose that replaced it.

**The gap was structural, and it is worth stating plainly.** `Shift.platoon` is
written in exactly one place: the recurring-pattern generator, for a pattern
typed `platoon` whose `schedule_config` names its platoons. Neither
`ShiftCreate` nor `ShiftUpdate` accepts the field. Every seeded shift was made
by hand, so no shift in the demo department had a platoon, so the fill-in /
hold-over roster had nothing to render — for anybody, on any screen. The
department already had three platoons and an A/B/C pattern; the pattern had no
`schedule_config`, which is what makes the generator take its single-track
branch and write ordinary shifts.

**The generator seats the whole platoon, which is a roster with nothing to
say.** Two assignments are removed afterwards, the way a real shift loses them:
one member is booked off with an approved request covering the date, so the
roster reads **On leave**; one is simply free, which is the **Available** row
with the **Assign** button an officer holds someone over with. Six on shift, one
of each — all three states in one frame.

**Generated five weeks out, deliberately.** Every board, dashboard card and
open-shift count the guides already picture reads from the weeks around today.
The roster shot opens its shift by id, so it does not need to be near today at
all, and nothing else moves.

**I broke `03-16` and put it back.** My first version re-dealt the platoon
membership before generating — not realizing `seed_platoons` already assigns it,
idempotently, and that the Platoon Management screen pictures the exact deal.
The columns changed. The tell was almost missed: `/users` does not carry
`platoon` at all, so every member reads `platoon: None` there whatever they are
assigned — the list-shape trap again, and this time it made a populated feature
look unseeded. `/scheduling/platoons/overview` is where the truth is. The deal
is deterministic (`ids[i::3]` over the API's own order), so re-running it
restored the committed image exactly, and the fixture now only reads the
membership it finds.

**Left behind:** one approved time-off request for 2026-09-28 from the
mis-dealt run. It cannot be deleted — the API cancels only your own, and only
before approval — and it is harmless: the member it belongs to is in another
platoon now, and that date's shift is not hers. A fresh seed will not produce
it.

**One selector note.** The shift drawer is `div.drawer-panel`, laid out inside
the page's own `main`. The `div.fixed.inset-0 > div` that the modal shots use
matches nothing on this page.

## Corrected 2026-08-24 — the early-check-in fix, found twice, and what the second copy was good for

Both sessions independently found the same defect within the same hour: the self
check-in page gated its button on a window it computed itself, so a Flexible
event's documented one-hour early-arrival grace had no button to reach it
through, and the notice the marker asks for could not be photographed. The
committed fix and capture (`04-49-early-checkin-notice`) are the other
session's.

**Theirs is the better fix, and specifically here.** I replaced `is_valid` with
the permissive answer; they added `can_check_in` beside it and left `is_valid`
meaning what it meant, which is what the "Check-in Not Available" panel prints
its time range from. They also found the public kiosk endpoint computing the
permissive value under the strict name and fixed that too — a consumer I had not
looked at. Overwriting a field two screens read is the kind of thing that passes
its own test and shows up somewhere else a week later.

**Kept from the duplicate: one test and the prose.** Their two regression tests
cover the grace and the far-before case; neither covers **Strict**, which is the
asymmetry a reader is most likely to get wrong — the same twenty minutes that a
Flexible event admits with a notice is refused outright there. Without it, both
branches of `_validate_check_in_window` are exercised only in the direction that
says yes. The guide had the image and a caption; it now says what the notice is
doing: the time is the organization's timezone rather than the reader's device,
the check-in succeeded, and the grace is exactly an hour.

**Not kept, and recorded rather than pushed:** returning the notice text in the
QR payload so the page can say it _beside the button_ instead of only in the
confirmation afterwards. The other session's fix deliberately discards that
value, and adding a second surface for the same sentence is a design call for
the owner, not something to slip into a screenshot pass.

**One trap worth writing down, from the copy that lost.** `dev_env.sh` runs
uvicorn **without `--reload`**. A backend fix is live in the source and not in
the process, so a probe keeps reporting the old screen and the fix looks wrong.
Restart the stack after touching backend code before concluding anything from a
capture.

**And one that looks like a code failure and is not.** Ten event tests failed on
`Unknown column 'event_rsvps.early_check_in_minutes'`. `conftest.py`'s
`create_all(checkfirst=True)` adds missing tables but never missing columns, and
its docstring names the remedy: drop `intranet_test` and let it rebuild.

## Captured 2026-08-24 — an early check-in the app could not reach, and a product bug fixed to get there

`04-49`, opened and checked. **1 marker remaining.**

**The button was never there to click.** The guide already documents that a
Flexible event admits a tap up to an hour before its official window with an
informational notice — `_validate_check_in_window` genuinely does this. What
had never been exercised through the UI: `EventSelfCheckInPage` gates the
whole "Check In to This Event" button on `qrData.is_valid`, and
`get_qr_check_in_data` computes `is_valid` as the **strict** on-time window
(`check_in_start <= now <= check_in_end`) — no early grace at all. A member
arriving during the exact window the backend was built to admit saw
"Check-in Not Available" and no way past it. The marker could not be captured
as written because the feature it describes was unreachable, not because the
seed data was missing.

**Root cause, not a workaround.** Added `can_check_in` to `QRCheckInData` —
computed with `_validate_check_in_window`, the same permissive check
`self_check_in` itself enforces — and pointed the frontend's button gate at
it instead of `is_valid`, which stays for the "Check-in Not Available" time-
range display it already drove. Found in passing that the public kiosk
endpoint (`app/api/public/display.py`) had _already_ been computing its own
`is_valid` this permissive way, under the strict field name — the two call
sites disagreed on what the same field name meant, which is exactly the
class of bug `can_check_in`'s docstring now heads off by naming both
concepts explicitly.

**Two backend regression tests, two frontend.** `test_qr_data_can_check_in_true_during_flexible_early_grace`
and its false-outside-the-band counterpart in `test_qr_check_in.py`; a
`can_check_in: true` / `is_valid: false` case and updates to the four
existing "outside the window" tests (which needed `can_check_in: false`
added alongside `is_valid: false` — they were about the hard-block case, and
without both flags they'd now exercise the wrong branch) in
`EventSelfCheckInPage.test.tsx`. Also fixed the same tests' silent
dependence on `is_valid` alone, which the fix would otherwise have left
green for the wrong reason.

**Seeded 90 minutes out, the midpoint of the admissible band.** `_validate_check_in_window`
allows 60–120 minutes before a Flexible event's start (60 minutes before the
official window opens, plus one more hour of grace); 90 minutes centers the
capture in that hour so a few minutes' delay between seeding and capture
doesn't fall outside it. Not `requires_rsvp`: `self_check_in` auto-creates
the RSVP on first tap, and requiring one would also require an
`rsvp_deadline` — a validator this fixture found the hard way, with a first
`POST /events` returning a generic 422 until the actual constraint was read
from `EventCreate.validate_dates`.

## Corrected 2026-08-24 — two sessions filled the same two markers, and what survived from the losing copy

Guide 19's deduct-mode marker and guide 09's candidate-scorecard marker were
each captured twice, in parallel, by two sessions working this branch. The other
session's captures are the ones in the repository (`19-30-skill-point-deduction`,
`09-24-scorecard-print-candidate`); this entry records what the duplicate work
was worth keeping and what was thrown away.

**Discarded, because the committed capture is at least as good.** A second
deduct-mode fixture, built by adding one deduct criterion to the existing
weighted sheet rather than seeding a fourth template. Cheaper on demo data, and
framed on the score panel alone; but the committed shot carries the result
banner, so "passed" is visible in the picture rather than inferred from
"Passing mark is 70% — met". Two deduct fixtures would have been worse than
either. The redundant seeder fixture, template criterion and capture were
dropped rather than merged.

**Kept: three shots that were selecting their record by luck.** `09-23` and
`09-24` are a pair — the same result under two accounts — and both matched
"any validated pass"; `09-15` matched "any pass under 100". The deduction
fixture gave all three a second candidate to choose from, and on this database
the unpinned matcher already resolved to it: `09-23` would have opened Emeka
Adeyemi's 90% record while `09-24`, which can only see the demo member's own
tests, opened Nadia Belhaj's 78% — a pair captioned as one record and showing
two. All three are now pinned to the 78% fixture that `seed_scored_test` fixes
and comments.

**Kept: the outreach form must not be answered by the form-submission seeder.**
The other session fixed the `phone` field type that made those submissions fail
(theirs is the better fix — an entry in the answer pool rather than a special
case). But the generated outreach form carries an `event_request` integration:
answering it four times opens four public event requests, on a queue the events
step seeds deliberately with one, and `19-24`'s caption reads "0 submissions".
Forms carrying an integration are now skipped entirely. Verified after a full
re-seed: one request, from Dana Whitmore, and the form still at zero.

**Kept: the guide-19 deduction section, rewritten around the committed
fixture's numbers.** The marker had been closed with an image and a caption; the
three rules that make the arithmetic legible were not written down anywhere —
a deducting step does not enlarge the point pool, an unscored step is never
charged, and the percentage clamps at zero while still listing every penalty.
All three are in `build_score_breakdown`.

**Also corrected:** `09-23`'s caption claimed "one failed step", which that
print does not show — a non-critical `score` criterion is reported as its
number, so the step reads "5 / 10" and the section tally counts it as neither
passed nor failed. The caption now says what the image says. (A deduct-mode
failure _is_ printed as `FAIL −10`; the two behave differently, which is worth
knowing before reading a printed sheet for failures.)

**Process note.** Both sessions also independently fixed the same two
scheduling-seed refusals within the same hour. Duplicated work is the cost of
two sessions on one branch; the guard against wasted effort is reading the
other side before committing, not assuming your own copy is the one to keep.

## Captured 2026-08-24 — a validation prompt, before and after the action that clears it

`19-31`, `19-32`, opened and checked. **2 markers remaining.**

**Triggered for real, not seeded pre-formed.** `event_validation` notifications
are written only by the `post_event_validation` scheduled task, which looks at
events that ended in the last two hours. Seeded a training event ending 45
minutes ago and called `POST /scheduled/run-task?task=post_event_validation`
directly — the same manual-trigger endpoint the seeder already uses for shift
reminders — rather than waiting for the cron tick, which a capture run cannot
do. Slides forward and clears `custom_fields` on every re-seed, the same
pattern `seed_guest_check_in_event` already uses, so a capture run that
already finalized this fixture gets a fresh "before" state rather than a
closed window.

**The pair's second half is a real mutation, and it is deliberately not
`mutatesSeedData`.** That flag would force `19-32` to be the last shot of
guide 19, and `19-26` already holds that position for unrelated election
data with its own ordering dependencies (`openBylawDraft`, the four-item
ballot). Placed `19-31`/`19-32` earlier in the array instead, which the
guard's actual rule permits — it only refuses a _later_ entry in the same
doc once a mutator is found, and nothing after `19-32` (specifically:
`19-25`, `19-26`, and nothing else in guide 19) reads event or notification
state. The mutation itself calls `POST /events/{id}/finalize-attendance` —
the same endpoint the app's own End Event flow uses, and the one that runs
`archive_related_notifications` — so the capture exercises the real
completion path, not a shortcut around it.

**Verified the count, not just presence.** `19-31`'s badge reads 7 unread;
`19-32`'s reads 6. One notification gone, matching what the caption claims —
checked by comparing the two images side by side rather than assuming the
archive worked because the API call returned 200.

## Captured 2026-08-24 — a deduct-mode step, on a sheet built to carry one

`19-30`, opened and checked. **3 markers remaining.**

**No seeded template used `score_mode: "deduct"`.** Of the three modes a
pass/fail-judged criterion can carry — `none`, `points`, `deduct` — every
existing sheet used only the first two, so the guide's claim that a failed
step can cost fixed points without failing the whole test had nothing to
photograph. Deliberately not added to the weighted sheet
(`Handline Advance — Weighted Evaluation`): that template backs `09-22`,
`09-23` and the candidate-disclosure pair two entries back, and a fourth
criterion appearing there unexplained would raise more questions than the
caption answers. A new template, `Ladder Raise — Point Deductions`, carries
exactly one deduct-mode step for exactly this shot.

**Checked against the API's own arithmetic, not paraphrased from the UI.**
`GET .../tests/{id}` for the seeded result returns
`earned: 47, available: 50, deducted: 10, percentage: 74, passing_percentage: 70,
meets_threshold: true, critical_failures: []` — confirming both halves of the
claim before the screenshot was taken: the deduction lands (net points drop
by exactly 10) and it does not force a fail (critical_failures is empty, the
result is `pass`). The score-breakdown panel's own "How this score was
calculated" line — "47 of 50 points earned, −10 deducted = 74%. Passing mark
is 70% — met." — states the configured pass rule the marker asks the caption
to name.

**Officer scoring view, not the print page.** `ScoreBreakdownPanel` renders
deductions as their own line, itemized under the section they came from — the
print page shows per-step marks but not this breakdown, so `/test/{id}/active`
is the only screen that carries the arithmetic.

**A fixed action bar duplicated across the page on the first attempt.** A
`fullPage` capture of this route repeats a bottom "Back to Tests" bar mid-page,
overlapping the Raise section it is meant to sit beneath — the same fixed-
element artifact this pipeline has hit before, just not on this route yet.
Everything the caption needs sits inside the first viewport, so this shot is
not `fullPage`, and the bar renders once, correctly anchored at the bottom.

## Resolved 2026-08-24 — the export field diff that has no screen to picture it

Guide 17's personal-export marker, answered in prose. **4 markers remaining.**

**A download is not a screen.** "Download my data" hands the browser a JSON
file directly; nothing in the app renders it, so no screenshot of the export
itself can exist — the same class of marker as the terminal-output one two
entries back, resolved the same way: call the real endpoint, quote the real
response, redact what needs redacting.

**Called for real, twice, against the fixture `_ensure_demo_member_report`
seeds** (previous entry). `GET /users/me/data-export` before and after
disabling the five trainee-visibility toggles in Training settings
(`show_officer_narrative`, `show_performance_rating`, `show_areas_of_strength`,
`show_areas_for_improvement`, `show_skills_observed`), diffed, restored to
their prior values afterward so no other capture is left running with the
department's evaluation results hidden from every trainee.

**The diff is field removal, not blanking.** Five keys disappear entirely —
they are not present with a null or empty value — while every ordinary
completion fact (date, hours, call count and types, tasks performed, review
status) is identical in both. That distinction is what the guide's "ordinary
completion facts remain exportable" edge case claims, and now the guide shows
it verified rather than asserted.

**Narrative text redacted, structure and counts real.** The seeded record's
`performance_rating: 4`, its two `skills_observed` entries and one
`tasks_performed` entry are the actual shapes the endpoint returned; only the
free-text values inside them read `[redacted]`, per the marker's own
instruction.

## Captured 2026-08-24 (twentieth) — a mandatory event's default, a template's own, and who an open house brought in

`04-46`, `04-47`, `04-48`, opened and checked. **5 markers remaining.**

**Found first, fixed first: the scheduling seed step was aborting silently.**
Reproducing this pass from a genuinely empty database (not a long-lived
container) surfaced something every prior pass on this branch had a
pre-populated roster to paper over. `ShiftEligibilityService.get_eligible_positions`
gates every shift-assignment seat by rank, and the seeder's day-pool rotation
picks a member for a seat without checking it — a member who happens to be
one rank short of a slot is refused with "Member is no longer eligible for
the {position} position." `is_expected_seat_refusal` already tolerated the
driver/EVOC version of exactly this refusal; the general one wasn't in the
list, so it re-raised, and the per-day loop that builds every shift died on
the first occurrence. On this run that was the **second day**: 2 shifts
existed where 67 belong, and everything downstream that reads shifts —
crewed rosters, shift reports, the close-out fixture, the batch-report
trainee — was empty or blocked in ways that read as separate failures.
Widened the tolerance list to the same message pattern (any position, not
only the driver's), and to the ordinary seat-taken race a re-seed produces
when it tops up a shift a previous run already partly crewed
("`was just claimed`" / "`filled after this request was submitted`").
Neither is a seeding defect; both are the eligibility and contention rules
working, on a roster the day-pool rotation does not pre-filter.

**Second, the same failure mode one level up.** `_ensure_demo_member_report`
— the fixture that guarantees the `auth: "member"` account has an approved
shift-completion report — only ran inside the states-satisfied early return
of `seed_shift_reports`. A run that completes every review state without
happening to crew that one member onto a past shift's roster left her with
nothing, silently, because the function that exists to prevent exactly that
was gated behind the condition most likely to make it unnecessary. Made the
call unconditional, and taught the fallback to seat her directly (with the
same tolerance list) when no existing crew placement has her, rather than
only searching for one that already does. Not yet needed by an image in this
entry — the personal-export marker that reads it is still open — but it is
what makes that fixture reachable at all on a fresh install.

**A silent, deterministic form-submission failure, found the same way.**
`_form_answer`'s type-keyed sample pool had no `"phone"` entry, so a `phone`
field fell through to the generic `"text"` pool and submitted "Engine 1" —
which the server correctly rejects as not a phone number. Added a
phone-shaped pool; every form with a phone field now submits cleanly.

**The markers themselves, once the department could seed properly:**

- `04-46` is the mandatory counterpart to `04-44`: checking Mandatory
  attendance on a new event with the audience untouched flips it to All
  active members, per the edge case already written above the marker.
- `04-47` is `04-46`'s pair, applied by hand the way `17-04` sits beside
  `17-03` — the marker is one blockquote for both images, so only the first
  fills it through `apply_placeholders`. "Weekly Company Drill" is seeded
  non-mandatory with `reminder_target` explicitly overridden to `all`, which
  is what "independently saved" means: the value does not derive from the
  template's own mandatory flag. **Checked before writing the caption:**
  `EventCreatePage.templateToInitialData` copies `reminder_target` from the
  template into a new event same as every other default — the first draft
  of this caption claimed the opposite without checking, and would have
  taught the wrong thing.
- `04-48` needed a Recruitment-type event that had actually produced
  applicants, and nothing else in the seeder makes one — `19-10` captures
  only the type picker on the create form. Three named guests signed in
  through the public kiosk path (an attendee added by an officer creates no
  pipeline card at all, so only the guest path produces this), giving the
  Prospective Members card three rows instead of the single one a bare
  reproduction would show.

## Captured 2026-08-24 (nineteenth) — the candidate's own scorecard, redacted where the officer's is not

`09-24`, opened and checked against `09-23`. **7 markers remaining.**

**Same record, two prints.** The weighted-sheet test 09-23 already pictures
had no candidate-side counterpart, so this reuses it rather than minting a
new one: a template-level `result_disclosure` override of `scores` on
`Handline Advance — Weighted Evaluation`, seeded right after the test that
scores it. Officers are unaffected by the override — `resolve_disclosure_policy`
only governs the candidate's own view — so 09-23 needed no re-capture.

**Verified by diffing the two images, not by reading the code.** Same
per-step marks (`9/10`, `5/10`, …), same section arithmetic, same 78%/PASS —
and the officer's copy carries "Kinked at the stairwell turn and had to be
reset." under **Examiner Notes** plus an **Overall Notes** section that the
candidate's copy has neither of. That is the whole redaction the marker
asked for, in one side-by-side.

## Captured 2026-08-24 (eighteenth) — where a training session is wired to what it counts toward

`19-29`, opened and checked. **8 markers remaining.**

**The create wizard, not the edit card.** The marker names "requirement, course
and program linkage", and the event-detail card that corrects those links
afterwards (**Requirements & Programs**) never shows the course — it edits four
ids and nothing else. Step 2 of the wizard carries all three in one frame, so
that is what this is; the guide says where the same pickers reappear afterwards.

**Nothing is written.** The wizard creates on step 4, and this stops at step 2 —
no `mutatesSeedData` flag, and no training session added to a department that
has none.

**Framed on the wizard, not the page.** The wizard renders inside the training
admin frame, whose headline cards would have put **"COMPLIANCE — could not be
calculated"** across the top of a caption about linking a session. That reading
is true of this database (the seeded members hold three records against 26
requirements — the training-compliance seed gap already recorded here) and has
nothing to do with the marker.

**Three capture facts worth keeping:**

- The **Select Course** label carries no `htmlFor` and the select no `id`, so
  `getByLabel` cannot reach it. Located by its own placeholder option instead.
  That file has **26 labels with no `htmlFor`** — a control with no accessible
  name is a real accessibility defect, but it is a file-wide pattern rather than
  a one-off, so it is recorded here for the owner rather than swept up inside a
  screenshot change. Lint does not flag it: no jsx-a11y label rule is enabled.
- Option labels carry codes — `PUMP - Pump Operations`,
  `Driver / Operator Pipeline (DRV-OP)` — and `selectOption({ label })` matches
  exactly. Each pick resolves its value by substring instead.
- `main:has(h1:text-is('…'))` does not match a heading that also holds an icon.
  Matched on the heading's inner `<span>`.

**Order matters in the prepare, and the comment says so:** picking the course
pre-fills the category and program from what the course declares, so the
explicit picks are made after it. Reversed, the course selection overwrites them.

## Captured 2026-08-24 (seventeenth) — the station board's feed, and a pin that did not pin

`19-28`, opened and checked. **9 markers remaining.** One product defect found
and fixed at root cause, with a regression test.

**The defect.** `Dashboard.tsx` merges department messages with the member's own
notifications into one feed and sorted the result by recency alone. The inbox
arrives from the backend ordered pinned → persistent → newest
(`messaging_service.get_inbox`), and the merge threw both away. Only five rows
render, so a **pinned** "Station 2 bay doors out of service" sat below four
routine notifications, and a persistent standing order dropped off the board as
soon as five notifications arrived. The pin icon rendered beside the message
either way — which is the part that misleads: an officer who pins an urgent
notice has no way to tell it did nothing.

Fixed by ranking pinned and persistent messages above the recency sort, matching
what the backend already does for the messages list.
`Dashboard.test.tsx` gains a test that fails without it: four items, the pinned
one second-oldest and the persistent one oldest of all, asserted in the order
the rail renders them.

**Found by seeding, not by reading.** The marker wanted a persistent notice on
the board and the seed had none — three announcements, all ordinary. Adding one
put it at the top of the feed, and the reason it was at the top turned out to be
that it was the newest thing in the department, not that it was persistent.

**A test fixture that lied.** My first version of the regression test gave the
notification a `created_at` and no `sent_at`. The feed sorts notifications on
`sent_at` and falls back to `0`, so the notification sorted last and the
assertion failed on an ordering the product gets right. `sent_at` is
`server_default=func.now()` on the model, so a real row always has one; the
fixture, not the code, was wrong. Left the `|| 0` alone — a shape the database
cannot produce is not a bug to widen this change with.

**Framed on the rail, not the board.** The marker asks for a "populated station
board", and the board is already captured twice — `00-24` for the member's tab,
`08-75`/`08-76` for the conditional cards, which is exactly what "conditional
cards identified in the caption" is about. A third full-page dashboard would be
the same screen under a different caption. What is nowhere else is a feed
carrying a pinned announcement, a persistent notice and unread notifications at
once, so that is what this shot is, and the guide links to the other two.

**Title shortened twice, for the picture.** "Standing Order — Spotter Required
When Backing" truncated at "Standing Order — Spotter …": the rail is 360px and
the PERSISTENT badge takes about eleven characters of it. "Spotter Required"
fits with the badge beside it. The truncation is correct behaviour, not a
defect — but a caption about a standing order reads badly over a title cut in
half.

## Captured 2026-08-24 (sixteenth) — the roster bound, photographed where it is enforced

`19-27`, opened and checked. **10 markers remaining.**

**Half the marker asked for a screen that does not exist.** It wanted "closed
election results showing manual paper-ballot count" — and a closed election's
results show no paper figure at all. `ElectionResults.tsx` contains no reference
to manual votes or batches, by design: recording a paper tally writes one
ordinary vote row per ballot, so by the time results are drawn the paper votes
_are_ the counts. What stays itemized is the Paper-Ballot Batches panel above
the tab strip, already captured as `14-18`. Guide 19 links to it and says why
there is nothing else to point at.

**The other half is real, and it is a good picture.** The roster bound lives in
the Record Paper Ballots dialog on an _open_ election: 14 + 10 ballots for a
position with 22 eligible members is refused with all three numbers named —
projected, eligible, cap — and the override checkbox renders only once the
server has answered. One image carries the rule, the refusal and the escape
hatch.

**It writes nothing, so it needs no `mutatesSeedData` flag.** The batch is
rejected before any vote row exists — checked by re-reading the open election's
`total_votes` after the run, still 0.

**Facts verified rather than paraphrased from the guide:** the cap is
`eligible × votes-per-position`, multiplied by accepted candidates under
approval voting; the separate "physical ballots in this stack" field is checked
against the roster with no multiplier, because one member hands in one sheet;
and the override is audited at `warning` severity while a normal batch is
`info`. All four are in `record_manual_ballots`.

**Also placed in guide 14.** The plausibility guard was already described there
in prose, with no picture of it. The same image is referenced from both — which
is established practice here (`19-09`, `19-10` and `06-24` are each in two
guides) and does inflate `SCREENSHOT_STATUS.md`'s captured column by one, since
that column counts image lines per guide rather than markers closed.

## Captured 2026-08-24 (fifteenth) — what applying a ballot template changes without saying so

`19-25`/`19-26`, opened and checked. **490 filled, 11 remaining.** The picker
half of the marker was already captured — as `14-22`, in the elections guide —
so guide 19 links to it rather than photographing the same popover twice.

**The rest of the marker was the part worth doing.** Applying a saved ballot
writes the template's **voting method** and **write-in setting** over the
election, and neither the two-step confirmation nor the picker row mentions it.
The pair shows one draft before and after: one item becomes four (warned about),
and Simple Majority becomes Ranked Choice (not warned about).

**The first version of this pair was a demo artifact, and the check that caught
it was reading the create form.** I had seeded the bylaw draft with
`voting_method: "supermajority"` so the change would be visible. The create
form's control is a single `<select>` whose options pair a method with a victory
condition, and its "Supermajority Required (2/3)" is
`simple_majority|supermajority` — **no option sets the method to
`supermajority`**. The seed put the department in a state the product cannot
produce, and the screenshot would have shown a value no reader could ever see.
Re-seeded as the form writes it, with the _template_ carrying ranked choice
instead — an officer ballot plausibly run that way, and the difference the pair
needs.

**The stronger finding is what did not change.** The apply overwrites the method
and leaves the victory condition alone, so the draft is left asking for 67%
under ranked choice; `positions` still names the bylaw article over four officer
seats. And there is no editor for any of it: **Edit Dates** is dates, **Clone
Election** is title/dates/candidates, so applying a template is the only control
in the app that changes an election's voting method after creation. Both guides
now say so, and guide 14's edge-case table carries the supermajority row.

**Where the settings _can_ be read: Preview Ballot.** Its Election Details strip
carries method, victory condition with percentage, Anonymous, write-ins and
quorum together — the only screen that does. An earlier draft of the prose said
these were visible nowhere on a draft election; reading `BallotPreviewModal`
rather than the details card corrected it before it was committed.

**`19-26` mutates the seed, and three shots now repair it.** It leaves the draft
holding the template's four items, which breaks `14-21` and `14-22` — both match
on "Ballot Items (1)". `openBylawDraft` resets the election before opening it,
keyed on the item count rather than the method, and the seeder repairs it too
for a database somebody else left mutated. The manifest's own guard only
enforces that a mutating shot is last **within its guide**; the two shots it
would have broken are in another one.

## Captured 2026-08-24 (fourteenth) — the outreach-form section, and the three forms it does not list

`19-24`, opened and checked. **488 filled, 12 remaining.** Four existing captures in
guide 07 re-taken because this shot's seed changes what they count.

**The screen is real, and it was empty.** **Events -> Settings -> Public Form**
lists forms returned by `/event-requests/forms`, which filters on the
`event_request` integration — directly on `Form.integration_type`, or through a
`FormIntegration` row for forms wired after the fact. The demo department's
three hand-built forms have neither, so the section rendered nothing but its
Generate button. Not a missing screen: a missing row.

**Seeded through the button's own endpoint, not `POST /forms`.**
`POST /event-requests/generate-form` is what sets the integration type, the
twenty mapped fields and the public slug. A form posted to `/forms` with the
same name would appear in the section while being wired to nothing behind it —
a demo artifact that reads as working software. Generated as a draft, then
published, because a draft renders only the "must be published before it can
accept submissions" warning and never the public URL the caption is about.

**The absence is the marker's subject, and no image can carry it.** Written into
the guide instead: the three forms that are not in the list, named. A caption
claiming a filter works, over a picture of one row, proves nothing on its own.

**Four collateral re-captures, and the numbers are why.** A fourth published
public form moves the Forms page cards from `3 / 1` to `4 / 2`, so `07-04`,
`07-05`, `07-06` and `07-07` were re-taken rather than left reading a fleet size
that no longer exists. `07-06` now opens the builder on the generated form —
twenty fields across three section headers instead of five flat ones, which is a
better picture of the builder than the one it replaces.

**`pngquant` was not installed in this container**, and the first four captures
went to disk at three times the size of the files they replaced (248 KB against
84 KB). `capture.mjs` treats a missing pngquant as non-fatal and says so in a
comment — correct for a capture, silent for a commit. Installed and re-run over
the five files before staging. Worth knowing that the size regression is the
only signal: nothing in the run output mentions it.

## Captured 2026-08-24 (thirteenth) — Call Volume in both modes, and the calls that were not there

`03-82`/`03-83`, opened and checked. **487 of 507 filled.**

**The report was correct and useless.** Count-only Call Volume reads `OrgCall`
rows, and the only ones in the database came from the close-out wizard fixture:
four calls, all on one day, an average of `0.0` per day. That reads as a broken
screen rather than as a quiet department.

**`OrgCall` has no endpoint of its own.** The rows are written by step 2 of the
close-out wizard, through `PATCH /scheduling/shifts/{id}/closeout/calls` — so a
call history can only be built by recording counts against real shifts, which is
also exactly how a count-only department's data comes to exist.
`seed_count_only_calls` records an uneven run pattern across the roster: mostly
EMS, a scatter of everything else, and quiet tours that ran nothing, so the
report has a busiest day worth naming. Recording counts does not finalize
anything, and the close-out fixture is excluded — `03-76` and `03-77` picture
its call rows at specific values.

**The pair is the lesson, and the numbers make it.** Same department, same
period: count-only reports **52 unit responses**, detailed reports **18 total
calls**. Neither is wrong — one counts what the trucks did, the other what
happened — and all three stat cards rename themselves with the mode, which is
what the guide's caution is about.

**`Last 90 Days`, not the default.** The recorded calls sit in a three-week
band; a year-to-date window spreads 52 of them across 236 days and reports
`0.2/day`. Arithmetic that is right and reads as broken. Written into the
helper so the next person does not re-derive it.

**Found in passing:** the department was still on `count_only`, left there by an
earlier capture run. That is the self-healing rule working as designed rather
than a fault — every mode-dependent shot sets the mode it needs, because manifest
order is not a contract.

**Both halves went into `audit_baseline.txt`, and that is now the fourth and
fifth this session.** The report renders inside a dialog, and a scrim is laid
out against the initial containing block, so it cannot reach the reserved
scrollbar gutter — the structural case the baseline documents. Two ordinary
captures of an ordinary screen, flagged purely for having a scrim. The section
stands at seven entries and will take every future modal shot on a light page.
The baseline's own recommendation — retire the subtle tier, which after the
canvas fix reports a constant rather than a regression — is worth someone
acting on; still not from here.

## Flagged by the 2026-08-23 → 08-24 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-23_TO_24.md`](../CHANGE_AUDIT_2026-08-23_TO_24.md#documentation-and-media-disposition).

> **Also landed 2026-08-24, and it retracts a published claim:** the dark-mode
> scrollbar gutter *could* be photographed after all, and the white strip in
> those captures was a real product bug rather than a capture artifact. See
> [Corrected 2026-08-24](#corrected-2026-08-24--the-white-strip-i-said-could-not-be-photographed)
> immediately below this section.

**Two changes invalidate captures in bulk rather than individually**, and both
are called out first because a targeted list will miss shots nobody remembers
taking:

1. **The settings shell.** Nine settings screens — Organization, Events,
   Scheduling, Elections, User Settings, Email Templates and three more —
   carried five navigation idioms between them and now share one. **Every
   existing capture of any of those screens shows an idiom that no longer
   exists**, at desktop and at phone widths alike (where the section list is now
   a scrollable tab strip). This is a re-capture _class_, not a list.
2. **The email notification shell.** Every screenshot or B-roll frame of a
   received Logbook email predates the 5px accent rule and the status chip.
   **Caption which state you shot**: a department that has not pressed **Reset**
   on a template still receives the old shell, so both are current depending on
   the department. An uncaptioned shot of either one reads as a promise about
   the other.

Beyond those: four screens that have never been captured (the check-in station,
the ID Cards panel, Label Printers, the metrics settings screen), four
administration page headers that all changed at once, and four screens rebuilt
end to end.

### Tooling: Prettier was silently deleting markers from the tracker

Found 2026-08-24, while formatting this window's documentation. **Running
`prettier --write` over the training guides removed 40 tracked screenshot
requests from `SCREENSHOT_STATUS.md`** — and changed nothing a
reader would notice.

The mechanism: the marker convention is `> **[SCREENSHOT NEEDED — …]**`, a
blockquote whose opening `**` is closed several lines later. Prettier reads
that opening as unmatched emphasis and escapes it to `\*\*`. The page still
renders identically. But `status_report.py` anchors its pattern on
`^>\s*\*\*\[?`, so an escaped marker is invisible to it, and the guide's
"remaining" count silently drops.

**This was not caused by this window's edits.** Running Prettier over an
unmodified `03-scheduling.md` from `main` reproduces it exactly: nine markers
gone. `lint-staged` runs `prettier --write` over `*.md` on commit, so the next
commit touching any of the five would have done it, and the diff a reviewer saw
would have been backslashes.

It is the same failure this file already records under **"0 remaining was
measuring the wrong thing"** — a marker the tooling cannot see reads as work
that does not exist — arriving by a different route.

**Fixed** in `.prettierignore`, with the reasoning and a re-derivation snippet
written there.

The list is keyed on **"carries a multi-line marker"**, not on "Prettier breaks
it today" — and the merge with `main` on 2026-08-24 is why. Filling markers
changed which files Prettier escapes: guides 08 and 19 stopped being affected,
while this file and guide 04 started. Whether a given marker escapes depends on
the surrounding context, so a file that survives now flips the next time
somebody adds one. Turning prose formatting off a file costs nothing that
matters; losing a tracked capture silently does. Take a file off the list once
it has no multi-line markers left.

### DO NOT CAPTURE

| Screen                                                                         | Why                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The equipment-check **lap** — stops in walking order, collapsed finished stops | **Built, tested, and not wired.** The live check screen still renders the flat compartment list. A capture of the lap would be a screenshot of code no member can reach. `CheckLap.tsx` has no importer outside its own test file — verify with `grep` before believing any claim to the contrary |

### REPLACE — existing images now show a screen that no longer matches

Filenames below were checked against `docs/training/images/` on 2026-08-24. An
area named without a filename is one where the affected image does not exist
yet — those are listed under **SCREENSHOT NEEDED** instead.

| Image / area                                                                                                                                                                                                                                                                                                                                                                                                                           | Guide          | Why                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `08-02-organization-settings.png`, `14-16-election-settings.png`, `03-15-scheduling-settings.png`, `03-32-settings-general-closeout.png`, `03-33-settings-eligibility.png`, `03-34-settings-checklist-timing.png`, `03-35-settings-form-sections.png`, `03-36-settings-apparatus-skills.png`, `03-37-settings-rating-scale.png`, `03-40-settings-position-eligibility.png`, `00-09-account-settings.png`, `00-17-account-settings.png` | 00, 03, 08, 14 | The settings shell. One idiom now on all nine screens                                                                                                                          |
| `03-47-settings-desktop.png` and `03-48-settings-phone.png`                                                                                                                                                                                                                                                                                                                                                                            | 03             | These two exist specifically to show the settings navigation, so they are the most wrong of the set. The phone one must be re-shot at 390×844 against the scrollable tab strip |
| **Any capture of a received Logbook email**                                                                                                                                                                                                                                                                                                                                                                                            | all            | New shell. **Caption whether the department has pressed Reset** — both states are current                                                                                      |
| `01-22-member-lifecycle.png` (Members Admin hub)                                                                                                                                                                                                                                                                                                                                                                                       | 01             | Now opens with the shared frame: four metrics and a Needs attention queue above the tab bar                                                                                    |
| `02-41-training-admin-reports.png`, `02-64-skills-testing-admin.png`                                                                                                                                                                                                                                                                                                                                                                   | 02             | Same frame above the Training Admin tabs. The tab bodies themselves are unchanged, so a capture cropped to the tab content survives                                            |
| `05-25-admin-hub.png`, `05-60-admin-hub-groups.png`, `05-54-admin-hub-assign.png`, `05-72-setup-prompt.png`                                                                                                                                                                                                                                                                                                                            | 05             | Same frame above the Inventory admin hub                                                                                                                                       |
| `03-01-scheduling-tabs.png`, `03-44-month-calendar.png`, `03-04-my-shifts.png`, `03-05-open-shifts.png`, `03-54-crew-board-open-slots.png`, `03-55-staffing-status-cards.png`, `03-59-open-shifts-signup.png`, `03-62-dashboard-signup-positions.png`                                                                                                                                                                                  | 03             | The Schedule tab is a **board** with a status chip per shift and a day panel, not a grid of cards, and claiming a seat is one button rather than a position dropdown           |
| `03-60-dashboard-my-shifts.png`                                                                                                                                                                                                                                                                                                                                                                                                        | 03             | Plus the seven new scheduling staffing tiles beside it                                                                                                                         |
| `01-02-member-profile.png`                                                                                                                                                                                                                                                                                                                                                                                                             | 01             | The Assigned Inventory table is **absent** for a viewer without `inventory.manage`. **Caption the capturing account's grants**                                                 |
| `05-02-inventory-dashboard.png`                                                                                                                                                                                                                                                                                                                                                                                                        | 05             | The organization dashboard's inventory tiles now require `inventory.manage` or `settings.manage`; a shot taken under a plain member account no longer reproduces               |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`, `00-20-member-dashboard.png`                                                                                                                                                                                                                                                                                                                                             | 00, 10         | Seven scheduling staffing tiles are new. **Caption the capturing account's permissions**                                                                                       |
| `02-03-submit-training.png`                                                                                                                                                                                                                                                                                                                                                                                                            | 02             | Submit External Training is rebuilt: the certificate attaches inline, duration is one stepper, and the start time is asked for and kept                                        |
| `04-01-events-list.png`                                                                                                                                                                                                                                                                                                                                                                                                                | 04             | Ranked by what each event wants from the viewer, with a **Needs you** band                                                                                                     |
| `18-01-member-storefront.png`, `18-02-store-admin.png`, `18-03-order-windows.png`, `18-04-my-orders-unpaid.png`                                                                                                                                                                                                                                                                                                                        | 18             | The storefront was redesigned end to end; checkout is now its own route at `/store/checkout`                                                                                   |
| `03-22-equipment-check-builder.png`                                                                                                                                                                                                                                                                                                                                                                                                    | 03             | Nine item types became four, each labelled with what it stores, plus a sealed-container flag                                                                                   |
| `03-25-equipment-checks-tab.png`                                                                                                                                                                                                                                                                                                                                                                                                       | 03             | Item types were renamed in stored data. A capture showing `present` or `functional` shows a value that no longer exists                                                        |
| `05-51-label-print-settings.png`, `05-64-label-settings.png`                                                                                                                                                                                                                                                                                                                                                                           | 05             | The label settings moved onto the settings shell alongside the new Label Printers section                                                                                      |

### SCREENSHOT NEEDED (new captures)

Marked in the guides as `> **[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each needs, because
that is what a capture run has to set up and the marker cannot carry.

**Release lesson / guide 03 — the Schedule board (2 markers)**

- **Desktop board.** _Demo data:_ a month containing one shift of **each** chip
  state — one red with open seats, one green and full, one blue with the demo
  member on it, and **one grey shift that names neither positions nor a minimum
  staffing level**. The grey one is the teaching point and the easiest to omit.
  Select a day so the crew panel and the claim button are both in frame.
- **Phone board (390×844).** Same month; capture the bar grid with the day
  sheet open. **The bottom navigation must be absent** — it hides while an
  overlay is open, and a shot showing it is a shot of the pre-08-20 defect.

**Release lesson — standing shifts (1 marker)**

- **The standing shift dialog.** _Demo data:_ a Tuesday evening shift, biweekly
  pattern selected, horizon left at its default so the "a year out" default is
  visible. Desktop. The panel must show its own action row — a dialog clipped
  at the viewport edge is the defect `modal-panel-scroll` exists to prevent.

**Release lesson / guide 01 / guide 10 — ID cards (3 markers)**

- **Member profile → ID Cards panel.** _Demo data:_ one active card and one
  revoked card on the same demo member, so the status difference and the
  four-character preview are both visible in one frame. **Use demo data** — a
  real member's card record must not be published, even as a hash preview.
- **The check-in station, armed** (release lesson), and the same screen at
  **tablet width** (guide 10). _Demo data:_ a target selected — use a drill
  night, not a medical screening clinic — the reader armed, and at least one
  successful tap in the recent-taps list. Tablet width is how it is actually
  used; a desktop-width shot teaches the wrong deployment.

**Release lesson — label printers (1 marker)**

- **Settings → Label Printers.** _Demo data:_ two registered printers, one ZPL
  and one ESC/POS, one marked default, with a status result visible on at least
  one so the reader sees what a healthy answer looks like. **Use RFC 5737
  documentation addresses (`192.0.2.x`)** — never a real department's printer
  address, which is an internal network detail.

**Release lesson — the administration frame (1 marker)**

- **The metrics settings screen.** _Demo data:_ the Members module, **department
  scope** selected, the "applies to everyone" control visible, and one metric
  mid-swap. **The fourth (queue) slot must be visibly fixed** — that it cannot
  be chosen is the rule the screenshot exists to teach.

**Release lesson — sealed containers (1 marker)**

- **The seal panel on a check.** _Demo data:_ **two** sealed compartments — one
  whose seal matches the previous check, so the clearing shortcut is offered,
  and one whose number differs, so the reader sees **Record seal** and a hand
  count instead. The contrast is the entire teaching point; a single-state shot
  teaches that a seal always clears, which is the misreading the feature was
  designed against.

**Release lesson / guide 08 — My Admin Hours (1 marker)**

- **The rebuilt My Admin Hours page.** No capture of this page exists in any
  guide, and the version one would have shown is gone. _Demo data:_ a member
  with hours in at least three categories and one configured requirement, so
  the category bars and the requirement-progress section are both populated,
  plus at least one category with **no** hours in the period so the muted
  "nothing logged in" line appears. Capture under an account that does **not**
  hold `admin_hours.manage`, so the figures are unambiguously the member's own.

**Guide 18 — storefront (marked as REPLACE, but the states are new)**

- Cart holding two different products, at least one with a size or variant
  selected, so the cart lines and the order stepper are both populated.

### Captions that are now mandatory

Three screens render differently for different viewers, and an uncaptioned
capture of any of them reads as a promise about what everyone sees:

| Screen                      | Caption must state                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Member profile              | Whether the capturing account held `inventory.manage`, or was viewing its own profile                                                |
| Any dashboard               | Which permissions the capturing account held                                                                                         |
| Members administration page | Whether the capturing account held `medical_screening.view` — without it the screening tile reads **unknown** and the queue is empty |

### Not affected

- **Guides 09, 11, 12, 13, 14, 15, 17** — no screen in this window's scope.
  Guide 13 (medical screening) is unaffected in its own pages; the change is on
  the **Members administration page**, which is guide 01/08.
- **Equipment check compartment tree and item rows** at the item level — the
  types were renamed in storage and in the builder, but a captured check sheet
  showing item names and results is still accurate.
## Corrected 2026-08-24 — the white strip I said could not be photographed

CI's image audit caught what a DOM probe had missed, and the finding retracts a
published claim.

**The claim.** `19-11-dark-scrollbar-gutter`'s caption said the scrollbar gutter
"is not in this picture, and cannot be", because
`window.innerWidth - documentElement.clientWidth` measured `0`. I recorded that
as one of the markers describing UI the product does not have.

**It was wrong, and the image itself was the evidence.** Every capture of that
page carried a **pure-white 15px strip** down its right edge against content at
luma 54. `audit_images.py` found it by comparing edge pixels with the content
beside them — the comparison the DOM measurement cannot make. Sampled directly:
`(93, 33, 37)` at `x = w-16`, `(255, 255, 255)` from `x = w-14` to the edge.

**Root cause, and it is a real product bug, not a capture artifact.** `html`
carried the themed gradient as a background _image_, and the `background:`
shorthand resets `background-color` to transparent. The reserved strip is
painted from the canvas _colour_, which an image does not supply, so it fell
back to the browser's white — on every dark-mode page, everywhere. The August 15
canvas move did not fix it; it swapped one image for another. `styles/index.css`
now sets `background-color: var(--bg-gradient-from)` on the root as well.
Verified live: the strip goes from `(255,255,255)` to `(15,23,42)`.

Guide 19 was documenting a fix that had not landed for this case. Its note is
rewritten, marked as a correction, and now says what actually happened.

**The residue that stays.** A dialog's scrim is `position: fixed; inset: 0`,
laid out against the initial containing block, which excludes that strip — so a
light page under a dark overlay keeps a light gutter beside a dimmed page.
Nothing in a page can paint outside its own box. Three modal captures are in
`audit_baseline.txt` for that reason, with the mechanism written beside them.

**Method note worth keeping.** I measured geometry, concluded "nothing to
photograph", and published it. The pixels said otherwise the whole time. When a
claim is about what an image looks like, the check has to be the image — the
same lesson as "open every PNG with Read", one level lower down.

The baseline's own recommendation — retire the subtle light-page-under-scrim
tier, since it is now a constant rather than a regression signal — is
strengthened by this fix but deliberately **not** enacted here: changing a
shared check's contract from a screenshot branch is not mine to do.

## Resolved 2026-08-24 (twelfth) — nine markers that were never going to be screenshots

`10-20` captured; eight markers answered in prose. **485 of 507 filled, 15
remaining** — down from 25 at the start of this batch.

**Six NFC markers, closed with one verified mechanism.** Web NFC is
`window.NDEFReader`, which exists only in Chrome on Android and only in a secure
context. What matters for the guides is what each control does when it is
missing, and the three differ:

| Control                                             | Without Web NFC                        |
| --------------------------------------------------- | -------------------------------------- |
| `NfcTapButton` (Tap Tag)                            | `if (!supported) return null` — absent |
| `NfcTagWriteButton` (compact, fleet QR grid)        | `return null` — absent                 |
| `NfcTagWriter` (full block, event/category QR page) | a line saying which condition fails    |

So a reader on a desktop or an iPhone is not failing to find a greyed-out
button — for two of the three there is no button. That is now written into
guides 04, 06, 10 and 19 in place of the markers, which is more useful than a
staged photograph would have been. The harness itself fails both conditions
(headless Chromium, `http://localhost`), so it could not have taken them anyway.

**The two onboarding-restart markers are a contradiction, not a limitation.**
The wizard runs only when no department exists; with one on file `/onboarding`
redirects to sign-in — verified. Every other image in the library needs a
department. Both frames would need a database with none, in the same run as a
library that needs one. The guides now say that and give the one-minute
reproduction on a scratch install.

**The terminal marker became a code block, and is better for it.** `python -m
app.preflight` was run twice for real — clean on development, exit 1 as
production — and both outputs are quoted verbatim in guide 19. Terminal output
in a code block can be searched, copied and diffed against what your own run
prints; a picture of it can do none of those.

**The "manual annotation" marker got measurements instead of drawings.** Guide
10 claimed 44px tap targets on the Submit Training form and said the comparison
had to be drawn because the "before" state no longer exists. Measured at 375px:
**50 of 52 interactive controls are 44px or taller**. The two that are not are
the painted 18×18 checkbox indicator and a 1×1 hidden file input — each inside a
label that takes the tap (the certification label is **44×317**, the
attach-certificate label 46px). Numbers a reader can reproduce beat an arrow
drawn on a screenshot, and the capture now carries them.

**One framing note worth keeping.** The first full-page attempt at that shot
stitched the sticky submit bar across the middle of the form — the same
`position: fixed` artifact as the bottom bar in the earlier table pair. Viewport
shot, scrolled with `block: "center"` rather than `"end"`, because the sticky bar
occupies the bottom of the frame and an element scrolled to the end lands behind
it.

## Captured 2026-08-24 (eleventh) — a legacy crew seat, and a roster panel no seeded shift can show

`19-23`, opened and checked. **484 of 507 filled.**

**No apparatus had crew seats at all,** so the form the release note is about
rendered "No crew seats configured" and there was nothing to photograph.
`seed_apparatus_crew_positions` gives the rescue four: three configured
positions and `rescue specialist`, which is deliberately not one of the codes.
That is the marker's "legacy read-only position" — a value a department typed
before the picker existed, which the form keeps readable and labels **(legacy
position)** rather than dropping.

**The rank backing shows in the closed control, which is lucky.** Each option
is rendered as "Officer — Fire Chief, Deputy Chief, Assistant Chief…", so the
selected seat carries its eligible ranks without the option list being open —
and the option list could not have been photographed anyway. Third native
`<select>` this pass where that is the answer.

The apparatus item route is **PATCH**, not PUT; PUT returns a bare 405.

### Seed gap: no shift carries a platoon

`03-629` — the shift detail page's hold-over roster, as a scheduler beside the
same shift as a member — **cannot be captured from the current demo data**, and
the reason is worth recording precisely rather than re-derived next pass.

The panel renders only under `platoonsEnabled && shift.platoon &&
platoonRoster.length > 0`. Platoons _are_ enabled and the roster is dealt into
A/B/C (8/7/7 members) — but **0 of 67 seeded shifts carry a `platoon` value**,
so the panel never renders for anyone, scheduler or member.

It cannot be fixed by stamping one on: `ShiftUpdate` has no `platoon` field and
neither does `ShiftCreate`. The **only** writer is
`generate_shifts_from_pattern`, which takes it from the pattern. So seeding this
means generating shifts from the seeded "A/B/C Platoon Rotation" pattern — whose
range is 2026-08-17 to 2027-02-19 — and that would lay a second set of shifts
over the calendar roughly forty verified scheduling captures already read.

Worth doing deliberately, in a pass that re-verifies those captures, rather than
inside a batch aimed at one marker. Two smaller things are already known and
would go with it: the permission half of the marker is real
(`_can_view_platoon_roster` gates the roster on `scheduling.assign`,
`scheduling.manage`, or being the named shift officer), and the approved-leave
half needs care, because approving time-off cancels any assignment inside its
range.

## Flagged 2026-08-24 — the dashboard tabs were renamed the same day

`00-24`/`00-25` were shot hours before the tab strip changed, so **both now show
labels that no longer exist**. The strip reads **Personal** and **My
Department**; the leadership panel's heading reads My Department rather than
Organization, and its failure card says "Department summary is unavailable".

Captions in `00-getting-started.md` were rewritten to describe the two views
without naming the old labels, so the prose is not false while the pixels are
stale — but the frames themselves need re-shooting. Nothing else about either
capture changed: the boundary they exist to demonstrate is the same boundary.

Re-shoot both together, as a pair, for the reason the original pass recorded
below: a department total and your own gear are never on screen at once.

## Captured 2026-08-24 (tenth) — the dashboard's data boundary, under the wrong tab names

`00-24`/`00-25`, opened and checked. **483 of 507 filled.**

**The tabs are not called what the guide calls them.** The prose describes
"Personal" and "Organization"; the strip reads **My Department** and
**Organization**. Corrected in the guide, keeping "personal" as the idea rather
than as a label.

**A single frame cannot hold this marker, and that is the lesson it teaches.**
It asks for the tabs, the personal equipment panel and an organization
aggregate card together — but the whole point of the split is that a department
total and your own gear are never on screen at once. It is a pair.

**The first framing made its own caption false.** Scrolling to My Issued Gear
put the tab strip off the top, under a caption that said "under a tab strip
offering Organization beside it". Full-page for both halves instead, which also
matches them to each other.

**Two numbers in these frames are thin, and are recorded rather than dressed
up.** The Department pulse money cards read $0 (the finance seed gap already
logged in an earlier pass), and the Organization tab's **Training Compliance
reads 0%**. The second is real arithmetic, not a bug: the demo department has
**26 active requirements** and each member carries three training records, so
nobody is fully compliant and the honest figure is zero. Making it non-zero
means seeding a member through all 26 — worth doing, and noted as a seed gap
rather than fixed inside this batch.

## Captured 2026-08-24 (ninth) — a year of admin hours, and a breakdown that named nothing

`19-22`, opened and checked. **481 of 507 filled.**

**Nothing had ever been logged against the admin-hours categories.** Six
categories were seeded; the entries were not, so the Summary tab reported 0hrs
across all three cards and "No completed entries match this reporting period"
under a heading promising a ranking. `seed_admin_hours_entries` logs twelve
sessions across the six categories and six members, spread through the calendar
year, and leaves the three most recent pending so the Needs review card and the
Pending Review tab are not zero.

Two things about how it does that, both forced by the product and worth
knowing: entries are raised **by the members themselves**, because
`POST /admin-hours/entries` credits the caller and an administrator-run loop
would credit one account with the department's whole year; and they are
approved afterwards through the review endpoint, because a manual entry
**always** lands pending on purpose — its times are client-supplied, and
auto-approval would let a member self-credit backdated time.

**The first fixture pass looked fine and left every entry pending.** The step
guarded on a total (`total >= len(ENTRIES)`), so the run after the one that
created all twelve but failed the review call skipped straight past the
approvals. It now matches per entry on the description and drives the approvals
off the _current_ pending list rather than off what this run happened to
create.

**Then the capture showed the real defect: the category breakdown rendered six
nameless bars.** "hrs · entries · 0%", six times, under correct summary cards.
`AdminHoursSummary.by_category` was `list[dict]`, and the alias generator that
gives this module its camelCase responses only rewrites _declared_ fields — so
the totals arrived as `totalHours` while the rows beneath them arrived as
`total_hours`, and every key the tab reads (`categoryName`, `totalHours`,
`entryCount`, `totalMinutes`) was undefined. Typed now, as
`AdminHoursCategoryTotal`, with a test that walks the exact payload the service
builds and fails on any snake_case key surviving into a row.

This is Pitfall #5 with a twist worth naming: the mismatch was **one level
down**. The outer field was declared and aliased correctly, so every top-level
number on the screen was right — which is precisely why nobody would report it.
The page reads as "no data", not as broken.

**One more marker/product mismatch:** the marker asks for the summary showing
"visibly different thresholds". The summary shows hours ranked by category; the
auto-approve and maximum-session limits are configured on the **Categories**
tab and are not on this screen at all. Said so beside the image.

## Captured 2026-08-24 (eighth) — the close-out override, and a template that resolves for nothing

`03-81`, opened and checked. **480 of 507 filled.**

**The warning had nothing to warn about.** The wizard's outstanding-checks
block renders only when the shift carries an end-of-shift checklist nobody has
completed, and the close-out fixture hangs on the Medic — for which no
end-of-shift template existed, because the general equipment-check seed builds
close-out templates only for the apparatus types it happens to iterate.

**Creating one by type looked right and did nothing, which is the finding
worth keeping.** `_resolve_templates` consults apparatus-_type_ templates
**only when the unit has no apparatus-specific ones**, and the Medic already
carries `Medic 3 Supply Check`. So an `ambulance` close-out template was
created successfully, appeared in the template library, reported itself active
— and was never resolved for the one shift it existed for. The fixture now
writes the template against the apparatus itself, and the _product_ behaviour
is written into guide 03 beside the "assign to a specific apparatus or
apparatus type" step, because a department hits it the same way: give one truck
a template of its own and every type-level template silently stops applying to
that truck.

**`require_end_of_shift_checks` gets the `setCallTracking` treatment.** Two
shots want opposite answers — `03-81` needs the rule on to photograph the
override it gates, `03-32` pictures the settings screen at the department's
default — so both set what they need rather than inheriting whatever ran first.
`setRequireEndOfShiftChecks` is the setter; the seeder still leaves the rule
off.

The override box is ticked in the capture because the reason field it demands
does not exist until it is, and the marker asks for both. Ticking is client
state: nothing is written until **Close out shift**, which none of the wizard
shots press — pressing it would finalize the fixture and spend it for every run
after.

## Captured 2026-08-24 (seventh) — guide 19's back-references, and a 403 no department can reach

`19-18`/`19-19` and `19-20`/`19-21`, opened and checked. **479 of 507 filled.**

Two of guide 19's markers describe the same states guides 17 and 14 already
picture, so they are the same pairs re-shot for the release note. Guide 17's
correction travels with them: **there is no account-security block on a
colleague's profile for anybody**, so "use a demo member with MFA enabled so
the redaction is visible" cannot be honoured — enrolment is shown on your own
settings page. Guide 19 now says so beside the pair.

**The hire-date 403 is unreachable in the shipped role catalogue, so it is
written rather than photographed.** The guard is real: `hire_date`, `rank`,
`station`, `platoon` and `membership_number` require `members.manage`, and the
refusal names all five. But no shipped role grants `users.edit` without also
granting `members.manage` — checked against all 28 — so nothing in the product
can be put into the state the marker asks for. Staging it would mean inventing
a role no department has. The guide now quotes the exact refusal and says when
a department would meet it: after building a custom role that separates the
two, a records clerk who maintains contact details but does not set rank.

**One `allowEmptyState` reason was wrong and got corrected before it was
committed.** I wrote that the member's "No address on file." is the withholding
the pair is about, and that the officer's half shows the address filled in.
Checked against `/users`: the member has no address recorded at all, so _both_
halves show that line and it illustrates nothing. The reason now says which
part is the permission (the three absent panels) and which part is simply
unseeded — the rule being that a reason beside `allowEmptyState` is a claim,
and a claim gets verified like any other.

**`TRAINING_MATERIALS_REVIEW.md`'s marker is an example, and is now fenced.**
`status_report.py` excludes that file by name so the count was never wrong, but
a plain `grep` over the guides returns it, and it is the one hit in the library
nobody can act on. Quoted as syntax now rather than demonstrated.

## Captured 2026-08-24 (sixth) — a fourth sign-in, and a Publish control that was never in the editor

`08-77`, `08-78`, `19-16`, `19-17`, opened and checked. **475 of 507 filled.**

**Both editor markers described a control the form does not have.** They ask
for "the revision editor captured under an account holding only
`legal.propose`, so the Publish control is visibly absent". Measured: the
editor offers **Cancel** and **Save draft** — to everybody, publisher included.
Publishing is an action on the _saved proposal_, so the proposal card is the
only place the permission is visible at all. The guides now say that, and the
two shots split accordingly: guide 08, whose marker makes the absence the
subject, gets the proposal card; guide 19, whose marker asks for the body, the
filled change note and the free-text "Last updated" field, gets the editor.

**Whose draft it is decides what the card offers, and that took a second
seeded draft.** `canModify = canPublish || revision.createdBy === currentUser`,
so a draft the administrator wrote shows the secretary _no_ controls — a true
screen picturing no rule. `_seed_secretary_draft` now writes one in the
secretary's own name, and the capture shows both on one card list: their own
proposal with Edit and Discard and no Publish, the administrator's beneath it
with nothing.

**This needed a fourth sign-in, `auth: "secretary"`.** No existing demo account
sits on the middle rung of the guide's three-way table: the administrator
publishes and an ordinary member cannot reach the screen. The **Secretary**
role is the department office that actually carries `legal.propose` without
`legal.publish` or `settings.manage`, which is also the arrangement the guide
describes in words ("the secretary drafts, an officer approves").

**The role was reaching that member as a side effect and now does not.** It was
granted while seeding the closed election's ballot attestations — which works,
and is exactly the dependency that goes quiet when the other step's fixture
guard short-circuits: the capture would then sign in successfully, land on a
screen it no longer has, and time out with nothing pointing at why.
`_ensure_legal_proposer` asserts it from the step that owns the screen.

**The history shots are clipped, and not for framing.** The privacy notice has
no pending proposals, so the page carries "No proposals yet" — true, unrelated
to the history below it, and enough for the empty-state guard to hold both
captures back. Clipping to the history section is also the better shot: the
caption is about the three revisions, not the page.

A third revision was added to `PRIVACY_REVISIONS` because both markers ask for
three, and two entries read as a change rather than as a history.

## Captured 2026-08-24 (fifth) — the tall dialog, and a table shown at both widths

`10-17`/`19-15` and the `10-18`/`10-19` pair, opened and checked. **471 of 507
filled.**

**Finding the tall dialog took measuring, not guessing.** `modal-panel-scroll`
caps a panel at `100dvh - 2rem`, which on a 390x844 phone is 812px — so a
dialog only demonstrates the fix if its content exceeds that, and most do not.
Measured: template picker 301, New Folder 328, Extend Time 375, Merge Write-Ins
409, Clone Election 445, Request Time Off 508, Record Paper Ballots 661,
Rollback 709 — all of which fit without scrolling and put their action row
mid-screen, where nothing was ever painting over it. **Add Course** is 1259px
inside a 758px panel, which is the one that genuinely scrolls.

**The shot is deliberately not `fullPage`.** `capture.mjs` hides
`nav[aria-label="Primary"]` for full-page shots, because full-page stitching
paints a `position: fixed` element at its document offset. A full-page capture
here would have removed the very thing the caption is about and proved nothing.
The prepare step also **asserts the bar is present before opening the dialog**:
without that check, a release that stopped rendering the bar at all would leave
this capture looking identical and still captioned "the bar is hidden while a
dialog is open".

**The reflow pair is the training table, not the documents table the marker
suggested.** `/documents` lists folders until one is opened, and the largest
seeded folder holds two files — a two-row wide table does not read as a table
at all, so the comparison would have shown nothing. The guide's own list of
what reflowed names the training table beside documents, so the pair uses one
member's training history: same page, same three records, 390px and desktop.

**Both halves are viewport shots rather than element clips, and that is not a
style choice.** Clipping to `table.rwd-table` is clean at desktop width and
wrong on a phone: the element is then taller than the screen, and a Playwright
element screenshot paints the sticky header and the bottom bar at their
document offsets — stamped across the middle of the table. Same family as the
full-page rule above; worth remembering as one rule rather than two.

The desktop half is placed in the guide by hand, as the pairing convention
requires — `apply_placeholders` fills one marker per shot, and the second half
carries the `__paired-with-10-18__` anchor that deliberately never matches.

## Captured 2026-08-24 (fourth) — the seeded checks that never existed, and two defects in reading one back

`03-80` and `19-14`, opened and checked. **467 of 506 filled.**

**No equipment check had been completed in the demo database at all.** The
seeder step had been failing for some time with `equipment checks: Items do not
belong to template` — a 400 naming an id and nothing else. The id was the
**section header** `_add_section_header` adds to the engine template. `header`
and `text` rows are layout, not questions: the server excludes them from the
item map by check type and refuses a submission that answers one. Three call
sites in the seeder built the submitted-item list independently, and exactly one
of them filtered — and only for `header`, not `text`. So adding the section
header to the demo template took **every seeded check** with it, and the fleet
grid, the compliance view and every phone capture of a completed check had
nothing to show. One `_checkable_rows` helper now serves all three.

**Reading a completed check back was wrong in two ways, both visible in the
shot.** `GET /equipment-checks/checks/{id}` is what the member's history row
opens, and it was the only endpoint returning a check that resolved neither of
the two things the record is read for:

- **It did not say who signed it.** `checked_by_name` is not a column and this
  endpoint never resolved it, so the detail screen printed **"Checked By:
  Unknown"** over a compliance record whose entire purpose is to name the
  inspector. Every sibling endpoint already resolved it; this one was the
  outlier.
- **It did not say in what order.** The items relationship carries no
  `order_by`, so a twelve-item engine check came back in whatever order the
  rows were yielded — compartments interleaved, and not reliably the same order
  twice. A crew reading a record back walks the same truck in the same
  sequence, so the response now follows the template's compartment and item
  sort order, with rows whose template item has since been deleted
  (`template_item_id` is SET NULL) sorting last rather than vanishing or
  landing mid-walk under a stale position.

`test_equipment_check_detail.py` covers both, plus the orphan row and org
scoping. Its fixture inserts the check items **back to front** so a response
that merely echoes the stored rows cannot pass, and it flushes the template
before the check rows — `template_item_id` is a bare foreign key with no ORM
relationship behind it, so SQLAlchemy has no dependency to order the inserts by
and emits a MySQL 1452 rather than a test failure.

**The offline half of the marker is not pictured, and the guides say so.**
Simulating a dropped connection means setting state on the browser context, not
on the page, which this harness deliberately does not do in a prepare step. A
staged "offline" banner would be a photograph of something the app never
rendered. Both guides now carry a paragraph saying that, beside the record the
two routes actually converge on.

## Captured 2026-08-24 (third) — separation of duties, a paged tab, and the race that hid it

`03-78`/`03-79` with their guide-19 twins `19-12`/`19-13`, opened and checked.
**465 of 506 filled.** Merged `origin/main` (41 commits) first; clean.

**The blocked self-review needed the administrator to be the requester.** The
rule is about people, not permissions — the chief holds `scheduling.manage` and
still cannot review their own swap — so the capture can only be made from the
requesting account. The seeder now raises one swap in the administrator's name
beside the demo member's, and `reviewOwnSwapBlocked` presses Approve on it and
waits for the server's refusal. Nothing is mutated: the service rejects before
it touches the request, so the swap is still pending afterwards and the shot
needs no `mutatesSeedData` flag. What the two rows actually differ by is worth
noting, because the marker guessed wrong: both keep Approve and Deny; the
administrator's own row carries an **extra cancel control** the member's does
not.

**Two markers asked for a control the product does not have.** Both wanted
"pagination controls ... at least 60 requests ... rather than a disabled stub".
There is no numbered pagination and no stub: `REQUESTS_PAGE_SIZE` is **20**, and
the tab renders a single **Load more time-off requests** button that is absent
rather than greyed out once everything is loaded. Both guides now say that.

**The harder half of that marker is invisible in the product.** The tab opens
filtered to **Pending**, and a department's history is resolved by definition —
so with the default filter a database holding twenty-seven time-off requests
shows _one row and no control at all_, while the count beside the view's name
reads 27. That is a real trap for a reader, not a seeding problem, and it is
now written into both guides above the image.

**Chasing that turned up a live stale-response race.** Switching to the Time
Off view and widening the filter in quick succession left the list showing the
_Pending_ results under an _All Statuses_ selector — the twenty rows arrived,
then the slower superseded fetch overwrote them with one. Two overlapping
fetches, no sequence guard; whichever resolved last won. Fixed the same way
`StoreOrdersTab` was: every fetch takes a ticket and only the newest may write
(`loadData` and `loadMore` share the counter, so an appended page cannot clobber
a reload either). `RequestsTab.test.tsx` resolves the two out of order and fails
without the guard.

Worth recording as method: the first probe of this capture looked like a
seeding failure — twenty-seven rows in the database, one on screen. It was two
separate causes stacked, a default filter and a race, and only the _timings_ in
the probe output separated them.

**Seeding notes.** `_seed_time_off_history` raises 26 requests across the ten
summer weeks behind the roster and resolves each as the administrator. Two
constraints are load-bearing and are commented in the seeder: approving
time-off **cancels any shift assignment inside its range**, so the history has
to sit behind the earliest seeded shift or it would silently unseat members
from shifts other guides photograph (verified: 125 assignments, none cancelled);
and the demo member is excluded, because several shots picture her notification
inbox in a known state. The dates were moved from 2025 to summer 2026 on a
second pass — the card prints "Jul 5 - Jul 8" with no year, so a 2025 range
reads as _next_ July.

## Captured 2026-08-24 (later) — the room picker, an overdue loan, and a history tab that leaked its own column names

`06-27` and `05-82`, opened and checked. **461 of 505 filled.**

**The item History tab was rendering its raw payload at members.** Every event
dumped `Object.entries(details)` straight to the page, so an item on loan read

> `user_name: Nadia Belhaj | reason: … | expected_return: 2026-08-20T23:40:15+00:00 | is_returned: false | is_overdue: true`

Three things wrong at once: column names shown as labels, a **raw UTC instant**
put in front of a member who will read it as their own clock — the one thing
the date rules forbid outright — and empty values rendering as a bare `notes:`
with nothing after. Keys are sentence case now, instants go through
`formatDateTime` with the organization's timezone, booleans read Yes/No, and
empty values are dropped.

**Writing the test for that found a second bug in the fix.** A plain
`YYYY-MM-DD` is a calendar date, not an instant, so putting it through
`formatDate` with a timezone _moves_ it: `2026-08-20` came out as `8/19/2026`
in New York. `formatCalendarDate` exists for exactly this and is what it uses.
The test asserts the day does not shift.

**The extracted helper had to leave the component file.** Exporting a function
beside a component costs fast refresh, which eslint flags — and that eleventh
warning put the repo over its `--max-warnings 10` gate. It lives in
`itemHistoryDetails.ts` now, the same split `dateFormatting.ts` documents for
`daysUntil`.

**Two more markers described screens the product does not have:**

- **Guide 06 wanted indented sub-rooms in the room picker.** The picker is a
  native `<select>` — its popup is drawn by the OS, so no list can be
  photographed — and its options are not indented: each carries its whole
  containment path as text instead. That is the better design for a native
  control and for a screen reader, and the guide now says so. What the capture
  shows is the half that is real and useful: a nested room selected, with the
  full path, building, address, room number and floor confirmed underneath.
- **Guide 05 wanted a stock ledger with on-hand, issued and available side by
  side.** No such panel exists, and the three are not three numbers: `quantity`
  _is_ the on-hand count — issuing decrements it, a return adds it back — so
  on-hand and available are the same figure, and the total is on-hand **plus**
  what is out. The items list shows `on-hand / total`; the per-member issued
  counts are on Gear & Uniforms → Members; deployed lots are the Stock Lots tab
  already pictured in that lesson. The marker is replaced with a table saying
  where each number lives and a warning against subtracting the issued count,
  which counts every issued unit twice.

## Captured 2026-08-24 — two permission pairs, and two markers that described the wrong thing

`17-03`/`17-04` and `14-25`/`14-26`, opened and checked. **459 of 505 filled.**

**Guide 17's marker asked for a block that does not exist on that screen.** It
wanted "the account-security block absent" from a colleague's profile viewed
with `members.view` only. There is no account-security block on a colleague's
profile _for anybody_ — MFA enrolment, last sign-in and email verification live
on your own settings page, so neither account has one to compare. The
permission difference the paragraph is really about is large and visible
though, so the pair captures that instead: the officer gets the compliance
summary, the training and certification history and the emergency contacts, and
the member gets none of the three. Worth teaching from the picture: the
member's Contact Information panel renders **empty rather than absent** — the
panel is there, the values are withheld.

**Guide 14's marker was right about the rule and impossible on the seed.**
`list_candidates` returns pending nominations to everyone _while_ nominations
are open — a nominee has to be able to find their own — and to holders of
`elections.manage` at any time; to an ordinary member after nominations close it
returns accepted candidates only. Every seeded election either sat in the
nomination phase or had nobody pending, so the rule had nothing to show. A
dedicated election is now seeded past its nomination phase with one nominee
still un-accepted. Deliberately a _new_ election: four captures need one in the
nomination phase, and advancing that one would empty them.

The member half of that pair also could not be taken as written. A member has
no Candidates tab — their view of who is standing _is_ the ballot — so reaching
for `#tab-candidates` timed out against a tab strip offering only Cast Vote.
Opening the election is the whole prepare, and the withheld nomination shows up
as a shorter list of options rather than a hidden row.

**The numbering trap bit again, and the manifest caught it this time.**
`14-20` and `14-21` were already taken, and the new entries also landed after
`14-24-ballot-send-skipped`, which mutates seed data and must stay last for its
guide. The import-time guard refused to load rather than letting the pair run
and quietly spend the fixture. They are `14-25`/`14-26`, ahead of it.

**One near-miss worth recording.** The member's candidate list came back empty
against a stale session cookie, which looked exactly like the permission rule
over-filtering. It was a 401. Re-authenticating showed the one accepted
candidate. Check the HTTP status before reading an empty list as behaviour.

## Captured 2026-08-24 — legal documents, the recruitment type, and a dashboard pair

Seven captures against a database rebuilt from zero, each opened and checked.
**455 of 505 filled.** Two of them fill a marker in two guides at once, so the
same screen is not photographed twice: `19-09` also fills guide 08's Legal
Documents marker, and `19-10` also fills guide 04's Recruitment marker.

**The database was rebuilt rather than patched.** The scorecard fixture rebuild
had left three voided records behind — a validated result cannot be deleted —
and they were showing up on the test-records capture as demo noise rather than
product behaviour. The rebuild also served as the real test of the fixture guard
rewritten the day before, and it caught one more defect in it: the seeder was
resetting the _administrator's_ password because the roster is returned
admin-first and `members[:3]` reached it, which the API rightly refuses.

**Three markers could not be taken as written, and the prose now says so.**

- **The dark-mode scrollbar gutter cannot be photographed by this harness at
  all.** The headless browser draws overlay scrollbars and reserves no gutter:
  `innerWidth - clientWidth` measures 0 even on a page forced to 4000px. The
  capture shows what it can — the themed gradient reaching the window edges —
  and the guide now tells the reader to look in their own desktop browser for
  the strip itself, rather than implying the picture contains it.
- **"All three reminder choices visible" is not possible** on a native
  `<select>`: the popup is drawn by the OS, not the page. The guide already
  tables all three above the image, so the capture shows which one a new
  optional event defaults to.
- **Legal Documents is tabs, not cards.** The marker asked for "both document
  cards"; the screen shows one document at a time behind a tab strip. Captioned
  for what it is.

**One pair was aimed at the wrong screen first.** The dashboard finance
comparison was written against `?tab=organization`, and both accounts render
that tab without any money section — a pair that compares two screens which are
identical in the one respect the marker is about. The money cards live in
_Department pulse_ on the default tab. Re-shot there and verified by measuring
both accounts: the administrator has Department pulse with dues, cash flow and
budget; the member has none of it, absent rather than empty.

**Empty-state flags on four shots were false positives**, each now carrying its
reason rather than a bare suppression: "No proposals yet" is the Privacy tab's
proposals panel (the seeded draft is deliberately on Terms), and "No reminders"
is an _option inside_ the reminder-audience select.

**New seeding:** the Legal Documents screen had nothing behind it and rendered
both cards on the platform default, picturing the feature unused. Privacy now
carries two published revisions — two, so the revision-history markers have a
superseded entry to show — and Terms an unpublished draft.

**A numbering trap worth knowing:** `--only 04-42` matches `04-42-cast-ballot`
as well as anything else starting `04-42`. Two new shots were numbered into
occupied slots and silently re-shot two unrelated ballot captures. They are
`04-44` and `04-45` now; check the number is free before claiming it.

## Re-captured 2026-08-23 — the phone sweep at 390x844, and what it exposed

**Corrected 2026-08-23 (later).** The amendment that stood here was wrong, and
the way it was wrong is worth keeping.

It reported that `03-71-set-all-to-par-confirm` was blocked by main's lap
redesign, and that `03-72` showed a `quantity` item rendering the pass/fail
control while `03-70` rendered the same type as a stepper — read as a defect in
the new code. **All four equipment-check captures shoot cleanly, and there is no
such defect.** What differed was not the item, it was the process: a backend
left running across the merge was still serving the pre-merge spellings
(`quantity`, `pass_fail`) to a post-merge frontend. Restarting it made
`03-71` capture on the first attempt and put the stepper back on the gloves.

Two things follow, and only one of them is a bug.

**`CheckLap`, `CheckItemControls` and `checkLapModel` are not wired to
anything.** Nothing outside those three files and their tests imports them; the
live screen is still `EquipmentCheckForm`'s own renderer. So the lap redesign
could not have broken a capture — it does not run. Worth knowing before anyone
else reads a check-form symptom as lap behaviour.

**The version skew that caused the false alarm is a real fragility.** The live
form compares `item.checkType` against the canonical four directly and its
control switch ends in `default: passFailButtons`, so a response carrying the
older spellings does not fail — it _degrades_, rendering every count, level and
expiry item as pass/fail. The crew answers Pass on a row meant to record a
number, no quantity is stored, and "Set all to par" has nothing to act on.
`pass_fail` is what hides it: that one lands on the right control by accident,
so most of the form still looks right. A backend on the previous release is the
ordinary state of a rolling deploy, which is exactly how this was hit.

`normalizeCheckType` was written for this and its own comment says it belongs at
the read boundary; nothing called it. `getEquipmentCheckTemplate` and
`getEquipmentCheckTemplates` now do, alongside the `normalizeShift` /
`normalizePositions` that already sit there, with tests that fail when the
normalization is removed. Structural `header` and `text` rows are passed through
untouched — canonicalizing those to `function` would put answer buttons under a
section heading.

**A screenshot caught this, and then nearly buried it.** The first diagnosis
blamed the width, the second blamed a redesign that does not execute. Neither
was reproduced against a restarted stack before being written down. A capture
that disagrees with the code is worth a second process, not just a second look.

**Two of main's renames cost a shot each, silently.** The phone menu control
became "Open full navigation menu" and the quantity stepper became
"One fewer <item>". Both matchers now carry the older spellings alongside the
current one — a capture that fails is cheap, a capture that succeeds against
the wrong element is not.

All 21 phone-width captures re-shot and opened. The trigger was the entry below:
the mobile bottom bar no longer paints over an open dialog, so every phone
capture containing one pictured the defect. That is confirmed fixed — `03-71`
(the set-all-to-par confirmation) and `03-96` (the lots-aboard sheet) now show
the bar correctly absent, and `10-14` and `10-16`, which have no overlay, still
show it.

**The viewport is now 390x844, not 414x896.** Five guide markers and the audit
below already name 390, so 414 was the outlier. The seven shots carrying an
explicit `{ width: 414, height: N }` moved too, keeping their bespoke heights —
a mobile set photographed at two widths is worse than either width.

Three defects came out of the sweep, none of them the one it was looking for.

**1. A sticky bar with no background, which read as a layout bug.** The
equipment check form's Submit bar and page header carried `bg-theme-bg` and
`bg-theme-background`. Neither token existed at the time — the stylesheet
defined `--color-theme-surface`, `--color-theme-nav-bg` and three
`--color-theme-bg-*` gradient stops — so both compiled to nothing and resolved
to `rgba(0, 0, 0, 0)` in the running app. The item list scrolled visibly
through the notes field and the Submit button, which looks like overlapping
content rather than a missing colour, and is why it survived.

Main has since settled this for the whole app: `--color-theme-bg` is now a
real token, deliberately opaque so a sticky bar occludes what scrolls under it
(a surface token cannot — in dark mode those are translucent by design), and
all 26 call sites were repointed. `themeTokenIntegrity.test.ts` walks the
source and fails on any theme utility naming a token the stylesheet does not
declare, with an empty allowlist.

> **Superseded 2026-08-24.** `--color-theme-bg` is defined now: main added it
> as the flat opaque page canvas, for precisely the sticky-bar job described
> above (a surface token cannot do it — those are translucent white in dark
> mode). So `bg-theme-bg` is the _right_ answer on that Submit bar, not the
> wrong one, and the fix recorded here was replaced by main's on merge. The
> ratchet is empty and the guard is now a plain invariant. Two sessions fixing
> one bug from opposite ends: worth reading both sides before keeping either.

_This was nearly misdiagnosed._ The overlap appeared when the width changed, so
it looked like a 390 regression. It reproduces identically at 414 on the same
code, and the geometry probe found no collision at either width — the DOM was
never the problem.

**2. A fixed bar stitched into the middle of a full-page image.** The bottom
navigation is `position: fixed`, so on a full-page capture it is painted into
the first stitch at its document offset: `10-04-mobile-dashboard` had it lying
across "Grant deadlines" with 3000px of page below. No position in a 3620px-tall
picture means "pinned to the bottom of the screen", so `capture.mjs` now hides
it for full-page shots, exactly as it already does for the skip-to-main link.
`10-12-mobile-bottom-nav` is not full-page and still shows the bar.

**3. Two shots that were passing while picturing the wrong thing.**
`10-15-mobile-menu-notifications` opened the drawer and stopped: the control had
been renamed to "Open full navigation menu", and once that was fixed the
Notifications badge the caption is about sat below the fold at 390. It now
scrolls to it, which is what a member does. The matcher keeps the two older
label spellings so the next rewording does not break it silently.

## Captured 2026-08-23 — the storefront, and three defects behind one placeholder

`19-03-privacy-header`, `19-04-qr-directory-search`, `19-05-qr-regenerate-warning`,
`19-06-store-admin-orders`, `19-07-member-payment-method` and
`19-08-store-admin-activity` are captured, opened and checked. 445 of 485 filled.

Guide 19's Store Admin marker could not be photographed at all until three
defects were fixed, and each was invisible from the previous one.

**1. The Store Admin landing page answered 500 whenever the store was in use.**
`get_open_windows` did not eager-load `offerings`, and the endpoint serializes
its result through `_window_payload`, which reads `window.offerings` and each
`offering.product.name`. Under asyncio a lazy load there raises
`MissingGreenlet` rather than emitting a query, so the dashboard failed for any
department with an open order window — the only state in which the page has
anything to show. `list_windows` and `get_window` already eager-load it.

**2. Opening the Orders tab raised a dialog stuck on "Loading…".**
`StoreAdminPage` holds `ordersDetailId` as `''` when nothing is deep-linked;
`StoreOrdersTab` did `useState(initialOrderId ?? null)`, and `'' ?? null` is
`''`. `OrderDetailModal` opens on `orderId !== null`, while its fetch is guarded
by `if (!orderId) return` — so an empty string opened a dialog with no order
behind it, over the list the administrator came to read. Pitfall #1 in its exact
documented form; `||` was the fix.

**3. The status filter silently showed the wrong rows.** Changing a filter
starts a fetch without cancelling the one running, and the tab issues more than
one unfiltered load while mounting. When an unfiltered response landed after the
filtered one it overwrote it, leaving the control reading "Paid" over a list of
every order — six rows read as though they were the two that were asked for. A
request-sequence guard now lets only the newest response write. Both defects
have tests that fail against the old implementation.

**One placeholder asked for text the product does not have.** The marker wanted
"the explanatory text that reporting payment is not payment processing" beside
the payment-method editor. No such text exists anywhere in the member-facing
storefront: the screen offers the department's handles, a method picker and an
"I've sent payment" button, which reads as a checkout. Rather than caption a
note that is not in the frame, the image is captioned for what it shows and the
guide now states the distinction in prose and says plainly that the screen does
not.

**One marker needed two images.** The activity cards are on Overview and the
list they describe is on Orders; no tab shows both. Split into `19-08` and
`19-06` with a sentence tying them together — the workflow breakdown counts
**Paid 2** and the filtered list returns those same two orders.

**Seed gaps closed:** the order window is now opened explicitly rather than
waiting for `autoOpen` to be noticed by a background task (a fresh database
produced no orders at all, and the second seeding run silently produced them),
and three member orders are placed and advanced so the list carries four
distinct states. The administrator's own order is deliberately left unpaid —
`18-04-my-orders-unpaid` pictures it.

**A capture-harness lesson worth keeping:** the first version of `19-06` waited
for `Showing 1 – 2 of 2`. That count depends on how many orders the seeder has
advanced to paid, which moves between runs, so the shot passed or timed out
according to the demo data rather than the page. It now waits for the filtered
request itself.

## Captured 2026-08-23 — the room tree, and a fixture that was never written down

`06-24-rooms-nested-tree`, `06-25-room-located-inside` and
`06-26-room-delete-subrooms` are re-captured, opened, and checked. Two things
came out of it that outlast the images.

**The room fixture existed only in one database.** The 2026-08-17 entry below
says these three "are driven from `manifest.mjs` against a seeded demo
department, so they re-shoot rather than going stale". Half of that was true:
the manifest drives the capture, but `seed_demo_data.py` never contained the
word "Volunteer Office". The tree was built by hand during that capture session
and lived only in whichever database it was using. Dropping that database
destroyed it, and all three shots failed with a 20-second locator timeout on a
room nothing had created. The tree is now seeded (`HQ_ROOMS`), hung off the
facility named in `FACILITIES[0]` rather than off "whichever the API returns
first" — a tree that moved between runs would point three shots at an empty
Rooms section without failing anything.

**The delete confirmation misstated what it was about to do.** It counted
descendants: deleting Volunteer Office — two sub-rooms, one grandchild —
promised that "3 sub-rooms will move up a level". The backend re-parents
`WHERE parent_room_id = room_id`, so **2** move; Locker Cage keeps its own
parent and rides along inside that subtree. The dialog also contradicted the
row badge directly above it, which has always shown the direct count. On a
confirmation whose only job is to state the consequence of something
irreversible, that is worth more than the screenshot. Fixed, with a test that
fails against the old implementation; `06-26` was re-shot afterwards and now
reads "Its 2 sub-rooms".

**The stray facility is gone from the pictures.** All three previously showed a
facility header reading "Oakville Fire Department / Station 1" — the record
onboarding auto-creates and the seeder then duplicated. They now read
"Station 1 - Headquarters".

Guide 19's rooms marker asked to reuse this capture rather than take its own
("shared with lesson 06; capture once, reuse"), so it now references
`06-24-rooms-nested-tree.png` directly. 439 of 485 filled.

## Captured 2026-08-23 — the close-out wizard, and why it had never shot

`03-74-settings-call-count-toggle`, `03-75-closeout-step1-attendance`,
`03-76-closeout-step2-calls` and `03-77-closeout-step3-confirm` are captured,
opened, and checked against their captions. All four had manifest entries since
2026-08-19 and had never produced an image; four separate faults stood between
the entry and the picture, and only the first announced itself.

**1. The scheduling seed died on its own feature working.** Seating crew
tolerated a "conflicting shift" 400 and re-raised everything else, but
`_require_evoc_on_apparatus` deliberately puts a minimum EVOC level on the
heavier rigs so the driver-eligibility check fires, and operators are certified
for only the first four. A driver seat landing on an uncertified member is the
demonstration, not an error — it raised, and the step died on the first one.
The demo had **2 shifts instead of 66**, which silently took out the close-out
fixture, the batch report trainee, the shift reminder inbox and every scheduling
request. Both refusals now go through `is_expected_seat_refusal`, matching
`LB-SCHED-001` on the error code rather than on a sentence that names the level
and the apparatus.

**2. The fixture read the wrong endpoint.** `_closeout_apparatus` asked
`/scheduling/apparatus` — the scheduling module's own `basic_apparatus` table,
which this demo never populates — so it answered `[]` and reported "no
non-engine apparatus to hang it on" against a seven-unit fleet that plainly
included the Medic its own hint asks for. It now reads
`/scheduling/apparatus-options` and unwraps the `{"options": [...]}` container
the rest of the scheduling seed already names.

**3. A predicate cannot close over this file.** `openStaffedShift` ships its
match function across as source text and rebuilds it with `new Function`, which
keeps the syntax and drops the scope. The close-out call site referenced
`CLOSEOUT_SHIFT_NOTE`, so every one of the three wizard shots failed with
`ReferenceError: CLOSEOUT_SHIFT_NOTE is not defined` — thrown in the browser,
with nothing in the manifest looking wrong. The constant is now interpolated
into the source string, and `openStaffedShift` says so.

**4. The step read raced the re-render, and nothing failed.** The walk clicked
Next and read `aria-current` immediately; the progress nav renders on every
step, so waiting for the wizard to be "visible" was satisfied instantly and the
read returned 1 while the body was still swapping to step 2. The `=== 2` guard
never fired, the call rows were never filled, and the capture **succeeded** —
writing a screen of ten empty rows under a caption about three EMS and one fire.
This is the failure mode worth remembering: a shot that captures cleanly and
pictures the wrong thing. The walk now waits for the step marker itself to move.

**Framing.** All three wizard shots are clipped to the card and shot at
1440x1300. At the 900px default the card is taller than its drawer, so step 1
lost the combined-hours figure its marker explicitly asks for and step 2 opened
already scrolled past the rows it exists to show. Clipping also keeps the
drawer's Notes card — which carries the seeder's own "Close-out wizard fixture"
text — out of a published image.

**One prose correction.** The guide's callout asserted that combined hours on a
four-person 24-hour tour "is 96". It cannot be, on the crew the same marker
demands: the fixture carries one member who never checked out and one who was
never checked in, and both contribute zero, so the screen reads **47.8**. The
callout now states the ideal, then explains why the picture is short of it and
what a short figure means. Verified arithmetic: 24.0 + 0.0 + 23.8 + 0.0 = 47.8,
and step 3 reports the same 47.8 against 4 calls (3 EMS + 1 Fire) from step 2.

`03-75` carries `allowEmptyState` with its reason: "no check-out recorded" is
the flag the shot exists to photograph, so the guard was reading the subject of
the capture as its absence.

**Still open in this group, unchanged:** close-out with outstanding
end-of-shift checks, and Reports → Call Volume in count-only mode. Their
blockers are recorded under the 08-17 → 08-19 entry below and neither is fixed
by the above.

## Flagged by the 2026-08-19 → 08-23 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-19_TO_23.md`](../CHANGE_AUDIT_2026-08-19_TO_23.md#documentation-and-media-disposition).

**One change invalidates captures in bulk rather than individually.** The
mobile bottom navigation used to paint over open dialogs; it now hides while
one is open. That means **every phone capture showing a dialog was taken
against the defect** — the bar in those shots is not a UI element the reader
should expect to see, it is the bug. This is a re-capture _class_, not a list,
and it is called out first because a targeted list will miss shots nobody
remembers taking at a narrow viewport.

Beyond that: one genuinely new screen (Governance → Legal Documents), a new
event type in a picker that appears in several captures, a paginated Requests
tab, and new dashboard sections.

### REPLACE — existing images now show a screen that no longer matches

| Image                                                                                                                     | Guide          | Why                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any phone capture containing a dialog, drawer or bottom sheet**                                                         | all            | The bottom navigation no longer renders while an overlay is open. Every such shot predates the fix and shows the bar sitting on top of the dialog — the exact defect that was repaired. Re-shoot at 390×844 |
| `10-04-mobile-dashboard.png`                                                                                              | 10             | New dashboard widget sections; also subject to the dialog rule if any overlay is open in frame                                                                                                              |
| `10-12-mobile-bottom-nav.png`                                                                                             | 10             | Still correct as a shot of the bar itself, but now **needs a companion** showing the bar _absent_ behind an open dialog. Alone it now teaches the wrong expectation                                         |
| `03-11-swap-requests-tab.png`                                                                                             | 03             | The Requests tab is paginated, and the review controls now differ depending on whether the viewing member raised the request. The current shot shows neither                                                |
| `04-05-create-event.png`                                                                                                  | 04             | The event type picker gained **Recruitment**. A reader comparing their screen to this one will conclude their build is older                                                                                |
| `04-09-event-templates.png`                                                                                               | 04             | Same picker, same problem, in the template form                                                                                                                                                             |
| `04-02-event-detail.png`                                                                                                  | 04             | The event page now shows the applicants an event brought in. The current shot has no such section                                                                                                           |
| `04-01-events-list.png`                                                                                                   | 04             | Only if shot at a narrow viewport — the events page was cut down for phones. Desktop captures are unaffected                                                                                                |
| `03-22-equipment-check-builder.png`                                                                                       | 03             | Responsive builder actions changed, and compartment paths can now be deeper than the old shot shows                                                                                                         |
| `03-25-equipment-checks-tab.png`                                                                                          | 03             | Expired-equipment failures are now derived at read time, so the status column can differ from a shot taken at submission time                                                                               |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`, `00-20-member-dashboard.png`, `02-17-officer-dashboard.png` | 00, 02, 10     | New permission-scoped widget sections. **Caption which permissions the capturing account held** — the sections a reader sees depend on their own grants, and an uncaptioned shot reads as a promise         |
| `06-09-facilities-dashboard.png`, `05-02-inventory-dashboard.png`                                                         | 05, 06         | Asset widgets are new on the organization dashboard                                                                                                                                                         |
| **Any capture showing browser tab chrome**                                                                                | all            | Tab titles were generic before this window and are page-specific now. Only affects shots that include the tab strip                                                                                         |
| **Documents, training, audit and check-in tables at narrow viewports**                                                    | 07, 02, 08, 04 | These now reflow into stacked cards instead of scrolling sideways. Any phone capture of them shows the old behaviour                                                                                        |

### SCREENSHOT NEEDED (new captures)

Marked in the guides as `**[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each needs, because
that is what a capture run has to set up and the marker cannot carry.

**Guide 08 / release lesson — Governance → Legal Documents (4 markers)**

- **Landing view**, both document cards. _Demo data:_ one document with a
  published revision, one with an unpublished draft, so the status difference
  is visible in a single frame. Use a demo department name — this page shows
  the department's own legal wording and a real one should not be published to
  a guide.
- **Revision editor** showing the body, the **required change note** filled in,
  and the free-text "Last updated" field. _Demo data:_ capture under an account
  holding **only `legal.propose`**, so the Publish control is absent. That
  absence is the subject of the shot and must be captioned, or it reads as a
  missing feature.
- **Revision history** for one document. _Demo data:_ **three** revisions — one
  published, two archived — each with a change note and a publishing member.
  Two rows read as an accident; three read as a history.
- **A published revision reflected on `/privacy`.** _Demo data:_ the same
  department, showing that what was published is what the public page serves.

**Guide 03 — scheduling (3 markers)**

- **The error after a self-review attempt.** Sign in as the member who raised a
  pending swap, press **Approve** on it, and capture the error ("Requesters
  cannot review their own swap requests") with the request still pending.
  _Demo data:_ one pending swap raised by the capturing account.
  **Corrected 2026-08-23:** this marker previously asked for a side-by-side of
  two rows with differing controls. That capture cannot be taken —
  `RequestsTab` renders Approve/Deny for **every** pending request whenever the
  viewer holds `scheduling.manage`, own requests included, so the rows are
  identical until the button is pressed. The rejection is server-side and only
  appears after the click.
- **Requests tab with pagination populated.** _Demo data:_ **at least 60**
  requests, so the control is active rather than a disabled stub.
- **Submitted shift equipment check at 390×844.** _Demo data:_ a completed
  check. If the harness can simulate the offline/queued state, capture that
  too; **if it cannot, say so in the caption rather than staging it** — a faked
  offline badge is the kind of detail a reader who has actually been in a dead
  spot will catch.

**Guide 04 — events (2 markers)**

- **Event form with Recruitment selected**, both guest switches on, and the
  teal banner reading "Guests who sign in at this event will be added to the
  prospective members pipeline."
- **Event detail showing linked prospects.** _Demo data:_ a recruitment event
  with **at least three** guest sign-ins converted to prospects.

**Guide 10 — mobile (2 markers)**

- **A tall dialog at 390×844 scrolled to its action row, with the bottom
  navigation absent.** _Demo data:_ any dialog taller than the viewport. This
  is the reference shot for the whole re-capture class above.
- **A reflowed table at 390×844 beside the same table on desktop.** The
  **pair** is the point — a single shot does not show a reflow.

**Guide 08 — dashboards (1 marker)**

- **The organization dashboard under two accounts side by side**: one holding
  `finance.manage`, one without. _Demo data:_ seeded finance figures. The
  finance section must be **present in one and absent — not empty — in the
  other**. The comparison is the entire lesson; either shot alone teaches
  nothing.

### Do not capture

- **The public `/privacy` page of a real department.** Use demo wording. This
  screen now shows department-authored legal text, and publishing a real
  department's notice into a training guide is a different act from publishing
  a screenshot of a generic settings page.

## Flagged by the 2026-08-17 → 08-19 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-17_TO_19.md`](../CHANGE_AUDIT_2026-08-17_TO_19.md#documentation-and-media-disposition).

Two things landed that invalidate existing captures rather than merely adding
new ones: **shift close-out is a different screen** for departments recording a
call count, and **four QR pages gained an NFC control in their action row**.

### REPLACE — existing images now show a screen that no longer matches

Each of these is in a guide today and is wrong, incomplete, or newly ambiguous.
Listed with the file so a re-capture run can target them.

| Image                                                        | Guide  | Why                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-45-finalize-checklist.png`                               | 03     | Still correct for a **detailed**-mode department, and now ambiguous without saying so. The guide has been given a note above the image; the image itself needs a caption change, and the count-only wizard needs shooting alongside it rather than replacing it |
| `03-32-settings-general-closeout.png`                        | 03     | The _Shift close-out rules_ block gained **Record a call count at close-out**. The current shot predates it, so a reader looking for the toggle will conclude their build does not have it                                                                      |
| `03-14-scheduling-reports.png`                               | 03     | If the demo department is switched to count-only for the new captures, the Call Volume card relabels. Verify which mode this was shot in and caption it                                                                                                         |
| `04-04-event-qr-code.png`                                    | 04     | The page gained **Write to an NFC tag** below the QR code. The current shot is missing a control the guide now describes                                                                                                                                        |
| `03-08-calls-runs-section.png`                               | 03     | Correct, and now conditional — Calls / Runs does not exist for a count-only department. Needs a caption saying which mode it shows                                                                                                                              |
| Check-In QR Codes directory (guide 06, `#check-in-qr-codes`) | 06     | Apparatus cards gained **Write NFC tag** in the action row. There is **no captured image of this page at all**; the new marker below covers it                                                                                                                  |
| Shift detail QR block (guide 03)                             | 03     | The NFC writer now sits beneath the QR code. No dedicated capture exists; covered by the marker below                                                                                                                                                           |
| `17-01-privacy-choices.png`                                  | 17     | `/privacy` and `/terms` were rewritten on 2026-08-17 with a new print stylesheet. Any capture of either page predates the rewrite                                                                                                                               |
| `00-04-dashboard-overview.png`, `00-20-member-dashboard.png` | 00, 10 | Only if shot at a narrow viewport — the week strip and alert list now collapse on a phone. Desktop captures are unaffected                                                                                                                                      |
| Login page (guides 00, 03 of the YouTube set)                | 00     | Only for departments with `CAPTCHA_ENABLED`. The challenge widget is new on the two internet-exposed forms and appears in no capture                                                                                                                            |

### SCREENSHOT NEEDED (new captures)

These are marked in the guides as `**[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each one needs,
because that is what a capture run has to set up and the marker cannot carry.

**Guide 03 — scheduling (6 markers)**

- **Settings → General → _Shift close-out rules_** with **Record a call count at
  close-out** switched on and its explanatory paragraph legible.
  _Demo data:_ none beyond the toggle.
- **Close-out wizard step 1 — attendance.** _Demo data:_ a **four-person crew on
  a 24-hour tour**, so the combined-hours figure reads ~96 and visibly is not
  the shift length; at least one member with a missing check-out; at least one
  assigned member who never checked in, showing empty times.
- **Close-out wizard step 2 — calls.** _Demo data:_ two or three type rows
  filled (e.g. EMS 3, Fire 1) with the derived total showing 4 and rendered
  read-only. This is the screen that teaches "the rows are the only source" and
  the read-only styling has to be visible.
- **Close-out wizard step 3 — confirmation.** _Demo data:_ the same crew, credit
  seeded from the apparatus count, **one member adjusted downward** for a late
  arrival, plus the pass-down notes field.
- **Close-out with outstanding end-of-shift checks.** _Demo data:_
  `require_end_of_shift_checks` on, one check outstanding, showing the warning,
  the override checkbox, and the reason field it requires.
- **Reports → Call Volume in count-only mode**, showing **Unit Responses / Avg
  Responses/Day / Peak Responses** and the footnote. **Caption it against the
  detailed-mode version** — the whole point is that the labels differ, and a
  lone capture teaches neither. Two things not to imply in that caption
  _(added 2026-08-19)_: detailed mode's "Total Calls" is **also** not an
  incident count (it sums per-trainee shift completion reports), and there is
  **no per-apparatus breakdown on this screen** to frame — the API returns
  `by_apparatus_runs` and the renderer ignores it, so do not treat its absence
  as a mis-seeded capture. See `KNOWN_LIMITATIONS.md` SCHED-15 / SCHED-16.

**Guide 04 — events (3 markers)**

- **`/events/:id/qr-code` mid-write**, showing the "hold a tag to your phone"
  state rather than the idle button.
- **Tap Tag on the Events page, scan armed**, waiting for a tag.
- **Tap Tag after reading an unrecognized tag** — the explanatory message with
  the scan still armed. This is the security behaviour, and a reader will not
  believe "it just doesn't navigate" without seeing it.

**Guide 06 — apparatus & facilities (1 marker)**

- **`/locations/qr-codes` on a phone**, an apparatus card mid-write with its
  action row showing Copy URL / Download PNG / Regenerate / **Write NFC tag**.
  Shoot it on a phone, not desktop: that is where the button is usable, and the
  card grid is the thing being described.

**Guide 10 — mobile (1 marker)**

- **A phone held against a mounted NFC tag on an apparatus**, and the resulting
  shift check-in page naming the unit, date and hours. Two frames or one
  composite. Note the camera-viewfinder caveat below does **not** apply — no
  viewfinder is involved.

**Guide 19 — release changes (3 markers)**

- **Admin hours category QR page** with the NFC tag writer beside the QR code.
- **`python -m app.preflight`**, two terminal captures side by side: exit 0 on a
  good configuration, exit 1 on a broken one with the blocking items listed.
- **The rewritten `/privacy` header**, showing the department-control statement
  above the fold.

### Capture constraints for this batch

**Four of the six guide-03 captures are now automated** _(2026-08-19)_ —
`03-74-settings-call-count-toggle`, `03-75-closeout-step1-attendance`,
`03-76-closeout-step2-calls` and `03-77-closeout-step3-confirm`. They run
against a dedicated fixture the seeder builds: a past **24-hour tour with four
crew**, one member checked in but never out, and one assigned member with no
attendance row at all. Both of those last two are states no other seeded shift
carries, because `_seed_shift_attendance` checks every past crew fully in and
out — right for every other shift, useless for this one.

Three things about that group are worth knowing before editing it:

- **Each shot forces the organization's call-tracking mode**, and
  `03-45-finalize-checklist` forces it back. The mode decides which of two
  entirely different close-out screens renders, either shot may run first, and a
  shot that inherited the wrong mode would still **succeed** — it would just
  write the wrong picture under the right filename. This is the same
  self-healing rule `capture.mjs` applies to `navigationLayout`.
- **Each shot walks the wizard from step 1.** The server remembers how far the
  last run advanced (`shifts.closeout_step`) and reopens there, so without the
  rewind a second capture run would open at step 3 and the "step 1" shot would
  quietly contain step 3.
- **Nothing clicks "Close out shift".** That finalizes, and a finalized shift
  will not reopen the wizard — one capture run would spend the fixture for every
  run after it. If the fixture is ever finalized by hand, the seeder says so and
  refuses to reuse it rather than silently building a second one.

**Two of the six are still manual, with the specific blocker for each:**

- **Close-out with outstanding end-of-shift checks.** Needs
  `require_end_of_shift_checks` on _and_ a shift with an outstanding check.
  Equipment-check templates resolve by apparatus type and the demo department
  writes its checklists for **engines**, while the close-out fixture is
  deliberately a Medic — putting it on an engine would let it race
  `03-45-finalize-checklist` for the same shift. Closing this needs either an
  engine-typed second fixture or a medic checklist template in the seed.
- **Reports → Call Volume in count-only mode.** Needs actual `org_calls` rows,
  and the fixture has none: calls are written by the wizard, and the wizard
  shots deliberately stop short of finalizing. Closing this needs the seeder to
  POST `PATCH /scheduling/shifts/{id}/closeout/calls` against a _second_ past
  shift — one the wizard captures do not use, so the two do not fight over
  `closeout_step`.

**The NFC captures cannot be automated at all.** Web NFC does not exist in the
headless Chromium the harness drives, and it is not exposed over `http://`
either. They are manual captures on a real Android phone, like the
camera-viewfinder shots recorded under the 2026-08-12 entry below, and they must
not be added to `manifest.mjs`.

## Tracker corrected 2026-08-17 — the count was never 421 of 423

Two defects in the pipeline were found while capturing the nested-room shots,
both fixed in the same pass:

1. **`MARKER` did not match a descriptive request.** The pattern required
   `[SCREENSHOT NEEDED]` as a closed token, so every
   `**[SCREENSHOT NEEDED — what to capture]**` marker — the form both August
   documentation passes used — was invisible to `status_report.py` _and_
   `apply_placeholders.py`. 41 outstanding captures across 12 guides were
   uncounted; the tracker read **421 of 423 filled (2 remaining)** while the
   real figure was 40 outstanding. The honest count is now **424 of 464**.
2. **Applying one placeholder deleted its neighbours.** `block_end` consumed to
   the end of the blockquote, and guides stack two or three requests in one
   quote separated by a bare `>`. The first replacement swallowed the rest —
   image applied, sibling requests gone, unshot and unrecorded. It happened
   once for real (the "Located Inside" request) before the behavior was found.
   11 markers across three guides were in that position. `block_end` now stops
   at the next marker.

**If you have applied placeholders on a branch since 2026-08-12, check for
silently dropped requests** — the symptom is a request that was in the guide
and is now neither a marker nor an image.

## Captured 2026-08-17

- `06-24-rooms-nested-tree` — Rooms section as a three-level tree (Volunteer
  Office → Quartermaster's Storage → Locker Cage, plus Records Closet), with
  sub-room counts and the hovered row actions.
- `06-25-room-located-inside` — the room form's "Located Inside" field.
- `06-26-room-delete-subrooms` — the delete confirmation naming the sub-room
  consequence.

All three are driven from `manifest.mjs` (ids `06-24`…`06-26`) against a
seeded demo department, so they re-shoot rather than going stale.

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

### Added by the post-audit August 16 merges

- **Storage Areas page** (guide 05): now shows all areas by default and every
  area is assigned a barcode (auto-assigned `SA-…` series). Re-verify any
  storage-areas capture; a new capture should show the barcode column
  populated on every row. **Do not caption it as scannable** — the code is
  assigned and printable, but the inventory scanner cannot resolve it yet
  (KNOWN_LIMITATIONS INV-8).
- **Equipment-check rejection vs. offline queue** (guides 03/10): capture a
  server-rejected check showing the real error message — **not** the
  "queued for sync" toast — and, separately, the abandoned-after-retries
  loss notice. Requires demo setup that forces a 4xx (e.g. a
  revoked-permission account).

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

## "0 remaining" was measuring the wrong thing — 41 placeholders the tooling could not see

Guide 01's two named placeholders are filled and verified (see the entries
below). Re-checking them turned up something larger: **`status_report.py` and
`apply_placeholders.py` shared a regex that matched none of the guides' actual
placeholders.**

Both required `\[SCREENSHOT NEEDED\]` — the bracket closing immediately after
the word. Guides carry two syntaxes:

```
> **[SCREENSHOT NEEDED]:** _description outside the brackets_
> **[SCREENSHOT NEEDED — description inside the brackets]**
```

Only the first matched. The second form accounts for **41 placeholders across
twelve guides** — twenty of them in `19-august-2026-release-changes.md`, four
each in guides 04 and 06, three in guide 09 — and several carry their own seed
instructions ("seed orders in at least three states", "seed one
organization-owned template and no vote data"). They were never counted, never
attempted, and reported as though they did not exist. The tracker has been
saying "0 remaining" while forty-one specified requests sat unread; the same
list appears in this file's own SCREENSHOT NEEDED sections, so the work was
known and the tooling simply never saw it.

The bracket is now optional and unterminated in both scripts, which report
**432 captured, 40 remaining**. Two properties were checked before changing it:
every one of the 436 manifest shots carries an `anchor` (so no shot can drift
onto a bracketed placeholder on a stale line number alone), and a dry run
before and after replaces the identical set — the wider pattern lets the
counter see these placeholders without letting the applier fill any of them by
accident.

### 00-15-sidebar-member was the administrator's sidebar

The shot had no `auth` key, so it defaulted to admin: an image captioned "the
member-facing sections" showed the ADMINISTRATION heading and Department
Setup. 00-16's comment beside it recorded the symptom without naming the
cause — it said an element clip of the nav "would be the same picture as the
member-section shot above", which was true because both were the same user.

Re-shot as a member, and the real member sidebar differs in more than the
missing admin half: **Operations reads My Issued Gear / Gear & Uniforms**,
where the stale admin capture showed My Equipment / Inventory. Those are
renames, not permissions — no gate distinguishes them — so guide 00's member
table was documenting labels the product no longer uses, and listing
Department Store as an Operations child when it is its own top-level item.
Corrected, along with **Gear Admin** (was Inventory Admin) in the
Administration table, which the re-shot 00-16 exposed.

00-16 also still pictured the raw-UTC dashboard timeline
(`2026-08-16T23:00:00+00:00`) fixed earlier in this session, so it was re-shot
too — an image displaying a bug the shipped code no longer has.

### 01-39-scan-member-id-nav — the third guide-01 placeholder, filled

The one in the invisible syntax asked for "side-by-side navigation for a
`members.view`-only role and a `users.view` role". Checked against
`SideNavigation.tsx` first: the rule is real —
`anyPermission: ['users.view', 'members.manage']` — but the link is called
**Scan Member ID**, not "Scanner", and it lives under Members in the
Administration section.

Two roles cannot be one picture, and the harness authenticates as the
administrator, the demo member, or nobody — a `members.view`-only role is none
of those. Split the way `09-18` and `01-membership.md:1156` were: the elevated
half is captured, and the member half is cross-referenced to 00-15, whose
sidebar has no Administration section at all — which is _why_ the scanner
cannot appear there. Seeding a fourth identity would picture the permission
pair exactly and is left recorded rather than half-done.

Three harness lessons paid for by this one shot, all now written beside it:

- **`innerText` lies about case.** The heading is uppercased by CSS, so the
  DOM text is "Administration" and an exact `"ADMINISTRATION"` match — which
  is what a debug dump shows you — never fires.
- **The Administration sub-items are not anchors.** A `getByRole("link")`
  locator finds nothing with the group open and the words plainly on screen.
- **The admin half of the nav is built after permissions resolve**, so for a
  moment the only button named "Members" is the member-facing roster item, and
  clicking that one expands nothing. The shot waits for the section first.

## The 2026-08-17 pass — guides 04, 09, 06 and 08, 103 changed images verified

All four guides were re-captured against the rebuilt database and the merged
build, and **every changed image was opened and read against its caption** by
three parallel verification passes before anything was committed. Ninety-two
came through verified; the rest were dispositioned rather than trusted:

- **Thirteen kept their previously verified bytes** instead of the fresh
  capture, because the new frame showed a data regression, not a code change:
  the meetings module, event requests, QR-scan analytics, apparatus fuel
  logs, permanent equipment assignments and overdue facility maintenance are
  all **unseeded on a fresh database** (the long-lived one had accumulated
  them), the compliance dashboard's rate cards need screening data the seed
  does not create, two inbox shots need read notifications the fresh inbox
  lacks, and the event QR shot caught a check-in window that had closed.
  Each is an open seed gap recorded here so a future pass fixes the seeder
  rather than re-diagnosing the empty frame.
- **Time-sensitive fixtures expired twice mid-pass** — two container restarts
  cost hours each, and the "live right now" open house had ended by capture
  time. Re-seeded and re-shot: check-in monitoring, the room display, the
  guest sign-in pair and End Event. A side effect stands recorded: the guest
  event slides to the seed moment, so captures taken late at night carry an
  open house timed in the small hours, and the five guest-flow images were
  shot across different slides of that window — each internally right,
  mutually a few hours apart.
- **The guest sign-in prospect had no pipeline card on a fresh database** —
  the open-house step ran before any pipeline existed, so Rosa Delgado
  landed stage-less and unopenable. The step now runs after the pipeline
  seeding, and the one stranded record was rebuilt through the same public
  sign-in path.
- **The cast-ballot shot picked the wrong open election**: list order put the
  restricted issue vote first, whose in-app ballot correctly reads "No
  candidates for this position" (the documented position-races-only
  limitation). The shot now demands an open election with positions.
- **08-60 retargeted**: the station-board rebuild replaced the dashboard
  Notifications panel (per-card ✕, Clear All) with the My Updates feed; the
  guide section is rewritten against it. One stored notification still spelt
  a raw enum ("ShiftPosition.FIREFIGHTER") — written before the formatting
  fix landed; the row was removed rather than pictured, since the shipped
  code no longer produces it.
- **Caption drift corrected against the build** (the 03-45 pattern): the
  validation queue's controls are accept/notify/void icons with a bulk
  Accept, not "Validate and Void" buttons; module management has two
  category headers, the email-template sidebar six; organization settings
  carries no department-type selector; the screening record form opens from
  a member's row and so has no member picker; the template builder's section
  count and the operators-tab roster size are no longer promised as numbers.

Cross-image drift noted and accepted: notification badges differ between
shots captured minutes apart, and the apparatus label print reads six labels
against a seven-unit fleet — the missing one is U-1, unexplained and worth a
look next pass. The stray "Oakville Fire Department" facility record the
bootstrap creates also fronts two facility shots; real demo data, but the
sparse record makes a poor face for the detail page.

## The 2026-08-16 guide-09 re-capture — 22 images, every one opened

Arithmetic checked rather than glanced at: the weighted scorecard's
`10 + 30 = 40 of 50 = 80%` against its own per-section rows, the
failed-at-100% result (a critical step fails the test regardless of the
percentage — the banner says so, and it is the point of the shot), and the
unscored-steps dialog's "1 step still has no Pass or Fail" against the
`—/20` slider behind it.

**`Avg Score 66%` looks wrong and is right.** The four scored tests average
78%, but the stat filters on `validated_at` — 66% is the mean of the two
_validated_ results (84 and 48). Verified against the query rather than
assumed; recorded here because the next reader will do the same double-take.

### Each capture run was littering the demo database

Scoring a test is not a read. `09-16` and `09-18` drive the real scoring
screen, so **every run filed another practice attempt** against the demo
member — eleven had accumulated, all "Practice · Passed 100%", sorting above
the official attempts. The member's results panel had become a wall of
identical rows, and `09-21`'s prepare had grown a `maxHeight: 320px` clamp to
cope, whose comment cited "fifty-odd identical passes from other seeding".

`seed_skills_tests` now prunes them to one (the badge needs an example),
through the route that refuses anything but practice records — an official
result may carry a certification, which is why the API voids those instead.
With the pile gone, the clamp only cut the validated PASS the caption is
about, so it is removed and the step waits for that row instead.

**Worth generalising:** a workaround for a data problem outlives the problem
silently. The clamp still "worked" — it produced a clean image of the wrong
rows.

### A duplicate image, and a screen the guide invented

`09-04-template-builder` and `09-05-template-detail` were **byte-identical**
(same md5), the fourth instance of this shape after `02-21`/`02-41` and
`04-20`/`17-01`. The cause is not a capture bug: `/templates/{id}` and
`/templates/{id}/edit` both render `SkillTemplateBuilderPage`, so **there is
no separate read-only template detail page** — the guide described UI the
product does not have.

Corrected the way the 08-13 pass corrected its five: the prose now says a
template's own page _is_ the builder whether draft or published, the
redundant shot and its file are removed, and `09-04` keeps the picture.

## The 2026-08-16 guide-04 re-capture — 31 images, every one opened

Numbers cross-checked against the API rather than read for plausibility:
the event detail's 20/16/4 against its own twenty-row roster (four "Not
Going" badges, counted), the check-in monitor's 9-of-22 at 40.91% with a
134-minute average that matches its check-in timestamps, the analytics
type distribution summing to its 29-event total, and the voter-eligibility
roster's 22/22.

### One product defect, two shots pointed at the wrong state

**Meeting cards read "0 attendees 0 action items"** over a meeting whose
detail view showed eight and two. `MeetingResponse` declares both counts
and the cards render them, but the list query loads no children — the same
shape of gap as `creator_name` one method above it, which had already been
fixed this way. Two grouped counts, attached like the names, with tests.

- **`04-04-event-qr-code` pictured "Check-in Not Available".** It matched
  on `isUpcoming`, and the page gates the code behind its check-in window,
  so an event days out shows a disabled badge under a caption about members
  scanning to check in. Now matched on the in-progress event — the screen
  an officer actually puts on the wall.
- **`04-42-cast-ballot` pictured "No candidates for this position".** It
  took the first _open_ election, which is the restricted-ballot seat with
  an empty ballot. The elections list carries no candidate count, so no
  list-level match could tell a contested race from an empty one — it now
  resolves through each open election's candidates endpoint and lands on
  the Captain race with its two candidates, which is what the caption
  describes.

### Seeder: the Minutes page had moved out from under it

The page was rebuilt onto `/meetings` — first-class meeting records with
attendees, motions and action items — while the seeder still populated only
the older `/minutes-records` model. So a real minutes record sat behind a
"No Meeting Minutes" empty state, and the Action Items page was empty too.
Now seeded: an approved business meeting with attendees, motions and two
open action items, plus a draft board meeting; and a pending public event
request for the Requests tab. Both guarded **per title**, so a run that
dies between the two creates adds the missing one next pass rather than
deciding the step is done because one row exists.

**A step written and then deleted.** A `seed_guest_prospect` step was added
for the guest-sign-in prospect card before noticing that `04-33`'s prepare
already creates Rosa Delgado by submitting the public form — and says so in
its own comment. The manifest is part of the fixture surface; check it for
an existing producer before adding a seeder step for a record a shot needs.

Empty-state flags with their reasons: `04-31` ("No reminders" is the
reminder-audience select's own option; both guest settings are ticked) and
`04-34` (a walk-in guest has uploaded no documents; the Linked Events panel
the shot is about is populated).

## The 2026-08-16 guide-02 re-capture — 66 applied images, every one opened

The full guide-02 set was re-shot against the merged build and read against
its captions. Five capture failures and one empty state all traced to data
or contract gaps, each fixed at the root:

- **Review Submissions was empty** — nothing seeded a member training
  submission. The seeder now files one as the demo member (org defaults
  route it to pending review), and the queue also printed the submitter's
  raw UUID where a reviewer expects a name — the service now resolves
  display names in one batch query (`submitter_name` on the response).
- **The demo member had no approved shift report**, so My Reports and the
  My Shift Progress card were blank. Two causes: the filing loop's
  states-present early return never checked her, and when she was picked it
  could be as the trailing save-as-draft pair — a draft is invisible in My
  Reports, the same trap as the positional flag. The loop now swaps her off
  the tail and `_ensure_demo_member_report` files-and-approves one when the
  early return would otherwise skip filing.
- **Nothing locked, so the "Locked until you finish" line had no subject.**
  Hour auto-credit had quietly completed the old Hose Deployment gate. The
  probationary pipeline now also gates on the written exam — a knowledge
  test only an explicitly recorded result can complete — and 02-99 resolves
  the probationary enrollment directly instead of trusting list order.
- **Officer-only checklist steps existed nowhere.** The blueprint gained
  three (`member_visible: false`) with a backfill for existing databases,
  and a product fix: the member serializer **stripped** hidden steps, so
  the "+N more steps your officer records" fold line was unreachable in
  the real app while its component test asserted it against a payload the
  API never produced. Hidden steps now survive as anonymous stubs — count
  preserved, text and id redacted — with endpoint tests pinning the
  contract. 02-88 (member fold line), 02-87/02-94 (officer view with
  Officer-only badges) picture it end to end.
- **Label drift**: 02-32/33/35/36 were shot before the ReportContentDisplay
  fix landed here and read "5/5 — Excellent"; re-shot reading the
  department's configured "Exemplary".
- **02-89 removed as redundant** (02-100 pictures the same steps editor);
  **02-68-vector-category-mapping's stray file removed** and the entry now
  carries `holdBack` — the mapping table it describes is only creatable by
  a live vendor sync, per the "Held back deliberately" note.

Observations recorded, not fixed: course-type requirements completed via
certification equivalency read "Completed · 0 / 1 courses" (02-93, 02-105);
the print pages' "Active Certifications 0" and "Enrolled: 0" stats disagree
with the tables beside them (02-62, 02-63); the compliance-matrix print
overflows its sheet at 26 columns (02-65). All are what the product renders
today; they read as stat-wiring gaps worth a product pass.

## The 2026-08-16 guide-03 re-capture — 67 of 67, every changed image opened

The full guide-03 set was re-shot against the fresh database and the current
build, and **every changed image was opened and read against its caption**
before being committed. The pass surfaced four product defects (all fixed in
the same session), a set of capture flows stranded by the scheduling
redesign, and one lost fix re-instated.

### Product defects the images exposed, fixed here

1. **Apparatus types resolved by lowercased display name, not code.** The
   shift serializer and `ApparatusRef.type_slug` returned "ladder/aerial"
   where templates and the per-apparatus skill/task config are keyed on the
   code "ladder" — so ladder shifts could not resolve type-level
   equipment-check templates, and the batch shift-report form silently fell
   back to the generic skill list on every type whose name is not one word.
   The batch-form shots (03-63/03-64) now show the ladder-specific skills
   with the department's score labels, which is the proof of the fix.
2. **The platoon roster printed raw rank codes** ("deputy_chief"). Same
   defect class as the 2026-08-10 Impact Planner fix; now formatted through
   `useRanks().formatRank` (03-16).
3. **The redesigned dashboard timeline printed raw UTC ISO timestamps** —
   the my-shifts payload carries full datetimes where other shift payloads
   carry "HH:MM", and `formatTimeOfDay` falls back to the raw string. It
   also read "undefined of 4 filled" (the payload has no attendee_count).
   Both fixed; 03-60/03-62 re-shot clean.
4. **`POST /training/instructors/qualifications` refused every valid
   create** (UUID bound as dashless hex against String(36) columns) — see
   the fresh-database section below.

### The scheduling redesign stranded ten capture flows

The re-capture's first run failed 10 of 67 shots, all for the same reason:
prepares written against retired DOM. The dashboard's "My Upcoming Shifts" /
"Open Shifts" panels are now one **Next 7 Days** timeline (a
`section.card`); the crew board's open-seat button reads **Assign someone**;
the panel header's edit button is labelled just **Edit**; the My Shifts bulk
bar reads "awaiting your confirmation"; and the batch-report form's Evaluate
control renders only for an enrolled trainee who has not been reported on.
All re-pointed, and the guide's Dashboard Shift Display section rewritten
against the timeline.

### Fixture repairs behind the failures

- **The trainee-carrying ladder shift is now reserved.** Report filing walks
  newest-first, which is exactly where the evaluable trainees sit — one
  re-seed consumed them and the batch-form shots failed on a crew of
  "Already reported". `seed_shift_reports` now reserves the newest such
  shift and skips it when filing.
- **Swap and time-off requests are seeded** (a pending one of each, by the
  demo member). The old database showed rows in the Requests tab only as
  leftovers of manual runs; a fresh one rendered two empty states under a
  caption describing populated tables (03-11 now pictures both).
- **The shift reminder for 03-97 was generated by the scheduler's own
  task**, run once with the org's lookahead temporarily widened to 30 hours
  and restored afterwards. On a live stack these accrue organically; a
  fresh database's backend has not been running long enough.
- **03-22 re-points at the seeded Medic 3 Supply Check again.** The
  2026-08-11 fix for exactly this shot was lost in a later reconciliation,
  and the manifest had regressed to the blank `/new` form under an
  `allowEmptyState` flag — the precise failure mode that pass documented.

### Caption corrections, checked against the build

- `03-60-report-used-sheet`: the sheet is now the **Flag** dialog (the minus
  button is what records use); prose already said so, the alt did not.
- `03-54`: counts dropped from the caption — the property is open rows with
  per-seat controls and the bulk Fill All Open action.
- `03-58`: the form is titled "Assign someone to this shift"; prose updated
  ("Assign Member" no longer exists).
- `03-13`: the image is the patterns page with type badges, not a "creation
  page with the pattern type selector".
- Empty-state flags suppressed with reasons on 03-52 (select placeholder),
  03-54/03-57/03-05 ("No calls logged" belongs to a future shift's Calls
  sub-panel), 03-59 ("No stock" is the unlinked traffic-cones row's label).

Known-and-accepted in frame: 03-14's "Total Members 66" member-requirement
aggregation (documented product behaviour, guide carries the note), and the
08-16 toast in 03-37's corner.

## The 2026-08-16 pass — a fresh database, and the last two placeholders

The container was reclaimed, taking MariaDB (and its data directory), the
backend virtualenv and node_modules with it. The demo database this session
runs against was therefore **rebuilt from `bootstrap_demo.py`** — which the
08-13 notes predicted would happen someday and warned would carry a cost. Two
consequences worth separating:

- **Nothing already committed is invalidated by the rebuild.** The 421
  verified images record what the product rendered against the old data;
  the rebuild changes incidental values (ids, dates, spreads) only for
  captures taken from here on.
- **The clean rows the 08-13 pass wanted arrived for free.** The regress
  residue ("4 of 6 stages completed" on a stage-four applicant) is gone by
  construction.

### Three seeder crashes only a fresh database could expose

Every one of these sat in the create path, which a long-lived database never
re-runs — the skip-by-name guard means that code executes exactly once per
database, and it had not run since the blueprints last changed.

1. **The prospect create-loop advanced without the interview fallback.** The
   spread's advance knows to record an interview when a stage demands one; the
   create-path loop above it did not, so the first applicant that had to clear
   Interview aborted the whole step — Morgan Tran and Riley Bishop were never
   created at all. Both paths now share `_advance_recording_interview`.
2. **The equipment-check seed posted the engine template to the first three
   shifts regardless of apparatus.** The old database happened to return
   engines first; the fresh one ordered a medic shift into the front and the
   API correctly refused it ("Template is not applicable to this shift"),
   killing the step. The loop now filters to engine shifts with the
   `apparatus_type_of` helper that was already defined a page above it.
3. **`POST /training/instructors/qualifications` has refused every valid
   create since 2026-08-11 — a product bug, not a seeder one.** The
   tenant-scoping commit compares `users.id` (String(36)) against the
   `uuid.UUID` the endpoint's `model_dump()` produces, and aiomysql binds a
   UUID object in a representation that matches no stored row — so the guard
   answered "Invalid user_id" for references that were perfectly in-org. The
   unit test mocked the session and asserted compiled SQL, which is exactly
   the layer that cannot see a bind-value mismatch. Fixed by stringifying
   UUIDs at the service boundary; a new test pins the bound value itself.

### 01-37-elected-package-badge — the elected badge, produced by the vote

`01-membership.md:1156` wanted status Elected, a 35-3 tally and the linked
prospect on one screen, which the 08-13 analysis had already split: no screen
joins them. The caption now promises the drawer badge and cross-references
guide 14 for tallies.

`elected` is written in exactly one place — `_sync_package_statuses` when an
election closes — so the seeder now walks the product's own lifecycle
(`seed_membership_vote_outcome`): package marked `ready`, assigned to the
draft August election through the assign endpoint, election opened, the floor
vote recorded as a paper batch, attested by two officers, election closed.
Three things that pass mattered:

- **The hand-built ballot item was replaced, not reused.** It carried no
  `prospect_package_id`, so closing an election around it would have synced
  nothing — the assign endpoint is what writes the link.
- **The assign default of regular/life eligibility matches nobody** in a
  roster of active/administrative members, and an item with zero eligible
  voters rejects any tally as implausible. The package's
  `recommended_ballot_item` opens it to all types.
- **The tally is 18-2, not the guide's 35-3** — the plausibility check caps a
  batch at the eligible-voter count, and inventing 38 voters for a 22-member
  department would need the audited override for no documentary gain. The
  worked example keeps its numbers as prose.

Verified: drawer open on the applicant at Membership Vote, ELECTION PACKAGE
section reading **elected** with the "can now be converted" line, against an
API state of package `elected` / election `closed`.

Consequences recorded: the August election is now permanently closed in the
demo. `14-23-membership-ballot-item` still captures — Preview Ballot renders
for any manageable election with ballot items, status regardless — and its
committed image predates the close anyway. `GET /elections/{id}/results` on
this election answers 403 ("Results not available yet") because it was
seeded `results_visible_immediately: false`; the certified-results screens
picture the July election, which is `true`, so nothing loses its picture.

### 01-38-program-phase-progress — the phase view, on the page that shows all of it

`01-membership.md:1282`'s fractions (4/4, 0/6, 1/3, 0/2, 25%) were the worked
example's numbers, not any screen's. The 08-13 analysis established the
program detail carries no requirements inside its phases; the per-phase
grouping lives on the **enrollment progress** view. Confirmed on the fresh
database — where the blueprint's requirements actually seeded this time —
and shot as the member-facing **My Program Progress** page rather than the
admin Progress modal: the modal shows the same grouping but is height-capped
and scrolls, so a capture of it holds one phase group, and the caption is
about seeing all of them. (The fresh seed is also why this became capturable
at all: the old database's programs pre-dated requirements in the phase
payload, and the skip-by-name guard kept them that way.)

Verified: Probationary Firefighter Pipeline for the demo member — 4/13
requirements · 31% (matches the enrollment API), three phase groups with
per-requirement status, "You are here" on Phase 1, and a completed
requirement sitting inside not-yet-started Phase 2, which is the guide's
prior-credit story rendered. Caption rewritten against the screen; both
surfaces (member page, Enrollments-tab modal) named in prose.

**With these two, every placeholder in every guide is filled — 423 captured,
0 remaining.**

### Manifest housekeeping

`03-60-report-used-sheet` existed twice in the manifest, byte-identical — a
merge artifact. Ids double as output filenames, so duplicates capture twice
and the later silently overwrites the earlier; identical copies are the lucky
case. One removed, and the manifest now **throws at import on any duplicate
id**, beside the existing mutates-last invariant.

### Two sessions re-captured guide 03 at once — how the sets were reconciled

The 08-11 "two sessions shot the same screens" incident repeated at full
scale: this session and a parallel one each re-captured the whole guide
against their own rebuilt databases, fixed overlapping defect sets, and
pushed within the hour. The committed images are the **parallel session's
set** (the "67 of 67" record above), chosen on evidence rather than
recency: its captures postdate two frontend fixes this session's did not
carry — the platoon-rank formatting (this session's `03-16` showed raw
`deputy_chief` enums) and the same dashboard-timeline repairs both sessions
wrote independently.

What survived from this session's pass, verified over its own captures and
kept in the merge:

- **The `ReportContentDisplay` label fix** — the expanded report card and
  review modal hardcoded the sample skill-score scale while scoring uses the
  department's configured one, so a skill scored "Exemplary" displayed
  "5/5 — Excellent". Both sessions' `03-49` and `03-62-flagged-queue`
  captures predate the fix on the card path; the two were re-shot after the
  merge so the pictured labels match the shipped code.
- **The seeder's `seed_membership_vote_outcome`, batch-trainee, reminder and
  review-queue-depth fixtures** merged with the parallel session's versions
  of the same repairs — where both wrote one (`seed_scheduling_requests`),
  the merge kept the version whose swap request deliberately targets the
  member's furthest-out shift, so the swap-dialog shot's card keeps its
  plain Swap button, plus this session's near-term seat for the timeline's
  "Yours" pill.
- **`--only` accepts a comma-separated prefix list**, because re-running
  exactly the failed shots previously meant one invocation per shot.
- The apparatus-type mismatch both sessions found was fixed at **opposite
  ends**: this session re-keyed the seeder vocabulary to the lowercased
  display name, the parallel one made `ApparatusRef.type_slug` prefer the
  **code** — the right end, since UI-configured departments already key on
  codes. The seeder keys are back on codes and the backend fix stands.

The independent verification passes agreed with the parallel session's
verdicts everywhere they overlapped, including the reservations: `03-14`'s
member-requirement-pairs arithmetic, the `03-15`/`03-32` shared frame, and
notification-badge drift between shots captured minutes apart.

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

### The program detail has requirement totals, but not the caption's member progress

`01-membership.md:1282` wants Phase 1 (Complete, 4/4), Phase 2 (In Progress,
0/6) and so on. A program's detail response — `GET
/training/programs/programs/{id}` — returns phases (`name`, `phase_number`,
`prerequisite_phase_ids`, `requires_manual_advancement`, `time_limit_days`)
**and top-level `requirements`, `total_requirements` and `total_required`**.
Those are structural totals for the program as designed, though — the
caption's Complete/In-Progress fractions are a member's progress, which
belongs to an enrolment view. Note that `02-90-phase-prerequisites` is a
structural shot too (the phase editor's prerequisite picker, no member
progress in frame), so it is not the cross-reference for the enrolment
fractions; that screenshot still needs to come from a member's enrolment
screen.

That makes this the same split as `09-18` and `01-membership.md:1156`: the
program detail can show the phase structure, its gating, and the designed
requirement counts; the per-phase member progress belongs to a
cross-reference. Confirm against the enrolment view before rewriting the
caption — this was established from the API shape alone, and the screen has
not been opened yet.

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
