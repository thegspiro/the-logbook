# August 12–24, 2026 workflow updates

This lesson is the operator-facing companion to the
[six-day change audit](../CHANGE_AUDIT_2026-08-10_TO_16.md), its
[three-day detail](../CHANGE_AUDIT_2026-08-12_TO_14.md), the
[August 15–16 detail](../CHANGE_AUDIT_2026-08-15_TO_16.md), the
[August 17–19 audit](../CHANGE_AUDIT_2026-08-17_TO_19.md), the
[August 19–23 audit](../CHANGE_AUDIT_2026-08-19_TO_23.md), and the
[August 23–24 audit](../CHANGE_AUDIT_2026-08-23_TO_24.md). It explains what
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

![The Admin Hours Summary on This calendar year: counted, approved and needs-review totals over a year of logged time, ranked by the category it was logged against](./images/19-22-admin-hours-summary-year.png)

_The period really is a calendar year — Jan 1 to today, not a rolling 365
days — which is what the date range beside the heading states. The
per-category approval thresholds are not on this screen: auto-approve and
maximum-session limits are set on the **Categories** tab, and what the
summary ranks is hours logged, not the limits they were logged under._

## Storefront

Store administrators now see activity/status counts and can filter the order
list by the corresponding states. Organization settings can hide the store-open
banner. A member can change the external payment method on their own order; the
application records the method/status but does not process the payment.

**Edge cases:** members cannot edit another member's order; payment and
fulfillment remain separate; variant/product locks are canonicalized; notice and
email results do not reveal other recipients; counts and filters are scoped to
the active organization.

![Store Admin's Overview: the activity counts across the top and the order-workflow breakdown counting each fulfilment state the Orders list can be filtered by](./images/19-08-store-admin-activity.png)

The counts and the list are two tabs, so they are two pictures. Overview holds
the cards above; Orders holds the list they describe. Read them together — the
workflow breakdown counts **Paid 2**, and filtering the Orders list to Paid
returns those same two orders:

![Store Admin's Orders tab narrowed to paid orders, the list showing only the two the status filter matches](./images/19-06-store-admin-orders.png)

![A member changing the payment method on their own order: a method picker over the department's payment handles and the "I've sent payment" report](./images/19-07-member-payment-method.png)

**Nothing on that screen says the department is not taking the money, so say it
in training.** The picker records _how_ a member intends to pay and
"I've sent payment" records _that they say they have_ — both are claims the
treasurer then reconciles against the actual account. No card is charged and no
transfer happens here. The screen offers a handle to pay through and a button to
report having done so, which reads as a checkout to anyone who has not been told
otherwise.

## Room and apparatus QR codes

Authorized administrators can use the Check-In QR Codes directory to search,
download PNG codes, and print room signs. Facility-room codes and apparatus
shift check-in codes are available from their inline entry points. Regenerating
a location display code immediately invalidates the old code.

**Edge cases:** the bulk directory is restricted; a QR target is organization
bound; a stale printed sign stops working after rotation; sensitive facility
fields require `facilities.view_sensitive`, while editing still requires
`facilities.edit` or `facilities.manage`.

![The Check-In QR Codes directory filtered to the stations, each card offering Copy URL, Download PNG and Regenerate above the Print All and Room signs controls](./images/19-04-qr-directory-search.png)

![The regenerate-code confirmation, warning that the code already printed stops working once a new one is issued](./images/19-05-qr-regenerate-warning.png)

## Apparatus crew seats and scheduling settings

Crew positions now select configured ranks instead of relying on free text.
Shift settings persist per organization and calendar navigation retains its
context. Members retain the completion/report flows they are authorized to use
when equipment-check template administration is restricted.

**Edge cases:** legacy position names remain readable; an incompatible rank
cannot be saved; switching organizations must not reuse the prior organization's
rank or settings cache; finalization resolves apparatus labels in batches.

![The rescue's crew seats: three chosen from the department's configured positions and a fourth still holding a free-text value, marked (legacy position)](./images/19-23-apparatus-crew-seats.png)

_Each closed control already names the ranks eligible for that seat, which
is where the rank backing shows. The open option list is not pictured and
cannot be: these are native `<select>`s, and an open one is drawn by the
operating system rather than by the page._

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

**Not pictured, and it is not a tooling limitation so much as a contradiction
in what would have to be true.** Every other image in this library is taken
against a demo department that exists. This wizard only runs when one does
**not**: with a department on file, `/onboarding` sends you to the sign-in page
rather than to step one — which is the same "Onboarding has already been
completed" condition the table above distinguishes from an expired session. So
the two frames would need a database with no department, and the rest of the
library needs one with a department, in the same run.

Reproduce it yourself on a scratch install in about a minute: start the wizard,
fill in the department and stations steps, quit the browser, reopen
`/onboarding`, and press Next. The form comes back filled in — that is the local
draft — and the step fails. That failure is the whole lesson: a populated form
is not evidence of a live session.

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

![A public form in dark mode at full window width, the themed gradient reaching the window edges](./images/19-11-dark-scrollbar-gutter.png)

_Corrected 2026-08-24._ An earlier version of this note said the strip could not
be photographed, on the strength of `window.innerWidth -
documentElement.clientWidth` measuring `0`. That measurement was the wrong
instrument, and the picture above proves it: until 2026-08-24 this same capture
carried a **bright white 15px strip** down its right edge, which an image audit
found by comparing edge pixels against the content beside them.

The August 15 canvas move did not finish the job. It gave `html` the themed
gradient as a background _image_, and the `background:` shorthand resets
`background-color` to transparent — so the reserved strip, which is painted from
the canvas _colour_, still fell back to the browser's white. `html` now carries
`background-color` as well, and the strip takes the theme colour; that is what
you are looking at above.

One residue is not fixable and is not a defect: a dialog's scrim is
`position: fixed; inset: 0`, laid out against the initial containing block,
which excludes that strip. So on a **light** page under a dark modal overlay the
gutter stays light beside the dimmed page. Nothing in a page can paint outside
its own box.

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

![The Rooms section as a containment tree: sub-rooms indented under the room holding them, each container reporting how many it holds](./images/06-24-rooms-nested-tree.png)

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

![A colleague's profile with the officer's grant: the compliance summary, the training and certification history and the emergency contacts are all rendered](./images/19-18-profile-as-officer.png)

![The same profile as an ordinary member: contact details and assigned gear remain, while the compliance summary, training history and emergency contacts are not rendered at all](./images/19-19-profile-as-member.png)

_One thing the marker asked for cannot be shown, because no screen has it: there is no account-security block on a **colleague's** profile for anybody. MFA enrolment, last sign-in and email verification are on your own settings page, so neither account has one to compare. What the permission does change is the three panels above._

**No shipped role can reach that 403, so there is no screenshot of it.** The
guard is real — `hire_date`, `rank`, `station`, `platoon` and
`membership_number` all require `members.manage`, and an attempt without it is
refused with:

> Only leadership, the secretary, or the membership coordinator can update hire
> date, rank, station, platoon, or membership number

But every role in the shipped catalogue that grants `users.edit` also grants
`members.manage`, so the refusal is unreachable until a department builds a
custom role that separates them — a records clerk who maintains contact details
but does not set rank or hire date, say. That is the situation to keep in mind
when you build one; it is not a state the product can be put into out of the
box, and staging it would mean photographing a role no department has.

![The candidate list as an elections manager: both the accepted candidate and the nominee who has not yet accepted](./images/19-20-candidates-as-manager.png)

![The same election as an ordinary member: the ballot offers only the candidate who accepted, the pending nomination withheld now that nominations have closed](./images/19-21-candidates-as-member.png)

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

# August 17–19 changes

Three things landed in this window that change what somebody does at a
keyboard: a way to record call volume without an incident-reporting system, a
rebuilt shift close-out, and NFC tags. A fourth — a pre-upgrade configuration
check — changes what an administrator does at a terminal.

## Counting calls without an incident-reporting system

**Who this is for:** a department that does not run an RMS and still has to
report call volume for grants, ISO, apparatus replacement, or a staffing case.

**Switch it on:** Scheduling → Settings → General → _Shift close-out rules_ →
**Record a call count at close-out**. It applies immediately.

**Tell your officers first.** It changes what they see at 0700 the same
morning: the familiar close-out checklist is replaced by a three-step wizard.

Full lesson: [Counting Calls Without an
RMS](./03-scheduling.md#counting-calls-without-an-rms-2026-08-18).

### The one thing to get right before quoting a number

The report labels the figure **Unit Responses**, not **Total Calls**, and the
difference is real. Two units that closed out independently each reported their
own call, and nothing yet links them to one incident — so an MVA that Engine 5
and Medic 1 both ran counts twice.

**Do not put that figure in a grant application as a department call count.**
Reconcile mutual responses by hand until the cross-unit feature ships.

### What is deliberately not collected

No address, no patient or caller identity, no narrative, no response times, no
readable CAD number. Those are the fields that make a call record protected
health information, and there is nowhere in the feature to enter one. Departments
that need incident-level records need an incident module, not a call counter.

**Edge cases:** calls the officer cannot classify go in the wizard's **Not
categorised** row — the total is the sum of the rows, so leaving them out
records a smaller shift rather than an unclassified remainder; 100 calls is the
per-shift ceiling; renaming a call type does not disturb history, but deleting
one leaves its past calls unclassified, and a rename is **not** reflected in the
Call Volume report, which prints the internal slug. Blank and `0` read as
different answers while the form is open, but they are not distinguishable once
saved — both record no calls, so no report can tell a quiet tour from an
unanswered question.

**Officers already signed in must reload** before their next close-out: a
session opened before the toggle was flipped still shows the old checklist,
which never asks for a call count, so a shift closed from that tab finalizes
with none recorded.

## Shift close-out is now three screens, and it saves as you go

For departments recording a call count. Same **Close out shift** button, same
permissions.

1. **When was everyone actually on** — times, combined crew hours, anyone
   flagged for a missing check-out, and anyone assigned who never checked in
2. **How many calls** — one row per call type; the total is calculated from the
   rows and cannot be typed into
3. **Confirm each member's credit** — seeded from the apparatus count, adjust
   anyone who came on late

**Each step saves when you press Next.** A phone that locks at 0700 reopens on
the screen it left rather than at the beginning.

**Edge cases:** reopening a finalized shift restarts the wizard; declined,
pending and no-show crew are not listed; you cannot lower the count below the
calls this shift shares with another unit; correcting a shift's date or
apparatus afterwards moves its calls with it; a member credited with fewer calls
than the apparatus ran gets a count but not call types, because which calls they
were on is not knowable.

Full lesson: [The three-step close-out
wizard](./03-scheduling.md#the-three-step-close-out-wizard-2026-08-19).

## NFC tags: events, admin hours, and shift check-in

A reusable sticker replaces reprinting a QR sheet per event, and needs no
camera — which is the part that fails in a dark bay or with gloves on.

**Write a tag** from the page that already shows the QR code:

| Page                                          | Tag opens                                                             |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Event → **QR Code**                           | that event's check-in                                                 |
| Admin Hours → a category's QR code            | that category's clock-in                                              |
| Shift detail → the apparatus QR block         | shift check-in for that truck                                         |
| **Check-In QR Codes** (`/locations/qr-codes`) | shift check-in — this is where you write a whole fleet in one sitting |

**Read a tag** by holding the phone to it — or, if the app is already open on
screen, with **Tap Tag** on the Events page, My Admin Hours, or the scheduling
calendar. Android only hands a tag to the browser when the app is _not_ in the
foreground, which is the gap Tap Tag fills.

**Not pictured, and the paragraph below is why.** The screenshot harness
runs headless Chromium over `http://localhost`, which fails both of Web NFC's
conditions, so the writer beside the QR code is replaced there by the line
explaining which condition is missing. Photographing that would put a picture of
an unavailable feature under a caption about using it.

**Requirements: Chrome on Android, over HTTPS.** Not iPhone, not desktop, not a
plain-`http://` LAN deployment. Where it is unavailable the controls are absent
or explain which of the two conditions is missing. QR still works everywhere.

**Prefer the apparatus tag over a shift tag** for anything mounted: the
apparatus code resolves when it is tapped rather than naming a shift, so one
sticker serves the life of the truck. A shift-keyed tag dies when that shift
ends. Tell members to check the shift named on the check-in page before
confirming — the resolver takes the truck's earliest open shift dated today,
which on a two-shift day is not the one currently running.

**Room kiosk display codes cannot be tagged, deliberately.** A kiosk code is a
check-in credential for an unauthenticated screen; a sticker in a public hallway
hands it to whoever walks past.

**An unrecognized tag does nothing.** The app follows only links pointing back
at your own Logbook and only to check-in pages it knows. Anything else leaves
the scan waiting with a message.

## Before you upgrade: check the configuration first

A configuration problem is normally found when the container refuses to boot —
which means finding it by losing the service. Ask first:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --build backend python -m app.preflight
```

`0` means it starts, `1` means it does not and lists what is blocking, `2` means
a value is malformed.

**Two details matter.** Use `--build`, or you are checking the image you are
replacing rather than the one you are deploying. And pass the same `-f` files
your deployment uses, or Compose evaluates only the base development settings
and answers about a configuration nobody runs.

`--compose PATH` goes further and names settings your compose file **drops** —
values sitting in `.env` that never reach the container. Those used to become
defaults silently, which is how production ends up running a development
setting with nothing on screen to say so.

**This one is text, not a screenshot** — and deliberately so. Terminal output
belongs in a code block, where it can be searched, copied and diffed against
what your own run prints. A picture of it can do none of those things.

A development configuration, which is not checked because the blocking rules
apply only to production and staging:

```console
$ python -m app.preflight
Environment: development

RESULT: this configuration starts.

NOTE: no blocking checks run for 'development' — they apply only to production
and staging. To test a production configuration, re-run with: --as production
$ echo $?
0
```

The same process re-run as production, which is the check worth doing before a
deploy:

```console
$ python -m app.preflight --as production
Environment: production  (forced via --as)

BLOCKING (5):
  - CRITICAL: REDIS_PASSWORD must be set in production
  - CRITICAL: DB_SSL should be enabled in production to encrypt database
    traffic ...
  - CRITICAL: REDIS_SSL should be enabled in production to encrypt Redis
    traffic ...
  - CRITICAL: API documentation (ENABLE_DOCS) must be disabled in production —
    /docs, /redoc, and /openapi.json expose the full API surface for
    enumeration
  - CRITICAL: SECURITY_ENFORCE_HTTPS must be True in production. ...

Advisory, does not prevent startup (1):
  - WARNING: VOTE_SIGNING_KEY should be set for any organization using the
    elections module. ...

CONFIGURATION SOURCE CHECK — did these values reach this process?
  COOKIE_SECURE           NOT PRESENT — using built-in default None
  DB_SSL                  NOT PRESENT — using built-in default False
  ENABLE_DOCS             NOT PRESENT — using built-in default True
  REDIS_PASSWORD          NOT PRESENT — using built-in default None
  SECURITY_ENFORCE_HTTPS  NOT PRESENT — using built-in default False
  ...

9 blocking setting(s) are absent from this process's environment. If you set
them in a .env file, the value is NOT reaching the container.

RESULT: this configuration will NOT start. Fix the blocking items.
$ echo $?
1
```

The **configuration source check** is the part to read first when something
surprises you. It answers a different question from the blocking list above it:
not "is this setting right" but "did this setting arrive at all". A value in
`.env` that a Compose `environment:` block never lists cannot reach the
container, and before this existed it simply became the built-in default with
nothing on screen to say so.

## Sign-in hardening

- **Breached-password rejection** (optional, off by default). Only the first
  five characters of the password's hash ever leave the server. If the lookup
  service is down the password change **still goes through** — the check is
  supplementary, and complexity, history, MFA and lockout all still apply.
- **A human challenge (CAPTCHA)** can be required on the two internet-facing
  forms. If _its_ provider is down, the submission is **rejected** — there is no
  other control behind it, so accepting unverified traffic during an outage is
  exactly what an attacker wants.
- **Lockout messages are generic by default.** Saying "this account is locked"
  confirms the account exists and tells an attacker their spray is landing.
- **A per-IP throttle** counts failed attempts across _all_ accounts. Account
  lockout is per-user, so one password tried against a thousand accounts never
  trips it; this is the control that does.

## Privacy notice and terms rewritten

Both pages were rewritten to state up front that **the department, not the
platform, controls member data**. The print layouts were rebuilt and both pages
went through an accessibility pass.

![The rewritten Privacy Policy above the fold, opening with who controls the system and the department's ownership of every account on it](./images/19-03-privacy-header.png)

## Upgrade notes for administrators (August 17–19)

- **Two migrations**: `82bdcb3b1e64` (the call tables) and `2827079fd66c` (the
  close-out resume point). Both additive, neither backfilling. Back up, confirm
  `alembic heads` returns exactly one, then `alembic upgrade head`.
- **Nothing changes for a department that ignores the new setting.** Call
  logging keeps working exactly as it does today; the absence of the setting
  means current behaviour, not "off".
- **Run the preflight check before the restart**, per the section above.

---

# August 19–23, 2026 workflow updates

Operator-facing companion to the
[August 19–23 audit](../CHANGE_AUDIT_2026-08-19_TO_23.md). One new screen
(Governance → Legal Documents), one behaviour change that will surprise
officers (you can no longer approve your own swap), and a set of phone fixes
that make dialogs usable again.

## Governance → Legal Documents: your own privacy notice

**Where:** Governance → **Legal Documents** (`/governance/legal`)
**Who:** `legal.propose` to draft, `legal.publish` to publish, or
`settings.manage` for both

Until now the wording on your `/privacy` and `/terms` pages was the platform's.
A department can now write its own — which matters because record-retention
rules, volunteer/career status and state law all differ, and boilerplate
written for the platform does not describe what your department actually does
with member data.

![Governance → Legal Documents: the Privacy Notice card published with its last-updated line, beside a Terms of Service card still carrying an unpublished draft](./images/19-09-legal-documents.png)

### Drafting and publishing are two different jobs

This is the part to get right when handing out permissions.

| You hold          | You can                                                             | You cannot  |
| ----------------- | ------------------------------------------------------------------- | ----------- |
| `legal.propose`   | Read both notices, draft a new version, edit or delete your draft   | **Publish** |
| `legal.publish`   | All of the above, plus publish, plus revert to the platform default | —           |
| `settings.manage` | Reaches the screen and can publish                                  | —           |

A department that wants the secretary to draft and an officer to approve gets
that from the permissions. A department that does not want the ceremony gives
one person `settings.manage`.

![The revision editor under a propose-only account: the document text, the filled-in change note, and the free-text Effective date printed to members as Last updated](./images/19-16-legal-revision-editor.png)

_Publishing is not a control on this form. **Save draft** and **Cancel** are
what it offers everyone, including a member who can publish — publishing is an
action on the saved proposal afterwards, and that is where the permission shows
(the proposal card offers **Publish to members** only to `legal.publish` or
`settings.manage`)._

### Every change needs a reason

The **change note** is required. It is where you record the bylaw, SOP,
statute or counsel note behind the new wording. This is not bureaucracy: the
whole reason for proposing a revision rather than editing the page in place is
that somebody in two years can see _why_ it says what it says.

### What "Last updated" accepts

Anything. It is free text and is never interpreted — `March 3, 2026`,
`FY26-Q1`, `Adopted at the 3/3/26 business meeting` all work, and all display
exactly as typed. Date it the way your records officer dates things.

**Clearing it is not the whole story.** Emptying the box does clear the field
on that revision — but **the public page keeps whatever date it had.** One
"Last updated" line is shared by both `/privacy` and `/terms` in the
organization's settings, and publishing only ever _sets_ it, never removes it.
That is deliberate: reverting your terms must not blank the date shown above a
privacy notice that is still published. **To change what the public sees, put a
new date in — clearing the box will not blank it.**

### Edge cases worth knowing

- **A draft is not public.** Nothing on `/privacy` or `/terms` changes until
  somebody publishes.
- **Only one version is live at a time** per document.
- **Old versions are never deleted.** When you publish, the version it replaces
  is archived. This is deliberate: the question a records request actually asks
  is not "what does your notice say" but "what did it say on the day I joined".
- **Removing the member who wrote a revision does not remove the revision.**
  Their name is cleared from it; the wording stays, because it is a department
  record.
- **Revert to default** puts the platform wording back. It needs
  `legal.publish`.
- **There is no approval queue.** Saving a draft notifies nobody. If you want
  review before publishing, that is a process you run — the module does not
  chase anyone.

![Three revisions of the privacy notice — one live, two replaced — each keeping the reason it was changed and who published it](./images/19-17-legal-revision-history.png)

## Scheduling: you can no longer approve your own swap

**Where:** Scheduling → Requests

Holding `scheduling.manage` no longer lets you review a request you are part
of. Two people are blocked on a swap, not one:

- the member who **raised** it, and
- the member it **targets**.

Time-off is simpler: the requester cannot review their own.

This will bite hardest on the departments where it is least convenient. On a
small combination department the officer asking for Saturday off is very often
the only person who can approve it. That is precisely the situation the rule
exists for — a permission grant is not a second person.

![The release's separation-of-duties rule in force: Approve refused on the administrator's own swap request, with another member's row still reviewable](./images/19-12-swap-review-blocked.png)

_The error **is** the screenshot. Do not go looking for a difference in the
buttons: `RequestsTab` renders Approve and Deny on every pending request for
anyone holding `scheduling.manage`, their own included, so the rows offer the
same review controls until one is pressed. The only thing that marks your own
row is the small **✕** — cancelling is the requester's to do, and nobody
else's._

### Edge cases

- **A blocked attempt changes nothing.** The request stays pending, exactly as
  it was, for somebody else to action. It is not consumed, half-applied, or
  moved to a rejected state.
- You may still review a swap between two **other** members, even on your own
  shift.
- If nobody else holds `scheduling.manage`, the request waits. Plan the second
  grant before you need it — this is the one change in this release that can
  leave a department stuck at 0600 on a Saturday.

## Scheduling: the Requests tab is now paged

Long swap and time-off histories no longer load in one go. The tab now renders
twenty rows at a time with a **Load more** button beneath them — not numbered
pages — and the button simply is not there once everything is loaded.

One thing to know before you go looking for it: the tab opens filtered to
**Pending**, and a season's worth of history is resolved by definition. Set the
status filter to **All Statuses** first, or the list will look like it holds
three requests when the count beside the view's name says twenty-seven.

**If you have a script or integration reading swap or time-off requests from
the API, it needs updating** — the response is now an object with an `items`
list rather than a plain list. See the
[API Reference](../../wiki/API-Reference.md).

![The paged Requests tab: twenty time-off rows and the control that fetches the next page](./images/19-13-requests-load-more.png)

## Equipment checks: safe to finish in a dead spot

**Where:** Shift detail → equipment check

A crew that completes a check with no signal and reconnects at the station
used to risk a **duplicate check** — the queued submission replayed and created
a second record of the same inspection. That is now impossible: one check per
shift per template is enforced by the database, and the phone tags its
submission before sending so a retry lands on the same record.

The same protection covers a double tap on **Submit** and a dropped connection
mid-save.

![A completed check as one record on a phone — the state a replayed queue or a double-tapped Submit resolves to](./images/19-14-submitted-check-phone.png)

_The queued/offline half of that description is not pictured. Simulating a
dropped connection means setting state on the browser rather than on the
page, which this capture harness does not do — an "offline" banner staged
any other way would be a photograph of something the app never rendered.
What the record above shows is the end state either route arrives at: one
check, one set of answers._

### Other equipment-check changes

- **Deep storage paths now fit.** A check item several compartments down in a
  nested storage tree records its full path.
- **A compartment cannot be its own parent** — the tree rejects a cycle rather
  than accepting it and failing later.
- **Standalone (non-shift) checks are unchanged for ordinary members.** The
  endpoint accepts `equipment_check.submit` **or** `equipment_check.manage`, so
  a member who could start an ad-hoc check before can still start one. Do not
  change anybody's role over this.
- **Expired-equipment failures are decided from inventory at submission**,
  rather than from whatever the phone claimed. The result is then stored with
  the check. A lot that expires _after_ the check was recorded does **not**
  retroactively turn that check into a failure — the record stands as taken,
  which is what makes it usable as evidence of the state at that time.
- **Check timing is recorded by the server.** The phone no longer supplies it.

## Events: a Recruitment type that feeds the pipeline

**Where:** Events → new event → Type

Open houses and recruitment nights have their own event type. Pick
**Recruitment** on a **new** event and guest sign-in switches on, along with
"create a prospect from each guest" — because a recruitment event whose
attendees never reach the pipeline has not recruited anybody.

![A new event with Recruitment chosen: guest sign-in and create-a-prospect both switched on, under the banner explaining that guests reach the prospective-members pipeline](./images/19-10-event-recruitment-type.png)

### Edge cases

- **The automatic switch is create-only.** Changing an existing event to
  Recruitment does **not** flip its switches. Look for the banner on the form
  instead — it explains what to turn on and gives you a button to do it.
- **It yields to you.** Once you set either switch yourself, the automatic
  default stops applying for that form session.
- **It reverts cleanly.** Choose Recruitment then change your mind, and
  switches the form set automatically are turned back off. Switches you set
  yourself are left alone.
- **Templates do not trigger it** — a template prefills the form the same way
  an edit does.
- Existing open houses filed under Public Education or Other are **not**
  reclassified.
- Past recruitment events group with **Other** on the Past Events tab.

## On a phone: dialogs are usable again

If members have reported that a dialog's buttons "do nothing" on a phone, this
is the fix. The bottom navigation bar was painting **over** open dialogs and
swallowing the taps — the buttons were not merely hidden, they were
untappable, and the tap navigated the page out from under the dialog.

The bar now hides while a dialog, drawer or bottom sheet is open.

![The fix in force: a dialog scrolled to its action row on a phone, with no navigation bar painting over the buttons](./images/19-15-tall-dialog-action-row.png)

Also improved on phones this week: the events page, equipment template
actions, the checklist builder, calendar month navigation, and the document,
training, audit and check-in tables (which now reflow to stacked cards instead
of scrolling sideways).

## Browser tabs now say which page you are on

Several Logbook tabs open at once used to be indistinguishable. Each tab now
carries the page name. A slow-loading page no longer shows the previous page's
name while it loads.

Nothing to configure.

## Exports: a comma in a name no longer breaks the file

Two exports were mis-escaped. The event attendance export in particular
shifted every column after a member whose name contained a comma —
`Smith, John` split into two cells and pushed the rest of the row sideways.

Every export in the product now goes through one escaper. Blank cells no
longer pick up a stray apostrophe, and spreadsheet formula characters are
neutralized everywhere rather than in some exports and not others.

**If you have kept a mis-exported attendance file, re-export it.**

## Upgrade notes for administrators (August 19–23)

- **Eight migrations.** Back up, confirm `alembic heads` returns exactly one,
  then `alembic upgrade head`. The head is `a17c4e9d2b61`.
- **Three of them repair databases that believe they are already up to date.**
  Three earlier migrations were released under one revision id and later
  renumbered, so a database upgraded in those windows is stamped as having run
  work it never ran. The repairs repeat the work safely — on a healthy
  database they do nothing.
- **Two migrations do not cleanly reverse — and neither loses data.** The
  seat-list normalization expands a legacy crew count into individual seats,
  and its downgrade deliberately does nothing: the original count cannot be
  recovered from the expanded seats, so it leaves them as they are rather than
  guessing. The equipment-check de-duplication detaches historical duplicates
  rather than deleting them, and cannot re-attach them on downgrade.
  **Item snapshots are kept in both cases** — no safety record is destroyed.
- **Do not downgrade past both `compartment_name` migrations.** Doing so
  narrows the column and truncates deep storage paths.
- **Two new permissions** to assign if you want the Legal Documents screen used:
  `legal.propose` and `legal.publish`.
- **Check who holds `scheduling.manage`.** If exactly one person does, and they
  also request swaps, they can no longer approve their own — grant a second
  person before a Saturday morning finds out for you.

---

# August 23–24, 2026

Companion to the
[August 23–24 change audit](../CHANGE_AUDIT_2026-08-23_TO_24.md). Nineteen
hours, 46 pull requests, twelve migrations. Three things arrive that a
department has never seen before — ID cards, label printers and a shift board —
and **five authorization gaps close**, four of which an ordinary member could
reach. Read the last of those sections even if you skip the rest.

## Scheduling: the calendar says which shifts need people, and claiming one is a tap

Open **Scheduling → Schedule**. Instead of a grid of cards, each shift now
carries a status chip:

| Chip                                 | What it means                       |
| ------------------------------------ | ----------------------------------- |
| **`2 open`** (red or amber)          | Seats still to fill. Red is urgent  |
| **`Full 4/4`** (green)               | Staffed                             |
| **`You + 2/4`** (blue)               | You are on it                       |
| A headcount with **no ratio** (grey) | This shift never stated a crew size |

Select a day and the panel beside the grid shows the crew and **one button that
claims the first open seat you are cleared for**. There is no position dropdown
to find. Filters dim rather than hide, so the month keeps its shape.

On a phone this is a bar grid, a day sheet and a confirmation screen.

**The grey shift is not a bug.** A shift that names neither positions nor a
minimum staffing level used to be assumed to want four people, so it showed
"4 open" in critical red. A department that configures neither opened the page
to a wall of red that meant nothing. Those shifts now read grey, show a
headcount, stay out of the open-seat count, and can still be joined.

Cancelled, finalized and past shifts read as **closed** and offer nothing.
Previously their empty chairs counted toward the day's open-seat total and its
urgent flag, and they showed a claim button the server refuses.

> **[SCREENSHOT NEEDED — the Schedule board, desktop.** _Demo data:_ a month
> containing at least one shift of each chip state: one red with open seats, one
> green and full, one blue with the demo member on it, and one grey shift that
> names neither positions nor a minimum. A day selected so the crew panel and the
> claim button are both in frame.**]**

> **[SCREENSHOT NEEDED — the Schedule board, phone (390×844).** _Demo data:_ same
> month; capture the bar grid with the day sheet open. The bottom navigation
> should be absent — it hides while an overlay is open.**]**

### Standing shifts: "every Tuesday night"

From a shift, a member can make it a **standing shift** — a recurring claim on
that seat.

It is stored as a claim rather than written out as a pile of assignments, and
that has a consequence worth teaching: **giving up one Tuesday does not end the
series.** The claim stays; only that date is released.

It works in both directions, and only means anything because both do:

1. Creating a claim seats you on **matching shifts already scheduled**.
2. Creating a **shift** later seats everyone whose active claim matches it.

Without the second, a series would go quiet the month the department generated
its next block of schedule.

**Edge cases to teach:**

- **The series is anchored on the shift you started it from**, not on today.
  "Every other Tuesday" means every other one of _those_ Tuesdays.
- **You choose the horizon**, and it defaults to a year out — not to
  December 31, which quietly shrinks as the year goes on.
- **You can create a series covering only dates nobody has scheduled yet.**
  That is the case standing shifts exist for.
- A standing claim goes through the **same checks as claiming any shift by
  hand**: eligibility, seat capacity, whether the shift is still open, whether
  the date has passed. It previously bypassed all of them.

> **[SCREENSHOT NEEDED — the standing shift dialog.** _Demo data:_ a Tuesday
> evening shift, biweekly pattern selected, horizon left at its default so the
> "a year out" default is visible. Capture on desktop; the panel must show its
> own action row, not one clipped by the viewport.**]**

### Trading a shift somebody can actually accept

Ask for a trade and you now get a **candidate list with everyone who could not
accept already removed** — anyone on the shift, on approved leave, not cleared
for the position, or working a tour that runs into this one. Least-loaded
first.

**The member you offered it to can now accept it.** Previously a one-way offer
could not be completed by anybody: manager review reads a named target as
"there must be a shift to trade back", and rejects the request when there isn't
one — which is the shape every one-way offer has.

Three rules to teach:

- **You cannot give up a seat while your own offer of it stands.** Releasing it
  or offering it again would leave the first person holding an offer that can
  no longer be honoured. Withdraw first.
- **An offer left pending is closed the day before the shift**, and both
  members and the duty officer are told. A pending offer holds the seat with
  the person who made it, so left alone it used to survive the shift itself
  with nobody informed.
- **A training seat cannot be traded.** It carries the trainee's program and
  evaluating officer; moving only the member would file one member's training
  against another.

### For schedulers: position eligibility now applies to you too

If your department has configured which ranks may run a position — driver,
officer, paramedic — **that is now enforced when a scheduler assigns somebody**,
not only when a member claims their own seat.

Until this release the rule applied to the people least likely to get it wrong
and was ignored on the path that seats everyone else. Expect assignments that
used to go through to be refused, and read the refusal — it names the missing
qualification.

Backfilling last week's roster is unaffected: a scheduler may still write to a
past or closed shift. Being cleared for a position is a safety question that
does not expire with the shift, which is why that one still applies.

### On the dashboard

Seven staffing tiles — Today's Staffing, Future Coverage Gaps, Open Slots,
Pending Changes, Incomplete Closeouts, Workload Balance, Special Operations.
Each one **links into the schedule already filtered to what it counted**, so a
number is somewhere to start rather than a fact to go and find. Each tile keeps
its own horizon and filters, per person.

Requires `scheduling.view`.

**[SCREENSHOT — REPLACE `00-04-dashboard-overview.png` and
`00-07-dashboard-panels.png`.** The scheduling tiles are new. **Caption which
permissions the capturing account held** — what a reader sees depends on their
own grants.**]**

## ID cards: officers issue them, stations read them

**Turn it on first.** Settings → Integrations → **NFC ID Cards**. It starts off
and the feature does not appear until it is on. The check is on the server, not
just in the interface, so nothing is reachable while it is off.

### Issuing a card

Member profile → **ID Cards**, with `members.manage_id_cards`. Bind a physical
card to a member, label it, and later suspend it, report it lost, or revoke it.

Cards ship blank, so **the tag's serial number is the credential**.

**What your department stores is a hash, not the number.** Nobody — not an
officer, not an administrator, not somebody who obtains a database backup — can
read a member's card number back out of The Logbook. The last four characters
are kept so an officer can tell two of a member's cards apart on screen, and
that is all.

**Revoking is permanent.** A revoked card is never reactivated; issue a
replacement instead. **Suspension is the reversible state**, for a card a member
has mislaid and may still find.

> **[SCREENSHOT NEEDED — member profile → ID Cards panel.** _Demo data:_ one
> active card and one revoked card on the same demo member, so the status
> difference and the four-character preview are both visible. Use demo data — do
> not capture a real member's card record.**]**

### The check-in station

`/members/check-in-station`, requires `members.check_in`.

An officer leaves a phone, tablet or desktop at the door, picks what is being
checked into, and arms the reader. **From then on nobody touches the screen
between taps** — members tap and walk in.

Two readers, because departments have both:

| Reader         | What it is                                                            |
| -------------- | --------------------------------------------------------------------- |
| **Web NFC**    | Chrome on Android, over HTTPS. The tablet reads the card itself       |
| **USB reader** | The desk kind that types the serial like a keyboard and presses Enter |

Keystrokes from a USB reader are captured **page-wide**, not into a box you
have to keep focused. A kiosk loses focus to the first stray tap on the screen,
and a station that has silently stopped reading is worse than one that was
never armed.

**Who can tap in:**

| Status                                | Accepted | Why                                                                     |
| ------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Active, probationary                  | Yes      | —                                                                       |
| **Retired, on leave**                 | **Yes**  | They attend meetings and banquets, which is what a station is recording |
| Suspended, dropped, archived, deleted | No       | —                                                                       |

**A station offers a shift until an officer finalizes it** — not until it
ends. That is deliberate: checking out has no deadline, so a crew coming off
a tour at 07:00 can still tap out on a shift whose end time has passed. Only
offers targets the check-in itself would accept.

An unregistered card, a member who is already checked in, or a closed window
are shown on screen and the station **stays armed**. They are not errors — an
error page in front of a queue of members is worse than the tap it was
reporting.

> **[SCREENSHOT NEEDED — the check-in station, armed.** _Demo data:_ a target
> selected (a drill night), the reader armed, and at least one successful tap in
> the recent-taps list. Capture on a tablet-width viewport, which is how it is
> actually used.**]**

### One thing that changed in your records

An ID card tapped at a station is now recorded as entry method **`nfc_station`**,
not `qr_scan`. Those are different acts by different people: `qr_scan` means
the member scanned a category's QR code with their own phone. If you audit
admin hours, this is the distinction you have been unable to make.

**Historical rows are not rewritten.** A `qr_scan` recorded before this really
was written by the QR path.

## Label printers: register once, print with no dialog

Settings → **Label Printers**. Register each physical printer once — name,
location, host, port, resolution, label stock, darkness, and the **command
language** it speaks. Printing then goes straight to it, with **no browser
print dialog to get wrong**.

| Language    | Which printers                                                              |
| ----------- | --------------------------------------------------------------------------- |
| **ZPL**     | Zebra, and the many printers that emulate ZPL                               |
| **ESC/POS** | Receipt-class thermal printers, several of which take linerless label media |

The choice changes more than the bytes: the renderer, the label sizes you are
offered, and the status query all depend on it. **A printer that emulates ZPL
should be registered as ZPL.**

> **The single most useful thing to know when a print fails.** **The server
> opens the connection to the printer, not your browser.** A printer you can
> ping from your laptop may be unreachable from the machine running The
> Logbook. Nothing checks the address when you save it, so registration will
> succeed either way and the failure appears at print or status time. If a
> printer tests fine from a desk and fails from the app, that is the first
> thing to check.

**What else prints.** Beyond inventory labels: the **shift roster** and the
**equipment check sheet**, straight to the watch-desk printer. The check sheet
needs the same permission as the check itself, and a pass-down stays with its
own crew. A label can carry a QR code.

**Status is per printer.** One printer failing to answer no longer suppresses
the answers from the others.

> **[SCREENSHOT NEEDED — Settings → Label Printers.** _Demo data:_ two registered
> printers, one ZPL and one ESC/POS, one marked default, with a status result
> visible on at least one so the reader sees what a healthy answer looks like.
> Use RFC 5737 documentation addresses (`192.0.2.x`), never a real one.**]**

## Every administration page opens the same way

Members, Training, Inventory and Events administration pages now share one
frame: a header, **four headline metrics**, a **Needs attention** queue, then
the tabs you already know.

**The tabs and their contents did not change.** This replaced what sat above
them.

### Choosing the metrics

Three of the four slots are yours to choose. **The fourth is always the count
the attention queue is about**, so a page cannot be set up to hide the number
its own queue is measuring.

| Module    | Built-in default three                           |
| --------- | ------------------------------------------------ |
| Members   | Active, Probationary, Inactive                   |
| Training  | Compliance, Hours this quarter, Active programs  |
| Inventory | Items tracked, Issued to members, Out for repair |
| Events    | Upcoming, RSVPs this week, Check-ins logged      |

**A department that changes nothing keeps these.** The upgrade does not blank
anybody's page.

There are two scopes: a **department default** every administrator sees, and
optionally a **personal** selection. The department decides whether personal
selections are allowed at all — turn that off and everyone looks at the same
four numbers.

> **[SCREENSHOT NEEDED — the metrics settings screen.** _Demo data:_ the Members
> module, department scope selected, with the "applies to everyone" control
> visible and one metric being swapped. The fourth (queue) slot must be visibly
> fixed.**]**

### Who can see the queue

The queue lists work, and **its rows name people**. So it is gated on the
module's own manage permission, not a general administrator flag:

| Page      | Permission         | Also needs                                                          |
| --------- | ------------------ | ------------------------------------------------------------------- |
| Members   | `members.manage`   | **`medical_screening.view`** for the queue and the screening metric |
| Training  | `training.manage`  | The Training module enabled                                         |
| Inventory | `inventory.manage` | The Inventory module enabled                                        |
| Events    | `events.manage`    | —                                                                   |

**Medical screening is health information.** Until this release, "screening
current" and the members queue were readable by anyone with `members.manage`.
Somebody without `medical_screening.view` now sees that tile read **unknown**
rather than disappear — a missing tile makes people look for it, a stated
unknown does not — and an empty queue.

Two smaller fixes an administrator will notice:

- **A member who renewed is no longer both current and lapsed at once.** The
  screening queue counted every historical expired record; it now counts a
  member and screening type only where nothing unexpired covers it.
- **One broken number does not take the page down.** A metric that fails to
  work out renders as unknown and the tabs below it still work.

**[SCREENSHOT — REPLACE the four administration page headers.** The Members,
Training, Inventory and Events admin captures all show a layout that no longer
exists.**]**

## Equipment checks: four item types, and sealed containers

### Nine item types became four

An admin building a check template used to choose between near-synonyms —
`present` and `functional` both stored pass/fail and differed only in what the
crew was asked to do. There are now four:

| Type         | What it stores    | What "passing" means                                                                                                                                                                    |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Level**    | The number itself | Compared to a threshold. The reading is kept because the trend is the useful part. An empty box means "not read yet", not zero                                                          |
| **Function** | Pass / fail       | A fail opens a note and a photo — and **neither blocks the walk.** A crew held at a text box at 07:00 abandons the check, so an unwritten note is flagged on the finished check instead |
| **Count**    | A quantity        | Short of par is a **restock line, not a failure**                                                                                                                                       |
| **Expiry**   | A date            | Confirms the date already on record. Stays amber on every shift inside the pull window                                                                                                  |

Headings and free text are untouched — they are layout, not checks. The builder
now names what each type stores beside its label.

**Your existing templates were converted for you.** Where an item had no
description, the migration wrote in the instruction its old type used to imply
("Confirm the item is in place." / "Switch it on and confirm it works.").
**An item whose author wrote their own description keeps their words.**

### Sealed containers

A compartment — a drug bag, a trauma kit, a sealed pack — can be marked as
**closed with a numbered tamper seal**, in the template builder. On the check,
the crew reads the number, confirms it matches the last check, and **the
counting inside is cleared in one tap.**

Three rules, and each one is the reason the feature is safe:

1. **A seal clears counting only.** It never clears expiry dates or pressure
   readings — those move on their own while the bag sits shut, so an
   out-of-date vial cannot hide behind an intact tag.
2. **A seal proves unchanged, not full.** Confirming carries the previous
   counts forward. It does **not** fill the bag up to par. A bag that was three
   morphine short at its last count is still three short, and that still files
   as a failure.
3. **The shortcut has to be earned.** If there is no earlier intact seal whose
   number matches, the button reads **Record seal** — the seal is still filed
   for the record, and the contents are counted by hand.

**A sealed bag inside a sealed bag gets its own card.** A broken outer seal
says nothing about an intact inner one.

> **[SCREENSHOT NEEDED — the seal panel on a check.** _Demo data:_ two sealed
> compartments — one whose seal matches the previous check (so the clearing
> shortcut is offered) and one whose number differs (so the reader sees
> _Record seal_ and a hand count instead). This contrast is the whole teaching
> point and must be in one frame or two adjacent ones.**]**

### What is _not_ here yet

**Walking a check as a lap** — stop by stop in walking order, with finished
stops collapsed — is built and tested but **not connected to the check screen**,
which still shows the flat compartment list you have today. Do not teach it,
screenshot it, or promise it in this release.

### One change for crews who swap stock

A crew member without `inventory.manage` could move **any** quantity from ready
stock onto the truck, and dispose of lots that were never aboard it. A swap is
now bounded by the lot it replaces, and that lot has to actually be on the item.

## Submit External Training: the certificate goes with it

**Attach the certificate on the form.** It used to be a second step after
submitting, which meant it could be — and often was — skipped. PDF, JPG or PNG,
up to 10 MB.

**The start time is now kept.** The form has always asked for a start time and
a length and worked out the hours from the pair, but only the date and the
hours were stored. Editing a submission therefore had to invent a start — it
assumed 9am — and an officer reviewing a four-hour entry could not tell a
morning class from an evening one.

**Entries submitted before this release have no start time**, and that shows as
blank rather than as 9am. Blank is the truth; 9am would be a guess.

The form also stopped asking one question with three controls: duration is one
stepper.

Two things for records officers to know about the files:

- **Certificates are kept indefinitely** once approved — that is what a
  training record is for. Nothing expires them. If your department has a
  records-retention rule, this needs a decision from you before it needs code.
- **Files are not scanned for malware.** They are checked to be genuinely the
  file type they claim and stored under a name the server chooses, so nothing
  runs on the server. But a certificate opened by an officer is whatever the
  member uploaded.

**[SCREENSHOT — REPLACE the Submit External Training capture.** The screen is
rebuilt; the certificate now attaches inline.**]**

## My Admin Hours

**If you hold `admin_hours.manage`, the numbers you were seeing on this page
were the whole department's.** `My Admin Hours` fetched its totals without
scoping them to you. It is now always your own hours.

The six-tile grid is gone. In its place:

- **A reporting period** — this month, last 30 days, this year, all time —
  driving both the totals **and** the entry list, so the two always describe
  the same window.
- **Three fixed stats**: approved, awaiting review, logged this period, with
  entry counts as sublines.
- **Requirement progress**, where your department has configured requirements
  for your profile. The personal page never showed this, despite it being the
  question members actually have.
- **A ranked category breakdown** with share bars, and one line naming the
  categories with nothing in the period — instead of a tile reading zero for
  each.

**The period defaults to all time.** A calendar-year default hid older entries
behind a control you have to notice first, and "no hours logged in this year"
reads as an empty account rather than an active filter.

> **[SCREENSHOT NEEDED — the rebuilt My Admin Hours page.** No capture of this
> page exists in the guides, and the version it would have shown is gone.
> _Demo data:_ a member with hours in at least three categories and one
> configured requirement, so the category bars and the requirement-progress
> section are both populated, and at least one category with **no** hours in the
> period so the muted "nothing logged in" line appears.**]**

## Events: the list says what it wants from you

`/events` is now ranked by what each event needs from you, with a **Needs you**
band at the top.

**An early check-in is flagged and never credited as attendance.** Tapping in at
17:00 for a 19:00 drill records the honest arrival time and tells the event's
manager how early it was. Attendance credit still runs from the scheduled
start.

Check-ins recorded before this release carry no early figure. Working one out
after the fact would mean deciding what each event's start time was at the
moment somebody tapped, and an event whose start was edited since would be
given a number that was never true.

Two corrections members will notice:

- **The page no longer accuses people who could not have attended.** A member
  who joined after an event ran is not counted as having missed it.
- Credited hours read **"up to"**, because what you are credited depends on
  your recorded attendance, not the event's nominal length.

## Department Store, settings and email

**The Department Store** catalog, checkout and My Orders were redesigned around
the cart, and several setup defects were fixed: the admin dashboard returned an
error, onboarding's **Enable** button did not actually enable the store, and
the position editor stripped store permissions on first save. Worse than any of
those, **enabling the store during setup made setup impossible to finish** —
the final Continue failed outright, because a fourth hardcoded module list
inside the save endpoint had never heard of `storefront`. If you gave up on
turning the store on, try again.

> **Do not use the wizard's per-module "configure permissions" step to restrict
> a module.** It says _"permissions configured!"_ and throws the answer away —
> nothing submits it. That is true of the fifteen modules that still point at
> it; the Department Store's route was removed in this window rather than
> repaired. Set permissions on the positions themselves instead. Tracked as
> **ONBOARD-1** in `docs/KNOWN_LIMITATIONS.md`.

**Nine settings screens** — Organization, Events, Scheduling, Elections, User
Settings, Email Templates and three more — carried five different navigation
idioms between them. They all use one now: a section list on desktop, a
scrollable tab strip on a phone, and the section you are in reflected in the
URL so a link opens where you meant it to. **Save/Reset appears only on
sections it actually writes.** No setting moved or changed meaning.

**Email notifications have a new shell** — a 5px accent rule and a status chip.
**Nothing changes for your department until somebody presses Reset on a
template.** A department that leaves its templates alone keeps exactly the
emails it has today. The Email Templates screen now shows the editor and the
preview side by side, and says which notices your department has changed and
how heavily each is used.

**[SCREENSHOT — REPLACE every settings capture, and every capture of a received
Logbook email.** For the email shots, caption whether the department has
adopted the new shell — both are current, depending on whether Reset was
pressed.**]**

## Who could see what — five fixes to tell your officers about

Four of these were reachable by an ordinary member. Three rested on the same
mistake, and it is worth naming so nobody repeats it: **`inventory.view` and
`prospective_members.view` are part of the baseline Member position.** Checking
for one of them proves only that the person signed in.

| What was visible                                                                                               | To whom                                            | Now                                                         |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| **A member's assigned gear** — turnout coat, radio, SCBA mask — and its condition, on **every** member profile | Every viewer                                       | `inventory.manage`, or your own profile                     |
| **Department-wide inventory counts**, low stock and overdue checkouts on the dashboard                         | Every member                                       | `inventory.manage` or `settings.manage`                     |
| **Your own membership application**, through the prospect widget                                               | Anyone reviewing intake who had themselves applied | Excluded from the counts, the aging buckets and the details |
| **Medical-screening compliance and the members queue**                                                         | Anyone with `members.manage`                       | Also needs `medical_screening.view`                         |
| **Unlimited stock movable onto a truck**, and disposal of lots never aboard                                    | Any check submitter                                | Bounded by the lot being replaced                           |

**A member profile is a directory card** — the contact details a colleague is
meant to look up. Which turnout coat somebody signed for, and what condition it
is in, is quartermaster business. If your officers ask why the Assigned
Inventory table vanished from a profile, that is the answer.

**[SCREENSHOT — REPLACE the member profile capture.** Assigned Inventory is now
absent for a viewer without `inventory.manage`. **Caption the capturing
account's grants** — the page differs by viewer, and an uncaptioned shot reads
as a promise.**]**

## Also fixed

- **The app never updated in Brave** until the browser cache was cleared by
  hand. If you have been telling Brave users to clear their cache after every
  release, stop.
- **Calendar day labels shifted a day for any viewer west of the department** —
  a cell showing 26 announced itself as "Tuesday, August 25".
- **The phone month grid got its 44px touch targets back.**

## Upgrade notes for administrators (August 23–24)

- **Twelve migrations.** Back up, confirm `alembic heads` returns exactly one,
  then `alembic upgrade head`. **The head is `e7a41b6d09c2`.**
- **One migration does not reverse.** The equipment-check item-type collapse
  turns nine types into four, and nothing records which of three old names a
  `function` item started as. The downgrade deliberately leaves the types
  collapsed rather than guessing — **a wrong guess renders the wrong control on
  a safety checklist.** No data is lost either way.
- **That same migration writes instructions into items that had none**, and
  leaves alone any item whose author wrote their own description. In the
  shipped preset library it touched 185 of 232 items.
- **Seven migrations deliberately backfill nothing**, and an empty column is
  not a bug: no compartment is sealed, no historical check-in gets an
  early-arrival figure, no historical `qr_scan` is rewritten, training
  submitted before this has no start time, existing email templates keep their
  own colours, no standing shift claims are inferred from anyone's
  assignments, and a department with no metric preferences gets its built-in
  four.
- **Turn on NFC ID Cards** (Settings → Integrations) if you want cards, and
  grant `members.manage_id_cards` to whoever issues them and `members.check_in`
  to whoever runs a station. Neither is granted by the upgrade.
- **Register your label printers** before anyone tries to print. Check that the
  address you enter is reachable **from the server**, not just from your desk.
- **Check who holds `medical_screening.view`.** Officers who could previously
  see screening compliance on the Members administration page will find it
  reading _unknown_ until they hold it.
- **Expect scheduler assignments to start being refused** where a member is not
  cleared for the position. That rule now applies to schedulers, not only to
  members claiming their own seats.
