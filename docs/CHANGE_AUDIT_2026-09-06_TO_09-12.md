# Change audit: September 6 – 12, 2026

Net changes merged to `main` in the six days ending 2026-09-12, picking up
where the [August 31 – September 6 audit](./CHANGE_AUDIT_2026-08-31_TO_09-06.md)
stopped at `14c43813` (2026-09-06 02:26 UTC).

**139 pull requests (#2251 – #2492).** Twelve schema migrations, head
`0533644945cd`. **No module changed address and no URL was retired** — the
opposite of last window, and worth saying first, because the last audit's
headline was fourteen broken addresses. Everything new here is _additive_:
seven new routes, all of them reachable from a hub card or the nav.

The window has one dominant theme and several small ones. The dominant theme
is **first-run setup**: the wizard was reordered, given a screen that says what
it will ask for before it starts asking, and taught three things a department
could previously only answer after setup was over — its rank ladder, its
membership tier ladder, and how it numbers members. The small ones are an
inventory items list that a quartermaster can now shape, a members
administration settings screen that collects five scattered settings, and a
run of ninety security-review commits across thirty-four features.

**Three changes alter what an existing department sees or may do without
anyone asking for it**, and they are the ones to read before upgrading:
the Treasurer gains two finance permissions, property-return reports stop
being readable by the whole department, and departments with a published
event-request form get a flag set to match what that form was already doing.

Companion operator lesson: the **September 6–12** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-09-06-to-09-12`](../wiki/Recent-Changes-2026-09-06-to-09-12.md).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

## Read this first

Four things in this window change what an operator or an officer must do,
rather than only what they see:

1. **The Treasurer gains `finance.approve` and `finance.configure_approvals`.**
   No seeded position held either, and only `it_manager` could reach them —
   through its `*` wildcard, so the IT administrator rather than a finance
   role. The practical cost was a department that built an approval chain and
   then had every submitted request land in `PENDING_APPROVAL` with nobody
   able to action it. **The grant is gated**, not unconditional: it applies
   only where the position's finance grants are exactly
   `{finance.view, finance.manage}` — the shape the registry seeded. A
   deliberately curated Treasurer holding any other finance shape is left
   alone. Granting approve does **not** enable self-approval;
   `FinanceService.approve_step` still refuses it whoever holds the
   permission. See [Permission and grant
   movements](#permission-and-grant-movements).

2. **Property-return reports were readable by every holder of
   `documents.view`, and are not any more.** They were filed into the
   `Reports` system folder, which carries `organization` visibility, while
   naming a departed member, quoting the reason for the separation —
   involuntary ones included — and printing their home address. They now file
   into a leadership-only `member-separations` folder, and migration
   `b1e7c3a92f45` moves the reports already written and creates the folder for
   organizations whose system folders were already initialised. **The
   downgrade restores the disclosure along with the schema**, so it is for a
   rollback, not a decision to undo.

3. **Departments with a published public event-request form are now marked as
   accepting public event requests.** `accept_public_requests` shipped read by
   only one of the two intake paths: the API endpoint honoured it, the Forms
   path — the one the department's own "Generate Event Request Form" button
   produces — never looked at it. The same change makes the Forms path honour
   the flag, which would have silently stopped community requests arriving at
   every installation with a published form, toggle showing off and no error
   anywhere. Migration `d19b2c2ae9b9` writes down what was already true.
   **It sets the flag unconditionally for those organizations rather than only
   where the key is absent** — a stored `false` cannot have meant "do not take
   requests from my published form", because the toggle never controlled that
   form. Organizations with no such form keep the shipped default of `false`.

4. **Navigation layout is now a department setting and every member gets the
   default on the first load after upgrading.** Setup always asked whether the
   department wanted navigation across the top or down the side; the answer
   reached only the browser that gave it, because the wizard wrote
   `localStorage` and the copy sent to the server was read by nothing. The
   answer is now stored on the organization and applies to everyone. An
   existing installation has no stored layout, so **everyone — including the
   officer whose browser held `top` — gets `left`**. Nothing was migrated
   because the old value was not reachable from the server. Set it once at
   **Settings → General → Profile → Navigation Layout**. This is the one
   item in this window already carried in
   [`UPGRADING.md`](./UPGRADING.md#changes-you-will-notice-after-an-upgrade).

## Release map

| Theme                      | What moved                                                                                                                                                                                         | Where it is documented                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **First-run setup**        | Wizard reordered; `/onboarding/prepare` added; rank ladder, tier ladder and member numbering collected during setup; permission rows filtered to enabled modules; a lapsed session stays resumable | [`ONBOARDING_FLOW.md`](./ONBOARDING_FLOW.md), [`wiki/Onboarding.md`](../wiki/Onboarding.md)                                         |
| **Members administration** | New settings screen at `/members/admin/settings` with five sections, each its own route                                                                                                            | [`training/08-admin-reports.md`](./training/08-admin-reports.md), [`wiki/Administration-Pages.md`](../wiki/Administration-Pages.md) |
| **Inventory items list**   | Per-member pinning, group-by-any-attribute, size variants folded into one expandable row, multi-axis garment style, member fit preference                                                          | [`wiki/Module-Inventory.md`](../wiki/Module-Inventory.md), [`training/05-inventory.md`](./training/05-inventory.md)                 |
| **Scheduling**             | Close-out queue at `/scheduling/admin/closeout`; call entry gated on the department's call-tracking mode                                                                                           | [`SCHEDULING_MODULE.md`](./SCHEDULING_MODULE.md)                                                                                    |
| **Membership pipeline**    | A coordinator can place an applicant on a stage; stage `sort_order` made unique; switching pipelines drops the old pipeline's applicants                                                           | [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md)                                                                  |
| **Events**                 | Public request intake honours `accept_public_requests` on both paths; off-list preference values settled                                                                                           | [migrations](#alembic-route-upgrade-data-path)                                                                                      |
| **Finance**                | Treasurer gains approval permissions                                                                                                                                                               | [Permission movements](#permission-and-grant-movements)                                                                             |
| **Documents**              | Property-return reports filed leadership-only                                                                                                                                                      | [Read this first](#read-this-first)                                                                                                 |
| **Security review**        | 90 commits across 34 features; rotation reached Feature 23 (Medical supplies)                                                                                                                      | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                                      |
| **Mobile accessibility**   | New `mobile-accessibility.spec.ts` and `mobile-dialogs.spec.ts`; AA contrast asserted at zero findings, AAA-only findings ratcheted per route                                                      | [`MOBILE_ACCESSIBILITY_REVIEW_2026-09-07.md`](./MOBILE_ACCESSIBILITY_REVIEW_2026-09-07.md)                                          |

## New URLs

Seven routes were added. **None replaces an address that stopped working**, so
unlike last window there is no bookmark to repair.

| Route                                | Screen                                                | Permission                                                                                |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/onboarding/prepare`                | Setup Prerequisites — what setup will ask for         | none (pre-auth, first run only)                                                           |
| `/members/admin/settings`            | Members settings hub (redirects to the first section) | `members.manage`                                                                          |
| `/members/admin/settings/visibility` | Contact Visibility                                    | `settings.manage`, `settings.manage_contact_visibility` or `organization.update_settings` |
| `/members/admin/settings/ids`        | Membership IDs                                        | `settings.edit` or `organization.update_settings`                                         |
| `/members/admin/settings/ranks`      | Operational Ranks                                     | `settings.manage` or `members.manage`                                                     |
| `/members/admin/settings/tiers`      | Membership Tiers                                      | `members.manage`                                                                          |
| `/members/admin/settings/evoc`       | EVOC Levels                                           | `apparatus.manage`                                                                        |
| `/scheduling/admin/closeout`         | Shift close-out queue                                 | `scheduling.manage`                                                                       |

**The per-section permissions are the endpoint's, not the hub's**, and that is
deliberate. Every route under `/members/admin` stands on `members.manage`, but
neither Contact Visibility nor Membership IDs saves through an endpoint that
accepts it. Gating them on the hub's grant would put a members officer on a
page where every toggle 403s. Operational Ranks accepts `members.manage`
because the ladder moved here and its gate moved with it; **EVOC deliberately
did not** — it is served by the apparatus API, and widening that was not part
of the move.

### Redirected, not retired

`/onboarding/modules/:moduleId/config` no longer renders a configuration
template; it redirects to `/onboarding/modules`. The step it represented
reported success and saved nothing, so nothing is lost. A department that
picks SMTP has not reached a twelfth step — it is still on Email, which is why
the provider-configuration routes deliberately have no entry in
`ONBOARDING_STEPS`.

## The setup wizard was reordered

The order is now declared once, in
`frontend/src/modules/onboarding/config/steps.ts`. It previously lived in three
places that each restated it — the progress indicator, the route table, and a
hardcoded next-step path in all thirteen pages — and they drifted.

**Order now reflects what a department can answer**, rather than what the
system wants to store. Identity comes second so the rest of setup belongs to a
real account; what the department _uses_ comes before the _external
integrations_, which are the steps that send someone off to find credentials
and are all skippable.

| #   | Step                  | Path                            | Optional |
| --- | --------------------- | ------------------------------- | -------- |
| 1   | Organization Setup    | `/onboarding/start`             | no       |
| 2   | Administrator Account | `/onboarding/system-owner`      | no       |
| 3   | Modules               | `/onboarding/modules`           | yes      |
| 4   | Ranks & Positions     | `/onboarding/positions`         | yes      |
| 5   | Stations              | `/onboarding/stations`          | yes      |
| 6   | Apparatus             | `/onboarding/apparatus`         | yes      |
| 7   | IT & Backup Contacts  | `/onboarding/it-team`           | yes      |
| 8   | Email                 | `/onboarding/email-platform`    | yes      |
| 9   | File Storage          | `/onboarding/file-storage`      | yes      |
| 10  | Sign-In Method        | `/onboarding/authentication`    | yes      |
| 11  | Navigation Layout     | `/onboarding/navigation-choice` | yes      |

**Only steps 1 and 2 are genuinely required** — that is the backend's
`required_steps` in `OnboardingService.complete_onboarding`, and
`/onboarding/prepare` derives its two lists from the same `optional` flags, so
a step that changes its flag changes that screen with it.

Three things are now collected during setup that previously could only be
answered afterwards:

- **Member numbering**, in step 1. The counter only numbers members created
  after it is switched on, and the wizard creates the Administrator account in
  step 2 and the IT team in step 7. A department that answered this on a
  members screen afterwards ended up with its first accounts holding no number
  and the roster import starting at the number they should have had — an
  off-by-a-few nobody notices until a badge is printed.
- **The rank ladder**, in step 4, alongside positions. A rank may now confer a
  seat the department invented.
- **The membership tier ladder**, which has a screen in setup _and_ in
  Settings, sharing one editor.

Also in step 4: **permission rows are shown only for the modules in use.** The
checkboxes now grant permissions that exist, unticking a seeded position
removes it, and an unedited Continue no longer deletes most of the roster.

## Alembic route (upgrade data path)

Twelve revisions. Head moves `d7c1b95e2a40` → `0533644945cd`.

| Revision       | What it does                                                       | Reversible                               |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `b8e3f1a97c24` | `inventory_items.style_attributes` — the full canonical style list | yes (drops the column; `style` survives) |
| `c4f7a2e91b38` | `member_size_preferences.garment_fit`                              | yes                                      |
| `ee7390dcdf47` | Treasurer gains `finance.approve` + `finance.configure_approvals`  | yes                                      |
| `d3f8b6a24c91` | Merge of the garment-style and Treasurer heads                     | n/a                                      |
| `f2a91c7d4e86` | `inventory_item_pins` table                                        | yes (drops the table)                    |
| `b1e7c3a92f45` | Property-return reports → leadership-only folder                   | yes — **and it restores the disclosure** |
| `1603bd9c59e7` | Index `sessions.refresh_token`                                     | yes                                      |
| `a3f61c8d27b4` | Renumber `membership_pipeline_steps.sort_order` to be unique       | see below                                |
| `f1565c64b658` | `facility_emergency_contacts.company_name` nullable                | yes                                      |
| `c7e2a4b9d180` | Unique `(pipeline_id, sort_order)` on pipeline steps               | yes                                      |
| `d19b2c2ae9b9` | Backfill `accept_public_requests`                                  | see below                                |
| `0533644945cd` | Settle off-list event-request preference values                    | no                                       |

### Reversibility

Three revisions deserve more than a yes/no:

- **`b1e7c3a92f45` is reversible and you probably do not want to reverse it.**
  The downgrade moves the property-return reports back into `Reports` and drops
  the folders it created, restoring the prior state exactly — including the
  disclosure it exists to close. Reverse it for a schema rollback, not as a
  decision.

- **`0533644945cd` is not reversible**, and correctly so: it replaces
  unrecognised `date_flexibility`, `venue_preference` and
  `preferred_time_of_day` values with the canonical vocabulary, and the
  original free-text value is not recoverable. Its scope is deliberately
  narrow — **only values outside the vocabulary are replaced.** A
  `date_flexibility = 'specific_dates'` on a request that names no date is
  left alone, because the value renders correctly and the gate it walks past
  only ever ran at intake. `outreach_type` is deliberately untouched: it is
  per-organization configurable, so a value not in today's list may be a type
  the department genuinely offered and has since retired.

- **`a3f61c8d27b4` and `c7e2a4b9d180` are a pair**, and the order matters. The
  first densifies existing `sort_order` values; the second adds the unique
  constraint that keeps them that way. `sort_order` is not display order
  alone — "the next stage" is an index into the pipeline's steps sorted by it,
  so two steps sharing a value made both the board's column order and the
  destination of an advance depend on how the sort broke the tie, differently
  from one page load to the next. The index swap is written to work on MySQL
  8.0.

## Permission and grant movements

Two movements, and they pull in opposite directions from last window's six
revocations. **Nothing is revoked this window.**

| Movement                                                     | Who                     | Gated?                                                                           | Effect                                                                                        |
| ------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `finance.approve` + `finance.configure_approvals` **added**  | Treasurer               | **yes** — only where finance grants are exactly `{finance.view, finance.manage}` | The approval chain becomes actionable by a finance role rather than only the IT administrator |
| `members.manage` **accepted** by the operational rank ladder | any position holding it | n/a                                                                              | The ladder moved into Members Administration and its gate moved with it                       |

The Treasurer grant follows Pitfall #23's rule for an _addition_: it demands
positive evidence the row is an unrepaired seed, because an unconditional add
overrides a department's own decision. The gate is scoped to the **finance
subset** rather than the whole permission list on purpose — a whole-row
snapshot is pinned to the build that produced it, and adding a module anywhere
else in the registry would move a row across the test.

**What it costs when it is wrong, stated plainly:** an administrator who
deliberately curated the Treasurer to exactly `finance.view` + `finance.manage`
— meaning "no approval powers" — gets the two grants added, because nothing in
the row distinguishes that from the seed it is identical to. The cost of the
opposite choice is a department whose approval chain silently strands every
request.

## Documentation and media disposition

### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py` (**518 of 560 filled** as of this
audit).

**The inventory items-list captures are already done.** The 2026-09-07/08
disposition at the top of `SCREENSHOT_CURRENCY.md` covers pinning and grouping
and closed its own queue — five images re-shot, two added, one verified
byte-identical. Nothing below re-opens it.

**One change invalidates captures in bulk:** every capture of a department
running the **top** navigation layout. The setting is now server-side and
defaults to `left` for every existing installation, so a capture showing the
top bar no longer reflects what a member sees unless the department has set it.
Caption the layout on any re-shoot of a full-page frame.

| Image area                                                | Disposition | Why                                                                                  |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `/onboarding/prepare`                                     | **NEW**     | New screen; the two lists are the point — required vs optional                       |
| Onboarding progress indicator, new order                  | **REPLACE** | Any capture showing Stations at step 2 or System Owner at step 9 is wrong, not stale |
| `/onboarding/start` → member-numbering block              | **NEW**     | Never existed in step 1 before                                                       |
| `/onboarding/positions` → rank ladder editor              | **NEW**     | New in setup                                                                         |
| `/onboarding/positions` → module-filtered permission rows | **REPLACE** | The row list is shorter and depends on step 3's answers                              |
| Membership tier ladder (setup **and** Settings)           | **NEW**     | One editor, two hosts; capture both                                                  |
| `/members/admin/settings` hub                             | **NEW**     | New screen                                                                           |
| `/members/admin/settings/ranks`                           | **NEW**     | The ladder's new address                                                             |
| `/members/admin/settings/tiers`                           | **NEW**     | New section                                                                          |
| `/members/admin/settings/evoc`                            | **NEW**     | Never captured; note the `apparatus.manage` gate in the caption                      |
| `/members/admin/settings/visibility` and `/ids`           | **REPLACE** | Same settings, now on the shared settings frame                                      |
| `/scheduling/admin/closeout`                              | **NEW**     | New queue screen                                                                     |
| Shift panel → **Calls** log                               | **REPLACE** | Now hidden unless the department is on a call-tracking mode that has one             |
| Applicant board → place on a stage                        | **NEW**     | New coordinator action                                                               |
| Settings → General → Profile → **Navigation Layout**      | **NEW**     | The control the upgrade note sends operators to                                      |
| Any full-page frame shot with the **top** bar             | **REPLACE** | Default is now `left` for every existing department                                  |

Neither `/onboarding/prepare` nor `/scheduling/admin/closeout` has a
`scripts/screenshots/manifest.mjs` entry yet, and `/members/admin/settings`
has one. **Register the two missing routes before capturing** — a route with no
manifest entry is simply never shot, and unlike a _retired_ route it fails
silently by omission rather than by capturing the dashboard.

### YouTube script beats

Determinations are made by **reading the script files**, not by inferring from
this change list. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **02 — First-Time Setup & Onboarding.** **The most affected script in the
  series this window, and the walkthrough order is now wrong rather than
  stale.** A take that walks Organization → Stations → Apparatus → Navigation
  cannot be followed: the wizard asks for the Administrator account second and
  the layout last. Three new beats are required — the prerequisites screen, the
  member-numbering block in step 1, and the rank/tier ladders in step 4 — and
  the "optional" marking is now shown up front rather than discovered.
- **03 — IT Manager / System Admin.** New head `0533644945cd`, twelve
  revisions. Needs the Treasurer grant, the property-return folder change and
  the event-request backfill. **Say the navigation-layout default explicitly**:
  this script's audience is who gets asked "why does everyone's menu look
  different from mine".
- **04 — Fire Chief / Leadership.** The Treasurer can now action an approval
  chain; that is this script's material, not the IT script's. Also the
  property-return reports, which a chief is the intended reader of.
- **06 — Member Guide.** Light this window. The navigation layout may change
  under a member on upgrade; nothing else member-facing moved.
- **07 — Secretary / Administrative.** Members Administration → Settings is a
  new destination for two settings this script already covers at their old
  address.
- **08 — Quick Tips & Shorts.** Four new shorts available: pin your working set
  on the items list; group the items list by anything; set your rank ladder
  during setup; where the close-out queue lives.

**Do not script the crew Sweep, do not script qualification entry, and do not
script the equipment-check lap.** All three remain built and unreachable —
carried forward from the last two windows, unchanged.

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = 0533644945cd
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

All five were run clean against `ae78901` while writing this audit: migration
head `0533644945cd`, single head, no branch points, 443 revisions; 228 routes
checked with 0 errors and 0 warnings (17 redirects skipped); 1,489 documented
route handlers with 0 errors and 0 warnings; 352 Markdown files with 0 broken
links; 518 of 560 screenshot placeholders filled.
