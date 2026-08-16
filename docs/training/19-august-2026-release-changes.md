# August 2026 workflow updates

This lesson is the operator-facing companion to the technical change audits
for [August 12–14](../CHANGE_AUDIT_2026-08-12_TO_14.md) and
[August 15–16](../CHANGE_AUDIT_2026-08-15_TO_16.md). It explains what members
and administrators now do differently. Permission names are included because a
control that is absent is usually a permission or module-state issue, not a
rendering failure. The August 15–16 additions start
[here](#facilities-rooms-can-now-live-inside-other-rooms-august-1516).

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

Authorized administrators can use the Room QR Codes directory to search,
download PNG codes, and print room signs. Facility-room codes and apparatus
shift check-in codes are available from their inline entry points. Regenerating
a location display code immediately invalidates the old code.

**Edge cases:** the bulk directory is restricted; a QR target is organization
bound; a stale printed sign stops working after rotation; sensitive facility
fields require `facilities.view_sensitive`, while editing still requires
`facilities.edit` or `facilities.manage`.

> **[SCREENSHOT NEEDED — Room QR directory search results with Download PNG and Print controls, using non-sensitive demo rooms.]**
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

## Upgrade notes for administrators

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
- **Dark mode on public pages** (forms, ballots, status pages) no longer
  renders white-on-white; the themed background now covers every page,
  including the scrollbar gutter.
- **Onboarding sessions are tab-scoped.** The setup wizard's session no
  longer survives a browser restart or spans tabs; if you close the tab
  mid-onboarding, expect to resume by signing in again.

## Upgrade notes for administrators (August 15–16)

One migration: `20260816_0001` adds `facility_rooms.parent_room_id`
(nullable, self-referential, `ON DELETE SET NULL`) — no backfill, existing
rooms stay top-level. Back up, require a single `alembic heads` result, run
`alembic upgrade head`. Deploying `docker-compose.prod.yml` now requires
Docker Compose v2.24.4+ (`volumes: !override` clears development bind
mounts; upgrade Compose rather than removing the tag). Unraid operators
copying `unraid/.env.example` will find an HTTPS `ALLOWED_ORIGINS` example —
substitute your reverse-proxy hostname. Details in the
[technical audit](../CHANGE_AUDIT_2026-08-15_TO_16.md).
