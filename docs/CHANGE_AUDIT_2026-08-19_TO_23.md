# Change audit: August 19–23, 2026

Net changes merged to `main` in the 4 days ending 2026-08-23 12:38 EDT
(merge `630b4769`, PR #1723), picking up where the
[August 17–19 audit](./CHANGE_AUDIT_2026-08-17_TO_19.md) stopped at
`2777e004` (PR #1571, 2026-08-19 18:04 EDT).

**147 pull requests.** Eight schema migrations, one new module
(Governance → Legal Documents), a new dashboard widget layer, an
equipment-check rewrite that made shift submissions atomic and idempotent,
a breaking pagination change on two scheduling endpoints, an app-wide
mobile overlay repair, and a run of migration-history reconciliations for
revision-id collisions that had been silently skipping upgrades.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 19–23 section). Wiki handoff:
[`Recent-Changes-2026-08-19-to-23`](../wiki/Recent-Changes-2026-08-19-to-23.md).
Media disposition — which screenshots are now wrong and which YouTube takes
need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

## Release map

| Area                                            | PRs                                             | Pages / connection points                                                                                | API / data points                                                                                                                                                                                                                                                                                          | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governance — Legal Documents                    | #1579, #1584                                    | `/governance/legal` (**new**); the public `/privacy` and `/terms` render what it publishes               | New table `legal_document_revisions`; new permissions `legal.propose`, `legal.publish`; `GET /legal-documents` (overview), `POST /legal-documents/revisions`, `PUT`/`DELETE …/revisions/{id}`, `POST …/revisions/{id}/publish`, `POST /legal-documents/{document_type}/revert-to-default`                  | Live text stays in `organizations.settings["legal"]` — that is what the **anonymous** public endpoint reads, with no join. The table is the governance record _around_ it. Proposing and publishing are **separate grants**: `legal.propose` cannot publish. At most one `published` revision per document type per org. Archived rows are never deleted, because the question a records request asks is what the notice said _on a given date_. `change_note` is required at the schema layer — the point of proposing rather than editing in place is that someone later can see why                                                                                                                                                                                                |
| Dashboard — widget layer                        | #1687, #1662, #1659, #1654                      | `/dashboard`; Chief operations dashboard; Organization dashboard asset widgets; training-officer widgets | `GET /dashboard/widgets?period=`, `GET /dashboard/operations`, `GET /dashboard/asset-widgets` (**all new**); `dashboard_widget_service.py`; `widgetRegistry.ts`, `chiefWidgetRegistry.ts`, `AssetWidgetRegistry.tsx`                                                                                       | Every section is permission-gated **and** module-gated independently. A missing section is deliberately indistinguishable from an empty one — callers cannot probe for access. `settings.manage` is intentionally **not** financial access: money needs `finance.manage`, fundraising `fundraising.view` + the `grants` module, outreach `events.manage`. Asset widgets return **counts and fixed links only**, so facility codes, accounts, budgets and leases cannot leak through a general dashboard endpoint. Training-officer widget choices live in `localStorage` under `training-officer-dashboard.widgets.v1`, separate from the member-facing dashboard. **See [DASH-1](#dash-1--the-main-widget-registry-is-mostly-unread) — most of `DASHBOARD_WIDGETS` has no reader** |
| Equipment checks — atomic & idempotent          | #1654, #1659, #1662, #1710, #1719, #1643, #1641 | Shift detail → equipment check; equipment template builder; compartment tree                             | New table `equipment_check_bulk_requests`; new column `shift_equipment_checks.client_submission_id`; new constraints `uq_shift_equipment_check_shift_template`, `uq_shift_equipment_check_client_submission`; `check_items.compartment_path` widened `VARCHAR(200)` → `TEXT`; `equipmentCheckHierarchy.ts` | One check per `(shift_id, template_id)` is now a **database** rule, not a UI convention. The client mints `client_submission_id` before sending, so a retry from a queued offline submission resolves to the same row instead of a second one. Bulk item creation is keyed on `(compartment_id, idempotency_key)` with a `payload_hash`, so a retry with the _same_ key but different content is rejected rather than silently accepted. Compartment parents are cycle-checked. Standalone checks now require `equipment_check.manage`. Expired-equipment failures are **derived**, not stored                                                                                                                                                                                      |
| Scheduling — request pagination                 | #1632                                           | Scheduling → Requests tab                                                                                | `GET /scheduling/swap-requests` and `GET /scheduling/time-off` now return `{items, total, skip, limit}` — **previously a bare array**                                                                                                                                                                      | **Breaking response-shape change.** Any integration or script reading these two endpoints as a list breaks. `ShiftSwapRequestsPage` / `ShiftTimeOffRequestsPage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Scheduling — separation of duties               | #1636, #1638                                    | Requests tab; swap and time-off review                                                                   | `scheduling_service.py` review paths                                                                                                                                                                                                                                                                       | A requester cannot review their own swap or time-off request, **even holding `scheduling.manage`** — a permission grant is not a second person. Scheduling requests are restricted to their participants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Mobile — overlays and the bottom bar            | #1597, #1611, #1622, #1630, #1633, #1645        | Every dialog, drawer and bottom sheet on a phone                                                         | New hook `useOverlaySurface`; `modal-panel-scroll` utility; `--bottom-nav-height` custom property; `dialogScrollIntegrity.test.ts`                                                                                                                                                                         | The bottom nav is `fixed bottom-0 z-50` and `AppLayout` renders it _after_ page content, so at equal z-index it painted **over** dialogs. Measured at 390×844 a taller-than-viewport dialog buried its action row 40px behind the bar; on a notched phone even `max-h-[90dvh]` lost 32px. `elementFromPoint` returned the nav, so buttons were **untappable, not merely clipped**, and the tap navigated the page out from under the dialog. `useOverlaySurface` is deliberately a **separate stack** from `useDialog`'s `openDialogs`, which owns Escape routing and the scroll lock — a drawer that only wants the bar out of the way must not be able to strand that lock                                                                                                        |
| Navigation — page titles                        | #1592, #1593                                    | Every route: authenticated, public, onboarding, sign-in                                                  | `RouteTitleManager.tsx`                                                                                                                                                                                                                                                                                    | Derives the tab title from the page's visible `h1`, including headings that arrive after an async load. The old title is cleared **immediately** on navigation, so a slow or heading-less destination never masquerades as the page just left. Deliberately independent of `requestAnimationFrame` — browsers throttle animation frames in background tabs, which is exactly where a correct title matters most                                                                                                                                                                                                                                                                                                                                                                     |
| Events — recruitment type & prospect provenance | #1583, #1588, #1590                             | Events (type picker); membership pipeline board; event detail                                            | New `EventType.RECRUITMENT`; prospect source filtering                                                                                                                                                                                                                                                     | `recruitment` is appended **after** `other`, not placed beside the outward-facing types where it reads better: MySQL stores an ENUM as the member's **ordinal**, so inserting mid-list would silently reassign the type of every event already stored. New recruitment events default to guest sign-in so the pipeline actually receives applicants                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Security fixes                                  | #1581, #1591, #1598, #1570, #1600, #1626        | Exports, vendor links, error details, logging, elections                                                 | `utils/csv.ts` single escaper; vendor URL scheme validation; URL redaction in copied error details; Sentry/Loguru sink hardening                                                                                                                                                                           | See [Security fixes](#security-fixes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Migration history reconciliation                | #1596, #1602, #1607, #1625                      | —                                                                                                        | `7ed8593bc904`, `5c2f6a8b1d34`, `9f6d1c2a4b70`                                                                                                                                                                                                                                                             | Three revision-id collisions meant databases upgraded during specific windows carry a **valid stamp for a migration that never ran**. The stamp cannot distinguish the two histories, so the fix repeats the idempotent work downstream. No-op on a healthy database                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PWA / offline                                   | #1588, #1621                                    | Installed app, offline launch                                                                            | Transitive chunk precaching                                                                                                                                                                                                                                                                                | An offline launch previously failed when a lazily-imported chunk was not precached — the app installed, then would not start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Alembic route (upgrade data path)

Eight revisions this window. **Current head: `a17c4e9d2b61`.** Confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting
this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) deliberately
does not declare a head in prose, for the reason recorded there.

| Revision       | Revises        | What it does                                                                                                                            |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `1eeb053d59b7` | `2827079fd66c` | Normalizes `shifts.positions`, `shift_templates.positions`, `basic_apparatus.positions` to one canonical seat-list shape                |
| `7ed8593bc904` | `1eeb053d59b7` | Repeats the storage-area barcode backfill skipped by a revision-id collision                                                            |
| `5c2f6a8b1d34` | `7ed8593bc904` | Creates `push_subscriptions` when a collision skipped it                                                                                |
| `d6f4a13c9e20` | `7ed8593bc904` | Widens `check_items.compartment_path`                                                                                                   |
| `9f6d1c2a4b70` | `7ed8593bc904` | Makes `documents.file_name` / `file_path` nullable on already-upgraded databases                                                        |
| `4c8d7e2a91b3` | `9f6d1c2a4b70` | Widens `check_items.compartment_path` (**see note below**)                                                                              |
| `06adc68a8b84` | `4c8d7e2a91b3` | Adds `legal_document_revisions` + the `legal.propose` / `legal.publish` grants                                                          |
| `5223a69474b8` | `4c8d7e2a91b3` | Appends the `recruitment` event type                                                                                                    |
| `8a4f2d1c9b30` | `4c8d7e2a91b3` | Adds `equipment_check_bulk_requests`                                                                                                    |
| `9bb38ab9b052` | _(merge of 5)_ | Rejoins `06adc68a8b84`, `5223a69474b8`, `5c2f6a8b1d34`, `d6f4a13c9e20`, `8a4f2d1c9b30`                                                  |
| `a17c4e9d2b61` | `9bb38ab9b052` | Unique `(shift_id, template_id)` and `(organization_id, client_submission_id)` on `shift_equipment_checks`; adds `client_submission_id` |

> **`d6f4a13c9e20` and `4c8d7e2a91b3` are the same migration twice.** Both
> widen `check_items.compartment_path` from `VARCHAR(200)` to `TEXT`, on
> two different parents, and both are reachable — `d6f4a13c9e20` through the
> `9bb38ab9b052` merge, `4c8d7e2a91b3` through the chain beneath it. The
> second application is a no-op on a column already `TEXT`, so this is
> harmless in practice and not worth a corrective migration; it is recorded
> here because the duplicate looks like an error when read cold, and because
> its `downgrade()` narrows the column back to `VARCHAR(200)` — **a
> downgrade past both will truncate deep compartment paths.** Tracked as
> [SCHEMA-1](./KNOWN_LIMITATIONS.md).

### Reversibility

Two of these do **not** round-trip cleanly, and both say so in their own
docstrings:

- **`1eeb053d59b7`** (seat lists) expands a legacy `count` into that many
  seats. Collapsing it back would cut a three-firefighter template to one,
  permanently. There is no downgrade that restores the original.
- **`a17c4e9d2b61`** (unique checks) detaches historical duplicate rows by
  nulling their `shift_id` and appending an explanatory note. It keeps one
  canonical row per `(shift_id, template_id)`, preferring a completed row
  and then the earliest check. **Item snapshots are retained** — no safety
  record is deleted. The downgrade drops the constraints but cannot
  re-associate the detached rows: a later check may now own the slot.

## New data model

### `legal_document_revisions` — governance record for the public notices

| Column                      | Type                 | Notes                                                                                                                                                          |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | VARCHAR(36) PK       |                                                                                                                                                                |
| `organization_id`           | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`                                                                                                                    |
| `document_type`             | ENUM                 | `privacy_policy` \| `terms_of_service`                                                                                                                         |
| `status`                    | ENUM                 | `draft` \| `published` \| `archived`, default `draft`                                                                                                          |
| `body`                      | TEXT NOT NULL        | The proposed wording                                                                                                                                           |
| `change_note`               | TEXT NOT NULL        | The bylaw, SOP, statute or counsel note behind it. Required **at the schema layer**                                                                            |
| `effective_date`            | VARCHAR(64) NULL     | Shown to the public as "Last updated". **Free text, never parsed** — departments date policies however their records officer does (`March 3, 2026`, `FY26-Q1`) |
| `created_by`                | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL` (nullable per pitfall #2)                                                                                                 |
| `published_by`              | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL`                                                                                                                           |
| `published_at`              | DATETIME(tz) NULL    |                                                                                                                                                                |
| `created_at` / `updated_at` | DATETIME(tz)         |                                                                                                                                                                |

Index: `ix_legal_revisions_org_type_status (organization_id, document_type,
status)`.

`SET NULL` on both user references is deliberate: the wording published on a
date is a department record and **outlives the account that drafted it**.

`DRAFT` is a proposal and is **not public**. `PUBLISHED` is what `/privacy`
or `/terms` currently serves — at most one per document type per
organization. `ARCHIVED` is a revision that was published and replaced, or
a draft that was superseded; archived rows are kept, never deleted.

**The live text is not in this table.** It stays in
`organizations.settings["legal"]`, because the anonymous public endpoint
must read it without a join and without auth.

**Edge case — clearing the effective date.** Emptying the "Last updated"
box on a draft has to persist as a cleared value, not as an omitted key.
This is [pitfall #1's update-path half](../CLAUDE.md): the update payload is
`model_dump(exclude_unset=True)`, so `|| undefined` would drop the key and
the old date would survive behind a success toast. The field uses
`blankToNull`, so the clear reaches the column as an explicit `null`.

### `equipment_check_bulk_requests` — idempotency ledger

| Column            | Type                  | Notes                                                     |
| ----------------- | --------------------- | --------------------------------------------------------- |
| `id`              | VARCHAR(36) PK        |                                                           |
| `organization_id` | VARCHAR(36) NOT NULL  | FK → `organizations.id` `ON DELETE CASCADE`               |
| `compartment_id`  | VARCHAR(36) NOT NULL  | FK → `check_template_compartments.id` `ON DELETE CASCADE` |
| `idempotency_key` | VARCHAR(200) NOT NULL | Client-supplied                                           |
| `payload_hash`    | VARCHAR(64) NOT NULL  | Guards key reuse with different content                   |
| `item_ids`        | JSON NOT NULL         | What the original request created, replayed on retry      |
| `created_at`      | DATETIME(tz)          |                                                           |

Unique index on `(compartment_id, idempotency_key)`. A retry with the same
key and same payload replays `item_ids`; **the same key with a different
payload is rejected** rather than quietly creating a second set of items.

### `shift_equipment_checks.client_submission_id`

VARCHAR(100) NULL, unique per `(organization_id, client_submission_id)`.
Minted **on the client before the request leaves the phone**, which is what
makes a queued offline submission safe to retry: the retry resolves to the
row the first attempt created rather than adding a second check.

## End-to-end data paths and sharing boundaries

**Publishing a privacy notice.**
Secretary opens `/governance/legal` → drafts a revision (`POST
/legal-documents/revisions`, needs `legal.propose`) → a second person holding
`legal.publish` calls `POST …/{id}/publish` → the service writes the body
into `organizations.settings["legal"]` and flips the prior published row to
`archived` → anonymous `GET /privacy` reads `settings["legal"]` directly.
The revision table is never read by the public path.

**An offline equipment check.**
Phone mints `client_submission_id` → submission queued in the browser while
offline → on reconnect the queue replays → `uq_shift_equipment_check_client_submission`
resolves the retry to the existing row → item snapshots and photos attach to
that one check. Photo uploads carry their own queued ids, repaired this
window so a retried photo no longer lands against the wrong check.

**A dashboard widget request.**
`GET /dashboard/operations` → resolves the caller's org and timezone →
loads `enabled_modules` → for each section, tests **both** the module flag
and `OPERATIONS_SECTION_PERMISSIONS[section]` → omits the section entirely
if either fails. Every statement includes the tenant id. The response
carries counts and oldest-item ages, not records.

`OPERATIONS_SECTION_PERMISSIONS`:

| Section                  | Requires (any of)                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `operational_readiness`  | `scheduling.manage`                                                                                        |
| `critical_exceptions`    | `meetings.manage`, `minutes.manage`, `scheduling.manage`, `equipment_check.manage`, `notifications.manage` |
| `membership_health`      | `members.manage`                                                                                           |
| `upcoming_command_dates` | `events.manage`                                                                                            |
| `period_trends`          | `training.manage`                                                                                          |
| `pending_approvals`      | `admin_hours.manage`                                                                                       |

`GET /dashboard/widgets` accepts `period` ∈ `month | quarter | year |
rolling_30` and returns `finance` only with `finance.manage`, `fundraising`
only with the `grants` module **and** `fundraising.view`, `community` only
with `events.manage`. Any of the three may be `null`, and a `null` section
is not distinguishable from an empty one.

## Security fixes

- **CSV exports behind one escaper.** The events page had two export paths
  and only one was converted, so bulk "Export CSV" still built rows by hand.
  The event attendance export quote-escaped **only** the notes column — a
  member named `Smith, John` shifted every column after it. The reports
  module quoted values without neutralizing them. Consolidating onto
  `utils/csv.ts` then exposed three defects in the surviving implementation:
  `'=+@-'.includes('')` is `true`, so **every empty cell got a stray
  apostrophe**; whitespace was skipped before testing in one copy and not
  the other, so each caught a leading formula the other missed (both rules
  now apply — a leading tab or CR triggers on the raw first character,
  `=+@-` on the first non-whitespace one); and cells were quoted
  unconditionally, which broke the member-import error report that people
  correct and re-upload. See [pitfall #15](../CLAUDE.md).
- **Stored XSS in vendor website links** — vendor URL schemes are validated,
  so a `javascript:` href can no longer be stored and rendered.
- **URL redaction in copied error details** — the "copy error details"
  control could carry tokens embedded in URLs onto the clipboard and into a
  support ticket.
- **Sentry / Loguru sink hardening** and disabled sensitive exception
  diagnostics — exception context could reach logs in production.
- **In-flight request isolation by session** — request deduplication could
  hand one session's in-flight response to another.
- **Serialized public election ballot writes** — concurrent public ballot
  submissions could interleave.
- **Screenshot service log directory** permissions tightened.

## Known limitations opened this window

### DASH-1 — the main widget registry is mostly unread

`frontend/src/components/dashboard/widgetRegistry.ts` declares eight widgets
with a `permission`, an `aggregatePath` and a `queuePath`. **Only one of
them — `department-setup` — is read by anything**, via
`dashboardWidget('department-setup')` in `OrganizationSetupWidget.tsx`. The
other seven entries are exported, tested against themselves, and consumed by
no screen.

Five of the eight `aggregatePath` values have **no backend endpoint at all**:

| `aggregatePath`                           | Backend endpoint exists? |
| ----------------------------------------- | ------------------------ |
| `/membership-pipeline/widget-summary`     | ✅ yes                   |
| `/users/leaves-of-absence/widget-summary` | ✅ yes                   |
| `/organizations/setup-checklist`          | ✅ yes                   |
| `/onboarding/widget-summary`              | ❌ no                    |
| `/users/status/widget-summary`            | ❌ no                    |
| `/admin-hours/widget-summary`             | ❌ no                    |
| `/meetings/widget-summary`                | ❌ no                    |
| `/messages/widget-summary`                | ❌ no                    |

This is [pitfall #19](../CLAUDE.md) in its milder form — a declaration
without a reader. Nothing is broken today, because nothing fetches those
paths. The risk is the next contributor wiring a widget to the registry and
getting a 404 from a path that looks authoritative because it sits in a file
called a registry. Either wire the readers or mark the unwired entries in
the file itself.

### SCHEMA-1 — duplicate `compartment_path` widening

`d6f4a13c9e20` and `4c8d7e2a91b3` both widen `check_items.compartment_path`
to `TEXT` on different parents; both are reachable. Re-application is a
no-op, but **a downgrade past both narrows the column back to
`VARCHAR(200)` and will truncate deep compartment paths.**

## Documentation and media disposition

### Screenshots needing replacement

Full detail and the per-image queue is in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
Summary of what this window invalidated:

| Image area                                                                    | Why it is now wrong                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Any phone screenshot showing a **dialog with its action row near the bottom** | The bottom nav now hides while an overlay is open. Every such shot was taken with the bar painted over the dialog — the exact defect that was fixed. Reshoot |
| **Events page on a phone**                                                    | Cut down to what fits; toolbars no longer stack                                                                                                              |
| **Equipment check / template builder**                                        | Compartment tree, responsive builder actions, and mobile template actions all changed                                                                        |
| **Scheduling → Requests tab**                                                 | Now paginated — a shot of an unbounded list is wrong                                                                                                         |
| **Any browser-chrome shot showing the tab title**                             | Tab titles were generic before this window and are page-specific now                                                                                         |
| **Dashboard**                                                                 | New widget rows for chief / asset / training-officer views                                                                                                   |
| Events **type picker**                                                        | Gains **Recruitment**                                                                                                                                        |

### YouTube script beats needing rewrite

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
The material items:

- **03 — IT Manager / System Admin.** The upgrade chapter must state the new
  head and the two non-reversible migrations. A viewer who downgrades past
  `1eeb053d59b7` loses seat counts permanently; that cannot be left to a
  card.
- **04 — Fire Chief / Leadership.** Gains Governance → Legal Documents, and
  the propose/publish split is the whole point of the beat — a chief who
  hears "you can edit your privacy notice" and not "publishing is a separate
  grant" has learned the feature backwards.
- **06 — Member Guide.** Any take showing a dialog on a phone was filmed
  against the old, broken bottom bar.
- **07 — Secretary / Administrative.** Legal Documents is a secretary
  workflow; new chapter.
- **08 — Quick Tips & Shorts.** Candidate short on the offline equipment
  check now that retries are safe.

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = a17c4e9d2b61
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

All five were green at `630b4769`.
