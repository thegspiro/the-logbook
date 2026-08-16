# Six-day change and connection audit — 2026-08-10 through 2026-08-16

**Audit window:** 2026-08-10 00:00 UTC through 2026-08-16 (inclusive)
**Baseline:** `fddbdbc1e548d0e0f74811a358e6b507a7a96fd5` (last commit before the window)
**Audited head:** `3872361886779554ce3f0f081c455653c6c7e7e0`
**Volume:** 504 non-merge commits, 1,517 net changed paths, **28** Alembic
revisions, 5 new authenticated routes, **3** new models, 37 new endpoint
handlers in 1 new endpoint module plus existing ones.

This is the six-day rollup the release asked for. It **supersedes nothing** — it
is the wider frame around the
[three-day audit](./CHANGE_AUDIT_2026-08-12_TO_14.md), which remains the
authoritative record for 08-12 → 08-14 and holds the per-area connection map,
its 879-path manifest, and its own verification checklist. Read that document
for the middle of the window; read this one for the two days on either side of
it and for the cross-window views (routes, client storage, the full Alembic
route) that a three-day frame could not show.

> **What this pass actually added.** The 08-10 → 08-11 tranche was already in the
> CHANGELOG at the time of writing, and 08-12 → 08-14 had a dedicated audit. The
> genuinely undocumented material was **2026-08-15 → 08-16** (onboarding session
> storage, the root application canvas, one screenshot finding), plus four
> cross-window trackers that had drifted: the Alembic head banner, the page
> reference's missing routes, the onboarding storage description, and the
> public-page canvas troubleshooting entry. Those are corrected at their source
> and summarized here. Nothing in this document is a claim that a screen was
> photographed or a script was recorded — see
> [Documentation and media disposition](#documentation-and-media-disposition).

## Window at a glance

| Sub-window        | Character                                                                                                                                                                                                       | Where it is recorded                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **08-10 → 08-11** | Feature weight: the supply loop (shelf ↔ truck), the email footer library, the Learning Center, skills-testing print/return-for-correction, a phone-width sweep across every page, the split TypeScript install | CHANGELOG entries dated 08-10 / 08-11; this document's release map                       |
| **08-12 → 08-14** | Security, permissions, elections, dashboard split, storefront, QR, scheduling settings                                                                                                                          | [`CHANGE_AUDIT_2026-08-12_TO_14.md`](./CHANGE_AUDIT_2026-08-12_TO_14.md) — authoritative |
| **08-15 → 08-16** | Client-side hardening and one global style ownership move; no backend, schema, route, or permission change                                                                                                      | This document; CHANGELOG entry dated 2026-08-15                                          |

## 2026-08-15 → 08-16 in full

Two behavioral changes and one documentation finding. Both behavioral changes are
frontend-only: **no endpoint, schema, model, migration, or permission changed**,
so no upgrade step and no API contract movement accompanies them.

### Onboarding session identifiers are tab-scoped

`frontend/src/modules/onboarding/services/api-client.ts` moved the onboarding
session identifier from `localStorage` to `sessionStorage`.

| Item           | Before                                                            | After                                     |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Storage key    | `localStorage['onboarding_session_id']`                           | `sessionStorage['onboarding_session_id']` |
| Lifetime       | Until explicitly cleared — survived browser restarts indefinitely | Ends with the tab or the browser session  |
| Reach          | Every tab and window on the origin                                | The one tab that created it               |
| CSRF companion | `onboarding_csrf_token`, `SameSite=Strict` cookie (unchanged)     | unchanged                                 |
| Wizard answers | `localStorage['onboarding-storage']` (Zustand persist)            | **unchanged — still localStorage**        |

**Why it matters.** The identifier is a bearer credential: presented as
`X-Session-ID`, it authorizes the setup mutations that create the organization,
stations, apparatus, the IT team and the first System Owner. A bearer credential
that outlives the browser session on a shared or kiosk machine is a standing
grant to finish somebody else's installation.

**Connection points.** `X-Session-ID` header → `get_or_create_session()` /
`validate_session()` in `backend/app/api/v1/onboarding.py` → the
`onboarding_sessions` row. Server-side TTL is **30 minutes, sliding**
(`SESSION_EXPIRY_HOURS = 0.5`; every authenticated activity pushes `expires_at`
forward). The client change narrows the window the client keeps the identifier;
it does not change the server's.

**Legacy cleanup.** `loadSession()` deletes any `localStorage`-persisted
`onboarding_session_id` at construction, and `clearSession()` deletes both
locations. A browser that ran the previous build therefore drops its stale
identifier on the first page load of the new build, and `hasSession()` correctly
reports `false` rather than presenting an identifier the client no longer tracks.

**Edge cases — these are the ones to teach, not the mechanism:**

- **A second tab does not inherit the wizard.** Opening `/onboarding` in a fresh
  tab starts a _new_ server session; a step that requires an established session
  answers `401` with error code `ONBD_SESSION_INVALID`. (A _duplicated_ tab is
  the exception — Chrome and Firefox copy `sessionStorage` into a duplicate, so
  it does carry the identifier. Do not teach tab duplication as a supported
  resume path; it is browser behavior, not a product guarantee.)
- **Closing the browser mid-wizard ends the run.** The identifier is gone, and
  after 30 minutes of inactivity so is the server row.
- **The wizard can look resumable when it is not.** `onboarding-storage` is still
  `localStorage`, so re-opening `/onboarding` after a restart repaints the
  answers already typed. The next mutating step is the one that fails, with
  `ONBD_SESSION_INVALID`. Installers should be told to finish onboarding in one
  sitting, in one tab, and that re-typing answers is not the recovery — restarting
  the wizard is.
- **"Onboarding has already been completed" is a different failure.** Once an
  organization row exists, `get_or_create_session()` refuses new sessions with
  `403` / `ONBD_ALREADY_COMPLETED`. An installer who sees this has not lost a
  session; the install is done and they should sign in.
- **Reset Progress clears everything.** `ResetProgressButton` calls
  `sessionStorage.clear()`, so it takes the identifier with it by construction.

### The application canvas moved from `body` to `html`

`frontend/src/styles/index.css` now paints the themed gradient on the root
element and folds `scrollbar-gutter: stable` into the same rule.

The dark-mode surface tokens (`--surface-bg`, `--surface-secondary`) are
**translucent white** by design — they are built to composite over the gradient.
`scrollbar-gutter: stable` reserves its gutter on `html`, **outside the body
box**, so painting only `body` left that reserved strip showing the browser's
default canvas: a bright seam down the right edge of every page in dark mode.
Painting the gutter a solid fallback colour instead would have produced a
different seam beside the gradient. The root owns the canvas because the root
owns the gutter.

**Blast radius: every route, authenticated and public.** This is a global style
rule, which is precisely why it is a screenshot problem — see
[Documentation and media disposition](#documentation-and-media-disposition).

**Edge cases:**

- **Public routes were the original reason the canvas exists.** `/f/:slug`,
  ballot voting and `/application-status/:token` render outside `AppLayout`.
  Any new public route must use the gradient utility, not
  `bg-theme-surface-secondary` — that token is correct only inside `AppLayout`.
- **It silently broke the print pages' background contract — two defects, both
  fixed 2026-08-16.** CSS propagates a `body` background to the window **only**
  while the root's `background-image` is `none` and its `background-color` is
  `transparent`. Once `html` is painted, nothing on `body` propagates. **Six
  in-app print routes** (`print/template`, `print/scorecard`,
  `training/print/member`, `.../program`, `.../compliance`,
  `scheduling/shift-reports/print`) each carried their own
  `@media screen { body { background: #f3f4f6 } }` for a grey desk behind a
  white sheet, and that grey stopped reaching the canvas. Separately, the
  `@media print` reset covered `body, main, .dark` — and because `ThemeContext`
  puts `dark` on `document.documentElement`, **dark mode was covered by accident
  while light mode was not**, so printing with "Background graphics" on could put
  the gradient behind a scorecard or label. `InventoryBarcodePrintPage` and
  `LabelPrintPage` were never affected — they write into a fresh iframe.

  Fixed by `components/print/PrintPageStyles`, which all six routes now render:
  it marks the root so one `html.print-preview` rule beside the canvas rule
  supplies the desk, and `html` is now named in the print reset.
  `PrintPageStyles.test.tsx` guards all three invariants. **The duplication was
  the real defect** — six copies of a rule, none naming what they depended on.

- **`overscroll-behavior: none` stayed on `body`** — iOS bounce suppression is a
  body concern and was deliberately not moved.

### Screenshot finding, 08-16

`GET /training/programs/programs/{id}` returns phases with `name`,
`phase_number`, `prerequisite_phase_ids`, `requires_manual_advancement` and
`time_limit_days` — and **no requirements**. The per-phase fractions in
`01-membership.md:1282`'s caption ("Phase 1, Complete, 4/4") therefore cannot come
from the program detail screen; they belong to a member's enrolment view. Recorded
in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
Established from the API shape alone — the screen has not been opened yet.

## Routes added in this window

These five routes were live at the audited head. All were absent from
`APPLICATION_PAGES.md` until this pass; they are now listed in their module
sections there.

| Route                                      | Page                        | Gate                                                                           | Notes                                                                                                                                                                      |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/learning`                                | Learning Center             | **Authenticated**                                                              | In-app guide index; sits beside `/dashboard` inside `AppLayout`                                                                                                            |
| `/locations/qr-codes`                      | Check-In QR Codes           | `locations.manage` **OR** `facilities.manage`                                  | Search, print signs, PNG download, inline room QR; prefetched by `routePrefetch.ts`                                                                                        |
| `/scheduling/apparatus-inventory`          | Apparatus Inventory         | `equipment_check.submit` **OR** `equipment_check.view` **OR** `inventory.view` | Deliberately crew-level: recording what you just used is the point                                                                                                         |
| `/training/skills-testing/print/template`  | Blank skill sheet (print)   | **Authenticated**                                                              | Empty form, no member data; the backend's template fetch enforces visibility and org scope                                                                                 |
| `/training/skills-testing/print/scorecard` | Completed scorecard (print) | **Authenticated**                                                              | The backend redacts to the reader's disclosure level before the data leaves the server; gating on `training.manage` would instead block members printing their own results |

**The permission shape is the documentation.** Three of the five are
authenticated-only on purpose, and in two of those the real access control is
server-side redaction rather than a route gate. Documenting them as "open to
everyone" would be wrong; documenting them as officer-only would be equally
wrong and would send departments looking for a permission to grant.

## Models and data points

**Three** new models in the window. Only one of them arrived in a new file, which
is why a file-level count undercounts them — the other two were added to existing
domain modules:

| Model                                                                    | Table                       | Revision        | Purpose                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SchedulingModuleConfig` (new file `models/scheduling_module_config.py`) | `scheduling_module_configs` | `20260813_0010` | Per-organization shift settings, cached and keyed by org. Served by the window's one new endpoint module, `endpoints/scheduling_module_config.py`, at `/api/v1/scheduling/shift-settings` GET/PUT/DELETE — all three resolve the org from `current_user.organization_id`, never from client input |
| `CheckItemDeployedLot`                                                   | `check_item_deployed_lots`  | `20260810_0008` | One row per lot's presence on one checklist position — the record that makes "soonest expiration aboard" representable                                                                                                                                                                            |
| `SavedBallotTemplate`                                                    | `saved_ballot_templates`    | `20260812_0001` | Org-scoped reusable ballot **structure**; carries no candidates, rosters, votes, tokens, or attendance                                                                                                                                                                                            |

Across the window **37 new endpoint handlers** were added, the large majority on
existing routers rather than the one new module.

Columns and settings added across the window, grouped by the question they let a
user answer:

| Data point                                                                             | Revision                                                         | Question it answers                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `check_item_deployed_lots` (table)                                                     | `20260810_0008`                                                  | Which lots, with which dates, are on this position right now — and what is the _soonest_ date aboard                |
| `check_template_items.quantity_on_truck`                                               | `20260810_0007`                                                  | How many are actually aboard, as distinct from how many should be. **NULL means never counted**, not zero           |
| `check_template_items.restock_needed` + `restock_reported_by` / `_at` / `restock_note` | `20260810_0006`                                                  | Who used the last one, when, and what they said about it                                                            |
| `shift_equipment_check_items.expiration_found`                                         | `20260810_0005`                                                  | The replacement's expiration date, written back on submit — the missing counterpart to `serial_found` / `lot_found` |
| `email_templates` default-CSS tracking + `footer_key`                                  | `20260810_0003`, `_0004`                                         | Which footer a template uses, out of a library instead of 35 copies                                                 |
| optional equipment-kit items                                                           | `20260811_0001`                                                  | Which kit contents are required and which are optional                                                              |
| skill-test return trail; `resume_count`                                                | `20260811_0002`, `20260812_0002` (reconciled by `20260813_0007`) | Who returned a result for correction, and how many times a test was resumed                                         |
| `SavedBallotTemplate` (+ election settings)                                            | `20260812_0001`, `20260814_0002`                                 | Ballot _structure_ only — never candidates, rosters, votes, tokens, or attendance                                   |
| active-prospect email uniqueness + reconciliation                                      | `20260812_0003`, `20260814_0003`                                 | One canonical active applicant per email per organization                                                           |
| shift-template vehicle fields; apparatus crew positions                                | `20260813_0001`, `_0002`                                         | Which rank a crew seat requires, by rank ID rather than free text                                                   |
| training result-visibility default                                                     | `20260813_0006`                                                  | Whether a trainee sees officer-entered evaluation fields                                                            |
| `facilities.view_sensitive` backfill, then Captain revocation                          | `20260813_0008`, `20260814_0004`                                 | Who may _read_ sensitive facility sections — read-only, and not implied by a Captain label                          |
| `manual_batch_ballots_cast`                                                            | `20260813_0009`                                                  | Physical-ballot turnout, separately from electronic                                                                 |
| event mandatory membership types; reminder target                                      | `20260813_0011`, `20260813_0020`                                 | Which tiers an event is mandatory for; who a reminder goes to (`going` / `all` / `none`)                            |
| `show_store_open_banner`                                                               | `20260814_0001`                                                  | Whether the storefront announces that it is open                                                                    |

## Alembic route (upgrade data path)

Single head at the audited commit: **`20260814_0004`**. Run the chain in
repository order; never select revisions by filename.

```
20260809_0002  preserve released revision          (dated 08-09, added inside this window)
20260810_0001  encrypt medical-screening PHI
20260810_0002  score pass/fail criteria            (merge: 20260810_0001 + 20260809_0002)
20260810_0003  email templates track default CSS
20260810_0004  email_templates.footer_key
20260810_0005  shift_equipment_check_items.expiration_found
20260810_0006  check_template_items.restock_needed + reporter/note
20260810_0007  check_template_items.quantity_on_truck
20260810_0008  check_item_deployed_lots            (migrates existing single-lot data across)
20260811_0001  optional equipment-kit items
20260811_0002  skill-test return trail
20260812_0001  saved_ballot_templates
20260812_0002  skill-test resume counter
20260812_0003  restore active-prospect uniqueness  ← PREFLIGHT REQUIRED, see below
20260812_0004  fail closed on public-portal API keys
20260813_0001  shift-template vehicle fields
20260813_0002  apparatus crew positions
20260813_0006  backfill training result-visibility
20260813_0007  reconcile skill-test resume count
20260813_0008  backfill facilities.view_sensitive
20260813_0009  manual_batch_ballots_cast
20260813_0010  scheduling module configs
20260813_0011  event mandatory membership types
20260813_0020  event reminder target               (branch off 20260813_0010)
20260814_0001  store open-banner setting
20260814_0002  saved-ballot election settings
20260814_0003  reconcile active-prospect emails
20260814_0004  revoke Captain facilities.view_sensitive
               (merge: 20260814_0003 + 20260813_0020 → single head)
```

Two revisions carry renumbering history worth knowing before an operator reads a
mismatched filename as corruption: **`20260810_0005`–`_0008` were renumbered from
`_0003`–`_0006`** after `main` landed the email-template pair on the same date,
and **`20260813_0006`–`_0011`** likewise absorbed a branch collision. The
published identities of `20260814_0002` / `_0003` were deliberately preserved
when their destructive work was moved — see the three-day audit.

**Required preflight before `alembic upgrade head`.** `20260812_0003` creates the
active-email unique index _before_ `20260814_0003` can reconcile anything. Run:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

Rows returned is a hard stop. Per group, keep the earliest `created_at` (then
lowest `id`) after reviewing linked application data, set the others `inactive`,
and require a zero-row re-check. Do not delete prospects, and do not assume
`20260814_0003` can repair a collision after index creation has already failed.

**Upgrade edges:** back up first; `alembic heads` must return exactly one; run
`alembic upgrade head`; **never downgrade to repair a fork**. Installations that
saw an interim skill-resume or saved-ballot revision are reconciled by the later
_forward_ migrations. Permission backfills grant a **read** capability only and
never imply edit rights.

## End-to-end data paths and sharing boundaries

The three-day audit records the 08-12 → 08-14 paths (saved ballot, outreach
form, training linkage, shift/apparatus, store order, related notification,
Salesforce, support error). The paths this wider window adds:

- **Supply loop (08-10).** Delivery → `POST /inventory/lots/bulk` (all-or-nothing,
  every item validated in the caller's org) → shelf lot → **Swap** draws N units
  onto a position → `check_item_deployed_lots` row snapshots lot number and
  expiration → the position's on-truck count is the **sum** of its lots and its
  expiration the **earliest** of them → supply worklist, apparatus inventory
  page, equipment-check form and item-to-apparatus lookup all read that derived
  minimum. The snapshot is deliberate: shelf lots get consumed and deleted, and
  what is on a truck must stay answerable after the shelf record is gone.
- **Restock report (08-10).** Crew presses **Minus** on the apparatus page at
  03:00 → count drops _and_ `restock_needed` rises with reporter, timestamp and
  note → the supply worklist shows it beside expiring items, because "expires
  Thursday" and "the crew used it last night" are the same job to a supply
  officer.
- **Field replacement (08-10).** Equipment check writes back `serial_found`,
  `lot_found` **and now `expiration_found`** → the found date lands on the
  template item on submit. Without it, an expired item was force-failed on every
  submission, held its apparatus in a deficiency state, and never left the
  worklist.
- **Onboarding session (08-15).** Wizard tab → `sessionStorage` identifier +
  `SameSite=Strict` CSRF cookie → `X-Session-ID` → `onboarding_sessions` row with
  a 30-minute sliding TTL → setup mutations. **The identifier never reaches
  another tab, another window, or the next browser launch.** The wizard's
  non-sensitive answers travel a separate, longer-lived path
  (`localStorage['onboarding-storage']`), which is why the two can disagree.

**Sharing boundaries unchanged by 08-15 → 08-16.** Neither change moves an
organization boundary, a permission, or a field's visibility. The onboarding
change _narrows_ a client-side grant; the canvas change is presentational.

## Client-side storage map

Recorded because the 08-15 change is only legible against the whole map, and
because "which of these is a credential" is the question that decides where a
value may live.

| Value                             | Location                               | Lifetime          | Sensitivity                                                                             |
| --------------------------------- | -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| Auth tokens                       | **httpOnly cookies only**              | Server-controlled | Never JS-readable — see CLAUDE.md                                                       |
| `has_session`                     | `localStorage`                         | Until sign-out    | Hint only, not a credential; `loadUser()` reads it on refresh                           |
| `csrf_token`                      | Non-httpOnly cookie                    | Session           | Double-submit pair for `X-CSRF-Token`                                                   |
| `onboarding_session_id`           | **`sessionStorage`** _(changed 08-15)_ | Tab               | **Bearer credential** for setup mutations                                               |
| `onboarding_csrf_token`           | `SameSite=Strict` cookie               | Session           | Double-submit pair                                                                      |
| `onboarding-storage`              | `localStorage`                         | Until cleared     | Non-sensitive wizard answers; session IDs and CSRF tokens are excluded from persistence |
| `navigationLayout`, branding keys | `localStorage` / `sessionStorage`      | Mixed             | Presentation only                                                                       |

## Documentation and media disposition

### Screenshots

Any new training paragraph must carry an explicit marker until a verified
capture exists:

> **[SCREENSHOT NEEDED — describe the exact state/control and required demo data]**

**New to this pass (08-15 → 08-16):**

- **REPLACE — three images, measured.** All 429 training images were checked
  programmatically on 08-16. Exactly three carry the old 15px white gutter strip:
  `10-11-public-form-dark`, `00-18-rsvp-modal` and `04-09-rsvp-modal`. The two
  modal shots are the instructive ones — a modal overlay darkens a _light_ page
  but sits inside `body`, so the gutter stayed white behind it. The trigger is
  dark content at the right edge, not the theme setting. No set-wide re-shoot.
- **SCREENSHOT NEEDED — the onboarding session-expiry state.** The wizard
  reporting `ONBD_SESSION_INVALID` after a restart, so the guide can show the
  installer what "start over" looks like rather than describing it. Demo data:
  a part-finished onboarding run, the tab closed and reopened.
- **SCREENSHOT NEEDED — a public route in dark mode** (`/f/:slug` or
  `/application-status/:token`) at full window width, as the standing proof that
  the canvas covers routes outside `AppLayout`.

The 08-12 → 08-14 capture queue and REPLACE list are unchanged and remain in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md), which is
the working queue. Do not overwrite an image until it has been opened and checked
against its caption, and preserve its identifier so guide links stay stable.

### YouTube scripts

Flagged by 08-15 → 08-16, in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md):

- **02 — First-Time Setup & Onboarding — this one was _wrong_, not merely
  incomplete, and has been corrected in the script.** Chapter 2's Welcome Screen
  narration told viewers _"the wizard auto-saves your progress, so if you need to
  step away or your browser closes, you'll pick up right where you left off."_
  That is false as of 08-15 and was misleading before it — the server session has
  always expired after 30 minutes idle. Recorded, it would have been the
  expensive kind of error: a viewer does exactly what the narrator says and loses
  their install. Replaced with the one-tab/one-sitting caution and the
  refilled-form trap; **all timecodes from Chapter 2 onward re-time**
  (~45–70 seconds added). Also re-plan any B-roll showing the presenter leaving
  the wizard and returning — that shot now fails on camera.
- **01 / 03 — Installing / IT Manager.** Same caution where the install walkthrough
  hands off between screens.
- **Any script with full-screen dark-mode B-roll** recorded before 08-15 shows the
  unpainted gutter. Re-shoot only if the seam is visible in frame; it is an edit
  decision per clip, not a re-record of the script.

The 08-12 → 08-14 script queue (01/03 TLS and upgrades, 04/06 dashboard, 07
notifications and message delivery, 12 elections, 13 storefront, 14/15/16
training and skills, 08 QR short) is unchanged.

## Verification checklist

- Confirm `alembic heads` returns exactly one head (`20260814_0004`) and upgrade
  a **copy** of pre-window data; run the active-prospect preflight first.
- Exercise each route in [Routes added in this window](#routes-added-in-this-window)
  with same-org, cross-org, missing-permission, and unauthenticated cases —
  particularly the two print routes, where the control is server-side redaction
  rather than the route gate.
- Onboarding: complete a run in one tab; then confirm a second tab does **not**
  inherit it; then confirm a browser restart yields `ONBD_SESSION_INVALID` on the
  next mutating step rather than a silent half-write; then confirm an
  already-installed instance answers `ONBD_ALREADY_COMPLETED`.
- Load a public route (`/f/:slug`, ballot voting, `/application-status/:token`)
  in dark mode at a window narrow enough to scroll, and confirm no seam at the
  right edge.
- Print a scorecard and a label with "Background graphics" **on**, in **light**
  mode, and confirm a white page; then open a print route in dark mode on a
  tall window and confirm the grey desk reaches the edges. Both were broken
  between 08-15 and 08-16 and are guarded by `PrintPageStyles.test.tsx`.
- Verify desktop and 375px layouts, keyboard focus, 44px touch targets, empty
  states, loading states, and API failures.
- Clear a **SCREENSHOT NEEDED** marker only after the image is opened and read
  against its caption. Re-time script chapters after inserting narration;
  timestamp drift is an editorial defect even when the words are right.
