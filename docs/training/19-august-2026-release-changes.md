# August 12–16, 2026 workflow updates

This lesson is the operator-facing companion to the
[six-day change audit](../CHANGE_AUDIT_2026-08-10_TO_16.md), its
[three-day detail](../CHANGE_AUDIT_2026-08-12_TO_14.md), and the
[August 15–16 detail](../CHANGE_AUDIT_2026-08-15_TO_16.md). It explains what
members and administrators now do differently. Permission names are included
because a control that is absent is usually a permission or module-state issue,
not a rendering failure.

> **August 15–16 added two changes with no new screen**, so they are easy to
> miss in a walkthrough and are covered at the end of this lesson: the
> installation wizard no longer survives leaving the tab, and the dark-mode
> background now covers the scrollbar gutter. Neither needs a migration, a
> permission grant, or any configuration.

## Elections: reuse a ballot without reusing election data

An election manager can open Ballot Builder, choose **Your saved ballots**, save
the current ballot structure under an organization-unique name, or apply/delete
a saved template. The template includes ballot configuration and election
settings, but never candidates, voters, tokens, votes, attendance, or results.
Applying one creates fresh ballot-item IDs.

**Edge cases:** names compare case-insensitively; replacing and deleting require
confirmation; invalid/duplicate item IDs and voting methods are rejected;
`all` cannot be mixed with another voter type; supermajority needs a percentage;
count quorum can exceed 100 but percentage quorum cannot. Manual paper ballots
must be entered as an attested count and cannot exceed the eligible roster.

> **[SCREENSHOT NEEDED — Ballot Builder → Your saved ballots, showing the visible template name, item count, replacement warning, and action buttons; seed one organization-owned template and no candidate/vote data. Follow with a before/apply/after election-settings capture because preserved settings are applied silently and are not summarized in the picker.]**
>
> **[SCREENSHOT NEEDED — closed election results showing manual paper-ballot count and its roster-bound validation.]**

## Dashboard and admin hours

The dashboard is now a station board. Department Messages shows pending items
and persistent notices rather than an arbitrary recent-history slice. Admin
hours separates calendar-year reporting from rolling periods and displays each
configured category against its own requirement.

**Edge cases:** conditional cards appear only when their module/data applies;
reading a message does not remove it mid-read, but it clears on the next load;
persistent notices remain; calendar year is not “last 365 days.” Mobile cards
and breadcrumb/action targets must remain at least 44px.

> **[SCREENSHOT NEEDED — populated station board with one pending message, one persistent notice, and conditional cards identified in the caption.]**
>
> **[SCREENSHOT NEEDED — Admin Hours Summary on Calendar Year with at least two configured categories and visibly different thresholds.]**

## Storefront

Store administrators now see activity/status counts and can filter the order
list by the corresponding states. Organization settings can hide the store-open
banner. A member can change the external payment method on their own order; the
application records the method/status but does not process the payment.

**Edge cases:** members cannot edit another member's order; payment and
fulfillment remain separate; variant/product locks are canonicalized; notice and
email results do not reveal other recipients; counts and filters are scoped to
the active organization.

> **[SCREENSHOT NEEDED — Store Admin with activity/status cards and a matching filtered order list; seed orders in at least three states.]**
>
> **[SCREENSHOT NEEDED — member order payment-method editor plus the explanatory text that reporting payment is not payment processing.]**

## Room and apparatus QR codes

Authorized administrators can use the Check-In QR Codes directory to search,
download PNG codes, and print room signs. Facility-room codes and apparatus
shift check-in codes are available from their inline entry points. Regenerating
a location display code immediately invalidates the old code.

**Edge cases:** the bulk directory is restricted; a QR target is organization
bound; a stale printed sign stops working after rotation; sensitive facility
fields require `facilities.view_sensitive`, while editing still requires
`facilities.edit` or `facilities.manage`.

> **[SCREENSHOT NEEDED — Check-In QR Codes directory search results with Download PNG and Print controls, using non-sensitive demo rooms.]**
>
> **[SCREENSHOT NEEDED — regenerate-code confirmation explicitly warning that the previously printed code becomes invalid.]**

## Apparatus crew seats and scheduling settings

Crew positions now select configured ranks instead of relying on free text.
Shift settings persist per organization and calendar navigation retains its
context. Members retain the completion/report flows they are authorized to use
when equipment-check template administration is restricted.

**Edge cases:** legacy position names remain readable; an incompatible rank
cannot be saved; switching organizations must not reuse the prior organization's
rank or settings cache; finalization resolves apparatus labels in batches.

> **[SCREENSHOT NEEDED — apparatus form crew-position rank picker, including one legacy read-only position in the demo data.]**

## Events, reminders, check-in, and outreach forms

Event and template Notifications now store a reminder audience: `going` for
members who RSVP Going, `all` for every active member in the organization, or
`none` to disable reminders. Optional events default to `going`; mandatory
events default to `all` until explicitly edited. Flexible check-in now defaults
to 60 minutes before start, with the full workflow, delivery caveats, early
member/guest distinction, and screenshot requirements in
[Events & Meetings](./04-events-meetings.md#reminder-audience-and-one-hour-check-in-default-august-14-2026).

The Event Settings outreach picker discovers only related public-outreach forms
and only for event administrators. Mandatory-event eligibility uses the
organization's configured membership tiers. Early-ended events can be finalized;
reports count reviewed attendance.

**Edge cases:** ordinary form viewers do not receive the administrative catalog;
forms and events from another organization never appear; deleted interviewers
remain as historical names rather than breaking an applicant record.

> **[SCREENSHOT NEEDED — Event Settings outreach-form picker under an event-admin account, with a non-outreach form intentionally absent.]**

## Training sessions, programs, and skills tests

A training-session editor can link the session to a requirement, course, and
program. Approved participation then feeds the owned program requirement.
Program pages have an Admin breadcrumb for managers. A failed skill step may
deduct configured points without forcing the entire test to fail; resume count,
result visibility, and official-test policy remain server enforced.

**Edge cases:** cross-organization and mismatched-program links fail; deleting a
program does not delete a requirement it does not own; undated training cannot
satisfy recency; members cannot read officer-only checklist/sign-off state; a
resume conflict is scoped to the current test and is not blindly retried.

> **[SCREENSHOT NEEDED — training-session edit flow with requirement, course, and program linkage populated from one organization.]**
>
> **[SCREENSHOT NEEDED — skill result illustrating point deduction without automatic whole-test failure; caption the configured pass rule.]**

## Notifications and integrations

Completing related event or scheduling actions archives the matching
notification in the database. It does not archive unrelated notifications.
Salesforce readiness/preview/sync now retains pagination and retries transient
failures while keeping the encrypted client secret out of responses and logs.
Webhook diagnostics redact credentials and unsafe payload fields.

**Edge cases:** relation matching includes organization and action/entity IDs;
Salesforce rejects missing/unsafe configuration; retry is for transient errors,
not invalid credentials; every targeted department message still receives
best-effort email, and Urgent adds SMS only when its consent/configuration gates
pass.

> **[SCREENSHOT NEEDED — same notification before and after completing its related action, with an unrelated notification still present.]**
>
> **[SCREENSHOT NEEDED — Salesforce readiness/preview result with secrets and tokens visibly absent.]**

## Installing: the wizard is now one tab, one sitting _(August 15)_

**Who this affects:** whoever runs the one-time installation wizard at
`/onboarding`. Nobody else — existing departments see no change.

The wizard holds a short-lived credential that authorizes the requests creating
the organization, its stations and apparatus, the IT team, and the first System
Owner account. That credential used to outlive browser restarts and was readable
from every tab on the site. It now lives only in the tab that started the run,
because on a shared or station-kiosk machine a credential that can finish
creating a department should not still be sitting there the next morning.

**No permission, module setting, endpoint or migration is involved.** What
changes is how you schedule the install:

| Situation                                  | Result                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Finish in one tab without closing it       | Normal path                                                                           |
| Open `/onboarding` in a second tab mid-run | That tab starts its own session; the original step refuses to save                    |
| Close the browser partway through          | The run is over — restart the wizard                                                  |
| Idle more than 30 minutes                  | The server session expires. It always did; the timer resets on each action            |
| "Onboarding has already been completed"    | A **different** condition: a department already exists. Sign in, do not restart setup |

**Teach this part explicitly, because the screen misleads.** The answers you
typed are stored separately and are _not_ cleared. Reopen the wizard after a
restart and **the form comes back filled in while the session behind it is
gone** — nothing says so until the next step fails. The filled-in form is a
local draft, not a resumed session; the recovery is to start the wizard over,
not to re-type into it.

Practical guidance for an installer: gather the department address, station
list, apparatus list and first administrator's details before starting, allow an
uninterrupted half hour, and stay in one tab until the dashboard appears.

> **[SCREENSHOT NEEDED — sequence of two: (1) the wizard reopened after a browser restart, showing the previously typed answers repainted; (2) the session-expired error raised when continuing to the next step. Demo data: start an onboarding run through the stations step, close the browser, reopen `/onboarding`. Both frames are required — a single frame of either one teaches the wrong lesson.]**

## Dark mode: the strip at the right edge is gone _(August 15)_

**Who this affects:** everyone using dark mode, on every page — including the
public pages members' families and applicants see (public forms, ballot voting,
application status).

The themed background gradient now covers the browser's scrollbar gutter. It
previously stopped short of it, so in dark mode a bright strip ran down the
right edge of every page. There is nothing to configure and no behavior change;
it is purely what the screen looks like.

**Why it appears in a workflow lesson at all:** it invalidates images. Any
dark-mode screenshot, printed handout or recorded video captured before August
15 that shows a full browser window may still show the old strip. When you reuse
department training material, check the right edge of the image before handing it
out.

> **[SCREENSHOT NEEDED — a public page (`/f/{slug}` or an application-status link) in dark mode at full window width with the page long enough to scroll, so the gutter is visible and painted. This is the standing proof that pages outside the app shell are covered.]**

**Two problems this caused, both already fixed** _(2026-08-16)_. Recorded here
only so nobody re-reports them from an older build:

1. Printing with the browser's **"Background graphics"** option switched on could
   put the themed background behind a scorecard, skill sheet, label or QR sign —
   in light mode. Fixed.
2. The six print-preview screens (skill sheet, scorecard, member training record,
   program, compliance, shift report) briefly showed the themed background
   framing the grey backdrop behind the sheet. Cosmetic, and what came out of the
   printer was never affected. Fixed.

If you see either on your installation, you are on a build from between
August 15 and 16; update.

## Upgrade notes for administrators

The notes below apply to the August 12–14 changes; the August 15–16 window
has [its own upgrade notes](#upgrade-notes-for-administrators-august-1516)
further down — it **does** carry a migration (`20260816_0001`, nested
facility rooms; plus the 08-16 inventory-vendor and storage-area-barcode
backfills) and a deployment floor (Docker Compose v2.24.4+).

Back up the database and encryption keys separately, require a single result
from `alembic heads`, and run `alembic upgrade head`. Production transport TLS
is fail-closed unless the operator explicitly acknowledges a plaintext
configuration. The active-prospect reconciliation may consolidate duplicate
active emails within an organization; review migration logs before and after.
Before upgrading, run the active-prospect duplicate query in the
[technical audit](../CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).
A non-empty result is a hard stop: review linked applications, keep the earliest
record, mark the remaining duplicate active rows inactive, and re-run the query.
The unique index otherwise fails before the later reconciliation can run. Never
downgrade merely to repair a migration fork.

## Facilities: rooms can now live inside other rooms (August 15–16)

The Rooms section of a facility renders a containment tree. Use the
add-a-room-inside action on a row, or the room form's **Located inside**
picker, to place a room inside another room in the same facility. Sub-rooms
show indented with per-container counts, and the cross-module room picker
(Events, Training, Scheduling) indents them too and prints the containment
path for the selected room. A nested room's linked Location is renamed with
the full path.

**Edge cases:** container must be the same facility and organization; a room
cannot enter its own subtree; five levels maximum; deleting a container
re-parents its sub-rooms up one level (never deletes them) and the
confirmation says so; moving a room across facilities carries its subtree and
re-syncs Locations; clearing floor/capacity/description now persists on save.

The full walkthrough with screenshot markers lives in
[Apparatus & Facilities → Nesting rooms inside rooms](./06-apparatus-facilities.md#nesting-rooms-inside-rooms-2026-08-16).

> **[SCREENSHOT NEEDED — nested Rooms tree with counts and add-a-room-inside action (shared with lesson 06; capture once, reuse).]**

## Privacy and access tightening (August 15–16)

Four behavior changes members and officers will notice:

- **Colleague profiles show less to `members.view`.** Opening a directory
  profile without `users.view` no longer reveals the colleague's MFA state,
  email-verification state, last login, account timestamps, notification
  preferences, or the permission lists behind their roles — role names remain.
  Members-managers and the member themselves still see everything.
- **Hire date joined the restricted profile fields.** Like rank, station,
  platoon, and membership number, changing `hire_date` now requires
  leadership, the secretary, or the membership coordinator — it drives
  automatic membership-tier advancement.
- **Pending election nominations are phase-scoped.** The member-facing
  candidate list shows pending nominations only while nominations are open
  (so nominees can respond). After that, members see accepted candidates
  only; `elections.manage` always sees the full list.
- **Logout on a shared computer clears equipment-check drafts** along with
  shift-report drafts and offline queues. The next person at a station
  computer cannot recover the previous member's in-progress apparatus checks.

**Edge cases:** the profile redaction returns nulls, not errors — an
integration reading those fields must tolerate their absence; the candidate
list change is per-request permission logic, not stored state, so no data
migration is involved; the draft purge also removes orphaned draft keys that
lost their index entry.

> **[SCREENSHOT NEEDED — the same colleague profile side by side as seen with `members.view` only (metadata absent) and with `users.view`; use a demo member with MFA enabled so the redaction is visible.]**
>
> **[SCREENSHOT NEEDED — profile edit attempting a hire-date change without the coordinator grant, showing the 403 explanation toast.]**
>
> **[SCREENSHOT NEEDED — member candidate list on an election in nominations phase (pending visible) and the same election after close (accepted only); label which account is which.]**

## Reliability changes members may notice (August 15–16)

- **External finance approvers:** the emailed approve/deny link works exactly
  once. A second click (or a concurrent duplicate) reports the step as
  already actioned rather than approving twice.
- **Public forms:** submissions that fail validation — and bot submissions —
  no longer count against a form's daily cap, so a flood of junk cannot lock
  legitimate submitters out for the day. The cap still answers with a clear
  "not accepting further submissions today" message when genuinely reached.
- The dark-mode and installation-wizard changes in this window have their own
  sections above ("Dark mode: the strip at the right edge is gone" and
  "Installing: the wizard is now one tab, one sitting").

## Upgrade notes for administrators (August 15–16)

Three migrations, linear: `20260816_0001` adds `facility_rooms.parent_room_id`
(nullable, self-referential, `ON DELETE SET NULL`) — no backfill, existing
rooms stay top-level; `20260816_0002` backfills storage-area barcodes; and
`20260816_0003` creates inventory vendors and backfills one per distinct
free-text supplier name. Back up, require a single `alembic heads` result
(`20260816_0003`), run `alembic upgrade head`. Deploying `docker-compose.prod.yml` now requires
Docker Compose v2.24.4+ (`volumes: !override` clears development bind
mounts; upgrade Compose rather than removing the tag). Unraid operators
copying `unraid/.env.example` will find an HTTPS `ALLOWED_ORIGINS` example —
substitute your reverse-proxy hostname. Details in the
[technical audit](../CHANGE_AUDIT_2026-08-15_TO_16.md).

---

# August 16–17, 2026 workflow updates

Companion to the [August 16–17 change audit](../CHANGE_AUDIT_2026-08-16_TO_17.md).
This section covers a 24-hour window that added three anti-brute-force
controls, tightened one permission in a way that **removes access somebody
already had**, and fixed a set of defects members will notice on the
dashboard, the Minutes page and the shift board.

> **Read this first if you administer the system:** the Platoon Management
> page now requires `scheduling.manage`. Everything else in this window either
> adds capability or fixes something that was wrong; this is the one change
> that takes something away.

## Signing in: three new defences, two of them optional

Nothing here changes how a member signs in on a good day. All three matter on
a bad one.

**Suspicious-IP throttling is on by default.** The system already slowed down
rapid attempts from one address and locked an account after five failures.
Neither stops a *spray* — an attacker trying two common passwords against a
thousand of your members' usernames never trips either, because no single
account is tried more than twice and the overall pace stays slow. The new
control counts failed attempts from one address **across every account** and
blocks that address for 15 minutes once it passes 50 failures in an hour.

**Edge cases worth knowing before somebody calls you about it:**

- **A whole station can share one public address.** Ordinary typos accumulate
  against it. A *fully successful* sign-in from that address clears its tally,
  so normal use keeps it clear — but a correct password alone does not clear
  it. If your members sign in with MFA, the tally clears when they finish the
  challenge, not when they type the password.
- **Clearing the tally does not lift a block already in force.** A member who
  signs in successfully during someone else's block still waits it out.
- **A large department behind one address should check the threshold.** Fifty
  failures per hour is generous for most, but "most" is not "all."
- The block is keyed on the address only. No member is named in it.

**Breached-password rejection is optional and off.** When enabled, setting a
password checks it against public breach corpora. A password like
`Firetruck2024!` passes every complexity rule the system enforces and is in
those corpora, which is exactly what an attacker tries first.

- **What leaves your building:** five characters of a scrambled version of the
  password. Not the password, not the whole scramble, and nothing identifying
  the member.
- **It needs outbound internet.** If your deployment cannot make outbound
  requests, leave it off — turning it on in that situation does not error, it
  simply accepts every password (and logs that it could not check).
- **If the service is slow or down, the password is accepted.** That is
  deliberate: a third-party outage must not stop your department from setting
  passwords during an incident. Every other rule still applies.
- **The refusal will not tell the member how many times the password leaked.**
  That number would help an attacker and helps the member not at all — they
  need a different password either way.

**Human challenge (CAPTCHA) is optional and off.** It covers the two forms
anyone on the internet can reach: **public form submission** and **forgot
password**.

- **It fails closed.** If the challenge provider is unreachable, those two
  forms refuse submissions until it recovers. That is the opposite of the
  password check above, on purpose — nothing else stands behind these forms.
- **Turning it on without a secret key enforces nothing** and logs an error.
  So "I ticked the box" is not the same as "it is running." Check that
  challenges actually appear before assuming you are covered.
- **If the challenge never appears after you enable it**, that is almost
  always the browser blocking the widget, not a broken key. Confirm the
  provider is one of the three supported ones and that you restarted the
  backend after the change.
- **Guest check-in deliberately has no challenge.** It is reached by scanning a
  QR code on a station display; asking someone standing in the firehouse to
  identify traffic lights is hostile and buys nothing.

> **[SCREENSHOT NEEDED — the forgot-password page with a rendered challenge
> widget above the Submit button, in a deployment with `CAPTCHA_ENABLED=true`
> and a valid site key. Caption which provider is pictured, because the widget
> looks different for each of the three.]**
>
> **[SCREENSHOT NEEDED — the public form submission page with the same widget,
> after a rejected submission, showing the widget reset. Tokens are
> single-use, so this is the state a member actually hits when a submission
> fails validation and they try again.]**
>
> **[SCREENSHOT NEEDED — the change-password screen showing the
> breached-password refusal. Requires `BREACHED_PASSWORD_CHECK_ENABLED=true`
> and a known-leaked test password. Caption that the message deliberately does
> not state a breach count.]**

## Scheduling: who can see the roster

Two changes, both about the same thing — the platoon roster is staffing
information, not a member directory, because **it is derived from who is on
approved leave**.

**Platoon Management (`/scheduling/platoons`) now requires
`scheduling.manage`.** It previously required `scheduling.view`, which every
signed-in member holds implicitly — so the department-wide list of who is on
which platoon was readable by anyone with an account.

**A shift's hold-over/availability roster is now restricted** to schedulers
(`scheduling.assign` or `scheduling.manage`) and to **the officer named on
that shift**. Everyone else opens the shift and sees everything except the
roster.

**Edge cases:**

- A shift officer sees the roster **for their own shift only** — the authority
  comes from being named on that shift, not from a permission.
- Members are not shown an empty box with an error. The rest of the shift —
  time, apparatus, who is assigned, check-in state — is unchanged.
- **Anyone who used Platoon Management before and does not hold
  `scheduling.manage` will now get a permission error.** This is the one thing
  in this release that will generate a support call. Grant `scheduling.manage`
  to the roles that need the department roster.

> **[SCREENSHOT NEEDED — the shift detail page as a scheduler, roster
> populated, beside the same shift viewed by an ordinary member with the
> roster absent. Two captures, captioned as the pair. Use a demo department
> with at least one member on approved leave so the difference is visible.]**
>
> **[SCREENSHOT NEEDED — the permission error a member without
> `scheduling.manage` now receives at `/scheduling/platoons`.]**

Two scheduling defects were also fixed:

- **Deleted members were being staffed onto generated shifts.** A member who
  had been removed or anonymized could still be placed on shifts generated
  from a platoon rotation.
- **The Patterns tab could crash outright** on a pattern whose stored
  configuration held a malformed platoon list. It now renders that list as
  empty rather than taking the tab down.

## Driving: the EVOC block now holds everywhere

The driver requirement introduced on August 16 had five ways around it. All
five are closed, and the differences are worth stating because they change who
can be seated:

- **A certification is judged against the shift's date, not today.** A card
  that expires next week does not qualify anyone to drive a shift the week
  after. This means a driver who is legal today can be refused for a future
  shift — that is correct, not a bug.
- **Recurring pattern generation no longer bypasses the block.** It used to
  write assignments directly, so a pattern would seat an uncertified driver on
  every occurrence it generated. It now leaves that seat **empty** and reports
  the skip, rather than failing the whole generation run.
- **Changing a shift's apparatus or date rechecks the drivers already on it.**
  Previously you could seat a driver on a shift with no apparatus and then set
  the apparatus.
- **Two chiefs reviewing the same exception request at once** no longer both
  succeed with the later one quietly winning.
- **All of a member's certifications count, not just the highest.** A member
  holding a cumulative Level 3 plus a non-cumulative Level 4 used to be
  refused for a Level 2 apparatus.
- **Retiring an apparatus removes the exception written for it.** Previously
  the exception survived with its apparatus reference emptied, which is
  indistinguishable from a blanket fleet-wide grant — so retiring a truck
  silently widened a driver's authorization. The approval remains in the audit
  log.

> **[SCREENSHOT NEEDED — the driver-seat refusal at assignment time, showing
> the reason and the "request an exception" affordance in the same place the
> block happens.]**
>
> **[SCREENSHOT NEEDED — the chief's exception review screen with a pending
> request, showing the justification, restrictions and validity window
> fields.]**
>
> **[SCREENSHOT NEEDED — a generated pattern result reporting a skipped driver
> seat. This is the state that proves generation no longer silently seats an
> uncertified driver.]**

## Applicants: one form submission advances one applicant

If a pipeline stage is a **form submission** stage with auto-advance turned on,
submitting that form used to advance **every** applicant sitting on that stage
— not just the person who submitted it. A single returned form could push a
whole cohort forward.

Only the applicant who submitted advances now, and the history entry records
which submission caused it.

**Also on the pipeline:** signing off a stage now requires a role **the stage
actually asked for**. Previously any member could record their own position as
an approval on any applicant's workflow, with notes of their choosing, and
receive the applicant's full record back in the response. A stage configured
with *no* approver roles is now refused rather than completing and advancing
the applicant outright.

**Edge case:** if you have a stage in production with no approver roles
configured, it will now refuse sign-off instead of passing everyone through.
That stage was never doing what its name implied — configure its approvers.

> **[SCREENSHOT NEEDED — a form-submission pipeline stage's configuration
> showing the auto-advance checkbox, with a caption noting the advance is now
> bound to the submitting applicant. Reuse the existing stage-config capture
> only if it already shows the checkbox.]**

## Fixes members will see immediately

- **Meeting cards showed "0 attendees · 0 action items"** on the Minutes page
  over meetings whose detail view listed eight attendees and two action items.
  The cards now show real counts.
- **A renewed certification no longer grounds you.** The dashboard readiness
  line read your whole training history, so a member who renewed EMT-B had
  both the lapsed old record and the valid new one — and it counted the lapsed
  one. Permanently. For having renewed. Only your newest credential per course
  counts now.
- **Screenings and certifications are judged on the same 60-day window.**
  Screenings were being read against a 30-day window, so a screening lapsing
  in 45 days read as fine beside a certification at the same distance that
  read as a condition. A screening lapsing **today** now counts too.
- **If the screening data fails to load, the readiness line says so** instead
  of leaving yesterday's "Clear to respond" on screen while claiming
  screenings were checked.
- **A readiness verdict driven only by a screening now links to the department
  feed**, not the training page, which has nothing to say about a screening.
- **Editing "On hand" on a lot-tracked medical supply did nothing** — the box
  wrote a number the page does not display, the count coming from the lots. It
  now shows the lot figure and points you to **Receive delivery**.
- **Impact Planner PDF exports** no longer corrupt or fail when a member's name
  or your department name contains a `<` or `&`.
- **CSV gear import** reports supplier names it could not match more honestly:
  spelling variants of one name are listed once rather than three times, names
  are only listed once their row actually imported, and a name matching a
  **deactivated** supplier now links to it instead of sending you to a form
  that would reject it.
- **Force refresh (Settings → App) refuses to run when the server is
  unreachable** and says so. Running it offline used to delete the app's only
  offline copy and reload into nothing — bricking an installed app until
  signal returned. The member most likely to tap it is the one whose app looks
  wrong, who is often the one out of signal.

> **[SCREENSHOT NEEDED — the Minutes page card grid with populated attendee
> and action-item counts. The existing capture predates the fix and shows
> zeros; replace it rather than adding a second one.]**
>
> **[SCREENSHOT NEEDED — Settings → App → Force refresh showing the
> "server unreachable, nothing was changed" refusal with the button
> re-enabled. Capture with the backend stopped, not with the device offline —
> `navigator.onLine` is not what the check uses.]**
>
> **[SCREENSHOT NEEDED — the dashboard readiness line reading "Clear, with
> conditions" for a member holding one renewed certification and one screening
> inside the 60-day window. Caption that the renewed certification is not what
> produced the condition — that is the exact confusion the fix addressed.]**

## Behind the scenes (no screen changes)

- **Exception tracebacks no longer include local variable values.** On a
  password-set or token-verification frame those values are the credential
  itself, written into a log file kept for 30 days.
- **Onboarding runs in two browser tabs can no longer overwrite each other's
  security token.** Clients still holding the old cookie are migrated
  automatically.
- **Low-stock and expiring-supply alerts no longer mix domains.** An EMS supply
  officer's alert email used to contain the full gear table — item names,
  categories and counts the system refuses them on screen. Recipients are now
  grouped by what they may see, and someone holding both grants gets **one**
  complete email rather than two partial ones. The text-message version
  carries only a count and says so.
- **Copying a finalized event no longer produces a copy that looks finalized**
  and skips its own attendance-validation prompt.
- **Reopening a finalized shift restores its re-finalization reminder**, which
  had been suppressed permanently.
- **Event-request date fields** no longer display the previous day for
  departments west of UTC.

## Upgrade notes for administrators (August 16–17)

**Run `alembic upgrade head`.** Two schema changes landed —
`20260816_0008` (`driver_exceptions`: chief-approved exceptions to the EVOC
driver requirement) and `20260816_0009` (columns supporting reversible training
completions).

**If you pulled `main` between roughly 17:30 and 18:50 UTC on 2026-08-17, pull
again before migrating.** Two branches both extended the chain at the same
point, five pull requests each wrote a repair for it, and all five merged
within the hour — leaving four heads and two files claiming the same revision
id, which makes the migrations directory refuse to load. The repair is on
`main` now and the chain has a single head again. **No database recovery is
needed**: the broken state prevented migration rather than corrupting anything.

**Permission to regrant:** `scheduling.manage`, for whoever needs Platoon
Management.

**Optional controls to consider:** `CAPTCHA_ENABLED` (fails closed — a provider
outage refuses public form and password-reset submissions) and
`BREACHED_PASSWORD_CHECK_ENABLED` (needs outbound HTTPS; fails open). Both are
described in the
[security configuration reference](../../wiki/Configuration-Security.md).

**If you front the application with a reverse proxy on a different origin and
enable CAPTCHA**, make sure the `X-Captcha-Token` header survives it. It is in
the application's own allowlist; a proxy keeping its own list needs the same
entry, or every challenged submission fails verification with no useful error.

Full technical detail in the
[August 16–17 change audit](../CHANGE_AUDIT_2026-08-16_TO_17.md).
