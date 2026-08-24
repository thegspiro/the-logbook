# Administration Pages — the shared frame

_Added 2026-08-23._ Members, Training, Inventory and Events each had their own
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

| Module    | Built-in default three                           |
| --------- | ------------------------------------------------ |
| Members   | Active, Probationary, Inactive                   |
| Training  | Compliance, Hours this quarter, Active programs  |
| Inventory | Items tracked, Issued to members, Out for repair |
| Events    | Upcoming, RSVPs this week, Check-ins logged      |

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

| Module    | Permission         | Additional                                                                        |
| --------- | ------------------ | --------------------------------------------------------------------------------- |
| Members   | `members.manage`   | The queue and the screening-currency metric also require `medical_screening.view` |
| Training  | `training.manage`  | Requires the `training` module                                                    |
| Inventory | `inventory.manage` | Requires the `inventory` module                                                   |
| Events    | `events.manage`    | —                                                                                 |

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
