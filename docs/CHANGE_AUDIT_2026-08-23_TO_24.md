# Change audit: August 23–24, 2026

Net changes merged to `main` in the 19 hours ending 2026-08-24 07:02 EDT
(merge `2107bb9a`, PR #1771), picking up where the
[August 19–23 audit](./CHANGE_AUDIT_2026-08-19_TO_23.md) stopped at
`630b4769` (PR #1723, 2026-08-23 12:38 EDT).

**46 pull requests. 477 files, ~59,500 insertions.** Twelve schema
migrations. Three features that add a screen a department has never seen
(NFC ID cards and a check-in station, network label printers, a scheduling
board that claims a seat in one tap), one shared frame that replaces the top
of four admin pages, three screens rebuilt around what their users actually
do (member storefront, Submit External Training, My Admin Hours), a nine-screen
settings consolidation, an email-notification shell rewrite, and **five
authorization gaps closed** — four of them reachable by an ordinary member.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 23–24 section). Wiki handoff:
[`Recent-Changes-2026-08-23-to-24`](../wiki/Recent-Changes-2026-08-23-to-24.md).
Media disposition — which screenshots must be created, which replaced, and
which YouTube takes need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

## Read this first

Three things in this window change what an operator or integrator must do,
rather than just what they see:

1. **The check-in station is a new unattended screen.** `/members/check-in-station`
   is opened by an officer on a shared device and left running. It is gated by
   the `nfc-id-cards` integration row, which **starts off** — the feature does
   not appear until a department turns it on.
2. **Label printers are network devices the server talks to directly.** The
   backend opens a socket to the printer's host and port. A printer on a
   network segment the backend container cannot reach will register fine and
   fail at print time; see [Label printing](#label-printing--the-server-opens-the-socket).
3. **The equipment-check lap is built but not yet wired.** The four canonical
   item types, their controls and the lap UI all shipped and are tested. **The
   live check screen still renders the previous flat compartment list.** Do not
   document, screenshot or narrate the lap as the current member experience.

## Release map

| Area                                                          | PRs                                                    | Pages / connection points                                                                                                 | API / data points                                                                                                                                                                                                                                                                                                       | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling — the board, and standing shifts                   | #1748, #1751                                           | `/scheduling` Schedule tab (month grid + day panel; phone bar grid, day sheet, confirmation)                              | New table `standing_shift_claims`; `GET /scheduling/shifts/{id}/trade-candidates`, `POST /scheduling/swap-requests/{id}/respond`, `GET/POST/DELETE /scheduling/standing-shifts`, `GET /scheduling/standing-shifts/preview`, `GET /scheduling/eligibility/positions/bulk`; every shift response now carries its `roster` | A status chip per shift (`2 open` / `Full 4/4` / `You + 2/4`) and one button that claims the first open seat the member is cleared for. **A shift that names neither positions nor `min_staffing` reads as unset, not as an emergency** — grey, headcount not ratio, out of the open-seat count and the URGENT flag. Cancelled, finalized and past shifts read as closed and offer nothing. Standing claims have **two readers and only work because both exist**: creating a claim seats matching shifts already on record, and creating a shift seats every member whose active claim matches. Series parity is anchored on the shift it was started from, not on today. Giving up a seat is withheld while your own offer of it stands. A **training seat cannot be traded** — it carries the trainee's program and evaluating officer |
| Administration pages — one frame                              | #1729                                                  | Members, Training, Inventory and Events admin pages: header, four metrics, **Needs attention** queue, existing tabs below | New table `admin_hub_metric_preferences`; `GET /admin-hub/{module_key}/summary`, `GET`/`PUT /admin-hub/{module_key}/metrics`; `AdminHubFrame.tsx`, `AdminMetricsRow.tsx`, `AdminAttentionQueue.tsx`, `AdminMetricsSettings.tsx`                                                                                         | Three of four metric slots are choosable; **the fourth is always the count the queue is about**, so it is not stored and cannot be configured away. Two scopes share one table — a department-wide row (`user_id` NULL, scope key `__department__`) whose `applies_to_everyone` decides whether an individual admin may keep a personal selection. **No row means the module's built-in default four, never "no metrics"** (Pitfall #19). Authorized as the module's own manage permission, never a blanket admin gate — the queue rows name people. **An unknown module and a forbidden one both answer 404**, so the endpoint cannot be used to discover which modules a department runs                                                                                                                                                |
| NFC ID cards & the check-in station                           | #1739, #1750, #1765, #1770                             | `/members/check-in-station` (**new**); member profile → ID Cards panel                                                    | New table `nfc_tags`; `GET/POST/PATCH/DELETE /nfc-tags`, `POST /nfc-tags/check-in`; new `admin_hours.entry_method` value `nfc_station`                                                                                                                                                                                  | The credential is stored **only as a peppered SHA-256 hash** — a card serial is the whole credential, so a plaintext column would make a database dump a stack of working ID cards. `uid_preview` keeps the last four characters purely so an officer can tell two of a member's cards apart. Feature gated by the `nfc-id-cards` integration row, **off by default**. A station will not attach to a shift that has ended. Retired and on-leave members can still tap in; suspended, dropped, archived and deleted members cannot. A revoked card is never reactivated — a replacement is a fresh registration                                                                                                                                                                                                                           |
| Label printing                                                | #1740, #1749, #1763, #1766, #1768                      | Settings → Label Printers; inventory label print; `PrintDocumentButton` on shift roster and check sheet                   | New table `label_printers` (+ `language` column); `GET/POST/PUT/DELETE /label-printers`, `POST /label-printers/{id}/test`, `GET /label-printers/{id}/status`, `POST /label-printers/probe`, `POST /labels/print`, `POST /station-documents/preview`, `POST /station-documents/print`                                    | Two command languages: **ZPL** (Zebra and ZPL-emulating printers) and **ESC/POS** (receipt-class thermal, some with linerless label media). The renderer, the stock sizes offered and the status query all branch on it; existing rows are ZPL because that is the only language that existed when they were written. The server opens the socket, so reachability is the **backend container's**, not the operator's browser. One unanswered status query no longer silences the others. Status flags were corrected against the published command tables                                                                                                                                                                                                                                                                                |
| Equipment checks — four types, the lap, and sealed containers | #1729, #1738                                           | Template builder (type picker, sealed flag); check form seal panel                                                        | New column `check_template_compartments.is_sealed`; new table `shift_equipment_check_seals`; `check_template_items.check_type` collapsed to four values; `GET /equipment-check/templates/{id}/last-seals`                                                                                                               | Nine `check_type` values collapse to **`level` / `function` / `count` / `expiry`** (`header` and `text` untouched — they are layout, not checks). The request schema still **accepts** legacy names and normalizes before storing; it is deliberately stricter than the reader. **A seal proves unchanged, not full**: confirming carries the previous count forward rather than writing quantities up to par, and a carried shortfall still files as a failure. A seal never clears expiry dates or pressure readings. Clearing requires a prior **intact** seal whose normalized number matches; otherwise the seal is filed and the contents are counted by hand. **The lap UI is not wired to the live check screen**                                                                                                                 |
| Submit External Training                                      | #1741, #1748                                           | `/training/submit` rebuilt                                                                                                | New columns `training_submissions.start_time` (and the record's); multipart `POST /training-submissions/with-attachment`, `POST /{id}/submit`, `POST/GET /{id}/attachments`, `GET /{id}/attachments/{index}/download`                                                                                                   | The certificate now travels **with** the submission rather than as a second step that could be skipped. Files land under the _training-record_ attachment root on purpose, because approval copies the attachment dicts onto the `TrainingRecord` verbatim and the record download route confines paths to `TRAINING_ATTACHMENT_DIR`. Delete/withdraw unlinks the file — safe **only** because a submission is deletable in `draft`, `pending_review` and `revision_requested` alone. Start time is nullable with no backfill; editing previously invented 09:00                                                                                                                                                                                                                                                                          |
| Email templates & the notification shell                      | #1747                                                  | Settings → Email Templates (side-by-side editor and preview); every notification the platform sends                       | New columns `email_templates.header_accent`, `status_chip`, `layout`                                                                                                                                                                                                                                                    | A notice's colourway is **data**, not hexes baked into markup. All three columns are nullable with **no backfill**: NULL means "this body carries its own colours", which is true of every pre-migration row — those render byte-for-byte as they do today. A department opts in by creating a template or pressing **Reset**. A body still byte-identical to the _current_ shipped default is upgraded to the token form; **a body anybody has touched is left exactly alone.** A department upgrading from the previous release holds a pre-1b body that no token substitution reconstructs, and the migration does not try                                                                                                                                                                                                             |
| Settings — nine screens, one shell                            | #1744                                                  | Organization, Events, Scheduling, Elections, User Settings, Email Templates and three more                                | `SettingsLayout`, new `useSettingsAutosave`, `SaveStatusPill`, `SettingsPanelHead`, `SettingsToggle`                                                                                                                                                                                                                    | Nine screens carried five navigation idioms between them. All now render through the shared shell: section sidebar on desktop, scrollable tab strip on phones, `aria-current` on the active section, selection mirrored into `?tab=`. A Save/Reset footer appears **only** on sections the footer actually writes. Violet was removed from the surfaces it survived on                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Department Store                                              | #1742, #1746, #1756                                    | `/store` catalog, `/store/checkout` (**new route**), My Orders                                                            | Storefront endpoints; route gated on the organization's `storefront` module                                                                                                                                                                                                                                             | The admin dashboard **500'd**; onboarding's Enable button did not enable the store; the position editor stripped store grants on first save; and an inert config step was dropped. The member catalog, checkout and My Orders were redesigned around the cart. The Logistics Admin hub's Department Store card is gated on the module **and** the permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Events — ranked by what they want from you                    | #1745, #1759, #1762                                    | `/events` list                                                                                                            | `GET /events/missed-mandatory`; new column `event_rsvps.early_check_in_minutes`                                                                                                                                                                                                                                         | Events are ranked by what they need from the member, with a **Needs you** band. An early check-in — inside the window but well before the start — is **flagged and never credited as attendance**; the tap time stays the honest arrival record and the column says how far ahead of the scheduled start it was. Existing rows stay NULL, because backfilling would decide what each event's start time was at the moment somebody tapped, and an event whose start was edited afterwards would get a number that was never true. `missed-mandatory` is excluded from the API cache — it is per-member                                                                                                                                                                                                                                    |
| My Admin Hours                                                | #1743                                                  | `/admin-hours` personal view                                                                                              | `GET /admin-hours/summary` now always scoped to the caller; `reportingRange.ts`                                                                                                                                                                                                                                         | **See [Security fixes](#security-fixes)** — the summary was unscoped. The six-tile grid is replaced by a reporting period driving both totals and the entry list, three fixed stats, requirement progress from the compliance endpoint, and a ranked category breakdown. The period defaults to **all time**, because a calendar-year opening view made "no hours logged in this year" read as an empty account rather than an active filter                                                                                                                                                                                                                                                                                                                                                                                              |
| Dashboard — scheduling staffing widgets                       | #1686, #1695, #1698                                    | `/dashboard`                                                                                                              | `GET /scheduling/dashboard/widgets`, `GET`/`PUT /scheduling/dashboard/widget-preferences`                                                                                                                                                                                                                               | Seven tiles, each linking into the schedule already filtered to what it counted. **The window is bounded at the server**: inverted, or 93 days or longer, is a 422 rather than a query that walks the whole schedule. Station and platoon are validated against the organization's own lists, so an unknown value is a 422 and not an empty result reading as "nothing scheduled". Per-member horizons and filters                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Member profile — assigned inventory                           | #1767                                                  | Member profile → Assigned Inventory + Quick Stats                                                                         | `/users/{id}/inventory`, `/assignments`, catalog reads                                                                                                                                                                                                                                                                  | **See [Security fixes](#security-fixes)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Authorization fixes                                           | #1732, #1752, #1753, #1754, #1755, #1757, #1758, #1767 | Dashboard asset widgets; pipeline widget; shift assignment; admin hub; lot swap; member profile                           | —                                                                                                                                                                                                                                                                                                                       | **See [Security fixes](#security-fixes)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Browser / PWA                                                 | #1735                                                  | Installed app, every browser                                                                                              | Service-worker precache and update flow                                                                                                                                                                                                                                                                                 | The app never updated in Brave until the cache was cleared by hand. The legacy push worker is excluded from precache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CI and test integrity                                         | #1726, #1727, #1733, #1734, #1760                      | —                                                                                                                         | Workflow graph; `tests/conftest.py` patch guard; contract-test boot                                                                                                                                                                                                                                                     | A green PR took 28 minutes to do 39 minutes of work, almost all of it queueing. Every `main` commit now gets its own concurrency group. A leaked `patch()` now fails **the test that leaked it** rather than an innocent later one. A contract-test server that will not boot now says why — including the `SystemExit` uvicorn actually exits with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Alembic route (upgrade data path)

Twelve revisions this window. **Current head: `e7a41b6d09c2`.** Confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting
this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) deliberately
does not declare a head in prose, for the reason recorded there.

The window opened on `a17c4e9d2b61` and immediately forked in two: the
equipment-check/admin-hub chain and the label-printer chain both descend from
it directly, and `e4b91c7d2a58` rejoins them.

| Revision       | Revises        | What it does                                                                   |
| -------------- | -------------- | ------------------------------------------------------------------------------ |
| `c3e91a7f4d28` | `a17c4e9d2b61` | Adds `admin_hub_metric_preferences`                                            |
| `d5b207e4f139` | `c3e91a7f4d28` | Adds `check_template_compartments.is_sealed` and `shift_equipment_check_seals` |
| `c3f81a4d5e72` | `d5b207e4f139` | Collapses `check_template_items.check_type` to four canonical values           |
| `c3b71f0d5a92` | `c3f81a4d5e72` | Adds `nfc_tags`                                                                |
| `d5e82c0a7f31` | `c3b71f0d5a92` | Adds `event_rsvps.early_check_in_minutes`                                      |
| `b3e7f1a92c40` | `a17c4e9d2b61` | Adds `label_printers` (second branch off the same parent)                      |
| `c7d1f4a83e29` | `b3e7f1a92c40` | Adds the printer's command `language`                                          |
| `e4b91c7d2a58` | _(merge of 2)_ | Rejoins `c7d1f4a83e29` and `d5e82c0a7f31`                                      |
| `e7a41b9c3d85` | `e4b91c7d2a58` | Adds `nfc_station` to the `admin_hours.entry_method` enum                      |
| `a71c9d4e5b62` | `e7a41b9c3d85` | Adds the self-report submission `start_time` columns                           |
| `e7c4a913b8d2` | `a71c9d4e5b62` | Adds the email-template colourway columns                                      |
| `e7a41b6d09c2` | `e7c4a913b8d2` | Adds `standing_shift_claims` — **current head**                                |

### Reversibility

**`c3f81a4d5e72` (check-type collapse) does not reverse.** `pass_fail`,
`present` and `functional` all become `function`, and `reading` joins `level`;
no column remembers which name a row started with. Its `downgrade()`
deliberately leaves the types canonical rather than guessing — a wrong guess
renders the wrong control on a safety checklist, which is worse than leaving
the column modern.

What the old names carried implicitly is preserved rather than dropped: the
three pass/fail variants differed only in what the crew was asked to do, and
the type name was the only place that instruction lived. Items with an empty
description get the instruction written into it ("Confirm the item is in
place." / "Switch it on and confirm it works."); an item whose author described
the test keeps their own words. The seeded preset library got the same
treatment — **185 of its 232 items** were pass/fail-family with no description,
so collapsing them untreated would have left a crew with "Works / Fails" and no
test written on the item.

**`e7c4a913b8d2` (email colourway) rewrites exactly one class of row** — a body
still byte-identical to the _current_ shipped default. Everything else is left
alone, and the columns are nullable, so a downgrade drops opt-in styling data
and no wording.

**Everything else in this window adds and does not transform.** Seven of the
twelve state explicitly in their own docstrings that they do not backfill, and
each says why:

| Revision       | Why nothing is backfilled                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d5b207e4f139` | Every existing compartment stays unsealed — that is what every department has today                                                                                    |
| `d5e82c0a7f31` | Deciding each historical RSVP's early minutes means deciding what its event's start was at tap time; an event edited afterwards would get a number that was never true |
| `e7a41b9c3d85` | A historical `qr_scan` really was written by the QR path; rewriting one invents provenance the database never recorded                                                 |
| `a71c9d4e5b62` | A row written before this has no start time. NULL reads as "not recorded", which is the truth                                                                          |
| `e7c4a913b8d2` | NULL means "this body carries its own colours" — true of every pre-migration row                                                                                       |
| `e7a41b6d09c2` | No standing claim exists yet, and inferring one from existing assignments guesses a commitment nobody made                                                             |
| `c3e91a7f4d28` | A department with no preference row gets its module's built-in defaults                                                                                                |

## New data model

### `admin_hub_metric_preferences` — which three metrics an admin page shows

Two scopes in one table. The department-wide row carries `user_id` NULL and
scope key `__department__`; a user id can never collide with it because ids are
36-character UUIDs and `__department__` is not one. `applies_to_everyone` on
the department row decides whether an individual admin may keep a personal
selection.

Only **three** slots are stored. The fourth is always the count that feeds the
attention queue, so a page cannot be configured into hiding the number its own
queue is about.

### `nfc_tags` — ID card credentials bound to members

`uid_hash` is a **peppered SHA-256**; there is no plaintext column, because a
card serial is the whole credential and a database dump would otherwise be a
stack of working ID cards. `uid_preview` holds the last four characters so an
officer can tell two of a member's cards apart on screen — nothing else reads
it.

The table exists whether or not a department uses cards. The feature is gated
by the `nfc-id-cards` integration row, which starts **off**.

### `shift_equipment_check_seals` — what the crew read on the tag

One row per sealed compartment per check: the seal number as read, whether it
was intact, how many items the seal cleared, and the compartment name copied as
text. `template_compartment_id` is `ondelete="SET NULL"` and nullable — a
template compartment can be deleted years after the check that referenced it,
and the audit record must survive that.

### `standing_shift_claims` — a member's recurring claim on a seat

Stored as a claim rather than written once as a batch of assignments, so giving
up a single date leaves the series intact and shifts generated later can still
be seated from it. The horizon is the member's to pick, defaulting to a year
out rather than to December 31 — a December-31 default quietly shrinks as the
year goes on.

### `label_printers` — registered network devices

Host, port, resolution, loaded label stock and command `language`, registered
once per physical printer instead of typed at every print.

### Added columns

| Column                                   | Table                         | Note                                          |
| ---------------------------------------- | ----------------------------- | --------------------------------------------- |
| `is_sealed`                              | `check_template_compartments` | Default false; no backfill                    |
| `early_check_in_minutes`                 | `event_rsvps`                 | Nullable; NULL = not recorded                 |
| `start_time`                             | training submission / record  | Nullable; editing previously assumed 09:00    |
| `header_accent`, `status_chip`, `layout` | `email_templates`             | Nullable; NULL = body carries its own colours |
| `language`                               | `label_printers`              | Existing rows are ZPL as a statement of fact  |

## Label printing — the server opens the socket

The backend connects to the printer's host and port itself. Three consequences
that will otherwise be diagnosed as "the printer is broken":

- **Reachability is the backend container's, not the browser's.** A printer an
  operator can ping from their laptop may be unreachable from the container.
  Registration succeeds regardless — nothing validates the address at save
  time — and the failure surfaces at print or status time.
- **Two languages, and the choice changes more than the bytes.** ZPL and
  ESC/POS differ in the renderer used, the stock sizes offered, and the status
  query issued. A ZPL-emulating printer should be registered as ZPL.
- **Status is best-effort and per-printer.** One printer failing to answer a
  status query no longer suppresses the answers from the others — that was the
  fix in #1749, alongside correcting the status flag meanings against the
  published command tables.

Reference: [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md).

## Security fixes

Five authorization gaps, plus the member-profile disclosure. **Four were
reachable by an ordinary member holding nothing but baseline grants**, which is
the common thread: three of the five rested on a permission that is part of the
default Member position and therefore proves only that the caller is a member.

| #            | What was exposed                                                                                                                 | To whom                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1767        | A member's assigned gear — turnout coat, radio, SCBA mask — and its condition, on **every** member profile                       | Every viewer. The section was gated on "is the inventory module enabled" and nothing else | `inventory.manage`, or the profile is the viewer's own. `inventory.view` **could never have been the gate** — it is baseline Member. The catalog-side reads were closed in the same PR                                                                                                                                                                                                                                                               |
| #1755        | Department-wide item counts, low-stock lines, overdue-checkout totals via `GET /dashboard/asset-widgets`                         | Every member — the gate was `inventory.view`                                              | `inventory.manage` **or** `settings.manage`. The test asserts the service is never constructed for a plain viewer                                                                                                                                                                                                                                                                                                                                    |
| #1732, #1753 | The caller's own prospective-membership record, through the pipeline widget's totals, aging buckets **and** manager-only details | Anyone with `prospective_members.view` who had themselves applied                         | The widget takes the same `hidden_prospect_ids` dependency every other pipeline read already used                                                                                                                                                                                                                                                                                                                                                    |
| #1757        | Medical-screening compliance and the members attention queue — protected health information                                      | Anyone with `members.manage`                                                              | `MetricSpec.permission` / `ModuleSpec.attention_permission`, both `medical_screening.view`. A caller without it sees the metric as **unknown** rather than omitted; an absent tile invites a second look, a stated unknown does not                                                                                                                                                                                                                  |
| #1752, #1754 | — (integrity, not disclosure)                                                                                                    | —                                                                                         | `create_assignment` enforced position eligibility only on `self_signup`, so the rule applied to a member claiming their own seat and not to a scheduler seating somebody else. Now enforced on both paths. `require_mutable` and `reject_past` stay tied to `self_signup` deliberately — a scheduler backfilling last week's roster is doing records work, and being cleared for a position is a safety question that does not expire with the shift |
| #1758        | Unlimited stock movable onto a truck by a check submitter without `inventory.manage`, and disposal of lots never aboard          | Any check submitter                                                                       | Submitter-scope swaps are bounded by what is being replaced: the replaced lot must be aboard the item, and the quantity is capped at what it replaces. The template-item row is selected `FOR UPDATE` so two concurrent swaps cannot both pass the cap                                                                                                                                                                                               |

**The recurring lesson.** `inventory.view` and `prospective_members.view` are
held by positions that hold almost nothing else. A permission that everybody
has is not an authorization check — it is a statement that the caller signed
in. When gating anything per-member or department-wide, check the **manage**
grant or self-ownership, and write the test that pins which grants the baseline
Member position actually holds, so the fact the guard rests on cannot drift.

## Known limitations opened this window

### Self-report attachments — retention and scanning

Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md). Three open items:

- **No retention policy.** Approved certificates are kept indefinitely, which
  is what a training record is for, but nothing expires them and nothing sweeps
  an organization's files if the organization is removed. This needs a
  records-retention decision from the department before it needs code.
- **No malware scanning.** Uploads are validated by magic bytes and confined to
  a server-generated name, so a double extension cannot survive the trip and
  nothing is executed server-side. They are **not scanned** — a file served
  back to an officer is whatever the member uploaded.
- **Voided records keep the file**, by design: `DELETE /training/records/{id}`
  marks the record `cancelled` rather than removing it, so the correction stays
  auditable and the evidence behind the corrected entry stays with it.

There is also a load-bearing invariant worth restating: the delete path unlinks
a submission's attachment only because a submission is deletable in `draft`,
`pending_review` and `revision_requested` **alone** — never after approval,
which is the one state where a `TrainingRecord` also references the file. **If
that guard is widened, the delete must stop unlinking**, or an approved
member's evidence vanishes from their training history.

### ONBOARD-1 — the setup wizard's per-module configuration step is inert

Fifteen setup-wizard module cards point at a per-module "configure permissions"
step that **reports success and discards the answer**.
`modulePermissionConfigs` is written to the Zustand store and read by nothing —
no API client method submits it, no backend field corresponds to it. It is
CLAUDE.md **Pitfall #19** in its worst form, because the toast actively asserts
a save.

The Department Store's route was **removed rather than repaired**, deliberately:
the previous commit had added a `configRoute` for storefront "for parity with
its peers", and parity with a screen that changes nothing is a liability. The
remaining fifteen were left because wiring the step up means deciding whether it
edits the positions saved on the previous step or submits separately — its own
change, with its own data-model question. **Whichever way it resolves, the toast
goes first**: a step that silently does nothing is recoverable; one that claims
success is not.

Related and also open: three module ids offered by checkbox
(`medical_supplies`, `mobile`, `integrations`) grant permissions that do not
exist. Predates this window.

Full entry in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md).

### The equipment-check lap is built but unreferenced

`CheckLap.tsx`, `CheckItemControls.tsx` and `checkLapModel.ts` are complete and
tested; `grep` finds no importer outside their own test files. The live check
screen still renders the previous flat compartment list. Swapping it rewrites
that screen and the tests pinning its markup, which is a deliberate follow-up.
Until then the lap must not appear in a guide, a screenshot or a script as the
current member experience.

## Documentation and media disposition

### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).

**Two changes invalidate captures in bulk rather than individually:**

1. **The settings shell.** Nine settings screens moved onto one navigation
   idiom. Every existing capture of Organization, Events, Scheduling, Elections,
   User Settings or Email Templates settings shows an idiom that no longer
   exists — including at phone widths, where the section list is now a
   scrollable tab strip.
2. **The email notification shell.** Every screenshot or B-roll frame of a
   received Logbook email predates the 5px accent rule and status chip. Note
   the rollout caveat when re-shooting: a department that has not pressed
   **Reset** on a template still receives the old shell, so both are current
   depending on the department.

| Image area                                                     | Disposition               | Why                                                                                                          |
| -------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Members / Training / Inventory / Events **admin page headers** | **REPLACE**               | All four now open with the shared frame: four metrics and a Needs attention queue above the tab bar          |
| Any **settings** screen                                        | **REPLACE**               | One shell, one idiom, on all nine                                                                            |
| Any **received email**                                         | **REPLACE**               | New shell; caption whether the department has adopted it                                                     |
| `/scheduling` **Schedule tab**, desktop and phone              | **REPLACE**               | Board with status chips and a day panel, not a grid of cards                                                 |
| `/store` catalog, checkout, My Orders                          | **REPLACE**               | Redesigned; `/store/checkout` is a new route                                                                 |
| `/training/submit`                                             | **REPLACE**               | Rebuilt around four things members named; certificate now attaches inline                                    |
| `/admin-hours` personal view                                   | **REPLACE**               | Six-tile grid gone; period selector, three stats, requirement progress, category breakdown                   |
| `/events` list                                                 | **REPLACE**               | Ranked, with a **Needs you** band                                                                            |
| Member profile                                                 | **REPLACE**               | Assigned Inventory is absent for viewers without `inventory.manage` — caption the capturing account's grants |
| Equipment check **template builder**                           | **REPLACE**               | Four item types with what each stores named beside it; sealed-container flag                                 |
| Dashboard                                                      | **REPLACE**               | Seven scheduling staffing tiles                                                                              |
| `/members/check-in-station`                                    | **NEW**                   | Screen has never been captured                                                                               |
| Member profile → **ID Cards** panel                            | **NEW**                   | New panel                                                                                                    |
| Settings → **Label Printers**                                  | **NEW**                   | New section                                                                                                  |
| Check form **seal panel**                                      | **NEW**                   | New control                                                                                                  |
| Standing shift modal, give-up modal, phone day sheet           | **NEW**                   | New dialogs                                                                                                  |
| Admin **metrics settings** screen                              | **NEW**                   | New configuration screen                                                                                     |
| Live equipment **check screen**                                | **DO NOT CAPTURE AS NEW** | The lap is not wired; the screen is unchanged                                                                |

### YouTube script beats

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary of this window's disposition:

- **03 — IT Manager / System Admin.** New head `e7a41b6d09c2`, twelve
  revisions, one non-reversible (`c3f81a4d5e72`). Needs a new chapter on label
  printers, whose reachability question is squarely this script's audience.
- **04 — Fire Chief / Leadership.** The admin-page frame is the chief's daily
  view; the metric-choice scope rule (department default vs. personal) is the
  beat.
- **05 / 16 — Training Officer.** Submit External Training is rebuilt, and the
  certificate now attaches inline. Any take walking the old two-step upload is
  **wrong**, not merely stale.
- **06 — Member Guide.** Scheduling board, `/events` ranking, My Admin Hours,
  the storefront and NFC tap-in are all member-facing and all changed.
- **07 — Secretary / Administrative.** Email Templates and the notification
  shell.
- **13 — Department Store.** Previously "not affected"; the storefront is now
  redesigned end to end. **Reshoot.**
- **08 — Quick Tips & Shorts.** Four new shorts available: tap-in at the
  station, claim a shift in one tap, a sealed drug bag, printing the shift
  roster.

**Do not script the equipment-check lap.** It is built, tested and unreachable.

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = e7a41b6d09c2
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```
