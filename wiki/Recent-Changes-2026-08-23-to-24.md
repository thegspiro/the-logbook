# Recent changes: August 23–24, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-23_TO_24.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-23_TO_24.md).
Predecessor: [August 19–23](Recent-Changes-2026-08-19-to-23).

**The headline:** members can now claim a shift from the calendar in one tap,
and commit to a recurring one. Officers can issue NFC ID cards and leave a
check-in station running on a tablet. Label printers are registered once and
printed to directly, including the shift roster and the equipment check sheet.
Four administration pages now open with the same frame — four metrics and a
"Needs attention" queue. And **five authorization gaps were closed, four of
them reachable by an ordinary member** — read that section even if you skip the
rest.

## Read this first

**If you administer a department:**

- **Enabling the Department Store during setup used to make setup impossible to
  finish** — the final Continue failed outright. Fixed. If you gave up on
  turning the store on, try again.

- **The Assigned Inventory table has disappeared from member profiles** for
  everyone except quartermasters (`inventory.manage`) and the member
  themselves. This is a fix, not a regression — it was visible to every viewer.
- **Members with `admin_hours.manage` were seeing the whole department's hours**
  under "My Admin Hours" headings. That page now always shows only their own.
- **Nine settings screens changed shape.** The content is the same; the
  navigation is now identical on all of them.
- **Email notifications look different** for departments that press **Reset**
  on a template. Nothing changes until they do.

**If you integrate with the API:** no response shape changed incompatibly, but
one changed **additively** — every scheduling `ShiftResponse` now carries a
`roster` array of its seat occupants. A client that rejects unknown fields, or
that validates against a generated schema, needs to account for it. Nothing
was removed or renamed. Several endpoints are new; see the table below.

**If you run the upgrade:** twelve migrations, head `e7a41b6d09c2`. One does
not reverse. See [Database upgrade route](#database-upgrade-route).

## Pages and connection points

| Area                                | Pages                                                                                                        | API/data connection                                                                                                                                                                                                           | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduling — the board**          | Scheduling → Schedule (month grid + day panel; on a phone a bar grid, a day sheet and a confirmation screen) | New table `standing_shift_claims`; `GET /scheduling/shifts/{id}/trade-candidates`, `POST /scheduling/swap-requests/{id}/respond`, `GET/POST/DELETE /scheduling/standing-shifts`, `GET /scheduling/eligibility/positions/bulk` | Each shift carries a status chip — `2 open`, `Full 4/4`, `You + 2/4` — and one button that claims the first open seat the member is cleared for. Filters **dim rather than hide**, so the month keeps its shape. **A shift that names neither positions nor a minimum staffing level reads as unset, not as an emergency**: grey, headcount instead of a ratio, and out of the open-seat count. Cancelled, finalized and past shifts read as closed. A **training seat cannot be traded** — it carries the trainee's program and evaluating officer                                                                                                                                                                  |
| **Standing shifts**                 | Schedule → a shift → Make this a standing shift                                                              | `standing_shift_claims`                                                                                                                                                                                                       | "Every Tuesday night" is stored as a claim, so giving up one date leaves the series intact. It works in both directions: creating a claim seats you on matching shifts already scheduled, **and** a shift created later seats everyone whose claim matches it. The series is anchored on the shift you started it from, so fortnightly means every other one of _those_. The horizon is yours to pick and defaults to a year out                                                                                                                                                                                                                                                                                     |
| **NFC ID cards & check-in station** | **`/members/check-in-station`** (new); member profile → ID Cards                                             | New table `nfc_tags`; `GET/POST/PATCH/DELETE /nfc-tags`, `POST /nfc-tags/check-in`                                                                                                                                            | **Off until a department enables the `nfc-id-cards` integration.** A card is stored only as a hash — the department cannot read a member's card number back out, and neither can anyone who obtains a database dump. The last four characters are kept so an officer can tell two of a member's cards apart. A station keeps offering a shift until an officer **finalizes** it, not until it ends — checking out has no deadline, so a crew coming off a tour can still tap out. **Retired and on-leave members can still tap in** — they attend meetings and banquets. Suspended, dropped, archived and deleted members cannot. Revoking a card is permanent; a replacement is a new registration                  |
| **Label printers**                  | Settings → Label Printers; inventory labels; **Print** on the shift roster and the equipment check sheet     | New table `label_printers`; `GET/POST/PUT/DELETE /label-printers`, `POST /label-printers/{id}/test`, `GET /label-printers/{id}/status`, `POST /labels/print`, `POST /station-documents/print`                                 | A printer is registered once — host, port, resolution, label stock, command language — instead of typed at every print, and there is no browser print dialog to get wrong. **Two languages: ZPL** (Zebra and ZPL-emulating printers) **and ESC/POS** (receipt-class thermal, some with linerless label media). The choice changes the renderer, the stock sizes offered and the status query. **The server opens the connection, not your browser** — a printer you can reach from your laptop may be unreachable from the server, and registration will still succeed                                                                                                                                               |
| **Administration pages**            | Members, Training, Inventory and Events admin pages                                                          | New table `admin_hub_metric_preferences`; `GET /admin-hub/{module}/summary`, `GET/PUT /admin-hub/{module}/metrics`                                                                                                            | All four now open with a header, **four headline metrics**, a **Needs attention** queue, then the tabs you already know. **Three of the four metrics are your choice**; the fourth is always the count the queue is about, so it cannot be configured away. The department sets a default, and can decide whether individual administrators may keep their own. A department that configures nothing keeps the built-in four — **an upgrade never blanks the page.** Access is the module's own manage permission: an inventory officer cannot read the members queue                                                                                                                                                |
| **Equipment checks**                | Template builder; check form                                                                                 | New column `check_template_compartments.is_sealed`; new table `shift_equipment_check_seals`                                                                                                                                   | A compartment can be marked as **closed with a numbered tamper seal** — a drug bag, a trauma kit. On the check, reading a matching intact seal clears the counting inside in one tap. **It never clears expiry dates or pressure readings**, which move on their own while the bag sits shut. **A seal proves unchanged, not full**: the previous counts carry forward, so a bag that was three morphine short is still three short and still files as a failure. If the seal is broken or the number differs, the seal is still recorded and the contents are counted by hand. Item types collapsed from nine to four — **`level`, `function`, `count`, `expiry`** — and the builder now names what each one stores |
| **Submit External Training**        | `/training/submit`                                                                                           | New `start_time` columns; `POST /training/submissions/with-attachment` and the attachment routes                                                                                                                              | The certificate is attached **with** the submission rather than in a second step that could be skipped. The form asks for a start time and a length; both are now kept, so an officer reviewing a four-hour entry can tell a morning class from an evening one. Entries submitted before this have no start time recorded — that reads as blank, not as 9am                                                                                                                                                                                                                                                                                                                                                          |
| **My Admin Hours**                  | `/admin-hours`                                                                                               | `GET /admin-hours/summary`, now always scoped to you                                                                                                                                                                          | The six-tile grid is gone. A **reporting period** drives both the totals and the entry list, so the two always describe the same window; it **defaults to all time**, because a calendar-year default made "no hours logged this year" look like an empty account. Requirement progress now appears where the department has configured requirements for your profile                                                                                                                                                                                                                                                                                                                                                |
| **Events list**                     | `/events`                                                                                                    | `GET /events/missed-mandatory`; new column `event_rsvps.early_check_in_minutes`                                                                                                                                               | Events are ranked by what they need from you, with a **Needs you** band. **An early check-in is flagged and never credited as attendance** — tapping in at 17:00 for a 19:00 drill records the honest arrival time and tells the event's manager how early it was. Historical check-ins have no early figure recorded, because deciding one after the fact would put a number on the record that was never true                                                                                                                                                                                                                                                                                                      |
| **Department Store**                | `/store`, **`/store/checkout`** (new), My Orders                                                             | Storefront endpoints; route gated on the organization's storefront module                                                                                                                                                     | The catalog, checkout and My Orders were redesigned around the cart. Several setup defects were fixed at the same time: the admin dashboard returned a 500, onboarding's **Enable** button did not actually enable the store, and the position editor stripped store permissions on first save                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Settings**                        | Organization, Events, Scheduling, Elections, User Settings, Email Templates and three more                   | Shared settings shell                                                                                                                                                                                                         | Nine screens carried five different navigation idioms between them. All now use the same one: a section list on desktop, a scrollable tab strip on a phone, and the selected section in the URL so a link opens where you meant. **Save/Reset appears only on sections it actually writes**                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Email templates & notifications** | Settings → Email Templates                                                                                   | New `header_accent`, `status_chip`, `layout` columns                                                                                                                                                                          | Every notification has a new shell. **Existing templates are untouched** until somebody presses **Reset** on one — a department that changes nothing keeps exactly the emails it has today. The editor and its preview are now side by side, and the screen says which notices your department has changed and how heavily each is used                                                                                                                                                                                                                                                                                                                                                                              |
| **Dashboard**                       | `/dashboard`                                                                                                 | `GET /scheduling/dashboard/widgets`, `GET/PUT /scheduling/dashboard/widget-preferences`                                                                                                                                       | Seven staffing tiles — today's staffing, coverage gaps, open slots, pending changes, incomplete closeouts, workload balance, special operations — each linking into the schedule already filtered to what it counted. Each tile keeps its own horizon and filters, per member                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **The installed app**               | Everywhere                                                                                                   | Service-worker precache and update flow                                                                                                                                                                                       | The app never picked up a new version in Brave until the browser cache was cleared by hand. Fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Database upgrade route

Twelve new migrations. **Current head: `e7a41b6d09c2`.** Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.

| Revision       | Adds                                                               |
| -------------- | ------------------------------------------------------------------ |
| `c3e91a7f4d28` | `admin_hub_metric_preferences`                                     |
| `d5b207e4f139` | Sealed-container flag and the `shift_equipment_check_seals` record |
| `c3f81a4d5e72` | Collapses check item types to four                                 |
| `c3b71f0d5a92` | `nfc_tags`                                                         |
| `d5e82c0a7f31` | `event_rsvps.early_check_in_minutes`                               |
| `b3e7f1a92c40` | `label_printers`                                                   |
| `c7d1f4a83e29` | The printer's command language                                     |
| `e4b91c7d2a58` | Merge revision rejoining the two branches                          |
| `e7a41b9c3d85` | `nfc_station` as an admin-hours entry method                       |
| `a71c9d4e5b62` | `start_time` on self-reported training                             |
| `e7c4a913b8d2` | Email template colourway columns                                   |
| `e7a41b6d09c2` | `standing_shift_claims`                                            |

### Before you upgrade

**One migration does not reverse.** `c3f81a4d5e72` collapses nine equipment
check item types into four. Three old names become `function` and two become
`level`, and nothing records which one a row started as. The downgrade
deliberately leaves the types collapsed rather than guessing — **a wrong guess
renders the wrong control on a safety checklist.** No data is lost either way;
you simply cannot get the old names back.

That migration also **writes an instruction into items that had none.** The
three pass/fail variants differed only in what the crew was asked to do, and
the type name was the only place that instruction lived. An item with an empty
description gets one ("Confirm the item is in place." / "Switch it on and
confirm it works."). **An item whose author wrote their own description keeps
their words.** In the shipped preset library this affected 185 of 232 items.

**Seven of the twelve deliberately backfill nothing**, and it is worth knowing
why so an empty column does not read as a bug:

- Every existing compartment stays **unsealed** — that is what every department
  has today.
- Historical event check-ins get **no early-arrival figure**. Working one out
  would mean deciding what each event's start time was at the moment somebody
  tapped, and an event whose start was edited afterwards would be given a
  number that was never true.
- Historical admin-hours rows recorded as `qr_scan` **stay** `qr_scan`. That is
  what the QR path really wrote; rewriting any of them would invent a
  provenance the database never recorded.
- Training submitted before this release has **no start time**. Blank is the
  truth; 9am would be a guess.
- Existing email templates keep **their own colours**, and render byte for byte
  as they do today.
- **No standing shift claims are inferred** from anyone's existing assignments
  — that would guess a commitment nobody made.
- A department with **no metric preferences** gets its module's built-in four.

## Who sees what — the authorization fixes

Five gaps closed. Four were reachable by an ordinary member, and three of those
rested on the same mistake: **gating on a permission that every member holds.**

| What was visible                                                                                           | To whom                                            | Now                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member's assigned gear — turnout coat, radio, SCBA mask — and its condition, on **every** member profile | Every viewer                                       | `inventory.manage`, or your own profile. A member profile is a directory card; what somebody signed for is quartermaster business                                                                                                                 |
| Department-wide inventory counts, low stock and overdue checkouts on the dashboard                         | Every member                                       | `inventory.manage` or `settings.manage`                                                                                                                                                                                                           |
| Your own membership application, through the prospect widget's counts and details                          | Anyone reviewing intake who had themselves applied | Excluded from the totals, the aging buckets and the details list                                                                                                                                                                                  |
| Medical-screening compliance and the members attention queue                                               | Anyone with `members.manage`                       | Also requires `medical_screening.view`. Without it the tile reads **unknown** rather than vanishing — an absent tile invites a second look, a stated unknown does not                                                                             |
| —                                                                                                          | —                                                  | **Position eligibility is now enforced when a scheduler assigns somebody**, not only when a member claims their own seat. A department that configured which ranks may run a position had that ignored on the write path that seats everyone else |
| —                                                                                                          | —                                                  | **A check submitter can no longer move unlimited stock onto a truck.** A swap is bounded by the lot it replaces, and that lot must actually be aboard                                                                                             |

**`inventory.view` and `prospective_members.view` are part of the baseline
Member position.** A check for one of them says only "this person signed in".
If you write or review an authorization check, that is the trap.

## Not yet available

- **Walking an equipment check as a lap** — stop by stop, in walking order — is
  built and tested but **not connected to the live check screen**, which still
  shows the flat compartment list. Do not expect it after this upgrade.

## Known limitations opened this window

- **The setup wizard's per-module "configure permissions" step does nothing.**
  Fifteen module cards point at it. It says _"permissions configured!"_ and
  discards the answer — nothing submits it and no backend field corresponds to
  it. **Do not use it to restrict a module during setup**; set the permissions
  on the positions themselves afterwards. The Department Store's route was
  removed in this window rather than repaired. Tracked as **ONBOARD-1**.
- **Self-report certificates have no retention policy and are not scanned for
  malware.** They are validated by magic bytes and stored under a
  server-generated name, so nothing is executed server-side, but a file served
  back to an officer is whatever the member uploaded. Approved certificates are
  kept indefinitely, which is what a training record is for — expiring them
  needs a records-retention decision from the department before it needs code.

Full detail in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).
