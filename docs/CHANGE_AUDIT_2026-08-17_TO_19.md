# Change audit: August 17–19, 2026

Net changes merged to `main` in the 72 hours ending 2026-08-19 18:04 EDT
(merge `2777e004`, PR #1571), picking up where the
[August 15–16 audit](./CHANGE_AUDIT_2026-08-15_TO_16.md) stopped.

Two schema migrations, one substantial new feature (PII-free call volume
tracking with a resumable shift close-out wizard), a cross-module NFC tag
surface, a configuration-preflight tool, a rewritten privacy notice, roughly
twenty security fixes from an automated red-team pass, and a CI outage fix
that had been letting the backend suite report _skipped_ rather than failed.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 17–19 section). Wiki handoff:
[`Recent-Changes-2026-08-17-to-19`](../wiki/Recent-Changes-2026-08-17-to-19.md).
Media disposition — which screenshots are now wrong and which YouTube takes
need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

## Release map

| Area                                                | PRs                 | Pages / connection points                                                                                                                                                            | API / data points                                                                                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduling — PII-free call volume                   | #1567               | Scheduling → Settings → **General → Shift close-out rules**: the **Record a call count at close-out** toggle. Shift detail panel → close-out. Reports → Call Volume                  | New tables `org_calls`, `org_call_responses`; new org setting `scheduling.call_tracking.{mode,call_types}`; `POST /scheduling/shifts/{id}/finalize` gains `reported_call_count`, `reported_call_types`, `member_call_counts`, `attach_call_ids`; `GET /scheduling/reports/call-volume` gains `counts_unit_responses` | Three quantities, three code paths, deliberately not reconcilable: department volume = distinct `OrgCall` rows; apparatus runs = `OrgCallResponse` rows; member credit = `ShiftAttendance.call_count`. `null` count ≠ `0`. Cap of 100 calls per shift. A tally short of the total pads with unclassified rather than rejecting. Mode absent ⇒ `detailed`, never `off`.                                                                                                                                                                                                                                                         |
| Scheduling — resumable close-out wizard             | #1567               | Shift detail panel → **Close out shift** (count-only departments only)                                                                                                               | New column `shifts.closeout_step`; `GET /scheduling/shifts/{id}/closeout`; `PATCH …/closeout/attendance`; `PATCH …/closeout/calls`                                                                                                                                                                                   | Each step writes real records as it advances, so a locked phone resumes rather than restarting. `closeout_step` carries no entered data. Finalized shifts report step 0; reopening restarts the wizard. Detailed-mode departments keep the single finalize checklist unchanged.                                                                                                                                                                                                                                                                                                                                                |
| NFC tags across modules                             | #1568               | `/events/:id/qr-code`, `/admin-hours/categories/:id/qr-code`, `/locations/qr-codes`, shift detail panel QR block; **Tap Tag** on Events, My Admin Hours, and the scheduling calendar | `constants/nfc.ts` — `TAG_TARGETS` registry, `parseNfcTagPath`, `buildShiftCheckInUrl`, `buildEventCheckInUrl`; `NfcTagWriter`, `NfcTagWriteButton`, `NfcTapButton`; `useNfcScanner`, `useNfcWriter`; `NfcTagTarget` in `constants/enums.ts`                                                                         | A tag is untrusted input. The parser resolves against the app's own origin, rejects anything landing elsewhere (which disposes of `javascript:` and `data:`), and returns a **rebuilt** route rather than the raw string. Only spec-named query parameters may carry an id; `?next=` cannot be smuggled in. `/display/:code` is deliberately not taggable. Web NFC is Android-Chromium only and needs a secure context: the compact controls render nothing where the API is absent, while the full writer panel distinguishes an insecure origin from an unsupported browser so the reader learns which one they are hitting. |
| Configuration — preflight and passthrough           | #1563–#1566         | — (CLI)                                                                                                                                                                              | `python -m app.preflight`, `--compose PATH`; `app/core/startup_diagnostics.py`; `docs/UPGRADING.md`                                                                                                                                                                                                                  | Exit `0` starts, `1` blocked (items listed), `2` malformed. Must be run with the same `-f` compose files and `--build`, or it answers about a configuration nobody runs. `COOKIE_SECURE` is now reachable from `.env` without breaking the unset case. A dropped compose setting is named rather than silently defaulted.                                                                                                                                                                                                                                                                                                      |
| Privacy notice and terms                            | #1562               | `/privacy`, `/terms` (public)                                                                                                                                                        | Static content; print stylesheet extracted; `noscript` fallback                                                                                                                                                                                                                                                      | Department control is stated up front: the department, not the platform, is the data controller. Accessibility pass on the print pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Auth — breached passwords, CAPTCHA, per-IP throttle | #1503, #1548, #1560 | Login, forgot-password, public registration, the two internet-exposed forms                                                                                                          | HIBP k-anonymity range lookup; `app/core/suspicious_ip.py`; CAPTCHA widget origins added to `SecurityHeadersMiddleware` CSP; `X-Captcha-Token` allowed in CORS                                                                                                                                                       | Breached-password lookup **fails open** (it is supplementary; an outage must not block password changes). CAPTCHA **fails closed** (nothing sits behind it). A successful sign-in clears an IP's counter only after _full_ authentication, and clearing never lifts an active block. Lockout responses are generic by default.                                                                                                                                                                                                                                                                                                 |
| Dashboard — phone layout                            | #1502, #1525, #1553 | `/dashboard`                                                                                                                                                                         | `DashboardNeedsYou`; week strip collapses on narrow viewports                                                                                                                                                                                                                                                        | The phone line counts the whole week, not the visible slice; focus is preserved across the collapse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Inventory — vendors, medical supplies               | #1513, #1514, #1495 | `/inventory/vendors`, `/medical-supplies`                                                                                                                                            | Vendor records replace typed-in names; unmatched vendor names reported on CSV import                                                                                                                                                                                                                                 | Medical supplies split onto their own page; vendor pricing is a purchasing permission, not a directory one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CI — apt stall and duplicated DB setup              | #1571               | —                                                                                                                                                                                    | `.github/scripts/install-system-deps.sh`; `.github/actions/backend-db-setup/action.yml`; `backend/scripts/repair_schema.py`                                                                                                                                                                                          | An unbounded `apt-get` stalled 19m26s and consumed the whole 20-minute budget of two jobs; matrices behind `needs:` then reported **skipped**, so a merge reached `main` with no backend test having run and nothing red. Now: skip apt entirely when the SONAME is already loadable, else retry under one 240s deadline covering every attempt.                                                                                                                                                                                                                                                                               |
| Security fixes (red-team batch)                     | #1479–#1561         | Training, scheduling, elections, forms, kiosk, integrations                                                                                                                          | See [`security/RED_TEAM_REVIEW_2026-08-16.md`](./security/RED_TEAM_REVIEW_2026-08-16.md)                                                                                                                                                                                                                             | Cross-tenant IP allowlist bypass; qualification-roster and training-approval scoping; kiosk draft-event exposure; CSV formula injection in the impact planner; unescaped markup in impact-plan PDFs; early self-check-in grace bounded; deleted users excluded from platoon generation; integration credentials bound to API base URLs; webhooks bound to pipeline stage references.                                                                                                                                                                                                                                           |

## Alembic route (upgrade data path)

Two revisions this window, both introspection-guarded and both reversible:

| Revision       | Revises        | File                                                    | What it does                                                                           |
| -------------- | -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `82bdcb3b1e64` | `8050e5a61f34` | `20260818_1200_82bdcb3b1e64_add_call_tracking.py`       | Creates `org_calls` and `org_call_responses` with their indexes and unique constraints |
| `2827079fd66c` | `82bdcb3b1e64` | `20260819_0900_2827079fd66c_add_shift_closeout_step.py` | Adds `shifts.closeout_step` INTEGER NULL                                               |

`8050e5a61f34` (`20260817_1847`) is the rejoin that collapsed the four heads
left by concurrently-merged pull requests on 2026-08-17; two merge revisions
dated `20260817_1757` sit under it. **`2827079fd66c` is the current head.**
Confirm with `cd backend && python scripts/validate_migrations.py` rather than
trusting this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md)
deliberately does not declare a head in prose, for the reason recorded there.

Both upgrades are additive. Neither backfills: an organization that has never
run count-only tracking gets two empty tables and a NULL column, and every
report keeps reading the source it already read.

## New data model

### `org_calls` — one call the department ran

| Column            | Type                 | Notes                                                                                                                        |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`              | VARCHAR(36) PK       |                                                                                                                              |
| `organization_id` | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`, indexed                                                                         |
| `call_date`       | DATE NOT NULL        | **Date only.** A timestamp would let response times be reconstructed, which is the first step back toward an incident record |
| `call_type`       | VARCHAR(50) NULL     | Slug into the org's own type list, never a display label. NULL = unclassified                                                |
| `source`          | VARCHAR(20) NOT NULL | `manual` \| `dispatch` \| `derived`. Not a DB enum — a new dispatch vendor should not need a migration                       |
| `external_ref`    | VARCHAR(100) NULL    | Dispatch's own id. Never displayed; a CAD incident number is a lookup key into a system that _does_ hold PII                 |
| `created_at`      | DATETIME(tz)         |                                                                                                                              |
| `created_by`      | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL` (nullable per pitfall #2)                                                               |

Indexes: `ix_org_calls_organization_id`, `ix_org_calls_call_date`,
`idx_org_call_org_date`. Unique: `uq_org_call_external_ref
(organization_id, external_ref)` — this is what makes a dispatch re-sync
idempotent instead of duplicating the day's calls on every poll, and it is
org-scoped because two departments on the same CAD share its numbering.

### `org_call_responses` — one apparatus on one call

| Column            | Type                 | Notes                                                                                                                                                                                             |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | VARCHAR(36) PK       |                                                                                                                                                                                                   |
| `organization_id` | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`                                                                                                                                                       |
| `call_id`         | VARCHAR(36) NOT NULL | FK → `org_calls.id` `ON DELETE CASCADE`                                                                                                                                                           |
| `shift_id`        | VARCHAR(36) NULL     | FK → `shifts.id` **`ON DELETE SET NULL`** — deleting a shift must not silently reduce the department's historical call volume                                                                     |
| `apparatus_id`    | VARCHAR(36) NULL     | **Polymorphic, no FK**, exactly like `shifts.apparatus_id`: resolves against either apparatus table via `utils/apparatus_ref`. A department on `BasicApparatus` has no `apparatus.id` to point at |
| `created_at`      | DATETIME(tz)         |                                                                                                                                                                                                   |

Unique: `uq_call_response_apparatus (call_id, apparatus_id)` — a unit responds
to a given call once. Without it, re-finalizing a shift would add a second run
to the apparatus's tally every time an officer corrected a number.

### `shifts.closeout_step`

INTEGER NULL. `0`/NULL = not started, `1` = attendance saved, `2` = calls
saved. It carries **no entered data** — the wizard writes real records as it
advances — only where to resume.

## What is deliberately not collected

This is the point of the feature, so it is worth stating as a contract rather
than as a description. `org_calls` holds no address, no cross streets, no
patient or caller identity, no narrative, no dispatch/on-scene/clear times, and
no CAD incident number for display. That is enforced **by absence**: there is
no parameter to pass one to and no column to land it in, and
`test_incident_detail_is_not_accepted` asserts the request schemas reject the
fields outright.

A department that wants incident-level records wants an incident module, behind
its own consent and access-control story. A call counter is not the place to
start keeping PHI.

## End-to-end data paths and sharing boundaries

**Call recording (count-only mode).**
Officer opens the shift detail panel → wizard step 2 posts
`PATCH /scheduling/shifts/{id}/closeout/calls` →
`SchedulingService.save_closeout_calls` →
`CallTrackingService.record_shift_calls` reconciles this shift's _solely-owned_
calls against the reported total → `OrgCall` + `OrgCallResponse` rows →
`shifts.closeout_step = max(current, 2)`. Finalize then snapshots
`shifts.call_count` from `shift_response_count` and writes per-member
`ShiftAttendance.call_count`.

**Cross-unit dedup.** `attach_call_ids` on finalize (and on the step-2 PATCH)
points this shift's apparatus at a call another unit already logged, via
`CallTrackingService.attach_response`. Attachment runs **before** the
shift's own reconciliation, so a shared call counts toward the total instead
of being duplicated alongside it. Org scope is an explicit filter on the
query, not an inference from the caller's permission (pitfall #14b).

**Reporting.** `GET /scheduling/reports/call-volume` picks **one** source and
never mixes: count-only orgs read `org_calls`; detailed orgs read the
per-incident records feeding `ShiftCompletionReport`. Reading both and adding
them would double-count every call for an org that has used each mode in turn.
The count-only branch sets `counts_unit_responses: true`, and the renderer
relabels **Total Calls → Unit Responses**, **Avg Calls/Day → Avg
Responses/Day**, **Peak Calls → Peak Responses**, with a footnote saying an
incident two units attended is counted once for each.

**Training credit.** `ShiftAttendance.call_count` is what a member's training
requirements grade against. It is never derived from the department total and
never summed back into one — with a four-person crew that multiplies every call
by four.

**Sharing boundary.** Nothing in this feature crosses an organization: every
read and write filters `organization_id`, and the polymorphic `apparatus_id`
is resolved through the org-scoped shift rather than trusted from the client.
No call data reaches any integration, export, or email in this release.

## Edge cases worth knowing

These are behaviours a reader will otherwise discover in production. Each is
covered by a test in `backend/tests/test_call_tracking.py` (70 tests) or
`frontend/src/pages/scheduling/ShiftCloseoutWizard.test.tsx`.

- **`null` and `0` are different facts.** `null` is "we did not track it", `0`
  is "we ran none". A report that conflates them understates the department's
  quiet nights as missing data. The step-2 PATCH distinguishes an omitted field
  from an explicit null via `count_provided`, so a client that only attaches
  calls does not wipe a count it never mentioned.
- **A short tally pads with unclassified.** `{"ems": 3}` against a total of 5
  records two untyped calls. Requiring the breakdown to reconcile exactly would
  teach officers to invent a type at 0700 to get the close-out to submit.
- **A tally longer than the total is truncated**, and zero-valued entries are
  ignored entirely.
- **Lowering the total below the shift's already-shared calls is refused**, with
  a message naming the count and telling the officer to detach first. Silently
  detaching would drop another unit's run from the record.
- **Shared calls survive re-finalization.** Only solely-owned calls are
  reconciled. Rebuilding every call from scratch on each finalize would delete
  the other unit's response along with it.
- **A corrected shift drags its calls with it.** Editing the shift's date or
  reassigning it to another apparatus after step 2 was saved re-dates and
  re-attributes the surviving rows. Before this fix the totals stayed right
  while the daily and per-apparatus reports pointed at the wrong day and the
  wrong truck.
- **An apparatus-less shift is deduped by `shift_id`, not `apparatus_id`.**
  `apparatus_id == None` compiles to `= NULL`, which is never true, so every
  attach inserted another row: the tally climbed on each save and the third
  raised.
- **The close-out roster is `ASSIGNED` and `CONFIRMED` only.** `DECLINED`,
  `PENDING` and `NO_SHOW` members were previously listed, and every listed
  member gets an attendance row and the apparatus's full call count by default
  — calls credited to people who never worked the shift.
- **Assigned members with no attendance row are still listed**, with empty
  times to fill in. Otherwise anyone who never checked in was invisible: no
  hours, no credit, and no way for the officer to notice.
- **Per-member call _types_ are not invented.** Types are recorded only when
  the member was on every call; below that the count stands alone. A trainee
  credited with one call on a shift of one EMS and one fire was previously
  always assigned "EMS" — an alphabetical prefix — and `create_report` then
  spent that invented type against type-specific requirements.
- **A seeded credit and a typed one are distinguished.** On a fresh close-out
  the count is not known yet, so every credit seeds to 0; treating that as the
  officer's answer pinned the whole crew at 0 once a real count arrived.
- **Counts against a call type an admin later deleted are dropped from the
  payload**, rather than travelling invisibly and returning as an unknown-slug
  error with no field to clear.
- **Malformed `call_types` JSON degrades to the built-in list**, and the
  sanitiser now mirrors `CallTypeOption`'s pattern and length bounds exactly.
  It previously admitted any non-blank slug, so a hand-edited uppercase or
  over-long entry passed the filter and then failed schema construction —
  taking out the settings endpoint and every close-out for that organization.
- **The mode toggle takes effect immediately.** `loadSettings` is a
  once-per-session cache; without mirroring the save into the store an admin
  who enabled count-only kept seeing the old checklist (which never asks for a
  count) while the backend had already moved and would finalize with none
  recorded.
- **Count-only departments that enforce end-of-shift checks can still close
  out.** The wizard carries the override (gated on a logged reason) and
  pass-down notes, because it _replaces_ the finalize checklist rather than
  sitting beside it.
- **100 calls per shift is a hard cap.** An officer closing out a shift is
  reporting a tour, not a year; a department genuinely running more has an RMS
  and is not using count-only mode.
- **Post-shift validation never prompts for an already-finalized shift**, even
  if it was finalized after it ended but before the task ran.

## Known gaps carried forward

- **The cross-unit attach picker has no UI.** `attachable_calls` is served
  **empty** on the close-out GET, deliberately: `list_calls_in_window` costs
  two queries on every request and nothing consumes the result yet. The field
  stays on the response so the contract does not change when the picker lands.
  Until then, dedup is reachable only by an API client sending
  `attach_call_ids`, and two units closing out independently each report their
  own call — which is exactly why the report labels the figure **unit
  responses**. Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#scheduling-module).
- **The call-volume report carries no preliminary marker.** Unfinalized shifts
  are labelled preliminary elsewhere; this report is not, and a docstring that
  claimed otherwise has been corrected rather than the marker added.
- **`dispatch` and `derived` sources have no writer.** The `CallSource` values
  and the `external_ref` unique constraint exist so a dispatch integration can
  be added without a migration. Nothing writes them today.

## Documentation and media disposition

### SCREENSHOT NEEDED (new captures)

- **Scheduling → Settings → General → Shift close-out rules**, with the
  **Record a call count at close-out** toggle visible and on. Guide 03.
- **Close-out wizard step 1 — attendance**: the crew listed with editable
  on/off times, the combined-hours figure, and a member flagged
  _missing check-out_. Guide 03.
- **Close-out wizard step 2 — calls**: the per-type rows with the derived,
  read-only total beside them. This is the screen that teaches "the rows are
  the only source". Guide 03.
- **Close-out wizard step 3 — confirmation**: per-member credit seeded from the
  apparatus count, with one member adjusted down for a late arrival. Guide 03.
- **Close-out with outstanding end-of-shift checks**, showing the override
  checkbox and its required reason field. Guide 03.
- **Reports → Call Volume in count-only mode**, showing the **Unit Responses**
  labelling and the footnote. Caption it against the detailed-mode version so
  the difference in what the number means is visible. Guides 03 and 08.
- **`/events/:id/qr-code` with "Write to an NFC tag"**, mid-write. Guide 04.
- **Tap Tag on the Events page**, scan armed. Guide 04 and guide 10.
- **`/locations/qr-codes` apparatus card** showing **Write NFC tag** in the
  action row beside Copy URL / Download PNG / Regenerate. Guide 06.
- **`/admin-hours/categories/:id/qr-code` with the tag writer** beside the QR
  code. Guide 08.
- **An unrecognized tag**, showing the scan left armed with an explanation
  rather than a navigation. This is the security behaviour and it needs a
  picture. Guide 04.
- **`python -m app.preflight` output**, one clean run and one blocked run with
  the items listed. Guide 00 / script 01.
- **Privacy notice header** as rewritten, showing the department-control
  statement above the fold. Guide 17.

### REPLACE / re-verify (existing images invalidated)

- **Any shift finalize / close-out screenshot in guide 03.** For a count-only
  department the single checklist is gone, replaced by the three-step wizard.
  Existing images are still correct for detailed-mode departments — caption
  them as such rather than deleting them, and shoot the wizard alongside.
- **Reports → Call Volume**, guides 03 and 08. The stat-card labels change
  wording in count-only mode; an uncaptioned old shot now silently claims
  incidents where the figure is unit responses.
- **`/events/:id/qr-code`**, guide 04. The action row gained a button; the
  existing shot is missing it.
- **`/locations/qr-codes`**, guide 06. Same — apparatus cards gained **Write
  NFC tag**.
- **`/admin-hours/categories/:id/qr-code`**, guide 08. Same.
- **Shift detail panel QR block**, guide 03. The NFC writer now sits under the
  QR code.
- **Scheduling → Settings → General**, guide 03. The _Shift close-out rules_
  block gained a setting; a shot of that block is stale.
- **`/privacy` and `/terms`**, guide 17. Rewritten content and a new print
  stylesheet — every existing capture is wrong.
- **Login page**, guide 00, **if** the department has CAPTCHA enabled: the
  challenge widget is new on the two internet-exposed forms.
- **Dashboard on a phone**, guides 00 and 10. The week strip collapses and the
  alert list is condensed; existing narrow-viewport captures predate both.

### YouTube scripts

Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary — **all five affected scripts are now rewritten in place**, so nothing
behavioural from this window is left sitting in the queue:

- **04 — Fire Chief / Leadership** _(WRONG, corrected in-script)_. The close-out
  chapter narrated the single checklist and never mentioned the toggle sitting
  on the very card the presenter stands on. Worse, Scheduling Reports sent a
  chief to a figure labelled **unit responses** — a chief reading "400 calls"
  off a screen that means "400 unit responses" puts the wrong number in a grant
  application. Both are now in the take; pull any existing footage of the
  reports beat.
- **08 — Quick Tips & Shorts** _(written in-script)_. Short 8J gains a shooting
  note: film it on a detailed-mode department, where it stays correct as filmed.
  New short **8AG, "Tap Instead of Scan"**, covers NFC.
- **01 — Installing The Logbook** _(written in-script)_. New chapter **CHECK IT
  BEFORE YOU START IT** ahead of START THE SERVICES. The highest-value 60
  seconds available in the series: it turns "find the configuration problem by
  losing the service" into a command run beforehand.
- **03 — IT Manager** _(written in-script)_. Chapter 5 gains the brute-force
  stack and — the load-bearing part — which controls fail **open** and which
  fail **closed**. Chapter 9 gains preflight and `--compose`.
- **06 — Member Guide** _(written in-script)_. NFC tap as a second way in, with
  the Android-only limitation said plainly rather than buried: a member who
  tries it on an iPhone and fails will assume the app is broken.

## Verification checklist

- [ ] `cd backend && python scripts/validate_migrations.py` reports a single
      head of `2827079fd66c`
- [ ] `cd backend && pytest tests/test_call_tracking.py` — 70 tests
- [ ] `cd frontend && npm run typecheck` clean (aliased compiler, not bare `tsc`)
- [ ] A detailed-mode department still sees the single finalize checklist
- [ ] Enabling count-only shows the wizard **without a page reload**
- [ ] Reopening a finalized shift restarts the wizard at step 1
