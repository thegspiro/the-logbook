# Administration Pages — the shared frame

_Added 2026-08-23; Scheduling joined 2026-09-05._ Members, Training, Inventory
and Events each had their own
administration page header, their own stat layout, and their own idea of what
belonged above the tab bar. They now share one frame. **The tabs and their
contents are unchanged** — this replaced what sat above them, not the work
itself.

## What the frame is

Every administration page now opens with:

1. A header naming the module.
2. A row of **four headline metrics**.
3. A **Needs attention** queue — the things a person has to do something about.
4. The module's existing tabs, unchanged, underneath.

## The metrics row

Three of the four slots are the department's choice. **The fourth is always the
count the attention queue is about**, and it is not stored at all — a page
cannot be configured into hiding the number its own queue is measuring.

| Module     | Built-in default three                           |
| ---------- | ------------------------------------------------ |
| Members    | Active, Probationary, Inactive                   |
| Training   | Compliance, Hours this quarter, Active programs  |
| Inventory  | Items tracked, Issued to members, Out for repair |
| Events     | Upcoming, RSVPs this week, Check-ins logged      |
| Scheduling | To close out, Short-staffed, Hours this month    |

**A department that configures nothing keeps these.** Absence of a stored
preference means the module's built-in default four — never "no metrics". An
upgrade does not blank anybody's administration page.

### Two scopes

| Scope          | Who it applies to                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Department** | The default every administrator sees                                                           |
| **Personal**   | An individual administrator's own selection — available only if the department's row allows it |

The department-wide record carries the flag that decides whether personal
selections are permitted at all. A department that wants everyone looking at
the same four numbers turns it off, and personal selections stop applying.

## The attention queue

The queue lists work, and **its rows name people** — the member whose screening
lapsed, the officer whose report is outstanding. That is why access is the
module's own manage permission rather than a blanket administrator gate:

| Module           | Permission          | Additional                                                                                                                                                                                               |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Members          | `members.manage`    | The queue and the screening-currency metric also require `medical_screening.view`                                                                                                                        |
| Training         | `training.manage`   | Requires the `training` module                                                                                                                                                                           |
| Inventory        | `inventory.manage`  | Requires the `inventory` module. The **hub** additionally admits `inventory.check_manage` and the store grant, because it carries cards for those consoles — each card still resolves its own permission |
| Events           | `events.manage`     | —                                                                                                                                                                                                        |
| Scheduling       | `scheduling.manage` | _(2026-09-05)_ One grant runs the whole area — the hub, every page behind it and the nav rows                                                                                                            |
| Department Store | store management    | _(2026-09-03)_ Joined the shared frame at `/inventory/admin/store`                                                                                                                                       |

An inventory officer who cannot manage members has no business reading the
member queue, and now cannot.

**Medical screening is health information.** "Screening current" and the
members queue both read it, and both were previously reachable with
`members.manage` alone. A caller without `medical_screening.view` now sees the
metric rendered as **unknown** rather than omitted — an absent tile invites a
second look, a stated unknown does not — and an empty queue.

## Edge cases worth knowing

- **An unknown module and a forbidden one both answer the same way.** A person
  who may not administer Training cannot use this screen to learn whether the
  department runs Training at all.
- **One broken aggregate does not take the page down.** A metric or queue that
  fails to resolve renders as unknown; the tab body below it is the
  administrator's actual work and survives.
- **`?tab=` is validated against the tabs you may open.** Opening the members
  hub with `?tab=add` without `members.create` used to select a tab that was
  neither in the bar nor allowed to render, leaving the page empty below the
  header.
- **The screening queue counts members, not records.** It previously counted
  every historical expired record, so a member who had renewed could be current
  in the metric and lapsed in the queue at the same time.

## API

See [API Reference → Administration Page Frame](API-Reference#administration-page-frame-2026-08-23).

## Data

`admin_hub_metric_preferences` — see
[Database Schema](Database-Schema#recent-schema-changes-2026-08-23--08-24).

## Breadcrumbs _(2026-09-05)_

Every administration hub and the pages beneath it now carry a breadcrumb trail.
Nothing under `/scheduling/admin` had one: its sub-pages offered a single
unlabelled back arrow whose destination was only in its `aria-label`, and each
one was headed "Shift Scheduling" with its real name demoted to a prefix on the
description. Templates, Patterns, Reports, Platoons, Who Can Fill What and the
six Settings sections now name themselves and show the path back up.

Three rules the trail follows, each because the naive version was wrong:

- **On a hub the trail stops at the parent**, rather than repeating the page's
  own heading — which the header already states twice.
- **A crumb that cannot be opened is plain text, not a link.** A generated
  trail is built from URL prefixes, and a prefix is often either not a route at
  all (`/inventory/admin/checklists/templates`, which declares only `/new` and
  one per template) or a route the viewer lacks the grant for — a checklist
  manager holds `inventory.check_manage`, which opens
  `/inventory/admin/checklists` but not its parent `/inventory`. Both used to
  render as working links, landing on the dashboard and on Access Denied
  respectively.
- **A detail page keeps its link back to the list.** Where a URL ends in a
  record id the id is not shown, so the crumb before it names the collection
  the record came from — `Applications` on a grant application, not the record
  itself. Member edit and audit history separately used to end in a link to
  `/members/admin/edit`, which is not a route.

**Equipment Checklists is no longer a dead end.** It carried no back link of
its own, and is reached from Scheduling Administration as well as Inventory
Administration.

## The Administration section opens for more grants _(2026-09-05)_

`scheduling.manage` was added to `ADMIN_NAVIGATION_PERMISSIONS`. Without it, a
scheduling officer holding nothing else administrative never saw the section
open, so the new row inside it would never have been reachable.

**This widens who sees the section open — not what anyone can do inside it**,
which is still decided card by card and route by route.

Two structural notes that came out of getting this right:

- **The top navigation's Admin dropdown drops itself when every row inside it
  is gated away**, so widening the section without adding a row would have
  given a scheduling officer an Administration section containing nothing.
- **A hub gate wider than every card behind it only opens an empty page.**
  `training.view_all` was briefly added alongside `scheduling.manage` for the
  position roster, then removed with it when that page narrowed to
  `scheduling.manage` — nothing in the app has ever linked a training officer
  there, so the wider gate bought a screen reachable only by typing its URL
  while forcing every gate above it to widen to match.

`administrationDiscovery.test.tsx` renders the section for a scheduling-officer
persona and a training-officer persona, because **a gate is only reachable if
every gate above it also opens.**

## Members settings moved onto the sectioned frame _(2026-09-06 → 09-11)_

Five settings that lived in three different places are now sections of one
screen at `/members/admin/settings`, on the same section-sidebar frame as
Scheduling's and Organization's settings.

| Section            | Route                                | What it sets                            | Permission the **endpoint** wants                                                         |
| ------------------ | ------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Contact Visibility | `/members/admin/settings/visibility` | What members see of each other          | `settings.manage`, `settings.manage_contact_visibility` or `organization.update_settings` |
| Membership IDs     | `/members/admin/settings/ids`        | Numbering and prefixes                  | `settings.edit` or `organization.update_settings`                                         |
| Operational Ranks  | `/members/admin/settings/ranks`      | The ladder, and who may fill which seat | `settings.manage` or `members.manage`                                                     |
| Membership Tiers   | `/members/admin/settings/tiers`      | The ladder, and what each tier confers  | `members.manage`                                                                          |
| EVOC Levels        | `/members/admin/settings/evoc`       | Driver certification ladder             | `apparatus.manage`                                                                        |

`/members/admin/settings` itself redirects to the first section.

**Each section is its own route, not a `?tab=`.** Same reason Scheduling's
sections are: a settings screen an officer is _sent_ to — from a hub card, from
another module, from their own bookmarks — has to be addressable, and a query
parameter that only a client-side `useState` reads cannot be linked to,
refreshed into, or reached with the back button. The paths are written down once
in `membersSettingsSections.ts`, so the routes, the hub cards and the nav cannot
drift into three spellings.

**The per-section permission is the endpoint's, not the hub's**, and that
distinction is the whole reason the list exists. Every route under
`/members/admin` stands on `members.manage` — but neither Contact Visibility
nor Membership IDs _saves_ through an endpoint that accepts it. Gating them on
the hub's grant would put a members officer on a page where every toggle
returns 403, which is exactly the defect that took six review rounds on the
scheduling close-out queue.

Ranks and EVOC are the clearest case: they sit side by side under one heading
and are gated on entirely different modules. **Operational Ranks now accepts
`members.manage`** because the ladder moved here and its gate moved with it.
**EVOC deliberately does not** — it is served by the apparatus API, and widening
that was not part of the move.

Contact Visibility and Membership IDs came from the global Organization
Settings screen and **their old addresses redirect**, so existing links and
bookmarks still arrive. Operational Ranks and EVOC came from the same global
screen; Membership Tiers is new, and shares its editor with the setup wizard's
step 4.
